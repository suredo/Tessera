import { expect, test, type Page } from "@playwright/test";
import { seedSamples } from "../../../scripts/seed.ts";
import { en } from "../src/i18n/en.ts";
import { startApp, type AppHost } from "./support/app-host.ts";

// The sample workspaces `pnpm seed` makes (ENG-19) work as the owner will try them: a tool that
// saves its data, a history with a lossy restore to preview, a saved tool, the trash and a
// workspace without a tool. In Chrome and Edge at 320 and 1280 px (TEST-06), seeded into a test
// Tessera's own temporary data folder, never the development or real one.

let app: AppHost;
test.beforeAll(async () => {
  app = await startApp();
  seedSamples(app.folder);
});
test.afterAll(() => app.close());

/** The running tool's own document, inside its sandboxed frames. */
const tool = (page: Page) =>
  page.frameLocator(".tool-frame iframe").frameLocator("iframe").frameLocator("iframe");
const openWorkspace = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^(Open ${name}|${name}, open)$`) }).click();

test("the shopping list saves what the person adds and ticks, and its history can undo it", async ({
  page,
}) => {
  await page.goto(app.url);
  await openWorkspace(page, "Shopping list");
  const items = tool(page).getByRole("listitem");
  await expect(items).toHaveText([/Milk/, /Bread/, /Eggs/]);
  await expect(tool(page).getByRole("checkbox", { name: "Milk" })).toBeChecked();

  await tool(page).getByLabel("Item").fill("Apples");
  await tool(page).getByRole("button", { name: "Add" }).click();
  await expect(items).toHaveText([/Milk/, /Bread/, /Eggs/, /Apples/]);
  await expect(page.getByRole("region", { name: en["history.heading"] })).toContainText(
    "One record changed",
  );
  await tool(page).getByRole("checkbox", { name: "Bread" }).check();
  await expect(tool(page).getByRole("checkbox", { name: "Bread" })).toBeChecked();

  // Version 1 has no ticks: restoring it previews exactly what would be lost.
  await page.getByRole("button", { name: "Restore version 1" }).click();
  const confirm = page.getByRole("group", { name: "Restore version 1?" });
  await expect(confirm).toContainText(en["history.losesData"]);
  await expect(confirm.getByRole("listitem").filter({ hasText: "done: true" })).toHaveCount(2);
  await confirm.getByRole("button", { name: en["history.cancel"] }).click();
});

test("the library, the trash and a workspace without a tool each have something to show", async ({
  page,
}) => {
  await page.goto(app.url);
  await openWorkspace(page, "Ideas");
  await expect(page.getByText("Ideas has no tool yet.")).toBeVisible();
  await page.getByRole("button", { name: en["nav.library"], exact: true }).click();
  await expect(page.getByRole("heading", { name: "Garden journal" })).toBeVisible();
  await page.getByRole("button", { name: en["nav.trash"], exact: true }).click();
  await expect(page.getByRole("heading", { name: "Old packing list" })).toBeVisible();
});
