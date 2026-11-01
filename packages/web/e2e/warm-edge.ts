import { chromium } from "@playwright/test";

// Opens Edge's first page once, before any test. On a fresh CI runner, Edge's first pages sometimes
// took about 27 s to open, on several workers at once, before any test reached the app; Edge's
// later launches in the same run were not slowed (#208). The time is printed, so a run shows
// whether that wait fell here.
export default async function warmEdge(): Promise<void> {
  const started = performance.now();
  const browser = await chromium.launch({ channel: "msedge" });
  try {
    const page = await browser.newPage();
    await page.goto("about:blank");
  } finally {
    await browser.close();
  }
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`Edge opened its first page in ${seconds} s (#208).`);
}
