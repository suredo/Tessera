// Renders Codex's HTML mockups to PNG at their stated sizes.
import { chromium } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [dir, outDir, list] = process.argv.slice(2);
const defaults = [
  ["mockup-desktop.html", 1440, 900],
  ["mockup-mobile.html", 390, 844],
  ["mockup-annotated.html", 1900, 900],
];
const jobs = list ? JSON.parse(list) : defaults;
const browser = await chromium.launch({ channel: "chrome" });
for (const [file, width, height] of jobs) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  // Offline: nothing outside the file may load.
  await page.route(/^(?!file:)/, (route) => route.abort());
  await page.goto(pathToFileURL(path.join(dir, file)).href);
  await page.waitForTimeout(300);
  const size = await page.evaluate(() => ({
    w: document.documentElement.scrollWidth,
    h: document.documentElement.scrollHeight,
  }));
  const png = path.join(outDir, file.replace(".html", ".png"));
  await page.screenshot({ path: png, fullPage: true });
  console.log(file, "content", size.w, "x", size.h, "->", png);
  await page.close();
}
await browser.close();
