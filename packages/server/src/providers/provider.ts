import {
  REVIEW_IMAGE_LIMITS,
  reviewImageSchema,
  type Effort,
  type ProviderErrorKind,
  type ReviewImage,
  type Stage,
  type Usage,
} from "@tessera/contracts";
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
  /**
   * The host's findings this call is asked to fix, kept in the ledger (GEN-10) so they outlive a
   * repair that succeeds. The prompt already quotes them; a provider doesn't use this.
   */
  diagnostics?: readonly string[];
  /**
   * Screenshots for the review stage alone, as image inputs, never as files the model can open
   * (A27, CLI-08). A provider that can't pass images (`acceptsImages`) is never sent any.
   */
  images?: readonly ReviewImage[];
};

export type StageResult<T> = { value: T; usage: Usage; raw: string };

export interface Provider {
  readonly name: string;
  /** True when a call can reach a real model and cost something. */
  readonly live: boolean;
  /** True when it can pass a review's screenshots to the model as image inputs (A27). */
  readonly acceptsImages?: boolean;
  run<T>(spec: StageSpec<T>): Promise<StageResult<T>>;
}

/**
 * The images a call may carry (A27): only the review stage's, only to a provider that accepts
 * them, at most the contract's count, each a PNG or JPEG within its size. Anything else is a
 * mistake in the caller, refused before a call is made.
 */
export function checkImages(spec: StageSpec<unknown>, accepts: boolean): readonly ReviewImage[] {
  const images = spec.images ?? [];
  if (images.length === 0) return images;
  if (spec.stage !== "review") throw new Error(`The ${spec.stage} stage takes no images.`);
  if (!accepts) throw new Error("This provider can't pass images; review without them.");
  if (images.length > REVIEW_IMAGE_LIMITS.count) {
    throw new Error(`A review takes at most ${REVIEW_IMAGE_LIMITS.count} images.`);
  }
  for (const image of images) reviewImageSchema.parse(image);
  return images;
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

  /**
   * For a "schema" failure: the answer as it came, unchecked, so the ledger can keep its code
   * (GEN-10). Never used as an answer: the call still fails.
   */
  readonly answer: unknown;

  constructor(
    kind: ProviderErrorKind,
    message: string,
    usage: Usage = UNKNOWN_USAGE,
    detail?: string,
    answer?: unknown,
  ) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.usage = usage;
    this.detail = detail;
    this.answer = answer;
  }
}
