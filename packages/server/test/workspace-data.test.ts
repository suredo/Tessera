import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { openDataFolder, type DataFolder } from "../src/storage/index.ts";
import {
  createWorkspace,
  getWorkspace,
  patchWorkspaceData,
  readWorkspaceData,
  saveWorkspaceData,
} from "../src/workspaces/index.ts";
import { deleteWorkspace, emptyTrash, listTrash } from "../src/trash/index.ts";

// A tool's data with each record's saved revision (DATA-02): a change planned against an older
// revision is refused whole, even after a restart (BRG-04), and a change to other records still
// applies. Every data folder is a new temporary one, never the real one (ENG-19).

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const newFolder = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-workspace-data-"));
  temps.push(dir);
  return dir;
};

const tasks = {
  tasks: [
    { id: "t-1", title: "Buy milk", done: false },
    { id: "t-2", title: "Call the bank", done: false },
  ],
};
const done = (id: string, revisionCount: number) => ({
  operations: [{ op: "replace", collection: "tasks", id, revisionCount, fields: { done: true } }],
});

/** A data folder with one workspace holding `tasks`, and IDs for added records in order. */
async function withTasks(root = newFolder()) {
  const folder = await openDataFolder(root);
  const { id } = createWorkspace(folder, "Errands");
  saveWorkspaceData(folder, id, tasks, 0);
  let next = 0;
  const newId = () => `n-${(next += 1)}`;
  return { folder, id, root, newId };
}

const titles = (folder: DataFolder, id: string) =>
  (readWorkspaceData(folder, id).data["tasks"] as { title: string }[]).map((t) => t.title);

describe("a workspace's data and its records' revisions (DATA-02)", () => {
  it("reads every record at revision 1 at first, and data the tool hasn't filled as empty", async () => {
    const { folder, id } = await withTasks();
    expect(readWorkspaceData(folder, id)).toEqual({
      data: tasks,
      revisions: { tasks: { "t-1": 1, "t-2": 1 } },
    });
    const empty = createWorkspace(folder, "New").id;
    expect(readWorkspaceData(folder, empty)).toEqual({ data: {}, revisions: {} });
    folder.close();
  });

  it("applies a batch whole, and saves the data, its revision and each record's revision", async () => {
    const { folder, id, newId } = await withTasks();
    const before = getWorkspace(folder, id)!.dataRevision;
    const result = patchWorkspaceData(
      folder,
      id,
      {
        operations: [
          { op: "add", collection: "tasks", record: { title: "Post the letter" } },
          {
            op: "replace",
            collection: "tasks",
            id: "t-1",
            revisionCount: 1,
            fields: { done: true },
          },
          { op: "remove", collection: "tasks", id: "t-2", revisionCount: 1 },
        ],
      },
      { newId },
    );
    expect(result).toMatchObject({ ok: true, addedIds: ["n-1"] });
    expect(getWorkspace(folder, id)!.dataRevision).toBe(before + 1);
    expect(readWorkspaceData(folder, id).revisions).toEqual({ tasks: { "t-1": 2, "n-1": 1 } });
    expect(titles(folder, id)).toEqual(["Buy milk", "Post the letter"]);
    folder.close();
  });

  it("BRG-04: refuses a batch planned against an older revision, whole, even after a restart", async () => {
    const { folder, id, root, newId } = await withTasks();
    expect(patchWorkspaceData(folder, id, done("t-1", 1), { newId }).ok).toBe(true);
    folder.close();

    // Tessera starts again: the saved revisions are what the next change is checked against.
    const again = await openDataFolder(root);
    const before = getWorkspace(again, id)!;
    const stale = patchWorkspaceData(
      again,
      id,
      {
        operations: [
          { op: "add", collection: "tasks", record: { title: "Should not appear" } },
          {
            op: "replace",
            collection: "tasks",
            id: "t-1",
            revisionCount: 1,
            fields: { title: "Old plan" },
          },
        ],
      },
      { newId },
    );
    expect(stale).toMatchObject({ ok: false, reason: "stale" });
    expect(!stale.ok && stale.message).toMatch(/^Nothing was changed: .*newer edit is kept/);
    // None of it applied: not the add before the stale change, not the workspace's revision.
    expect(getWorkspace(again, id)).toEqual(before);
    expect(titles(again, id)).toEqual(["Buy milk", "Call the bank"]);

    // A batch planned at the same time, touching another record, still applies.
    expect(patchWorkspaceData(again, id, done("t-2", 1), { newId }).ok).toBe(true);
    expect(readWorkspaceData(again, id).revisions).toEqual({ tasks: { "t-1": 2, "t-2": 2 } });
    again.close();
  });

  it("moves every record to a new revision when the data is replaced whole", async () => {
    const { folder, id, newId } = await withTasks();
    const planned = readWorkspaceData(folder, id).revisions;
    const workspace = getWorkspace(folder, id)!;
    saveWorkspaceData(
      folder,
      id,
      { tasks: [{ id: "t-1", title: "Buy oat milk", done: false }] },
      workspace.dataRevision,
    );
    // The removed record's revision goes with it; the kept one moves on.
    expect(readWorkspaceData(folder, id).revisions).toEqual({ tasks: { "t-1": 2 } });
    const result = patchWorkspaceData(folder, id, done("t-1", planned["tasks"]!["t-1"]!), {
      newId,
    });
    expect(result).toMatchObject({ ok: false, reason: "stale" });
    folder.close();
  });

  it("refuses a change to a workspace in the trash, and removes its revisions with it for good", async () => {
    const { folder, id, newId } = await withTasks();
    patchWorkspaceData(folder, id, done("t-1", 1), { newId });
    deleteWorkspace(folder, id);
    expect(() => patchWorkspaceData(folder, id, done("t-2", 1), { newId })).toThrow(/in the trash/);
    expect(() => readWorkspaceData(folder, id)).toThrow(/in the trash/);
    emptyTrash(folder, listTrash(folder).confirmation);
    const left = folder.db.all(
      z.object({ n: z.number() }),
      "SELECT COUNT(*) AS n FROM record_revisions WHERE workspace_id = ?",
      id,
    );
    expect(left).toEqual([{ n: 0 }]);
    folder.close();
  });
});
