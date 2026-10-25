import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Artifact, Migration } from "@tessera/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { openDataFolder, type DataFolder } from "../src/storage/index.ts";
import { deleteWorkspace, emptyTrash, listTrash } from "../src/trash/index.ts";
import { saveVersion } from "../src/versions/index.ts";
import {
  activateVersion,
  createWorkspace,
  getWorkspace,
  listRecoverySnapshots,
  patchWorkspaceData,
  planRestore,
  readWorkspaceData,
  restoreRecoverySnapshot,
  restoreVersion,
  workspaceVersions,
} from "../src/workspaces/index.ts";

// Restoring a tool version (DATA-10, DATA-04): a compatible restore keeps the data; one to an
// older shape shows what it would drop, runs only once that preview is confirmed, and keeps a
// recovery snapshot first. Every data folder is a new temporary one (ENG-19).

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const newFolder = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-restore-"));
  temps.push(dir);
  return dir;
};

const listOf = (item: object) =>
  ({
    type: "object",
    properties: { tasks: { type: "array", items: item } },
  }) as Artifact["data"]["schema"];
const task = (properties: object, extra: object = {}) => ({
  type: "object",
  required: ["id", "title"],
  properties: { id: { type: "string" }, title: { type: "string" }, ...properties },
  additionalProperties: false,
  ...extra,
});
const version = (
  html: string,
  data: Partial<Artifact["data"]> & Pick<Artifact["data"], "schemaVersion" | "schema">,
): Artifact => ({
  contractVersion: 2,
  code: { html, css: "", js: "" },
  data: { defaults: { tasks: [] }, migrations: [], ...data },
  capabilities: [],
  pins: [],
  ui: { standardVersion: 1, mode: "standard" },
});
const toV2: Migration = {
  fromVersion: 1,
  toVersion: 2,
  operations: [{ op: "addField", collection: "tasks", fields: { done: false } }],
};
// Version 1 knows only titles; version 2 adds done and a note; "loose 1" is version 1's shape
// with other fields allowed; "strict 1" requires a field version 2's data doesn't have.
const v1 = version("<p>1</p>", {
  schemaVersion: 1,
  schema: listOf(task({})),
  defaults: { tasks: [{ id: "t-1", title: "Buy milk" }] },
});
const v2 = version("<p>2</p>", {
  schemaVersion: 2,
  schema: listOf(task({ done: { type: "boolean" }, note: { type: "string" } })),
  migrations: [toV2],
});
const loose1 = version("<p>Loose 1</p>", {
  schemaVersion: 1,
  schema: listOf(task({}, { additionalProperties: true })),
});
const strict1 = version("<p>Strict 1</p>", {
  schemaVersion: 1,
  schema: listOf(task({ owner: { type: "string" } }, { required: ["id", "title", "owner"] })),
});

/** A workspace that ran version 1, then version 2, and then got a note on its task. */
async function onVersion2() {
  const folder = await openDataFolder(newFolder());
  const { id } = createWorkspace(folder, "Errands");
  const hashes = {
    v1: saveVersion(folder.db, v1),
    v2: saveVersion(folder.db, v2),
    loose1: saveVersion(folder.db, loose1),
    strict1: saveVersion(folder.db, strict1),
  };
  expect(activateVersion(folder, id, hashes.v1, 0).ok).toBe(true);
  expect(activateVersion(folder, id, hashes.v2, 1).ok).toBe(true);
  expect(
    patchWorkspaceData(folder, id, {
      operations: [
        {
          op: "replace",
          collection: "tasks",
          id: "t-1",
          revisionCount: 2,
          fields: { note: "oat" },
        },
      ],
    }).ok,
  ).toBe(true);
  return { folder, id, hashes };
}

/** Everything a restore may change: the workspace row, its history, its data and its snapshots. */
const unit = (folder: DataFolder, id: string) => ({
  workspace: getWorkspace(folder, id),
  history: workspaceVersions(folder, id).map((v) => v.hash),
  data: readWorkspaceData(folder, id),
  snapshots: listRecoverySnapshots(folder, id),
});
const current = { tasks: [{ id: "t-1", title: "Buy milk", done: false, note: "oat" }] };

describe("restoring a tool version (DATA-10)", () => {
  it("DATA-10: a compatible restore keeps the current data exactly, and adds the version to the history", async () => {
    const { folder, id, hashes } = await onVersion2();
    expect(planRestore(folder, id, hashes.loose1)).toEqual({ ok: true, keepsData: true });
    const restored = restoreVersion(folder, id, hashes.loose1, 3);
    expect(restored).toMatchObject({ ok: true, snapshotId: null });
    expect(readWorkspaceData(folder, id).data).toEqual(current);
    expect(workspaceVersions(folder, id).map((v) => v.hash)).toEqual([
      hashes.v1,
      hashes.v2,
      hashes.loose1,
    ]);
    expect(listRecoverySnapshots(folder, id)).toEqual([]);
    folder.close();
  });

  it("DATA-10: an incompatible restore lists exactly what it drops, and runs only once that is confirmed", async () => {
    const { folder, id, hashes } = await onVersion2();
    const before = unit(folder, id);
    const plan = planRestore(folder, id, hashes.v1);
    expect(plan).toMatchObject({
      ok: true,
      keepsData: false,
      losses: [
        { path: ["tasks", "t-1", "done"], value: false },
        { path: ["tasks", "t-1", "note"], value: "oat" },
      ],
    });
    // Cancelling is not confirming: nothing changes, however often it is planned.
    expect(unit(folder, id)).toEqual(before);
    expect(restoreVersion(folder, id, hashes.v1, 3)).toMatchObject({
      ok: false,
      reason: "needs-confirmation",
    });
    expect(restoreVersion(folder, id, hashes.v1, 3, "0".repeat(64))).toMatchObject({
      reason: "needs-confirmation",
    });
    expect(unit(folder, id)).toEqual(before);

    const confirmation = plan.ok && !plan.keepsData ? plan.confirmation : "";
    const restored = restoreVersion(folder, id, hashes.v1, 3, confirmation);
    expect(restored.ok && typeof restored.snapshotId).toBe("string");
    expect(readWorkspaceData(folder, id).data).toEqual({
      tasks: [{ id: "t-1", title: "Buy milk" }],
    });
    expect(getWorkspace(folder, id)?.currentVersion).toBe(hashes.v1);
    folder.close();
  });

  it("DATA-10: a recovery snapshot brings back the unit from before the conversion, and keeps the one it replaces", async () => {
    const { folder, id, hashes } = await onVersion2();
    const plan = planRestore(folder, id, hashes.v1);
    const restored = restoreVersion(
      folder,
      id,
      hashes.v1,
      3,
      plan.ok && !plan.keepsData ? plan.confirmation : "",
    );
    const snapshotId = restored.ok ? restored.snapshotId! : "";
    expect(
      listRecoverySnapshots(folder, id).map(({ id, versionHash }) => ({ id, versionHash })),
    ).toEqual([{ id: snapshotId, versionHash: hashes.v2 }]);
    // The person goes on working in version 1, then wants the earlier unit back.
    expect(
      patchWorkspaceData(folder, id, {
        operations: [{ op: "add", collection: "tasks", record: { title: "Call the bank" } }],
      }).ok,
    ).toBe(true);
    const back = restoreRecoverySnapshot(
      folder,
      snapshotId,
      getWorkspace(folder, id)!.dataRevision,
    );
    expect(back).toMatchObject({ ok: true });
    expect(readWorkspaceData(folder, id).data).toEqual(current);
    expect(getWorkspace(folder, id)?.currentVersion).toBe(hashes.v2);
    // The work done in between is kept too, as a snapshot of its own.
    const snapshots = listRecoverySnapshots(folder, id);
    expect(snapshots).toHaveLength(2);
    expect(snapshots.map((s) => s.versionHash).sort()).toEqual([hashes.v1, hashes.v2].sort());
    folder.close();
  });

  it("DATA-10: a stale plan, a failed migration and an interrupted commit all keep the committed unit", async () => {
    const { folder, id, hashes } = await onVersion2();
    const plan = planRestore(folder, id, hashes.v1);
    const confirmation = plan.ok && !plan.keepsData ? plan.confirmation : "";
    // The person edits after the plan: the confirmed restore is now stale.
    expect(
      patchWorkspaceData(folder, id, {
        operations: [
          {
            op: "replace",
            collection: "tasks",
            id: "t-1",
            revisionCount: 3,
            fields: { note: "soy" },
          },
        ],
      }).ok,
    ).toBe(true);
    const before = unit(folder, id);
    expect(restoreVersion(folder, id, hashes.v1, 3, confirmation)).toMatchObject({
      ok: false,
      reason: "stale",
    });
    // A confirmation names the revision it was planned at: an old one doesn't run a new restore.
    expect(restoreVersion(folder, id, hashes.v1, 4, confirmation)).toMatchObject({
      reason: "needs-confirmation",
    });

    // A newer version whose migration fails.
    const failing = saveVersion(
      folder.db,
      version("<p>3</p>", {
        schemaVersion: 3,
        schema: listOf(task({ done: { type: "number" }, note: { type: "string" } })),
        migrations: [
          toV2,
          {
            fromVersion: 2,
            toVersion: 3,
            operations: [{ op: "setType", collection: "tasks", field: "done", to: "number" }],
          },
        ],
      }),
    );
    expect(restoreVersion(folder, id, failing, 4)).toMatchObject({ ok: false, reason: "failed" });

    // A confirmed restore interrupted after its writes, snapshot included.
    const fresh = planRestore(folder, id, hashes.v1);
    expect(() =>
      restoreVersion(
        folder,
        id,
        hashes.v1,
        4,
        fresh.ok && !fresh.keepsData ? fresh.confirmation : "",
        {
          afterWrites: () => {
            throw new Error("The power went out.");
          },
        },
      ),
    ).toThrow("The power went out.");
    expect(unit(folder, id)).toEqual(before);
    folder.close();
  });

  it("refuses a restore that dropping fields can't make fit, saying why", async () => {
    const { folder, id, hashes } = await onVersion2();
    const before = unit(folder, id);
    const plan = planRestore(folder, id, hashes.strict1);
    expect(plan).toMatchObject({ ok: false, reason: "incompatible" });
    expect(!plan.ok && plan.message).toMatch(/must have required property 'owner'/);
    expect(restoreVersion(folder, id, hashes.strict1, 3, "anything")).toMatchObject({
      reason: "incompatible",
    });
    expect(unit(folder, id)).toEqual(before);
    folder.close();
  });

  it("refuses a workspace with no tool, and removes snapshots with their workspace", async () => {
    const { folder, id, hashes } = await onVersion2();
    const empty = createWorkspace(folder, "Empty").id;
    expect(planRestore(folder, empty, hashes.v1)).toMatchObject({ ok: false, reason: "no-tool" });

    const plan = planRestore(folder, id, hashes.v1);
    restoreVersion(folder, id, hashes.v1, 3, plan.ok && !plan.keepsData ? plan.confirmation : "");
    expect(listRecoverySnapshots(folder, id)).toHaveLength(1);
    deleteWorkspace(folder, id);
    emptyTrash(folder, listTrash(folder).confirmation);
    const left = folder.db.get(
      z.object({ n: z.number() }),
      "SELECT COUNT(*) AS n FROM recovery_snapshots",
    );
    expect(left).toEqual({ n: 0 });
    folder.close();
  });
});
