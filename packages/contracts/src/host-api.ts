import { z } from "zod";
import { jsonValueSchema } from "./json.ts";
import { trashEntrySchema, trashSchema } from "./trash.ts";
import {
  savedToolSchema,
  versionHashSchema,
  workspaceSchema,
  workspaceVersionSchema,
} from "./workspace.ts";

// The host app's API (APP-03 to APP-08): everything the app's screens ask the server, listed once,
// as the bridge lists what a tool may ask. Each action has its arguments and result; the app sends
// `{ action, args }` to HOST_ROUTE and the server checks both ends against this list. Export and
// import move files, so they have routes of their own.

/** The server's one route for the host app's actions, on the app's own origin. */
export const HOST_ROUTE = "/api/host";

const id = z.uuid();
const title = workspaceSchema.shape.title;
const name = savedToolSchema.shape.name;
const dataRevision = workspaceSchema.shape.dataRevision;

/** Why restoring a version, or bringing back a recovery snapshot, was refused (DATA-10). */
export const RESTORE_REFUSALS = [
  "stale",
  "no-version",
  "incompatible",
  "invalid-defaults",
  "no-tool",
  "needs-confirmation",
  "no-snapshot",
  "invalid-source",
  "no-path",
  "failed",
  "not-repeatable",
  "too-large",
  "invalid",
] as const;
export type RestoreRefusal = (typeof RESTORE_REFUSALS)[number];

/** A value a restore would lose: where it was, and what it held (DATA-10). */
export const lossSchema = z.strictObject({
  path: z.array(z.string()).describe("Collection, record ID (or position) and field."),
  value: jsonValueSchema,
});
export type Loss = z.infer<typeof lossSchema>;

const refusal = <R extends readonly [string, ...string[]]>(reasons: R) =>
  z.strictObject({ ok: z.literal(false), reason: z.enum(reasons), message: z.string().min(1) });

export const restorePlanSchema = z
  .union([
    z.strictObject({ ok: z.literal(true), keepsData: z.literal(true) }),
    z.strictObject({
      ok: z.literal(true),
      keepsData: z.literal(false),
      losses: z.array(lossSchema),
      confirmation: z.string().describe("Confirms exactly this restore and these losses."),
    }),
    refusal(RESTORE_REFUSALS),
  ])
  .describe("What restoring a version would do, before it does it (DATA-10).");
export type RestorePlan = z.infer<typeof restorePlanSchema>;

export const restoreResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    workspace: workspaceSchema,
    snapshotId: z.string().nullable().describe("The recovery snapshot kept, if it lost data."),
  }),
  refusal(RESTORE_REFUSALS),
]);
export type RestoreResult = z.infer<typeof restoreResultSchema>;

export const recoverySnapshotSchema = z.strictObject({
  id: z.string(),
  versionHash: versionHashSchema,
  createdAt: z.iso.datetime(),
});
export type RecoverySnapshot = z.infer<typeof recoverySnapshotSchema>;

/** Why undoing a data change was refused (DATA-04). */
export const UNDO_REFUSALS = ["no-entry", "stale", "invalid", "too-large"] as const;
export type UndoRefusal = (typeof UNDO_REFUSALS)[number];

export const undoEntrySchema = z.strictObject({
  number: z.int().min(1),
  createdAt: z.iso.datetime(),
  kind: z.enum(["records", "whole"]).describe("A patch's records, or the data replaced whole."),
  recordCount: z.int().nonnegative().describe("How many records a patch touched; 0 for whole."),
});
export type UndoEntry = z.infer<typeof undoEntrySchema>;

const workspaceResult = z.strictObject({ workspace: workspaceSchema });

/** Every action the host app may ask of the server, with its arguments and result. */
export const HOST_ACTIONS = {
  "workspaces.list": {
    args: z.strictObject({}),
    result: z.strictObject({
      workspaces: z.array(workspaceSchema),
      lastUsed: z
        .record(z.uuid(), z.iso.datetime())
        .describe("When each was last used: opened or changed, whichever is later (APP-03)."),
    }),
  },
  "workspaces.open": {
    args: z.strictObject({ id }),
    result: z.strictObject({
      workspace: workspaceSchema,
      capabilities: z
        .array(z.string())
        .describe("What its current tool declares (CAP-01); none without a tool."),
    }),
  },
  "workspaces.create": { args: z.strictObject({ title }), result: workspaceResult },
  "workspaces.rename": { args: z.strictObject({ id, title }), result: workspaceResult },
  "workspaces.delete": {
    args: z.strictObject({ id }),
    result: z.strictObject({ entry: trashEntrySchema }),
  },
  "versions.list": {
    args: z.strictObject({ workspaceId: id }),
    result: z.strictObject({ versions: z.array(workspaceVersionSchema) }),
  },
  "versions.planRestore": {
    args: z.strictObject({ workspaceId: id, hash: versionHashSchema }),
    result: restorePlanSchema,
  },
  "versions.restore": {
    args: z.strictObject({
      workspaceId: id,
      hash: versionHashSchema,
      expectedDataRevision: dataRevision,
      confirmation: z.string().optional(),
    }),
    result: restoreResultSchema,
  },
  "snapshots.list": {
    args: z.strictObject({ workspaceId: id }),
    result: z.strictObject({ snapshots: z.array(recoverySnapshotSchema) }),
  },
  "snapshots.restore": {
    args: z.strictObject({ snapshotId: z.string().min(1), expectedDataRevision: dataRevision }),
    result: restoreResultSchema,
  },
  "undo.list": {
    args: z.strictObject({ workspaceId: id }),
    result: z.strictObject({ entries: z.array(undoEntrySchema) }),
  },
  "undo.undo": {
    args: z.strictObject({ workspaceId: id, number: z.int().min(1) }),
    result: z.union([
      z.strictObject({ ok: z.literal(true), workspace: workspaceSchema }),
      refusal(UNDO_REFUSALS),
    ]),
  },
  "library.list": {
    args: z.strictObject({}),
    result: z.strictObject({ savedTools: z.array(savedToolSchema) }),
  },
  "library.save": {
    args: z.strictObject({ workspaceId: id, name }),
    result: z.strictObject({ savedTool: savedToolSchema }),
  },
  "library.rename": {
    args: z.strictObject({ id, name }),
    result: z.strictObject({ savedTool: savedToolSchema }),
  },
  "library.delete": {
    args: z.strictObject({ id }),
    result: z.strictObject({ entry: trashEntrySchema }),
  },
  "library.continue": {
    args: z.strictObject({ id }),
    result: z.strictObject({ savedTool: savedToolSchema, workspace: workspaceSchema }),
  },
  "library.useAgain": {
    args: z.strictObject({ id, title: title.optional() }),
    result: z.union([
      z.strictObject({ ok: z.literal(true), workspace: workspaceSchema }),
      refusal(["no-tool", "no-version", "incompatible", "invalid-defaults"] as const),
    ]),
  },
  "trash.list": { args: z.strictObject({}), result: trashSchema },
  "trash.restoreWorkspace": { args: z.strictObject({ id }), result: workspaceResult },
  "trash.restoreSavedTool": {
    args: z.strictObject({ id }),
    result: z.strictObject({ savedTool: savedToolSchema }),
  },
  "trash.empty": {
    args: z.strictObject({ confirmation: z.string() }),
    result: z.strictObject({ removed: z.array(trashEntrySchema) }),
  },
} as const satisfies Record<string, { args: z.ZodType; result: z.ZodType }>;

export type HostActionName = keyof typeof HOST_ACTIONS;
export type HostArgs<A extends HostActionName> = z.infer<(typeof HOST_ACTIONS)[A]["args"]>;
export type HostResult<A extends HostActionName> = z.infer<(typeof HOST_ACTIONS)[A]["result"]>;

/** The largest request the host route reads; every action's arguments are small. */
export const HOST_REQUEST_LIMIT_BYTES = 64 * 1024;

export const hostRequestSchema = z
  .strictObject({ action: z.string().min(1).max(64), args: z.unknown() })
  .describe("What the host app asks the server: an action and its arguments.");
export type HostRequest = z.infer<typeof hostRequestSchema>;

/** Why the server couldn't do what the app asked; the message is plain words for the person. */
export const HOST_ERROR_CODES = ["invalid", "refused", "failed"] as const;

export const hostReplySchema = z
  .discriminatedUnion("ok", [
    z.strictObject({ ok: z.literal(true), result: z.unknown() }),
    z.strictObject({
      ok: z.literal(false),
      error: z.strictObject({ code: z.enum(HOST_ERROR_CODES), message: z.string().min(1) }),
    }),
  ])
  .describe("The server's answer to the host app; a result is checked by its action.");
export type HostReply = z.infer<typeof hostReplySchema>;
