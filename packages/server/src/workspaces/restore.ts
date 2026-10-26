import { createHash, randomUUID } from "node:crypto";
import {
  canonicalJson,
  type RecoverySnapshot,
  type RestorePlan,
  type RestoreRefusal,
  type RestoreResult,
  type Workspace,
} from "@tessera/contracts";
import { z } from "zod";
import { checkToolData, migrateData, projectData, type Loss } from "../data-shape/index.ts";
import type { ToolData } from "../patches/index.ts";
import { loadVersion } from "../versions/index.ts";
import { defaultsProblem, type ActivationOptions } from "./activation.ts";
import { appendVersion, existingWorkspace, replaceData, type Store } from "./workspaces.ts";

// Restoring a tool version (DATA-10, DATA-04): the restored version becomes the newest entry of
// the workspace's history, and the data is kept whenever it can be. Data that fits the version as
// it is stays exactly as it is. Otherwise it is converted: migrated forward to a newer shape, or
// projected onto an older one, keeping what that schema allows. Every value a conversion removes
// or replaces is listed in a loss preview, and such a restore needs a confirmation of exactly
// that preview; before it runs, the whole current unit is kept as a recovery snapshot, which it
// must be able to bring back. If the conversion can't make the data fit, the restore is refused
// with the reason. Nothing is written before every check passes, and the writes are one
// transaction.

// The refusals, plan and result are the contract's (one definition, P3), so the host app reads
// exactly what this module answers; a migration's reasons must be among them to compile.
export type { RestorePlan, RestoreRefusal, RestoreResult };

const refuse = (reason: RestoreRefusal, detail: string) => ({
  ok: false as const,
  reason,
  message: `Nothing was changed: ${detail}`,
});

type Planned =
  | { kind: "keeps"; data: ToolData }
  | { kind: "loses"; data: ToolData; losses: Loss[] }
  | { kind: "same" }
  | ReturnType<typeof refuse>;

// What restoring `hash` would make of the workspace's data; reads only.
function plan(store: Store, workspace: Workspace, hash: string): Planned {
  if (workspace.currentVersion === null || workspace.data === null) {
    return refuse("no-tool", "the workspace has no tool yet; activate a version instead.");
  }
  const target = loadVersion(store.db, hash);
  if (!target) return refuse("no-version", "there is no saved tool version with that name.");
  if (target.kind === "incompatible") {
    return refuse("incompatible", `the tool version can't be used. ${target.reason}`);
  }
  if (workspace.currentVersion === hash) return { kind: "same" };
  const shape = target.artifact.data;
  const defaults = defaultsProblem(shape);
  if (defaults) return refuse("invalid-defaults", defaults);
  const current = loadVersion(store.db, workspace.currentVersion);
  if (current?.kind !== "ok") {
    return refuse("incompatible", "the workspace's current tool version can't be read.");
  }
  const from = current.artifact.data;
  const data = workspace.data as ToolData;

  // Preserve first (DATA-10): data that fits the version as it is stays exactly as it is.
  if (checkToolData(shape.schema, data).ok) return { kind: "keeps", data };

  // A restore that drops anything keeps the current unit as a recovery snapshot first.
  const lossy = (converted: ToolData, losses: Loss[]): Planned => {
    const unrecoverable = cantSnapshot(store, workspace);
    if (unrecoverable) return refuse("incompatible", unrecoverable);
    return { kind: "loses", data: converted, losses };
  };

  if (shape.schemaVersion >= from.schemaVersion) {
    // A newer or equal shape: migrate forward. A migration that removes or replaces values loses
    // them, so it needs the same preview and confirmation as an older shape.
    const migrated = migrateData(data, from, shape, { trackLosses: true });
    if (!migrated.ok) return { ok: false, reason: migrated.reason, message: migrated.message };
    if (migrated.losses.length === 0) return { kind: "keeps", data: migrated.data };
    return lossy(migrated.data, migrated.losses);
  }
  // An older shape: keep what the older shape allows.
  const projected = projectData(data, shape.schema);
  const fits = checkToolData(shape.schema, projected.data);
  if (!fits.ok) {
    return refuse(
      "incompatible",
      `the data can't be brought back to that version's shape without more than dropping fields. ${fits.reason}`,
    );
  }
  return lossy(projected.data, projected.losses);
}

/**
 * Why a recovery snapshot of the workspace's current unit couldn't bring it back, or undefined if
 * it could: its version must be readable and its data must fit that version, as restoring the
 * snapshot will check. Every path that replaces the unit after keeping a snapshot asks this first.
 */
function cantSnapshot(store: Store, workspace: Workspace): string | undefined {
  const version = workspace.currentVersion
    ? loadVersion(store.db, workspace.currentVersion)
    : undefined;
  if (version?.kind !== "ok" || workspace.data === null) {
    return "the workspace's current tool version can't be read, so it couldn't be brought back from a recovery snapshot.";
  }
  const fits = checkToolData(version.artifact.data.schema, workspace.data);
  if (!fits.ok) {
    return `the current data doesn't fit its own version, so it couldn't be brought back from a recovery snapshot. ${fits.reason}`;
  }
  return undefined;
}

// Names exactly this restore: the version, the data revision it was planned at, and its losses,
// so a confirmation given for one preview never runs another.
const confirmationOf = (hash: string, dataRevision: number, losses: readonly Loss[]) =>
  createHash("sha256").update(canonicalJson({ hash, dataRevision, losses })).digest("hex");

/** What restoring the version `hash` in the workspace would do, without doing it. */
export function planRestore(store: Store, id: string, hash: string): RestorePlan {
  const workspace = existingWorkspace(store, id);
  const planned = plan(store, workspace, hash);
  if ("ok" in planned) return planned;
  if (planned.kind !== "loses") return { ok: true, keepsData: true };
  return {
    ok: true,
    keepsData: false,
    // Named for the person after the confirmation is made, so it confirms exactly the losses.
    losses: planned.losses.map((loss) => withRecord(loss, workspace.data)),
    confirmation: confirmationOf(hash, workspace.dataRevision, planned.losses),
  };
}

/** The fields a record is known by, in order: the first that holds text names it (GEN-12). */
const NAME_FIELDS = ["title", "name", "label", "text"];

/** A loss with its record's name, from the data before the restore, when the record has one. */
function withRecord(loss: Loss, data: Workspace["data"]): Loss {
  const [collection, key] = loss.path;
  const records = collection === undefined ? undefined : data?.[collection];
  if (!Array.isArray(records) || key === undefined) return loss;
  const record = records.find(
    (item, position) =>
      typeof item === "object" &&
      item !== null &&
      !Array.isArray(item) &&
      ((item as Record<string, unknown>)["id"] === key || String(position) === key),
  ) as Record<string, unknown> | undefined;
  const name = NAME_FIELDS.map((field) => record?.[field]).find(
    (value): value is string => typeof value === "string" && value.trim() !== "",
  );
  return name === undefined ? loss : { ...loss, record: name };
}

// Inside the caller's transaction: keeps the workspace's whole current unit, its tool version and
// its data, as a recovery snapshot.
function keepSnapshot(store: Store, workspace: Workspace): string {
  const id = randomUUID();
  store.db.run(
    "INSERT INTO recovery_snapshots (id, workspace_id, version_hash, data, created_at) VALUES (?, ?, ?, ?, ?)",
    id,
    workspace.id,
    workspace.currentVersion,
    JSON.stringify(workspace.data),
    store.now().toISOString(),
  );
  return id;
}

/**
 * Restores the version `hash` in the workspace, if its data revision is still
 * `expectedDataRevision`. A restore that drops data needs the `confirmation` of its plan, and
 * keeps a recovery snapshot of the current unit before it runs.
 */
export function restoreVersion(
  store: Store,
  id: string,
  hash: string,
  expectedDataRevision: number,
  confirmation?: string,
  options: ActivationOptions = {},
): RestoreResult {
  return store.db.transaction((): RestoreResult => {
    const workspace = existingWorkspace(store, id);
    if (workspace.dataRevision !== expectedDataRevision) {
      return refuse(
        "stale",
        "the data changed after this restore was planned, and that newer data is kept.",
      );
    }
    const planned = plan(store, workspace, hash);
    if ("ok" in planned) return planned;
    if (planned.kind === "same") return { ok: true, workspace, snapshotId: null };
    let snapshotId: string | null = null;
    if (planned.kind === "loses") {
      if (confirmation !== confirmationOf(hash, workspace.dataRevision, planned.losses)) {
        return refuse(
          "needs-confirmation",
          "this restore drops data; it runs only once its preview of what is lost is confirmed.",
        );
      }
      snapshotId = keepSnapshot(store, workspace);
    }
    replaceData(store, workspace, planned.data);
    appendVersion(store, id, hash);
    options.afterWrites?.();
    return { ok: true, workspace: existingWorkspace(store, id), snapshotId };
  });
}

const snapshotRow = z.object({
  id: z.string(),
  workspace_id: z.string(),
  version_hash: z.string(),
  data: z.string(),
  created_at: z.string(),
});

export type { RecoverySnapshot };

/** A workspace's recovery snapshots, the newest first. */
export function listRecoverySnapshots(store: Store, workspaceId: string): RecoverySnapshot[] {
  existingWorkspace(store, workspaceId);
  return store.db
    .all(
      snapshotRow,
      "SELECT id, workspace_id, version_hash, data, created_at FROM recovery_snapshots WHERE workspace_id = ? ORDER BY created_at DESC, id",
      workspaceId,
    )
    .map((row) => ({ id: row.id, versionHash: row.version_hash, createdAt: row.created_at }));
}

/**
 * Brings back the unit a recovery snapshot kept: its tool version and its data, if the
 * workspace's data revision is still `expectedDataRevision`. The unit it replaces is kept as a
 * recovery snapshot first, so bringing one back never loses newer work either.
 */
export function restoreRecoverySnapshot(
  store: Store,
  snapshotId: string,
  expectedDataRevision: number,
  options: ActivationOptions = {},
): RestoreResult {
  return store.db.transaction((): RestoreResult => {
    const row = store.db.get(
      snapshotRow,
      "SELECT id, workspace_id, version_hash, data, created_at FROM recovery_snapshots WHERE id = ?",
      snapshotId,
    );
    if (!row) return refuse("no-snapshot", "there is no recovery snapshot with that ID.");
    const workspace = existingWorkspace(store, row.workspace_id);
    if (workspace.dataRevision !== expectedDataRevision) {
      return refuse(
        "stale",
        "the data changed after this was planned, and that newer data is kept.",
      );
    }
    const version = loadVersion(store.db, row.version_hash);
    if (version?.kind !== "ok") {
      return refuse("incompatible", "the snapshot's tool version can't be read.");
    }
    const data = JSON.parse(row.data) as ToolData;
    const fits = checkToolData(version.artifact.data.schema, data);
    if (!fits.ok)
      return refuse("incompatible", `the snapshot's data doesn't fit its version. ${fits.reason}`);
    const unrecoverable = cantSnapshot(store, workspace);
    if (unrecoverable) return refuse("incompatible", unrecoverable);
    const kept = keepSnapshot(store, workspace);
    replaceData(store, workspace, data);
    if (workspace.currentVersion !== row.version_hash)
      appendVersion(store, workspace.id, row.version_hash);
    options.afterWrites?.();
    return { ok: true, workspace: existingWorkspace(store, workspace.id), snapshotId: kept };
  });
}
