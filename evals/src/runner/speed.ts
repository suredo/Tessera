// Docs: docs/code/evals/runner.md
// How fast a live run was, against the speed targets (OBS-04): each stage's model time from the
// run's ledger, each request's time as the person waited for it from the run's report, and each
// target met or missed, said either way. Reads no model and changes nothing.
// node evals/src/runner/speed.ts <run folder>... prints the figures as Markdown.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ledgerEntrySchema, type LedgerEntry } from "@tessera/contracts";
import type { RunReport } from "./run.ts";

/** The targets a run can measure, from OBS-04: what is timed, and its p95 limit in seconds. */
export const SPEED_TARGETS = [
  { name: "Intent", measure: "intent call", limitSeconds: 10 },
  { name: "A chat data change", measure: "data request", limitSeconds: 15 },
  { name: "A first useful tool", measure: "create request", limitSeconds: 90 },
] as const;

/** A request by what it did: made a tool, changed one, changed its entries, or only answered. */
export type RequestKind = "create" | "edit" | "data" | "answer";

export type Figures = { count: number; p50: number; p95: number; slowest: number };

export type Speed = {
  /** Each stage's model time, from the ledger's calls that ended well. */
  stages: Record<string, Figures>;
  /** Each kind of request, timed as the person waited: sent until the host had said what happened. */
  requests: Partial<Record<RequestKind, Figures>>;
  /**
   * Runs whose requests couldn't be matched to their calls, so none of their requests is timed: an
   * older report without each step's calls whose intent calls don't pair one to one with its
   * requests, as after an intent retry.
   */
  unmatched: number;
  targets: {
    name: string;
    measure: string;
    limitSeconds: number;
    figures?: Figures;
    /** Unmeasured when the run had none to time. */
    met?: boolean;
  }[];
};

/** The nearest-rank percentile: with few samples, p95 is the slowest one. */
const rank = (sorted: readonly number[], q: number): number =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!;

export function figures(seconds: readonly number[]): Figures | undefined {
  if (seconds.length === 0) return undefined;
  const sorted = [...seconds].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: rank(sorted, 0.5),
    p95: rank(sorted, 0.95),
    slowest: sorted.at(-1)!,
  };
}

type Run = { report: Pick<RunReport, "steps">; calls: readonly LedgerEntry[] };

/**
 * Each request step's own calls. A report that records each step's calls (`StepResult.calls`) is
 * matched by them. An older one is matched in order, one intent call and the calls after it up to
 * the next, but only when it has exactly one intent call per request step: an intent retry (a
 * mixed split asked twice) would shift every later request, so such a run is left unmatched.
 */
function callsBySay(run: Run): (LedgerEntry[] | undefined)[] | undefined {
  const { report, calls } = run;
  const says = report.steps.filter((step) => step.kind === "say");
  if (says.every((step) => step.calls)) {
    return report.steps.map((step) =>
      step.kind === "say" && step.calls
        ? calls.filter((c) => c.callIndex >= step.calls!.from && c.callIndex < step.calls!.to)
        : undefined,
    );
  }
  if (calls.filter((c) => c.stage === "intent").length !== says.length) return undefined;
  let next = 0;
  return report.steps.map((step) => {
    if (step.kind !== "say") return undefined;
    const mine: LedgerEntry[] = [];
    if (calls[next]?.stage === "intent") mine.push(calls[next++]!);
    while (next < calls.length && calls[next]!.stage !== "intent") mine.push(calls[next++]!);
    return mine;
  });
}

/**
 * The speed of one or more runs: each stage's model time, and each request's time by what its own
 * calls did. A request sent only to be cancelled by the next step isn't timed, and neither is a
 * step that didn't run.
 */
export function speedOf(runs: readonly Run[]): Speed {
  const stageSeconds = new Map<string, number[]>();
  const requestSeconds = new Map<RequestKind, number[]>();
  let unmatched = 0;
  const add = <K>(map: Map<K, number[]>, key: K, value: number) =>
    map.set(key, [...(map.get(key) ?? []), value]);
  for (const { report, calls } of runs) {
    for (const call of calls) {
      if (call.outcome.kind === "ok" && call.usage.durationMs !== null) {
        add(stageSeconds, call.stage, call.usage.durationMs / 1000);
      }
    }
    const matched = callsBySay({ report, calls });
    if (!matched) {
      unmatched += 1;
      continue;
    }
    report.steps.forEach((step, index) => {
      const mine = matched[index];
      if (!mine) return;
      if (step.outcome === "blocked" || report.steps[index + 1]?.kind === "cancel") return;
      const stages = new Set(mine.map((call) => call.stage));
      const kind: RequestKind = stages.has("create")
        ? "create"
        : stages.has("edit")
          ? "edit"
          : stages.has("data")
            ? "data"
            : "answer";
      add(requestSeconds, kind, step.seconds);
    });
  }
  const stages = Object.fromEntries(
    [...stageSeconds].map(([stage, seconds]) => [stage, figures(seconds)!]),
  );
  const requests = Object.fromEntries(
    [...requestSeconds].map(([kind, seconds]) => [kind, figures(seconds)!]),
  ) as Speed["requests"];
  const measured: Record<(typeof SPEED_TARGETS)[number]["measure"], Figures | undefined> = {
    "intent call": stages["intent"],
    "data request": requests.data,
    "create request": requests.create,
  };
  return {
    stages,
    requests,
    unmatched,
    targets: SPEED_TARGETS.map((target) => {
      const found = measured[target.measure];
      return {
        ...target,
        ...(found ? { figures: found, met: found.p95 <= target.limitSeconds } : {}),
      };
    }),
  };
}

const s = (value: number) => `${value.toFixed(1)} s`;
const row = (name: string, f: Figures) =>
  `| ${name} | ${f.count} | ${s(f.p50)} | ${s(f.p95)} | ${s(f.slowest)} |`;

/** The figures as Markdown, misses said as plainly as passes (OBS-04). */
export function speedMarkdown(speed: Speed): string {
  const head = ["| | Count | p50 | p95 | Slowest |", "| --- | ---: | ---: | ---: | ---: |"];
  return [
    "## Targets",
    "",
    "| Target | Timed | Limit (p95) | Count | p95 | Result |",
    "| --- | --- | ---: | ---: | ---: | --- |",
    ...speed.targets.map((t) =>
      t.figures
        ? `| ${t.name} | ${t.measure} | ${s(t.limitSeconds)} | ${t.figures.count} | ${s(t.figures.p95)} | ${t.met ? "met" : "missed"} |`
        : `| ${t.name} | ${t.measure} | ${s(t.limitSeconds)} | 0 | – | not measured |`,
    ),
    "",
    "## Model time per stage",
    "",
    ...head,
    ...Object.entries(speed.stages).map(([stage, f]) => row(stage, f)),
    "",
    "## Requests, as the person waited",
    "",
    ...(speed.unmatched > 0
      ? [
          `${speed.unmatched === 1 ? "One run's" : `${speed.unmatched} runs'`} requests couldn't be matched to their calls, so they aren't timed here.`,
          "",
        ]
      : []),
    ...head,
    ...Object.entries(speed.requests).map(([kind, f]) => row(kind, f)),
    "",
  ].join("\n");
}

/** A run folder as the runner leaves it: its report and its harness ledger. */
export function readRun(folder: string): Run {
  const report = JSON.parse(fs.readFileSync(path.join(folder, "report.json"), "utf8")) as RunReport;
  const ledger = fs.readFileSync(path.join(folder, "harness", "ledger.jsonl"), "utf8");
  const calls = ledger
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => ledgerEntrySchema.parse(JSON.parse(line)));
  return { report, calls };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const folders = process.argv.slice(2);
  if (folders.length === 0) {
    console.error("Usage: node evals/src/runner/speed.ts <run folder>...");
    process.exit(2);
  }
  console.log(speedMarkdown(speedOf(folders.map(readRun))));
}
