import {
  clickWorkspaceAction,
  openWorkspaces,
  closeWorkspaces,
} from "./support/workspace-actions.ts";
import { expect, test, type Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { saveTool } from "../../server/src/workspaces/index.ts";
import { en } from "../src/i18n/en.ts";
import { startApp, testTool, TOOL_START, workspaceWith, type AppHost } from "./support/app-host.ts";
import { clickToolAction, openToolHistory } from "./support/tool-actions.ts";

let app: AppHost;
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(() => app.close());
const tool = (page: Page) =>
  page.frameLocator(".tool-frame iframe").frameLocator("iframe").frameLocator("iframe");
async function open(page: Page) {
  const name = `Notes ${Math.random().toString(36).slice(2, 7)}`;
  const artifact = testTool("");
  artifact.code.html =
    '<label for="note">Note</label><input id="note"><div id="scroll" style="height:200px;overflow:auto"><div style="height:1200px">Notes</div></div>';
  const id = workspaceWith(app.folder, name, artifact);
  saveTool(app.folder, id, name);
  await page.goto(app.url);
  await clickWorkspaceAction(page, new RegExp(`^(Open ${name}|${name}, open)$`));
  await expect(tool(page).getByLabel("Note")).toBeVisible(TOOL_START);
  return name;
}

test("APP-01, APP-05, RUN-02: header panels keep the running tool, unfinished input and its scroll", async ({
  page,
}) => {
  await open(page);
  await tool(page).getByLabel("Note").fill("Unfinished note");
  await tool(page)
    .locator("#scroll")
    .evaluate((element) => {
      element.scrollTop = 150;
    });
  const frame = page.locator(".tool-frame iframe");
  await frame.evaluate((element) => {
    element.dataset["kept"] = "same-runtime";
  });
  await expect(
    page.locator(".tool-header").getByRole("button", { name: en["history.undo"] }),
  ).toBeDisabled();
  await openToolHistory(page);
  await expect(page.getByRole("region", { name: en["history.heading"] })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: en["history.heading"], exact: true }),
  ).toBeFocused();
  const more = page.getByRole("button", { name: en["tool.more"] });
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".tool-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
  await expect(frame).toHaveAttribute("data-kept", "same-runtime");
  await expect(tool(page).getByLabel("Note")).toHaveValue("Unfinished note");
  expect(
    await tool(page)
      .locator("#scroll")
      .evaluate((element) => element.scrollTop),
  ).toBe(150);
});

test("APP-01, APP-11: entering full screen dismisses More and leaves its controls unobstructed", async ({
  page,
}) => {
  await open(page);
  await clickToolAction(page, en["tool.fullScreen"]);
  await expect(page.locator(".tool-menu")).toBeHidden();
  await expect(page.locator(".tool-panel.full-screen")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await clickToolAction(page, en["tool.leaveFullScreen"]);
  await expect(page.locator(".tool-panel.full-screen")).toHaveCount(0);
});
test("APP-03, APP-04: the header renames the workspace and saves a separate variant", async ({
  page,
}) => {
  const name = await open(page);
  await clickToolAction(page, en["workspaces.renameShort"]);
  const rename = page.getByRole("dialog", { name: en["workspaces.renameShort"] });
  await rename.getByRole("textbox").fill(`${name} renamed`);
  await rename.getByRole("button", { name: en["library.confirm"], exact: true }).click();
  await expect(page.locator(".tool-heading > h1")).toHaveText(`${name} renamed`);
  await page.keyboard.press("Escape");
  await clickToolAction(page, en["library.saveAsNew"]);
  const variant = page.getByRole("dialog", { name: en["library.saveAsNew"] });
  await variant.getByRole("textbox").fill(`${name} variant`);
  await variant.getByRole("button", { name: en["library.confirm"], exact: true }).click();
  await openWorkspaces(page);
  await expect(page.getByRole("button", { name: `Open ${name} variant` })).toBeVisible();
  await closeWorkspaces(page);
  await expect(page.locator(".tool-heading > h1")).toHaveText(`${name} renamed`);
});

test("APP-01, APP-09, APP-11: More opens Details and the header fits with accessible controls", async ({
  page,
}) => {
  await open(page);
  await clickToolAction(page, en["details.heading"]);
  await expect(page.getByRole("region", { name: en["details.heading"] })).toBeVisible();
  await expect(page.getByText(en["details.loading"])).toHaveCount(0);
  await page.keyboard.press("Escape");
  const more = page.getByRole("button", { name: en["tool.more"] });
  await more.click();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBe(0);
  for (const button of await page.locator(".tool-header button:visible").all()) {
    const box = (await button.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await page.keyboard.press("Escape");
  await page.screenshot({ path: test.info().outputPath("tool-header.png"), fullPage: true });
});
