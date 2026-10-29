import { expect, test, type Page } from "@playwright/test";
import type { Intent } from "@tessera/contracts";
import { UNKNOWN_USAGE, type Provider } from "../../server/src/providers/index.ts";
import {
  listWorkspaces,
  patchWorkspaceData,
  readWorkspaceData,
  workspaceVersions,
} from "../../server/src/workspaces/index.ts";
import { editFixture } from "../../server/test/fixtures/edit-tool.ts";
import { en } from "../src/i18n/en.ts";
import { startApp, type AppHost } from "./support/app-host.ts";

// This file is one shared scenario; a failed step must not restart later steps from creation.
test.describe.configure({ mode: "serial" });

const intent = (kind: "create" | "data"): Intent => ({
  kind,
  interfacePart: null,
  dataPart: null,
  language: "en",
  features: [],
  targetsCurrentTool: true,
  behaviorChange: false,
  lookOnly: false,
});
const patch = (operation: unknown) => ({
  outcome: "patch",
  summary: "Prepared the entry change.",
  patch: { operations: [operation] },
});
const rename = patch({
  op: "replace",
  collection: "items",
  id: "i-1",
  revisionCount: 999,
  fields: { title: "Oat milk" },
});
const steps = [
  { stage: "intent", value: intent("create") },
  { stage: "create", value: editFixture },
  { stage: "intent", value: intent("data") },
  { stage: "data", value: patch({ op: "add", collection: "items", record: { title: "Bread" } }) },
  { stage: "intent", value: intent("data") },
  { stage: "data", value: rename },
  { stage: "intent", value: intent("data") },
  { stage: "data", value: rename },
  { stage: "intent", value: intent("data") },
  {
    stage: "data",
    value: patch({ op: "remove", collection: "items", id: "i-2", revisionCount: 2 }),
  },
  { stage: "intent", value: intent("data") },
  { stage: "data", value: { outcome: "unchanged" } },
];
const provider: Provider = {
  name: "scripted:chat-data",
  live: false,
  run(spec) {
    const step = steps.shift();
    if (step?.stage !== spec.stage) throw new Error(`Unexpected ${spec.stage}`);
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
async function ask(page: Page, text: string) {
  await page.getByRole("textbox", { name: en["request.label"] }).fill(text);
  await page.getByRole("button", { name: en["request.send"] }).click();
  await expect(page.getByRole("textbox", { name: en["request.label"] })).toBeEnabled({
    timeout: 30_000,
  });
}

test("GEN-05: create the list used by chat data changes", async ({ page }) => {
  await page.goto(app.url);
  await ask(page, "A shopping list with milk and eggs");
  await expect(frame(page).getByRole("listitem")).toHaveText(["Milk", "Eggs"]);
});
test("DATA-02 GEN-08: add through chat, refresh the same tool and retain one version", async ({
  page,
}) => {
  await page.goto(app.url);
  const before = workspace();
  await ask(page, "Add Bread");
  await expect(
    page.getByText("Changed one entry in Shopping list. Prepared the entry change."),
  ).toBeVisible();
  await expect(frame(page).getByRole("listitem")).toHaveText(["Milk", "Eggs", "Bread"]);
  expect(workspace().id).toBe(before.id);
  expect(workspace().dataRevision).toBe(before.dataRevision + 1);
  expect(workspaceVersions(app.folder, before.id)).toHaveLength(1);
});
test("GEN-01 DATA-02: review exact before/after facts and cancel without a write", async ({
  page,
}) => {
  await page.goto(app.url);
  const before = workspace();
  await ask(page, "Rename Milk to Oat milk");
  const review = page.getByRole("region", { name: en["request.dataReview"] });
  await expect(review).toContainText("Milk");
  await expect(review).toContainText("Oat milk");
  await expect(review.getByText("Text: “Milk”", { exact: true })).toHaveCSS(
    "white-space",
    "pre-wrap",
  );
  expect(workspace()).toEqual(before);
  await page.getByRole("button", { name: en["request.reviewCancel"] }).click();
  await expect(page.getByText(en["request.dataCancelled"])).toBeVisible();
  expect(workspace()).toEqual(before);
});
test("DATA-02 DATA-04: confirm the host plan and undo its one data change", async ({ page }) => {
  await page.goto(app.url);
  await ask(page, "Rename Milk to Oat milk");
  await page.getByRole("button", { name: en["request.reviewApply"] }).click();
  await expect(
    page.getByText("Changed one entry in Shopping list. Prepared the entry change."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: en["tool.minimize"], exact: true })).toBeVisible();
  await expect(frame(page).getByRole("listitem")).toHaveText(["Oat milk", "Eggs", "Bread"]);
  await page.getByRole("button", { name: en["history.undo"] }).click();
  await expect(page.getByText(en["history.undone"], { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: en["tool.minimize"], exact: true })).toBeVisible();
  await expect(frame(page).getByRole("listitem")).toHaveText(["Milk", "Eggs", "Bread"]);
});
test("DATA-02 GEN-08: a newer target edit wins over a reviewed removal", async ({ page }) => {
  await page.goto(app.url);
  await ask(page, "Remove Eggs");
  await expect(page.getByRole("button", { name: en["request.reviewApply"] })).toBeVisible();
  const current = workspace();
  const count = readWorkspaceData(app.folder, current.id).revisions["items"]!["i-2"]!;
  expect(
    patchWorkspaceData(app.folder, current.id, {
      operations: [
        {
          op: "replace",
          collection: "items",
          id: "i-2",
          revisionCount: count,
          fields: { title: "Duck eggs" },
        },
      ],
    }).ok,
  ).toBe(true);
  const before = workspace();
  await page.getByRole("button", { name: en["request.reviewApply"] }).click();
  await expect(page.getByText(en["request.dataStale"])).toBeVisible();
  expect(workspace()).toEqual(before);
  await page.reload();
  await expect(frame(page).getByRole("listitem")).toHaveText(["Milk", "Duck eggs", "Bread"]);
});
test("GEN-07 GEN-08: unchanged data creates no revision or version", async ({ page }) => {
  await page.goto(app.url);
  const before = workspace();
  await ask(page, "Keep the entries as they are");
  await expect(page.getByText(en["request.dataUnchanged"])).toBeVisible();
  expect(workspace()).toEqual(before);
  expect(workspaceVersions(app.folder, before.id)).toHaveLength(1);
});
