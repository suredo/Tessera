import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { listWorkspaces, readWorkspaceData, saveTool } from "../../server/src/workspaces/index.ts";
import { en } from "../src/i18n/en.ts";
import { startApp, testTool, workspaceWith, type AppHost } from "./support/app-host.ts";

// Export and import screens (APP-06, DATA-05): a workspace or saved tool saved as a file and
// brought back, here as a copy and into another Tessera, with a plain report of what came in. In
// Chrome and Edge at 320 and 1280 px (TEST-06), against real Tesseras on temporary data folders
// (ENG-19).

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
const day = new Date().toISOString().slice(0, 10);

/** Clicks `button` and gives back the file the browser saved. */
async function downloaded(page: Page, click: () => Promise<void>) {
  const [download] = await Promise.all([page.waitForEvent("download"), click()]);
  const file = await download.path();
  return { name: download.suggestedFilename(), bytes: fs.readFileSync(file) };
}
const importFrom = (page: Page, name: string, bytes: Buffer) =>
  page
    .getByLabel(en["archive.importLabel"])
    .setInputFiles({ name, mimeType: "application/octet-stream", buffer: bytes });

test("APP-06, DATA-05: a workspace exports to a file, and that file moves it to another Tessera", async ({
  page,
}) => {
  const id = unique();
  const name = `Garden ${id}`;
  const workspaceId = workspaceWith(app.folder, name, testTool(`Garden tool ${id}`));
  saveTool(app.folder, workspaceId, `Weekly ${id}`);
  await page.goto(app.url);
  const file = await downloaded(page, () =>
    page.getByRole("button", { name: `Export ${name} to a file` }).click(),
  );
  expect(file.name).toBe(`${name} ${day}.tessera`);
  await expect(page.getByText(`${name} is exported as ${file.name}.`)).toBeVisible();

  // Another Tessera, with nothing in it yet: its first screen imports the file.
  const other = await startApp();
  try {
    await page.goto(other.url);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(en["home.heading"]);
    await importFrom(page, file.name, file.bytes);
    await expect(
      page.getByText(`${name} is imported, with Weekly ${id} in my tools.`),
    ).toBeVisible();
    // It opens, with its tool.
    await expect(toolText(page)).toHaveText(`Garden tool ${id}`);
    expect(readWorkspaceData(other.folder, workspaceId).data).toEqual(
      readWorkspaceData(app.folder, workspaceId).data,
    );
  } finally {
    await other.close();
  }
});

test("APP-06: importing a file that is already here brings it in as a copy, and changes nothing", async ({
  page,
}) => {
  const id = unique();
  const name = `Errands ${id}`;
  workspaceWith(app.folder, name, testTool(`Errands tool ${id}`));
  await page.goto(app.url);
  const file = await downloaded(page, () =>
    page.getByRole("button", { name: `Export ${name} to a file` }).click(),
  );
  await importFrom(page, file.name, file.bytes);
  await expect(
    page.getByText(
      `${name} is imported. It was here already, so it came in as a copy, and nothing here changed.`,
    ),
  ).toBeVisible();
  expect(listWorkspaces(app.folder).filter((w) => w.title === name)).toHaveLength(2);
});

test("APP-06: a saved tool exports to a file named after it", async ({ page }) => {
  const id = unique();
  const tool = `Weekly plan ${id}`;
  saveTool(app.folder, workspaceWith(app.folder, `Plan ${id}`, testTool(`Plan ${id}`)), tool);
  await page.goto(app.url);
  await page.getByRole("button", { name: en["nav.library"], exact: true }).click();
  const file = await downloaded(page, () =>
    page.getByRole("button", { name: `Export ${tool} to a file` }).click(),
  );
  expect(file.name).toBe(`${tool} ${day}.tessera`);
});

test("APP-06: a file that isn't an archive is refused in plain words, and nothing comes in", async ({
  page,
}) => {
  workspaceWith(app.folder, `Kept ${unique()}`, testTool("Kept"));
  await page.goto(app.url);
  const before = listWorkspaces(app.folder).length;
  await importFrom(page, "notes.tessera", Buffer.from("just some notes"));
  await expect(page.locator(".notice")).toHaveText(/^[A-Z][^{}<>]*\.$/);
  await expect(page.locator(".notice")).not.toContainText("is imported");
  expect(listWorkspaces(app.folder)).toHaveLength(before);
});
