import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Artifact } from "@tessera/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { launch } from "../src/launcher/index.ts";
import { openDataFolder, type Clock } from "../src/storage/index.ts";
import { saveVersion } from "../src/versions/index.ts";
import {
  addWorkspaceVersion,
  createWorkspace,
  getSavedTool,
  getWorkspace,
  listSavedTools,
  listWorkspaces,
  renameSavedTool,
  renameWorkspace,
  saveTool,
  saveWorkspaceData,
  workspaceVersions,
} from "../src/workspaces/index.ts";

// Every data folder is a new temporary one, never the real one (ENG-19).
const temps: string[] = [];
afterAll(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const newFolder = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-workspaces-"));
  temps.push(dir);
  return dir;
};

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

describe("always saved (DATA-08)", () => {
  it("DATA-08: every workspace, version, data and library change survives a restart", async () => {
    const root = newFolder();
    const clock = testClock();
    const first = await openDataFolder(root, { now: clock.now });
    const workspace = createWorkspace(first, "Shopping list");
    const v1 = saveVersion(first.db, artifact("<ul></ul>"));
    addWorkspaceVersion(first, workspace.id, v1);
    clock.advance(1000);
    saveWorkspaceData(first, workspace.id, { items: [{ id: "a", text: "milk" }] }, 0);
    renameWorkspace(first, workspace.id, "Groceries");
    const v2 = saveVersion(first.db, artifact("<ol></ol>"));
    addWorkspaceVersion(first, workspace.id, v2);
    const tool = saveTool(first, workspace.id, "Weekly shop");
    renameSavedTool(first, tool.id, "Weekly groceries");
    const before = {
      workspaces: listWorkspaces(first),
      versions: workspaceVersions(first, workspace.id),
      tools: listSavedTools(first),
    };
    first.close();

    const again = await openDataFolder(root, { now: clock.now });
    expect({
      workspaces: listWorkspaces(again),
      versions: workspaceVersions(again, workspace.id),
      tools: listSavedTools(again),
    }).toEqual(before);
    expect(getWorkspace(again, workspace.id)).toMatchObject({
      title: "Groceries",
      currentVersion: v2,
      data: { items: [{ id: "a", text: "milk" }] },
      dataRevision: 1,
      updatedAt: "2026-10-19T09:00:01.000Z",
    });
    expect(getSavedTool(again, tool.id)).toMatchObject({
      name: "Weekly groceries",
      workspaceId: workspace.id,
    });
    again.close();
  });

  it("DATA-08: a change made through a running Tessera is there after it restarts", async () => {
    const dataDir = newFolder();
    const openBrowser = async () => {};
    const running = await launch({ dataDir, port: 0, openBrowser });
    if (running.status !== "started") throw new Error("Tessera didn't start.");
    const workspace = createWorkspace(running.dataFolder, "Reading list");
    saveWorkspaceData(running.dataFolder, workspace.id, { books: [] }, 0);
    await running.stop();

    const restarted = await launch({ dataDir, port: 0, openBrowser });
    if (restarted.status !== "started") throw new Error("Tessera didn't start.");
    expect(getWorkspace(restarted.dataFolder, workspace.id)).toMatchObject({
      title: "Reading list",
      data: { books: [] },
      dataRevision: 1,
    });
    await restarted.stop();
  });

  it("DATA-08: a new workspace has no tool and no data yet", async () => {
    const folder = await openDataFolder(newFolder());
    const workspace = createWorkspace(folder, "Plans");
    expect(workspace).toMatchObject({ currentVersion: null, data: null, dataRevision: 0 });
    expect(workspaceVersions(folder, workspace.id)).toEqual([]);
    folder.close();
  });

  it("DATA-08: refuses data made from an older revision, and keeps the newer data", async () => {
    const folder = await openDataFolder(newFolder());
    const { id } = createWorkspace(folder, "Plans");
    saveWorkspaceData(folder, id, { step: 1 }, 0);
    expect(() => saveWorkspaceData(folder, id, { step: "stale" }, 0)).toThrow(
      "The data changed since it was read, so nothing was saved.",
    );
    expect(getWorkspace(folder, id)).toMatchObject({ data: { step: 1 }, dataRevision: 1 });
    folder.close();
  });

  // Codex's review of #63: a "__proto__" key was dropped on save, and the save still succeeded.
  it("DATA-08: refuses data it can't keep exactly, saving nothing, and keeps the rest across a restart", async () => {
    const root = newFolder();
    const folder = await openDataFolder(root);
    const { id } = createWorkspace(folder, "Plans");
    const kept: unknown = JSON.parse('{"constructor":{"prototype":1},"toString":"x","a":[{}]}');
    saveWorkspaceData(folder, id, kept, 0);
    for (const text of ['{"__proto__":{"notes":"keep me"},"other":1}', '{"a":[{"__proto__":1}]}']) {
      expect(() => saveWorkspaceData(folder, id, JSON.parse(text), 1)).toThrow(/__proto__/);
    }
    folder.close();

    const again = await openDataFolder(root);
    const after = getWorkspace(again, id);
    expect(after?.dataRevision).toBe(1);
    expect(JSON.stringify(after?.data)).toBe(JSON.stringify(kept));
    again.close();
  });

  it("DATA-04: the version history only grows, and needs a stored version", async () => {
    const folder = await openDataFolder(newFolder());
    const { id } = createWorkspace(folder, "Plans");
    const v1 = saveVersion(folder.db, artifact("<p>1</p>"));
    const v2 = saveVersion(folder.db, artifact("<p>2</p>"));
    addWorkspaceVersion(folder, id, v1);
    addWorkspaceVersion(folder, id, v2);
    // Going back to v1 is a new entry, so v2 stays restorable.
    addWorkspaceVersion(folder, id, v1);
    expect(workspaceVersions(folder, id).map((v) => [v.index, v.hash])).toEqual([
      [1, v1],
      [2, v2],
      [3, v1],
    ]);
    expect(getWorkspace(folder, id)?.currentVersion).toBe(v1);
    expect(() => folder.db.run("UPDATE workspace_versions SET hash = ?", v2)).toThrow(
      /append-only/,
    );
    expect(() => addWorkspaceVersion(folder, id, "0".repeat(64))).toThrow(/FOREIGN KEY/);
    folder.close();
  });

  it("DATA-08: a saved tool needs its workspace, and plain errors name what is missing", async () => {
    const folder = await openDataFolder(newFolder());
    const missing = "00000000-0000-4000-8000-000000000000";
    expect(() => saveTool(folder, missing, "Nothing")).toThrow(
      `There is no workspace with the ID ${missing}.`,
    );
    expect(() => renameWorkspace(folder, missing, "x")).toThrow(/no workspace/);
    expect(() => renameSavedTool(folder, missing, "x")).toThrow(/no saved tool/);
    expect(listSavedTools(folder)).toEqual([]);
    folder.close();
  });
});
