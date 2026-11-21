// Docs: docs/code/evals/ui-width.md
// LIVE only with --live --approved-cap 4. The owner approved this cap on 2026-11-20.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_ROUTES, type Creation } from "@tessera/contracts";
import { createTool, type Provider } from "@tessera/server";
import { HarnessError, startHarness, type RunMode } from "../../src/index.ts";
import {
  fakeClaudeProvider,
  liveClaudeProvider,
  runFolder,
  runModeFrom,
} from "../cli-contract/claude-cli.ts";

export const PLAN = {
  callCap: 4,
  caseCap: 2,
  cases: [
    {
      name: "focused-list",
      expected: "comfortable",
      request:
        "Make a simple shopping checklist for milk, eggs and bread. I want a focused list that is easy to tick off at the store.",
    },
    {
      name: "wide-board",
      expected: "wide",
      request:
        "Make a task board with three columns, To do, Doing and Done, that I can see together across my screen. Start with Plan the trip in To do, Book the train in Doing, and Choose dates in Done. Let me move each card between columns.",
    },
  ],
} as const;

/** Each creation has one repair reserve. Another stage or a third call never reaches the harness. */
export function caseProvider(provider: Provider): Provider {
  let calls = 0;
  return {
    name: `width-case:${provider.name}`,
    live: provider.live,
    run: (spec) => {
      if (spec.stage !== "create" && spec.stage !== "repair")
        throw new HarnessError("Only creation and its repair are approved.");
      if (calls >= PLAN.caseCap)
        throw new HarnessError("This case used its creation and repair reserve.");
      calls++;
      return provider.run(spec);
    },
  };
}

const canned = (width: "comfortable" | "wide"): Creation => ({
  outcome: "tool",
  name: "Width rehearsal",
  summary: "A canned answer for rehearsing the width check.",
  code: { html: "<h1>Width rehearsal</h1><p>Example content</p>", css: "", js: "" },
  data: { schema: { type: "object", properties: {} }, reusableDefaults: {}, initialState: {} },
  capabilities: [],
  uiMode: "standard",
  uiWidth: width,
});
const envelope = (answer: Creation) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  duration_ms: 1,
  structured_output: { answer },
  usage: {
    input_tokens: 1,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 1,
  },
});

/** Runs the two frozen width cases, stopping after a failed case or provider error. */
export async function runWidthCheck(mode: RunMode): Promise<string> {
  const folder = runFolder("ui-width", mode);
  fs.mkdirSync(folder, { recursive: true });
  let provider: Provider;
  let cliVersion: string | null = null;
  if (mode === "live") {
    const live = await liveClaudeProvider();
    provider = live.provider;
    cliVersion = live.cliVersion;
  } else {
    const replies = path.join(folder, "replies.json");
    fs.writeFileSync(
      replies,
      JSON.stringify(PLAN.cases.map((item) => envelope(canned(item.expected)))),
    );
    provider = fakeClaudeProvider(replies, path.join(folder, "calls"));
  }
  const answers: unknown[] = [];
  const recorded: Provider = {
    name: provider.name,
    live: provider.live,
    run: async (spec) => {
      const answer = await provider.run(spec);
      answers.push({ stage: spec.stage, answer: answer.value });
      return answer;
    },
  };
  const harness = startHarness({
    provider: recorded,
    mode,
    callCap: PLAN.callCap,
    dataFolder: path.join(folder, "harness"),
  });
  const cases: {
    name: string;
    expected: string;
    actual?: string;
    passed: boolean;
    calls: number;
    findings: string[];
  }[] = [];
  let error: string | null = null;
  try {
    for (const item of PLAN.cases) {
      const before = harness.callsUsed();
      const result = await createTool(caseProvider(harness.provider), DEFAULT_ROUTES, {
        request: item.request,
      });
      const actual = result.kind === "candidate" ? result.artifact.ui.width : undefined;
      const passed = actual === item.expected;
      cases.push({
        name: item.name,
        expected: item.expected,
        actual,
        passed,
        calls: harness.callsUsed() - before,
        findings:
          result.kind === "failed"
            ? result.findings
            : result.kind === "cannot"
              ? [result.reason]
              : [],
      });
      if (!passed) break;
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    fs.writeFileSync(path.join(folder, "answers.json"), `${JSON.stringify(answers, null, 2)}\n`);
    fs.writeFileSync(
      path.join(folder, "report.json"),
      `${JSON.stringify({ mode, cliVersion, plan: PLAN, cases, blocked: PLAN.cases.length - cases.length, error, ledger: harness.finish() }, null, 2)}\n`,
    );
  }
  return folder;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const mode = runModeFrom(process.argv.slice(2), PLAN.callCap);
  const folder = await runWidthCheck(mode);
  console.log(folder);
  const report = fs.readFileSync(path.join(folder, "report.json"), "utf8");
  console.log(report);
  const parsed = JSON.parse(report) as { cases: { passed: boolean }[]; error: string | null };
  if (
    parsed.error ||
    parsed.cases.length !== PLAN.cases.length ||
    parsed.cases.some((item) => !item.passed)
  )
    process.exitCode = 1;
}
