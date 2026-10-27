// Docs: docs/code/evals/slice-pilot.md
// LIVE with --live: makes real model calls, only with the owner's approval of the budget (ENG-07).
// The end-to-end slice's pilot (#146): do two everyday requests become working tools through the
// real app (intent, create, the static check, staging behind the smoke check, activation)?
//   node evals/spikes/slice-pilot/run.ts --dry-run                (a fake claude, no cost)
//   node evals/spikes/slice-pilot/run.ts --live --approved-cap 6  (the real CLI)
// Build the web app first (pnpm build): the pilot serves packages/web/dist.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import type { Creation, Intent } from "@tessera/contracts";
import { launch, listWorkspaces, type Provider } from "@tessera/server";
import { readLedger, startHarness, summarizeLedger, type RunMode } from "../../src/index.ts";
import {
  fakeClaudeProvider,
  liveClaudeProvider,
  runFolder,
  runModeFrom,
} from "../cli-contract/claude-cli.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(here, "..", "..", "..", "packages", "web", "dist");

/** The run the owner approved on 2026-10-27: two requests, a hard cap of 6 calls. */
export const PLAN = {
  callCap: 6,
  requests: [
    "I need a shopping list I can tick off at the store, with milk, eggs and bread on it.",
    "A simple calculator.",
  ],
  /** How long one request may take, from sending it to its message: the request limit (GEN-11). */
  requestLimitMs: 7 * 60_000,
} as const;

// The dry run's answers, by call order: intent, then create, for each request. They are shaped
// like the CLI's result envelopes, with the answer wrapped as the adapter asks for it.
const envelope = (answer: unknown) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  duration_ms: 1000,
  structured_output: { answer },
  usage: {
    input_tokens: 1,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 1,
  },
});
const intent = (kind: Intent["kind"]): Intent =>
  ({
    kind,
    interfacePart: null,
    dataPart: null,
    behaviorChange: false,
    lookOnly: false,
    targetsCurrentTool: false,
    language: "en",
    features: [],
  }) as Intent;
const simpleTool = (name: string, text: string): Creation => ({
  outcome: "tool",
  name,
  summary: `A rehearsal ${name.toLowerCase()}.`,
  code: { html: `<h1>${name}</h1><p>${text}</p>`, css: "", js: "" },
  data: { schema: { type: "object" }, reusableDefaults: {}, initialState: {} },
  capabilities: [],
  uiMode: "standard",
});
const dryRunReplies = [
  envelope(intent("create")),
  envelope(simpleTool("Shopping list", "Milk, eggs and bread.")),
  envelope(intent("new_tool")),
  envelope(simpleTool("Calculator", "0")),
];

export type RequestReport = {
  request: string;
  /** What the app told the person, word for word. */
  message: string;
  /** How long from sending to the message, in seconds. */
  seconds: number;
  screenshot: string;
};

async function providerFor(mode: RunMode, folder: string): Promise<Provider> {
  if (mode === "live") return (await liveClaudeProvider()).provider;
  const replies = path.join(folder, "replies.json");
  fs.writeFileSync(replies, JSON.stringify(dryRunReplies));
  return fakeClaudeProvider(replies, path.join(folder, "calls"));
}

export async function runPilot(mode: RunMode): Promise<string> {
  if (!fs.existsSync(path.join(webRoot, "index.html"))) {
    throw new Error("Build the web app first: pnpm build.");
  }
  const folder = runFolder("slice-pilot", mode);
  fs.mkdirSync(folder, { recursive: true });
  const harness = startHarness({
    provider: await providerFor(mode, folder),
    mode,
    callCap: PLAN.callCap,
    dataFolder: path.join(folder, "harness"),
  });
  // Tessera's own data folder for the run, never the person's (ENG-19).
  const dataDir = path.join(folder, "tessera");
  const launched = await launch({
    dataDir,
    port: 0,
    webRoot,
    openBrowser: () => Promise.resolve(),
    provider: harness.provider,
    // The dry run's setup check sees a ready Claude Code without starting one.
    ...(mode === "dry-run" && {
      setup: {
        findClaude: () =>
          Promise.resolve({ ok: true as const, executable: "fake-claude", version: "0.0.0" }),
      },
    }),
  });
  if (launched.status !== "started")
    throw new Error("Another Tessera holds the run's data folder.");
  const browser = await chromium.launch({ channel: "chrome" });
  const reports: RequestReport[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(launched.url);
    for (const [index, request] of PLAN.requests.entries()) {
      const box = page.getByRole("textbox", { name: "What do you need?" });
      await box.waitFor({ timeout: 30_000 });
      // The app's notice: in the notice area, or on the first-run screen, its own status line.
      const notice = page.locator(".notice [role=status], main.empty > p[role=status]").first();
      const read = async () =>
        (await notice.count()) > 0 ? ((await notice.textContent()) ?? "") : "";
      const before = await read();
      const started = Date.now();
      await box.fill(request);
      await page.getByRole("button", { name: "Make it" }).click();
      // Done when the box takes requests again and the app has said something new. The first
      // request starts on the first-run screen; its message shows on the screen it opens.
      for (;;) {
        const message = await read();
        const working = (await box.count()) > 0 && (await box.isDisabled());
        if (!working && message !== "" && message !== before) break;
        if (Date.now() - started > PLAN.requestLimitMs) throw new Error(`No answer to: ${request}`);
        await page.waitForTimeout(500);
      }
      // Give a made tool a moment to start before the picture.
      await page.waitForTimeout(3000);
      const screenshot = path.join(folder, `request-${index + 1}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      reports.push({
        request,
        message: await read(),
        seconds: Math.round((Date.now() - started) / 1000),
        screenshot,
      });
    }
  } finally {
    await browser.close();
    const workspaces = listWorkspaces(launched.dataFolder).map((w) => ({
      title: w.title,
      hasTool: w.currentVersion !== null,
    }));
    await launched.stop();
    const ledger = readLedger(harness.dataFolder);
    fs.writeFileSync(
      path.join(folder, "report.json"),
      `${JSON.stringify({ mode, plan: PLAN, requests: reports, workspaces, ledger: summarizeLedger(ledger) }, null, 2)}\n`,
    );
  }
  return folder;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const mode = runModeFrom(process.argv.slice(2), PLAN.callCap);
  const folder = await runPilot(mode);
  console.log(`The pilot's ${mode} is in ${folder}`);
  console.log(fs.readFileSync(path.join(folder, "report.json"), "utf8"));
}
