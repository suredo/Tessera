import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  chooseDataFolder,
  dataFolderPaths,
  openDatabase,
  openDataFolder,
  schemaMigrations,
  schemaVersion,
  syncedFolderOf,
} from "../src/storage/index.ts";
import { RequestLedger } from "../src/ledger/index.ts";
import { listTrash, restoreSavedTool } from "../src/trash/index.ts";
import { loadVersion } from "../src/versions/index.ts";
import { getWorkspace, listSavedTools } from "../src/workspaces/index.ts";

// Every data folder is a new temporary one, never the real one (ENG-19).
const temps: string[] = [];
afterAll(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const newFolder = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-data-folder-"));
  temps.push(dir);
  return dir;
};
const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "databases");
const count = z.object({ n: z.number() });
const FIXTURE_VERSION = "658971542b342509b035cd99f0dd5d483273a2b1c432967afd963641794e869e";

/** A data folder whose database is the fixture an earlier Tessera left (ENG-18). */
function folderFromFixture(name: string): string {
  const root = newFolder();
  const db = openDatabase(dataFolderPaths(root).database);
  db.exec(fs.readFileSync(path.join(fixtures, name), "utf8"));
  db.close();
  return root;
}

const backups = (root: string) => fs.readdirSync(dataFolderPaths(root).backups);

describe("the data folder (PLAT-04, ENG-19)", () => {
  it("PLAT-04: uses the folder the variable names, or else a per-computer folder", () => {
    const home = "/home/sam";
    expect(chooseDataFolder({ TESSERA_DATA_DIR: "/tmp/dev-data" }, "linux", home)).toBe(
      "/tmp/dev-data",
    );
    expect(chooseDataFolder({}, "linux", home)).toBe("/home/sam/.local/share/tessera");
    expect(chooseDataFolder({ XDG_DATA_HOME: "/data" }, "linux", home)).toBe("/data/tessera");
    expect(chooseDataFolder({}, "darwin", "/Users/sam")).toBe(
      "/Users/sam/Library/Application Support/Tessera",
    );
    const local = "C:\\Users\\sam\\AppData\\Local";
    expect(chooseDataFolder({ LOCALAPPDATA: local }, "win32", "C:\\Users\\sam")).toBe(
      `${local}\\Tessera`,
    );
  });

  it("PLAT-04: the default is never inside a synced folder, and a synced one is named", () => {
    const home = "C:\\Users\\sam";
    const env = { OneDrive: "C:\\Users\\sam\\OneDrive", LOCALAPPDATA: `${home}\\AppData\\Local` };
    expect(
      syncedFolderOf(chooseDataFolder(env, "win32", home), env, "win32", home),
    ).toBeUndefined();
    expect(syncedFolderOf("c:\\users\\sam\\onedrive\\Tessera", env, "win32", home)).toBe(
      "OneDrive",
    );
    expect(syncedFolderOf(`${home}\\Dropbox\\data`, {}, "win32", home)).toBe("Dropbox");
    expect(syncedFolderOf("/Users/sam/Library/CloudStorage/x", {}, "darwin", "/Users/sam")).toBe(
      "a cloud service",
    );
  });

  it("PLAT-04: holds the database, assets, exports, logs and backups in one folder", async () => {
    const root = newFolder();
    const folder = await openDataFolder(root);
    for (const place of ["assets", "exports", "logs", "backups"] as const) {
      expect(fs.statSync(folder.paths[place]).isDirectory()).toBe(true);
    }
    expect(fs.existsSync(path.join(root, "tessera.db"))).toBe(true);
    expect(schemaVersion(folder.db)).toBe(schemaMigrations().length);
    // A new database has nothing to back up.
    expect(folder.backup).toBeUndefined();
    folder.close();
  });
});

describe("migrating real data (ENG-18)", () => {
  it("ENG-18: migrates a schema 1 database, keeping its data, after backing it up in the folder", async () => {
    const root = folderFromFixture("schema-1.sql");
    const folder = await openDataFolder(root);
    expect(folder.migrated).toEqual(
      schemaMigrations()
        .map((m) => m.version)
        .filter((v) => v > 1),
    );
    expect(loadVersion(folder.db, FIXTURE_VERSION)?.kind).toBe("ok");
    expect(folder.backup).toBeDefined();
    expect(path.dirname(folder.backup ?? "")).toBe(folder.paths.backups);
    folder.close();

    // The backup is the database as it was before migrating.
    const backup = openDatabase(path.join(folder.paths.backups, backups(root)[0] ?? ""));
    expect(schemaVersion(backup)).toBe(1);
    expect(backup.get(count, "SELECT COUNT(*) AS n FROM tool_versions")).toEqual({ n: 1 });
    backup.close();
  });

  it("ENG-18: migrates a schema 2 database to the trash's schema, keeping its workspaces", async () => {
    const root = folderFromFixture("schema-2.sql");
    const folder = await openDataFolder(root);
    expect(folder.migrated[0]).toBe(3);
    expect(backups(root)).toHaveLength(1);
    expect(getWorkspace(folder, "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b")).toMatchObject({
      title: "Shopping list",
      currentVersion: FIXTURE_VERSION,
      data: { items: [{ id: "a", text: "milk" }] },
      dataRevision: 1,
    });
    expect(listSavedTools(folder).map((tool) => tool.name)).toEqual(["Weekly shop"]);
    expect(listTrash(folder).entries).toEqual([]);
    folder.close();
  });

  it("ENG-18, APP-04: migrates a schema 8 database to descriptions, keeping every row, with none described", async () => {
    const root = folderFromFixture("schema-8.sql");
    const folder = await openDataFolder(root);
    expect(folder.migrated[0]).toBe(9);
    expect(backups(root)).toHaveLength(1);
    expect(getWorkspace(folder, "0b6c2d1e-3f4a-4b5c-8d6e-7f8091a2b3c4")).toMatchObject({
      title: "Garden plan",
      description: "",
      currentVersion: FIXTURE_VERSION,
      data: { items: [{ id: "a", text: "tomatoes" }] },
      dataRevision: 1,
      updatedAt: "2026-11-04T08:05:00.000Z",
    });
    expect(listSavedTools(folder)).toEqual([
      {
        id: "1c7d3e2f-4a5b-4c6d-9e7f-8091a2b3c4d5",
        name: "Garden",
        description: "",
        workspaceId: "0b6c2d1e-3f4a-4b5c-8d6e-7f8091a2b3c4",
        createdAt: "2026-11-04T08:10:00.000Z",
        updatedAt: "2026-11-04T08:10:00.000Z",
      },
    ]);
    // The saved tool in the trash stays there, and comes back described as none.
    expect(listTrash(folder).entries.map((entry) => entry.name)).toEqual(["Old garden"]);
    expect(restoreSavedTool(folder, "2d8e4f3a-5b6c-4d7e-8f80-91a2b3c4d5e6").description).toBe("");
    folder.close();
  });

  it("ENG-18 GEN-10: a schema-12 database migrates with its ledger kept, and its calls have no code", async () => {
    const root = folderFromFixture("schema-12.sql");
    const folder = await openDataFolder(root);
    expect(folder.migrated[0]).toBe(13);
    expect(backups(root)).toHaveLength(1);
    const requests = new RequestLedger(folder).unattached();
    expect(requests.map((request) => request.id)).toEqual(["3e9f5a4b-6c7d-4e8f-9091-a2b3c4d5e6f7"]);
    expect(requests[0]?.calls.map((call) => [call.stage, call.outcome, call.code])).toEqual([
      ["intent", "ok", null],
      ["create", "ok", null],
    ]);
    folder.close();
  });

  it("ENG-18: keeps the backup until the next successful start", async () => {
    const root = folderFromFixture("schema-1.sql");
    const migrating = await openDataFolder(root);
    migrating.started();
    expect(backups(root)).toHaveLength(1);
    migrating.close();

    const next = await openDataFolder(root);
    expect(next.backup).toBeUndefined();
    expect(backups(root)).toHaveLength(1);
    next.started();
    expect(backups(root)).toEqual([]);
    next.close();
  });

  it("ENG-18: when a migration fails, the backup stays and the start fails", async () => {
    const root = folderFromFixture("schema-1.sql");
    const broken = [
      ...schemaMigrations(),
      { version: schemaMigrations().length + 1, name: "broken.sql", sql: "CREATE TABLE (" },
    ];
    await expect(openDataFolder(root, { migrations: broken })).rejects.toThrow();
    expect(backups(root)).toHaveLength(1);

    // The next start with migrations that work succeeds, and only then lets the backup go.
    const fixed = await openDataFolder(root);
    expect(loadVersion(fixed.db, FIXTURE_VERSION)?.kind).toBe("ok");
    fixed.started();
    expect(backups(root)).toEqual([]);
    fixed.close();
  });

  it("ENG-18: refuses data from a newer Tessera without touching it", async () => {
    const root = newFolder();
    (await openDataFolder(root)).close();
    await expect(
      openDataFolder(root, { migrations: schemaMigrations().slice(0, 1) }),
    ).rejects.toThrow(/newer version of Tessera/);
    expect(backups(root)).toEqual([]);
  });

  it("ENG-18: leaves files it didn't make in the backups folder alone", async () => {
    const root = newFolder();
    const mine = path.join(dataFolderPaths(root).backups, "my-copy.db");
    fs.mkdirSync(path.dirname(mine), { recursive: true });
    fs.writeFileSync(mine, "");
    const folder = await openDataFolder(root);
    folder.started();
    expect(backups(root)).toEqual(["my-copy.db"]);
    folder.close();
  });
});
