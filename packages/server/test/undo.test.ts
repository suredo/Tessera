import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Artifact } from "@tessera/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { openDataFolder, type DataFolder } from "../src/storage/index.ts";
import { deleteWorkspace, emptyTrash, listTrash } from "../src/trash/index.ts";
import { saveVersion } from "../src/versions/index.ts";
import {
  activateVersion,
  addWorkspaceVersion,
  createWorkspace,
  listUndo,
  patchWorkspaceData,
  readWorkspaceData,
  saveWorkspaceData,
  undoDataChange,
  UNDO_LIMIT,
} from "../src/workspaces/index.ts";

// Data undo (DATA-04): every data change keeps an entry, and undoing one reverses only that
// change, with a revision check that refuses rather than overwrites newer work. Every data folder
// is a new temporary one (ENG-19).

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const newFolder = async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-undo-"));
  temps.push(dir);
  return openDataFolder(dir);
};

const tasks = {
  tasks: [
    { id: "t-1", title: "Buy milk" },
    { id: "t-2", title: "Call the bank" },
    { id: "t-3", title: "Post the letter" },
  ],
};

/** A workspace holding three tasks, saved whole: its first undo entry. */
async function withTasks() {
  const folder = await newFolder();
  const { id } = createWorkspace(folder, "Errands");
  saveWorkspaceData(folder, id, tasks, 0);
  return { folder, id };
}

const replace = (id: string, revisionCount: number, title: string) => ({
  op: "replace" as const,
  collection: "tasks",
  id,
  revisionCount,
  fields: { title },
});
const patch = (folder: DataFolder, id: string, operations: unknown[]) => {
  const result = patchWorkspaceData(folder, id, { operations });
  if (!result.ok) throw new Error(result.message);
  return result;
};
const latest = (folder: DataFolder, id: string) => listUndo(folder, id)[0]!.number;

describe("data undo (DATA-04)", () => {
  it("DATA-04: undoes a patch, putting back what it replaced, removed and added", async () => {
    const { folder, id } = await withTasks();
    const { addedIds } = patch(folder, id, [
      replace("t-1", 1, "Buy oat milk"),
      { op: "remove", collection: "tasks", id: "t-2", revisionCount: 1 },
      { op: "add", collection: "tasks", record: { title: "Water the plants" } },
    ]);
    expect(listUndo(folder, id)).toMatchObject([
      { kind: "records", recordCount: 3 },
      { kind: "whole", recordCount: 0 },
    ]);
    expect(undoDataChange(folder, id, latest(folder, id))).toMatchObject({ ok: true });
    const { data, revisions } = readWorkspaceData(folder, id);
    // Back as it was, the removed task in its place, and the added one gone.
    expect(data).toEqual(tasks);
    expect(revisions["tasks"]?.[addedIds[0]!]).toBeUndefined();
    // What came back moved on, so a change planned before the undo is refused (DATA-02): the
    // replaced task from 2 to 3, the removed one from its last count, 1, to 2. The untouched one
    // stays at 1, so a change planned against it still applies.
    expect(revisions["tasks"]).toMatchObject({ "t-1": 3, "t-2": 2, "t-3": 1 });
    // The entry is used up.
    expect(listUndo(folder, id)).toHaveLength(1);
    folder.close();
  });

  it("DATA-04: refuses to undo a change whose record was changed since, and keeps the newer work", async () => {
    const { folder, id } = await withTasks();
    patch(folder, id, [replace("t-1", 1, "Buy oat milk")]);
    const undoable = latest(folder, id);
    // The person edits the same task again.
    patch(folder, id, [replace("t-1", 2, "Buy soy milk")]);
    const before = readWorkspaceData(folder, id);
    expect(undoDataChange(folder, id, undoable)).toEqual({
      ok: false,
      reason: "stale",
      message:
        "Nothing was changed: a record this change touched was changed since, and that newer work is kept.",
    });
    expect(readWorkspaceData(folder, id)).toEqual(before);
    folder.close();
  });

  it("DATA-04: undoes an older change when what it touched hasn't changed since", async () => {
    const { folder, id } = await withTasks();
    patch(folder, id, [replace("t-1", 1, "Buy oat milk")]);
    const older = latest(folder, id);
    patch(folder, id, [replace("t-3", 1, "Post the parcel")]);
    expect(undoDataChange(folder, id, older).ok).toBe(true);
    expect(readWorkspaceData(folder, id).data).toEqual({
      tasks: [tasks.tasks[0], tasks.tasks[1], { id: "t-3", title: "Post the parcel" }],
    });
    folder.close();
  });

  it("DATA-04: undoes data replaced whole only while nothing has changed since", async () => {
    const { folder, id } = await withTasks();
    saveWorkspaceData(folder, id, { tasks: [] }, 1);
    expect(undoDataChange(folder, id, latest(folder, id)).ok).toBe(true);
    expect(readWorkspaceData(folder, id).data).toEqual(tasks);

    // The undo itself was a change: the data is at revision 3 now.
    saveWorkspaceData(folder, id, { tasks: [] }, 3);
    const whole = latest(folder, id);
    patch(folder, id, [{ op: "add", collection: "tasks", record: { title: "New" } }]);
    expect(undoDataChange(folder, id, whole)).toMatchObject({ ok: false, reason: "stale" });
    folder.close();
  });

  it("DATA-04: keeps the newest 100 changes, and an unknown one is refused plainly", async () => {
    const { folder, id } = await withTasks();
    for (let revision = 1; revision <= UNDO_LIMIT + 5; revision += 1) {
      saveWorkspaceData(folder, id, { tasks: [] }, revision);
    }
    const entries = listUndo(folder, id);
    expect(entries).toHaveLength(UNDO_LIMIT);
    expect(entries[0]!.number - entries.at(-1)!.number).toBe(UNDO_LIMIT - 1);
    expect(undoDataChange(folder, id, 1)).toEqual({
      ok: false,
      reason: "no-entry",
      message: "Nothing was changed: there is no such change to undo.",
    });
    folder.close();
  });

  it("DATA-04: refuses an undo whose data no longer fits the tool's shape", async () => {
    const folder = await newFolder();
    const { id } = createWorkspace(folder, "Errands");
    const version = (required: string[]): Artifact => ({
      contractVersion: 2,
      code: { html: "", css: "", js: "" },
      data: {
        schemaVersion: 1,
        schema: {
          type: "object",
          properties: {
            tasks: {
              type: "array",
              items: { type: "object", required: ["id", ...required] },
            },
          },
        },
        defaults: { tasks: [] },
        migrations: [],
      },
      capabilities: [],
      pins: [],
      ui: { standardVersion: 1, mode: "standard" },
    });
    expect(activateVersion(folder, id, saveVersion(folder.db, version([])), 0).ok).toBe(true);
    const { addedIds } = patch(folder, id, [
      { op: "add", collection: "tasks", record: { title: "Untagged" } },
    ]);
    patch(folder, id, [{ op: "remove", collection: "tasks", id: addedIds[0]!, revisionCount: 1 }]);
    const removal = latest(folder, id);
    // A tool that requires a tag becomes current: the removed task, untagged, no longer fits it.
    addWorkspaceVersion(folder, id, saveVersion(folder.db, version(["tag"])));
    const before = readWorkspaceData(folder, id);
    expect(undoDataChange(folder, id, removal)).toMatchObject({ ok: false, reason: "invalid" });
    expect(readWorkspaceData(folder, id)).toEqual(before);
    folder.close();
  });

  it("DATA-04: an undone change's number is never given to a later one", async () => {
    const { folder, id } = await withTasks();
    patch(folder, id, [replace("t-1", 1, "First edit")]);
    const first = latest(folder, id);
    expect(undoDataChange(folder, id, first).ok).toBe(true);
    patch(folder, id, [replace("t-1", 3, "Later edit")]);
    expect(latest(folder, id)).not.toBe(first);
    // Asking again for the change already undone undoes nothing else.
    expect(undoDataChange(folder, id, first)).toMatchObject({ ok: false, reason: "no-entry" });
    expect(readWorkspaceData(folder, id).data["tasks"]).toContainEqual({
      id: "t-1",
      title: "Later edit",
    });
    folder.close();
  });

  it("DATA-04: refuses to bring back a removed record that came back and changed since", async () => {
    const { folder, id } = await withTasks();
    patch(folder, id, [{ op: "remove", collection: "tasks", id: "t-1", revisionCount: 1 }]);
    const removal = latest(folder, id);
    // The same ID comes back with newer work, then goes again.
    const back = { tasks: [{ id: "t-1", title: "Newer work" }, ...tasks.tasks.slice(1)] };
    saveWorkspaceData(folder, id, back, 2);
    const revision = readWorkspaceData(folder, id).revisions["tasks"]!["t-1"]!;
    patch(folder, id, [{ op: "remove", collection: "tasks", id: "t-1", revisionCount: revision }]);
    const before = readWorkspaceData(folder, id);
    expect(undoDataChange(folder, id, removal)).toMatchObject({ ok: false, reason: "stale" });
    expect(readWorkspaceData(folder, id)).toEqual(before);
    folder.close();
  });

  it("DATA-08: undo history survives a restart, and goes with its workspace", async () => {
    const { folder, id } = await withTasks();
    patch(folder, id, [replace("t-1", 1, "Buy oat milk")]);
    const dir = folder.paths.root;
    folder.close();
    const again = await openDataFolder(dir);
    expect(listUndo(again, id)).toHaveLength(2);
    deleteWorkspace(again, id);
    emptyTrash(again, listTrash(again).confirmation);
    const left = again.db.get(z.object({ n: z.number() }), "SELECT COUNT(*) AS n FROM data_undo");
    expect(left?.n).toBe(0);
    again.close();
  });
});
