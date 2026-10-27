import { expect, test, type Page } from "@playwright/test";
import type { Creation, Intent } from "../../contracts/src/index.ts";
import { UNKNOWN_USAGE, type Provider } from "../../server/src/providers/index.ts";
import { listWorkspaces, saveTool } from "../../server/src/workspaces/index.ts";
import { en } from "../src/i18n/en.ts";
import { startApp, type AppHost } from "./support/app-host.ts";

// A request through the real pipeline, end to end (TEST-03, GEN-01): the person types what they
// need, the server runs the intent and create stages, the app stages the candidate behind the
// smoke check and the server activates it, and the tool opens with the request's entries. The
// model's answers come from a script chosen by test configuration (ENG-11). In Chrome and Edge at
// 320 and 1280 px (TEST-06), on a temporary data folder (ENG-19). The tests run in order, each
// taking the next answers from the script.

const intent = (kind: Intent["kind"]): Intent =>
  ({
    kind,
    interfacePart: null,
    dataPart: null,
    behaviorChange: false,
    lookOnly: false,
    targetsCurrentTool: false,
    language: "en",
    features: [],
  }) as Intent;

const shoppingList: Creation = {
  outcome: "tool",
  name: "Shopping list",
  summary: "A list of what to buy.",
  code: {
    html: '<h1>Shopping list</h1><ul id="items" aria-label="Items"></ul>',
    css: "",
    js: `tessera.call("data.read").then(({ data }) => {
  for (const item of data.items) {
    const row = document.createElement("li");
    row.textContent = item.title;
    document.getElementById("items").append(row);
  }
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
            required: ["id", "title"],
            properties: { id: { type: "string" }, title: { type: "string" } },
          },
        },
      },
    },
    reusableDefaults: { items: [] },
    initialState: {
      items: [
        { id: "i-1", title: "Milk" },
        { id: "i-2", title: "Eggs" },
      ],
    },
  },
  capabilities: [],
  uiMode: "standard",
};

/**
 * Answers in order, as the scripted provider does (ENG-11), but a step can take its time, and its
 * answer can be made when it is asked for, such as one naming a saved tool the test made.
 */
type Step = { stage: string; value: unknown; delayMs?: number };
const steps: Step[] = [
  // 1. A shopping list, made, staged, activated.
  { stage: "intent", value: intent("create") },
  { stage: "create", value: shoppingList },
  // 2. A request too vague to act on.
  { stage: "intent", value: intent("clarify") },
  // 3. A tool that fails the static check: nothing is made.
  { stage: "intent", value: intent("new_tool") },
  {
    stage: "create",
    value: { ...shoppingList, code: { ...shoppingList.code, html: '<iframe src="x"></iframe>' } },
  },
  // 4. A slow request, while the person goes elsewhere and comes back.
  { stage: "intent", value: intent("clarify"), delayMs: 4000 },
  // 5 and 6. A request that matches a saved tool, twice.
  { stage: "intent", value: () => ({ ...intent("open_saved"), savedToolId }) },
  { stage: "intent", value: () => ({ ...intent("open_saved"), savedToolId }) },
];
let savedToolId = "";
const provider: Provider = {
  name: "scripted:request",
  live: false,
  async run(spec) {
    const step = steps.shift();
    if (step?.stage !== spec.stage) throw new Error(`No ${spec.stage} answer is scripted next.`);
    if (step.delayMs) await new Promise((done) => setTimeout(done, step.delayMs));
    const value = typeof step.value === "function" ? (step.value as () => unknown)() : step.value;
    return { value: spec.schema.parse(value), usage: UNKNOWN_USAGE, raw: JSON.stringify(value) };
  },
};

let app: AppHost;
test.beforeAll(async () => {
  app = await startApp(undefined, provider);
});
test.afterAll(() => app.close());

const toolText = (page: Page) =>
  page.frameLocator(".tool-frame iframe").frameLocator("iframe").frameLocator("iframe");

async function ask(page: Page, request: string) {
  await page.getByRole("textbox", { name: en["request.label"] }).fill(request);
  await page.getByRole("button", { name: en["request.send"] }).click();
}

test("TEST-03, GEN-05: a request becomes a running tool, staged and activated, holding the request's entries", async ({
  page,
}) => {
  await page.goto(app.url);
  await ask(page, "I need a shopping list with milk and eggs");
  await expect(page.getByText("Shopping list is ready. A list of what to buy.")).toBeVisible({
    timeout: 30_000,
  });
  await expect(toolText(page).getByRole("listitem")).toHaveText(["Milk", "Eggs"]);
  expect(listWorkspaces(app.folder).map((w) => w.title)).toEqual(["Shopping list"]);
});

test("GEN-08: an unclear request is answered in plain words, and nothing is made", async ({
  page,
}) => {
  await page.goto(app.url);
  await ask(page, "Do the thing");
  await expect(page.getByText(en["request.clarify"])).toBeVisible({ timeout: 30_000 });
  expect(listWorkspaces(app.folder)).toHaveLength(1);
});

test("GEN-09, GEN-08: a tool that fails its checks is never called ready, and nothing is made", async ({
  page,
}) => {
  await page.goto(app.url);
  await ask(page, "A page that shows a website");
  await expect(
    page.getByText(
      "That didn't work. The tool Tessera made didn't pass its checks, so nothing was changed.",
    ),
  ).toBeVisible({ timeout: 30_000 });
  expect(listWorkspaces(app.folder)).toHaveLength(1);
});

test("GEN-01: a request keeps running when the person goes elsewhere, and no second one starts meanwhile", async ({
  page,
}) => {
  await page.goto(app.url);
  await ask(page, "Something slow");
  await page.getByRole("button", { name: en["nav.library"], exact: true }).click();
  await page.getByRole("button", { name: en["nav.workspaces"], exact: true }).click();
  // Back on the workspace: still running, so the box takes no other request.
  await expect(page.getByRole("textbox", { name: en["request.label"] })).toBeDisabled();
  await expect(page.getByText(en["request.working"])).toBeVisible();
  await expect(page.getByText(en["request.clarify"])).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("textbox", { name: en["request.label"] })).toBeEnabled();
});

test("GEN-18: a request matching a saved tool offers Continue or Use again, and opens nothing until the person chooses", async ({
  page,
}) => {
  const workspace = listWorkspaces(app.folder)[0]!;
  savedToolId = saveTool(app.folder, workspace.id, "Weekly shop").id;
  await page.goto(app.url);
  const before = listWorkspaces(app.folder).length;

  await ask(page, "My weekly shop");
  await expect(page.getByText(/^That sounds like your saved tool Weekly shop\./)).toBeVisible({
    timeout: 30_000,
  });
  expect(listWorkspaces(app.folder)).toHaveLength(before);
  await page.getByRole("button", { name: "Use Weekly shop again" }).click();
  await expect(
    page.getByText("Weekly shop opened in a new workspace, with its starting data."),
  ).toBeVisible();
  expect(listWorkspaces(app.folder)).toHaveLength(before + 1);

  await ask(page, "My weekly shop");
  await page.getByRole("button", { name: "Continue Weekly shop" }).click();
  await expect(page.getByText("Weekly shop is open again.")).toBeVisible();
  expect(listWorkspaces(app.folder)).toHaveLength(before + 1);
});
