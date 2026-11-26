import { expect, test } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { startApp, testTool, workspaceWith, type AppHost } from "./support/app-host.ts";
import { clickWorkspaceAction, openWorkspaces } from "./support/workspace-actions.ts";

// The host app's first screen in a real browser (TEST-06): Chrome, the supported
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
  // The setup check passed, so the request box is offered (GEN-01, PLAT-03).
  await expect(page.getByRole("textbox", { name: en["request.label"] })).toBeVisible();
  await expect(page.getByRole("button", { name: en["request.send"] })).toBeVisible();
  // Nothing wider than the window: at 320 px the page must not scroll sideways.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("APP-02, APP-01, APP-11: the first run has the header and drawer, a large field with its hint, and the other places (A100)", async ({
  page,
}) => {
  await page.goto(app.url);
  const width = page.viewportSize()!.width;
  // The header as on every screen: Workspaces, then Tessera; its drawer says there is nothing yet.
  const header = page.locator(".page-header");
  await expect(header).toContainText(en["app.title"]);
  expect((await header.boundingBox())!.height).toBe(width >= 1000 ? 64 : 76);
  const drawer = await openWorkspaces(page);
  await expect(drawer.getByText(en["workspaces.none"])).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  // The large field: three lines, a hint, and Send named on the button (h-start).
  const field = page.getByRole("textbox", { name: en["request.label"] });
  await expect(field).toHaveAttribute("rows", "3");
  await expect(page.getByText(en["request.hint"])).toBeVisible();
  const send = page.getByRole("button", { name: en["request.send"], exact: true });
  await expect(send).toHaveText(en["request.send"]);
  const card = (await page.locator(".ask-card").boundingBox())!;
  // 632 px wide in a wide window, centred; 16 px from the sides on a phone (k-start-mobile).
  if (width >= 1000) {
    expect(card.width).toBe(632);
    expect(Math.abs(card.x + card.width / 2 - width / 2)).toBeLessThanOrEqual(1);
  } else {
    expect(Math.round(card.x)).toBe(16);
  }
  // The other places, each a 44 px target; the trash is there even when it is empty.
  const places = page.getByRole("navigation", { name: en["home.places"] });
  for (const name of [en["home.connections"], en["home.trash"], en["workspaces.setup"]]) {
    const box = (await places.getByRole("button", { name, exact: true }).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect(
    (await places.getByText(en["archive.importLabel"]).boundingBox())!.height,
  ).toBeGreaterThanOrEqual(44);
  // Nothing was asked yet, so there is no conversation and no details.
  await expect(page.getByText(en["chat.empty"])).toHaveCount(0);
  await expect(page.getByRole("button", { name: en["details.show"] })).toHaveCount(0);
});

test("APP-03: deleting the last workspace comes back here, and says it is in the trash", async ({
  page,
}) => {
  workspaceWith(app.folder, "Only one", testTool("The only tool"));
  await page.goto(app.url);
  await clickWorkspaceAction(page, "Move Only one to the trash");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(en["home.heading"]);
  await expect(
    page.getByText("Only one is in the trash. You can restore it for 30 days."),
  ).toBeVisible();
});
