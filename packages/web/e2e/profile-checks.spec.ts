import { expect, test, type Page } from "@playwright/test";
import type { Artifact } from "../../contracts/src/index.ts";
import { startSandboxHost, type SandboxHost } from "./support/sandbox-host.ts";
import { ready } from "./support/ready.ts";

// The item-list profile's behavior check (VER-03), in Chrome and Edge (TEST-06): in staging, after
// the smoke check, it adds an item, opens the tool again, removes it and opens it again, through
// the hooks the profile names, its saves going to a throwaway copy (BRG-06). A good list passes;
// each deliberately broken one fails, saying what was expected, what was observed and whose rule
// it is (VER-07), the M3 exit criterion for each profile.

type Flaw =
  | "none"
  | "noAdd"
  | "addNotSaved"
  | "removeNotSaved"
  | "noRemoveHook"
  | "throwsOnAdd"
  | "renamesOthers";

/** A list that fits the item-list profile, with `flaw` built in. */
const list = (flaw: Flaw): Artifact["code"] => ({
  html: '<label for="name">Item</label> <input id="name" data-hook="item-name"> <button data-hook="item-add">Add</button><ul></ul>',
  css: "",
  js: `const flaw = ${JSON.stringify(flaw)};
let state;
const list = document.querySelector("ul");
const render = () => list.replaceChildren(...state.data.items.map((record) => {
  const item = document.createElement("li");
  item.dataset.hook = "item";
  item.append(record.name + " ");
  const remove = document.createElement("button");
  if (flaw !== "noRemoveHook") remove.dataset.hook = "item-remove";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => {
    if (flaw === "removeNotSaved") {
      state.data.items = state.data.items.filter((other) => other.id !== record.id);
      return render();
    }
    tessera
      .call("data.patch", { operations: [{ op: "remove", collection: "items", id: record.id, revisionCount: state.revisions.items[record.id] }] })
      .then(load);
  });
  item.append(remove);
  return item;
}));
const load = () => tessera.call("data.read").then((read) => { state = read; render(); });
load();
document.querySelector("[data-hook=item-add]").addEventListener("click", () => {
  const name = document.querySelector("[data-hook=item-name]").value;
  if (flaw === "noAdd") return;
  if (flaw === "throwsOnAdd") throw new Error("adding broke");
  // Adding renames every other item too, keeping the count right.
  if (flaw === "renamesOthers") {
    const renames = state.data.items.map((record) => ({ op: "replace", collection: "items", id: record.id, revisionCount: state.revisions.items[record.id], fields: { name: "Changed" } }));
    return tessera.call("data.patch", { operations: [...renames, { op: "add", collection: "items", record: { name } }] }).then(load);
  }
  if (flaw === "addNotSaved") {
    state.data.items.push({ id: "local", name });
    return render();
  }
  tessera.call("data.patch", { operations: [{ op: "add", collection: "items", record: { name } }] }).then(load);
});`,
});

const flaws: Flaw[] = [
  "none",
  "noAdd",
  "addNotSaved",
  "removeNotSaved",
  "noRemoveHook",
  "throwsOnAdd",
  "renamesOthers",
];
let host: SandboxHost;

test.beforeAll(async () => {
  host = await startSandboxHost(Object.fromEntries(flaws.map((flaw) => [flaw, list(flaw)])));
});
test.afterAll(() => host.close());

type Result = { outcome: string; check?: string; reason?: string };

/** Stages a list behind the smoke check and the item-list check; activation is refused. */
async function check(page: Page, flaw: Flaw, names: string[] = ["Milk", "Eggs"]): Promise<Result> {
  await page.goto(host.url);
  await ready(page, "stageCandidate");
  return page.evaluate(
    async ({ mountId, names }) => {
      const w = window as unknown as {
        stageCandidate(options: unknown): Promise<Result>;
        smokeCheck(): unknown;
        profileCheck(id: string): unknown;
      };
      return w.stageCandidate({
        candidate: {
          mountId,
          hash: "a".repeat(64),
          capabilities: [],
          syntheticData: { items: names.map((name, i) => ({ id: `i-${i + 1}`, name })) },
        },
        workspaceId: "00000000-0000-4000-8000-000000000000",
        expectedDataRevision: 0,
        activationToken: "00000000-0000-4000-8000-000000000001",
        checks: [w.smokeCheck(), w.profileCheck("item-list")],
        // Reached only when every check passed; refusing keeps the test off the server.
        activate: () =>
          Promise.resolve({ ok: false, reason: "stale", message: "Passed the checks." }),
      });
    },
    { mountId: flaw, names },
  );
}

const PASSED = { outcome: "refused", reason: "stale", message: "Passed the checks." };

test("VER-03: a list that adds, removes and keeps what it saved passes the item-list check", async ({
  page,
}) => {
  expect(await check(page, "none")).toEqual(PASSED);
});

test("VER-03: it still passes when a starting item already shows the check's name, or the list is longer than a read reports", async ({
  page,
}) => {
  expect(await check(page, "none", ["Tessera check item", "Eggs"])).toEqual(PASSED);
  const long = Array.from({ length: 105 }, (_, i) => `Item ${i + 1}`);
  expect(await check(page, "none", long)).toEqual(PASSED);
});

test("VER-03, VER-07: a list that doesn't add fails, saying what was expected and observed, by whose rule", async ({
  page,
}) => {
  const result = await check(page, "noAdd");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toMatch(
    /^The item-list check, a rule of Tessera's \(Typing a name in item-name and pressing item-add adds one item with that name to the list, and saves it\.\): expected 3 items after adding "Tessera check item [0-9a-f]{6}" to 2; observed 2\.$/,
  );
});

test("VER-03: a list that adds without saving fails once opened again", async ({ page }) => {
  const result = await check(page, "addNotSaved");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toContain("(Opened again, the tool shows the list as it was saved.)");
  expect(result.reason).toContain('observed 2 items, showing "Milk Remove", "Eggs Remove"');
});

test("VER-03: a list whose removal isn't saved fails once opened again", async ({ page }) => {
  const result = await check(page, "removeNotSaved");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toContain('after removing "Tessera check item');
  expect(result.reason).toContain("and opening the tool again; observed 3 items");
});

test("VER-03: a list that changes the other items as it adds fails, though every count is right", async ({
  page,
}) => {
  const result = await check(page, "renamesOthers");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toContain("expected the 2 items it started with, as they were");
  expect(result.reason).toContain('observed 2 items, showing "Changed Remove", "Changed Remove"');
});

test("VER-03, VER-04: a list missing a hook the prompt asked for fails, naming it", async ({
  page,
}) => {
  const result = await check(page, "noRemoveHook");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toContain('observed Nothing has the hook "item-remove".');
});

test("VER-03: an error while the check drives the list fails it", async ({ page }) => {
  const result = await check(page, "throwsOnAdd");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toContain(
    "expected no errors; observed An error: Uncaught Error: adding broke",
  );
});
