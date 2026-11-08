import { expect, test, type Page } from "@playwright/test";
import type { Creation, Intent } from "../../contracts/src/index.ts";
import { RequestLedger } from "../../server/src/ledger/index.ts";
import { UNKNOWN_USAGE, type Provider, type StageSpec } from "../../server/src/providers/index.ts";
import { listWorkspaces } from "../../server/src/workspaces/index.ts";
import { en } from "../src/i18n/en.ts";
import { startApp, type AppHost, newestReply } from "./support/app-host.ts";

// A tool that fits a verification profile is checked for its behavior before it opens (VER-03),
// end to end (TEST-03): the request goes through the real pipeline to a scripted provider (ENG-11).
// The intent names the item-list profile, so the made list is told its hooks and rules, and after
// the smoke check, staging runs the item-list check. The first list adds an item without saving
// it, so the check fails once the list is opened again; the repair is told that rule, what was
// expected and what was observed (VER-07, GEN-09), and the repaired list opens. Nothing the check
// typed reaches the person's data (BRG-06). In Chrome and Edge at 320 and 1280 px (TEST-06), on
// a temporary data folder (ENG-19).

const intent: Intent = {
  kind: "create",
  interfacePart: null,
  dataPart: null,
  behaviorChange: false,
  lookOnly: false,
  targetsCurrentTool: false,
  language: "en",
  features: [],
  profile: "item-list",
};

/** A list with the item-list hooks; `saves` false keeps an added item only on screen. */
const list = (saves: boolean): Creation => ({
  outcome: "tool",
  name: "Shopping list",
  summary: "A list of what to buy.",
  code: {
    html: '<h1>Shopping list</h1><label for="name">Item</label> <input id="name" data-hook="item-name"> <button data-hook="item-add">Add</button><ul id="items" aria-label="Items"></ul>',
    css: "",
    js: `const saves = ${String(saves)};
let state;
const list = document.getElementById("items");
const render = () => list.replaceChildren(...state.data.items.map((record) => {
  const item = document.createElement("li");
  item.dataset.hook = "item";
  item.append(record.name + " ");
  const remove = document.createElement("button");
  remove.dataset.hook = "item-remove";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => {
    const { revisions } = state;
    const counts = revisions.items;
    tessera
      .call("data.patch", { operations: [{ op: "remove", collection: "items", id: record.id, revisionCount: counts[record.id] }] })
      .then(load);
  });
  item.append(remove);
  return item;
}));
const load = () => tessera.call("data.read").then((read) => { state = read; render(); });
load();
document.querySelector("[data-hook=item-add]").addEventListener("click", () => {
  const name = document.getElementById("name").value;
  if (!saves) {
    state.data.items.push({ id: "local", name });
    return render();
  }
  tessera.call("data.patch", { operations: [{ op: "add", collection: "items", record: { name } }] }).then(load);
});`,
  },
  data: {
    schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "name"],
            properties: { id: { type: "string" }, name: { type: "string" } },
          },
        },
      },
    },
    reusableDefaults: { items: [] },
    initialState: { items: [{ id: "i-1", name: "Milk" }] },
  },
  capabilities: [],
  uiMode: "standard",
});

const steps: { stage: string; value: unknown }[] = [
  { stage: "intent", value: intent },
  { stage: "create", value: list(false) },
  { stage: "repair", value: list(true) },
];
const calls: StageSpec<unknown>[] = [];
const provider: Provider = {
  name: "scripted:behavior-check",
  live: false,
  run(spec) {
    calls.push(spec);
    const step = steps.shift();
    if (step?.stage !== spec.stage) throw new Error(`No ${spec.stage} answer is scripted next.`);
    return Promise.resolve({
      value: spec.schema.parse(step.value),
      usage: UNKNOWN_USAGE,
      raw: JSON.stringify(step.value),
    });
  },
};

let app: AppHost;
test.beforeAll(async () => {
  app = await startApp(undefined, provider);
});
test.afterAll(() => app.close());

const toolText = (page: Page) =>
  page.frameLocator(".tool-frame iframe").frameLocator("iframe").frameLocator("iframe");

test("TEST-03, VER-03, GEN-09: a list that doesn't keep what it adds fails the item-list check before it opens, is repaired, and opens with only its starting data", async ({
  page,
}) => {
  await page.goto(app.url);
  await page.getByRole("textbox", { name: en["request.label"] }).fill("A shopping list with milk");
  await page.getByRole("button", { name: en["request.send"] }).click();
  await expect(newestReply(page)).toContainText("Shopping list is ready. A list of what to buy.", {
    timeout: 60_000,
  });
  await expect(toolText(page).getByRole("listitem")).toHaveText(["Milk Remove"]);

  // The made list was told the profile's hooks and rules, and the repair was told which rule
  // it broke, what was expected and what was observed.
  expect(calls.map((spec) => spec.stage)).toEqual(["intent", "create", "repair"]);
  expect(calls[1]!.system).toContain('data-hook="item-add"');
  expect(calls[2]!.prompt).toContain(
    'The item-list check, a rule of Tessera\'s (Opened again, the tool shows the list as it was saved.): expected 1 item, one showing "Tessera check item", after opening the tool again; observed 0',
  );
  expect(calls[2]!.promptParts?.some((part) => part.startsWith("repair-behavior@"))).toBe(true);
  // Only the starting data the host installed: nothing the check typed was saved.
  const [workspace] = listWorkspaces(app.folder);
  expect(workspace?.data).toEqual({ items: [{ id: "i-1", name: "Milk" }] });
  // The ledger keeps why the repair happened (GEN-10).
  const [request] = new RequestLedger(app.folder).forWorkspace(workspace!.id);
  const repair = request?.calls.find((call) => call.stage === "repair");
  expect(repair?.diagnostics.join("\n")).toContain("The item-list check");
});
