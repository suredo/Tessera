import { expect, test, type Page } from "@playwright/test";
import type { Artifact } from "../../contracts/src/index.ts";
import { startSandboxHost, type SandboxHost } from "./support/sandbox-host.ts";
import { ready } from "./support/ready.ts";

// The items-over-time profile's behavior check (VER-03, #351), in Chrome (TEST-06): in staging,
// after the smoke check, it adds a habit of its own and marks it done today, twice, then comes back
// the next day and three days on, by the host's clock moved on (RUN-07), its saves going to a
// throwaway copy (BRG-06). A good tracker passes; each deliberately broken one fails, saying what
// was expected, what was observed and whose rule it is (VER-07).

type Flaw = "none" | "countsTwice" | "neverResets" | "ignoresClock" | "notSaved";

/** A habit tracker that fits the items-over-time profile, with `flaw` built in. */
const tracker = (flaw: Flaw): Artifact["code"] => ({
  html: `<label for="name">Habit</label> <input id="name" data-hook="habit-name">
<button type="button" data-hook="habit-add">Add</button>
<ul id="habits"></ul>`,
  css: "",
  js: `const flaw = ${JSON.stringify(flaw)};
let state;
let today = "";
const previous = (date) => {
  const at = new Date(date + "T12:00:00Z");
  at.setUTCDate(at.getUTCDate() - 1);
  return at.toISOString().slice(0, 10);
};
// Days in a row done, ending today; one flaw counts every day it was done, one each time it was
// marked, a day marked twice counting twice.
const streakOf = (habit) => {
  if (flaw === "neverResets") return habit.done.length;
  const done = new Set(habit.done);
  let count = 0;
  for (let day = today; done.has(day); day = previous(day)) {
    count += flaw === "countsTwice" ? habit.done.filter((d) => d === day).length : 1;
  }
  return count;
};
const render = () => {
  document.getElementById("habits").replaceChildren(...state.data.habits.map((habit) => {
    const item = document.createElement("li");
    item.dataset.hook = "habit";
    const name = document.createElement("span");
    name.textContent = habit.name;
    const streak = document.createElement("span");
    streak.dataset.hook = "habit-streak";
    streak.textContent = streakOf(habit) + " days in a row";
    const done = document.createElement("button");
    done.type = "button";
    done.dataset.hook = "habit-done";
    done.textContent = "Done today";
    done.addEventListener("click", () => mark(habit));
    item.append(name, " ", streak, " ", done);
    return item;
  }));
};
// Today by the host's clock; one flaw always thinks it is the same day.
const load = () => tessera.call("clock.now").then((clock) => {
  today = flaw === "ignoresClock" ? "2026-01-01" : clock.date;
  return tessera.call("data.read");
}).then((read) => { state = read; render(); });
load();
const mark = (habit) => {
  // One flaw counts a second press on the same day.
  if (flaw !== "countsTwice" && habit.done.includes(today)) return;
  const done = [...habit.done, today];
  if (flaw === "notSaved") { habit.done = done; return render(); }
  tessera.call("data.patch", { operations: [{ op: "replace", collection: "habits", id: habit.id, revisionCount: state.revisions.habits[habit.id], fields: { done } }] }).then(load);
};
document.querySelector("[data-hook=habit-add]").addEventListener("click", () => {
  const name = document.querySelector("[data-hook=habit-name]").value.trim();
  if (!name) return;
  tessera.call("data.patch", { operations: [{ op: "add", collection: "habits", record: { name, done: [] } }] }).then(load);
});`,
});

const flaws: Flaw[] = ["none", "countsTwice", "neverResets", "ignoresClock", "notSaved"];
let host: SandboxHost;

test.beforeAll(async () => {
  host = await startSandboxHost(Object.fromEntries(flaws.map((flaw) => [flaw, tracker(flaw)])));
});
test.afterAll(() => host.close());

type Result = { outcome: string; check?: string; reason?: string };

/** Stages a tracker behind the smoke check and the items-over-time check; activation is refused. */
async function check(page: Page, flaw: Flaw, habits: string[] = []): Promise<Result> {
  await page.goto(host.url);
  await ready(page, "stageCandidate");
  return page.evaluate(
    async ({ mountId, habits }) => {
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
            habits: habits.map((name, i) => ({ id: `h-${i + 1}`, name, done: [] })),
          },
        },
        workspaceId: "00000000-0000-4000-8000-000000000000",
        expectedDataRevision: 0,
        activationToken: "00000000-0000-4000-8000-000000000001",
        checks: [w.smokeCheck(), w.profileCheck("items-over-time")],
        // Reached only when every check passed; refusing keeps the test off the server.
        activate: () =>
          Promise.resolve({ ok: false, reason: "stale", message: "Passed the checks." }),
      });
    },
    { mountId: flaw, habits },
  );
}

const PASSED = { outcome: "refused", reason: "stale", message: "Passed the checks." };

test("VER-03, RUN-07: a tracker counting days in a row by the host's clock, and saving them, passes the items-over-time check", async ({
  page,
}) => {
  expect(await check(page, "none")).toEqual(PASSED);
});

test("VER-03: so does one that already tracks other habits", async ({ page }) => {
  expect(await check(page, "none", ["Walk", "Read"])).toEqual(PASSED);
});

for (const [flaw, title, rule, words] of [
  [
    "countsTwice",
    "counts a day twice",
    "pressed again the same day, it stays done, counted once",
    /a streak of 1 after marking it done again the same day; observed 2/,
  ],
  [
    "neverResets",
    "never starts a streak again after a day missed",
    "a day missed before today shows 1",
    /a streak of 1 after marking it done with the day before missed; observed 3/,
  ],
  [
    "ignoresClock",
    "ignores the host's clock",
    "done yesterday too shows 2",
    /a streak of 2 after marking it done the next day too; observed 1/,
  ],
  [
    "notSaved",
    "doesn't save what it marks done",
    // Unsaved, yesterday's mark is gone the next day: the streak shows it.
    "done yesterday too shows 2",
    /a streak of 2 after marking it done the next day too; observed 1/,
  ],
] as const) {
  test(`VER-03, VER-07: a tracker that ${title} fails, saying what was expected and observed, by whose rule`, async ({
    page,
  }) => {
    const result = await check(page, flaw);
    expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
    expect(result.reason).toContain("The items-over-time check, a rule of Tessera's");
    expect(result.reason).toContain(rule);
    expect(result.reason).toMatch(words);
  });
}
