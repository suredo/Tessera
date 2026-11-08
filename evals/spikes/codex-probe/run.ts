// Docs: docs/code/evals/codex-probe.md
// LIVE with --live: makes real model calls, only with the owner's approval of the budget (ENG-07).
// The Codex probe (#266, A5): does the Codex adapter work against the real CLI? Whether
// `--output-schema` takes the contracts' wrapped schemas, how usage is counted, whether a host
// schema failure keeps the answer, and whether a call is offered any tool.
//   node evals/spikes/codex-probe/run.ts --dry-run                (the fake codex, no cost)
//   node evals/spikes/codex-probe/run.ts --live --approved-cap 2  (the real CLI)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { creationSchema, stageSchema } from "@tessera/contracts";
import {
  createCodexProvider,
  findCodex,
  findExecutable,
  MODEL_CATALOG_FILE,
  parseCodexEvents,
  ProviderError,
  restrictCatalog,
  type Provider,
} from "@tessera/server";
import { z } from "zod";
import { HarnessError, startHarness, type LedgerSummary, type RunMode } from "../../src/index.ts";
import { runFolder, runModeFrom } from "../cli-contract/claude-cli.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The approved run (ENG-07): the owner approved 4 Codex calls on 2026-11-07. The first run spent
 * one on gpt-5.5, which a ChatGPT sign-in can't use; the second one on gpt-6-luna, refused before
 * the model ran because strict structured output refuses `oneOf`. This is the remaining 2, after
 * the adapter learned to project the contracts onto strict mode. Change it only with a new approval.
 */
export const PLAN = {
  callCap: 2,
  model: "gpt-6-luna",
  effort: "low",
  timeLimitMs: 180_000,
} as const;

const toolsSchema = z.strictObject({ toolNames: z.array(z.string()), note: z.string() });

const SCHEMAS = {
  create: creationSchema,
  tools: toolsSchema,
} as const;

const callsSchema = z.array(
  z.strictObject({
    check: z.string().min(1),
    stage: stageSchema,
    contract: z.enum(["create", "tools"]),
    request: z.string().min(1),
  }),
);
const readPrompt = (name: string) => fs.readFileSync(path.join(here, "prompts", name), "utf8");
export const plannedCalls = () => callsSchema.parse(JSON.parse(readPrompt("calls.json")));

/** Event items a call may print; anything else (a command, a file change, a search) is a tool. */
const ALLOWED_ITEMS = new Set(["agent_message", "reasoning"]);

export type CallReport = {
  check: string;
  passed: boolean;
  notes: string[];
  /** The usage numbers as Codex printed them, for the open counting question (CLI-04). */
  codexUsage?: Record<string, unknown>;
  /** What the call answered, for the record. */
  answer?: unknown;
};
export type ProbeReport = {
  mode: RunMode;
  cliVersion: string | null;
  calls: CallReport[];
  summary: LedgerSummary;
};

/** What a call's events show beyond its schema: tool use, failures, and incomplete usage. */
export function inspectEvents(raw: string): {
  problems: string[];
  usage?: Record<string, unknown>;
} {
  const events = parseCodexEvents(raw);
  const problems: string[] = [];
  for (const event of events) {
    const type = event.item?.type;
    if (type !== undefined && !ALLOWED_ITEMS.has(type)) problems.push(`a tool item: ${type}`);
    if (event.type === "error" || event.type === "turn.failed")
      problems.push(`event ${event.type}`);
  }
  const usage = events.findLast((event) => event.type === "turn.completed")?.usage;
  if (usage?.input_tokens === undefined || usage.output_tokens === undefined) {
    problems.push("usage is incomplete");
  }
  return { problems, usage };
}

export async function runProbe(options: {
  mode: RunMode;
  provider: Provider;
  dataFolder: string;
  cliVersion?: string | null;
}): Promise<ProbeReport> {
  const harness = startHarness({
    provider: options.provider,
    mode: options.mode,
    callCap: PLAN.callCap,
    dataFolder: options.dataFolder,
  });
  const calls: CallReport[] = [];
  const raws = path.join(harness.dataFolder, "raw");
  fs.mkdirSync(raws, { recursive: true });
  for (const [index, call] of plannedCalls().entries()) {
    const report: CallReport = { check: call.check, passed: false, notes: [] };
    try {
      const result = await harness.provider.run({
        stage: call.stage,
        system: readPrompt("system.md"),
        prompt: call.request,
        schema: SCHEMAS[call.contract] as z.ZodType<unknown>,
        model: PLAN.model,
        effort: PLAN.effort,
        tools: "none",
        timeLimitMs: PLAN.timeLimitMs,
      });
      fs.writeFileSync(path.join(raws, `call-${index}.jsonl`), result.raw);
      const { problems, usage } = inspectEvents(result.raw);
      report.notes = problems;
      report.codexUsage = usage;
      report.answer = result.value;
    } catch (error) {
      if (error instanceof HarnessError) {
        report.notes = [String(error)];
        calls.push(report);
        break;
      }
      report.notes = [
        error instanceof ProviderError
          ? `${error.kind}: ${error.message} ${error.detail ?? ""}`.trim()
          : String(error),
      ];
      if (error instanceof ProviderError && error.answer !== undefined) {
        report.answer = error.answer;
        // Which parts of the contract the restored answer missed, to tell the projection's faults
        // from the model's.
        const issues = SCHEMAS[call.contract].safeParse(error.answer).error?.issues ?? [];
        report.notes.push(
          ...issues.map((issue) => `contract: ${issue.path.join(".")}: ${issue.message}`),
        );
      }
    }
    report.passed = report.notes.length === 0;
    calls.push(report);
    // ENG-07: if the first call fails, later ones would spend calls with nothing to build on.
    if (index === 0 && !report.passed) break;
  }
  const report: ProbeReport = {
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

/** The fake codex program the adapter's contract tests use, which never reaches a model. */
export const FAKE_CODEX = path.join(
  here,
  "..",
  "..",
  "..",
  "packages",
  "server",
  "test",
  "support",
  "fake-codex.ts",
);

/** The dry run's provider: the product adapter on the fake codex, with a home folder of its own. */
export function fakeProvider(dataFolder: string, repliesFile?: string): Provider {
  // Beside the run folder, which the harness wants new or empty.
  const home = `${dataFolder}-codex-home`;
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(
    path.join(home, MODEL_CATALOG_FILE),
    JSON.stringify(restrictCatalog(JSON.stringify({ models: [{ slug: PLAN.model }] }))),
  );
  return createCodexProvider({
    executable: process.execPath,
    leadingArgs: [
      FAKE_CODEX,
      repliesFile ?? path.join(here, "dry-run-replies.json"),
      path.join(dataFolder, "fake-calls"),
    ],
    live: false,
    home,
  });
}

/**
 * The PATH with npm's bundled codex.exe first: an npm install puts only codex.cmd on the PATH,
 * which the adapter refuses (L-45). Starting npm's launcher instead is #266's part 2.
 */
export function withBundledCodex(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const cmd = findExecutable("codex.cmd", env, process.platform);
  if (cmd === null) return env;
  const bin = path.join(
    path.dirname(cmd),
    "node_modules",
    "@openai",
    "codex",
    "node_modules",
    "@openai",
    "codex-win32-x64",
    "vendor",
    "x86_64-pc-windows-msvc",
    "bin",
  );
  if (!fs.existsSync(path.join(bin, "codex.exe"))) return env;
  const key = Object.keys(env).find((name) => name.toUpperCase() === "PATH") ?? "PATH";
  return { ...env, [key]: `${bin}${path.delimiter}${env[key] ?? ""}` };
}

/** Tessera's Codex home folder on this machine: one sign-in for development, evaluations and use. */
export const machineCodexHome = (): string =>
  path.join(
    process.env.LOCALAPPDATA ?? path.join(os.homedir(), ".local", "share"),
    "Tessera",
    "codex-home",
  );

/** The real CLI, after the adapter's free checks (found, version, home folder, sign-in, catalog). */
async function liveProvider(): Promise<{ provider: Provider; cliVersion: string }> {
  const home = machineCodexHome();
  const env = withBundledCodex(process.env);
  const found = await findCodex(home, env);
  // Anything wrong stops here, before the harness counts a call (L-71).
  if (!found.ok) throw new Error(found.message);
  return {
    provider: createCodexProvider({ executable: found.executable, live: true, home, env }),
    cliVersion: found.version,
  };
}

async function main(argv: string[]): Promise<void> {
  const mode = runModeFrom(argv, PLAN.callCap);
  const dataFolder = runFolder("codex-probe", mode);
  const { provider, cliVersion } =
    mode === "live"
      ? await liveProvider()
      : { provider: fakeProvider(dataFolder), cliVersion: null };
  const report = await runProbe({ mode, provider, dataFolder, cliVersion });
  console.log(JSON.stringify(report, null, 2));
  console.log(`Ledger, request log and report: ${dataFolder}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(String(error));
    process.exitCode = 1;
  });
}
