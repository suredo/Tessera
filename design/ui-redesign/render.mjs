// Renders Codex's HTML mockups to PNG at their stated sizes.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [dir, outDir, list] = process.argv.slice(2);
const defaults = [
  ["a-focus.html", 1440, 900],
  ["b-chat-floating.html", 1440, 900],
  ["c-chat-docked.html", 1440, 900],
  ["d-workspaces-open.html", 1440, 900],
  ["g-wide-tool.html", 1440, 900],
  ["e-mobile.html", 390, 844],
  ["f-mobile-chat.html", 390, 844],
  ["h-start.html", 1440, 900],
  ["i-start-working.html", 1440, 900],
  ["j-start-setup.html", 1440, 900],
  ["k-start-mobile.html", 390, 844],
  ["l-settings.html", 1440, 900],
  ["m-settings-mobile.html", 390, 844],
  ["n-library.html", 1440, 900],
  ["o-library-mobile.html", 390, 844],
  ["p-trash.html", 1440, 900],
  ["q-trash-mobile.html", 390, 844],
  ["overview.html", 1600, 1000],
];
const jobs = list ? JSON.parse(list) : defaults;
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
for (const [file, width, height] of jobs) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  // Offline: nothing outside the file may load.
  await page.route(/^(?!file:)/, (route) => route.abort());
  await page.goto(pathToFileURL(path.join(dir, file)).href);
  await page.waitForTimeout(300);
  const size = await page.locator("html").evaluate((element) => ({
    w: element.scrollWidth,
    h: element.scrollHeight,
  }));
  const png = path.join(outDir, file.replace(".html", ".png"));
  await page.screenshot({ path: png, fullPage: true });
  console.log(file, "content", size.w, "x", size.h, "->", png);
  await page.close();
}
await browser.close();
