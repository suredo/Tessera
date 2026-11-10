import { z } from "zod";
import { assetSchema } from "./asset.ts";
import { savedToolSchema, workspaceSchema, workspaceVersionSchema } from "./workspace.ts";

// Export archives (DATA-05): one file holding a workspace or saved tool with everything it needs,
// imported back exactly. The archive is a ZIP file with `manifest.json`, described here, and each
// tool version's canonical JSON under `versions/<hash>.json`, and from format 2 each image the
// workspace names under `assets/<id>` (DATA-11).

export const ARCHIVE_FORMAT = "tessera-archive";
/** Raised when the format changes; an archive from a newer format is refused (CON-04). */
export const ARCHIVE_FORMAT_VERSION = 6;

// Descriptions (APP-04) arrived in format 3: an older archive's workspaces and saved tools have none.
const archivedDescription = workspaceSchema.shape.description.default("");

// Version notes (APP-05) arrived in format 4: an older archive's versions have no summary or checks.
// The profile of a version's behavior check (VER-08) arrived in format 5: an older one's have none.
// The checks written from the request (VER-09) arrived among a version's checks in format 6.
const archivedVersionSchema = workspaceVersionSchema.extend({
  summary: workspaceVersionSchema.shape.summary.default(null),
  checks: workspaceVersionSchema.shape.checks.default([]),
  profile: workspaceVersionSchema.shape.profile.default(null),
});

export const archivedWorkspaceSchema = workspaceSchema
  .omit({ currentVersion: true })
  .extend({
    description: archivedDescription,
    versions: z
      .array(archivedVersionSchema)
      .describe("The version history, the first first; the last is the current version."),
  })
  .describe("A workspace as an archive holds it, with its whole version history.");
export type ArchivedWorkspace = z.infer<typeof archivedWorkspaceSchema>;

export const archiveManifestSchema = z
  .strictObject({
    format: z.literal(ARCHIVE_FORMAT),
    formatVersion: z.int().min(1),
    exported: z
      .enum(["workspace", "savedTool"])
      .describe("What the person exported: a workspace with its saved tools, or one saved tool."),
    exportedAt: z.iso.datetime(),
    workspaces: z.array(archivedWorkspaceSchema).min(1),
    savedTools: z.array(savedToolSchema.extend({ description: archivedDescription })),
    assets: z
      .array(assetSchema)
      .default([])
      .describe("The images the workspace names, each in assets/<id>; none before format 2."),
  })
  .describe("The manifest of an export archive (DATA-05).");
export type ArchiveManifest = z.infer<typeof archiveManifestSchema>;

// The host app's two archive routes (APP-06). Export takes what to export and answers with the
// archive's bytes, as a file to save; import takes a file's bytes and answers what came in, or why
// nothing did. They move files, so they aren't host actions, which carry JSON both ways.

export const EXPORT_ROUTE = "/api/export";
export const IMPORT_ROUTE = "/api/import";

export const exportRequestSchema = z
  .strictObject({ exported: archiveManifestSchema.shape.exported, id: z.uuid() })
  .describe("What the host app asks to export: a workspace with its saved tools, or a saved tool.");
export type ExportRequest = z.infer<typeof exportRequestSchema>;

export const importReplySchema = z
  .discriminatedUnion("ok", [
    z.strictObject({
      ok: z.literal(true),
      exported: archiveManifestSchema.shape.exported,
      workspaces: z.array(workspaceSchema.pick({ id: true, title: true })).min(1),
      savedTools: z.array(savedToolSchema.pick({ id: true, name: true })),
      asCopy: z
        .boolean()
        .describe(
          "True when something with the same IDs was already here, so it came in as a copy.",
        ),
    }),
    z.strictObject({ ok: z.literal(false), message: z.string().min(1) }),
  ])
  .describe("What an import brought in, for the plain report, or why it brought in nothing.");
export type ImportReply = z.infer<typeof importReplySchema>;
