// Docs: docs/code/evals/bridge-edit-check.md
// LIVE requires a fresh explicit cap approval; no previous reserve authorizes this run.
// Build, then rehearse: node evals/spikes/bridge-edit-check/run.ts --dry-run
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, expect, type Page } from "@playwright/test";
import { editSchema, type Intent, type Workspace } from "@tessera/contracts";
import {
  candidateFrom,
  launch,
  createWorkspace,
  saveVersion,
  activateVersion,
  saveTool,
  listWorkspaces,
  workspaceVersions,
  ProviderError,
  type Provider,
} from "@tessera/server";
import { editFixture, quantityEdit } from "../../../packages/server/test/fixtures/edit-tool.ts";
import { startHarness, type RunMode } from "../../src/index.ts";
import {
  fakeClaudeProvider,
  liveClaudeProvider,
  runFolder,
  runModeFrom,
} from "../cli-contract/claude-cli.ts";
import { cancellableProvider } from "../smoke-repair/run.ts";

/** Frozen denominator and proposed cap; not authorization for a live run. */
export const PLAN = {
  callCap: 2,
  expectedCalls: 1,
  repairReserve: 1,
  reviewerCalls: 0,
  requestLimitMs: 7 * 60_000,
  cases: [
    {
      name: "quantities",
      request:
        "Add a numeric quantity to every item, starting at 1, and show the quantity beside each item. Keep the current white colors, title, list layout and all entries.",
    },
  ],
} as const;

/** White canned answer for the exact free rehearsal; never supplied to a live model. */
export const REPLY = {
  ...quantityEdit,
  files: {
    mode: "replace",
    code: {
      ...editFixture.code,
      js: quantityEdit.files.mode === "replace" ? quantityEdit.files.code.js : "",
    },
  },
};

/** Only one behavioral edit and one global schema/static/smoke repair can spend calls. */
export function editOnlyProvider(provider: Provider): Provider {
  let intents = 0;
  let edits = 0;
  let repairs = 0;
  let stopped = false;
  return {
    name: `scripted+${provider.name}`,
    live: provider.live,
    async run(spec) {
      assert(!stopped, "The run stopped after a provider error.");
      if (spec.stage === "intent") {
        assert(++intents === 1, "Only the frozen intent may run.");
        const intent: Intent = {
          kind: "edit",
          interfacePart: null,
          dataPart: null,
          language: "en",
          features: [],
          targetsCurrentTool: true,
          behaviorChange: true,
          lookOnly: false,
        };
        return {
          value: spec.schema.parse(intent),
          raw: JSON.stringify(intent),
          usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, durationMs: 0 },
        };
      }
      assert(Object.is(spec.schema, editSchema), "Only the edit contract may reach the provider.");
      assert(intents === 1, "The frozen intent must run first.");
      assert(spec.stage === "edit" || spec.stage === "repair", "Unplanned stage.");
      if (spec.stage === "edit") {
        assert(++edits === 1, "Only one edit is planned.");
        assert(
          spec.promptParts?.some((part) => /^bridge@/.test(part)),
          "The actual edit StageSpec must include bridge@ provenance.",
        );
      } else {
        assert(edits === 1, "Repair requires the planned edit.");
        assert(++repairs <= PLAN.repairReserve, "The shared repair reserve is exhausted.");
      }
      try {
        return await provider.run(spec);
      } catch (error) {
        if (!(error instanceof ProviderError) || error.kind !== "schema") stopped = true;
        throw error;
      }
    },
  };
}
const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "../../../packages/web/dist");
const envelope = (answer: unknown) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  duration_ms: 1000,
  structured_output: { answer },
  usage: {
    input_tokens: 1,
    output_tokens: 1,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  },
});
async function providerFor(mode: RunMode, folder: string): Promise<Provider> {
  if (mode === "live") return (await liveClaudeProvider()).provider;
  const replies = path.join(folder, "replies.json");
  fs.writeFileSync(replies, JSON.stringify([envelope(REPLY)]));
  return fakeClaudeProvider(replies, path.join(folder, "calls"));
}

/** Runs one host request through smoke and activation, settling calls before final cost. */
export async function runBridgeEditCheck(mode: RunMode): Promise<string> {
  assert(fs.existsSync(path.join(webRoot, "index.html")), "Build first: pnpm build.");
  const built = candidateFrom(editFixture);
  assert(built.kind === "candidate");
  const folder = runFolder("bridge-edit-check", mode);
  fs.mkdirSync(folder, { recursive: true });
  const harness = startHarness({
    provider: await providerFor(mode, folder),
    mode,
    callCap: PLAN.callCap,
    dataFolder: path.join(folder, "harness"),
  });
  const calls = cancellableProvider(harness.provider);
  const app = await launch({
    dataDir: path.join(folder, "tessera"),
    port: 0,
    webRoot,
    provider: editOnlyProvider(calls.provider),
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
  assert(app.status === "started");
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let context: Awaited<ReturnType<NonNullable<typeof browser>["newContext"]>> | undefined;
  let page: Page | undefined;
  let problem: string | undefined;
  const reports: {
    name: string;
    outcome: "passed" | "failed" | "blocked";
    message: string;
    seconds?: number;
  }[] = PLAN.cases.map((c) => ({
    name: c.name,
    outcome: "blocked",
    message: "Earlier required step did not pass.",
  }));
  const started = Date.now();
  let index = 0;
  try {
    const initial = createWorkspace(app.dataFolder, editFixture.name, { data: built.startingData });
    const hash = saveVersion(app.dataFolder.db, built.artifact);
    assert(activateVersion(app.dataFolder, initial.id, hash, initial.dataRevision).ok);
    saveTool(app.dataFolder, initial.id, "Shopping list template");
    browser = await chromium.launch({ channel: "chrome" });
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      recordVideo: { dir: folder },
    });
    page = await context.newPage();
    await page.goto(app.url);
    const frame = page
      .frameLocator(".tool-frame iframe")
      .frameLocator("iframe")
      .frameLocator("iframe");
    await expect(frame.getByRole("listitem")).toHaveText(["Milk", "Eggs"]);
    for (const scenario of PLAN.cases) {
      const stepStarted = Date.now();
      const before: Workspace = listWorkspaces(app.dataFolder)[0]!;
      await page.getByRole("textbox", { name: "What do you need?" }).fill(scenario.request);
      await page.getByRole("button", { name: "Make it" }).click();
      await expect(page.getByRole("textbox", { name: "What do you need?" })).toBeEnabled({
        timeout: PLAN.requestLimitMs,
      });
      const message = await page.locator(".notice [role=status]").first().innerText();
      assert(message.startsWith("Shopping list was updated."), message);
      const workspace: Workspace = listWorkspaces(app.dataFolder)[0]!;
      assert.equal(listWorkspaces(app.dataFolder).length, 1);
      assert.equal(workspace.id, initial.id);
      assert.equal(workspace.title, editFixture.name);
      assert.notEqual(workspace.currentVersion, before.currentVersion);
      assert.equal(workspace.dataRevision, before.dataRevision + 1);
      assert.equal(workspaceVersions(app.dataFolder, workspace.id).length, index + 2);
      await expect(frame.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
      await expect(
        frame.getByRole("heading", { name: "Shopping list", exact: true }),
      ).toBeVisible();
      await expect(frame.locator("ul")).toHaveCount(1);
      assert.deepEqual(workspace.data, {
        items: [
          { id: "i-1", title: "Milk", quantity: 1 },
          { id: "i-2", title: "Eggs", quantity: 1 },
        ],
      });
      const rows = frame.getByRole("listitem");
      await expect(rows).toHaveCount(2);
      for (const [rowIndex, title] of ["Milk", "Eggs"].entries()) {
        const row = rows.nth(rowIndex);
        await expect(row).toContainText(title);
        await expect
          .poll(async () => {
            const numeric = row.locator("input:visible");
            const values = await numeric.evaluateAll((inputs) =>
              inputs.map((input) => (input as { value: string }).value),
            );
            return values.includes("1") || /\b1\b/.test(await row.innerText());
          })
          .toBe(true);
      }
      await expect(frame.getByRole("listitem").first()).toBeVisible();
      await expect(frame.getByRole("listitem").last()).toBeVisible();
      await page.evaluate("window.scrollTo(0, 0)");
      await expect.poll(() => page!.evaluate("window.scrollY")).toBe(0);
      for (let row = 0; row < 2; row++)
        await expect(frame.getByRole("listitem").nth(row)).toBeInViewport();
      await page.screenshot({ path: path.join(folder, `${scenario.name}.png`) });
      await page.screenshot({
        path: path.join(folder, `${scenario.name}-full.png`),
        fullPage: true,
      });
      reports[index++] = {
        name: scenario.name,
        outcome: "passed",
        message,
        seconds: (Date.now() - stepStarted) / 1000,
      };
    }
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
    reports[index] = {
      name: PLAN.cases[index]?.name ?? "setup",
      outcome: "failed",
      message: problem,
    };
    await page
      ?.screenshot({ path: path.join(folder, "failure.png"), fullPage: true })
      .catch(() => undefined);
  } finally {
    await calls.stop();
    const close = async (work: Promise<unknown> | undefined) => {
      try {
        await work;
      } catch (error) {
        problem ??= error instanceof Error ? error.message : String(error);
      }
    };
    await close(context?.close());
    await close(browser?.close());
    const workspaces = listWorkspaces(app.dataFolder);
    await close(app.stop());
    fs.writeFileSync(
      path.join(folder, "report.json"),
      `${JSON.stringify(
        {
          mode,
          sourceHead: execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: here,
            encoding: "utf8",
          }).trim(),
          sourceDirty: Boolean(
            execFileSync("git", ["status", "--porcelain"], { cwd: here, encoding: "utf8" }).trim(),
          ),
          captureLimit:
            "Viewport images are authoritative. Full-page images are supplementary: nested frames can omit content (L-76).",
          plan: PLAN,
          passed:
            !problem && reports.filter((r) => r.outcome === "passed").length === PLAN.cases.length,
          requiredCaseCount: PLAN.cases.length,
          cases: reports,
          problem,
          seconds: (Date.now() - started) / 1000,
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
  const folder = await runBridgeEditCheck(runModeFrom(process.argv.slice(2), PLAN.callCap));
  console.log(`Bridge edit check evidence: ${folder}`);
  console.log(fs.readFileSync(path.join(folder, "report.json"), "utf8"));
}
