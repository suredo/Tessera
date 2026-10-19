import { randomUUID } from "node:crypto";
import {
  savedToolSchema,
  workspaceSchema,
  workspaceVersionSchema,
  type SavedTool,
  type Workspace,
  type WorkspaceVersion,
} from "@tessera/contracts";
import { z } from "zod";
import type { DataFolder } from "../storage/index.ts";

// Workspaces, their version history and the saved-tools library (DATA-08). Every change is one
// transaction, committed before the call returns: there is no "unsaved work" to lose on a restart.

/** What these functions need of an open data folder; tests can pass their own clock. */
export type Store = Pick<DataFolder, "db" | "now">;

const workspaceFromRow = z
  .object({
    id: z.string(),
    title: z.string(),
    current_version: z.string().nullable(),
    data: z.string(),
    data_revision: z.number(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .transform((row) => ({
    id: row.id,
    title: row.title,
    currentVersion: row.current_version,
    data: JSON.parse(row.data) as unknown,
    dataRevision: row.data_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
  .pipe(workspaceSchema);

const versionFromRow = z
  .object({ number: z.number(), hash: z.string(), created_at: z.string() })
  .transform((row) => ({ index: row.number, hash: row.hash, createdAt: row.created_at }))
  .pipe(workspaceVersionSchema);

const savedToolFromRow = z
  .object({
    id: z.string(),
    name: z.string(),
    workspace_id: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .transform((row) => ({
    id: row.id,
    name: row.name,
    workspaceId: row.workspace_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
  .pipe(savedToolSchema);

// Only what isn't in the trash (DATA-09). The current version is the last entry of the history.
const SELECT_WORKSPACE = `SELECT w.id, w.title, w.data, w.data_revision, w.created_at, w.updated_at,
  (SELECT v.hash FROM workspace_versions v WHERE v.workspace_id = w.id
    ORDER BY v.number DESC LIMIT 1) AS current_version
  FROM workspaces w WHERE w.deleted_at IS NULL`;

const SELECT_SAVED_TOOL =
  "SELECT id, name, workspace_id, created_at, updated_at FROM saved_tools WHERE deleted_at IS NULL";

const stamp = (store: Store) => store.now().toISOString();

const inTrash = z.object({ n: z.number() });

// Says plainly whether it is missing or in the trash, where it can't be changed.
const missing = (store: Store, table: "workspaces" | "saved_tools", what: string, id: string) => {
  const trashed = store.db.get(
    inTrash,
    `SELECT COUNT(*) AS n FROM ${table} WHERE id = ? AND deleted_at IS NOT NULL`,
    id,
  );
  return new Error(
    trashed?.n
      ? `The ${what} is in the trash; restore it first.`
      : `There is no ${what} with the ID ${id}.`,
  );
};
const noWorkspace = (store: Store, id: string) => missing(store, "workspaces", "workspace", id);
const noSavedTool = (store: Store, id: string) => missing(store, "saved_tools", "saved tool", id);

export const getWorkspace = (store: Store, id: string): Workspace | undefined =>
  store.db.get(workspaceFromRow, `${SELECT_WORKSPACE} AND w.id = ?`, id);

const existingWorkspace = (store: Store, id: string): Workspace => {
  const found = getWorkspace(store, id);
  if (!found) throw noWorkspace(store, id);
  return found;
};

/** Every workspace, the most recently changed first. */
export const listWorkspaces = (store: Store): Workspace[] =>
  store.db.all(workspaceFromRow, `${SELECT_WORKSPACE} ORDER BY w.updated_at DESC, w.id`);

/** A new, empty workspace: no tool yet, and no data until the tool's defaults fill it. */
export function createWorkspace(store: Store, title: string): Workspace {
  const id = randomUUID();
  const at = stamp(store);
  store.db.run(
    "INSERT INTO workspaces (id, title, data, data_revision, created_at, updated_at) VALUES (?, ?, 'null', 0, ?, ?)",
    id,
    workspaceSchema.shape.title.parse(title),
    at,
    at,
  );
  return existingWorkspace(store, id);
}

export function renameWorkspace(store: Store, id: string, title: string): Workspace {
  const changed = store.db.run(
    "UPDATE workspaces SET title = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
    workspaceSchema.shape.title.parse(title),
    stamp(store),
    id,
  );
  if (changed === 0) throw noWorkspace(store, id);
  return existingWorkspace(store, id);
}

const lastNumber = z.object({ number: z.number().nullable() });

/**
 * Makes a stored tool version the workspace's current one, as the next entry of its history.
 * The version must already be stored (`saveVersion`).
 */
export function addWorkspaceVersion(store: Store, id: string, hash: string): WorkspaceVersion {
  const checkedHash = workspaceVersionSchema.shape.hash.parse(hash);
  return store.db.transaction(() => {
    existingWorkspace(store, id);
    const last = store.db.get(
      lastNumber,
      "SELECT MAX(number) AS number FROM workspace_versions WHERE workspace_id = ?",
      id,
    );
    const number = (last?.number ?? 0) + 1;
    const at = stamp(store);
    store.db.run(
      "INSERT INTO workspace_versions (workspace_id, number, hash, created_at) VALUES (?, ?, ?, ?)",
      id,
      number,
      checkedHash,
      at,
    );
    store.db.run("UPDATE workspaces SET updated_at = ? WHERE id = ?", at, id);
    return workspaceVersionSchema.parse({ index: number, hash: checkedHash, createdAt: at });
  });
}

/** A workspace's version history, the first version first. */
export function workspaceVersions(store: Store, id: string): WorkspaceVersion[] {
  existingWorkspace(store, id);
  return store.db.all(
    versionFromRow,
    "SELECT number, hash, created_at FROM workspace_versions WHERE workspace_id = ? ORDER BY number",
    id,
  );
}

/**
 * Replaces a workspace's data and raises its revision by one. `expectedRevision` is the revision
 * the new data was made from; if the data changed since, nothing is saved.
 */
export function saveWorkspaceData(
  store: Store,
  id: string,
  data: unknown,
  expectedRevision: number,
): Workspace {
  const body = JSON.stringify(workspaceSchema.shape.data.parse(data));
  return store.db.transaction(() => {
    const current = existingWorkspace(store, id);
    if (current.dataRevision !== expectedRevision) {
      throw new Error("The data changed since it was read, so nothing was saved.");
    }
    store.db.run(
      "UPDATE workspaces SET data = ?, data_revision = data_revision + 1, updated_at = ? WHERE id = ?",
      body,
      stamp(store),
      id,
    );
    return existingWorkspace(store, id);
  });
}

export const getSavedTool = (store: Store, id: string): SavedTool | undefined =>
  store.db.get(savedToolFromRow, `${SELECT_SAVED_TOOL} AND id = ?`, id);

/** The saved-tools library, by name. */
export const listSavedTools = (store: Store): SavedTool[] =>
  store.db.all(savedToolFromRow, `${SELECT_SAVED_TOOL} ORDER BY name COLLATE NOCASE, id`);

/** Save to my tools: a named library entry whose Continue opens the workspace (DATA-08). */
export function saveTool(store: Store, workspaceId: string, name: string): SavedTool {
  const id = randomUUID();
  const checkedName = savedToolSchema.shape.name.parse(name);
  return store.db.transaction(() => {
    existingWorkspace(store, workspaceId);
    const at = stamp(store);
    store.db.run(
      "INSERT INTO saved_tools (id, name, workspace_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      id,
      checkedName,
      workspaceId,
      at,
      at,
    );
    return savedToolSchema.parse({
      id,
      name: checkedName,
      workspaceId,
      createdAt: at,
      updatedAt: at,
    });
  });
}

export function renameSavedTool(store: Store, id: string, name: string): SavedTool {
  const changed = store.db.run(
    "UPDATE saved_tools SET name = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
    savedToolSchema.shape.name.parse(name),
    stamp(store),
    id,
  );
  const found = changed === 0 ? undefined : getSavedTool(store, id);
  if (!found) throw noSavedTool(store, id);
  return found;
}
