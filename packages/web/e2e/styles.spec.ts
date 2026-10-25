import { expect, test, type Page } from "@playwright/test";
import type { Artifact } from "../../contracts/src/index.ts";
import { startSandboxHost, toolFrame, type SandboxHost } from "./support/sandbox-host.ts";

// The host stylesheets in the sandbox (RUN-05, VER-06), in Chrome and Edge (TEST-06): the
// accessibility floor holds against a tool's own styles in every mode, and the UI standard's look
// loads in standard mode only. They arrive inline under the tool's strict CSP (RUN-01).

// Tries every way a stylesheet has to hide focus and keep motion: plain and important rules,
// rules in a layer named like the host's, and a layer of its own.
const hostileCss = `
*:focus, *:focus-visible { outline: none !important; outline-offset: 0 !important; }
@layer tessera-accessibility { :focus-visible { outline: none !important; } }
@layer mine { :focus-visible { outline: 0 none !important; } }
button { transition: opacity 5s linear !important; animation: spin 3s linear infinite !important; }
@keyframes spin { to { transform: rotate(360deg); } }`;
const hostileHtml = `<button id="plain">Plain</button>
<button id="inline" style="outline: none !important">Inline</button>`;

const ui = (mode: "standard" | "custom") => ({ standardVersion: 1, mode }) as const;
const tools: Record<string, Pick<Artifact, "code" | "ui">> = {
  "hostile-standard": { code: { html: hostileHtml, css: hostileCss, js: "" }, ui: ui("standard") },
  "hostile-custom": { code: { html: hostileHtml, css: hostileCss, js: "" }, ui: ui("custom") },
  "plain-standard": { code: { html: "<button>Go</button>", css: "", js: "" }, ui: ui("standard") },
  "plain-custom": { code: { html: "<button>Go</button>", css: "", js: "" }, ui: ui("custom") },
};

let host: SandboxHost;
test.beforeAll(async () => {
  host = await startSandboxHost(tools);
});
test.afterAll(() => host.close());

type TestWindow = { mountTool(container: HTMLElement, mountId: string): Promise<unknown> };

async function open(page: Page, mountId: string) {
  await page.goto(`${host.url}/`);
  await page.waitForFunction(() => "mountTool" in window);
  await page.evaluate(
    (id) => (window as unknown as TestWindow).mountTool(document.body, id),
    mountId,
  );
  await expect(toolFrame(page).locator("button").first()).toBeVisible();
}

/** The computed styles that show focus and motion, for a button focused from the keyboard. */
async function focused(page: Page, id: string) {
  const button = toolFrame(page).locator(`#${id}`);
  await button.focus();
  return button.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      focusVisible: el.matches(":focus-visible"),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      transitionDuration: style.transitionDuration,
      animationDuration: style.animationDuration,
    };
  });
}

test.describe("with reduced motion asked for", () => {
  test.use({ reducedMotion: "reduce" });

  for (const mode of ["standard", "custom"] as const) {
    test(`RUN-05: focus stays visible and motion stays reduced against the tool's own styles (${mode} mode)`, async ({
      page,
    }) => {
      await open(page, `hostile-${mode}`);
      expect(await focused(page, "plain")).toEqual({
        focusVisible: true,
        outlineStyle: "solid",
        outlineWidth: "3px",
        transitionDuration: "1e-05s",
        animationDuration: "1e-05s",
      });
    });
  }
});

test("RUN-05: without the reduced-motion preference, a tool keeps its own motion", async ({
  page,
}) => {
  await open(page, "hostile-custom");
  expect(await focused(page, "plain")).toMatchObject({
    outlineStyle: "solid",
    transitionDuration: "5s",
    animationDuration: "3s",
  });
});

test("RUN-05: an important inline style is the one way past the floor, which no stylesheet can win (VER-01 flags it in M2)", async ({
  page,
}) => {
  await open(page, "hostile-custom");
  // Recorded, not endorsed: CSS ranks an element's important inline style above every important
  // rule in a stylesheet. The static check (VER-01) must catch it before a tool is activated.
  expect(await focused(page, "inline")).toMatchObject({ focusVisible: true, outlineStyle: "none" });
});

/** What the UI standard sets, as the tool's document sees it. */
const standardLook = (page: Page) =>
  toolFrame(page)
    .locator("button")
    .evaluate((el) => ({
      accent: getComputedStyle(document.documentElement).getPropertyValue("--ui-accent").trim(),
      background: getComputedStyle(document.documentElement).backgroundColor,
      font: getComputedStyle(el).fontFamily,
      minHeight: getComputedStyle(el).minHeight,
    }));

test("VER-06: the UI standard's look loads in standard mode", async ({ page }) => {
  await open(page, "plain-standard");
  expect(await standardLook(page)).toEqual({
    accent: "#526947",
    background: "rgb(249, 250, 248)",
    font: '"Segoe UI", Arial, sans-serif',
    minHeight: "40px",
  });
});

test("VER-06: and not in custom mode, where the tool's own styles stand alone", async ({
  page,
}) => {
  await open(page, "plain-custom");
  const look = await standardLook(page);
  expect(look.accent).toBe("");
  expect(look.background).toBe("rgba(0, 0, 0, 0)");
  expect(look.minHeight).not.toBe("40px");
});
