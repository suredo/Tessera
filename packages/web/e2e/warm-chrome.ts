import { chromium } from "@playwright/test";

// Opens Chrome once before any test and lays out a page with text and form fields. On a fresh CI
// runner, the first tests of each worker ran while Chrome was still cold: a check measured a tool
// before it had laid out, so its first row didn't wrap at 320 px or its fields weren't shown yet,
// and those tests failed while every later one passed (#302, as Edge's first pages did, #208). The
// time is printed, so a run shows whether that wait fell here.
export default async function warmChrome(): Promise<void> {
  const started = performance.now();
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 640 } });
    await page.setContent(
      `<label for="a">Book</label> <input id="a"> <label for="b">Show</label> <select id="b"><option>All</option></select> <button>Add</button> <p>Warming up.</p>`,
    );
    await page.evaluate(() => document.documentElement.scrollWidth);
  } finally {
    await browser.close();
  }
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`Chrome laid out its first page in ${seconds} s (#302).`);
}
