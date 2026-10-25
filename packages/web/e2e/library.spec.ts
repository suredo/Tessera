import { expect, test, type Page } from "@playwright/test";
import { saveVersion } from "../../server/src/versions/index.ts";
import {
  activateVersion,
  getWorkspace,
  patchWorkspaceData,
  saveTool,
} from "../../server/src/workspaces/index.ts";
import { en } from "../src/i18n/en.ts";
import { startApp, testTool, workspaceWith, type AppHost } from "./support/app-host.ts";

// My tools, the saved-tools library (APP-04, DATA-07, DATA-08), in Chrome and Edge at 320 and
// 1280 px (TEST-06), against a real Tessera on a temporary data folder (ENG-19).

let app: AppHost;
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(() => app.close());

const unique = () => Math.random().toString(36).slice(2, 7);
const toolText = (page: Page) =>
  page
    .frameLocator(".tool-frame iframe")
    .frameLocator("iframe")
    .frameLocator("iframe")
    .locator("#text");
const library = (page: Page) => page.getByRole("region", { name: en["library.heading"] });
const entry = (page: Page, name: string) =>
  library(page)
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
const openWorkspace = (page: Page, name: string) =>
  page.getByRole("button", { name: `${name}, open`, exact: true });
const toLibrary = (page: Page) =>
  page.getByRole("button", { name: en["nav.library"], exact: true }).click();

/** A saved tool whose workspace holds the person's own entry, beyond the tool's defaults. */
function savedTool() {
  const id = unique();
  const workspace = `This week ${id}`;
  const name = `Errands ${id}`;
  const workspaceId = workspaceWith(app.folder, workspace, testTool(`Errands tool ${id}`));
  patchWorkspaceData(app.folder, workspaceId, {
    operations: [{ op: "add", collection: "tasks", record: { title: "Buy milk" } }],
  });
  saveTool(app.folder, workspaceId, name);
  return { id, workspace, name, workspaceId };
}

test("DATA-08: a workspace is saved to my tools by name, and found there by searching", async ({
  page,
}) => {
  const id = unique();
  const workspace = `Garden ${id}`;
  workspaceWith(app.folder, workspace, testTool(`Garden tool ${id}`));
  await page.goto(app.url);
  await page.getByRole("button", { name: `Save ${workspace} to my tools` }).click();
  await page.getByLabel(en["workspaces.saveLabel"]).fill(`Garden plan ${id}`);
  await page.getByRole("button", { name: en["workspaces.saveConfirm"], exact: true }).click();
  await expect(page.getByText(`Garden plan ${id} is in my tools.`)).toBeVisible();

  await toLibrary(page);
  await expect(entry(page, `Garden plan ${id}`)).toContainText(`Continue opens ${workspace}`);
  await library(page).getByLabel(en["library.search"]).fill(`garden plan ${id}`);
  await expect(library(page).getByRole("listitem")).toHaveCount(1);
  await library(page).getByLabel(en["library.search"]).fill(`nothing like it ${id}`);
  await expect(
    library(page).getByText(`No saved tool matches “nothing like it ${id}”.`),
  ).toBeVisible();
});

test("APP-04: a saved tool shows when its tool was last updated, after it was saved", async ({
  page,
}) => {
  const { id, name, workspaceId } = savedTool();
  const old = "2020-01-01T09:00:00.000Z";
  app.folder.db.run(
    "UPDATE saved_tools SET updated_at = ? WHERE workspace_id = ?",
    old,
    workspaceId,
  );
  app.folder.db.run("UPDATE workspaces SET updated_at = ? WHERE id = ?", old, workspaceId);
  await page.goto(app.url);
  await toLibrary(page);
  await expect(entry(page, name)).toContainText("Updated Jan 1, 2020");

  // The tool is improved in its workspace; the entry follows it (A32).
  const better = saveVersion(app.folder.db, testTool(`Errands tool ${id}, improved`));
  const revision = getWorkspace(app.folder, workspaceId)!.dataRevision;
  expect(activateVersion(app.folder, workspaceId, better, revision).ok).toBe(true);
  await page.reload();
  await toLibrary(page);
  await expect(entry(page, name)).toContainText(String(new Date().getFullYear()));
  await expect(entry(page, name)).not.toContainText("2020");
});

test("APP-04, DATA-07: Continue opens the linked workspace, and says which before", async ({
  page,
}) => {
  const { id, workspace, name } = savedTool();
  await page.goto(app.url);
  await toLibrary(page);
  await expect(entry(page, name)).toContainText(`Continue opens ${workspace}`);
  await entry(page, name)
    .getByRole("button", { name: `Continue ${name}, in ${workspace}` })
    .click();
  await expect(openWorkspace(page, workspace)).toBeVisible();
  await expect(toolText(page)).toHaveText(`Errands tool ${id}`);
});

test("DATA-07: Use again opens a new workspace with fresh data, and Continue still opens the first", async ({
  page,
}) => {
  const { id, workspace, name } = savedTool();
  await page.goto(app.url);
  await toLibrary(page);
  await entry(page, name)
    .getByRole("button", { name: `Use ${name} again, with fresh data` })
    .click();
  await expect(
    page.getByText(`${name} opened in a new workspace, with its starting data.`),
  ).toBeVisible();
  // The new workspace is named after the entry, runs the same tool, and is open.
  await expect(openWorkspace(page, name)).toBeVisible();
  await expect(toolText(page)).toHaveText(`Errands tool ${id}`);
  // The library entry still continues its own workspace.
  await toLibrary(page);
  await expect(entry(page, name)).toContainText(`Continue opens ${workspace}`);
});

test("APP-04: Save as a new tool makes a separate entry with its own workspace", async ({
  page,
}) => {
  const { id, workspace, name } = savedTool();
  await page.goto(app.url);
  await toLibrary(page);
  await entry(page, name)
    .getByRole("button", { name: `Save ${name} as a new tool` })
    .click();
  await library(page).getByLabel(en["library.newName"]).fill(`Party errands ${id}`);
  await library(page).getByRole("button", { name: en["library.confirm"], exact: true }).click();
  await expect(page.getByText(`Party errands ${id} is a new tool in my tools.`)).toBeVisible();
  await expect(entry(page, `Party errands ${id}`)).toContainText(
    `Continue opens Party errands ${id}`,
  );
  await expect(entry(page, name)).toContainText(`Continue opens ${workspace}`);
});

test("APP-04: a saved tool can be renamed and moved to the trash", async ({ page }) => {
  const { id, name } = savedTool();
  await page.goto(app.url);
  await toLibrary(page);
  await entry(page, name)
    .getByRole("button", { name: `Rename ${name}` })
    .click();
  await library(page).getByLabel(`New name for ${name}`).fill(`Chores ${id}`);
  await library(page).getByRole("button", { name: en["library.confirm"], exact: true }).click();
  await expect(entry(page, `Chores ${id}`)).toBeVisible();
  await entry(page, `Chores ${id}`)
    .getByRole("button", { name: `Move Chores ${id} to the trash` })
    .click();
  await expect(
    page.getByText(`Chores ${id} is in the trash. You can restore it for 30 days.`),
  ).toBeVisible();
  await expect(entry(page, `Chores ${id}`)).toHaveCount(0);
});
