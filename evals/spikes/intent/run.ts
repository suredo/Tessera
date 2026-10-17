// Docs: docs/code/evals/intent-spike.md
// LIVE with --live: makes real model calls, only with the owner's approval of the budget (ENG-07).
// The intent spike (#20, A33): how often does a draft intent stage misroute the kinds of request
// the POC got wrong (L-16 to L-20, L-67), in English and other languages (GEN-01, GEN-15)?
//   node evals/spikes/intent/run.ts --dry-run                 (a fake claude, no cost)
//   node evals/spikes/intent/run.ts --live --approved-cap 31  (the real CLI)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { INTENT_KINDS, intentSchema, type Intent } from "@tessera/contracts";
import type { Provider } from "@tessera/server";
import { z } from "zod";
import { HarnessError, startHarness, type LedgerSummary, type RunMode } from "../../src/index.ts";
import {
  fakeClaudeProvider,
  liveClaudeProvider,
  runFolder,
  runModeFrom,
} from "../cli-contract/claude-cli.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The approved run (ENG-07): one call per request, no retries. Change it only with a new approval. */
export const PLAN = {
  callCap: 31,
  model: "claude-haiku-5-5",
  effort: "low",
  timeLimitMs: 60_000,
} as const;

const CATEGORIES = [
  "create",
  "open-saved",
  "style",
  "behavior",
  "data",
  "mixed",
  "unrelated",
  "clarify",
  "unsupported",
] as const;

const toolSchema = z.strictObject({ name: z.string().min(1), description: z.string().min(1) });
const contextsSchema = z.record(
  z.string(),
  z.strictObject({
    open: toolSchema.nullable(),
    saved: z.array(toolSchema.extend({ id: z.string().min(1) })),
  }),
);
const requestsSchema = z.array(
  z.strictObject({
    id: z.string().min(1),
    category: z.enum(CATEGORIES),
    source: z.string().min(1),
    context: z.string().min(1),
    /** The primary language subtag the answer must give, such as pt for pt-BR. */
    language: z.string().regex(/^[a-z]{2,3}$/),
    request: z.string().min(1),
    expected: z.strictObject({
      kind: z.enum(INTENT_KINDS),
      savedToolId: z.string().optional(),
      lookOnly: z.boolean().optional(),
      behaviorChange: z.boolean().optional(),
      targetsCurrentTool: z.boolean().optional(),
      hasInterfacePart: z.boolean().optional(),
      hasDataPart: z.boolean().optional(),
    }),
  }),
);
export type IntentRequest = z.infer<typeof requestsSchema>[number];

const read = (...parts: string[]) => fs.readFileSync(path.join(here, ...parts), "utf8");
export const contexts = () => contextsSchema.parse(JSON.parse(read("contexts.json")));
export function requests(): IntentRequest[] {
  const all = requestsSchema.parse(JSON.parse(read("requests.json")));
  const known = contexts();
  for (const r of all) {
    if (!known[r.context]) throw new Error(`${r.id} names an unknown context "${r.context}".`);
  }
  return all;
}

/** The user message: the tool open now, the saved tools and the request (prompts/request.md). */
export function renderPrompt(request: IntentRequest): string {
  const context = contexts()[request.context];
  if (!context) throw new Error(`Unknown context "${request.context}".`);
  const open = context.open ? `${context.open.name}: ${context.open.description}` : "none";
  const saved = context.saved.length
    ? context.saved.map((t) => `- ${t.id}: ${t.name}. ${t.description}`).join("\n")
    : "none";
  // A function replacement, so `$` in a request is never read as a replacement pattern.
  return read("prompts", "request.md")
    .replace("{{open}}", () => open)
    .replace("{{saved}}", () => saved)
    .replace("{{request}}", () => request.request);
}

export type Scored = { misrouted: boolean; mismatches: string[] };

/** A misroute is a wrong kind, or the wrong saved tool. Other differences are listed apart. */
export function score(request: IntentRequest, answer: Intent): Scored {
  const want = request.expected;
  const misrouted =
    answer.kind !== want.kind ||
    (answer.kind === "open_saved" && answer.savedToolId !== want.savedToolId);
  const mismatches: string[] = [];
  const flag = (name: string, expected: boolean | undefined, got: boolean) => {
    if (expected !== undefined && expected !== got) mismatches.push(`${name} ${got}`);
  };
  flag("lookOnly", want.lookOnly, answer.lookOnly);
  flag("behaviorChange", want.behaviorChange, answer.behaviorChange);
  flag("targetsCurrentTool", want.targetsCurrentTool, answer.targetsCurrentTool);
  flag("interfacePart", want.hasInterfacePart, answer.interfacePart !== null);
  flag("dataPart", want.hasDataPart, answer.dataPart !== null);
  const primary = answer.language.split("-")[0];
  if (primary !== request.language) mismatches.push(`language ${answer.language}`);
  return { misrouted, mismatches };
}

export type RequestResult = {
  id: string;
  category: IntentRequest["category"];
  language: string;
  request: string;
  expected: string;
  got: string | null;
  misrouted: boolean;
  mismatches: string[];
  error: string | null;
};
export type CategoryResult = {
  category: string;
  requestCount: number;
  answeredCount: number;
  misroutedCount: number;
  /** Misroutes over answered requests; null when none was answered. */
  misroutePercent: number | null;
};
export type IntentReport = {
  mode: RunMode;
  cliVersion: string | null;
  categories: CategoryResult[];
  results: RequestResult[];
  summary: LedgerSummary;
};

const describe = (kind: string, savedToolId?: string) =>
  savedToolId ? `${kind} (${savedToolId})` : kind;

export async function runIntentSpike(options: {
  mode: RunMode;
  provider: Provider;
  dataFolder: string;
  cliVersion?: string | null;
}): Promise<IntentReport> {
  const harness = startHarness({
    provider: options.provider,
    mode: options.mode,
    callCap: PLAN.callCap,
    dataFolder: options.dataFolder,
  });
  const results: RequestResult[] = [];
  let failuresInARow = 0;
  for (const [index, request] of requests().entries()) {
    const base = {
      id: request.id,
      category: request.category,
      language: request.language,
      request: request.request,
      expected: describe(request.expected.kind, request.expected.savedToolId),
    };
    try {
      const { value } = await harness.provider.run({
        stage: "intent",
        prompt: renderPrompt(request),
        schema: intentSchema,
        model: PLAN.model,
        effort: PLAN.effort,
        tools: "none",
        timeLimitMs: PLAN.timeLimitMs,
      });
      const got = describe(value.kind, value.kind === "open_saved" ? value.savedToolId : undefined);
      results.push({ ...base, got, ...score(request, value), error: null });
      failuresInARow = 0;
    } catch (error) {
      results.push({ ...base, got: null, misrouted: false, mismatches: [], error: String(error) });
      failuresInARow += 1;
      // ENG-07: stop when the first call fails, when the harness refuses, or after two failures
      // in a row, which point to a cause that more calls won't fix.
      if (index === 0 || error instanceof HarnessError || failuresInARow >= 2) break;
    }
  }
  const report: IntentReport = {
    mode: options.mode,
    cliVersion: options.cliVersion ?? null,
    categories: CATEGORIES.map((category) => {
      const all = requests().filter((r) => r.category === category);
      const done = results.filter((r) => r.category === category && r.error === null);
      const misroutedCount = done.filter((r) => r.misrouted).length;
      return {
        category,
        requestCount: all.length,
        answeredCount: done.length,
        misroutedCount,
        misroutePercent: done.length ? Math.round((100 * misroutedCount) / done.length) : null,
      };
    }),
    results,
    summary: harness.finish(),
  };
  fs.writeFileSync(
    path.join(harness.dataFolder, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(harness.dataFolder, "report.md"), renderReport(report));
  return report;
}

const cell = (text: string) => text.replaceAll("|", "\\|");

/** The report as Markdown, ready to commit: our own test requests and the kinds the model chose. */
export function renderReport(report: IntentReport): string {
  const s = report.summary;
  const lines = [
    `# Intent spike: ${report.mode} run`,
    "",
    `Model ${PLAN.model}, effort ${PLAN.effort}; CLI ${report.cliVersion ?? "fake"}. Calls ${s.callCount} (cap ${PLAN.callCap}), failed ${s.failedCount}, refused ${s.refusedCount}. Input ${s.inputTokens} tokens (${s.cachedInputTokens} from cache), output ${s.outputTokens}, ${(s.durationMs / 1000).toFixed(1)} s.`,
    "",
    "| Category | Requests | Answered | Misrouted | Misroute rate |",
    "| --- | --- | --- | --- | --- |",
    ...report.categories.map(
      (c) =>
        `| ${c.category} | ${c.requestCount} | ${c.answeredCount} | ${c.misroutedCount} | ${c.misroutePercent === null ? "n/a" : `${c.misroutePercent}%`} |`,
    ),
    "",
    "## Misroutes",
    "",
  ];
  const misroutes = report.results.filter((r) => r.misrouted);
  lines.push(
    ...(misroutes.length
      ? [
          "| ID | Category | Language | Request | Expected | Got |",
          "| --- | --- | --- | --- | --- | --- |",
          ...misroutes.map(
            (r) =>
              `| ${r.id} | ${r.category} | ${r.language} | ${cell(r.request)} | ${r.expected} | ${r.got} |`,
          ),
        ]
      : ["None."]),
    "",
    "## Other differences",
    "",
  );
  const others = report.results.filter((r) => r.mismatches.length > 0);
  lines.push(
    ...(others.length
      ? others.map((r) => `- ${r.id} (${r.category}): ${r.mismatches.join(", ")}`)
      : ["None."]),
    "",
    "## Errors",
    "",
  );
  const errors = report.results.filter((r) => r.error !== null);
  lines.push(...(errors.length ? errors.map((r) => `- ${r.id}: ${r.error}`) : ["None."]), "");
  return lines.join("\n");
}

/** The fake's replies for a dry run: each request's expected answer, in order (ENG-11). */
export function expectedReplies(): unknown[] {
  return requests().map((r) => {
    const kind = r.expected.kind;
    const common = {
      interfacePart: ["create", "edit", "mixed", "new_tool"].includes(kind) ? r.request : null,
      dataPart: ["data", "mixed"].includes(kind) ? r.request : null,
      behaviorChange: r.expected.behaviorChange ?? false,
      lookOnly: r.expected.lookOnly ?? false,
      targetsCurrentTool: r.expected.targetsCurrentTool ?? ["edit", "data", "mixed"].includes(kind),
      language: r.language,
      features: [],
    };
    const answer =
      kind === "open_saved"
        ? { kind, savedToolId: r.expected.savedToolId ?? "", ...common }
        : { kind, ...common };
    return {
      type: "result",
      subtype: "success",
      is_error: false,
      num_turns: 2,
      duration_ms: 0,
      result: "",
      permission_denials: [],
      usage: {
        input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 0,
      },
      structured_output: { answer },
    };
  });
}

/** The dry run's provider, answering each request with its expected answer. */
export function fakeProvider(dataFolder: string, replies: unknown[] = expectedReplies()): Provider {
  // Beside the run's folder, which the harness needs new or empty.
  fs.mkdirSync(path.dirname(dataFolder), { recursive: true });
  const repliesFile = `${dataFolder}-replies.json`;
  fs.writeFileSync(repliesFile, JSON.stringify(replies));
  return fakeClaudeProvider(
    read("prompts", "system.md"),
    repliesFile,
    path.join(dataFolder, "fake-calls"),
  );
}

async function main(argv: string[]): Promise<void> {
  const mode = runModeFrom(argv, PLAN.callCap);
  const dataFolder = runFolder("intent", mode);
  const { provider, cliVersion } =
    mode === "live"
      ? await liveClaudeProvider(read("prompts", "system.md"))
      : { provider: fakeProvider(dataFolder), cliVersion: null };
  const report = await runIntentSpike({ mode, provider, dataFolder, cliVersion });
  console.log(renderReport(report));
  console.log(`Ledger, request log and reports: ${dataFolder}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(String(error));
    process.exitCode = 1;
  });
}
