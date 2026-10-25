import type { Page } from "@playwright/test";

// Waiting for a test page's script to be ready. The check runs on a timer, not on animation frames
// (Playwright's default): a page that isn't painting, as on a busy machine, gets no frames, and the
// check would never run though the page is ready. A reload in Edge on CI timed out so (#83).

/** Resolves once the page's script has set `global` on its window. */
export async function ready(page: Page, global: string): Promise<void> {
  await page.waitForFunction((name) => name in window, global, { polling: 100 });
}
