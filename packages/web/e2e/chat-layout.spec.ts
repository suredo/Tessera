import { expect, test, type Page } from "@playwright/test";
import type { Intent } from "../../contracts/src/index.ts";
import { UNKNOWN_USAGE, type Provider } from "../../server/src/providers/index.ts";
import { en } from "../src/i18n/en.ts";
import { startApp, testTool, TOOL_START, workspaceWith, type AppHost } from "./support/app-host.ts";

// The main screen's layout (APP-01, APP-11): the chat beside the tool on a wide screen, with a
// divider the person moves by pointer or keyboard, kept for the next visit; stacked, chat first,
// on a narrow one; and the tool inline, expanded over the chat's place, or full screen, each by a
// host control. No model is asked anything. At 1280 and 320 px (TEST-06), on a temporary data
// folder (ENG-19).

// One slow, unclear request, for the reply that comes while the tool is expanded.
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
  workspaceWith(app.folder, "Notes", testTool("Hello from the tool"));
});
test.afterAll(() => app.close());

const chat = (page: Page) => page.getByRole("region", { name: en["chat.label"] });
const tool = (page: Page) => page.getByRole("region", { name: "Tool: Notes" });
const divider = (page: Page) => page.getByRole("separator", { name: en["split.label"] });
const box = async (page: Page, which: "chat" | "tool") => {
  const found = await (which === "chat" ? chat(page) : tool(page)).boundingBox();
  if (!found) throw new Error(`The ${which} isn't on screen.`);
  return found;
};

async function open(page: Page) {
  await page.goto(app.url);
  await expect(
    page
      .frameLocator(".tool-frame iframe")
      .frameLocator("iframe")
      .frameLocator("iframe")
      .getByText("Hello from the tool"),
  ).toBeVisible(TOOL_START);
}

// Each width is set when the test's page is made, never by resizing it (ENG-14).
test.describe("on a wide screen", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("APP-01, APP-11: on a wide screen the chat sits beside the tool, and the divider moves by keyboard, kept after a reload", async ({
    page,
  }) => {
    await open(page);
    const [left, right] = [await box(page, "chat"), await box(page, "tool")];
    expect(left.x + left.width).toBeLessThanOrEqual(right.x);
    await expect(divider(page)).toHaveAttribute("aria-valuenow", "40");
    await divider(page).focus();
    await page.keyboard.press("ArrowRight");
    await expect(divider(page)).toHaveAttribute("aria-valuenow", "45");
    await expect(divider(page)).toHaveAttribute(
      "aria-valuetext",
      "The chat takes 45% of the width",
    );
    expect((await box(page, "chat")).width).toBeGreaterThan(left.width);
    await page.keyboard.press("End");
    await expect(divider(page)).toHaveAttribute("aria-valuenow", "75");
    await page.keyboard.press("ArrowRight");
    await expect(divider(page)).toHaveAttribute("aria-valuenow", "75");
    await page.keyboard.press("Home");
    await expect(divider(page)).toHaveAttribute("aria-valuenow", "25");
    await page.reload();
    await expect(divider(page)).toHaveAttribute("aria-valuenow", "25");
  });

  test("APP-01: the divider follows the pointer, within its limits", async ({ page }) => {
    await open(page);
    const handle = await divider(page).boundingBox();
    if (!handle) throw new Error("The divider isn't on screen.");
    const y = handle.y + handle.height / 2;
    await page.mouse.move(handle.x + handle.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(handle.x + 200, y, { steps: 5 });
    await page.mouse.up();
    const moved = Number(await divider(page).getAttribute("aria-valuenow"));
    expect(moved).toBeGreaterThan(40);
    // From where it is now, far past its limit.
    const now = await divider(page).boundingBox();
    if (!now) throw new Error("The divider isn't on screen.");
    await page.mouse.move(now.x + now.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(5000, y, { steps: 5 });
    await page.mouse.up();
    await expect(divider(page)).toHaveAttribute("aria-valuenow", "75");
  });

  test("APP-01: the tool can be inline, expanded over the chat's place, or full screen, by the host's controls", async ({
    page,
  }) => {
    await open(page);
    const inline = await box(page, "tool");
    const expand = tool(page).getByRole("button", { name: en["tool.expand"] });
    await expand.click();
    await expect(chat(page)).toBeHidden();
    await expect(divider(page)).toBeHidden();
    const back = tool(page).getByRole("button", { name: en["tool.leaveExpanded"] });
    await expect(back).toHaveAttribute("aria-pressed", "true");
    expect((await box(page, "tool")).width).toBeGreaterThan(inline.width);
    await back.click();
    await expect(chat(page)).toBeVisible();
    await tool(page).getByRole("button", { name: en["tool.fullScreen"] }).click();
    // Full screen covers the window; expanding isn't offered there.
    await expect(tool(page).getByRole("button", { name: en["tool.expand"] })).toHaveCount(0);
    const full = await box(page, "tool");
    expect(full.width).toBeGreaterThanOrEqual(1280 - 1);
    await tool(page).getByRole("button", { name: en["tool.leaveFullScreen"] }).click();
    await expect(tool(page).getByRole("button", { name: en["tool.expand"] })).toBeVisible();
  });

  test("APP-01, GEN-08: a reply that comes while the tool is expanded is said in the notice, as the chat is out of sight", async ({
    page,
  }) => {
    await open(page);
    await page.getByRole("textbox", { name: en["request.label"] }).fill("Something");
    await page.getByRole("button", { name: en["request.send"] }).click();
    await tool(page).getByRole("button", { name: en["tool.expand"] }).click();
    await expect(page.locator(".notice [role=status]").first()).toHaveText(en["request.clarify"], {
      timeout: 30_000,
    });
    await tool(page).getByRole("button", { name: en["tool.leaveExpanded"] }).click();
    // Back beside the chat: the reply is there, and on the page once.
    await expect(page.getByText(en["request.clarify"])).toHaveCount(1);
  });
});

test.describe("on a narrow screen", () => {
  test.use({ viewport: { width: 320, height: 900 } });

  test("APP-01, TEST-06: on a narrow screen the chat stacks above the tool, with no divider", async ({
    page,
  }) => {
    await open(page);
    const [above, below] = [await box(page, "chat"), await box(page, "tool")];
    expect(above.y + above.height).toBeLessThanOrEqual(below.y);
    await expect(divider(page)).toBeHidden();
    // Nothing wider than the screen.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await page.screenshot({ path: test.info().outputPath("chat-layout-320.png"), fullPage: true });
  });
});
