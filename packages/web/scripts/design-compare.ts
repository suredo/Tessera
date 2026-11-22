// Docs: docs/code/web/package.md
// `pnpm design:compare [state ...]`: each UI redesign mockup beside the app in the same state, at the
// same window size, in test-output/design-compare/ (ENG-32). After `pnpm build`. It starts its own
// Tessera on a temporary folder with the sample tools (ENG-19), and sends no request, so no model is
// ever called.

import { chromium, type Browser, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { en } from "../src/i18n/en.ts";
import { startApp, testTool, TOOL_START, workspaceWith } from "../e2e/support/app-host.ts";
import { openWorkspaces, selectWorkspace } from "../e2e/support/workspace-actions.ts";
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
    await page
      .getByLabel(en["chat.position"], { exact: true })
      .selectOption({ label: en[position === "float" ? "chat.float" : "chat.dock"] });
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

async function shoot(browser: Browser, state: State, url: string) {
  const mockup = await browser.newPage({ viewport: state.viewport.mockup });
  // Offline, as render.mjs: nothing outside the file may load.
  await mockup.route(/^(?!file:)/, (route) => route.abort());
  await mockup.goto(pathToFileURL(path.join(mockups, `${state.id}.html`)).href);
  await mockup.waitForTimeout(300);
  await mockup.screenshot({ path: path.join(out, `${state.id}.mockup.png`) });
  await mockup.close();

  const app = await browser.newPage({ viewport: state.viewport.app });
  await app.goto(url);
  await state.reach(app);
  // Let panels finish opening and the tool finish drawing.
  await app.waitForTimeout(700);
  await app.screenshot({ path: path.join(out, `${state.id}.app.png`) });
  await app.close();

  const { width, height } = state.viewport.app;
  // A page beside the two images, so it may load them: a page set from memory can't load files.
  const pair = path.join(out, `${state.id}.html`);
  fs.writeFileSync(
    pair,
    `<!doctype html><body style="margin:0;padding:16px;font:14px system-ui;display:flex;gap:16px">` +
      [
        [`Mockup, drawn at ${state.viewport.mockup.width} px`, `${state.id}.mockup.png`],
        [`App at ${width} px`, `${state.id}.app.png`],
      ]
        .map(
          ([label, file]) =>
            `<figure style="margin:0"><figcaption>${state.title}: ${label}</figcaption>` +
            `<img style="display:block;border:1px solid #999;width:${width}px" src="${file}"></figure>`,
        )
        .join("") +
      "</body>",
  );
  const page = await browser.newPage({ viewport: { width: width * 2 + 48, height: height + 64 } });
  await page.goto(pathToFileURL(pair).href);
  await page.waitForFunction(() =>
    [...document.images].every((image) => image.complete && image.naturalWidth > 0),
  );
  await page.screenshot({ path: path.join(out, `${state.id}.png`), fullPage: true });
  await page.close();
  console.log(`${state.id}: ${path.join(out, `${state.id}.png`)}`);
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
const browser = await chromium.launch({ channel: "chrome" });
try {
  seedSamples(app.folder);
  workspaceWith(app.folder, WIDE, wideBoard());
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
  await app.close();
}
if (failed) process.exitCode = 1;
