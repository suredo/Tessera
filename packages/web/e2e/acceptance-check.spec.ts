import { expect, test, type Page } from "@playwright/test";
import type { Acceptance, AcceptanceCheck, Artifact } from "../../contracts/src/index.ts";
import { startSandboxHost, type SandboxHost } from "./support/sandbox-host.ts";
import { ready } from "./support/ready.ts";

// Acceptance checks from the request (VER-09, an M3 experiment), in Chrome (TEST-06): in staging,
// after the smoke check, each check a request's stage wrote starts the candidate again, its saves
// going to a throwaway copy (BRG-06), takes its steps through the hooks it names and looks for
// what it expects. A tool that does what the checks say passes; each broken one fails, saying
// what was expected, what was observed, and that the rule is the request's (VER-07).

type Flaw = "none" | "ignoresAdd" | "addsTwice" | "noAddHook" | "keepsRemoved" | "noDuplicates";

/** A packing list, which fits no profile, using the hooks the checks below name. */
const list = (flaw: Flaw): Artifact["code"] => ({
  html: `<label for="name">Thing to pack</label> <input id="name" data-hook="thing-name">
<button ${flaw === "noAddHook" ? "" : 'data-hook="thing-add"'}>Add</button>
<ul></ul>`,
  css: "",
  js: `const flaw = ${JSON.stringify(flaw)};
let state;
const list = document.querySelector("ul");
const render = () => {
  list.replaceChildren(...state.data.things.map((thing) => {
    const item = document.createElement("li");
    item.dataset.hook = "thing";
    item.append(thing.name + " ");
    const remove = document.createElement("button");
    remove.dataset.hook = "thing-remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      if (flaw === "keepsRemoved") return;
      tessera
        .call("data.patch", { operations: [{ op: "remove", collection: "things", id: thing.id, revisionCount: state.revisions.things[thing.id] }] })
        .then(load);
    });
    item.append(remove);
    return item;
  }));
};
const load = () => tessera.call("data.read").then((read) => { state = read; render(); });
load();
document.querySelector("button").addEventListener("click", () => {
  if (flaw === "ignoresAdd") return;
  const name = document.querySelector("#name").value;
  // A good list may refuse a name it already has.
  if (flaw === "noDuplicates" && state.data.things.some((thing) => thing.name === name)) return;
  const add = { op: "add", collection: "things", record: { name } };
  tessera.call("data.patch", { operations: flaw === "addsTwice" ? [add, add] : [add] }).then(load);
});`,
});

const flaws: Flaw[] = [
  "none",
  "ignoresAdd",
  "addsTwice",
  "noAddHook",
  "keepsRemoved",
  "noDuplicates",
];
let host: SandboxHost;

test.beforeAll(async () => {
  host = await startSandboxHost(Object.fromEntries(flaws.map((flaw) => [flaw, list(flaw)])));
});
test.afterAll(() => host.close());

type Result = { outcome: string; check?: string; reason?: string };

/** What a request's stage might write for "a packing list I can add things to and tick off". */
const ACCEPTANCE: Acceptance = {
  outcome: "checks",
  hooks: [
    { name: "thing-name", says: "the field for a new thing's name" },
    { name: "thing-add", says: "the button that adds it" },
    { name: "thing", says: "each thing in the list" },
    { name: "thing-remove", says: "inside each thing, the button that removes it" },
  ],
  checks: [
    {
      says: "Adding sunscreen shows it in the list",
      steps: [
        { do: "fill", hook: "thing-name", value: "Sunscreen" },
        { do: "click", hook: "thing-add" },
      ],
      // Capitals and spaces aside, as a person reads it.
      expect: { see: "shows", hook: "thing", text: "sunscreen" },
    },
    {
      says: "Adding a thing makes the list one longer",
      steps: [
        { do: "fill", hook: "thing-name", value: "Hat" },
        { do: "click", hook: "thing-add" },
      ],
      expect: { see: "count-change", hook: "thing", changeCount: 1 },
    },
    {
      says: "Removing the passport takes it off the list",
      steps: [{ do: "click", hook: "thing-remove" }],
      expect: { see: "hides", hook: "thing", text: "Passport" },
    },
  ],
};

/** Stages a list behind the smoke check and the request's acceptance checks; activation is refused. */
async function check(
  page: Page,
  flaw: Flaw,
  acceptance: Acceptance = ACCEPTANCE,
  // The passport is first, so the first remove button takes it off.
  things: { id: string; name: string }[] = [
    { id: "t-1", name: "Passport" },
    { id: "t-2", name: "Charger" },
  ],
): Promise<Result> {
  await page.goto(host.url);
  await ready(page, "stageCandidate");
  return page.evaluate(
    async ({ mountId, acceptance, things }) => {
      const w = window as unknown as {
        stageCandidate(options: unknown): Promise<Result>;
        smokeCheck(): unknown;
        acceptanceChecks(acceptance: unknown): unknown[];
      };
      return w.stageCandidate({
        candidate: {
          mountId,
          hash: "a".repeat(64),
          capabilities: [],
          syntheticData: { things },
        },
        workspaceId: "00000000-0000-4000-8000-000000000000",
        expectedDataRevision: 0,
        activationToken: "00000000-0000-4000-8000-000000000001",
        // One staging check for each of the request's checks, each on fresh data.
        checks: [w.smokeCheck(), ...w.acceptanceChecks(acceptance)],
        // Reached only when every check passed; refusing keeps the test off the server.
        // It says which checks staging reported passed (VER-09), so the test can see them.
        activate: (request: { startChecked?: true; acceptanceChecked?: true }) =>
          Promise.resolve({
            ok: false,
            reason: "stale",
            message: `Passed the checks: start ${request.startChecked === true}, request ${request.acceptanceChecked === true}.`,
          }),
      });
    },
    { mountId: flaw, acceptance, things },
  );
}

// Staging reports the start check and the checks from the request as passed (VER-09).
const PASSED = {
  outcome: "refused",
  reason: "stale",
  message: "Passed the checks: start true, request true.",
};

test("VER-09: a tool that does what its request's checks say passes them, capitals and spaces aside", async ({
  page,
}) => {
  expect(await check(page, "none")).toEqual(PASSED);
});

test("VER-09, VER-07: a tool whose add does nothing fails, saying what was expected and what was shown", async ({
  page,
}) => {
  expect(await check(page, "ignoresAdd")).toEqual({
    outcome: "check-failed",
    check: "acceptance",
    reason:
      'A check from your request (Adding sunscreen shows it in the list): expected an element marked thing showing "sunscreen"; observed "Passport Remove", "Charger Remove".',
  });
});

test("VER-09: a count that changes by the wrong number fails, with the counts before and after", async ({
  page,
}) => {
  const result = await check(page, "addsTwice");
  expect(result).toMatchObject({ outcome: "check-failed", check: "acceptance" });
  expect(result.reason).toContain(
    "A check from your request (Adding a thing makes the list one longer)",
  );
  expect(result.reason).toMatch(/observed \d+ before and \d+ after, a change of 2\.$/);
});

test("VER-09: a hook the request's checks named and the tool lacks fails, naming it", async ({
  page,
}) => {
  const result = await check(page, "noAddHook");
  expect(result).toMatchObject({ outcome: "check-failed", check: "acceptance" });
  expect(result.reason).toContain(
    "expected the elements its hooks name, as the request's checks asked",
  );
  expect(result.reason).toContain('"thing-add"');
});

test("VER-09: a thing still shown after it was removed fails", async ({ page }) => {
  const result = await check(page, "keepsRemoved");
  expect(result).toMatchObject({ outcome: "check-failed", check: "acceptance" });
  expect(result.reason).toContain(
    'A check from your request (Removing the passport takes it off the list): expected no element marked thing showing "Passport"',
  );
});

test("VER-09: each check starts on fresh data, so one check's saves never fail the next", async ({
  page,
}) => {
  // Two checks that add the same name: a list that refuses a name it has passes both, as each
  // starts on the synthetic data again, not on what the other saved.
  const twice: Acceptance = {
    ...ACCEPTANCE,
    checks: [
      ACCEPTANCE.checks[0]!,
      { ...ACCEPTANCE.checks[0]!, expect: { see: "count-change", hook: "thing", changeCount: 1 } },
    ],
  };
  expect(await check(page, "noDuplicates", twice)).toEqual(PASSED);
});

test("VER-09: a text is looked for in every element shown and in its whole text, past a long list or a long text", async ({
  page,
}) => {
  // An added thing lands after a hundred others, past what one read gives.
  const hundred = Array.from({ length: 100 }, (_, i) => ({ id: `t-${i}`, name: `Thing ${i}` }));
  const shows: Acceptance = { ...ACCEPTANCE, checks: [ACCEPTANCE.checks[0]!] };
  expect(await check(page, "none", shows, hundred)).toEqual(PASSED);
  // A thing named past the first 200 characters is still seen when it stays after its remove.
  const long = [{ id: "t-1", name: `${"Very long label ".repeat(15)}Passport` }];
  const hides: Acceptance = { ...ACCEPTANCE, checks: [ACCEPTANCE.checks[2]!] };
  const kept = await check(page, "keepsRemoved", hides, long);
  expect(kept).toMatchObject({ outcome: "check-failed", check: "acceptance" });
  expect(kept.reason).toContain("observed it shown in the element at position 1 of 1");
  expect(await check(page, "none", hides, long)).toEqual(PASSED);
});

test("VER-09, L-93: a check whose text was shown before its steps proves nothing, so it neither fails the tool nor counts", async ({
  page,
}) => {
  // "Passport" is in the list before any step, so a list whose add does nothing still shows it.
  const before: AcceptanceCheck = {
    says: "Adding a thing shows the passport",
    steps: [
      { do: "fill", hook: "thing-name", value: "Hat" },
      { do: "click", hook: "thing-add" },
    ],
    expect: { see: "shows", hook: "thing", text: "Passport" },
  };
  const alone: Acceptance = { ...ACCEPTANCE, checks: [before] };
  expect(await check(page, "ignoresAdd", alone)).toEqual({
    ...PASSED,
    message: "Passed the checks: start true, request false.",
  });
  // Beside a check that proves something, the tool is checked against the request.
  const beside: Acceptance = { ...ACCEPTANCE, checks: [before, ACCEPTANCE.checks[0]!] };
  expect(await check(page, "none", beside)).toEqual(PASSED);
  // And it never hides a failure of a check that does prove something.
  const failing = await check(page, "ignoresAdd", beside);
  expect(failing).toMatchObject({ outcome: "check-failed", check: "acceptance" });
});
