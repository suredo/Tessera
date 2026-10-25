import type { Workspace } from "@tessera/contracts";
import { checkToolData, migrateData, type MigrationRefusal } from "../data-shape/index.ts";
import type { ToolData } from "../patches/index.ts";
import { loadVersion } from "../versions/index.ts";
import { appendVersion, existingWorkspace, replaceData, type Store } from "./workspaces.ts";

// Activating a tool version in a workspace (DATA-10): its code, data shape, defaults and the data
// change together, in one transaction, or not at all. The data the version was planned against
// must still be the data there (MIG-06); a first version fills the data from its defaults, and a
// later one migrates the data on a copy, checked against both shapes (DATA-03). A failed check,
// a stale revision or a crash during the commit keeps the committed unit.

export type ActivationRefusal =
  "stale" | "no-version" | "incompatible" | "older-shape" | "invalid-defaults" | MigrationRefusal;

export type ActivationResult =
  | { ok: true; workspace: Workspace; steps: number }
  | { ok: false; reason: ActivationRefusal; message: string };

export type ActivationOptions = {
  /** Called inside the transaction after every write; a test throws here to stand for a crash. */
  afterWrites?: () => void;
};

const refuse = (reason: ActivationRefusal, detail: string): ActivationResult => ({
  ok: false,
  reason,
  message: `Nothing was changed: ${detail}`,
});

/**
 * Makes the stored version `hash` the workspace's current one, with its data brought to the
 * version's shape, if the workspace's data revision is still `expectedDataRevision`. Everything
 * is checked before anything is written, and the writes are one transaction.
 */
export function activateVersion(
  store: Store,
  id: string,
  hash: string,
  expectedDataRevision: number,
  options: ActivationOptions = {},
): ActivationResult {
  return store.db.transaction((): ActivationResult => {
    const workspace = existingWorkspace(store, id);
    if (workspace.dataRevision !== expectedDataRevision) {
      return refuse(
        "stale",
        "the data changed after this change was planned, and that newer data is kept.",
      );
    }
    const target = loadVersion(store.db, hash);
    if (!target) return refuse("no-version", "there is no saved tool version with that name.");
    if (target.kind === "incompatible") {
      return refuse("incompatible", `the tool version can't be used. ${target.reason}`);
    }
    if (workspace.currentVersion === hash) return { ok: true, workspace, steps: 0 };
    const shape = target.artifact.data;

    let data: ToolData;
    let steps = 0;
    if (workspace.currentVersion === null || workspace.data === null) {
      // The workspace's first tool: its data starts as the version's reusable defaults (DATA-03).
      data = workspace.data ?? shape.defaults;
      const fits = checkToolData(shape.schema, data);
      if (!fits.ok)
        return refuse(
          "invalid-defaults",
          `the tool's starting data doesn't fit its own shape. ${fits.reason}`,
        );
    } else {
      const current = loadVersion(store.db, workspace.currentVersion);
      if (current?.kind !== "ok") {
        return refuse("incompatible", "the workspace's current tool version can't be read.");
      }
      const from = current.artifact.data;
      if (from.schemaVersion > shape.schemaVersion) {
        return refuse(
          "older-shape",
          `the tool version's data shape (version ${shape.schemaVersion}) is older than the data's (version ${from.schemaVersion}); restoring it converts the data, with a preview of what is lost.`,
        );
      }
      const migrated = migrateData(workspace.data, from, shape);
      if (!migrated.ok) return { ok: false, reason: migrated.reason, message: migrated.message };
      data = migrated.data;
      steps = migrated.steps;
    }

    replaceData(store, workspace, data);
    appendVersion(store, id, hash);
    options.afterWrites?.();
    return { ok: true, workspace: existingWorkspace(store, id), steps };
  });
}
