import { expect, test, type Page } from "@playwright/test";
import type { Edit, Intent } from "@tessera/contracts";
import { ProviderError, UNKNOWN_USAGE, type Provider } from "../../server/src/providers/index.ts";
import { listWorkspaces, workspaceVersions } from "../../server/src/workspaces/index.ts";
import { editFixture, noEdit, styleEdit } from "../../server/test/fixtures/edit-tool.ts";
import { en } from "../src/i18n/en.ts";
import { startApp, type AppHost } from "./support/app-host.ts";

test.describe.configure({ mode: "serial" });
const mixed = (interfacePart: string, dataPart: string): Intent => ({
  kind: "mixed",
  interfacePart,
  dataPart,
  language: "en",
  features: [],
  targetsCurrentTool: true,
  behaviorChange: false,
  lookOnly: false,
});
if (styleEdit.files.mode !== "replace") throw new Error("Expected fixture");
const blue: Extract<Edit, { outcome: "edit" }> = {
  ...styleEdit,
  summary: "Made it blue.",
  files: {
    mode: "replace",
    code: { ...styleEdit.files.code, css: "body{background:#ddeeff;color:#111}" },
  },
};
const broken: Extract<Edit, { outcome: "edit" }> = {
  ...styleEdit,
  files: {
    mode: "replace",
    code: {
      ...styleEdit.files.code,
      html: '<h1>Shopping list</h1><ul id="items"></ul><input id="note">',
    },
  },
};
const patch = (operation: unknown) => ({
  outcome: "patch",
  summary: "Prepared entry changes.",
  patch: { operations: [operation] },
});
let breadId = "";
let dataBegan = false;
let releaseData: () => void = () => {};
type Step = {
  stage: "intent" | "create" | "edit" | "data" | "repair";
  value?: unknown;
  getValue?: () => unknown;
  defer?: boolean;
  error?: ProviderError;
};
const steps: Step[] = [
  {
    stage: "intent",
    value: { ...mixed("", ""), kind: "create", interfacePart: null, dataPart: null },
  },
  { stage: "create", value: editFixture },
  { stage: "intent", value: mixed("Make it dark", "Add Bread") },
  { stage: "edit", value: styleEdit },
  {
    stage: "data",
    value: patch({ op: "add", collection: "items", record: { title: "Bread" } }),
    defer: true,
  },
  { stage: "intent", value: mixed("Keep it dark", "Rename Bread to Rye") },
  { stage: "edit", value: noEdit },
  {
    stage: "data",
    getValue: () =>
      patch({
        op: "replace",
        collection: "items",
        id: breadId,
        revisionCount: 999,
        fields: { title: "Rye" },
      }),
  },
  { stage: "intent", value: mixed("Make it blue", "Add Cheese") },
  { stage: "edit", value: blue },
  {
    stage: "data",
    error: new ProviderError("usage_limit", "Claude Code's usage limit was reached."),
  },
  { stage: "intent", value: mixed("Make it dark", "Add Cheese") },
  { stage: "edit", value: broken },
  { stage: "repair", value: broken },
];
const provider: Provider = {
  name: "scripted:mixed-request",
  live: false,
  async run(spec) {
    const step = steps.shift();
    if (step?.stage !== spec.stage) throw new Error(`Unexpected ${spec.stage}`);
    if (step.defer) {
      dataBegan = true;
      await new Promise<void>((resolve) => {
        releaseData = resolve;
      });
    }
    if (step.error) throw step.error;
    const value = step.getValue ? step.getValue() : step.value;
    return { value: spec.schema.parse(value), raw: JSON.stringify(value), usage: UNKNOWN_USAGE };
  },
};
let app: AppHost;
test.beforeAll(async () => {
  app = await startApp(undefined, provider);
});
test.afterAll(() => {
  releaseData();
  return app.close();
});
const frame = (page: Page) =>
  page.frameLocator(".tool-frame iframe").frameLocator("iframe").frameLocator("iframe");
const workspace = () => listWorkspaces(app.folder)[0]!;
async function send(page: Page, text: string) {
  await page.getByRole("textbox", { name: en["request.label"] }).fill(text);
  await page.getByRole("button", { name: en["request.send"] }).click();
}
async function finished(page: Page) {
  await expect(page.getByRole("textbox", { name: en["request.label"] })).toBeEnabled({
    timeout: 30_000,
  });
}

test("GEN-05: create the starting workspace for mixed requests", async ({ page }) => {
  await page.goto(app.url);
  await send(page, "A shopping list with milk and eggs");
  await finished(page);
  await expect(frame(page).getByRole("listitem")).toHaveText(["Milk", "Eggs"]);
});
test("GEN-04 DATA-02: activate and display the edited interface before its separate data plan finishes", async ({
  page,
}) => {
  await page.goto(app.url);
  const before = workspace();
  await send(page, "Make it dark and Add Bread");
  try {
    // Data planning starts only after generation, staging, smoke and activation finish.
    await expect.poll(() => dataBegan, { timeout: 30_000 }).toBe(true);
    await expect(page.getByRole("button", { name: en["tool.minimize"] })).toBeVisible();
    await expect(frame(page).locator("body")).toHaveCSS("background-color", "rgb(17, 17, 17)");
    await expect(frame(page).getByRole("listitem")).toHaveText(["Milk", "Eggs"]);
    expect(workspace().data).toEqual(before.data);
    expect(workspace().currentVersion).not.toBe(before.currentVersion);
  } finally {
    releaseData();
  }
  await finished(page);
  await expect(page.locator(".notice [role=status]").first()).toContainText(
    "Shopping list was updated.",
  );
  await expect(page.locator(".notice [role=status]").first()).toContainText("Changed one entry");
  await expect(page.getByRole("button", { name: en["tool.minimize"] })).toBeVisible();
  await expect(frame(page).getByRole("listitem")).toHaveText(["Milk", "Eggs", "Bread"]);
  const items = workspace().data?.["items"];
  if (!Array.isArray(items)) throw new Error("Expected entries");
  const bread = items.find(
    (entry) =>
      entry !== null &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      entry["title"] === "Bread",
  );
  if (
    !bread ||
    typeof bread !== "object" ||
    Array.isArray(bread) ||
    typeof bread["id"] !== "string"
  )
    throw new Error("Expected host ID");
  breadId = bread["id"];
  expect(workspaceVersions(app.folder, before.id)).toHaveLength(2);
});
test("GEN-04 GEN-08: an unchanged interface still offers data review, and cancellation retains both facts", async ({
  page,
}) => {
  await page.goto(app.url);
  const before = workspace();
  await send(page, "Keep it dark and Rename Bread to Rye");
  await finished(page);
  await expect(page.getByRole("region", { name: en["request.dataReview"] })).toContainText("Rye");
  await expect(page.locator(".notice [role=status]").first()).toContainText(
    "The tool wasn't changed.",
  );
  expect(workspace()).toEqual(before);
  await page.getByRole("button", { name: en["request.reviewCancel"] }).click();
  await expect(page.locator(".notice [role=status]").first()).toContainText(
    "The tool wasn't changed. The proposed changes were cancelled.",
  );
  expect(workspace()).toEqual(before);
});
test("GEN-04 GEN-08: failed data planning keeps the activated interface and says only its entries were not applied", async ({
  page,
}) => {
  await page.goto(app.url);
  const before = workspace();
  await send(page, "Make it blue and Add Cheese");
  await finished(page);
  await expect(page.locator(".notice [role=status]").first()).toContainText(
    "Shopping list was updated. Made it blue.",
  );
  await expect(page.locator(".notice [role=status]").first()).toContainText(
    "The entry changes weren't applied.",
  );
  await expect(frame(page).locator("body")).toHaveCSS("background-color", "rgb(221, 238, 255)");
  expect(workspace().data).toEqual(before.data);
  expect(workspaceVersions(app.folder, before.id)).toHaveLength(3);
});
test("GEN-04 GEN-09: a repeated interface smoke failure never starts its pending data plan", async ({
  page,
}) => {
  await page.goto(app.url);
  const before = workspace();
  await send(page, "Make it dark and Add Cheese");
  await finished(page);
  await expect(page.getByText(en["request.editCheckFailed"])).toBeVisible();
  expect(workspace()).toEqual(before);
  expect(steps).toHaveLength(0);
});
