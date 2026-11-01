import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { seedSamples } from "../../../scripts/seed.ts";
import { saveVersion } from "../../server/src/versions/index.ts";
import {
  activateVersion,
  getWorkspace,
  listWorkspaces,
} from "../../server/src/workspaces/index.ts";
import { en } from "../src/i18n/en.ts";
import { WATCHDOG_DEFAULTS } from "../../runtime/src/host.ts";
import { startApp, testTool, workspaceWith, type AppHost } from "./support/app-host.ts";

// The host app is accessible (APP-11): an automated checker (axe) finds no WCAG 2.2 A or AA
// violation on any of its screens, forms or confirmations, and the parts a checker can't judge are
// checked directly: keyboard use, a visible focus and reduced motion. In Chrome and Edge at 320 and
// 1280 px (TEST-06), against a real Tessera of its own on a temporary data folder (ENG-19), which
// starts empty and is then filled with the sample workspaces. A tool's own frame is left out: a
// tool meets the accessibility floor the runtime gives it (RUN-05, VER-06).

// Nothing here is about speed. Each test runs full axe scans, about 1 s idle but 4-5 s each on a
// loaded machine, and the keyboard test presses Tab dozens of times, each a round trip to the
// browser: with the full browser suite running, they pass the 30 s default (#210, #211).
test.describe.configure({ timeout: 90_000 });
// The runtime gives a starting tool this long to answer before it stops it, so a test waits as
// long for its heading; on a loaded machine a start takes more than the 5 s default (#211).
const TOOL_START = { timeout: WATCHDOG_DEFAULTS.startupMs };

let app: AppHost;
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(() => app.close());

/** Fills this Tessera with the sample workspaces, once, for whichever test needs them first. */
function seeded() {
  if (listWorkspaces(app.folder).length === 0) seedSamples(app.folder);
}

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

/** The longest transition or animation anywhere in the host now, in seconds. */
const longestMotion = (page: Page) =>
  page.evaluate(() => {
    const seconds = (value: string) =>
      Math.max(
        ...value
          .split(",")
          .map((part) => parseFloat(part) * (part.trim().endsWith("ms") ? 0.001 : 1)),
      );
    return Math.max(
      0,
      ...[...document.querySelectorAll("body *")].map((element) => {
        const style = getComputedStyle(element);
        return Math.max(seconds(style.transitionDuration), seconds(style.animationDuration));
      }),
    );
  });

const toolHeading = (page: Page) =>
  page
    .frameLocator(".tool-frame iframe")
    .frameLocator("iframe")
    .frameLocator("iframe")
    .getByRole("heading", { level: 1 });
const section = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true }).click();
const workspaceButton = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^(Open ${name}|${name}, open)$`) });
const cancel = (page: Page) =>
  page.getByRole("button", { name: en["library.cancel"], exact: true }).click();

/**
 * Presses Tab (or Shift+Tab) until `target` has the focus, as a keyboard user would reach it, and
 * checks the focus can be seen there: the host's 3 px solid outline.
 */
async function tabTo(page: Page, target: Locator, key: "Tab" | "Shift+Tab" = "Tab") {
  for (let presses = 0; presses < 80; presses += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press(key);
  }
  await expect(target).toBeFocused();
  const outline = await target.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });
  expect(outline).toEqual({ style: "solid", width: "3px" });
}

/** Checks the host as it is now, with axe and for motion (reduced motion is asked for). */
async function check(page: Page) {
  expect(await violations(page)).toEqual([]);
  expect(await longestMotion(page)).toBeLessThanOrEqual(0.001);
}
test("APP-11, APP-02: the first-run screen has no accessibility violations, and nothing moves", async ({
  page,
}) => {
  // This Tessera starts empty, so its first screen shows (the tests run in order).
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(app.url);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(en["home.heading"]);
  await check(page);
});

/** The app with the samples in it, asking for reduced motion, on `name`'s workspace. */
async function opened(page: Page, name: string) {
  seeded();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(app.url);
  await workspaceButton(page, name).click();
  await expect(toolHeading(page)).toHaveText(name, TOOL_START);
}

test("APP-11: the main screen, full screen and a restore that loses data have no violations, and nothing moves", async ({
  page,
}) => {
  await opened(page, "Shopping list");
  await check(page);
  await page.getByRole("button", { name: en["tool.fullScreen"] }).click();
  await expect(page.locator(".tool-panel.full-screen")).toBeVisible();
  await check(page);
  await page.getByRole("button", { name: en["tool.leaveFullScreen"] }).click();
  await page.getByRole("button", { name: "Restore version 1" }).click();
  await expect(page.getByRole("group", { name: "Restore version 1?" })).toContainText(
    en["history.losesData"],
  );
  await check(page);
});

test("APP-11: a restore that keeps the data has no violations, and nothing moves", async ({
  page,
}) => {
  // Two versions with the same data shape, so restoring the first keeps the data.
  seeded();
  if (!listWorkspaces(app.folder).some((w) => w.title === "Two versions")) {
    const id = workspaceWith(app.folder, "Two versions", testTool("Version one"));
    const second = saveVersion(app.folder.db, testTool("Version two"));
    expect(
      activateVersion(app.folder, id, second, getWorkspace(app.folder, id)!.dataRevision).ok,
    ).toBe(true);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(app.url);
  await workspaceButton(page, "Two versions").click();
  await page.getByRole("button", { name: "Restore version 1" }).click();
  await expect(page.getByRole("group", { name: "Restore version 1?" })).toContainText(
    en["history.keepsData"],
  );
  await check(page);
});

test("APP-11: a workspace's rename and save forms have no violations, and nothing moves", async ({
  page,
}) => {
  await opened(page, "Shopping list");
  await page.getByRole("button", { name: "Rename Shopping list" }).click();
  await check(page);
  await cancel(page);
  await page.getByRole("button", { name: "Save Shopping list to my tools" }).click();
  await expect(page.getByLabel(en["workspaces.saveLabel"])).toBeVisible();
  await check(page);
});

test("APP-11: my tools and its forms have no violations, and nothing moves", async ({ page }) => {
  await opened(page, "Garden notes");
  await section(page, en["nav.library"]);
  await expect(page.getByRole("heading", { name: "Garden journal" })).toBeVisible();
  await check(page);
  await page.getByRole("button", { name: "Rename Garden journal" }).click();
  await check(page);
  await cancel(page);
  await page.getByRole("button", { name: "Save Garden journal as a new tool" }).click();
  await expect(page.getByLabel(en["library.newName"])).toBeVisible();
  await check(page);
});

test("APP-11: the trash and emptying it have no violations, and nothing moves", async ({
  page,
}) => {
  await opened(page, "Garden notes");
  await section(page, en["nav.trash"]);
  await expect(page.getByRole("heading", { name: "Old packing list" })).toBeVisible();
  await check(page);
  await page.getByRole("button", { name: en["trash.emptyNow"] }).click();
  await expect(page.getByRole("group", { name: en["trash.confirmHeading"] })).toBeVisible();
  await check(page);
});

test("APP-11: the app works by keyboard alone, with the focus always visible", async ({ page }) => {
  seeded();
  await page.goto(app.url);
  await expect(workspaceButton(page, "Garden notes")).toBeVisible();

  // Open a workspace: Tab to it, Enter.
  await tabTo(page, workspaceButton(page, "Garden notes"));
  await page.keyboard.press("Enter");
  await expect(toolHeading(page)).toHaveText("Garden notes", TOOL_START);

  // Minimize and show the tool again: Tab to each, Enter, then Space.
  await tabTo(page, page.getByRole("button", { name: en["tool.minimize"] }));
  await page.keyboard.press("Enter");
  await expect(page.getByText("Garden notes is minimized.")).toBeVisible();
  await tabTo(page, page.getByRole("button", { name: en["tool.restore"] }), "Shift+Tab");
  await page.keyboard.press("Space");
  await expect(toolHeading(page)).toHaveText("Garden notes", TOOL_START);

  // A form: Tab to Rename, Enter; its field has the focus; type and Enter saves.
  await tabTo(page, page.getByRole("button", { name: "Rename Garden notes" }), "Shift+Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("New name for Garden notes")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Garden plans");
  await page.keyboard.press("Enter");
  await expect(workspaceButton(page, "Garden plans")).toBeVisible();

  // A confirmation: Tab to Restore, Enter; Tab on to its Cancel, Enter closes it.
  await workspaceButton(page, "Shopping list").click();
  await expect(toolHeading(page)).toHaveText("Shopping list", TOOL_START);
  await tabTo(page, page.getByRole("button", { name: "Restore version 1" }));
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("group", { name: "Restore version 1?" });
  await tabTo(page, confirm.getByRole("button", { name: en["history.cancel"] }));
  await page.keyboard.press("Enter");
  await expect(confirm).toHaveCount(0);
});
