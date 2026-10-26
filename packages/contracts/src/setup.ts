import { z } from "zod";
import { modelSchema } from "./routes.ts";

// The setup check (PLAT-03) and the status screen (APP-07): what Tessera needs to reach a model,
// each failure in plain words with its fix, and the opt-in probe, one small model call (CLI-02).
// They start programs, so they have routes of their own beside the host API.

/** The setup check, answered to GET. */
export const SETUP_ROUTE = "/api/setup";
/** The probe, run on POST only, since it costs a model call. */
export const PROBE_ROUTE = "/api/setup/probe";

/** What can be wrong with Claude Code (CLI-02). */
export const CLAUDE_PROBLEMS = ["missing", "batch-file", "old", "signed-out", "broken"] as const;
export type ClaudeProblem = (typeof CLAUDE_PROBLEMS)[number];

const message = z.string().min(1).describe("What is wrong and how to fix it, in plain words.");

export const claudeCheckSchema = z.union([
  z.strictObject({ ok: z.literal(true), executable: z.string(), version: z.string() }),
  z.strictObject({ ok: z.literal(false), problem: z.enum(CLAUDE_PROBLEMS), message }),
]);
export type ClaudeCheck = z.infer<typeof claudeCheckSchema>;

export const nodeCheckSchema = z.union([
  z.strictObject({ ok: z.literal(true), version: z.string(), minimum: z.string() }),
  z.strictObject({ ok: z.literal(false), version: z.string(), minimum: z.string(), message }),
]);
export type NodeCheck = z.infer<typeof nodeCheckSchema>;

export const setupReportSchema = z
  .strictObject({
    ready: z
      .boolean()
      .describe("Every check passed, so what needs the model may be offered (PLAT-03)."),
    node: nodeCheckSchema,
    claude: claudeCheckSchema,
    dataFolder: z.strictObject({
      path: z.string(),
      bytes: z.int().nonnegative().describe("How much the data folder holds (APP-07)."),
    }),
  })
  .describe("The setup check: what Tessera needs to reach a model, and the data folder.");
export type SetupReport = z.infer<typeof setupReportSchema>;

export const probeResultSchema = z
  .union([
    z.strictObject({
      ok: z.literal(true),
      model: modelSchema,
      durationMs: z.int().nonnegative().nullable(),
    }),
    z.strictObject({ ok: z.literal(false), message }),
  ])
  .describe("How the probe went: one small structured answer from the model (CLI-02).");
export type ProbeResult = z.infer<typeof probeResultSchema>;
