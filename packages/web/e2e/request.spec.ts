import { expect, test, type Page } from "@playwright/test";
import type { Creation, Intent } from "../../contracts/src/index.ts";
import { UNKNOWN_USAGE, type Provider } from "../../server/src/providers/index.ts";
import { listWorkspaces, saveTool } from "../../server/src/workspaces/index.ts";
import { en } from "../src/i18n/en.ts";
import { startApp, type AppHost, newestReply } from "./support/app-host.ts";

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
  // 3. A tool that fails the static check, and again after its repair: nothing is made.
  { stage: "intent", value: intent("new_tool") },
  {
    stage: "create",
    value: { ...shoppingList, code: { ...shoppingList.code, html: '<iframe src="x"></iframe>' } },
  },
  {
    stage: "repair",
    value: { ...shoppingList, code: { ...shoppingList.code, html: '<iframe src="y"></iframe>' } },
  },
  // 4. A slow request, while the person goes elsewhere and comes back.
  { stage: "intent", value: intent("clarify"), delayMs: 4000 },
  // 5 and 6. A request that matches a saved tool, twice.
  { stage: "intent", value: () => ({ ...intent("open_saved"), savedToolId }) },
  { stage: "intent", value: () => ({ ...intent("open_saved"), savedToolId }) },
  // 7. A static-safe tool fails smoke; its repair preserves the request's entries.
  { stage: "intent", value: intent("new_tool") },
  {
    stage: "create",
    value: {
      ...shoppingList,
      code: { ...shoppingList.code, html: '<h1>Shopping list</h1><ul id="items"></ul><input>' },
    },
  },
  { stage: "repair", value: { ...shoppingList, data: { ...shoppingList.data, initialState: {} } } },
  // 8. Another smoke failure after the one repair never activates.
  { stage: "intent", value: intent("new_tool") },
  {
    stage: "create",
    value: {
      ...shoppingList,
      code: { ...shoppingList.code, html: '<h1>Shopping list</h1><ul id="items"></ul><input>' },
    },
  },
  {
    stage: "repair",
    value: {
      ...shoppingList,
      code: { ...shoppingList.code, html: '<h1>Shopping list</h1><ul id="items"></ul><input>' },
    },
  },
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

test("TEST-03, GEN-05, APP-05: a request becomes a running tool, staged and activated, holding the request's entries, and its version keeps its summary and checks", async ({
  page,
}) => {
  await page.goto(app.url);
  await ask(page, "I need a shopping list with milk and eggs");
  await expect(newestReply(page)).toContainText("Shopping list is ready. A list of what to buy.", {
    timeout: 30_000,
  });
  await expect(toolText(page).getByRole("listitem")).toHaveText(["Milk", "Eggs"]);
  expect(listWorkspaces(app.folder).map((w) => w.title)).toEqual(["Shopping list"]);
  // The version keeps what it was made for and the checks it passed, in its history (APP-05).
  const history = page.getByRole("region", { name: en["history.heading"] });
  await expect(history).toContainText("A list of what to buy.");
  await expect(history).toContainText(en["history.checkedBoth"]);
});

test("GEN-08: an unclear request is answered in plain words, and nothing is made", async ({
  page,
}) => {
  await page.goto(app.url);
  await ask(page, "Do the thing");
  await expect(newestReply(page)).toContainText(en["request.clarify"], { timeout: 30_000 });
  expect(listWorkspaces(app.folder)).toHaveLength(1);
});

test("GEN-09, GEN-08, GEN-10: a tool that fails its checks, even after its repair, is never called ready, nothing is made, and the details keep why", async ({
  page,
}) => {
  await page.goto(app.url);
  // Details opened before asking load again when the request settles, though it changed nothing.
  const details = page.getByRole("region", { name: en["details.heading"] });
  await details.getByRole("button", { name: en["details.show"] }).click();
  await expect(details).toContainText(en["details.unattachedHeading"]);
  const unattached = details.locator(".details-requests").last().locator(":scope > li");
  const before = await unattached.count();
  await ask(page, "A page that shows a website");
  await expect(newestReply(page)).toContainText(
    "That didn't work. The tool Tessera made didn't pass its checks, so nothing was changed.",
    { timeout: 30_000 },
  );
  expect(listWorkspaces(app.folder)).toHaveLength(1);
  // The failed creation made no workspace, and its reasons are still there to see (GEN-10).
  await expect(unattached).toHaveCount(before + 1);
  const failed = unattached.first();
  await expect(failed).toContainText(en["details.ended.failed"]);
  await expect(failed).toContainText(en["details.findings"]);
  await expect(failed.getByRole("rowheader").allTextContents()).resolves.toEqual([
    en["details.stage.intent"],
    en["details.stage.create"],
    en["details.stage.repair"],
  ]);
  await expect(failed).toContainText("Asked to fix:");
});

test("GEN-01, GEN-16, UX-02, APP-10: a request keeps running when the person goes elsewhere, shows its stage and time, and no second one starts meanwhile", async ({
  page,
}) => {
  await page.goto(app.url);
  await ask(page, "Something slow");
  await page.getByRole("button", { name: en["nav.library"], exact: true }).click();
  await page.getByRole("button", { name: en["nav.workspaces"], exact: true }).click();
  // Back on the workspace: still running, so the box takes no other request.
  await expect(page.getByRole("textbox", { name: en["request.label"] })).toBeDisabled();
  // The stage it is in, announced as the status, and the seconds since it was sent (GEN-16).
  const box = page.locator(".request");
  await expect(box.getByRole("status")).toHaveText(en["request.stage.intent"]);
  await expect(box.locator(".request-elapsed")).toHaveText(/^[1-9]\d* s$/);
  await expect(newestReply(page)).toContainText(en["request.clarify"], { timeout: 30_000 });
  await expect(box.getByRole("status")).toHaveText("");
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
  await expect(newestReply(page)).toContainText(/^That sounds like your saved tool Weekly shop\./, {
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

test("GEN-09, GEN-05, APP-09, UX-06: a smoke failure gets one repair, staged again, without losing or duplicating starting entries, and the details view keeps why", async ({
  page,
}) => {
  await page.goto(app.url);
  const before = listWorkspaces(app.folder).length;
  await ask(page, "A new shopping list with milk and eggs");
  await expect(newestReply(page)).toContainText("Shopping list is ready. A list of what to buy.", {
    timeout: 30_000,
  });
  await expect(toolText(page).getByRole("listitem")).toHaveText(["Milk", "Eggs"]);
  expect(listWorkspaces(app.folder)).toHaveLength(before + 1);
  // The details view, closed until asked for, keeps what the person's message leaves out: the
  // repair after the smoke check, with what it was asked to fix, then the request that made it,
  // and usage nobody reported as unknown, never 0 (APP-09, UX-06, OBS-01, GEN-10, CLI-04).
  const details = page.getByRole("region", { name: en["details.heading"] });
  await expect(details.getByRole("table")).toHaveCount(0);
  await details.getByRole("button", { name: en["details.show"] }).click();
  // The workspace's own requests come first; requests that made no tool follow in their own list.
  const requests = details.locator(".details-requests").first().locator(":scope > li");
  await expect(requests).toHaveCount(2);
  await expect(requests.nth(0)).toContainText(en["details.kind.repair"]);
  await expect(requests.nth(0).getByRole("row").nth(1)).toContainText(en["details.stage.repair"]);
  await expect(requests.nth(0)).toContainText("Asked to fix:");
  await expect(requests.nth(1)).toContainText(en["details.kind.generate"]);
  await expect(requests.nth(1).getByRole("rowheader").allTextContents()).resolves.toEqual([
    en["details.stage.intent"],
    en["details.stage.create"],
  ]);
  await expect(requests.nth(1)).toContainText(en["details.ended.candidate"]);
  await expect(requests.nth(1).getByRole("row").nth(1)).toContainText(en["details.unknown"]);
  // The tool's own code, by its part's control: a call's code shows the same part names (GEN-10).
  const html = details.locator("summary", { hasText: en["details.source.html"] });
  await html.click();
  await expect(html.locator("xpath=..").locator("pre code")).toContainText(
    "<h1>Shopping list</h1>",
  );
  await details.getByRole("button", { name: en["details.hide"] }).click();
  await expect(details.locator(".details-requests")).toHaveCount(0);
});

test("GEN-09, GEN-08: a repeated smoke failure is never activated or called ready", async ({
  page,
}) => {
  await page.goto(app.url);
  await ask(page, "Another shopping list");
  await expect(newestReply(page)).toContainText(en["request.checkFailed"], { timeout: 30_000 });
  expect(listWorkspaces(app.folder).filter((w) => w.currentVersion === null)).toHaveLength(1);
  expect(steps).toHaveLength(0);
});
