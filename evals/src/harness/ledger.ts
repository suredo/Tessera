import fs from "node:fs";
import path from "node:path";
import {
  ledgerEntrySchema,
  requestLogEntrySchema,
  type LedgerEntry,
  type RequestLogEntry,
} from "@tessera/contracts";

// The files an evaluation run leaves in its data folder (OBS-02, ENG-07 "Record"): one JSON line
// per call in the ledger and in the request log, and the summary written when the run finishes.

export const LEDGER_FILE = "ledger.jsonl";
export const REQUEST_LOG_FILE = "requests.jsonl";
export const SUMMARY_FILE = "summary.json";

export type LedgerSummary = {
  /** Calls that started, whatever their outcome. Refused calls never started. */
  callCount: number;
  failedCount: number;
  refusedCount: number;
  /** Calls whose usage is partly unknown; the totals below leave their unknown parts out. */
  unknownUsageCount: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  durationMs: number;
};

export const appendLine = (file: string, entry: LedgerEntry | RequestLogEntry): void =>
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);

const readLines = <T>(file: string, parse: (value: unknown) => T): T[] =>
  fs.existsSync(file)
    ? fs
        .readFileSync(file, "utf8")
        .split(/\r?\n/)
        .filter((line) => line.trim() !== "")
        .map((line) => parse(JSON.parse(line)))
    : [];

/** The ledger of the run in `dataFolder`, each line checked against its contract. */
export const readLedger = (dataFolder: string): LedgerEntry[] =>
  readLines(path.join(dataFolder, LEDGER_FILE), (value) => ledgerEntrySchema.parse(value));

export const readRequestLog = (dataFolder: string): RequestLogEntry[] =>
  readLines(path.join(dataFolder, REQUEST_LOG_FILE), (value) => requestLogEntrySchema.parse(value));

/** What a run cost. Unknown usage is counted, never added as 0 (CLI-04). */
export function summarizeLedger(entries: readonly LedgerEntry[]): LedgerSummary {
  const summary: LedgerSummary = {
    callCount: 0,
    failedCount: 0,
    refusedCount: 0,
    unknownUsageCount: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
  };
  for (const { outcome, usage } of entries) {
    if (outcome.kind === "refused") {
      summary.refusedCount += 1;
      continue;
    }
    summary.callCount += 1;
    if (outcome.kind !== "ok") summary.failedCount += 1;
    if (Object.values(usage).some((value) => value === null)) summary.unknownUsageCount += 1;
    summary.inputTokens += usage.inputTokens ?? 0;
    summary.cachedInputTokens += usage.cachedInputTokens ?? 0;
    summary.outputTokens += usage.outputTokens ?? 0;
    summary.durationMs += usage.durationMs ?? 0;
  }
  return summary;
}
