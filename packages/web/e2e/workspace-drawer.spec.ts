import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { startApp, testTool, TOOL_START, workspaceWith, type AppHost } from "./support/app-host.ts";
import {
  openWorkspaces,
  selectWorkspace,
  clickWorkspaceAction,
} from "./support/workspace-actions.ts";

let app: AppHost;
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(() => app.close());

test("APP-01 APP-11 RUN-02: modal drawer contains focus and preserves the tool, input and scroll", async ({
  page,
}) => {
  const name = `Draft ${Math.random().toString(36).slice(2, 7)}`;
  const artifact = testTool("");
  artifact.code.html =
    '<label for="note">Note</label><input id="note"><div id="scroll" tabindex="0" style="height:200px;overflow:auto"><div style="height:1200px">Notes</div></div>';
  workspaceWith(app.folder, name, artifact);
  await page.goto(app.url);
  await expect(page.getByRole("dialog", { name: en["workspaces.heading"] })).toBeHidden();
  const tool = page
    .frameLocator(".tool-frame iframe")
    .frameLocator("iframe")
    .frameLocator("iframe");
  await expect(tool.getByLabel("Note")).toBeVisible(TOOL_START);
  await tool.getByLabel("Note").fill("Unfinished");
  await tool.locator("#scroll").evaluate((element) => {
    element.scrollTop = 150;
  });
  await page.locator(".tool-frame iframe").evaluate((element) => {
    element.dataset["kept"] = "same";
  });
  const opener = page.getByRole("button", { name: en["workspaces.heading"], exact: true });
  await opener.focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog", { name: en["workspaces.heading"], exact: true });
  await expect(drawer).toBeVisible();
  for (let count = 0; count < 18; count++) {
    await page.keyboard.press("Tab");
    expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-output/drawer-${page.viewportSize()!.width}.png` });
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(page.locator(".tool-frame iframe")).toHaveAttribute("data-kept", "same");
  await expect(tool.getByLabel("Note")).toHaveValue("Unfinished");
  expect(await tool.locator("#scroll").evaluate((element) => element.scrollTop)).toBe(150);
});

test("APP-03 APP-04: search filters recent work, its row menu renames, and New tool opens an empty request", async ({
  page,
}) => {
  const name = `Search ${Math.random().toString(36).slice(2, 7)}`;
  workspaceWith(app.folder, name, testTool("Ready"));
  await page.goto(app.url);
  const drawer = await openWorkspaces(page);
  await drawer.getByRole("searchbox").fill(name.toLowerCase());
  await expect(drawer.locator(".workspace")).toHaveCount(1);
  await clickWorkspaceAction(page, `Rename ${name}`);
  await drawer.getByRole("textbox", { name: `New name for ${name}` }).fill(`${name} renamed`);
  await drawer.getByRole("button", { name: en["workspaces.renameSave"], exact: true }).click();
  await expect(
    drawer.getByRole("button", { name: new RegExp(`${name} renamed`) }).first(),
  ).toBeVisible();
  await drawer.getByRole("searchbox").fill("Nothing matches this request");
  await expect(drawer.locator(".workspace")).toHaveCount(0);
  await expect(drawer.getByText(/No recent work matches/)).toBeVisible();
  await drawer.getByRole("searchbox").fill("");
  await selectWorkspace(page, `${name} renamed`);
  await expect(page.locator(".tool-heading h1")).toHaveText(`${name} renamed`);
  await openWorkspaces(page);
  await drawer.getByRole("button", { name: en["workspaces.new"], exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(page.locator(".tool-panel")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: en["request.label"] })).toBeVisible();
  await selectWorkspace(page, `${name} renamed`);
  await expect(page.locator(".tool-heading h1")).toHaveText(`${name} renamed`);
});

test("APP-01, APP-03, APP-11: the drawer reads as the mockup: a close cross, short dates, the open row marked, More on hover or focus", async ({
  page,
}) => {
  const open = `Open ${Math.random().toString(36).slice(2, 7)}`;
  const other = `Other ${Math.random().toString(36).slice(2, 7)}`;
  workspaceWith(app.folder, other, testTool(""));
  workspaceWith(app.folder, open, testTool(""));
  await page.goto(app.url);
  await selectWorkspace(page, open);
  const drawer = await openWorkspaces(page);
  await expect(drawer.getByRole("button", { name: en["workspaces.close"] })).toHaveText("");
  const row = (name: string) => drawer.locator(".workspace", { hasText: name });
  // Used today, so the short date says so, as in d-workspaces-open.
  await expect(row(open).locator(".detail")).toHaveText(en["workspaces.today"]);
  await expect(row(open)).toHaveClass(/open/);
  const more = (name: string) => row(name).locator(".workspace-more");
  if (await page.evaluate(() => matchMedia("(hover: hover)").matches)) {
    await page.mouse.move(600, 400);
    await expect(more(open)).toHaveCSS("opacity", "1");
    await expect(more(other)).toHaveCSS("opacity", "0");
    await row(other).hover();
    await expect(more(other)).toHaveCSS("opacity", "1");
    await page.mouse.move(600, 400);
    await more(other).focus();
    await expect(more(other)).toHaveCSS("opacity", "1");
  }
  // Import is a row like the others, its name centred; its file field stays reachable by label.
  await expect(drawer.getByLabel(en["archive.importLabel"])).toBeAttached();
  await expect(drawer.locator(".import-file label")).toHaveCSS("display", "flex");
  await expect(drawer.locator(".import-file label")).toHaveCSS("align-items", "center");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("APP-01, APP-03: with many workspaces only the recent rows scroll; New tool and search stay in view", async ({
  page,
}) => {
  for (let i = 0; i < 16; i++) workspaceWith(app.folder, `Many ${i}`, testTool(""));
  await page.goto(app.url);
  const drawer = await openWorkspaces(page);
  const list = drawer.locator(".workspaces ul");
  await list.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  expect(await list.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect(
    drawer.getByRole("button", { name: en["workspaces.new"], exact: true }),
  ).toBeInViewport();
  await expect(drawer.getByRole("searchbox", { name: en["workspaces.find"] })).toBeInViewport();
  await expect(drawer.getByRole("button", { name: en["nav.trash"], exact: true })).toBeInViewport();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
