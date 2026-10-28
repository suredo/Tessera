import { expect, test, type Page } from "@playwright/test";
import type { Edit, Intent } from "@tessera/contracts";
import { UNKNOWN_USAGE, type Provider } from "../../server/src/providers/index.ts";
import { listWorkspaces, workspaceVersions } from "../../server/src/workspaces/index.ts";
import {
  editFixture,
  noEdit,
  quantityEdit,
  styleEdit,
} from "../../server/test/fixtures/edit-tool.ts";
import { en } from "../src/i18n/en.ts";
import { startApp, type AppHost } from "./support/app-host.ts";

const intent = (kind: "create" | "edit", lookOnly = false): Intent => ({
  kind,
  interfacePart: null,
  dataPart: null,
  language: "en",
  features: [],
  targetsCurrentTool: true,
  behaviorChange: !lookOnly,
  lookOnly,
});
if (quantityEdit.files.mode !== "replace") throw new Error("Expected file fixture");
const quantityCode = quantityEdit.files.code;
const broken: Extract<Edit, { outcome: "edit" }> = {
  ...noEdit,
  summary: "Added a note field.",
  files: {
    mode: "replace",
    code: { ...quantityCode, html: '<h1>Shopping list</h1><ul id="items"></ul><input id="note">' },
  },
};
const fixed: Extract<Edit, { outcome: "edit" }> = {
  ...broken,
  files: {
    mode: "replace",
    code: {
      ...quantityCode,
      html: '<h1>Shopping list</h1><ul id="items"></ul><label for="note">Note</label><input id="note">',
    },
  },
};
const steps = [
  { stage: "intent", value: intent("create") },
  { stage: "create", value: editFixture },
  { stage: "intent", value: intent("edit", true) },
  { stage: "edit", value: styleEdit },
  { stage: "intent", value: intent("edit", true) },
  { stage: "edit", value: noEdit },
  { stage: "intent", value: intent("edit") },
  { stage: "edit", value: quantityEdit },
  { stage: "intent", value: intent("edit") },
  { stage: "edit", value: broken },
  { stage: "repair", value: broken },
  { stage: "intent", value: intent("edit") },
  { stage: "edit", value: broken },
  { stage: "repair", value: fixed },
];
const provider: Provider = {
  name: "scripted:edit-request",
  live: false,
  run(spec) {
    const step = steps.shift();
    if (step?.stage !== spec.stage) throw new Error(`Unexpected ${spec.stage} stage`);
    return Promise.resolve({
      value: spec.schema.parse(step.value),
      raw: JSON.stringify(step.value),
      usage: UNKNOWN_USAGE,
    });
  },
};
let app: AppHost;
test.beforeAll(async () => {
  app = await startApp(undefined, provider);
});
test.afterAll(() => app.close());
const frame = (page: Page) =>
  page.frameLocator(".tool-frame iframe").frameLocator("iframe").frameLocator("iframe");
const workspace = () => listWorkspaces(app.folder)[0]!;
const history = () => workspaceVersions(app.folder, workspace().id);
async function ask(page: Page, text: string) {
  await page.getByRole("textbox", { name: en["request.label"] }).fill(text);
  await page.getByRole("button", { name: en["request.send"] }).click();
}

test("GEN-05: create the tool and entries used by subsequent edits", async ({ page }) => {
  await page.goto(app.url);
  await ask(page, "A shopping list with milk and eggs");
  await expect(page.getByText("Shopping list is ready. A list of what to buy.")).toBeVisible({
    timeout: 30_000,
  });
  await expect(frame(page).getByRole("listitem")).toHaveText(["Milk", "Eggs"]);
});

test("GEN-13, DATA-10: edit the current tool's style, reload its version and keep its entries", async ({
  page,
}) => {
  await page.goto(app.url);
  const before = workspace();
  await ask(page, "Make it darker");
  await expect(page.getByText("Shopping list was updated. Made it darker.")).toBeVisible({
    timeout: 30_000,
  });
  await expect(frame(page).locator("body")).toHaveCSS("background-color", "rgb(17, 17, 17)");
  await expect(frame(page).getByRole("listitem")).toHaveText(["Milk", "Eggs"]);
  expect(workspace()).toMatchObject({ id: before.id, title: before.title, data: before.data });
  expect(history()).toHaveLength(2);
  expect(listWorkspaces(app.folder)).toHaveLength(1);
});

test("GEN-07, GEN-08: identical output adds no version and never claims an update", async ({
  page,
}) => {
  await page.goto(app.url);
  const before = workspace();
  await ask(page, "Keep it as it is");
  await expect(page.getByText(en["request.unchanged"])).toBeVisible({ timeout: 30_000 });
  expect(workspace()).toMatchObject({
    currentVersion: before.currentVersion,
    dataRevision: before.dataRevision,
    data: before.data,
  });
  expect(history()).toHaveLength(2);
});

test("GEN-07, DATA-03: add quantities through a migration and keep all original ids and values", async ({
  page,
}) => {
  await page.goto(app.url);
  await ask(page, "Add quantities");
  await expect(page.getByText("Shopping list was updated. Added quantities.")).toBeVisible({
    timeout: 30_000,
  });
  await expect(frame(page).getByRole("listitem")).toHaveText(["Milk: 1", "Eggs: 1"]);
  expect(workspace().data).toEqual({
    items: [
      { id: "i-1", title: "Milk", quantity: 1 },
      { id: "i-2", title: "Eggs", quantity: 1 },
    ],
  });
  expect(history()).toHaveLength(3);
});

test("GEN-09, GEN-08: a repeated smoke failure keeps the working tool and its data", async ({
  page,
}) => {
  await page.goto(app.url);
  const before = workspace();
  await ask(page, "Add a note field");
  await expect(page.getByText(en["request.editCheckFailed"])).toBeVisible({ timeout: 30_000 });
  await expect(frame(page).getByRole("listitem")).toHaveText(["Milk: 1", "Eggs: 1"]);
  expect(workspace()).toMatchObject({
    currentVersion: before.currentVersion,
    dataRevision: before.dataRevision,
    data: before.data,
  });
  expect(history()).toHaveLength(3);
});

test("GEN-09: a smoke-repaired edit stages again against defaults and activates without resetting entries", async ({
  page,
}) => {
  await page.goto(app.url);
  await ask(page, "Add a labelled note field");
  await expect(page.getByText("Shopping list was updated. Added a note field.")).toBeVisible({
    timeout: 30_000,
  });
  await expect(frame(page).getByRole("textbox", { name: "Note" })).toBeVisible();
  await expect(frame(page).getByRole("listitem")).toHaveText(["Milk: 1", "Eggs: 1"]);
  expect(history()).toHaveLength(4);
  expect(steps).toHaveLength(0);
});
