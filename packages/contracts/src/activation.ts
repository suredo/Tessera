import { z } from "zod";
import { versionHashSchema, workspaceSchema } from "./workspace.ts";

// Activating a tool version (DATA-10, RUN-03): once a candidate has passed its checks in the
// staging panel, the host page asks the server to make it the workspace's current version. The
// server activates it atomically, or refuses with one of these reasons and changes nothing.

/** The server's one route for activating a tool version, on the host app's own origin. */
export const ACTIVATION_ROUTE = "/api/activate";

/** Why an activation was refused; the workspace keeps its committed version and data. */
export const ACTIVATION_REFUSALS = [
  // The data changed after the activation was planned (MIG-06).
  "stale",
  "no-version",
  "incompatible",
  // A version whose data shape is older than the data's is a restore, with a loss preview.
  "older-shape",
  "invalid-defaults",
  // The migration's own reasons (MIG-03 to MIG-05).
  "invalid-source",
  "no-path",
  "failed",
  "not-repeatable",
  "too-large",
  "invalid",
] as const;
export type ActivationRefusal = (typeof ACTIVATION_REFUSALS)[number];

export const activationRequestSchema = z
  .strictObject({
    workspaceId: z.uuid(),
    hash: versionHashSchema.describe("The stored tool version to activate."),
    expectedDataRevision: z
      .int()
      .nonnegative()
      .describe("The data revision the activation was planned against (MIG-06)."),
  })
  .describe("What the host page sends to activate a tool version that passed its checks.");
export type ActivationRequest = z.infer<typeof activationRequestSchema>;

export const activationReplySchema = z
  .discriminatedUnion("ok", [
    z.strictObject({
      ok: z.literal(true),
      workspace: workspaceSchema,
      migrationCount: z.int().nonnegative().describe("How many migrations the data went through."),
    }),
    z.strictObject({
      ok: z.literal(false),
      reason: z.enum(ACTIVATION_REFUSALS),
      message: z
        .string()
        .min(1)
        .describe("Plain words for the person: nothing was changed, and why."),
    }),
  ])
  .describe("The server's answer to an activation (DATA-10).");
export type ActivationReply = z.infer<typeof activationReplySchema>;
