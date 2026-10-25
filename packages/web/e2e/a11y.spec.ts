import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { deleteWorkspace } from "../../server/src/trash/index.ts";
import { saveVersion } from "../../server/src/versions/index.ts";
import { activateVersion, saveTool } from "../../server/src/workspaces/index.ts";
import { en } from "../src/i18n/en.ts";
import { startApp, testTool, workspaceWith, type AppHost } from "./support/app-host.ts";

// The host app is accessible (APP-11): an automated checker (axe) finds no WCAG 2.2 A or AA
// violation on any of its screens, and the parts a checker can't judge are checked directly:
// keyboard use, a visible focus and reduced motion. In Chrome and Edge at 320 and 1280 px
// (TEST-06), against a real Tessera of its own on a temporary data folder (ENG-19). A tool's own
// frame is left out: a tool meets the accessibility floor the runtime gives it (RUN-05, VER-06).

let app: AppHost;
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(() => app.close());

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** What axe finds on the page as it is now, one line per rule and element, so a failure says what. */
async function violations(page: Page): Promise<string[]> {
  const { violations: found } = await new AxeBuilder({ page })
    .withTags(WCAG)
    .exclude(".tool-frame")
    .analyze();
  return found.flatMap((rule) =>
    rule.nodes.map((node) => `${rule.id} (${rule.impact}): ${node.target.join(" ")}`),
  );
}

const toolText = (page: Page) =>
  page
    .frameLocator(".tool-frame iframe")
    .frameLocator("iframe")
    .frameLocator("iframe")
    .locator("#text");
const section = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true }).click();

test("APP-11, APP-02: the first-run screen has no accessibility violations", async ({ page }) => {
  // This Tessera starts empty, so its first screen shows (the tests run in order).
  await page.goto(app.url);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(en["home.heading"]);
  expect(await violations(page)).toEqual([]);
});

test("APP-11: every screen and confirmation of the main app has no accessibility violations", async ({
  page,
}) => {
  const name = `Errands ${Math.random().toString(36).slice(2, 7)}`;
  const id = workspaceWith(app.folder, name, testTool("Version one"));
  expect(
    activateVersion(app.folder, id, saveVersion(app.folder.db, testTool("Version two")), 1).ok,
  ).toBe(true);
  saveTool(app.folder, id, `Weekly ${name}`);
  deleteWorkspace(app.folder, workspaceWith(app.folder, `Old ${name}`, testTool("Old")));

  // The main screen, with the tool running and its history.
  await page.goto(app.url);
  await page.getByRole("button", { name: new RegExp(`^(Open ${name}|${name}, open)$`) }).click();
  await expect(toolText(page)).toHaveText("Version two");
  expect(await violations(page)).toEqual([]);

  // A restore's confirmation.
  await page.getByRole("button", { name: "Restore version 1" }).click();
  await expect(page.getByRole("group", { name: "Restore version 1?" })).toBeVisible();
  expect(await violations(page)).toEqual([]);
  await page.getByRole("button", { name: en["history.cancel"] }).click();

  // Renaming, with its form open.
  await page.getByRole("button", { name: `Rename ${name}` }).click();
  expect(await violations(page)).toEqual([]);
  await page.getByRole("button", { name: en["library.cancel"], exact: true }).click();

  // My tools.
  await section(page, en["nav.library"]);
  await expect(page.getByRole("heading", { name: `Weekly ${name}` })).toBeVisible();
  expect(await violations(page)).toEqual([]);

  // The trash, and emptying it, asked first.
  await section(page, en["nav.trash"]);
  await page.getByRole("button", { name: en["trash.emptyNow"] }).click();
  await expect(page.getByRole("group", { name: en["trash.confirmHeading"] })).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test("APP-11: the app works by keyboard alone, with the focus always visible", async ({ page }) => {
  const name = `Keys ${Math.random().toString(36).slice(2, 7)}`;
  workspaceWith(app.folder, name, testTool("Typed"));
  await page.goto(app.url);
  // Tab to the workspace's own button, and open it with Enter.
  const open = page.getByRole("button", { name: new RegExp(`^(Open ${name}|${name}, open)$`) });
  for (let presses = 0; presses < 60; presses += 1) {
    await page.keyboard.press("Tab");
    if (await open.evaluate((element) => element === document.activeElement)) break;
  }
  await expect(open).toBeFocused();
  // The focus can be seen: the host's outline, 3 px wide.
  const outline = await open.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });
  expect(outline).toEqual({ style: "solid", width: "3px" });
  await page.keyboard.press("Enter");
  await expect(toolText(page)).toHaveText("Typed");

  // Minimize and show again, by keyboard.
  const minimize = page.getByRole("button", { name: en["tool.minimize"] });
  await minimize.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(`${name} is minimized.`)).toBeVisible();
  await page.getByRole("button", { name: en["tool.restore"] }).focus();
  await page.keyboard.press("Space");
  await expect(toolText(page)).toHaveText("Typed");
});

test("APP-11: with reduced motion asked for, nothing in the host moves", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(app.url);
  const longest = await page.evaluate(() => {
    const seconds = (value: string) =>
      Math.max(
        ...value
          .split(",")
          .map((part) => parseFloat(part) * (part.trim().endsWith("ms") ? 0.001 : 1)),
      );
    return Math.max(
      ...[...document.querySelectorAll("body *")].map((element) => {
        const style = getComputedStyle(element);
        return Math.max(seconds(style.transitionDuration), seconds(style.animationDuration));
      }),
    );
  });
  expect(longest).toBeLessThanOrEqual(0.001);
});
