import { z } from "zod";
import { effortSchema, providerErrorKindSchema, stageSchema, usageSchema } from "./provider.ts";

// What an evaluation run keeps of each model call (OBS-01, OBS-02): the call ledger, and the
// request log with what was asked and answered. Both are stored, one JSON line per call.

export const RUN_MODES = ["dry-run", "live"] as const;

const outcome = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ok") }),
  z.strictObject({
    kind: z.literal("failed"),
    error: providerErrorKindSchema,
    message: z.string(),
  }),
  z
    .strictObject({ kind: z.literal("crashed"), message: z.string() })
    .describe("The call broke in an unexpected way: a bug, never a model failure."),
  z
    .strictObject({ kind: z.literal("refused"), reason: z.enum(["call_cap", "stopped"]) })
    .describe("The guard refused the call before it started; it cost nothing."),
]);

export const ledgerEntrySchema = z
  .strictObject({
    callIndex: z.int().nonnegative(),
    mode: z.enum(RUN_MODES),
    provider: z.string().min(1),
    stage: stageSchema,
    model: z.string().min(1),
    effort: effortSchema,
    promptCharCount: z.int().nonnegative(),
    startedAt: z.iso.datetime(),
    usage: usageSchema,
    outcome,
  })
  .describe("One model call in an evaluation run's ledger (OBS-01, OBS-02).");
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;

export const requestLogEntrySchema = z
  .strictObject({
    callIndex: z.int().nonnegative(),
    stage: stageSchema,
    prompt: z.string(),
    answer: z.string().nullable().describe("The raw answer; null when there was none."),
  })
  .describe("What one call of an evaluation run asked and got back (OBS-02).");
export type RequestLogEntry = z.infer<typeof requestLogEntrySchema>;
