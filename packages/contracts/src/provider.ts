import { z } from "zod";

// What crosses the provider boundary (CLI-01): the stage a model call is for, what it cost and how
// it failed, and the canned replies a scripted provider gives instead of a model (ENG-11).

/** The pipeline stages that call a model, each with its own route (CLI-09). */
export const STAGES = [
  "intent",
  "create",
  "edit",
  "repair",
  "data",
  "research",
  "review",
  "acceptance",
] as const;
export const stageSchema = z.enum(STAGES);
export type Stage = z.infer<typeof stageSchema>;

export const EFFORTS = ["low", "medium", "high"] as const;
export const effortSchema = z.enum(EFFORTS);
export type Effort = z.infer<typeof effortSchema>;

/** Ways a model call fails, each mapped to its own plain message (CLI-05). */
export const PROVIDER_ERROR_KINDS = [
  "sign_in",
  "usage_limit",
  "unavailable_model",
  "unsupported_effort",
  "schema",
  "turn_limit",
  "time_limit",
  "cancelled",
] as const;
export const providerErrorKindSchema = z.enum(PROVIDER_ERROR_KINDS);
export type ProviderErrorKind = z.infer<typeof providerErrorKindSchema>;

const tokens = z.int().nonnegative().nullable();

/** What one call cost, normalized across providers (CLI-04). Unknown is null, never 0. */
export const usageSchema = z
  .strictObject({
    inputTokens: tokens.describe("All input: uncached, cache writes and cache reads."),
    cachedInputTokens: tokens.describe("The part of the input read from the cache."),
    outputTokens: tokens,
    durationMs: z.number().nonnegative().nullable().describe("Time spent on the call."),
  })
  .describe("What one model call cost (CLI-04). null means unknown, never 0.");
export type Usage = z.infer<typeof usageSchema>;

const usage = usageSchema.optional().describe("What the call reports it cost; 0 if left out.");

/** One canned reply: the value a model would return, or the error it would fail with. */
export const scriptedReplySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("value"),
    stage: stageSchema,
    value: z.json().describe("Checked against the stage's schema, as a model's answer would be."),
    usage,
  }),
  z.strictObject({
    kind: z.literal("error"),
    stage: stageSchema,
    error: providerErrorKindSchema,
    usage,
  }),
]);
export type ScriptedReply = z.infer<typeof scriptedReplySchema>;

/**
 * The replies a scripted provider gives, in order. Chosen by test configuration, never by words in
 * the request (ENG-11).
 */
export const providerScriptSchema = z.strictObject({
  name: z.string().min(1),
  replies: z.array(scriptedReplySchema),
});
export type ProviderScript = z.infer<typeof providerScriptSchema>;
