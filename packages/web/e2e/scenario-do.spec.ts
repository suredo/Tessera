// Docs: docs/code/evals/runner.md
// A scenario's do steps use the tool's own controls, as the person would (EVAL-01): the runner
// types into and clicks the elements the tool marks with its profile's hooks (VER-03), inside one
// item when the step names one, waits for the tool's save, and checks the step's host facts. The
// tool comes from scripted answers, so no model is called (EVAL-07); a step whose control isn't
// shown once fails in plain words. Chrome at 1280 px only: the runner starts its own Chrome.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Creation, Intent } from "../../contracts/src/index.ts";
import { getWorkspace, listWorkspaces } from "../../server/src/workspaces/index.ts";
import { scenarioSchema } from "../../../evals/src/scenarios/index.ts";
import { runScenario } from "../../../evals/src/runner/run.ts";
import { answersProvider } from "../../../evals/src/runner/script.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

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

/** A list that marks the item-list hooks and saves what it adds and removes. */
const list: Creation = {
  outcome: "tool",
  name: "Shopping list",
  summary: "A list of what to buy.",
  code: {
    // Two fields share the item-name hook, so a step finds one by its label; the item-list check
    // fills the first, the item's name.
    html: '<h1>Shopping list</h1><label for="name">Item</label> <input id="name" data-hook="item-name"> <label for="note">Note</label> <input id="note" data-hook="item-name"> <button data-hook="item-add">Add</button><ul id="items" aria-label="Items"></ul>',
    css: "",
    js: `let state;
const list = document.getElementById("items");
const render = () => list.replaceChildren(...state.data.items.map((record) => {
  const item = document.createElement("li");
  item.dataset.hook = "item";
  item.append(record.name + " ");
  const remove = document.createElement("button");
  remove.dataset.hook = "item-remove";
  remove.textContent = "Remove " + record.name;
  remove.addEventListener("click", () => {
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
  const name = document.getElementById("name").value.trim();
  // Eggs, the item this scenario adds, is saved a second and a half after the click, as a tool
  // that reads or waits first might, so the step must wait for that save, not just a quiet moment.
  // Any other name, such as the one staging's item-list check types, is saved at once, so the
  // check, which doesn't wait for timers, passes.
  const save = () => tessera.call("data.patch", { operations: [{ op: "add", collection: "items", record: { name } }] }).then(load);
  if (name) setTimeout(save, name === "Eggs" ? 1500 : 0);
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
};

const scenario = scenarioSchema.parse({
  id: "T90-list-controls",
  tier: "simple",
  language: "en",
  person: "Someone shopping",
  clock: { start: "2026-10-12T09:00:00", zone: "UTC" },
  budget: { calls: 5 },
  profiles: ["item-list"],
  steps: [
    { say: "A shopping list with milk", expect: { created: true } },
    // The field found by its label, as a person finds one field of a form.
    {
      do: { fill: "item-name", label: "Item", value: "Eggs" },
      expect: { version: "unchanged", data: "unchanged" },
    },
    { do: { click: "item-add" }, expect: { version: "unchanged", data: "changed" } },
    {
      do: { click: "item-remove", in: { hook: "item", text: "Milk" } },
      expect: { version: "unchanged", data: "changed" },
    },
    // Without a label, two fields share the hook: the step fails, saying how many.
    { do: { fill: "item-name", value: "Ham" } },
    // Nothing shows Bread, so there is nothing to press: the step fails, saying so.
    { do: { click: "item-remove", in: { hook: "item", text: "Bread" } } },
  ],
});

test("EVAL-01, VER-03: a scenario's do steps type into and click the tool's hooked controls, inside one item, and are checked by their host facts", async () => {
  const info = test.info();
  test.skip(info.project.name !== "chrome-1280", "The runner starts its own Chrome.");
  test.setTimeout(240_000);
  const provider = answersProvider(
    {
      about: "Answers written for this test: no model answered these.",
      scenario: scenario.id,
      answers: [
        { reply: { kind: "value", stage: "intent", value: intent } },
        { reply: { kind: "value", stage: "create", value: list } },
      ],
    },
    () => undefined,
  );
  let items: unknown;
  const report = await runScenario(scenario, {
    mode: "rehearsal",
    provider,
    folder: info.outputPath("scenario"),
    // A video only when asked, as for every browser test (A56).
    recordVideo: process.env["TESSERA_E2E_RECORD"] === "1",
    webRoot: path.resolve(here, "../dist"),
    misfits: () => provider.misfits(),
    onFinished: (store) => {
      const [workspace] = listWorkspaces(store);
      items = getWorkspace(store, workspace!.id)?.data?.["items"];
    },
  });
  expect(report.stopped).toBeFalsy();
  expect(report.steps.map((s) => [s.index, s.kind, s.outcome])).toEqual([
    [1, "say", "passed"],
    [2, "do", "passed"],
    [3, "do", "passed"],
    [4, "do", "passed"],
    [5, "do", "failed"],
    [6, "do", "failed"],
  ]);
  expect(report.steps[4]!.problems.join(" ")).toContain(
    "The tool shows 2 elements marked item-name; the step needs one.",
  );
  expect(report.steps[5]!.problems.join(" ")).toContain(
    'The tool shows 0 elements marked item with "Bread"; the step needs one.',
  );
  // The controls changed the person's own data: Eggs added, Milk removed.
  expect((items as { name: string }[]).map((item) => item.name)).toEqual(["Eggs"]);
});
