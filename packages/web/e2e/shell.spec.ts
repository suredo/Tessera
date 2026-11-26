import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { addToChat } from "../../server/src/chat/chat.ts";
import { ProviderError } from "../../server/src/providers/index.ts";
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

test("APP-02, APP-01, APP-09: after the first request, the first run is that conversation, with the field at the bottom (A100, A103)", async ({
  page,
}) => {
  // A model that never answers, so the request stays in progress until it is cancelled.
  const working = await startApp(undefined, {
    name: "never answers",
    live: false,
    run: (spec) =>
      new Promise((_, reject) =>
        spec.signal?.addEventListener(
          "abort",
          () => reject(new ProviderError("cancelled", "Stopped")),
          { once: true },
        ),
      ),
  });
  try {
    await page.goto(working.url);
    const field = page.getByRole("textbox", { name: en["request.label"] });
    await field.fill("A shopping list");
    await page.getByRole("button", { name: en["request.send"], exact: true }).click();
    // The invitation steps aside; the request and Tessera's progress show, with Cancel.
    await expect(page.locator(".first-run-welcome")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(en["home.heading"]);
    await expect(page.locator(".chat-log .from-person")).toContainText("A shopping list");
    await expect(page.locator(".first-run-working [role=status]")).toBeVisible();
    // The field waits at the bottom of the window, off while Tessera works.
    await expect(field).toBeDisabled();
    await expect(field).toHaveAttribute("placeholder", en["request.workingPlaceholder"]);
    const dock = (await page.locator(".first-run-dock").boundingBox())!;
    expect(Math.round(dock.y + dock.height)).toBe(page.viewportSize()!.height);
    // Details is a quiet link once something was asked (A103).
    await expect(page.getByRole("button", { name: en["details.show"] })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: en["request.cancel"] }).click();
    await expect(page.getByText(/The request was stopped\./)).toBeVisible();
    await expect(field).toBeEnabled();
  } finally {
    await working.close();
  }
});

test("APP-02, APP-01: a long first-run conversation scrolls in the window, and the field stays at its bottom (A100)", async ({
  page,
}) => {
  const long = await startApp();
  try {
    // More than a window of messages, kept with no workspace (A62).
    const said = Array.from({ length: 8 }, (_, n) => n);
    addToChat(
      long.folder,
      null,
      said.flatMap((n) => [
        { from: "person" as const, text: `Request ${n}: a list with more than one line.` },
        { from: "tessera" as const, text: `Reply ${n}.\n\nIt said what it could, at length.` },
      ]),
    );
    await page.goto(long.url);
    const height = page.viewportSize()!.height;
    const dock = page.locator(".first-run-dock");
    const bottom = async () => {
      const box = (await dock.boundingBox())!;
      return Math.round(box.y + box.height);
    };
    expect(await bottom()).toBe(height);
    const main = page.locator("main.first-run");
    expect(await main.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    await main.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    expect(await bottom()).toBe(height);
    await expect(page.getByText("Reply 7.", { exact: false })).toBeInViewport();
  } finally {
    await long.close();
  }
});
