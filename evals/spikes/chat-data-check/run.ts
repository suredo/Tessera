// Docs: docs/code/evals/chat-data-check.md
// LIVE only after explicit approval: proposed cap 3 (two data calls plus one shape repair).
// Build first, then rehearse: node evals/spikes/chat-data-check/run.ts --dry-run
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, expect, type Page } from "@playwright/test";
import {
  dataPlanSchema,
  type Creation,
  type Edit,
  type Intent,
  type Workspace,
} from "@tessera/contracts";
import {
  candidateFrom,
  launch,
  createWorkspace,
  saveVersion,
  activateVersion,
  saveTool,
  listWorkspaces,
  workspaceVersions,
  loadVersion,
  ProviderError,
  type Provider,
} from "@tessera/server";
import { startHarness, type RunMode } from "../../src/index.ts";
import {
  fakeClaudeProvider,
  liveClaudeProvider,
  runFolder,
  runModeFrom,
} from "../cli-contract/claude-cli.ts";
import { cancellableProvider } from "../smoke-repair/run.ts";

/** Frozen scoring denominator and proposed budget; this is not live-run authorization. */
export const PLAN = {
  callCap: 3,
  expectedCalls: 2,
  repairReserve: 1,
  reviewerCalls: 0,
  requestLimitMs: 7 * 60_000,
  cases: [
    { name: "add-bread", request: "Add Bread with quantity 1 to the shopping list.", mixed: false },
    {
      name: "darken-and-set-milk",
      request: "Make the background #111111 and the text #eeeeee, and set Milk quantity to 2.",
      interfacePart: "Make the background #111111 and the text #eeeeee",
      dataPart: "set Milk quantity to 2",
      mixed: true,
    },
  ],
} as const;

/** An isolated shopping fixture: quantities already exist so the mixed case edits only style. */
export const SHOPPING: Extract<Creation, { outcome: "tool" }> = {
  outcome: "tool",
  name: "Shopping list",
  summary: "What to buy and how many.",
  code: {
    html: '<h1>Shopping list</h1><ul id="items"></ul>',
    css: "body{background:#fff;color:#111}",
    js: `tessera.call("data.read").then(({ data }) => {
  for (const item of data.items) {
    const row = document.createElement("li");
    row.textContent = item.title + ": " + item.quantity;
    document.getElementById("items").append(row);
  }
});`,
  },
  data: {
    schema: {
      type: "object",
      required: ["items"],
      additionalProperties: false,
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "title", "quantity"],
            additionalProperties: false,
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              quantity: { type: "number" },
            },
          },
        },
      },
    },
    reusableDefaults: { items: [] },
    initialState: {
      items: [
        { id: "i-1", title: "Milk", quantity: 1 },
        { id: "i-2", title: "Eggs", quantity: 1 },
      ],
    },
  },
  capabilities: [],
  uiMode: "standard",
};
const style: Edit = {
  outcome: "edit",
  summary: "Made the list darker.",
  files: {
    mode: "replace",
    code: { ...SHOPPING.code, css: "body{background:#111111;color:#eeeeee}" },
  },
  data: { mode: "unchanged" },
};
/** Canned planner answers used only by the exact runner's free rehearsal. */
export const REPLIES = [
  {
    outcome: "patch",
    summary: "Added Bread.",
    patch: {
      operations: [{ op: "add", collection: "items", record: { title: "Bread", quantity: 1 } }],
    },
  },
  {
    outcome: "patch",
    summary: "Set Milk quantity to 2.",
    patch: {
      operations: [
        {
          op: "replace",
          collection: "items",
          id: "i-1",
          revisionCount: 1,
          fields: { quantity: 2 },
        },
      ],
    },
  },
];

/** Scripts intent/style; only the data contract and one global shape repair can spend calls. */
export function dataOnlyProvider(provider: Provider): Provider {
  let index = 0;
  let editUsed = false;
  let repairs = 0;
  let dataCalls = 0;
  let stopped = false;
  return {
    name: `scripted+${provider.name}`,
    live: provider.live,
    async run(spec) {
      assert(!stopped, "The run stopped after a provider error.");
      let answer: unknown;
      if (spec.stage === "intent") {
        const scenario = PLAN.cases[index++];
        assert(scenario, "Only the two frozen intents may run.");
        const intent: Intent = {
          kind: scenario.mixed ? "mixed" : "data",
          interfacePart: scenario.mixed ? scenario.interfacePart : null,
          dataPart: scenario.mixed ? scenario.dataPart : null,
          language: "en",
          features: [],
          targetsCurrentTool: true,
          behaviorChange: false,
          lookOnly: scenario.mixed,
        };
        answer = intent;
      } else if (spec.stage === "edit") {
        assert(
          index === 2 && !editUsed,
          "Only the mixed case's one scripted interface edit may run.",
        );
        editUsed = true;
        answer = style;
      } else {
        assert(
          Object.is(spec.schema, dataPlanSchema),
          "Only data-contract calls may reach the provider.",
        );
        assert(spec.stage === "data" || spec.stage === "repair", "Unplanned stage.");
        if (spec.stage === "repair")
          assert(++repairs <= PLAN.repairReserve, "Shape repair reserve exhausted.");
        else assert(++dataCalls <= PLAN.expectedCalls, "Only two data calls are planned.");
        try {
          return await provider.run(spec);
        } catch (error) {
          if (!(error instanceof ProviderError) || error.kind !== "schema") stopped = true;
          throw error;
        }
      }
      return {
        value: spec.schema.parse(answer),
        raw: JSON.stringify(answer),
        usage: {
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          durationMs: 0,
        },
      };
    },
  };
}
const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "../../../packages/web/dist");
async function providerFor(mode: RunMode, folder: string): Promise<Provider> {
  if (mode === "live") return (await liveClaudeProvider()).provider;
  const replies = path.join(folder, "replies.json");
  fs.writeFileSync(
    replies,
    JSON.stringify(
      REPLIES.map((answer) => ({
        type: "result",
        subtype: "success",
        is_error: false,
        duration_ms: 1,
        structured_output: { answer },
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      })),
    ),
  );
  return fakeClaudeProvider(replies, path.join(folder, "calls"));
}

/** Runs the frozen browser cases, retaining blocked cases and settling calls before final cost. */
export async function runChatDataCheck(mode: RunMode): Promise<string> {
  assert(fs.existsSync(path.join(webRoot, "index.html")), "Build first: pnpm build.");
  const built = candidateFrom(SHOPPING);
  assert(built.kind === "candidate");
  const folder = runFolder("chat-data-check", mode);
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
    provider: dataOnlyProvider(calls.provider),
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
  let index = 0;
  const reports: { name: string; outcome: "passed" | "failed" | "blocked"; message: string }[] =
    PLAN.cases.map((c) => ({
      name: c.name,
      outcome: "blocked",
      message: "Earlier required step did not pass.",
    }));
  const started = Date.now();
  try {
    const initial = createWorkspace(app.dataFolder, SHOPPING.name, { data: built.startingData });
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
    await expect(frame.getByRole("listitem")).toHaveText(["Milk: 1", "Eggs: 1"]);
    await expect(frame.getByRole("listitem").first()).toBeVisible();
    await expect(frame.getByRole("listitem").last()).toBeVisible();
    let breadId: string | undefined;
    for (const scenario of PLAN.cases) {
      const before: Workspace = listWorkspaces(app.dataFolder)[0]!;
      await page.getByRole("textbox", { name: "What do you need?" }).fill(scenario.request);
      await page.getByRole("button", { name: "Make it" }).click();
      await expect(page.getByRole("textbox", { name: "What do you need?" })).toBeEnabled({
        timeout: PLAN.requestLimitMs,
      });
      if (scenario.mixed) {
        const review = page.locator(".data-review");
        await expect(review).toBeVisible();
        await expect(
          review.getByRole("heading", { name: "Review one entry change in Shopping list" }),
        ).toBeVisible();
        await expect(review).toContainText("Milk");
        await expect(review).toContainText("Number: 1");
        await expect(review).toContainText("Number: 2");
        const pending: Workspace = listWorkspaces(app.dataFolder)[0]!;
        assert.deepEqual(pending.data, before.data, "Review must precede all entry changes.");
        assert.notEqual(pending.currentVersion, before.currentVersion);
        await review.scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(folder, "mixed-review.png") });
        await page.screenshot({ path: path.join(folder, "mixed-review-full.png"), fullPage: true });
        await review.getByRole("button", { name: "Apply these entry changes" }).click();
        await expect(review).toHaveCount(0);
      }
      await expect(page.getByRole("textbox", { name: "What do you need?" })).toBeEnabled({
        timeout: PLAN.requestLimitMs,
      });
      await expect(page.locator(".notice [role=status]").first()).toContainText(
        "Changed one entry in Shopping list.",
        { timeout: PLAN.requestLimitMs },
      );
      await expect(page.getByRole("button", { name: "Minimize", exact: true })).toBeVisible();
      const workspace: Workspace = listWorkspaces(app.dataFolder)[0]!;
      assert.equal(listWorkspaces(app.dataFolder).length, 1);
      assert.equal(workspace.id, initial.id);
      assert.equal(workspace.title, SHOPPING.name);
      assert.equal(workspace.dataRevision, before.dataRevision + (scenario.mixed ? 2 : 1));
      assert.equal(workspaceVersions(app.dataFolder, workspace.id).length, scenario.mixed ? 2 : 1);
      const items = workspace.data?.["items"];
      assert(Array.isArray(items));
      const rows = items as { id: string; title: string; quantity: number }[];
      if (!scenario.mixed) {
        breadId = rows[2]?.id;
        assert(breadId && breadId !== "i-1" && breadId !== "i-2");
        assert.equal(workspace.currentVersion, before.currentVersion);
      }
      assert.deepEqual(rows, [
        { id: "i-1", title: "Milk", quantity: scenario.mixed ? 2 : 1 },
        { id: "i-2", title: "Eggs", quantity: 1 },
        { id: breadId, title: "Bread", quantity: 1 },
      ]);
      const version = loadVersion(app.dataFolder.db, workspace.currentVersion!);
      assert(version?.kind === "ok");
      assert.equal(version.artifact.code.html, built.artifact.code.html);
      assert.equal(version.artifact.code.js, built.artifact.code.js);
      assert.deepEqual(version.artifact.data, built.artifact.data);
      await expect(frame.getByRole("listitem")).toHaveText([
        `Milk: ${scenario.mixed ? 2 : 1}`,
        "Eggs: 1",
        "Bread: 1",
      ]);
      if (scenario.mixed) {
        await expect(frame.locator("body")).toHaveCSS("background-color", "rgb(17, 17, 17)");
        await expect(frame.locator("body")).toHaveCSS("color", "rgb(238, 238, 238)");
      }
      await page.evaluate("window.scrollTo(0, 0)");
      await expect.poll(() => page!.evaluate("window.scrollY")).toBe(0);
      for (let row = 0; row < 3; row++)
        await expect(frame.getByRole("listitem").nth(row)).toBeInViewport();
      const message = await page.locator(".notice [role=status]").first().innerText();
      assert(message.includes("Changed one entry in Shopping list."), message);
      await page.screenshot({ path: path.join(folder, `${scenario.name}.png`) });
      await page.screenshot({
        path: path.join(folder, `${scenario.name}-full.png`),
        fullPage: true,
      });
      reports[index++] = { name: scenario.name, outcome: "passed", message };
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
          passed: !problem && reports.every((r) => r.outcome === "passed"),
          requiredCaseCount: PLAN.cases.length,
          captureLimit:
            "Viewport screenshots are authoritative for runtime visibility. Full-page screenshots are supplementary: nested frames can shrink, clip or omit content (L-76), even when visible-row assertions pass.",
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
  const folder = await runChatDataCheck(runModeFrom(process.argv.slice(2), PLAN.callCap));
  console.log(`Chat data check evidence: ${folder}`);
  console.log(fs.readFileSync(path.join(folder, "report.json"), "utf8"));
}
