import { clickToolAction } from "./support/tool-actions.ts";
import { selectWorkspace } from "./support/workspace-actions.ts";
import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { Artifact } from "@tessera/contracts";
import { wholePage } from "../../../evals/src/runner/run.ts";
import { en } from "../src/i18n/en.ts";
import { startApp, testTool, TOOL_START, workspaceWith, type AppHost } from "./support/app-host.ts";

// The tool panel fits its tool (APP-01, A89): the tool's page says how tall it lays out, and the
// host sizes the panel's frame to it, at least 20rem, so a long tool shows whole instead of in a
// 20rem window. A page made to fill its window doesn't grow it for ever, and full screen still
// fills the screen. Against a real Tessera on a temporary data folder (ENG-19).

let app: AppHost;
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(() => app.close());

/** A test tool with `html`, `css` and `js` of its own. */
const toolWith = (html: string, css = "", js = ""): Artifact => ({
  ...testTool(""),
  code: { html, css, js },
});

const toolFrame = (page: Page) => page.locator(".tool-frame iframe");
const inTool = (page: Page) =>
  page.frameLocator(".tool-frame iframe").frameLocator("iframe").frameLocator("iframe");
const frameHeight = async (page: Page) => (await toolFrame(page).boundingBox())?.height ?? 0;

/** Opens a new workspace named `title` with `tool`, and waits for its first paragraph. */
async function open(page: Page, title: string, tool: Artifact) {
  const name = `${title} ${Math.random().toString(36).slice(2, 7)}`;
  workspaceWith(app.folder, name, tool);
  await page.goto(app.url);
  // The newest workspace may open on its own; its button then says it is open.
  await selectWorkspace(page, name);
  await expect(inTool(page).locator("#text")).toBeVisible(TOOL_START);
}

test("APP-01, A89: the panel grows to show a long tool whole, and shrinks with it", async ({
  page,
}) => {
  const rows = Array.from({ length: 40 }, (_, i) => `<p class="row">Row ${i + 1}</p>`).join("");
  const js = `document.getElementById("less").addEventListener("click", () => {
  for (const row of document.querySelectorAll(".row")) row.remove();
});`;
  await open(
    page,
    "Long list",
    toolWith(`<p id="text">Top</p><button id="less">Less</button>${rows}`, "", js),
  );

  // Forty rows are far taller than 20rem (320 px): the frame grows to hold them all, so the last
  // row is inside the frame's box, not scrolled out of it.
  await expect.poll(() => frameHeight(page), TOOL_START).toBeGreaterThan(1000);
  const page_ = inTool(page);
  const last = await page_.locator(".row").last().boundingBox();
  const frame = await toolFrame(page).boundingBox();
  expect(last && frame && last.y + last.height <= frame.y + frame.height + 1).toBe(true);

  // With the rows gone the page is short again, and the frame comes back to its least, 20rem.
  await page_.getByRole("button", { name: "Less" }).click();
  await expect.poll(() => frameHeight(page)).toBeLessThan(400);
});

test("APP-01, A89: a tool made to fill its window doesn't grow its panel for ever", async ({
  page,
}) => {
  // A full-window block plus the standard's page padding is always taller than its window: each
  // growth would ask for the next. The host follows it only a few times.
  await open(
    page,
    "Full window",
    toolWith(`<div id="text">Fills</div>`, "#text { height: 100vh; }"),
  );
  // Each use of the tool lets the panel follow it once more, at most once a second; the click
  // that opened it counts as use for a few seconds, so this waits past that.
  await page.waitForTimeout(7000);
  const settled = await frameHeight(page);
  expect(settled).toBeLessThan(1000);
  await page.waitForTimeout(1000);
  expect(await frameHeight(page)).toBe(settled);
});

test("APP-01, A89: a tool whose height flips with its window's settles", async ({ page }) => {
  // Short windows get a tall block and tall ones a short block: each resize asks for the other.
  const css = `@media (max-height: 450px) { #text { height: 500px; } }
@media (min-height: 451px) { #text { height: 300px; } }`;
  await open(page, "Flipping", toolWith(`<div id="text">Flips</div>`, css));
  await page.waitForTimeout(7000);
  const settled = await frameHeight(page);
  await page.waitForTimeout(1000);
  expect(await frameHeight(page)).toBe(settled);
});

test("EVAL-07, ENG-14, A89: the runner's whole-page picture shows the page, and leaves it as it was", async ({
  page,
}) => {
  const rows = Array.from({ length: 60 }, (_, i) => `<p class="row">Row ${i + 1}</p>`).join("");
  // The tool counts the resizes of its own window, as a tool that saved on resize would see them.
  const js = `let resizes = 0;
addEventListener("resize", () => { resizes += 1; document.getElementById("resizes").textContent = String(resizes); });`;
  await open(
    page,
    "Pictured",
    toolWith(`<p id="text">Top</p><p id="resizes">0</p>${rows}`, "", js),
  );
  await expect.poll(() => frameHeight(page), TOOL_START).toBeGreaterThan(1500);
  await page.waitForTimeout(1000);
  const resizes = await inTool(page).locator("#resizes").textContent();
  const viewport = page.viewportSize();
  const total = Number(await page.evaluate("document.documentElement.scrollHeight"));

  const file = test.info().outputPath("whole-page.png");
  await wholePage(page, file);

  // A PNG's height is the big-endian number at bytes 20 to 23.
  expect(fs.readFileSync(file).readUInt32BE(20)).toBe(total);
  expect(page.viewportSize()).toEqual(viewport);
  expect(Number(await page.evaluate("scrollY"))).toBe(0);
  await page.waitForTimeout(500);
  await expect(inTool(page).locator("#resizes")).toHaveText(resizes!);
});

test("APP-01, A89: full screen still fills the screen with a short tool", async ({ page }) => {
  await open(page, "Short", testTool("Short"));
  await clickToolAction(page, en["tool.fullScreen"]);
  const viewport = page.viewportSize()!;
  await expect.poll(() => frameHeight(page)).toBeGreaterThan(viewport.height * 0.7);
});
