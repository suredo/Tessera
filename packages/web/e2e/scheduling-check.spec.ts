import { expect, test, type Page } from "@playwright/test";
import type { Artifact } from "../../contracts/src/index.ts";
import { startSandboxHost, type SandboxHost } from "./support/sandbox-host.ts";
import { ready } from "./support/ready.ts";

// The scheduling profile's behavior check (VER-03), in Chrome and Edge (TEST-06): in staging,
// after the smoke check, it adds a task, then a rule against the weekday of one of its sessions,
// opens the tool again, removes the rule and opens it again, its saves going to a throwaway copy
// (BRG-06). It reads each session's date from a time element, and today from the host's clock
// (RUN-07). A good planner passes; each deliberately broken one fails, saying what was expected,
// what was observed and whose rule it is (VER-07).

type Flaw =
  | "none"
  | "ignoresRule"
  | "startsYesterday"
  | "ruleNotSaved"
  | "removeNotSaved"
  | "removesAll"
  | "noDates"
  | "dropsOthers";

/** A study planner that fits the scheduling profile, with `flaw` built in. */
const planner = (flaw: Flaw): Artifact["code"] => ({
  html: `<label for="task">Topic</label> <input id="task" data-hook="task-name">
<button data-hook="task-add">Add</button>
<label for="day">Never on</label> <select id="day" data-hook="rule-day">
<option value="0">Sunday</option><option value="1">Monday</option><option value="2">Tuesday</option>
<option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option>
<option value="6">Saturday</option></select>
<button data-hook="rule-add">Add rule</button>
<ul id="rules"></ul>
<ul id="sessions"></ul>`,
  css: "",
  js: `const flaw = ${JSON.stringify(flaw)};
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
let state;
let today;
const element = (tag, hook, text) => {
  const made = document.createElement(tag);
  if (hook) made.dataset.hook = hook;
  if (text) made.textContent = text;
  return made;
};
// The day \`offset\` days from today, as YYYY-MM-DD with its weekday, and the next 14 from today.
const dayAt = (offset) => {
  const [y, m, d] = today.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d + offset));
  return { date: at.toISOString().slice(0, 10), weekday: at.getUTCDay() };
};
const days = () => Array.from({ length: 14 }, (_, i) => dayAt(i));
const render = () => {
  const ruled = new Set(state.data.rules.map((rule) => rule.weekday));
  // One flaw shows its rules but schedules as if it had none.
  const open = days().filter(({ weekday }) => flaw === "ignoresRule" || !ruled.has(weekday));
  document.getElementById("rules").replaceChildren(...state.data.rules.map((rule) => {
    const item = element("li", "rule", "Never on " + DAYS[rule.weekday] + " ");
    const remove = element("button", "rule-remove", "Remove");
    remove.addEventListener("click", () => removeRule(rule));
    item.append(remove);
    return item;
  }));
  // One flaw, once a rule has been added to the one it starts with, schedules only the last task.
  const tasks = flaw === "dropsOthers" && state.data.rules.length > 1 ? state.data.tasks.slice(-1) : state.data.tasks;
  document.getElementById("sessions").replaceChildren(...tasks.flatMap((task, i) =>
    [0, 3, 6].map((step) => {
      // One flaw puts each task's first session on the day before today.
      const { date, weekday } =
        flaw === "startsYesterday" && step === 0 ? dayAt(-1) : open[(i + step) % open.length];
      const item = element("li", "session");
      // One flaw shows each date only in words.
      if (flaw === "noDates") item.append(DAYS[weekday]);
      else {
        const time = element("time", "", DAYS[weekday]);
        time.dateTime = date;
        item.append(time);
      }
      item.append(" ", element("span", "session-task", task.name));
      return item;
    })));
};
const load = () => tessera.call("data.read").then((read) => { state = read; render(); });
const save = (operations) => tessera.call("data.patch", { operations }).then(load);
function removeRule(rule) {
  if (flaw === "removeNotSaved") {
    state.data.rules = state.data.rules.filter((each) => each !== rule);
    return render();
  }
  // One flaw removes every rule.
  const gone = flaw === "removesAll" ? state.data.rules : [rule];
  save(gone.map((each) => ({ op: "remove", collection: "rules", id: each.id, revisionCount: state.revisions.rules[each.id] })));
}
tessera.call("clock.now").then((now) => { today = now.date; return load(); });
document.querySelector("[data-hook=task-add]").addEventListener("click", () => {
  const name = document.querySelector("[data-hook=task-name]").value.trim();
  if (name) save([{ op: "add", collection: "tasks", record: { name } }]);
});
document.querySelector("[data-hook=rule-add]").addEventListener("click", () => {
  const weekday = Number(document.querySelector("[data-hook=rule-day]").value);
  if (flaw === "ruleNotSaved") {
    state.data.rules.push({ id: "added", weekday });
    return render();
  }
  save([{ op: "add", collection: "rules", record: { weekday } }]);
});`,
});

const flaws: Flaw[] = [
  "none",
  "ignoresRule",
  "startsYesterday",
  "ruleNotSaved",
  "removeNotSaved",
  "removesAll",
  "noDates",
  "dropsOthers",
];
let host: SandboxHost;

test.beforeAll(async () => {
  host = await startSandboxHost(Object.fromEntries(flaws.map((flaw) => [flaw, planner(flaw)])));
});
test.afterAll(() => host.close());

type Result = { outcome: string; check?: string; reason?: string };
type Data = { tasks: { name: string }[]; rules: { weekday: number }[] };

const PLANNED: Data = {
  tasks: [{ name: "Algebra" }, { name: "Geometry" }],
  rules: [{ weekday: 0 }],
};

/** Stages a tool behind the smoke check and the scheduling check; activation is refused. */
async function check(page: Page, flaw: Flaw, data = PLANNED): Promise<Result> {
  await page.goto(host.url);
  await ready(page, "stageCandidate");
  return page.evaluate(
    async ({ mountId, data }) => {
      const w = window as unknown as {
        stageCandidate(options: unknown): Promise<Result>;
        smokeCheck(): unknown;
        profileCheck(id: string): unknown;
      };
      return w.stageCandidate({
        candidate: {
          mountId,
          hash: "a".repeat(64),
          capabilities: ["clock"],
          syntheticData: {
            tasks: data.tasks.map((task, i) => ({ id: `t-${i + 1}`, ...task })),
            rules: data.rules.map((rule, i) => ({ id: `r-${i + 1}`, ...rule })),
          },
        },
        workspaceId: "00000000-0000-4000-8000-000000000000",
        expectedDataRevision: 0,
        activationToken: "00000000-0000-4000-8000-000000000001",
        checks: [w.smokeCheck(), w.profileCheck("scheduling")],
        // Reached only when every check passed; refusing keeps the test off the server.
        activate: () =>
          Promise.resolve({ ok: false, reason: "stale", message: "Passed the checks." }),
      });
    },
    { mountId: flaw, data },
  );
}

const PASSED = { outcome: "refused", reason: "stale", message: "Passed the checks." };
const WEEKDAY = "(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)";

test("VER-03, RUN-07: a planner that schedules a task from today, keeps to a rule and lets it go, and saves both, passes the scheduling check", async ({
  page,
}) => {
  expect(await check(page, "none")).toEqual(PASSED);
});

test("VER-03: so does one that starts with no tasks and no rules", async ({ page }) => {
  expect(await check(page, "none", { tasks: [], rules: [] })).toEqual(PASSED);
});

test("VER-03, VER-07: a planner that shows a rule but schedules on its weekday fails, saying what was expected and observed, by whose rule", async ({
  page,
}) => {
  const result = await check(page, "ignoresRule");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toMatch(
    new RegExp(
      `^The scheduling check, a rule of Tessera's \\(Choosing a weekday in rule-day .*\\): expected no session on a ${WEEKDAY}, with a rule against it, after adding the rule; observed [0-9]+ sessions? on one: "[0-9]{4}-[0-9]{2}-[0-9]{2} ${WEEKDAY} `,
    ),
  );
});

test("VER-03, RUN-07: a planner that schedules a task before today, by the host's clock, fails", async ({
  page,
}) => {
  const result = await check(page, "startsYesterday");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toMatch(
    /expected "Tessera check task [0-9a-f]{6}"'s sessions today, ([0-9-]{10}), or later; observed one on [0-9-]{10}\.$/,
  );
});

test("VER-03: a planner that keeps to a rule without saving it fails once opened again", async ({
  page,
}) => {
  const result = await check(page, "ruleNotSaved");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toContain(
    "(Opened again, the tool shows the sessions and rules as they were saved.)",
  );
  expect(result.reason).toMatch(
    new RegExp(
      `expected the 2 rules it showed, after opening the tool again; observed 1 rule; gone: "Never on ${WEEKDAY} Remove"\\.$`,
    ),
  );
});

test("VER-03: a planner that lets a rule go without saving that fails once opened again", async ({
  page,
}) => {
  const result = await check(page, "removeNotSaved");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toMatch(
    new RegExp(
      `after removing the rule and opening the tool again; observed 2 rules; still or new: "Never on ${WEEKDAY} Remove"\\.$`,
    ),
  );
});

test("VER-03: a planner whose remove takes away every rule fails", async ({ page }) => {
  const result = await check(page, "removesAll");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toMatch(
    new RegExp(
      `^The scheduling check, a rule of Tessera's \\(Pressing a rule's rule-remove .*\\): expected the 1 rule it started with, as they were, after removing the one against ${WEEKDAY}; observed 0 rules; gone: "Never on Sunday Remove"\\.$`,
    ),
  );
});

test("VER-03, VER-04: a planner that shows dates only in words, without the time element the prompt asked for, fails", async ({
  page,
}) => {
  const result = await check(page, "noDates");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toMatch(
    new RegExp(
      `expected a date in each of the 9 sessions, as a time element's datetime, YYYY-MM-DD; observed none that is a real date in session 1, "${WEEKDAY} Algebra"\\.$`,
    ),
  );
});

test("VER-03: a planner that drops the other tasks' sessions when a rule is added fails", async ({
  page,
}) => {
  const result = await check(page, "dropsOthers");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toMatch(
    /expected every task that had a session still in one or more after adding the rule; observed none for "Algebra", "Geometry", of 3 sessions\.$/,
  );
});
