import { expect, test, type Page } from "@playwright/test";
import { deleteSavedTool, deleteWorkspace } from "../../server/src/trash/index.ts";
import { saveTool } from "../../server/src/workspaces/index.ts";
import { en } from "../src/i18n/en.ts";
import { startApp, testTool, workspaceWith, type AppHost } from "./support/app-host.ts";

// The trash (APP-08, DATA-09): what was deleted, when it goes for good, restore, and emptying it
// early only once it names what goes. In Chrome and Edge at 320 and 1280 px (TEST-06), against a
// real Tessera of its own on a temporary data folder (ENG-19). The tests run in order: the first
// needs a Tessera with no workspaces, and emptying the trash empties it for the tests after.

let app: AppHost;
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(() => app.close());

const unique = () => Math.random().toString(36).slice(2, 7);
const trash = (page: Page) => page.getByRole("region", { name: en["trash.heading"] });
const entry = (page: Page, name: string) =>
  trash(page)
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
const toTrash = (page: Page) =>
  page.getByRole("button", { name: en["nav.trash"], exact: true }).click();
const toolText = (page: Page) =>
  page
    .frameLocator(".tool-frame iframe")
    .frameLocator("iframe")
    .frameLocator("iframe")
    .locator("#text");

test("DATA-09: after the last workspace is deleted, the first screen still reaches the trash", async ({
  page,
}) => {
  const name = `Only one ${unique()}`;
  workspaceWith(app.folder, name, testTool(`The only tool`));
  await page.goto(app.url);
  await page.getByRole("button", { name: `Move ${name} to the trash` }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(en["home.heading"]);

  await page.getByRole("button", { name: en["home.trash"] }).click();
  await entry(page, name)
    .getByRole("button", { name: `Restore ${name}` })
    .click();
  await expect(page.getByText(`${name} is back.`)).toBeVisible();
  // It opens again, since nothing else was open.
  await page.getByRole("button", { name: en["nav.workspaces"], exact: true }).click();
  await expect(toolText(page)).toHaveText("The only tool");
});

test("APP-08: the trash lists what was deleted and when it goes, and restores each", async ({
  page,
}) => {
  const id = unique();
  const workspace = `Garden ${id}`;
  const tool = `Weekly ${id}`;
  const workspaceId = workspaceWith(app.folder, workspace, testTool(`Garden tool ${id}`));
  const kept = workspaceWith(app.folder, `Kept ${id}`, testTool(`Kept tool ${id}`));
  const { id: toolId } = saveTool(app.folder, kept, tool);
  deleteWorkspace(app.folder, workspaceId);
  deleteSavedTool(app.folder, toolId);

  await page.goto(app.url);
  await toTrash(page);
  await expect(entry(page, workspace)).toContainText(en["trash.workspace"]);
  await expect(entry(page, tool)).toContainText(en["trash.savedTool"]);
  // Deleted today, and gone for good 30 days later (DATA-09).
  const day = new Intl.DateTimeFormat("en", { dateStyle: "medium" });
  const deleted = day.format(new Date());
  const removed = day.format(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
  await expect(entry(page, workspace)).toContainText(
    `Deleted ${deleted} · Goes for good ${removed}`,
  );

  await entry(page, workspace)
    .getByRole("button", { name: `Restore ${workspace}` })
    .click();
  await expect(page.getByText(`${workspace} is back.`)).toBeVisible();
  await expect(entry(page, workspace)).toHaveCount(0);
  await entry(page, tool)
    .getByRole("button", { name: `Restore ${tool}` })
    .click();
  await expect(page.getByText(`${tool} is back.`)).toBeVisible();

  await page.getByRole("button", { name: en["nav.library"], exact: true }).click();
  await expect(page.getByRole("heading", { name: tool, exact: true })).toBeVisible();
  await page.getByRole("button", { name: en["nav.workspaces"], exact: true }).click();
  await expect(page.getByRole("button", { name: `Open ${workspace}` })).toBeVisible();
});

test("APP-08, DATA-09: emptying the trash names what goes first, and Cancel keeps it", async ({
  page,
}) => {
  const id = unique();
  const names = [`Old list ${id}`, `Old plan ${id}`];
  for (const name of names)
    deleteWorkspace(app.folder, workspaceWith(app.folder, name, testTool(name)));
  workspaceWith(app.folder, `Still here ${id}`, testTool(`Still here ${id}`));

  await page.goto(app.url);
  await toTrash(page);
  await trash(page).getByRole("button", { name: en["trash.emptyNow"] }).click();
  const confirm = page.getByRole("group", { name: en["trash.confirmHeading"] });
  for (const name of names) await expect(confirm).toContainText(`${name} (Workspace)`);
  await confirm.getByRole("button", { name: en["trash.cancel"] }).click();
  await expect(confirm).toHaveCount(0);
  for (const name of names) await expect(entry(page, name)).toHaveCount(1);

  await trash(page).getByRole("button", { name: en["trash.emptyNow"] }).click();
  await confirm.getByRole("button", { name: en["trash.confirm"], exact: true }).click();
  await expect(page.getByText(/^The trash is empty\. \d+ went for good\.$/)).toBeVisible();
  await expect(trash(page).getByText(en["trash.empty"])).toBeVisible();
});

test("DATA-09: emptying the trash never removes something the person wasn't shown", async ({
  page,
}) => {
  const id = unique();
  const shown = `Shown ${id}`;
  const later = `Deleted later ${id}`;
  deleteWorkspace(app.folder, workspaceWith(app.folder, shown, testTool(shown)));
  const laterId = workspaceWith(app.folder, later, testTool(later));
  workspaceWith(app.folder, `Still here ${id}`, testTool(`Still here ${id}`));

  await page.goto(app.url);
  await toTrash(page);
  await trash(page).getByRole("button", { name: en["trash.emptyNow"] }).click();
  const confirm = page.getByRole("group", { name: en["trash.confirmHeading"] });
  await expect(confirm).toContainText(shown);
  // Something else goes to the trash while the person reads the list.
  deleteWorkspace(app.folder, laterId);
  await confirm.getByRole("button", { name: en["trash.confirm"], exact: true }).click();
  await expect(
    page.getByText("The trash changed since you looked at it, so nothing was removed."),
  ).toBeVisible();
  // Nothing went, and the trash now shows what it holds.
  await expect(entry(page, shown)).toHaveCount(1);
  await expect(entry(page, later)).toHaveCount(1);
});
