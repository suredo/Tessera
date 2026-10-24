import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Artifact } from "@tessera/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { launch } from "../src/launcher/index.ts";
import { openDataFolder, type Clock } from "../src/storage/index.ts";
import {
  deleteSavedTool,
  deleteWorkspace,
  emptyTrash,
  listTrash,
  removeExpired,
  restoreSavedTool,
  restoreWorkspace,
} from "../src/trash/index.ts";
import { saveVersion } from "../src/versions/index.ts";
import {
  addWorkspaceVersion,
  createWorkspace,
  getWorkspace,
  listSavedTools,
  listWorkspaces,
  renameWorkspace,
  saveTool,
  saveWorkspaceData,
  workspaceVersions,
  type Store,
} from "../src/workspaces/index.ts";

// Every data folder is a new temporary one, never the real one (ENG-19).
const temps: string[] = [];
afterAll(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const newFolder = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-trash-"));
  temps.push(dir);
  return dir;
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** A clock that only moves when the test moves it. */
const testClock = (start = "2026-10-19T09:00:00.000Z") => {
  let at = new Date(start).getTime();
  const now: Clock = () => new Date(at);
  return { now, advance: (ms: number) => (at += ms) };
};

const artifact = (html: string): Artifact => ({
  contractVersion: 2,
  code: { html, css: "", js: "" },
  data: { schemaVersion: 1, schema: { type: "object" }, defaults: { items: [] }, migrations: [] },
  capabilities: [],
  pins: [],
  ui: { standardVersion: 1, mode: "standard" },
});

const count = z.object({ n: z.number() });
const rows = (store: Store, table: string) =>
  store.db.get(count, `SELECT COUNT(*) AS n FROM ${table}`)?.n;

/** A workspace with a tool version, data and a saved tool that opens it. */
function makeWorkspace(store: Store, title: string, html = `<h1>${title}</h1>`) {
  const workspace = createWorkspace(store, title);
  addWorkspaceVersion(store, workspace.id, saveVersion(store.db, artifact(html)));
  saveWorkspaceData(store, workspace.id, { items: [title] }, 0);
  const tool = saveTool(store, workspace.id, `${title} tool`);
  return { id: workspace.id, toolId: tool.id };
}

describe("the trash (DATA-09)", () => {
  it("DATA-09: delete to trash and restore round-trips a workspace with its saved tools", async () => {
    const clock = testClock();
    const folder = await openDataFolder(newFolder(), { now: clock.now });
    const { id } = makeWorkspace(folder, "Shopping list");
    const before = {
      workspace: getWorkspace(folder, id),
      versions: workspaceVersions(folder, id),
      tools: listSavedTools(folder),
    };

    clock.advance(DAY_MS);
    const entry = deleteWorkspace(folder, id);
    expect(entry).toEqual({
      kind: "workspace",
      id,
      name: "Shopping list",
      deletedAt: "2026-10-20T09:00:00.000Z",
      removedAt: "2026-11-19T09:00:00.000Z",
      savedTools: ["Shopping list tool"],
    });
    expect(listWorkspaces(folder)).toEqual([]);
    expect(listSavedTools(folder)).toEqual([]);
    expect(listTrash(folder).entries).toEqual([entry]);

    restoreWorkspace(folder, id);
    expect({
      workspace: getWorkspace(folder, id),
      versions: workspaceVersions(folder, id),
      tools: listSavedTools(folder),
    }).toEqual(before);
    expect(listTrash(folder).entries).toEqual([]);
    folder.close();
  });

  it("DATA-09: what is in the trash can't be changed until it is restored", async () => {
    const folder = await openDataFolder(newFolder());
    const { id, toolId } = makeWorkspace(folder, "Plans");
    deleteWorkspace(folder, id);
    expect(() => renameWorkspace(folder, id, "Other")).toThrow(
      "The workspace is in the trash; restore it first.",
    );
    expect(() => saveWorkspaceData(folder, id, {}, 1)).toThrow(/in the trash/);
    expect(() => saveTool(folder, id, "Copy")).toThrow(/in the trash/);
    expect(() => deleteWorkspace(folder, id)).toThrow(/no workspace .* to delete/);
    expect(() => deleteSavedTool(folder, toolId)).toThrow(/no saved tool .* to delete/);
    expect(() => restoreWorkspace(folder, "00000000-0000-4000-8000-000000000000")).toThrow(
      "The workspace isn't in the trash.",
    );
    folder.close();
  });

  it("DATA-09: a saved tool goes to the trash alone, and brings its workspace back if needed", async () => {
    const clock = testClock();
    const folder = await openDataFolder(newFolder(), { now: clock.now });
    const { id, toolId } = makeWorkspace(folder, "Reading list");
    deleteSavedTool(folder, toolId);
    expect(listWorkspaces(folder).map((w) => w.id)).toEqual([id]);
    expect(listSavedTools(folder)).toEqual([]);

    // The workspace follows it into the trash; restoring the tool brings both back.
    clock.advance(1000);
    deleteWorkspace(folder, id);
    expect(listTrash(folder).entries.map((e) => [e.kind, e.name])).toEqual([
      ["workspace", "Reading list"],
      ["savedTool", "Reading list tool"],
    ]);
    restoreSavedTool(folder, toolId);
    expect(listWorkspaces(folder).map((w) => w.id)).toEqual([id]);
    expect(listSavedTools(folder).map((t) => t.id)).toEqual([toolId]);
    expect(listTrash(folder).entries).toEqual([]);
    folder.close();
  });

  it("DATA-09: expires after 30 days with a test clock, removing what only it used", async () => {
    const clock = testClock();
    const folder = await openDataFolder(newFolder(), { now: clock.now });
    const { id } = makeWorkspace(folder, "Old list");
    deleteWorkspace(folder, id);

    clock.advance(30 * DAY_MS - 1);
    expect(removeExpired(folder)).toEqual([]);
    expect(listTrash(folder).entries.map((e) => e.id)).toEqual([id]);

    clock.advance(1);
    expect(listTrash(folder).entries).toEqual([]);
    expect(() => restoreWorkspace(folder, id)).toThrow(
      '"Old list" was in the trash for more than 30 days and is removed for good.',
    );
    expect(removeExpired(folder).map((e) => e.id)).toEqual([id]);
    for (const table of ["workspaces", "workspace_versions", "saved_tools", "tool_versions"]) {
      expect(rows(folder, table), table).toBe(0);
    }
    folder.close();
  });

  it("DATA-09: emptying early names what it removes and needs a confirmation of exactly that", async () => {
    const folder = await openDataFolder(newFolder());
    const kept = makeWorkspace(folder, "Kept", "<p>shared</p>");
    const gone = makeWorkspace(folder, "Gone", "<p>shared</p>");
    const alone = makeWorkspace(folder, "Alone");
    deleteWorkspace(folder, gone.id);
    deleteSavedTool(folder, alone.toolId);

    const seen = listTrash(folder);
    expect(seen.entries.map((e) => e.name).sort()).toEqual(["Alone tool", "Gone"]);
    // Something deleted after the person looked makes their confirmation stale.
    deleteWorkspace(folder, alone.id);
    expect(() => emptyTrash(folder, seen.confirmation)).toThrow(
      "The trash changed since you looked at it, so nothing was removed.",
    );
    expect(listTrash(folder).entries).toHaveLength(3);

    const now = listTrash(folder);
    expect(emptyTrash(folder, now.confirmation)).toEqual(now.entries);
    expect(listTrash(folder).entries).toEqual([]);
    expect(listWorkspaces(folder).map((w) => w.id)).toEqual([kept.id]);
    // The version "Kept" still uses stays; the one only "Alone" used is gone.
    expect(rows(folder, "tool_versions")).toBe(1);
    expect(getWorkspace(folder, kept.id)?.currentVersion).toMatch(/^[0-9a-f]{64}$/);
    folder.close();
  });
});

describe("P3: trash expiry, scripted (DATA-09)", () => {
  it("P3: a tool deleted 31 days before a restart is gone; one deleted 29 days before is restorable", async () => {
    const dataDir = newFolder();
    const clock = testClock();
    const openBrowser = async () => {};
    const start = async () => {
      const launched = await launch({ dataDir, port: 0, openBrowser, now: clock.now });
      if (launched.status !== "started") throw new Error("Tessera didn't start.");
      return launched;
    };

    const first = await start();
    const old = makeWorkspace(first.dataFolder, "Shopping list");
    const recent = makeWorkspace(first.dataFolder, "Reading list");
    deleteWorkspace(first.dataFolder, old.id);
    clock.advance(2 * DAY_MS);
    deleteWorkspace(first.dataFolder, recent.id);
    await first.stop();

    clock.advance(29 * DAY_MS);
    const restarted = await start();
    const store = restarted.dataFolder;
    // The restart removed the old one for good: no row is left anywhere.
    expect(listTrash(store).entries.map((e) => e.name)).toEqual(["Reading list"]);
    expect(
      store.db.get(count, "SELECT COUNT(*) AS n FROM workspaces WHERE id = ?", old.id),
    ).toEqual({
      n: 0,
    });
    expect(
      store.db.get(count, "SELECT COUNT(*) AS n FROM saved_tools WHERE id = ?", old.toolId),
    ).toEqual({
      n: 0,
    });
    restoreWorkspace(store, recent.id);
    expect(getWorkspace(store, recent.id)).toMatchObject({
      title: "Reading list",
      data: { items: ["Reading list"] },
    });
    expect(listSavedTools(store).map((t) => t.name)).toEqual(["Reading list tool"]);
    await restarted.stop();
  });
});
