import { expect, test, type Page } from "@playwright/test";
import { saveTool } from "../../server/src/workspaces/index.ts";
import { en } from "../src/i18n/en.ts";
import { startApp, testTool, workspaceWith, type AppHost } from "./support/app-host.ts";

// The host app's main screen and workspaces (APP-01, APP-03, RUN-02, UX-07), in Chrome and Edge at
// 320 and 1280 px (TEST-06), against a real Tessera on a temporary data folder (ENG-19).

let app: AppHost;
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(() => app.close());

/** Two workspaces with their own tools, the first saved to the library; their IDs and names. */
function twoWorkspaces() {
  const suffix = Math.random().toString(36).slice(2, 7);
  const shopping = `Shopping ${suffix}`;
  const garden = `Garden ${suffix}`;
  const ids = [
    workspaceWith(app.folder, shopping, testTool(`The shopping tool ${suffix}`)),
    workspaceWith(app.folder, garden, testTool(`The garden tool ${suffix}`)),
  ];
  saveTool(app.folder, ids[0]!, `Weekly ${suffix}`);
  return { ids, shopping, garden, suffix };
}

const workspaceList = (page: Page) => page.getByRole("region", { name: en["workspaces.heading"] });
/** The text the running tool shows, inside its sandboxed frames. */
const toolText = (page: Page) =>
  page
    .frameLocator(".tool-frame iframe")
    .frameLocator("iframe")
    .frameLocator("iframe")
    .locator("#text");
const toolFrames = (page: Page) => page.locator(".tool-frame iframe");
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A workspace's button, whether it is open or not. */
const workspaceButton = (page: Page, name: string) =>
  workspaceList(page).getByRole("button", {
    name: new RegExp(`^(Open ${escape(name)}|${escape(name)}, open)$`),
  });

test("APP-03, RUN-02: lists the workspaces, opens one's tool, and switching runs exactly one tool", async ({
  page,
}) => {
  const { shopping, garden, suffix } = twoWorkspaces();
  await page.goto(app.url);
  const list = workspaceList(page);
  await expect(workspaceButton(page, shopping)).toBeVisible();
  // The saved one says so.
  await expect(
    list.locator(".workspace", { hasText: shopping }).getByText(en["workspaces.saved"]),
  ).toBeVisible();

  await workspaceButton(page, garden).click();
  await expect(toolText(page)).toHaveText(`The garden tool ${suffix}`);
  await workspaceButton(page, shopping).click();
  await expect(toolText(page)).toHaveText(`The shopping tool ${suffix}`);
  await expect(toolFrames(page)).toHaveCount(1);
  await expect(list.getByRole("button", { name: `${shopping}, open` })).toBeVisible();
});

test("UX-07: a reload opens the same workspace again", async ({ page }) => {
  const { garden, suffix } = twoWorkspaces();
  await page.goto(app.url);
  await workspaceButton(page, garden).click();
  await expect(toolText(page)).toHaveText(`The garden tool ${suffix}`);
  await page.reload();
  await expect(toolText(page)).toHaveText(`The garden tool ${suffix}`);
});

test("APP-03: renames a workspace, and moves one to the trash", async ({ page }) => {
  const { garden } = twoWorkspaces();
  await page.goto(app.url);
  const list = workspaceList(page);
  await list.getByRole("button", { name: `Rename ${garden}` }).click();
  const field = list.getByLabel(`New name for ${garden}`);
  await field.fill(`${garden} plan`);
  await list.getByRole("button", { name: en["workspaces.renameSave"] }).click();
  await expect(workspaceButton(page, `${garden} plan`)).toBeVisible();

  await list.getByRole("button", { name: `Move ${garden} plan to the trash` }).click();
  await expect(
    page.getByText(`${garden} plan is in the trash. You can restore it for 30 days.`),
  ).toBeVisible();
  await expect(workspaceButton(page, `${garden} plan`)).toHaveCount(0);
});

test("APP-01: the tool can be minimized, shown again and put full screen", async ({ page }) => {
  const { shopping, suffix } = twoWorkspaces();
  await page.goto(app.url);
  await workspaceButton(page, shopping).click();
  await expect(toolText(page)).toHaveText(`The shopping tool ${suffix}`);

  await page.getByRole("button", { name: en["tool.minimize"] }).click();
  await expect(page.getByText(`${shopping} is minimized.`)).toBeVisible();
  await expect(toolFrames(page)).toHaveCount(0);
  await page.getByRole("button", { name: en["tool.restore"] }).click();
  await expect(toolText(page)).toHaveText(`The shopping tool ${suffix}`);

  await page.getByRole("button", { name: en["tool.fullScreen"] }).click();
  await expect(page.locator(".tool-panel.full-screen")).toBeVisible();
  await page.getByRole("button", { name: en["tool.leaveFullScreen"] }).click();
  await expect(page.locator(".tool-panel.full-screen")).toHaveCount(0);
});

test("RUN-06: the main screen doesn't scroll sideways", async ({ page }) => {
  twoWorkspaces();
  await page.goto(app.url);
  await expect(workspaceList(page)).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
