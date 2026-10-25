import type { SavedTool, Workspace } from "@tessera/contracts";
import { usableVersion, type UsableVersion } from "./activation.ts";
import {
  appendVersion,
  createWorkspace,
  existingSavedTool,
  existingWorkspace,
  replaceData,
  type Store,
} from "./workspaces.ts";

// Opening a saved tool (DATA-07): Continue goes back to the workspace the entry is linked to, with
// its current data; Use again starts a separate workspace from the same tool version and its
// reusable defaults only. Neither changes the entry, so Continue always opens the same workspace.

/** Where Continue goes: the entry and its linked workspace, named so the target is clear. */
export type ContinueTarget = { savedTool: SavedTool; workspace: Workspace };

/** Continue: the saved tool's linked workspace and its current data, or a plain error. */
export function continueSavedTool(store: Store, savedToolId: string): ContinueTarget {
  const savedTool = existingSavedTool(store, savedToolId);
  return { savedTool, workspace: existingWorkspace(store, savedTool.workspaceId) };
}

export type UseAgainRefusal = "no-tool" | Extract<UsableVersion, { ok: false }>["reason"];

export type UseAgainResult =
  { ok: true; workspace: Workspace } | { ok: false; reason: UseAgainRefusal; message: string };

export type UseAgainOptions = {
  /** The new workspace's title; the saved tool's name if not given. */
  title?: string;
  /** Called inside the transaction after every write; a test throws here to stand for a crash. */
  afterWrites?: () => void;
};

/**
 * Use again: a new workspace with the saved tool's current version and that version's reusable
 * defaults as its data, never the linked workspace's entries. It is saved as it is made, in one
 * transaction, and the saved tool still links to its own workspace.
 */
export function useAgain(
  store: Store,
  savedToolId: string,
  options: UseAgainOptions = {},
): UseAgainResult {
  return store.db.transaction((): UseAgainResult => {
    const savedTool = existingSavedTool(store, savedToolId);
    const linked = existingWorkspace(store, savedTool.workspaceId);
    if (linked.currentVersion === null) {
      return {
        ok: false,
        reason: "no-tool",
        message: "Nothing was changed: the saved tool has no tool in it yet.",
      };
    }
    const version = usableVersion(store, linked.currentVersion);
    if (!version.ok) return version;
    const fresh = createWorkspace(store, options.title ?? savedTool.name);
    replaceData(store, fresh, version.artifact.data.defaults);
    appendVersion(store, fresh.id, linked.currentVersion);
    options.afterWrites?.();
    return { ok: true, workspace: existingWorkspace(store, fresh.id) };
  });
}
