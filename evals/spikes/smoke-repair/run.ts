// Docs: docs/code/evals/smoke-repair.md
// LIVE with --live: requires explicit owner approval of this run's cap (ENG-07).
// node evals/spikes/smoke-repair/run.ts --dry-run
// node evals/spikes/smoke-repair/run.ts --live --approved-cap 3
// Build first: pnpm build. Intent and creation are canned; only repair reaches the model.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, expect, type Page } from "@playwright/test";
import type { Creation, Intent } from "@tessera/contracts";
import { candidateFrom, launch, listWorkspaces, type Provider } from "@tessera/server";
import { startHarness, type RunMode } from "../../src/index.ts";
import {
  fakeClaudeProvider,
  liveClaudeProvider,
  runFolder,
  runModeFrom,
} from "../cli-contract/claude-cli.ts";

/** Approved cap: one expected smoke repair, with two calls reserved for schema/static repair. */
export const PLAN = {
  callCap: 3,
  request: 'A shopping list showing milk and eggs, with a field labelled "New item".',
  requestLimitMs: 7 * 60_000,
} as const;
const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "../../../packages/web/dist");
const entries = [
  { id: "i-1", title: "Milk" },
  { id: "i-2", title: "Eggs" },
];
const tool: Extract<Creation, { outcome: "tool" }> = {
  outcome: "tool",
  name: "Shopping list",
  summary: "A list of what to buy.",
  code: {
    html: '<h1>Shopping list</h1><ul id="items"></ul><input id="new-item">',
    css: "",
    js: `tessera.call("data.read").then(({ data }) => {
  for (const item of data.items) {
    const row = document.createElement("li");
    row.textContent = item.title;
    document.getElementById("items").append(row);
  }
});`,
  },
  data: {
    schema: {
      type: "object",
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "title"],
            properties: { id: { type: "string" }, title: { type: "string" } },
          },
        },
      },
    },
    reusableDefaults: { items: [] },
    initialState: { items: entries },
  },
  capabilities: [],
  uiMode: "standard",
};
const intent: Intent = {
  kind: "create",
  interfacePart: null,
  dataPart: null,
  behaviorChange: false,
  lookOnly: false,
  targetsCurrentTool: false,
  language: "en",
  features: [],
};

/** A failed browser run stops and settles its calls before closing storage or recording costs. */
export function cancellableProvider(provider: Provider) {
  const controller = new AbortController();
  const pending = new Set<Promise<unknown>>();
  return {
    provider: {
      ...provider,
      async run(spec) {
        const call = provider.run({
          ...spec,
          signal: AbortSignal.any([controller.signal, ...(spec.signal ? [spec.signal] : [])]),
        });
        pending.add(call);
        try {
          return await call;
        } finally {
          pending.delete(call);
        }
      },
    } satisfies Provider,
    async stop() {
      controller.abort();
      await Promise.allSettled([...pending]);
    },
  };
}

async function providerFor(mode: RunMode, folder: string): Promise<Provider> {
  if (mode === "live") return (await liveClaudeProvider()).provider;
  const fixed = {
    ...tool,
    code: {
      ...tool.code,
      html: '<h1>Shopping list</h1><ul id="items"></ul><label for="new-item">New item</label><input id="new-item">',
    },
    data: { ...tool.data, initialState: {} },
  };
  const replies = path.join(folder, "replies.json");
  fs.writeFileSync(
    replies,
    JSON.stringify([
      {
        type: "result",
        subtype: "success",
        is_error: false,
        duration_ms: 1000,
        structured_output: { answer: fixed },
        usage: {
          input_tokens: 1,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 1,
        },
      },
    ]),
  );
  return fakeClaudeProvider(replies, path.join(folder, "calls"));
}

/** One real browser request: fail smoke, repair, stage again, activate, preserve the entries. */
export async function runSmokeRepair(mode: RunMode): Promise<string> {
  assert(fs.existsSync(path.join(webRoot, "index.html")), "Build the web app first: pnpm build.");
  assert.equal(candidateFrom(tool).kind, "candidate", "The canned tool must pass server checks.");
  const folder = runFolder("smoke-repair", mode);
  fs.mkdirSync(folder, { recursive: true });
  const harness = startHarness({
    provider: await providerFor(mode, folder),
    mode,
    callCap: PLAN.callCap,
    dataFolder: path.join(folder, "harness"),
  });
  const calls = cancellableProvider(harness.provider);
  let beforeRepair: ReturnType<typeof listWorkspaces> | undefined;
  const provider: Provider = {
    name: `replay+${harness.provider.name}`,
    live: mode === "live",
    async run(spec) {
      if (spec.stage === "intent" || spec.stage === "create") {
        const value = spec.schema.parse(spec.stage === "intent" ? intent : tool);
        return {
          value,
          raw: JSON.stringify(value),
          usage: {
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            durationMs: 0,
          },
        };
      }
      assert.equal(spec.stage, "repair");
      if (harness.callsUsed() === 0) {
        assert(spec.promptParts?.some((p) => p.startsWith("repair-smoke@")));
        assert(spec.prompt.includes("1 field has no label."));
        assert(app.status === "started");
        beforeRepair = listWorkspaces(app.dataFolder);
        assert.equal(beforeRepair.length, 1);
        assert.equal(beforeRepair[0]!.dataRevision, 1);
        assert.deepEqual(beforeRepair[0]!.data, { items: entries });
      }
      return calls.provider.run(spec);
    },
  };
  const app = await launch({
    dataDir: path.join(folder, "tessera"),
    port: 0,
    webRoot,
    provider,
    openBrowser: () => Promise.resolve(),
    ...(mode === "dry-run"
      ? {
          setup: {
            findClaude: () =>
              Promise.resolve({
                ok: true as const,
                executable: "fake-claude",
                version: "0.0.0",
              }),
          },
        }
      : {}),
  });
  assert.equal(app.status, "started");
  if (app.status !== "started") throw new Error("The evaluation data folder is already open.");
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let context: Awaited<ReturnType<NonNullable<typeof browser>["newContext"]>> | undefined;
  let problem: string | undefined;
  let page: Page | undefined;
  let message = "";
  const started = Date.now();
  try {
    browser = await chromium.launch({ channel: "chrome" });
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      recordVideo: { dir: folder },
    });
    page = await context.newPage();
    await page.goto(app.url);
    await page.getByRole("textbox", { name: "What do you need?" }).fill(PLAN.request);
    await page.getByRole("button", { name: "Make it" }).click();
    await expect(page.getByRole("textbox", { name: "What do you need?" })).toBeEnabled({
      timeout: PLAN.requestLimitMs,
    });
    message = await page
      .locator(".notice [role=status], main.empty > p[role=status]")
      .first()
      .innerText();
    assert(message.includes("Shopping list is ready."), message);
    const frame = page
      .frameLocator(".tool-frame iframe")
      .frameLocator("iframe")
      .frameLocator("iframe");
    await frame.getByRole("textbox", { name: "New item", exact: true }).waitFor();
    await expect(frame.getByRole("listitem")).toHaveText(["Milk", "Eggs"]);
    await page.screenshot({ path: path.join(folder, "outcome.png"), fullPage: true });
    const workspaces = listWorkspaces(app.dataFolder);
    assert.equal(workspaces.length, 1);
    assert(workspaces[0]!.currentVersion);
    assert(beforeRepair);
    // Activation has always committed one new revision; repair itself must add none.
    assert.equal(workspaces[0]!.dataRevision, beforeRepair[0]!.dataRevision + 1);
    assert.deepEqual(workspaces[0]!.data, { items: entries });
    assert(harness.callsUsed() >= 1);
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
    await page
      ?.screenshot({ path: path.join(folder, "failure.png"), fullPage: true })
      .catch(() => undefined);
  } finally {
    await calls.stop();
    await context?.close();
    await browser?.close();
    const workspaces = listWorkspaces(app.dataFolder);
    await app.stop();
    fs.writeFileSync(
      path.join(folder, "report.json"),
      `${JSON.stringify(
        {
          mode,
          plan: PLAN,
          passed: problem === undefined,
          problem,
          message,
          seconds: (Date.now() - started) / 1000,
          beforeRepair,
          workspaces,
          ledger: harness.finish(),
        },
        null,
        2,
      )}\n`,
    );
  }
  if (problem) throw new Error(`${problem}\nEvidence: ${folder}`);
  return folder;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const folder = await runSmokeRepair(runModeFrom(process.argv.slice(2), PLAN.callCap));
  console.log(`Smoke repair evidence: ${folder}`);
  console.log(fs.readFileSync(path.join(folder, "report.json"), "utf8"));
}
