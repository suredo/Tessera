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
    detail: z
      .string()
      .optional()
      .describe(
        "What the provider itself said: for diagnosis, never shown to the person as it is.",
      ),
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
    promptCharCount: z.int().nonnegative().describe("The request's size in characters."),
    systemCharCount: z
      .int()
      .nonnegative()
      .optional()
      .describe("The instructions' size in characters (GEN-03); missing in older ledgers."),
    promptParts: z
      .array(z.string().min(1))
      .optional()
      .describe("The prompt parts used, as name@version (ENG-16); missing in older ledgers."),
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

const tokenCount = z.int().nonnegative().nullable();

/** One model call the host app made, as its call ledger keeps it (OBS-01, GEN-10). */
export const ledgerCallSchema = z
  .strictObject({
    index: z.int().nonnegative().describe("Its place in the request, in the order calls ended."),
    stage: z.string().min(1),
    provider: z.string().min(1),
    model: z.string().min(1),
    effort: z.string().min(1),
    promptChars: z.int().nonnegative(),
    systemChars: z.int().nonnegative(),
    promptParts: z.array(z.string()).describe("The prompt parts used, as name@version (ENG-16)."),
    diagnostics: z
      .array(z.string())
      .describe("For a repair: the host's findings it was asked to fix (GEN-10)."),
    startedAt: z.iso.datetime(),
    durationMs: z.number().nonnegative().nullable(),
    inputTokens: tokenCount,
    cachedInputTokens: tokenCount,
    outputTokens: tokenCount,
    outcome: z.enum(["ok", "failed", "crashed"]),
    error: z.string().nullable().describe("A failure's kind (CLI-05)."),
    message: z.string().nullable().describe("A failure's plain message."),
    detail: z
      .string()
      .nullable()
      .describe("What the provider itself said: for diagnosis, never shown as the message."),
    code: z
      .strictObject({
        html: z.string().optional(),
        css: z.string().optional(),
        js: z.string().optional(),
      })
      .nullable()
      .describe(
        "The code a create, edit or repair call answered with, kept so an answer the checks refused can still be read (GEN-10); null for other calls and older ledgers.",
      ),
  })
  .describe("One call in the host app's ledger; null usage is unknown, never 0 (CLI-04).");
export type LedgerCall = z.infer<typeof ledgerCallSchema>;

/** One request the host app carried out, with its calls in order (OBS-01, GEN-10). */
export const ledgerRequestSchema = z
  .strictObject({
    id: z.uuid(),
    workspaceId: z.uuid().nullable(),
    kind: z.enum(["generate", "repair", "data"]),
    startedAt: z.iso.datetime(),
    endedAt: z.iso.datetime().nullable(),
    outcome: z
      .string()
      .nullable()
      .describe(
        "The reply's kind, with an answer's kind after a colon (answer:clarify), and a mixed request's entry part after another (mixed_data:answer:data_stale); null while it runs.",
      ),
    message: z.string().nullable().describe("The plain message the person read."),
    findings: z.array(z.string()).describe("The checks' findings when it failed (GEN-10)."),
    calls: z.array(ledgerCallSchema),
  })
  .describe("One request in the host app's ledger (OBS-01).");
export type LedgerRequest = z.infer<typeof ledgerRequestSchema>;
