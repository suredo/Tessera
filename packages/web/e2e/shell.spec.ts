import { expect, test } from "@playwright/test";
import { en } from "../src/i18n/en.ts";

// The web shell in a real browser (TEST-06): Chrome and Edge, the supported browsers (RUN-06), at
// each fixed viewport.
test("the first screen shows its host text and fits the viewport (TEST-06, RUN-06)", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle(en["app.title"]);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(en["home.heading"]);
  await expect(page.getByRole("status")).toHaveText(en["home.status"]);
  // Nothing wider than the window: at 320 px the page must not scroll sideways.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
