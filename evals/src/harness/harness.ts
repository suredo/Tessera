import fs from "node:fs";
import path from "node:path";
import type { LedgerEntry, ProviderErrorKind, RUN_MODES, Usage } from "@tessera/contracts";
import {
  ProviderError,
  UNKNOWN_USAGE,
  type Provider,
  type StageResult,
  type StageSpec,
} from "@tessera/server";
import {
  appendLine,
  LEDGER_FILE,
  readLedger,
  REQUEST_LOG_FILE,
  summarizeLedger,
  SUMMARY_FILE,
  type LedgerSummary,
} from "./ledger.ts";

// Wraps a provider for an evaluation run (OBS-02, ENG-07): a hard cap on calls, a ledger and
// request log for every call, the run's own data folder, and a dry run that can't reach a model.

export type RunMode = (typeof RUN_MODES)[number];

export type HarnessOptions = {
  provider: Provider;
  /** A dry run takes only a provider that can't reach a model; a live run only one that can. */
  mode: RunMode;
  /** The approved hard cap on calls (ENG-07). It never grows during a run. */
  callCap: number;
  /** The run's own folder, new or empty, so it is never anyone's real data (ENG-19). */
  dataFolder: string;
  now?: () => Date;
};

export type Harness = {
  /** Call through this one: the same provider, guarded and recorded. */
  provider: Provider;
  dataFolder: string;
  /** Calls started so far; refused calls never started. */
  callsUsed(): number;
  /** Writes the run's summary beside its ledger and returns it. */
  finish(): LedgerSummary;
};

/** The harness refused a call or a run. Nothing reached the provider. */
export class HarnessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarnessError";
  }
}

// ENG-07 stop rules: after these, the run makes no more calls. A usage limit pauses the run; it
// resumes as a new run once the limit resets.
const STOPPING_ERRORS: ReadonlySet<ProviderErrorKind> = new Set([
  "sign_in",
  "usage_limit",
  "unavailable_model",
  "unsupported_effort",
]);

const NO_COST: Usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, durationMs: 0 };

function checkOptions({ provider, mode, callCap, dataFolder }: HarnessOptions): void {
  if (!Number.isInteger(callCap) || callCap < 1) {
    throw new HarnessError(`The call cap must be a whole number of at least 1, not ${callCap}.`);
  }
  if (mode === "dry-run" && provider.live) {
    throw new HarnessError(`A dry run can't use ${provider.name}: it can reach a real model.`);
  }
  if (mode === "live" && !provider.live) {
    throw new HarnessError(`A live run can't use ${provider.name}: it answers from a script.`);
  }
  if (fs.existsSync(dataFolder) && fs.readdirSync(dataFolder).length > 0) {
    throw new HarnessError(`The run's data folder must be new or empty: ${dataFolder}`);
  }
}

/** Starts a run: checks its options, creates its data folder and returns the guarded provider. */
export function startHarness(options: HarnessOptions): Harness {
  checkOptions(options);
  const { provider, mode, callCap, now = () => new Date() } = options;
  const dataFolder = path.resolve(options.dataFolder);
  fs.mkdirSync(dataFolder, { recursive: true });
  const ledgerFile = path.join(dataFolder, LEDGER_FILE);
  const requestFile = path.join(dataFolder, REQUEST_LOG_FILE);
  let nextIndex = 0;
  let used = 0;
  let stopped = false;

  const run = async <T>(spec: StageSpec<T>): Promise<StageResult<T>> => {
    const callIndex = nextIndex++;
    // Read before the call: the ledger line is written when it ends, maybe minutes later.
    const startedAt = now().toISOString();
    const record = (usage: Usage, outcome: LedgerEntry["outcome"]): void =>
      appendLine(ledgerFile, {
        callIndex,
        mode,
        provider: provider.name,
        stage: spec.stage,
        model: spec.model,
        effort: spec.effort,
        promptCharCount: spec.prompt.length,
        startedAt,
        usage,
        outcome,
      });
    const log = (answer: string | null): void =>
      appendLine(requestFile, { callIndex, stage: spec.stage, prompt: spec.prompt, answer });

    // Counted before the call starts, so calls made at the same time can't pass the cap together.
    if (stopped || used >= callCap) {
      record(NO_COST, { kind: "refused", reason: stopped ? "stopped" : "call_cap" });
      throw new HarnessError(
        stopped
          ? "The run stopped after a provider error, so it makes no more calls."
          : `The run has used all ${callCap} of its calls.`,
      );
    }
    used += 1;
    try {
      const result = await provider.run(spec);
      log(result.raw);
      record(result.usage, { kind: "ok" });
      return result;
    } catch (error) {
      log(null);
      if (error instanceof ProviderError) {
        if (STOPPING_ERRORS.has(error.kind)) stopped = true;
        record(error.usage, {
          kind: "failed",
          error: error.kind,
          message: error.message,
          ...(error.detail === undefined ? {} : { detail: error.detail }),
        });
      } else {
        record(UNKNOWN_USAGE, { kind: "crashed", message: String(error) });
      }
      throw error;
    }
  };

  const finish = (): LedgerSummary => {
    const summary = summarizeLedger(readLedger(dataFolder));
    const written = { mode, provider: provider.name, callCap, ...summary };
    fs.writeFileSync(path.join(dataFolder, SUMMARY_FILE), `${JSON.stringify(written, null, 2)}\n`);
    return summary;
  };

  return {
    provider: { name: provider.name, live: provider.live, run },
    dataFolder,
    callsUsed: () => used,
    finish,
  };
}
