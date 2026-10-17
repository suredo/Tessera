// Docs: docs/code/evals/harness.md
// The evaluation harness: a budget guard, call ledger and dry run around any provider (OBS-02).
export {
  HarnessError,
  startHarness,
  type Harness,
  type HarnessOptions,
  type RunMode,
} from "./harness.ts";
export {
  LEDGER_FILE,
  readLedger,
  readRequestLog,
  REQUEST_LOG_FILE,
  summarizeLedger,
  SUMMARY_FILE,
  type LedgerSummary,
} from "./ledger.ts";
