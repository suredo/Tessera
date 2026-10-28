// Docs: docs/code/evals/edit-check.md
// LIVE with --live: only the specifically approved two-case run, hard cap four (ENG-07).
// Build first. node evals/spikes/edit-check/run.ts --dry-run
// Approved live invocation: node evals/spikes/edit-check/run.ts --live --approved-cap 4
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, expect, type Page } from "@playwright/test";
import type { Intent, Workspace } from "@tessera/contracts";
import {
  candidateFrom,
  launch,
  createWorkspace,
  saveVersion,
  activateVersion,
  saveTool,
  listWorkspaces,
  loadVersion,
  workspaceVersions,
  type Provider,
} from "@tessera/server";
import {
  editFixture,
  styleEdit,
  quantityEdit,
} from "../../../packages/server/test/fixtures/edit-tool.ts";
import { startHarness, type RunMode } from "../../src/index.ts";
import {
  fakeClaudeProvider,
  liveClaudeProvider,
  runFolder,
  runModeFrom,
} from "../cli-contract/claude-cli.ts";
import { cancellableProvider } from "../smoke-repair/run.ts";

/** Two expected edits and two repair reserves, explicitly approved for this run only. */
export const PLAN = {
  callCap: 4,
  requestLimitMs: 7 * 60_000,
  cases: [
    {
      name: "darken",
      request: "Make the background #111111 and the text #eeeeee. Keep the layout and entries.",
      lookOnly: true,
    },
    {
      name: "quantities",
      request:
        "Add a numeric quantity to every item, starting at 1, and show the quantity beside each item. Keep the dark colors and all entries.",
      lookOnly: false,
    },
  ],
} as const;
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
  fs.writeFileSync(replies, JSON.stringify([envelope(styleEdit), envelope(quantityEdit)]));
  return fakeClaudeProvider(replies, path.join(folder, "calls"));
}

/** The two fixed cases share a saved workspace; intent is canned and only edit/repair spends calls. */
export async function runEditCheck(mode: RunMode): Promise<string> {
  assert(fs.existsSync(path.join(webRoot, "index.html")), "Build first: pnpm build.");
  const built = candidateFrom(editFixture);
  assert(built.kind === "candidate");
  const folder = runFolder("edit-check", mode);
  fs.mkdirSync(folder, { recursive: true });
  const harness = startHarness({
    provider: await providerFor(mode, folder),
    mode,
    callCap: PLAN.callCap,
    dataFolder: path.join(folder, "harness"),
  });
  const calls = cancellableProvider(harness.provider);
  let intentIndex = 0;
  const provider: Provider = {
    name: `replay+${harness.provider.name}`,
    live: mode === "live",
    async run(spec) {
      if (spec.stage === "intent") {
        const scenario = PLAN.cases[intentIndex++];
        assert(scenario, "Only the two planned intents may run.");
        const intent: Intent = {
          kind: "edit",
          interfacePart: null,
          dataPart: null,
          language: "en",
          features: [],
          targetsCurrentTool: true,
          behaviorChange: !scenario.lookOnly,
          lookOnly: scenario.lookOnly,
        };
        return {
          value: spec.schema.parse(intent),
          raw: JSON.stringify(intent),
          usage: {
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            durationMs: 0,
          },
        };
      }
      assert(spec.stage === "edit" || spec.stage === "repair");
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
  assert(app.status === "started");
  const initial = createWorkspace(app.dataFolder, editFixture.name, { data: built.startingData });
  const hash = saveVersion(app.dataFolder.db, built.artifact);
  assert(activateVersion(app.dataFolder, initial.id, hash, initial.dataRevision).ok);
  saveTool(app.dataFolder, initial.id, "Shopping list template");
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
      await expect(frame.locator("body")).toHaveCSS("background-color", "rgb(17, 17, 17)");
      await expect(frame.locator("body")).toHaveCSS("color", "rgb(238, 238, 238)");
      if (scenario.lookOnly) {
        assert.deepEqual(workspace.data, built.startingData);
        const changed = loadVersion(app.dataFolder.db, workspace.currentVersion!);
        assert(changed?.kind === "ok");
        assert.equal(changed.artifact.code.html, built.artifact.code.html);
        assert.equal(changed.artifact.code.js, built.artifact.code.js);
        assert.deepEqual(changed.artifact.data, built.artifact.data);
        await expect(frame.getByRole("listitem")).toHaveText(["Milk", "Eggs"]);
      } else {
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
              const numeric = row.getByRole("spinbutton");
              return (await numeric.count())
                ? (await numeric.first().inputValue()) === "1"
                : /\b1\b/.test(await row.innerText());
            })
            .toBe(true);
        }
      }
      await page.screenshot({ path: path.join(folder, `${scenario.name}.png`), fullPage: true });
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
  const folder = await runEditCheck(runModeFrom(process.argv.slice(2), PLAN.callCap));
  console.log(`Edit check evidence: ${folder}`);
  console.log(fs.readFileSync(path.join(folder, "report.json"), "utf8"));
}
