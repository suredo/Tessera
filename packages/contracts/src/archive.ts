import { z } from "zod";
import { assetSchema } from "./asset.ts";
import { savedToolSchema, workspaceSchema, workspaceVersionSchema } from "./workspace.ts";

// Export archives (DATA-05): one file holding a workspace or saved tool with everything it needs,
// imported back exactly. The archive is a ZIP file with `manifest.json`, described here, and each
// tool version's canonical JSON under `versions/<hash>.json`, and from format 2 each image the
// workspace names under `assets/<id>` (DATA-11).

export const ARCHIVE_FORMAT = "tessera-archive";
/** Raised when the format changes; an archive from a newer format is refused (CON-04). */
export const ARCHIVE_FORMAT_VERSION = 2;

export const archivedWorkspaceSchema = workspaceSchema
  .omit({ currentVersion: true })
  .extend({
    versions: z
      .array(workspaceVersionSchema)
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
    savedTools: z.array(savedToolSchema),
    assets: z
      .array(assetSchema)
      .default([])
      .describe("The images the workspace names, each in assets/<id>; none before format 2."),
  })
  .describe("The manifest of an export archive (DATA-05).");
export type ArchiveManifest = z.infer<typeof archiveManifestSchema>;
