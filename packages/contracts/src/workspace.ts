import { z } from "zod";

// Workspaces and the saved-tools library (DATA-08): what the local server stores and hands to the
// host app. Each is saved as it changes; there is no "unsaved work".

const id = z.uuid();
const timestamp = z.iso.datetime();
const versionHash = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .describe("A tool version's name: the SHA-256 of its canonical JSON (DATA-04).");

export const workspaceSchema = z
  .strictObject({
    id,
    title: z.string().min(1).max(200),
    currentVersion: versionHash
      .nullable()
      .describe("The tool version in use; null until the workspace has a tool."),
    data: z
      .record(z.string(), z.json())
      .nullable()
      .describe("The tool's data; null until the tool's defaults fill it (DATA-03)."),
    dataRevision: z
      .int()
      .nonnegative()
      .describe("Goes up by one with every data change, so a stale write can be refused."),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .describe("A workspace: one tool in use, its version history and its data (DATA-08).");
export type Workspace = z.infer<typeof workspaceSchema>;

export const workspaceVersionSchema = z
  .strictObject({
    index: z.int().min(1).describe("1 for the first version, then one more for each."),
    hash: versionHash,
    createdAt: timestamp,
  })
  .describe(
    "One entry of a workspace's version history; restoring an older version adds a new entry (DATA-04).",
  );
export type WorkspaceVersion = z.infer<typeof workspaceVersionSchema>;

export const savedToolSchema = z
  .strictObject({
    id,
    name: z.string().min(1).max(200),
    workspaceId: id.describe("The workspace that Continue opens; it follows its latest version."),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .describe("A named entry in the saved-tools library (DATA-08).");
export type SavedTool = z.infer<typeof savedToolSchema>;
