import {
  TOOL_DATA_LIMIT_BYTES,
  type ActivationRefusal,
  type ActivationReply,
  type Artifact,
} from "@tessera/contracts";
import { checkToolData, migrateData } from "../data-shape/index.ts";
import type { ToolData } from "../patches/index.ts";
import { loadVersion } from "../versions/index.ts";
import { appendVersion, existingWorkspace, replaceData, type Store } from "./workspaces.ts";

// Activating a tool version in a workspace (DATA-10): its code, data shape, defaults and the data
// change together, in one transaction, or not at all. The data the version was planned against
// must still be the data there (MIG-06); a first version fills the data from its defaults, and a
// later one migrates the data on a copy, checked against both shapes (DATA-03). A failed check,
// a stale revision or a crash during the commit keeps the committed unit.

// The result is the contract's reply (one definition, P3), so a migration's reasons must be
// among the contract's refusals for this to compile.
export type { ActivationRefusal };

export type ActivationResult = ActivationReply;

export type ActivationOptions = {
  /** Recheck request authority after migration/validation, immediately before the first write. */
  beforeWrites?: () => void;
  /** Called inside the transaction after every write; a test throws here to stand for a crash. */
  afterWrites?: () => void;
};

// A version is one unit with its reusable defaults (DATA-03): they must fit its own shape and the
// data limit (DATA-06) on every activation, whether or not they become the data now, since Use
// again starts a workspace from them. Undefined if they do; otherwise why not.
export function defaultsProblem(shape: Artifact["data"]): string | undefined {
  const fits = checkToolData(shape.schema, shape.defaults);
  if (!fits.ok) return `the tool's starting data doesn't fit its own shape. ${fits.reason}`;
  const bytes = Buffer.byteLength(JSON.stringify(shape.defaults), "utf8");
  if (bytes > TOOL_DATA_LIMIT_BYTES) {
    return `the tool's starting data is ${Math.ceil(bytes / 1024)} KB, over the limit of ${TOOL_DATA_LIMIT_BYTES / 1024} KB.`;
  }
  return undefined;
}

const refuse = <R extends ActivationRefusal>(reason: R, detail: string) => ({
  ok: false as const,
  reason,
  message: `Nothing was changed: ${detail}`,
});

export type UsableVersion =
  | { ok: true; artifact: Artifact }
  | { ok: false; reason: "no-version" | "incompatible" | "invalid-defaults"; message: string };

/**
 * The stored version `hash`, if it can be read and its defaults are a valid start (DATA-03), or
 * why not. Module-internal: activation and Use again (`reuse.ts`) check a version with it.
 */
export function usableVersion(store: Store, hash: string): UsableVersion {
  const target = loadVersion(store.db, hash);
  if (!target) return refuse("no-version", "there is no saved tool version with that name.");
  if (target.kind === "incompatible") {
    return refuse("incompatible", `the tool version can't be used. ${target.reason}`);
  }
  const defaults = defaultsProblem(target.artifact.data);
  if (defaults) return refuse("invalid-defaults", defaults);
  return { ok: true, artifact: target.artifact };
}

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
    const target = usableVersion(store, hash);
    if (!target.ok) return target;
    if (workspace.currentVersion === hash) return { ok: true, workspace, migrationCount: 0 };
    const shape = target.artifact.data;

    let data: ToolData;
    let migrationCount = 0;
    if (workspace.currentVersion === null || workspace.data === null) {
      // The workspace's first tool: its data starts as the version's reusable defaults (DATA-03),
      // checked above.
      data = workspace.data ?? shape.defaults;
      if (workspace.data !== null) {
        const fits = checkToolData(shape.schema, data);
        if (!fits.ok)
          return refuse("invalid", `the data doesn't fit the tool's shape. ${fits.reason}`);
      }
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
      migrationCount = migrated.steps;
    }

    options.beforeWrites?.();
    replaceData(store, workspace, data);
    appendVersion(store, id, hash);
    options.afterWrites?.();
    return { ok: true, workspace: existingWorkspace(store, id), migrationCount };
  });
}
