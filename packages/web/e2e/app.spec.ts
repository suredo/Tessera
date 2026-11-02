import { expect, test, type Page } from "@playwright/test";
import { saveTool } from "../../server/src/workspaces/index.ts";
import { en } from "../src/i18n/en.ts";
import { startApp, testTool, TOOL_START, workspaceWith, type AppHost } from "./support/app-host.ts";

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
  await expect(toolText(page)).toHaveText(`The garden tool ${suffix}`, TOOL_START);
  await workspaceButton(page, shopping).click();
  await expect(toolText(page)).toHaveText(`The shopping tool ${suffix}`, TOOL_START);
  await expect(toolFrames(page)).toHaveCount(1);
  await expect(list.getByRole("button", { name: `${shopping}, open` })).toBeVisible();
});

test("UX-07: a reload opens the same workspace again", async ({ page }) => {
  const { garden, suffix } = twoWorkspaces();
  await page.goto(app.url);
  await workspaceButton(page, garden).click();
  await expect(toolText(page)).toHaveText(`The garden tool ${suffix}`, TOOL_START);
  await page.reload();
  await expect(toolText(page)).toHaveText(`The garden tool ${suffix}`, TOOL_START);
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
  await expect(toolText(page)).toHaveText(`The shopping tool ${suffix}`, TOOL_START);

  await page.getByRole("button", { name: en["tool.minimize"] }).click();
  await expect(page.getByText(`${shopping} is minimized.`)).toBeVisible();
  await expect(toolFrames(page)).toHaveCount(0);
  await page.getByRole("button", { name: en["tool.restore"] }).click();
  await expect(toolText(page)).toHaveText(`The shopping tool ${suffix}`, TOOL_START);

  await page.getByRole("button", { name: en["tool.fullScreen"] }).click();
  await expect(page.locator(".tool-panel.full-screen")).toBeVisible();
  await page.getByRole("button", { name: en["tool.leaveFullScreen"] }).click();
  await expect(page.locator(".tool-panel.full-screen")).toHaveCount(0);
});

test("UX-07: a minimized tool stays minimized after a reload, and after switching away and back", async ({
  page,
}) => {
  const { shopping, garden, suffix } = twoWorkspaces();
  await page.goto(app.url);
  await workspaceButton(page, shopping).click();
  await expect(toolText(page)).toHaveText(`The shopping tool ${suffix}`, TOOL_START);
  await page.getByRole("button", { name: en["tool.minimize"] }).click();
  await expect(page.getByText(`${shopping} is minimized.`)).toBeVisible();

  await page.reload();
  await expect(page.getByText(`${shopping} is minimized.`)).toBeVisible();
  await expect(toolFrames(page)).toHaveCount(0);

  await workspaceButton(page, garden).click();
  await expect(toolText(page)).toHaveText(`The garden tool ${suffix}`, TOOL_START);
  await workspaceButton(page, shopping).click();
  await expect(page.getByText(`${shopping} is minimized.`)).toBeVisible();
  await expect(toolFrames(page)).toHaveCount(0);
  await page.getByRole("button", { name: en["tool.restore"] }).click();
  await expect(toolText(page)).toHaveText(`The shopping tool ${suffix}`, TOOL_START);
});

/** Makes a workspace look last used and changed on 1 January 2020. */
function backdate(id: string) {
  const old = "2020-01-01T09:00:00.000Z";
  app.folder.db.run("UPDATE workspaces SET updated_at = ? WHERE id = ?", old, id);
  app.folder.db.run("UPDATE workspace_use SET used_at = ? WHERE workspace_id = ?", old, id);
}
const lastUsedOf = (page: Page, name: string) => workspaceButton(page, name).locator(".detail");
const thisYear = String(new Date().getFullYear());

test("APP-03: opening a workspace shows it as used at once, even minimized, and a new tab lists it first", async ({
  page,
}) => {
  const { ids, shopping, garden, suffix } = twoWorkspaces();
  ids.forEach(backdate);
  await page.goto(app.url);
  await expect(lastUsedOf(page, garden)).toContainText("2020");
  const names = () =>
    workspaceList(page).locator(".workspace-name > span:first-child").allTextContents();
  const before = await names();

  // Used now, in this tab, without moving its row.
  await workspaceButton(page, garden).click();
  await expect(toolText(page)).toHaveText(`The garden tool ${suffix}`, TOOL_START);
  await expect(lastUsedOf(page, garden)).toContainText(thisYear);
  expect(await names()).toEqual(before);

  // A minimized tool doesn't start when it is opened again, but opening it is still using it.
  await page.getByRole("button", { name: en["tool.minimize"] }).click();
  await workspaceButton(page, shopping).click();
  await expect(toolText(page)).toHaveText(`The shopping tool ${suffix}`, TOOL_START);
  backdate(ids[1]!);
  await page.reload();
  await expect(lastUsedOf(page, garden)).toContainText("2020");
  await workspaceButton(page, garden).click();
  await expect(page.getByText(`${garden} is minimized.`)).toBeVisible();
  await expect(lastUsedOf(page, garden)).toContainText(thisYear);

  // A new tab remembers nothing, so it opens the most recently used workspace, listed first.
  const fresh = await page.context().newPage();
  await fresh.goto(app.url);
  // How a tool was left is kept per tab, so here it starts.
  await expect(toolText(fresh)).toHaveText(`The garden tool ${suffix}`, TOOL_START);
  const order = await workspaceList(fresh)
    .locator(".workspace-name > span:first-child")
    .allTextContents();
  expect(order.indexOf(garden)).toBeLessThan(order.indexOf(shopping));
  await fresh.close();
});

test("RUN-02: showing a tool again is one start at a time", async ({ page }) => {
  const { shopping, suffix } = twoWorkspaces();
  await page.goto(app.url);
  await workspaceButton(page, shopping).click();
  await expect(toolText(page)).toHaveText(`The shopping tool ${suffix}`, TOOL_START);
  await page.getByRole("button", { name: en["tool.minimize"] }).click();

  // Hold the runtime's wrapper document, so the start is still going when the person clicks again.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let heldRequests = 0;
  await page.context().route(/\/runtime\/wrapper/, async (route) => {
    heldRequests += 1;
    await held;
    await route.continue();
  });
  const showAgain = page.getByRole("button", { name: en["tool.restore"] });
  await showAgain.click();
  await expect.poll(() => heldRequests).toBe(1);
  await expect(showAgain).toHaveCount(0);
  release();
  await expect(toolText(page)).toHaveText(`The shopping tool ${suffix}`, TOOL_START);
  await expect(page.getByRole("button", { name: en["tool.minimize"] })).toBeVisible();
  await expect(toolFrames(page)).toHaveCount(1);
  await page.context().unrouteAll();
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
