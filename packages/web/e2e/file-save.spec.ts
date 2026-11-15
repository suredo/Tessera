import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { Artifact } from "../../contracts/src/index.ts";
import { en } from "../src/i18n/en.ts";
import { startApp, TOOL_START, workspaceWith, type AppHost } from "./support/app-host.ts";

// Files out (CAP-03, A81), end to end in Chrome (TEST-06): a tool offers a file from a click; the
// host page asks the person in its own words, naming the file, its kind and size; on Save the
// browser downloads it under a name whose extension is the kind's, on Don't save nothing is
// saved. A real Tessera on a temporary data folder (ENG-19).

let app: AppHost;
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(() => app.close());

/** A tool that offers a list as CSV, under a name that says HTML, and a drawing as PNG. */
const saver: Artifact = {
  contractVersion: 4,
  connections: {},
  code: {
    html: `<p id="text">Ready</p>
<button id="list" type="button">Save the list</button>
<button id="drawing" type="button">Save the drawing</button>
<canvas id="canvas" width="8" height="6"></canvas>`,
    css: "",
    js: `const say = (text) => { document.getElementById("text").textContent = text; };
const offer = (file) => tessera.saveFile(file).then(
  (saved) => say(saved ? "Saved" : "Not saved"),
  (error) => say("Refused " + error.code),
);
document.getElementById("list").addEventListener("click", () =>
  offer({ name: "groceries.html", type: "text/csv", text: "item,quantity\\nmilk,2\\n" }));
document.getElementById("drawing").addEventListener("click", () => {
  const canvas = document.getElementById("canvas");
  const pen = canvas.getContext("2d");
  pen.fillStyle = "#2f6b3a";
  pen.fillRect(0, 0, 8, 6);
  offer({ name: "drawing", type: "image/png", bytesBase64: canvas.toDataURL("image/png").split(",")[1] });
});`,
  },
  data: { schemaVersion: 1, schema: {}, defaults: {}, migrations: [] },
  capabilities: ["files"],
  pins: [],
  ui: { standardVersion: 1, mode: "standard" },
};

const tool = (page: Page) =>
  page.frameLocator(".tool-frame iframe").frameLocator("iframe").frameLocator("iframe");
const question = (page: Page) => page.getByRole("alertdialog", { name: en["save.label"] });

/** Opens a new workspace running the saver, and clicks one of its buttons. */
async function offer(page: Page, button: string) {
  const title = `Saver ${Math.random().toString(36).slice(2, 7)}`;
  workspaceWith(app.folder, title, saver);
  await page.goto(app.url);
  await page.getByRole("button", { name: new RegExp(`^(Open ${title}|${title}, open)$`) }).click();
  await expect(tool(page).locator("#text")).toHaveText("Ready", TOOL_START);
  await tool(page).getByRole("button", { name: button }).click();
  return title;
}

test("CAP-03, A81: the person is asked in plain words, and on Save the browser saves the file under the kind's name", async ({
  page,
}) => {
  const title = await offer(page, "Save the list");
  const asked = question(page);
  await expect(asked).toBeVisible();
  await expect(asked).toContainText(`${title} offers a file to save`);
  await expect(asked).toContainText("groceries.csv, a table (CSV) of 21 bytes.");
  await expect(asked).toContainText(en["save.where"]);

  const download = page.waitForEvent("download");
  await asked.getByRole("button", { name: en["save.save"], exact: true }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe("groceries.csv");
  expect(fs.readFileSync(await saved.path(), "utf8")).toBe("item,quantity\nmilk,2\n");
  await expect(tool(page).locator("#text")).toHaveText("Saved");
  await expect(asked).toBeHidden();
});

test("A81: on Don't save nothing is saved, and the tool hears it", async ({ page }) => {
  let downloads = 0;
  page.on("download", () => (downloads += 1));
  await offer(page, "Save the list");
  await question(page).getByRole("button", { name: en["save.dontSave"], exact: true }).click();
  await expect(tool(page).locator("#text")).toHaveText("Not saved");
  await expect(question(page)).toBeHidden();
  expect(downloads).toBe(0);
});

test("CAP-03: an image the tool drew is saved as the PNG it is", async ({ page }) => {
  await offer(page, "Save the drawing");
  await expect(question(page)).toContainText("drawing.png, a PNG image of");
  const download = page.waitForEvent("download");
  await question(page).getByRole("button", { name: en["save.save"], exact: true }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe("drawing.png");
  const bytes = fs.readFileSync(await saved.path());
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  await expect(tool(page).locator("#text")).toHaveText("Saved");
});
