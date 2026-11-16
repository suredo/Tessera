// Docs: docs/code/evals/runner.md
// The metrics of a live evaluation (OBS-03): per stage, its calls, failures, model time and tokens
// from the runs' ledgers; per kind of request that makes a tool, how often it needed a repair and
// how often its tool passed the host's checks and staging's at the first try. Usage nobody
// reported is counted as unknown, never as 0 (CLI-04). Reads no model and changes nothing.
// node evals/src/runner/metrics.ts <run folder>... prints the metrics as Markdown.
import { pathToFileURL } from "node:url";
import type { LedgerEntry } from "@tessera/contracts";
import { callsBySay, figures, readRun, type Figures, type Run } from "./speed.ts";

/** A stage's calls, as the ledgers kept them. */
export type StageMetrics = {
  calls: number;
  /** Calls that ended in a failure (a refused call never started, so isn't one). */
  failed: number;
  /** Model time of the calls that ended well, in seconds. */
  seconds?: Figures;
  /** Tokens per call, of the calls that reported them. */
  inputTokens?: Figures;
  cachedInputTokens?: Figures;
  outputTokens?: Figures;
  /** Calls with some usage nobody reported: left out of the figures above, never counted as 0. */
  unknownUsage: number;
};

/** Requests of one kind that make a tool, and how their tools fared before they opened. */
export type RequestMetrics = {
  requests: number;
  /** Requests that needed at least one repair call. */
  repaired: number;
  /** Requests whose tool passed the host's checks (data shape, static) at the first try. */
  hostChecksPassed: number;
  /** Requests whose tool passed staging's checks (smoke, first sight, behavior) at the first try. */
  stagingChecksPassed: number;
};

export type Metrics = {
  stages: Record<string, StageMetrics>;
  /** Requests that made a new tool, and those that changed one. */
  requests: { create: RequestMetrics; edit: RequestMetrics };
  /** Runs whose requests couldn't be matched to their calls, so none of their requests is counted. */
  unmatched: number;
};

// The repair parts by the checks whose failure they repair (GEN-09), by name; a repair whose
// ledger line doesn't name its parts, as in an older ledger, is counted as a repair of neither.
const HOST_REPAIRS = ["repair-schema-shape", "repair-static", "repair-data-plan"];
const STAGING_REPAIRS = [
  "repair-smoke",
  "repair-behavior",
  "repair-edit-smoke",
  "repair-edit-behavior",
];
const repairs = (calls: readonly LedgerEntry[], parts: readonly string[]) =>
  calls.some(
    (call) =>
      call.stage === "repair" &&
      (call.promptParts ?? []).some((part) => parts.includes(part.split("@")[0]!)),
  );

const known = (calls: readonly LedgerEntry[], pick: (call: LedgerEntry) => number | null) =>
  figures(calls.map(pick).filter((value): value is number => value !== null));

const none = (): RequestMetrics => ({
  requests: 0,
  repaired: 0,
  hostChecksPassed: 0,
  stagingChecksPassed: 0,
});

/** The metrics of one or more runs. A request sent only to be cancelled isn't counted. */
export function metricsOf(runs: readonly Run[]): Metrics {
  const byStage = new Map<string, LedgerEntry[]>();
  const requests = { create: none(), edit: none() };
  let unmatched = 0;
  for (const run of runs) {
    for (const call of run.calls) {
      if (call.outcome.kind === "refused") continue;
      byStage.set(call.stage, [...(byStage.get(call.stage) ?? []), call]);
    }
    const matched = callsBySay(run);
    if (!matched) {
      unmatched += 1;
      continue;
    }
    run.report.steps.forEach((step, index) => {
      const mine = matched[index];
      if (!mine || step.outcome === "blocked" || run.report.steps[index + 1]?.kind === "cancel") {
        return;
      }
      const stages = new Set(mine.map((call) => call.stage));
      const kind = stages.has("create") ? "create" : stages.has("edit") ? "edit" : undefined;
      if (!kind) return;
      const counted = requests[kind];
      counted.requests += 1;
      if (stages.has("repair")) counted.repaired += 1;
      if (!repairs(mine, HOST_REPAIRS)) counted.hostChecksPassed += 1;
      if (!repairs(mine, STAGING_REPAIRS)) counted.stagingChecksPassed += 1;
    });
  }
  const stages = Object.fromEntries(
    [...byStage].map(([stage, calls]): [string, StageMetrics] => {
      const seconds = figures(
        calls
          .filter((call) => call.outcome.kind === "ok" && call.usage.durationMs !== null)
          .map((call) => call.usage.durationMs! / 1000),
      );
      const input = known(calls, (call) => call.usage.inputTokens);
      const cached = known(calls, (call) => call.usage.cachedInputTokens);
      const output = known(calls, (call) => call.usage.outputTokens);
      return [
        stage,
        {
          calls: calls.length,
          failed: calls.filter((call) => call.outcome.kind !== "ok").length,
          ...(seconds ? { seconds } : {}),
          ...(input ? { inputTokens: input } : {}),
          ...(cached ? { cachedInputTokens: cached } : {}),
          ...(output ? { outputTokens: output } : {}),
          unknownUsage: calls.filter((call) =>
            Object.values(call.usage).some((value) => value === null),
          ).length,
        },
      ];
    }),
  );
  return { stages, requests, unmatched };
}

const seconds = (f: Figures | undefined) =>
  f ? `${f.p50.toFixed(1)} s / ${f.p95.toFixed(1)} s` : "unknown";
const tokens = (f: Figures | undefined) =>
  f
    ? `${Math.round(f.p50).toLocaleString("en")} / ${Math.round(f.p95).toLocaleString("en")}`
    : "unknown";
const share = (part: number, whole: number) =>
  whole === 0 ? "–" : `${part} of ${whole} (${Math.round((part / whole) * 100)}%)`;

/** The metrics as Markdown, for a live evaluation's report (OBS-03). */
export function metricsMarkdown(metrics: Metrics): string {
  const request = (name: string, r: RequestMetrics) =>
    `| ${name} | ${r.requests} | ${share(r.repaired, r.requests)} | ${share(r.hostChecksPassed, r.requests)} | ${share(r.stagingChecksPassed, r.requests)} |`;
  return [
    "## Per stage",
    "",
    "Time and tokens are p50 / p95 per call. Tokens count only the calls that reported them; the calls with usage nobody reported are counted apart, never as 0.",
    "",
    "| Stage | Calls | Failed | Model time | Input tokens | Cached input tokens | Output tokens | Usage unknown |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...Object.entries(metrics.stages).map(
      ([stage, m]) =>
        `| ${stage} | ${m.calls} | ${m.failed} | ${seconds(m.seconds)} | ${tokens(m.inputTokens)} | ${tokens(m.cachedInputTokens)} | ${tokens(m.outputTokens)} | ${m.unknownUsage} |`,
    ),
    "",
    "## Repairs and checks",
    "",
    "Of the requests that made or changed a tool: how many needed a repair, and how many tools passed the host's checks (data shape, static) and staging's (smoke, first sight, behavior) at the first try.",
    "",
    ...(metrics.unmatched > 0
      ? [
          `${metrics.unmatched === 1 ? "One run's" : `${metrics.unmatched} runs'`} requests couldn't be matched to their calls, so they aren't counted here.`,
          "",
        ]
      : []),
    "| Requests | Count | Repaired | Host checks passed first time | Staging checks passed first time |",
    "| --- | ---: | ---: | ---: | ---: |",
    request("New tools", metrics.requests.create),
    request("Changes", metrics.requests.edit),
    "",
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const folders = process.argv.slice(2);
  if (folders.length === 0) {
    console.error("Give one or more run folders: node evals/src/runner/metrics.ts <folder>...");
    process.exit(1);
  }
  console.log(metricsMarkdown(metricsOf(folders.map(readRun))));
}
