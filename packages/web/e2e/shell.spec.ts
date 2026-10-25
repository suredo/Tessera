import { expect, test } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { startApp, type AppHost } from "./support/app-host.ts";

// The host app's first screen in a real browser (TEST-06): Chrome and Edge, the supported
// browsers (RUN-06), at each fixed viewport, served by a real Tessera with no workspaces yet.

let app: AppHost;
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(() => app.close());

test("APP-02: the first screen invites the person to describe a tool, and fits the viewport (TEST-06, RUN-06)", async ({
  page,
}) => {
  await page.goto(app.url);
  await expect(page).toHaveTitle(en["app.title"]);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(en["home.heading"]);
  await expect(page.getByRole("status")).toHaveText(en["home.status"]);
  // Nothing wider than the window: at 320 px the page must not scroll sideways.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
