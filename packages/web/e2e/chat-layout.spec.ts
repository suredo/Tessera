import { expect, test, type Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import type { Intent } from "../../contracts/src/index.ts";
import { UNKNOWN_USAGE, type Provider } from "../../server/src/providers/index.ts";
import { en } from "../src/i18n/en.ts";
import { startApp, testTool, TOOL_START, workspaceWith, type AppHost } from "./support/app-host.ts";
import { clickToolAction } from "./support/tool-actions.ts";
import { selectWorkspace } from "./support/workspace-actions.ts";

// Focus, floating and right-docked conversation (APP-01), without live model calls (ENG-19).
const clarify = {
  kind: "clarify",
  interfacePart: null,
  dataPart: null,
  behaviorChange: false,
  lookOnly: false,
  targetsCurrentTool: false,
  language: "en",
  features: [],
} as Intent;
const provider: Provider = {
  name: "scripted:layout",
  live: false,
  run: (spec) =>
    new Promise((done) =>
      setTimeout(
        () =>
          done({
            value: spec.schema.parse(clarify),
            usage: UNKNOWN_USAGE,
            raw: JSON.stringify(clarify),
          }),
        2000,
      ),
    ),
};
let app: AppHost;
test.beforeAll(async () => {
  app = await startApp(undefined, provider);
  const artifact = testTool("");
  artifact.code.html =
    '<label for="note">Note</label><input id="note"><div id="scroll" tabindex="0" style="height:200px;overflow:auto"><div style="height:1200px">Notes</div></div>';
  workspaceWith(app.folder, "Notes", artifact);
  workspaceWith(app.folder, "Wide board", { ...artifact, ui: { ...artifact.ui, width: "wide" } });
});
test.afterAll(() => app.close());
const frame = (page: Page) => page.locator(".tool-frame iframe");
const tool = (page: Page) =>
  page.frameLocator(".tool-frame iframe").frameLocator("iframe").frameLocator("iframe");
const divider = (page: Page) => page.getByRole("separator", { name: en["split.label"] });
const conversation = (page: Page) => page.getByRole("region", { name: en["chat.label"] });
const openChat = (page: Page) =>
  page.getByRole("button", { name: en["chat.open"], exact: true }).click();
async function open(page: Page) {
  await page.goto(app.url);
  await selectWorkspace(page, "Notes");
  await expect(tool(page).getByLabel("Note")).toBeVisible(TOOL_START);
}
async function dock(page: Page) {
  await openChat(page);
  await page.getByLabel(en["chat.position"]).selectOption("docked");
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  test("APP-01: Focus has one footer ask bar; typing changes no layout and sending opens conversation", async ({
    page,
  }) => {
    await open(page);
    await expect(conversation(page)).toBeHidden();
    await page.screenshot({ path: test.info().outputPath("focus.png") });
    const before = await frame(page).boundingBox();
    const request = page.getByRole("textbox", { name: en["request.label"] });
    await request.fill("Something");
    expect(await frame(page).boundingBox()).toEqual(before);
    await expect(conversation(page)).toBeHidden();
    expect(await request.count()).toBe(1);
    const pane = (await page.locator(".split-second").boundingBox())!;
    const footer = (await page.locator(".ask-footer").boundingBox())!;
    expect(pane.y + pane.height).toBeLessThanOrEqual(footer.y);
    await request.press("Enter");
    await expect(conversation(page)).toBeVisible();
    await expect(request).toBeDisabled();
    await expect(conversation(page)).toContainText(en["request.clarify"], { timeout: 30_000 });
    await expect(request).toBeEnabled();
  });

  test("APP-01, APP-11: dock is on the right, keyboard resizes it, preference survives reload while Focus resets", async ({
    page,
  }) => {
    await open(page);
    await dock(page);
    const pane = (await page.locator(".split-second").boundingBox())!;
    const chat = (await page.locator(".split-first").boundingBox())!;
    expect(chat.x).toBeGreaterThanOrEqual(pane.x + pane.width);
    await expect(divider(page)).toHaveAttribute("aria-valuenow", "35");
    await divider(page).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(divider(page)).toHaveAttribute("aria-valuenow", "40");
    await page.keyboard.press("End");
    await expect(divider(page)).toHaveAttribute("aria-valuenow", "60");
    await page.keyboard.press("Home");
    await expect(divider(page)).toHaveAttribute("aria-valuenow", "25");
    await page.reload();
    await expect(frame(page)).toBeVisible(TOOL_START);
    await expect(conversation(page)).toBeHidden();
    await openChat(page);
    await expect(page.getByLabel(en["chat.position"])).toHaveValue("docked");
    await expect(divider(page)).toHaveAttribute("aria-valuenow", "25");
  });

  test("APP-01: pointer resizing respects the right pane's limits", async ({ page }) => {
    await open(page);
    await dock(page);
    const handle = (await divider(page).boundingBox())!;
    const y = handle.y + handle.height / 2;
    await page.mouse.move(handle.x + handle.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(handle.x - 180, y, { steps: 5 });
    await page.mouse.up();
    expect(Number(await divider(page).getAttribute("aria-valuenow"))).toBeGreaterThan(35);
    const next = (await divider(page).boundingBox())!;
    await page.mouse.move(next.x + next.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(5000, y, { steps: 5 });
    await page.mouse.up();
    await expect(divider(page)).toHaveAttribute("aria-valuenow", "25");
  });

  test("APP-01, APP-11, RUN-02: chat toggles, floating corners and docking preserve runtime, input and scroll", async ({
    page,
  }) => {
    await open(page);
    await tool(page).getByLabel("Note").fill("Unfinished");
    await tool(page)
      .locator("#scroll")
      .evaluate((node) => {
        node.scrollTop = 150;
      });
    await frame(page).evaluate((node) => {
      node.dataset["kept"] = "same";
    });
    await openChat(page);
    const move = page.getByRole("button", { name: en["chat.move"] });
    await move.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByLabel(en["chat.corner"])).toHaveValue("bottom-left");
    const from = (await move.boundingBox())!;
    const area = (await page.locator(".split").boundingBox())!;
    await page.mouse.move(from.x + 10, from.y + 10);
    await page.mouse.down();
    await page.mouse.move(area.x + area.width - 20, area.y + 20);
    await page.mouse.up();
    await expect(page.getByLabel(en["chat.corner"])).toHaveValue("top-right");
    await page.screenshot({ path: test.info().outputPath("floating.png") });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByLabel(en["chat.position"]).selectOption("docked");
    await page.screenshot({ path: test.info().outputPath("docked.png") });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: en["chat.close"] }).click();
    await expect(page.getByRole("button", { name: en["chat.open"] })).toBeFocused();
    await openChat(page);
    await page.keyboard.press("Escape");
    await expect(conversation(page)).toBeHidden();
    await expect(frame(page)).toHaveAttribute("data-kept", "same");
    await expect(tool(page).getByLabel("Note")).toHaveValue("Unfinished");
    expect(
      await tool(page)
        .locator("#scroll")
        .evaluate((node) => node.scrollTop),
    ).toBe(150);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test("APP-01: declared widths and Expand control the tool frame", async ({ page }) => {
    await open(page);
    const comfortable = (await frame(page).boundingBox())!.width;
    expect(comfortable).toBeLessThanOrEqual(1100);
    await clickToolAction(page, en["tool.expand"]);
    expect((await frame(page).boundingBox())!.width).toBeGreaterThan(comfortable);
    await selectWorkspace(page, "Wide board");
    await expect(page.locator(".tool-panel")).toHaveAttribute("data-width", "wide");
    expect((await frame(page).boundingBox())!.width).toBeGreaterThan(comfortable);
    await expect(conversation(page)).toBeHidden();
  });

  test("APP-01, GEN-08: a reply reaches the notice if the conversation is closed while waiting", async ({
    page,
  }) => {
    await open(page);
    const earlier = await page.getByText(en["request.clarify"], { exact: true }).count();
    await page.getByRole("textbox", { name: en["request.label"] }).fill("Something");
    await page.getByRole("button", { name: en["request.send"] }).click();
    await page.getByRole("button", { name: en["chat.close"] }).click();
    await expect(page.locator(".notice [role=status]").first()).toHaveText(en["request.clarify"], {
      timeout: 30_000,
    });
    await openChat(page);
    await expect(page.getByText(en["request.clarify"])).toHaveCount(earlier + 1);
  });
});

test.describe("narrow fallback before the phone-sheet slice", () => {
  test.use({ viewport: { width: 320, height: 900 } });
  test("APP-01, TEST-06: Focus and conversation controls remain reachable without horizontal overflow", async ({
    page,
  }) => {
    await open(page);
    await expect(conversation(page)).toBeHidden();
    await openChat(page);
    await expect(page.getByRole("button", { name: en["chat.close"] })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await page.getByRole("button", { name: en["chat.close"] }).click();
    await expect(page.getByRole("textbox", { name: en["request.label"] })).toBeVisible();
  });
});
