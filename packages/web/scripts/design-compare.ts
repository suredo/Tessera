// Docs: docs/code/web/package.md
// `pnpm design:compare [state ...]`: each UI redesign mockup beside the app in the same state, at the
// mockup's window size and at the browser tests', with the differences measured at the mockup's, in
// test-output/design-compare/ (ENG-32). After `pnpm build`. It starts its own
// Tessera on a temporary folder with the sample tools (ENG-19), and sends no request, so no model is
// ever called.

import { chromium, type Browser, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { en } from "../src/i18n/en.ts";
import { startApp, testTool, TOOL_START, workspaceWith } from "../e2e/support/app-host.ts";
import { openWorkspaces, selectWorkspace } from "../e2e/support/workspace-actions.ts";
import { addToChat } from "../../server/src/chat/chat.ts";
import { listWorkspaces } from "../../server/src/workspaces/index.ts";
import { seedSamples } from "../../../scripts/seed.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const mockups = path.join(root, "design", "ui-redesign");
const out = path.join(root, "test-output", "design-compare");

// The app at the widths the browser tests use; each mockup at the size it was drawn for
// (design/ui-redesign/README.md), since the mockups don't reflow, then shown at the app's width.
const DESKTOP = { app: { width: 1280, height: 800 }, mockup: { width: 1440, height: 900 } };
const PHONE = { app: { width: 320, height: 700 }, mockup: { width: 390, height: 844 } };
const LIST = "Shopping list";
const WIDE = "Wide board";

type State = {
  id: string;
  title: string;
  viewport: typeof DESKTOP;
  /** Puts the app, already open on its first screen, into this state. */
  reach(page: Page): Promise<void>;
};

async function openTool(page: Page, name = LIST) {
  await selectWorkspace(page, name);
  await page.locator(".tool-frame iframe").waitFor(TOOL_START);
}
async function openConversation(page: Page, position?: "float" | "dock") {
  await page.getByRole("button", { name: en["chat.open"], exact: true }).click();
  if (position) {
    // Choose in the position menu, then close it, as the mockups show the panel without it.
    await page.getByRole("button", { name: en["chat.position"], exact: true }).click();
    await page
      .getByRole("radio", { name: en[position === "float" ? "chat.float" : "chat.dock"] })
      .check();
    await page.keyboard.press("Escape");
  }
}

/** The mockup states of docs/roadmap/ui-redesign.md, at the widths the browser tests use. */
const STATES: State[] = [
  { id: "a-focus", title: "Focus", viewport: DESKTOP, reach: (page) => openTool(page) },
  {
    id: "b-chat-floating",
    title: "Floating chat",
    viewport: DESKTOP,
    reach: async (page) => {
      await openTool(page);
      await openConversation(page, "float");
    },
  },
  {
    id: "c-chat-docked",
    title: "Docked chat",
    viewport: DESKTOP,
    reach: async (page) => {
      await openTool(page);
      await openConversation(page, "dock");
    },
  },
  {
    id: "d-workspaces-open",
    title: "Workspaces",
    viewport: DESKTOP,
    reach: async (page) => {
      await openTool(page);
      await openWorkspaces(page);
    },
  },
  {
    id: "g-wide-tool",
    title: "A wide tool",
    viewport: DESKTOP,
    reach: (page) => openTool(page, WIDE),
  },
  { id: "e-mobile", title: "Phone", viewport: PHONE, reach: (page) => openTool(page) },
  {
    id: "f-mobile-chat",
    title: "Phone chat",
    viewport: PHONE,
    reach: async (page) => {
      await openTool(page);
      await openConversation(page);
    },
  },
];

/** A board that declares the wide panel, which the samples don't have. */
function wideBoard() {
  const tool = testTool("");
  const column = (name: string, cards: string[]) =>
    `<section><h2>${name}</h2>${cards.map((card) => `<p>${card}</p>`).join("")}</section>`;
  tool.code.html =
    '<div style="display:grid;grid-template-columns:repeat(4,minmax(12rem,1fr));gap:1rem">' +
    column("To do", ["Book the venue", "Send invitations"]) +
    column("Doing", ["Choose the menu"]) +
    column("Waiting", ["Quote from the florist"]) +
    column("Done", ["Set the date"]) +
    "</div>";
  tool.ui.width = "wide";
  return tool;
}

/** The parts measured in both, as [mockup selector, app selector]. The mockups' parts outside the
 * state on screen are left out, as the app's are. */
const PARTS: Record<string, [string, string]> = {
  header: [".t-header", ".tool-header"],
  Workspaces: [
    ".t-header > .t-workspaces, .t-mobile-workspaces > summary",
    ".tool-header .drawer-opener",
  ],
  Undo: [".t-actions > button:first-child", ".tool-header-actions > .header-action:first-of-type"],
  History: [".t-actions > details:not(.t-more) > summary", ".history-opener"],
  "Full screen": [".t-actions > [aria-label='Full screen tool']", ".full-screen-opener"],
  More: [".t-more > summary", ".tool-more"],
  title: [".t-heading h1", ".tool-heading h1"],
  "kept line": [".t-saving", ".tool-heading p"],
  Save: [".t-actions > .t-outline", ".save-tool > button"],
  card: [".t-canvas", ".tool-frame"],
  footer: [".t-footer", ".ask-footer"],
  "ask bar": [".t-ask", ".ask-bar"],
  "ask field": [".t-ask input", ".ask-bar textarea"],
  "Open conversation": [".t-ask .t-open", ".ask-open"],
  Send: [".t-ask .t-send", ".ask-send"],
  conversation: [".t-chat, .t-sheet", ".split-first"],
  "conversation head": [".t-chathead", ".conversation-head"],
  "conversation title": [".t-chathead h2", ".conversation-head h2"],
  "Position menu button": [".t-position > summary", ".conversation-position"],
  "conversation close": [
    ".t-chathead > .t-icononly, .t-chathead > .t-row > .t-icononly",
    ".conversation-head > .icon-button:last-child",
  ],
  messages: [".t-messages", ".split-first .chat"],
  "your message": [".person", ".from-person"],
  speaker: [".speaker", ".chat-speaker"],
  hint: [".t-chatfoot", ".conversation-hint"],
  drawer: ["aside.t-drawer", ".workspace-drawer"],
  "drawer close": [".t-drawerhead .t-icononly", ".drawer-heading .icon-button"],
  "New tool": [".t-drawer .t-new", ".drawer-new"],
  "My tools": [".t-drawer .t-nav", ".drawer-nav"],
  "Recent work": [".t-eyebrow", ".workspace-drawer .workspaces h2"],
  "drawer search": [".t-search input", ".workspace-search input"],
  Import: [".t-drawerbottom .t-button:first-child", ".drawer-footer .import-file label"],
  Setup: [".t-drawerbottom .t-button:last-of-type", ".drawer-footer nav button:last-child"],
  "open row": [".t-workspace.t-current", ".workspace.open"],
};
type Measure = Record<string, string | number>;

/** Each part's box and look; nothing for a part that isn't on screen. */
function measure(page: Page, side: 0 | 1) {
  const selectors = Object.entries(PARTS).map(([name, pair]) => [name, pair[side]] as const);
  return page.evaluate((selectors) => {
    const found: Record<string, Record<string, string | number>> = {};
    const round = (value: number) => Math.round(value * 10) / 10;
    for (const [name, selector] of selectors) {
      const element = [...document.querySelectorAll(selector)].find(
        (one) => one.checkVisibility() && one.getBoundingClientRect().width > 0,
      );
      if (!element) continue;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      found[name] = {
        x: round(box.x),
        y: round(box.y),
        width: round(box.width),
        height: round(box.height),
        font: `${style.fontSize} ${style.fontWeight}`,
        color: style.color,
        background: style.backgroundColor,
        border:
          style.borderTopWidth === "0px" || style.borderTopColor === "rgba(0, 0, 0, 0)"
            ? "none"
            : `${style.borderTopWidth} ${style.borderTopColor}`,
        radius: style.borderTopLeftRadius,
        padding: style.padding,
      };
    }
    return found;
  }, selectors);
}

/** Every measured difference, a line each, for a person to judge: the content isn't the same. */
function differences(mockup: Record<string, Measure>, app: Record<string, Measure>) {
  const lines: string[] = [];
  for (const name of Object.keys(PARTS)) {
    const drawn = mockup[name];
    const real = app[name];
    if (!drawn && !real) continue;
    if (!drawn || !real) {
      lines.push(`${name}: only in the ${drawn ? "mockup" : "app"}`);
      continue;
    }
    for (const [key, value] of Object.entries(drawn)) {
      const other = real[key]!;
      const same =
        typeof value === "number" ? Math.abs(value - Number(other)) < 0.5 : value === other;
      if (!same) lines.push(`${name} ${key}: ${value} / ${other}`);
    }
  }
  return lines;
}

/** The app in this state at this size, its screenshot and its measurements. */
async function shootApp(
  browser: Browser,
  state: State,
  url: string,
  size: { width: number; height: number },
  file: string,
) {
  const app = await browser.newPage({ viewport: size });
  try {
    await app.goto(url);
    await state.reach(app);
    // Nothing hovered, so no hover style shows or is measured.
    await app.mouse.move(0, 0);
    // Let panels finish opening and the tool finish drawing.
    await app.waitForTimeout(700);
    await app.screenshot({ path: path.join(out, file) });
    return await measure(app, 1);
  } finally {
    await app.close();
  }
}

/** Two screenshots beside each other, each shown at this width. */
async function pair(
  browser: Browser,
  name: string,
  { width, height }: { width: number; height: number },
  images: [label: string, file: string][],
) {
  // A page beside the two images, so it may load them: a page set from memory can't load files.
  const html = path.join(out, `${name}.html`);
  fs.writeFileSync(
    html,
    `<!doctype html><body style="margin:0;padding:16px;font:14px system-ui;display:flex;gap:16px">` +
      images
        .map(
          ([label, file]) =>
            `<figure style="margin:0"><figcaption>${label}</figcaption>` +
            `<img style="display:block;border:1px solid #999;width:${width}px" src="${file}"></figure>`,
        )
        .join("") +
      "</body>",
  );
  const page = await browser.newPage({ viewport: { width: width * 2 + 48, height: height + 64 } });
  await page.goto(pathToFileURL(html).href);
  await page.waitForFunction(() =>
    [...document.images].every((image) => image.complete && image.naturalWidth > 0),
  );
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
  await page.close();
}

async function shoot(browser: Browser, state: State, url: string) {
  const { id, title, viewport } = state;
  const mockup = await browser.newPage({ viewport: viewport.mockup });
  // Offline, as render.mjs: nothing outside the file may load.
  await mockup.route(/^(?!file:)/, (route) => route.abort());
  await mockup.goto(pathToFileURL(path.join(mockups, `${id}.html`)).href);
  await mockup.waitForTimeout(300);
  await mockup.screenshot({ path: path.join(out, `${id}.mockup.png`) });
  const drawn = await measure(mockup, 0);
  await mockup.close();

  const drawnAt: [string, string] = [
    `${title}: Mockup, drawn at ${viewport.mockup.width} px`,
    `${id}.mockup.png`,
  ];
  // At the mockup's size, so a difference in size shows and can be measured.
  const real = await shootApp(browser, state, url, viewport.mockup, `${id}.same-size.app.png`);
  await pair(browser, `${id}.same-size`, viewport.mockup, [
    drawnAt,
    [`${title}: App at ${viewport.mockup.width} px`, `${id}.same-size.app.png`],
  ]);
  const found = differences(drawn, real);
  const report = path.join(out, `${id}.differences.txt`);
  fs.writeFileSync(
    report,
    `${title} at ${viewport.mockup.width}x${viewport.mockup.height}: mockup / app\n` +
      found.map((line) => `${line}\n`).join(""),
  );

  // At the narrower sizes the browser tests use, the mockup scaled to the app's width.
  await shootApp(browser, state, url, viewport.app, `${id}.app.png`);
  await pair(browser, id, viewport.app, [
    drawnAt,
    [`${title}: App at ${viewport.app.width} px`, `${id}.app.png`],
  ]);
  console.log(
    `${id}: ${found.length} measured differences, ${report}\n  ${path.join(out, `${id}.png`)}, and ${id}.same-size.png`,
  );
}

const wanted = process.argv.slice(2);
const unknown = wanted.filter((id) => !STATES.some((state) => state.id === id));
if (unknown.length) {
  console.error(
    `No such state: ${unknown.join(", ")}. The states: ${STATES.map((s) => s.id).join(", ")}.`,
  );
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });
const app = await startApp();
let failed = false;
// The app and its temporary folder are removed however the run ends, even when Chrome doesn't
// start or doesn't close.
try {
  seedSamples(app.folder);
  workspaceWith(app.folder, WIDE, wideBoard());
  const list = listWorkspaces(app.folder).find((workspace) => workspace.title === LIST);
  if (!list) throw new Error(`The sample tools have no "${LIST}".`);
  // The messages the mockups show, stored as a request and its reply would be.
  addToChat(app.folder, list.id, [
    { from: "person", text: "add a tooltip to the graph showing the value" },
    {
      from: "tessera",
      text:
        "Tessera can't make that.\n\nThe chart is drawn by Tessera itself, and a tool can't add " +
        "hover tooltips to it or change how it behaves.",
    },
  ]);
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    for (const state of STATES.filter((s) => !wanted.length || wanted.includes(s.id))) {
      try {
        await shoot(browser, state, app.url);
      } catch (error) {
        failed = true;
        console.error(`${state.id}: couldn't reach this state: ${String(error).split("\n")[0]}`);
      }
    }
  } finally {
    await browser.close();
  }
} finally {
  await app.close();
}
if (failed) process.exitCode = 1;
