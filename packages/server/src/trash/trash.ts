import { createHash } from "node:crypto";
import {
  TRASH_RETENTION_DAYS,
  trashEntrySchema,
  trashSchema,
  type SavedTool,
  type Trash,
  type TrashEntry,
  type Workspace,
} from "@tessera/contracts";
import { z } from "zod";
import { getSavedTool, getWorkspace, type Store } from "../workspaces/index.ts";

// The trash (DATA-09). Deleting a workspace or saved tool moves it here, where it can be restored
// for 30 days; after that it is removed for good. Nothing is removed any other way: emptying the
// trash early names what it removes and needs a confirmation of exactly that list.

const RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

const removedAt = (deletedAt: string) =>
  new Date(new Date(deletedAt).getTime() + RETENTION_MS).toISOString();

const expired = (store: Store, deletedAt: string) =>
  store.now().getTime() >= new Date(deletedAt).getTime() + RETENTION_MS;

const workspaceRow = z.object({ id: z.string(), title: z.string(), deleted_at: z.string() });
const savedToolRow = z.object({
  id: z.string(),
  name: z.string(),
  workspace_id: z.string(),
  deleted_at: z.string(),
});
const nameRow = z.object({ name: z.string() });

// Everything in the trash, expired or not, checked against the contract.
function allEntries(store: Store): TrashEntry[] {
  const workspaces = store.db
    .all(workspaceRow, "SELECT id, title, deleted_at FROM workspaces WHERE deleted_at IS NOT NULL")
    .map((row) =>
      trashEntrySchema.parse({
        kind: "workspace",
        id: row.id,
        name: row.title,
        deletedAt: row.deleted_at,
        removedAt: removedAt(row.deleted_at),
        savedTools: store.db
          .all(
            nameRow,
            "SELECT name FROM saved_tools WHERE workspace_id = ? AND deleted_with_workspace = 1 ORDER BY name COLLATE NOCASE",
            row.id,
          )
          .map((tool) => tool.name),
      }),
    );
  // A saved tool that went with its workspace is part of that workspace's entry.
  const savedTools = store.db
    .all(
      savedToolRow,
      "SELECT id, name, workspace_id, deleted_at FROM saved_tools WHERE deleted_at IS NOT NULL AND deleted_with_workspace = 0",
    )
    .map((row) =>
      trashEntrySchema.parse({
        kind: "savedTool",
        id: row.id,
        name: row.name,
        deletedAt: row.deleted_at,
        removedAt: removedAt(row.deleted_at),
      }),
    );
  return [...workspaces, ...savedTools].sort(
    (a, b) => b.deletedAt.localeCompare(a.deletedAt) || a.id.localeCompare(b.id),
  );
}

// Names exactly these entries, so a confirmation given for one list never empties another.
const confirmationOf = (entries: readonly TrashEntry[]) =>
  createHash("sha256")
    .update(JSON.stringify(entries.map((e) => [e.kind, e.id, e.deletedAt])))
    .digest("hex");

/**
 * What the trash holds that can still be restored, the most recently deleted first, with the
 * confirmation that empties exactly that.
 */
export function listTrash(store: Store): Trash {
  const entries = allEntries(store).filter((entry) => !expired(store, entry.deletedAt));
  return trashSchema.parse({ entries, confirmation: confirmationOf(entries) });
}

const notDeletable = (what: string, id: string) =>
  new Error(`There is no ${what} with the ID ${id} to delete.`);

/** Moves a workspace to the trash, with the saved tools that open it; they come back together. */
export function deleteWorkspace(store: Store, id: string): TrashEntry {
  const at = store.now().toISOString();
  store.db.transaction(() => {
    if (!getWorkspace(store, id)) throw notDeletable("workspace", id);
    store.db.run("UPDATE workspaces SET deleted_at = ? WHERE id = ?", at, id);
    store.db.run(
      "UPDATE saved_tools SET deleted_at = ?, deleted_with_workspace = 1 WHERE workspace_id = ? AND deleted_at IS NULL",
      at,
      id,
    );
  });
  return entryFor(store, "workspace", id);
}

/** Moves a saved tool to the trash; its workspace stays where it is. */
export function deleteSavedTool(store: Store, id: string): TrashEntry {
  const at = store.now().toISOString();
  store.db.transaction(() => {
    if (!getSavedTool(store, id)) throw notDeletable("saved tool", id);
    store.db.run(
      "UPDATE saved_tools SET deleted_at = ?, deleted_with_workspace = 0 WHERE id = ?",
      at,
      id,
    );
  });
  return entryFor(store, "savedTool", id);
}

function entryFor(store: Store, kind: TrashEntry["kind"], id: string): TrashEntry {
  const found = allEntries(store).find((entry) => entry.kind === kind && entry.id === id);
  if (!found)
    throw new Error(`The ${kind === "workspace" ? "workspace" : "saved tool"} isn't in the trash.`);
  return found;
}

// The trash entry to restore, refused plainly once it is past its 30 days.
function restorable(store: Store, kind: TrashEntry["kind"], id: string): TrashEntry {
  const entry = entryFor(store, kind, id);
  if (expired(store, entry.deletedAt)) {
    throw new Error(
      `"${entry.name}" was in the trash for more than ${TRASH_RETENTION_DAYS} days and is removed for good.`,
    );
  }
  return entry;
}

const restoreWorkspaceRows = (store: Store, id: string) => {
  store.db.run("UPDATE workspaces SET deleted_at = NULL WHERE id = ?", id);
  store.db.run(
    "UPDATE saved_tools SET deleted_at = NULL, deleted_with_workspace = 0 WHERE workspace_id = ? AND deleted_with_workspace = 1",
    id,
  );
};

/** Brings a workspace back from the trash, with the saved tools that went with it. */
export function restoreWorkspace(store: Store, id: string): Workspace {
  store.db.transaction(() => {
    restorable(store, "workspace", id);
    restoreWorkspaceRows(store, id);
  });
  return getWorkspace(store, id) as Workspace;
}

const workspaceOf = z.object({ workspace_id: z.string() });

/**
 * Brings a saved tool back from the trash. If its workspace is in the trash too, the workspace
 * comes back with it, so Continue always has a workspace to open.
 */
export function restoreSavedTool(store: Store, id: string): SavedTool {
  store.db.transaction(() => {
    restorable(store, "savedTool", id);
    store.db.run("UPDATE saved_tools SET deleted_at = NULL WHERE id = ?", id);
    const { workspace_id } = store.db.get(
      workspaceOf,
      "SELECT workspace_id FROM saved_tools WHERE id = ?",
      id,
    ) as { workspace_id: string };
    if (!getWorkspace(store, workspace_id)) restoreWorkspaceRows(store, workspace_id);
  });
  return getSavedTool(store, id) as SavedTool;
}

const hashRow = z.object({ hash: z.string() });

// Removes entries for good, with what only they used: a removed workspace's history, its saved
// tools, and the tool versions nothing else refers to any more. Runs inside a transaction.
function removeForGood(store: Store, entries: readonly TrashEntry[]): void {
  const hashes = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === "savedTool") {
      store.db.run("DELETE FROM saved_tools WHERE id = ? AND deleted_at IS NOT NULL", entry.id);
      continue;
    }
    store.db
      .all(hashRow, "SELECT DISTINCT hash FROM workspace_versions WHERE workspace_id = ?", entry.id)
      .forEach((row) => hashes.add(row.hash));
    // Its history and saved tools go with it (ON DELETE CASCADE).
    store.db.run("DELETE FROM workspaces WHERE id = ? AND deleted_at IS NOT NULL", entry.id);
  }
  // Only versions the removed workspaces used, so a version saved for work in progress stays.
  for (const hash of hashes) {
    store.db.run(
      "DELETE FROM tool_versions WHERE hash = ? AND NOT EXISTS (SELECT 1 FROM workspace_versions WHERE hash = ?)",
      hash,
      hash,
    );
  }
}

/** Removes for good what has been in the trash for 30 days or more, and returns it. */
export function removeExpired(store: Store): TrashEntry[] {
  return store.db.transaction(() => {
    const due = allEntries(store).filter((entry) => expired(store, entry.deletedAt));
    removeForGood(store, due);
    return due;
  });
}

/**
 * Empties the trash early: removes for good exactly the entries `listTrash` named with this
 * confirmation, and returns them. If the trash changed since, nothing is removed.
 */
export function emptyTrash(store: Store, confirmation: string): TrashEntry[] {
  return store.db.transaction(() => {
    const { entries, confirmation: current } = listTrash(store);
    if (confirmation !== current) {
      throw new Error("The trash changed since you looked at it, so nothing was removed.");
    }
    // With anything already past its 30 days, which the list no longer shows.
    removeForGood(store, allEntries(store));
    return entries;
  });
}
