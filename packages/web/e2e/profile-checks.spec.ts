import { expect, test, type Page } from "@playwright/test";
import type { Artifact } from "../../contracts/src/index.ts";
import { startSandboxHost, type SandboxHost } from "./support/sandbox-host.ts";
import { ready } from "./support/ready.ts";

// The item-list profile's behavior check (VER-03), in Chrome and Edge (TEST-06): in staging, after
// the smoke check, it adds an item, opens the tool again, removes it and opens it again, through
// the hooks the profile names, its saves going to a throwaway copy (BRG-06). A good list passes;
// each deliberately broken one fails, saying what was expected, what was observed and whose rule
// it is (VER-07), the M3 exit criterion for each profile.

type Flaw = "none" | "noAdd" | "addNotSaved" | "removeNotSaved" | "noRemoveHook" | "throwsOnAdd";

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
];
let host: SandboxHost;

test.beforeAll(async () => {
  host = await startSandboxHost(Object.fromEntries(flaws.map((flaw) => [flaw, list(flaw)])));
});
test.afterAll(() => host.close());

type Result = { outcome: string; check?: string; reason?: string };

/** Stages a list behind the smoke check and the item-list check; activation is refused. */
async function check(page: Page, flaw: Flaw): Promise<Result> {
  await page.goto(host.url);
  await ready(page, "stageCandidate");
  return page.evaluate(async (mountId) => {
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
        syntheticData: {
          items: [
            { id: "i-1", name: "Milk" },
            { id: "i-2", name: "Eggs" },
          ],
        },
      },
      workspaceId: "00000000-0000-4000-8000-000000000000",
      expectedDataRevision: 0,
      activationToken: "00000000-0000-4000-8000-000000000001",
      checks: [w.smokeCheck(), w.profileCheck("item-list")],
      // Reached only when every check passed; refusing keeps the test off the server.
      activate: () =>
        Promise.resolve({ ok: false, reason: "stale", message: "Passed the checks." }),
    });
  }, flaw);
}

test("VER-03: a list that adds, removes and keeps what it saved passes the item-list check", async ({
  page,
}) => {
  expect(await check(page, "none")).toEqual({
    outcome: "refused",
    reason: "stale",
    message: "Passed the checks.",
  });
});

test("VER-03, VER-07: a list that doesn't add fails, saying what was expected and observed, by whose rule", async ({
  page,
}) => {
  expect(await check(page, "noAdd")).toEqual({
    outcome: "check-failed",
    check: "behavior",
    reason:
      'The item-list check, a rule of Tessera\'s (Typing a name in item-name and pressing item-add adds one item with that name to the list, and saves it.): expected 3 items after adding "Tessera check item" to 2; observed 2.',
  });
});

test("VER-03: a list that adds without saving fails once opened again", async ({ page }) => {
  const result = await check(page, "addNotSaved");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toContain("(Opened again, the tool shows the list as it was saved.)");
  expect(result.reason).toContain(
    'expected 3 items, one showing "Tessera check item", after opening the tool again; observed 2, showing "Milk Remove", "Eggs Remove"',
  );
});

test("VER-03: a list whose removal isn't saved fails once opened again", async ({ page }) => {
  const result = await check(page, "removeNotSaved");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toContain(
    'expected 2 items, none showing "Tessera check item", after removing it and opening the tool again; observed 3',
  );
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
