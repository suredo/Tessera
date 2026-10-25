import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Artifact, Migration } from "@tessera/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { openDataFolder, type DataFolder } from "../src/storage/index.ts";
import { saveVersion } from "../src/versions/index.ts";
import {
  activateVersion,
  addWorkspaceVersion,
  createWorkspace,
  getWorkspace,
  patchWorkspaceData,
  readWorkspaceData,
  workspaceVersions,
} from "../src/workspaces/index.ts";

// Activating a tool version (DATA-10, DATA-03, MIG-06): code, shape, defaults and data change
// together, in one transaction, or not at all. Every data folder is a new temporary one (ENG-19).

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const newFolder = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-activation-"));
  temps.push(dir);
  return dir;
};

const listOf = (item: object) =>
  ({
    type: "object",
    properties: { tasks: { type: "array", items: item } },
  }) as Artifact["data"]["schema"];
const v1Task = {
  type: "object",
  required: ["id", "name"],
  properties: { id: { type: "string" }, name: { type: "string" } },
  additionalProperties: false,
};
const v2Task = {
  type: "object",
  required: ["id", "title", "done"],
  properties: { id: { type: "string" }, title: { type: "string" }, done: { type: "boolean" } },
  additionalProperties: false,
};
const toV2: Migration = {
  fromVersion: 1,
  toVersion: 2,
  operations: [
    { op: "renameField", collection: "tasks", from: "name", to: "title" },
    { op: "addField", collection: "tasks", fields: { done: false } },
  ],
};

const version = (
  html: string,
  data: Partial<Artifact["data"]> & Pick<Artifact["data"], "schemaVersion" | "schema">,
): Artifact => ({
  contractVersion: 2,
  code: { html, css: "", js: "" },
  data: { defaults: {}, migrations: [], ...data },
  capabilities: [],
  pins: [],
  ui: { standardVersion: 1, mode: "standard" },
});
const first = version("<p>Errands</p>", {
  schemaVersion: 1,
  schema: listOf(v1Task),
  defaults: { tasks: [{ id: "t-1", name: "Buy milk" }] },
});
const second = version("<p>Errands 2</p>", {
  schemaVersion: 2,
  schema: listOf(v2Task),
  defaults: { tasks: [] },
  migrations: [toV2],
});

/** A workspace with the first version active, and the second saved. */
async function withFirstActive() {
  const folder = await openDataFolder(newFolder());
  const { id } = createWorkspace(folder, "Errands");
  const firstHash = saveVersion(folder.db, first);
  const secondHash = saveVersion(folder.db, second);
  const activated = activateVersion(folder, id, firstHash, 0);
  expect(activated.ok).toBe(true);
  return { folder, id, firstHash, secondHash };
}

/** Everything activation may change: the workspace row, its history and its records' revisions. */
const unit = (folder: DataFolder, id: string) => ({
  workspace: getWorkspace(folder, id),
  history: workspaceVersions(folder, id).map((v) => v.hash),
  data: readWorkspaceData(folder, id),
});

describe("activating a tool version (DATA-10)", () => {
  it("fills a new workspace's data from the version's defaults", async () => {
    const { folder, id, firstHash } = await withFirstActive();
    expect(getWorkspace(folder, id)).toMatchObject({ currentVersion: firstHash, dataRevision: 1 });
    expect(readWorkspaceData(folder, id)).toEqual({
      data: { tasks: [{ id: "t-1", name: "Buy milk" }] },
      revisions: { tasks: { "t-1": 1 } },
    });
    folder.close();
  });

  it("migrates the data to the new version's shape, and commits code, shape and data together", async () => {
    const { folder, id, firstHash, secondHash } = await withFirstActive();
    const result = activateVersion(folder, id, secondHash, 1);
    expect(result).toMatchObject({ ok: true, steps: 1 });
    expect(unit(folder, id)).toMatchObject({
      workspace: { currentVersion: secondHash, dataRevision: 2 },
      history: [firstHash, secondHash],
      data: {
        data: { tasks: [{ id: "t-1", title: "Buy milk", done: false }] },
        // A record kept through the change moves to its next revision.
        revisions: { tasks: { "t-1": 2 } },
      },
    });
    folder.close();
  });

  it("MIG-06: refuses an activation planned against a data revision that has since changed", async () => {
    const { folder, id, secondHash } = await withFirstActive();
    // Planned at revision 1; then the person renames the task.
    expect(
      patchWorkspaceData(folder, id, {
        operations: [
          {
            op: "replace",
            collection: "tasks",
            id: "t-1",
            revisionCount: 1,
            fields: { name: "Buy oat milk" },
          },
        ],
      }).ok,
    ).toBe(true);
    const before = unit(folder, id);
    const result = activateVersion(folder, id, secondHash, 1);
    expect(result).toEqual({
      ok: false,
      reason: "stale",
      message:
        "Nothing was changed: the data changed after this change was planned, and that newer data is kept.",
    });
    expect(unit(folder, id)).toEqual(before);
    folder.close();
  });

  it("keeps the committed unit when a check fails", async () => {
    const { folder, id } = await withFirstActive();
    const before = unit(folder, id);
    // A version whose migration leaves out the required field "done".
    const broken = saveVersion(
      folder.db,
      version("<p>Broken</p>", {
        schemaVersion: 2,
        schema: listOf(v2Task),
        migrations: [{ ...toV2, operations: [toV2.operations[0]!] }],
      }),
    );
    expect(activateVersion(folder, id, broken, 1)).toMatchObject({ ok: false, reason: "invalid" });
    // A version with no way from the data's shape.
    const unreachable = saveVersion(
      folder.db,
      version("<p>Far</p>", { schemaVersion: 3, schema: listOf(v2Task) }),
    );
    expect(activateVersion(folder, id, unreachable, 1)).toMatchObject({
      ok: false,
      reason: "no-path",
    });
    expect(activateVersion(folder, id, "0".repeat(64), 1)).toMatchObject({
      ok: false,
      reason: "no-version",
    });
    expect(unit(folder, id)).toEqual(before);
    folder.close();
  });

  it("keeps the committed unit when the commit is interrupted after its writes", async () => {
    const { folder, id, secondHash } = await withFirstActive();
    const before = unit(folder, id);
    expect(() =>
      activateVersion(folder, id, secondHash, 1, {
        afterWrites: () => {
          throw new Error("The power went out.");
        },
      }),
    ).toThrow("The power went out.");
    expect(unit(folder, id)).toEqual(before);
    // And once it isn't interrupted, it goes through.
    expect(activateVersion(folder, id, secondHash, 1).ok).toBe(true);
    folder.close();
  });

  it("refuses a first version whose defaults don't fit its own shape, and leaves an older shape to restore", async () => {
    const folder = await openDataFolder(newFolder());
    const { id } = createWorkspace(folder, "Errands");
    const badDefaults = saveVersion(
      folder.db,
      version("<p>Bad</p>", {
        schemaVersion: 1,
        schema: listOf(v1Task),
        defaults: { tasks: [{ id: "t-1" }] },
      }),
    );
    expect(activateVersion(folder, id, badDefaults, 0)).toMatchObject({
      ok: false,
      reason: "invalid-defaults",
    });
    expect(getWorkspace(folder, id)).toMatchObject({
      currentVersion: null,
      data: null,
      dataRevision: 0,
    });

    const secondHash = saveVersion(folder.db, second);
    const firstHash = saveVersion(folder.db, first);
    expect(activateVersion(folder, id, secondHash, 0).ok).toBe(true);
    // Going back to the older shape is a restore, with a loss preview (#50's next part).
    expect(activateVersion(folder, id, firstHash, 1)).toMatchObject({
      ok: false,
      reason: "older-shape",
    });
    folder.close();
  });

  it("refuses starting data over the data limit, in a new workspace, and changes nothing (DATA-06)", async () => {
    const folder = await openDataFolder(newFolder());
    const { id } = createWorkspace(folder, "Big");
    const loose = { type: "object" } as Artifact["data"]["schema"];
    const big = saveVersion(
      folder.db,
      version("<p>Big</p>", {
        schemaVersion: 1,
        schema: loose,
        defaults: { payload: "x".repeat(300 * 1024), tasks: [] },
      }),
    );
    const before = unit(folder, id);
    const result = activateVersion(folder, id, big, 0);
    expect(result).toMatchObject({ ok: false, reason: "invalid-defaults" });
    expect(!result.ok && result.message).toMatch(/over the limit of 256 KB/);
    expect(unit(folder, id)).toEqual(before);
    folder.close();
  });

  it("checks a version's starting data on every activation, not only the first (DATA-03)", async () => {
    const { folder, id } = await withFirstActive();
    // Same shape as the active version, but starting data that doesn't fit it.
    const misfit = saveVersion(
      folder.db,
      version("<p>Misfit</p>", {
        schemaVersion: 1,
        schema: listOf(v1Task),
        defaults: { tasks: "not a list" },
      }),
    );
    const before = unit(folder, id);
    expect(activateVersion(folder, id, misfit, 1)).toMatchObject({
      ok: false,
      reason: "invalid-defaults",
    });
    expect(unit(folder, id)).toEqual(before);
    folder.close();
  });

  it("does nothing when the version is already the current one", async () => {
    const { folder, id, firstHash } = await withFirstActive();
    const before = unit(folder, id);
    expect(activateVersion(folder, id, firstHash, 1)).toMatchObject({ ok: true, steps: 0 });
    expect(unit(folder, id)).toEqual(before);
    folder.close();
  });

  it("DATA-03: re-activating the current version still checks its starting data", async () => {
    const folder = await openDataFolder(newFolder());
    const { id } = createWorkspace(folder, "Errands");
    const misfit = saveVersion(
      folder.db,
      version("<p>Misfit</p>", {
        schemaVersion: 1,
        schema: listOf(v1Task),
        defaults: { tasks: "not a list" },
      }),
    );
    // Made current without activation's checks, as an older Tessera could have.
    addWorkspaceVersion(folder, id, misfit);
    const before = unit(folder, id);
    expect(activateVersion(folder, id, misfit, 0)).toMatchObject({
      ok: false,
      reason: "invalid-defaults",
    });
    expect(unit(folder, id)).toEqual(before);
    folder.close();
  });
});
