// Docs: docs/code/evals/cli-contract-spike.md
// LIVE with --live: makes real model calls, only with the owner's approval of the budget (ENG-07).
// The CLI contract spike (#19, A33): does Claude Code accept a zod-generated schema of realistic
// size, do the locked flags still work, and does structured output come back intact?
//   node evals/spikes/cli-contract/run.ts --dry-run                (a fake claude, no cost)
//   node evals/spikes/cli-contract/run.ts --live --approved-cap 3  (the real CLI)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { intentSchema, stageSchema } from "@tessera/contracts";
import type { Provider } from "@tessera/server";
import { z } from "zod";
import { HarnessError, startHarness, type LedgerSummary, type RunMode } from "../../src/index.ts";
import { artifactDraftSchema } from "./artifact-draft.ts";
import {
  fakeClaudeProvider,
  liveClaudeProvider,
  MAX_TURNS,
  resultEnvelopeSchema,
  runFolder,
  runModeFrom,
} from "./claude-cli.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The approved run (ENG-07): change it only with a new approval. */
export const PLAN = {
  callCap: 3,
  model: "claude-haiku-5-5",
  effort: "low",
  timeLimitMs: 120_000,
} as const;

const SCHEMAS = { intent: intentSchema, "artifact-draft": artifactDraftSchema } as const;
const callsSchema = z.array(
  z.strictObject({
    check: z.string().min(1),
    stage: stageSchema,
    contract: z.enum(["intent", "artifact-draft"]),
    request: z.string().min(1),
  }),
);
const readPrompt = (name: string) => fs.readFileSync(path.join(here, "prompts", name), "utf8");
export const plannedCalls = () => callsSchema.parse(JSON.parse(readPrompt("calls.json")));

export type CallReport = { check: string; passed: boolean; notes: string[] };
export type SpikeReport = {
  mode: RunMode;
  cliVersion: string | null;
  calls: CallReport[];
  summary: LedgerSummary;
};

/** What an answered call shows about the contract beyond its schema, read from its envelope. */
export function inspectEnvelope(raw: string): string[] {
  const envelope = resultEnvelopeSchema.parse(JSON.parse(raw));
  const problems: string[] = [];
  if (envelope.num_turns === undefined) problems.push("no turn count");
  else if (envelope.num_turns > MAX_TURNS) problems.push(`${envelope.num_turns} turns`);
  if ((envelope.permission_denials ?? []).length > 0) problems.push("a tool was attempted");
  const usage = envelope.usage;
  if (usage?.input_tokens === undefined || usage.output_tokens === undefined) {
    problems.push("usage is incomplete");
  }
  return problems;
}

export async function runSpike(options: {
  mode: RunMode;
  provider: Provider;
  dataFolder: string;
  cliVersion?: string | null;
}): Promise<SpikeReport> {
  const harness = startHarness({
    provider: options.provider,
    mode: options.mode,
    callCap: PLAN.callCap,
    dataFolder: options.dataFolder,
  });
  const calls: CallReport[] = [];
  for (const [index, call] of plannedCalls().entries()) {
    let notes: string[];
    try {
      const result = await harness.provider.run({
        stage: call.stage,
        prompt: call.request,
        schema: SCHEMAS[call.contract] as z.ZodType<unknown>,
        model: PLAN.model,
        effort: PLAN.effort,
        tools: "none",
        timeLimitMs: PLAN.timeLimitMs,
      });
      notes = inspectEnvelope(result.raw);
    } catch (error) {
      notes = [String(error)];
      if (error instanceof HarnessError) {
        calls.push({ check: call.check, passed: false, notes });
        break;
      }
    }
    calls.push({ check: call.check, passed: notes.length === 0, notes });
    // ENG-07: if the first call fails, by an error or a check, later ones would spend calls with
    // nothing to build on.
    if (index === 0 && notes.length > 0) break;
  }
  const report: SpikeReport = {
    mode: options.mode,
    cliVersion: options.cliVersion ?? null,
    calls,
    summary: harness.finish(),
  };
  fs.writeFileSync(
    path.join(harness.dataFolder, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report;
}

/** The provider for a dry run: the same caller, starting the fake claude instead of the real one. */
export const fakeProvider = (dataFolder: string, repliesFile?: string): Provider =>
  fakeClaudeProvider(
    readPrompt("system.md"),
    repliesFile ?? path.join(here, "dry-run-replies.json"),
    path.join(dataFolder, "fake-calls"),
  );

async function main(argv: string[]): Promise<void> {
  const mode = runModeFrom(argv, PLAN.callCap);
  const dataFolder = runFolder("cli", mode);
  const { provider, cliVersion } =
    mode === "live"
      ? await liveClaudeProvider(readPrompt("system.md"))
      : { provider: fakeProvider(dataFolder), cliVersion: null };
  const report = await runSpike({ mode, provider, dataFolder, cliVersion });
  console.log(JSON.stringify(report, null, 2));
  console.log(`Ledger, request log and report: ${dataFolder}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(String(error));
    process.exitCode = 1;
  });
}
