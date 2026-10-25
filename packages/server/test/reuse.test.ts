import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Artifact } from "@tessera/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { openDataFolder, type DataFolder } from "../src/storage/index.ts";
import { deleteWorkspace } from "../src/trash/index.ts";
import { saveVersion } from "../src/versions/index.ts";
import {
  activateVersion,
  addWorkspaceVersion,
  continueSavedTool,
  createWorkspace,
  getSavedTool,
  getWorkspace,
  listWorkspaces,
  patchWorkspaceData,
  readWorkspaceData,
  saveTool,
  useAgain,
  workspaceVersions,
} from "../src/workspaces/index.ts";

// Opening a saved tool (DATA-07): Continue goes back to the linked workspace; Use again starts a
// separate one from the tool's current version and its reusable defaults only, and never moves
// the entry's link. Every data folder is a new temporary one (ENG-19).

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const newFolder = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-reuse-"));
  temps.push(dir);
  return dir;
};

const schema = {
  type: "object",
  properties: {
    categories: { type: "array", items: { type: "string" } },
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "name"],
        properties: { id: { type: "string" }, name: { type: "string" } },
        additionalProperties: false,
      },
    },
  },
} as Artifact["data"]["schema"];

const version = (html: string, defaults: Artifact["data"]["defaults"]): Artifact => ({
  contractVersion: 2,
  code: { html, css: "", js: "" },
  data: { schemaVersion: 1, schema, defaults, migrations: [] },
  capabilities: [],
  pins: [],
  ui: { standardVersion: 1, mode: "standard" },
});
const defaults = { categories: ["Fruit", "Dairy"], items: [] };
const first = version("<p>Shopping</p>", defaults);
const improved = version("<p>Shopping, improved</p>", defaults);

/** A saved "Weekly shopping" tool whose workspace holds the person's own entries. */
async function withSavedTool() {
  const folder = await openDataFolder(newFolder());
  const { id } = createWorkspace(folder, "This week's shopping");
  const firstHash = saveVersion(folder.db, first);
  expect(activateVersion(folder, id, firstHash, 0).ok).toBe(true);
  expect(
    patchWorkspaceData(folder, id, {
      operations: [{ op: "add", collection: "items", record: { name: "Oat milk" } }],
    }).ok,
  ).toBe(true);
  const saved = saveTool(folder, id, "Weekly shopping");
  return { folder, id, firstHash, saved };
}

/** Everything the linked workspace holds, to show Use again leaves it alone. */
const unit = (folder: DataFolder, id: string) => ({
  workspace: getWorkspace(folder, id),
  history: workspaceVersions(folder, id).map((v) => v.hash),
  data: readWorkspaceData(folder, id),
});

describe("Continue and Use again (DATA-07)", () => {
  it("DATA-07: Continue opens the saved tool's linked workspace with its current data", async () => {
    const { folder, id, saved } = await withSavedTool();
    const target = continueSavedTool(folder, saved.id);
    expect(target.savedTool).toEqual(saved);
    // The workspace's title shows which one Continue opens.
    expect(target.workspace).toMatchObject({ id, title: "This week's shopping" });
    expect(target.workspace.data).toEqual({
      categories: ["Fruit", "Dairy"],
      items: [{ id: expect.any(String) as string, name: "Oat milk" }],
    });
    folder.close();
  });

  it("DATA-07: Use again starts a new workspace from the defaults only, and Continue still opens the first", async () => {
    const { folder, id, firstHash, saved } = await withSavedTool();
    const before = unit(folder, id);
    const result = useAgain(folder, saved.id);
    if (!result.ok) throw new Error(result.message);
    const fresh = result.workspace;
    expect(fresh.id).not.toBe(id);
    // The same tool, named after the entry, with the defaults and none of the person's entries.
    expect(fresh).toMatchObject({ title: "Weekly shopping", currentVersion: firstHash });
    expect(readWorkspaceData(folder, fresh.id)).toEqual({ data: defaults, revisions: {} });
    // The linked workspace and the entry are untouched.
    expect(unit(folder, id)).toEqual(before);
    expect(getSavedTool(folder, saved.id)).toEqual(saved);
    expect(continueSavedTool(folder, saved.id).workspace.id).toBe(id);
    folder.close();
  });

  it("DATA-07: Use again takes the tool's current version, and the new workspace is its own", async () => {
    const { folder, id, saved } = await withSavedTool();
    // A later improvement in the linked workspace; the entry follows it (A32).
    const improvedHash = saveVersion(folder.db, improved);
    expect(activateVersion(folder, id, improvedHash, 2).ok).toBe(true);
    const result = useAgain(folder, saved.id, { title: "Party shopping" });
    if (!result.ok) throw new Error(result.message);
    expect(result.workspace).toMatchObject({
      title: "Party shopping",
      currentVersion: improvedHash,
    });
    expect(workspaceVersions(folder, result.workspace.id).map((v) => v.hash)).toEqual([
      improvedHash,
    ]);
    // Its changes are its own, and it can become its own library entry.
    expect(
      patchWorkspaceData(folder, result.workspace.id, {
        operations: [{ op: "add", collection: "items", record: { name: "Cake" } }],
      }).ok,
    ).toBe(true);
    expect(readWorkspaceData(folder, id).data).toMatchObject({ items: [{ name: "Oat milk" }] });
    const party = saveTool(folder, result.workspace.id, "Party shopping");
    expect(continueSavedTool(folder, party.id).workspace.id).toBe(result.workspace.id);
    expect(continueSavedTool(folder, saved.id).workspace.id).toBe(id);
    folder.close();
  });

  it("DATA-08: the new workspace is saved as it is made, and is there after a restart", async () => {
    const { folder, saved } = await withSavedTool();
    const result = useAgain(folder, saved.id);
    if (!result.ok) throw new Error(result.message);
    const dir = folder.paths.root;
    folder.close();
    const reopened = await openDataFolder(dir);
    expect(getWorkspace(reopened, result.workspace.id)).toEqual(result.workspace);
    expect(readWorkspaceData(reopened, result.workspace.id).data).toEqual(defaults);
    reopened.close();
  });

  it("DATA-07: refuses Use again when there is no tool, or its version can't start a workspace, creating nothing", async () => {
    const folder = await openDataFolder(newFolder());
    const empty = createWorkspace(folder, "Empty");
    const emptySaved = saveTool(folder, empty.id, "Nothing yet");
    expect(useAgain(folder, emptySaved.id)).toEqual({
      ok: false,
      reason: "no-tool",
      message: "Nothing was changed: the saved tool has no tool in it yet.",
    });

    // A version whose defaults break its own shape, made current without activation's checks.
    const broken = createWorkspace(folder, "Broken");
    const brokenHash = saveVersion(folder.db, version("<p>Broken</p>", { categories: [1] }));
    addWorkspaceVersion(folder, broken.id, brokenHash);
    const brokenSaved = saveTool(folder, broken.id, "Broken tool");
    expect(useAgain(folder, brokenSaved.id)).toMatchObject({
      ok: false,
      reason: "invalid-defaults",
      message: expect.stringContaining("Nothing was changed") as string,
    });
    expect(
      listWorkspaces(folder)
        .map((w) => w.title)
        .sort(),
    ).toEqual(["Broken", "Empty"]);
    folder.close();
  });

  it("DATA-07: a crash while making the new workspace leaves nothing behind", async () => {
    const { folder, id, saved } = await withSavedTool();
    const before = listWorkspaces(folder);
    expect(() =>
      useAgain(folder, saved.id, {
        afterWrites: () => {
          throw new Error("crash");
        },
      }),
    ).toThrow("crash");
    expect(listWorkspaces(folder)).toEqual(before);
    expect(continueSavedTool(folder, saved.id).workspace.id).toBe(id);
    folder.close();
  });

  it("DATA-09: Continue and Use again say plainly when the entry or its workspace is in the trash", async () => {
    const { folder, id, saved } = await withSavedTool();
    expect(() => continueSavedTool(folder, "missing")).toThrow(
      "There is no saved tool with the ID missing.",
    );
    deleteWorkspace(folder, id);
    // The entry goes to the trash with its workspace.
    expect(() => continueSavedTool(folder, saved.id)).toThrow(/in the trash; restore it first/);
    expect(() => useAgain(folder, saved.id)).toThrow(/in the trash; restore it first/);
    folder.close();
  });
});
