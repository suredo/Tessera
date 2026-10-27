import type { Effort, ProviderErrorKind, Stage, Usage } from "@tessera/contracts";
import type { z } from "zod";

// The one interface every model connection implements (CLI-01): the scripted provider now, the
// Claude Code adapter in M2, Codex in M3 and API-key providers later (CLI-10).

/** One model call: what to ask, the shape the answer must have, and how to run it. */
export type StageSpec<T> = {
  stage: Stage;
  /** The stage's instructions, assembled from its prompt parts (GEN-03). */
  system: string;
  /** The prompt parts `system` and `prompt` were built from, as name@version, for the ledger (ENG-16). */
  promptParts?: readonly string[];
  /** The request: what the person asked, and what the stage needs to answer it. */
  prompt: string;
  /** The host checks the answer against this, whatever the provider promises. */
  schema: z.ZodType<T>;
  model: string;
  effort: Effort;
  /** Only research gets web tools; no stage gets file tools (CLI-03). */
  tools: "none" | "web";
  timeLimitMs: number;
  signal?: AbortSignal;
};

export type StageResult<T> = { value: T; usage: Usage; raw: string };

export interface Provider {
  readonly name: string;
  /** True when a call can reach a real model and cost something. */
  readonly live: boolean;
  run<T>(spec: StageSpec<T>): Promise<StageResult<T>>;
}

export const UNKNOWN_USAGE: Usage = {
  inputTokens: null,
  cachedInputTokens: null,
  outputTokens: null,
  durationMs: null,
};

/** A failed model call. It stops the request instead of being repaired (CLI-05). */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  /** What the call cost before it failed, as far as it is known (CLI-04). */
  readonly usage: Usage;
  /**
   * What the provider itself said, for the ledger and the details view (GEN-10). The message is
   * the plain sentence the person reads; this is never shown to them as it is.
   */
  readonly detail: string | undefined;

  constructor(
    kind: ProviderErrorKind,
    message: string,
    usage: Usage = UNKNOWN_USAGE,
    detail?: string,
  ) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.usage = usage;
    this.detail = detail;
  }
}
