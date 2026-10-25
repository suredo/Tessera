import { TOOL_DATA_LIMIT_BYTES, type Workspace } from "@tessera/contracts";
import { z } from "zod";
import { checkToolData } from "../data-shape/index.ts";
import type { ToolData } from "../patches/index.ts";
import { loadVersion } from "../versions/index.ts";
import { undoChangeSchema, undoRecords } from "./undo-entries.ts";
import {
  existingWorkspace,
  replaceData,
  savedRows,
  savedState,
  saveRevisions,
  type Store,
} from "./workspaces.ts";

// Data undo (DATA-04): each change to a workspace's data keeps an entry, and undoing one reverses
// only that change, if nothing has changed what it touched since. A newer edit is never
// overwritten: the undo is refused instead. Undoing data never changes the tool's code; restoring
// a version is DATA-10's.

/** One change the person can undo, newest first. */
export type UndoEntry = {
  number: number;
  createdAt: string;
  /** A patch's records, or the data replaced whole. */
  kind: "records" | "whole";
  /** How many records a patch touched; 0 for data replaced whole. */
  recordCount: number;
};

export type UndoRefusal = "no-entry" | "stale" | "invalid" | "too-large";
export type UndoResult =
  { ok: true; workspace: Workspace } | { ok: false; reason: UndoRefusal; message: string };

const entryRow = z.object({
  number: z.number(),
  change: z.string(),
  data_revision: z.number(),
  created_at: z.string(),
});

const refuse = (reason: UndoRefusal, detail: string): UndoResult => ({
  ok: false,
  reason,
  message: `Nothing was changed: ${detail}`,
});

/** The changes a workspace can undo, the newest first. */
export function listUndo(store: Store, id: string): UndoEntry[] {
  existingWorkspace(store, id);
  return store.db
    .all(
      entryRow,
      "SELECT number, change, data_revision, created_at FROM data_undo WHERE workspace_id = ? ORDER BY number DESC",
      id,
    )
    .map((row) => {
      const change = undoChangeSchema.parse(JSON.parse(row.change));
      return {
        number: row.number,
        createdAt: row.created_at,
        kind: change.kind,
        recordCount: change.kind === "records" ? change.records.length : 0,
      };
    });
}

/**
 * Undoes the change `number`, in one transaction: only what it touched goes back, and only if
 * nothing has changed that since. The result must fit the tool's current data shape and the data
 * limit, so a change made before the shape changed can't bring old records back. The entry is
 * used up; nothing is changed by a refusal.
 */
export function undoDataChange(store: Store, id: string, number: number): UndoResult {
  return store.db.transaction((): UndoResult => {
    const workspace = existingWorkspace(store, id);
    const row = store.db.get(
      entryRow,
      "SELECT number, change, data_revision, created_at FROM data_undo WHERE workspace_id = ? AND number = ?",
      id,
      number,
    );
    if (!row) return refuse("no-entry", "there is no such change to undo.");
    const change = undoChangeSchema.parse(JSON.parse(row.change));
    const current = savedState(store, id, workspace.data ?? {});

    let data: ToolData | null;
    let restored: string[] | undefined;
    if (change.kind === "whole") {
      // Data replaced whole can be undone only while nothing has changed since.
      if (workspace.dataRevision !== row.data_revision) {
        return refuse("stale", "the data changed after this change, and that newer work is kept.");
      }
      data = change.before;
    } else {
      const undone = undoRecords(change, current);
      if (!undone.ok) {
        return refuse(
          "stale",
          "a record this change touched was changed since, and that newer work is kept.",
        );
      }
      data = undone.data;
      restored = undone.restored;
    }

    if (data !== null) {
      const bytes = Buffer.byteLength(JSON.stringify(data), "utf8");
      if (bytes > TOOL_DATA_LIMIT_BYTES) {
        return refuse("too-large", `undoing it would take the data over its limit.`);
      }
      const version = workspace.currentVersion && loadVersion(store.db, workspace.currentVersion);
      if (version && version.kind === "ok") {
        const fits = checkToolData(version.artifact.data.schema, data);
        if (!fits.ok) {
          return refuse(
            "invalid",
            `the data from before this change no longer fits the tool. ${fits.reason}`,
          );
        }
      }
    }

    if (restored === undefined) {
      replaceData(store, workspace, data);
    } else {
      // Only what comes back moves to its next revision: a change planned against any other
      // record still applies (DATA-02).
      const held = new Map([...savedRows(store, id), ...current.revisions]);
      const after = savedState(store, id, data ?? {}).revisions;
      const revisions = new Map(
        [...after].map(([key, count]) => [
          key,
          restored.includes(key) ? (held.get(key) ?? 0) + 1 : count,
        ]),
      );
      store.db.run(
        "UPDATE workspaces SET data = ?, data_revision = data_revision + 1, updated_at = ? WHERE id = ?",
        JSON.stringify(data),
        store.now().toISOString(),
        id,
      );
      saveRevisions(store, id, revisions, held);
    }
    store.db.run("DELETE FROM data_undo WHERE workspace_id = ? AND number = ?", id, number);
    return { ok: true, workspace: existingWorkspace(store, id) };
  });
}
