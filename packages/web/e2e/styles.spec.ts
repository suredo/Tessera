import { expect, test, type Page } from "@playwright/test";
import type { Artifact } from "../../contracts/src/index.ts";
import { startSandboxHost, toolFrame, type SandboxHost } from "./support/sandbox-host.ts";
import { ready } from "./support/ready.ts";

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
// And one more: an outline made transparent, with a day-long transition to keep it so. A
// transition outranks every important rule, so only stopping it on focus keeps the outline seen.
const slowFocusCss = `
#slow { outline: 3px solid transparent !important; transition: outline-color 86400s step-end !important; }`;
const hostileHtml = `<button id="plain">Plain</button>
<button id="inline" style="outline: none !important">Inline</button>
<button id="slow">Slow</button>`;

const ui = (mode: "standard" | "custom") => ({ standardVersion: 1, mode }) as const;
const tools: Record<string, Pick<Artifact, "code" | "ui">> = {
  "hostile-standard": {
    code: { html: hostileHtml, css: hostileCss + slowFocusCss, js: "" },
    ui: ui("standard"),
  },
  "hostile-custom": {
    code: { html: hostileHtml, css: hostileCss + slowFocusCss, js: "" },
    ui: ui("custom"),
  },
  "plain-standard": { code: { html: "<button>Go</button>", css: "", js: "" }, ui: ui("standard") },
  "plain-custom": { code: { html: "<button>Go</button>", css: "", js: "" }, ui: ui("custom") },
};

let host: SandboxHost;
test.beforeAll(async () => {
  host = await startSandboxHost(tools);
});
test.afterAll(() => host.close());

// The floor's outline colour, the UI standard's accent.
const ACCENT = "rgb(82, 105, 71)";

type TestWindow = { mountTool(container: HTMLElement, mountId: string): Promise<unknown> };

async function open(page: Page, mountId: string) {
  await page.goto(`${host.url}/`);
  await ready(page, "mountTool");
  await page.evaluate(
    (id) => (window as unknown as TestWindow).mountTool(document.body, id),
    mountId,
  );
  await expect(toolFrame(page).locator("button").first()).toBeVisible();
}

/** The computed styles that show focus, for a button focused from the keyboard. */
async function focused(page: Page, id: string) {
  const button = toolFrame(page).locator(`#${id}`);
  await button.focus();
  return button.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      focusVisible: el.matches(":focus-visible"),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
    };
  });
}

/**
 * The computed motion of a button without focus. A focused one has no transitions at all, so its
 * outline shows at once.
 */
const motion = (page: Page, id: string) =>
  toolFrame(page)
    .locator(`#${id}`)
    .evaluate((el) => ({
      focused: el.matches(":focus"),
      transitionDuration: getComputedStyle(el).transitionDuration,
      animationDuration: getComputedStyle(el).animationDuration,
    }));

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
        outlineColor: ACCENT,
      });
      expect(await motion(page, "inline")).toEqual({
        focused: false,
        transitionDuration: "1e-05s",
        animationDuration: "1e-05s",
      });
    });
  }
});

for (const mode of ["standard", "custom"] as const) {
  test(`RUN-05: a transition can't keep the focus outline from showing (${mode} mode)`, async ({
    page,
  }) => {
    await open(page, `hostile-${mode}`);
    // No reduced-motion preference, so the tool's transitions run, except on the outline.
    expect(await focused(page, "slow")).toMatchObject({
      focusVisible: true,
      outlineStyle: "solid",
      outlineWidth: "3px",
      outlineColor: ACCENT,
    });
  });
}

test("RUN-05: without the reduced-motion preference, a tool keeps its own motion", async ({
  page,
}) => {
  await open(page, "hostile-custom");
  expect(await motion(page, "plain")).toEqual({
    focused: false,
    transitionDuration: "5s",
    animationDuration: "3s",
  });
  // Focused, it has no transitions, so its outline shows at once.
  await toolFrame(page).locator("#plain").focus();
  expect(await motion(page, "plain")).toMatchObject({ focused: true, transitionDuration: "0s" });
});

test("RUN-05: an important inline style beats the floor, as no stylesheet can win against it (VER-01 flags it in M2)", async ({
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
