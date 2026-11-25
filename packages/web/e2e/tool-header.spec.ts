import {
  clickWorkspaceAction,
  openWorkspaces,
  closeWorkspaces,
  selectWorkspace,
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
  const more = page.getByRole("button", { name: en["tool.more"] });
  // Focus returns to History, or, on a phone where History is in More, to More.
  await expect(
    page.viewportSize()!.width >= 1000
      ? page.getByRole("button", { name: en["history.heading"], exact: true })
      : more,
  ).toBeFocused();
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

// Each menu or panel opens just below its opener, lined up with one of its edges (it may flip to
// fit a narrow window), not in a corner of the page.
async function expectBelow(
  opener: ReturnType<Page["locator"]>,
  popover: ReturnType<Page["locator"]>,
) {
  await expect(popover).toBeVisible();
  const from = (await opener.boundingBox())!;
  const box = (await popover.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(from.y + from.height - 1);
  expect(box.y).toBeLessThanOrEqual(from.y + from.height + 16);
  const offset = Math.min(
    Math.abs(box.x - from.x),
    Math.abs(box.x + box.width - (from.x + from.width)),
  );
  expect(offset).toBeLessThanOrEqual(2);
}

test("APP-01, APP-05: More, History and workspace menus open beside their openers", async ({
  page,
}) => {
  const name = await open(page);
  const more = page.getByRole("button", { name: en["tool.more"] });
  await more.click();
  await expectBelow(more, page.locator(".tool-menu"));
  await page.keyboard.press("Escape");
  await openToolHistory(page);
  await expectBelow(
    page.viewportSize()!.width >= 1000
      ? page.getByRole("button", { name: en["history.heading"], exact: true })
      : more,
    page.getByRole("region", { name: en["history.heading"] }),
  );
  await page.keyboard.press("Escape");
  const drawer = await openWorkspaces(page);
  const rowMore = drawer.getByRole("button", {
    name: en["workspaces.actions"].replace("{name}", name),
  });
  await rowMore.click();
  await expectBelow(rowMore, drawer.locator(".workspace-menu:popover-open"));
});

test("APP-01, APP-11: the header runs edge to edge and labels Undo, History and More where there is room", async ({
  page,
}) => {
  await open(page);
  const header = page.locator(".tool-header");
  const box = (await header.boundingBox())!;
  const width = page.viewportSize()!.width;
  // From edge to edge of the window, past the body's scrollbar: 64 px tall as in a-focus, 76 px
  // on a phone as in e-mobile.
  expect(box.x).toBe(0);
  expect(box.width).toBe(width);
  expect(box.height).toBe(width >= 1000 ? 64 : 76);
  // The tool's card sits 24 px below the header, or 10 px on a phone (a-focus, e-mobile).
  const card = (await page.locator(".tool-frame").boundingBox())!;
  expect(Math.round(card.y - (box.y + box.height))).toBe(width >= 1000 ? 24 : 10);
  const labels = header.locator(".header-label");
  const names =
    width >= 1000
      ? [en["history.undo"], en["history.heading"], en["tool.more"]]
      : [en["history.undo"], en["tool.more"]];
  for (const name of names) {
    await expect(header.getByRole("button", { name, exact: true })).toBeVisible();
  }
  if (width < 1000) {
    // On a phone, History is in More (e-mobile), and opens the same panel.
    await expect(
      header.getByRole("button", { name: en["history.heading"], exact: true }),
    ).toBeHidden();
    await header.getByRole("button", { name: en["tool.more"], exact: true }).click();
    await page.locator(".tool-menu").getByRole("button", { name: en["history.heading"] }).click();
    await expect(page.getByRole("region", { name: en["history.heading"] })).toBeVisible();
    await page.keyboard.press("Escape");
  }
  if (width >= 1000) {
    await expect(labels).toHaveText([
      en["history.undoLabel"],
      en["history.heading"],
      en["tool.moreLabel"],
    ]);
    for (const label of await labels.all()) await expect(label).toBeVisible();
  } else {
    // A narrow panel keeps the icons; the names stay for screen readers.
    for (const label of await labels.all()) await expect(label).toBeHidden();
  }
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
  await expect(rename).toBeHidden();
  await expect(page.locator(".tool-heading > h1")).toHaveText(`${name} renamed`);
  await page.keyboard.press("Escape");
  await clickToolAction(page, en["library.saveAsNew"]);
  const variant = page.getByRole("dialog", { name: en["library.saveAsNew"] });
  await variant.getByRole("textbox").fill(`${name} variant`);
  await variant.getByRole("button", { name: en["library.confirm"], exact: true }).click();
  await expect(variant).toBeHidden();
  await openWorkspaces(page);
  await expect(page.locator(".tool-menu")).toBeHidden();
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

test("APP-01: Save to My tools is 14 px text with no fill", async ({ page }) => {
  const name = `Unsaved ${Math.random().toString(36).slice(2, 7)}`;
  workspaceWith(app.folder, name, testTool(""));
  await page.goto(app.url);
  await selectWorkspace(page, name);
  const save = page.locator(".save-tool > button");
  await expect(save).toHaveCSS("font-size", "14px");
  await expect(save).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  // On desktop, set 6 px apart from the buttons beside it, whose text starts 12 px in (a-focus).
  if (page.viewportSize()!.width >= 1000) {
    await expect(page.locator(".save-tool")).toHaveCSS("margin-left", "6px");
    await expect(page.locator(".tool-more")).toHaveCSS("padding-left", "11px");
  }
});

test("APP-01: the workspace has the redesign's tints: a sage page and footer, a soft card edge, a white header", async ({
  page,
}) => {
  await open(page);
  const sage = "rgb(244, 246, 240)";
  await expect(page.locator(".app > main")).toHaveCSS("background-color", sage);
  await expect(page.locator(".ask-footer")).toHaveCSS("background-color", sage);
  await expect(page.locator(".tool-header")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator(".tool-frame")).toHaveCSS("border-top-color", "rgb(220, 227, 212)");
  // The ask bar keeps the controls' border, which has 3:1 contrast (decision A96).
  await expect(page.locator(".ask-bar")).toHaveCSS("border-top-color", "rgb(129, 134, 126)");
});
