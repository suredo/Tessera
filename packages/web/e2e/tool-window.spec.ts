import { expect, test, type Page } from "@playwright/test";
import type { Artifact } from "@tessera/contracts";
import { en } from "../src/i18n/en.ts";
import { startApp, testTool, TOOL_START, workspaceWith, type AppHost } from "./support/app-host.ts";

// What a tool may do in its own window when the person acts (A92): copy to the clipboard after
// their click, and show a chart's values on hover. The sandbox limits what a tool reaches, not
// this. Against a real Tessera on a temporary data folder (ENG-19).

// The test page reads the clipboard back from the host page, which needs the read permission; the
// tool itself is granted only writing (SBX-13).
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

let app: AppHost;
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(() => app.close());

const toolWith = (html: string, js: string, capabilities: string[] = []): Artifact => ({
  ...testTool(""),
  code: { html, css: "", js },
  capabilities,
});
const inTool = (page: Page) =>
  page.frameLocator(".tool-frame iframe").frameLocator("iframe").frameLocator("iframe");

async function open(page: Page, title: string, tool: Artifact) {
  const name = `${title} ${Math.random().toString(36).slice(2, 7)}`;
  workspaceWith(app.folder, name, tool);
  await page.goto(app.url);
  await page
    .getByRole("region", { name: en["workspaces.heading"] })
    .getByRole("button", { name: new RegExp(`^(Open ${name}|${name}, open)$`) })
    .click();
  await expect(inTool(page).locator("#text")).toBeVisible(TOOL_START);
}

test("A92: a tool copies to the clipboard when the person clicks, and not on its own", async ({
  page,
}) => {
  // As it starts, before any click of the person's, the copy is refused.
  const js = `navigator.clipboard.writeText("Copied on its own").then(
  () => (document.getElementById("own").textContent = "copied"),
  () => (document.getElementById("own").textContent = "refused"),
);
document.getElementById("copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText("Milk, eggs, bread");
  document.getElementById("text").textContent = "Copied";
});`;
  await page.evaluate(() => navigator.clipboard.writeText("before")).catch(() => {});
  await open(
    page,
    "Copies",
    toolWith(`<p id="text">Ready</p><p id="own"></p><button id="copy">Copy</button>`, js),
  );
  await expect(inTool(page).locator("#own")).toHaveText("refused");
  await inTool(page).getByRole("button", { name: "Copy" }).click();
  await expect(inTool(page).locator("#text")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Milk, eggs, bread");
});

test("A92, CAP-04: hovering a chart's bar draws over it, as its value shows", async ({ page }) => {
  const js = `tessera.chart(document.getElementById("chart"), {
  type: "bar", title: "Sales", labels: ["Monday"], series: [{ name: "Sales", values: [10] }],
});`;
  await open(
    page,
    "Chart",
    toolWith(`<p id="text">Sales</p><div id="chart" data-hook="chart"></div>`, js, ["chart"]),
  );
  const canvas = inTool(page).locator("#chart canvas");
  await expect(canvas).toBeVisible(TOOL_START);
  const before = await canvas.screenshot();
  const box = (await canvas.boundingBox())!;
  // The one bar stands in the middle. Chart.js draws its tooltip on the canvas, so the test sees
  // the chart change under the pointer, not the text itself.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.6);
  await expect.poll(async () => (await canvas.screenshot()).equals(before)).toBe(false);
});
