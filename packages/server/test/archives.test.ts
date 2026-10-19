import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalJson, type Artifact } from "@tessera/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ARCHIVE_LIMITS,
  ArchiveError,
  exportSavedTool,
  exportWorkspace,
  importArchive,
  readZip,
  writeExport,
  writeZip,
  type ZipEntry,
} from "../src/archives/index.ts";
import { openDataFolder, type Clock, type DataFolder } from "../src/storage/index.ts";
import { deleteSavedTool } from "../src/trash/index.ts";
import { loadVersion, saveVersion } from "../src/versions/index.ts";
import {
  addWorkspaceVersion,
  createWorkspace,
  getWorkspace,
  listSavedTools,
  listWorkspaces,
  saveTool,
  saveWorkspaceData,
  workspaceVersions,
  type Store,
} from "../src/workspaces/index.ts";
import { armTripwires, createCanary } from "./support/tripwires.ts";

// Every data folder is a new temporary one, never the real one (ENG-19).
const temps: string[] = [];
afterAll(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const newFolder = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-archives-"));
  temps.push(dir);
  return dir;
};

const testClock = (start = "2026-10-19T09:00:00.000Z") => {
  let at = new Date(start).getTime();
  const now: Clock = () => new Date(at);
  return { now, advance: (ms: number) => (at += ms) };
};

const artifact = (html: string, contractVersion = 1) =>
  ({
    contractVersion,
    code: { html, css: "", js: "" },
    data: { schemaVersion: 1, schema: { type: "object" }, defaults: { items: [] } },
    capabilities: [],
    pins: [],
    ui: { standardVersion: 1, mode: "standard" },
  }) as Artifact;

/** A workspace with a history of three versions (the last a return to the first), data and two saved tools. */
function makeWorkspace(store: Store, clock: ReturnType<typeof testClock>) {
  const workspace = createWorkspace(store, "Shopping list");
  const v1 = saveVersion(store.db, artifact("<ul></ul>"));
  const v2 = saveVersion(store.db, artifact("<ol></ol>"));
  for (const hash of [v1, v2, v1]) {
    clock.advance(1000);
    addWorkspaceVersion(store, workspace.id, hash);
  }
  saveWorkspaceData(store, workspace.id, { items: [{ id: "a", text: "milk", done: false }] }, 0);
  saveWorkspaceData(store, workspace.id, { items: [{ id: "a", text: "milk", done: true }] }, 1);
  saveTool(store, workspace.id, "Weekly shop");
  saveTool(store, workspace.id, "Party shop");
  return workspace.id;
}

/** Everything stored about a workspace, to compare before and after. */
function snapshot(store: Store, id: string) {
  const versions = workspaceVersions(store, id);
  return {
    workspace: getWorkspace(store, id),
    versions,
    bodies: versions.map((v) => loadVersion(store.db, v.hash)),
    savedTools: listSavedTools(store).filter((t) => t.workspaceId === id),
  };
}

const count = z.object({ n: z.number() });
const total = (store: Store) =>
  ["workspaces", "workspace_versions", "saved_tools", "tool_versions"].map(
    (table) => store.db.get(count, `SELECT COUNT(*) AS n FROM ${table}`)?.n,
  );

async function exported() {
  const clock = testClock();
  const folder = await openDataFolder(newFolder(), { now: clock.now });
  const id = makeWorkspace(folder, clock);
  const bytes = exportWorkspace(folder, id);
  folder.close();
  return bytes;
}

/** The files of a real export, to change one thing and pack again. */
async function exportedFiles() {
  const files = readZip(await exported(), ARCHIVE_LIMITS);
  const manifest = JSON.parse(new TextDecoder().decode(files.get("manifest.json"))) as {
    [key: string]: unknown;
    workspaces: { [key: string]: unknown; title: string; versions: { hash: string }[] }[];
  };
  return { files, manifest };
}

const encode = (value: unknown) =>
  new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));

function pack(manifest: unknown, files: Map<string, Uint8Array>, extra: ZipEntry[] = []) {
  const entries = [...files]
    .filter(([name]) => name !== "manifest.json")
    .map(([name, data]) => ({ name, data }));
  return writeZip(
    [{ name: "manifest.json", data: encode(manifest) }, ...entries, ...extra],
    new Date(),
  );
}

/** Imports into a new data folder, expecting a refusal, and checks that nothing was written. */
async function refused(bytes: Uint8Array, message: string | RegExp) {
  const folder = await openDataFolder(newFolder());
  expect(() => importArchive(folder, bytes)).toThrow(message);
  expect(() => importArchive(folder, bytes)).toThrow(ArchiveError);
  expect(total(folder)).toEqual([0, 0, 0, 0]);
  folder.close();
}

describe("export and import (DATA-05)", () => {
  it("DATA-05: export, wipe and import restores a workspace exactly", async () => {
    const root = newFolder();
    const clock = testClock();
    const first = await openDataFolder(root, { now: clock.now });
    const id = makeWorkspace(first, clock);
    const before = snapshot(first, id);
    const file = writeExport(first, "Shopping list", exportWorkspace(first, id));
    const archive = fs.readFileSync(file);
    first.close();

    // Wipe: the whole data folder goes, and Tessera starts on an empty one.
    fs.rmSync(root, { recursive: true, force: true });
    const wiped = await openDataFolder(root, { now: clock.now });
    expect(listWorkspaces(wiped)).toEqual([]);
    const imported = importArchive(wiped, archive);
    expect(imported).toMatchObject({ exported: "workspace", asCopy: false });
    expect(snapshot(wiped, id)).toEqual(before);
    expect(before.versions).toHaveLength(3);
    expect(before.savedTools).toHaveLength(2);
    wiped.close();
  });

  it("DATA-05: a saved tool exports with the workspace it follows, and imports back", async () => {
    const clock = testClock();
    const from = await openDataFolder(newFolder(), { now: clock.now });
    const id = makeWorkspace(from, clock);
    const tool = listSavedTools(from).find((t) => t.name === "Weekly shop");
    const bytes = exportSavedTool(from, tool?.id ?? "");
    const before = snapshot(from, id);
    from.close();

    const to = await openDataFolder(newFolder());
    const imported = importArchive(to, bytes);
    expect(imported.exported).toBe("savedTool");
    expect(imported.savedTools).toEqual([tool]);
    expect(snapshot(to, id)).toEqual({ ...before, savedTools: [tool] });
    to.close();
  });

  it("DATA-05: what is in the trash isn't exported, and exports never overwrite a file", async () => {
    const clock = testClock();
    const folder = await openDataFolder(newFolder(), { now: clock.now });
    const id = makeWorkspace(folder, clock);
    const party = listSavedTools(folder).find((t) => t.name === "Party shop");
    deleteSavedTool(folder, party?.id ?? "");
    const files = readZip(exportWorkspace(folder, id), ARCHIVE_LIMITS);
    const manifest = JSON.parse(new TextDecoder().decode(files.get("manifest.json"))) as {
      savedTools: { name: string }[];
    };
    expect(manifest.savedTools.map((t) => t.name)).toEqual(["Weekly shop"]);
    expect(() => exportSavedTool(folder, party?.id ?? "")).toThrow(/no saved tool/);

    const bytes = new Uint8Array([1, 2, 3]);
    const first = writeExport(folder, "Shop: a/b\\c", bytes);
    const second = writeExport(folder, "Shop: a/b\\c", bytes);
    expect(path.basename(first)).toBe("Shop- a-b-c 2026-10-19.tessera");
    expect(path.basename(second)).toBe("Shop- a-b-c 2026-10-19 (2).tessera");
    expect(path.dirname(first)).toBe(folder.paths.exports);
    folder.close();
  });
});

describe("import boundary checks (threat model, IMP-01 to IMP-07)", () => {
  it("IMP-01: refuses entry names that escape, and writes nothing outside", async () => {
    const { files, manifest } = await exportedFiles();
    const canary = createCanary();
    try {
      for (const name of [
        "../evil.json",
        "/etc/evil.json",
        "C:/evil.json",
        "\\\\server\\share\\evil.json",
        "versions\\..\\..\\evil.json",
        "versions/../../evil.json",
        "versions//evil.json",
      ]) {
        const bytes = pack(manifest, files, [{ name, data: encode("{}") }]);
        await refused(bytes, /refuses/);
      }
      expect(canary.changes()).toEqual([]);
    } finally {
      canary.remove();
    }
  });

  it("IMP-01: refuses links", async () => {
    const { files, manifest } = await exportedFiles();
    const bytes = Buffer.from(
      pack(manifest, files, [{ name: "link", data: encode("/etc/passwd") }]),
    );
    // Mark the last central entry as made on Unix, with a link's mode.
    const central = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt16LE((3 << 8) | 20, central + 4);
    bytes.writeUInt32LE((0o120777 << 16) >>> 0, central + 38);
    await refused(bytes, /has a link/);
  });

  it("IMP-02: refuses too much before unpacking it", async () => {
    await refused(new Uint8Array(ARCHIVE_LIMITS.archiveBytes + 1), /larger than 64 MB/);
    // A megabyte of zeros packs to about a kilobyte: too tight a ratio to trust.
    const { files, manifest } = await exportedFiles();
    await refused(
      pack(manifest, files, [{ name: "versions/zeros.json", data: new Uint8Array(1024 * 1024) }]),
      /packed too tightly/,
    );
    const three = writeZip(
      ["a", "b", "c"].map((name) => ({ name, data: encode(name) })),
      new Date(),
    );
    const small = { ...ARCHIVE_LIMITS, entryCount: 2 };
    expect(() => readZip(three, small)).toThrow(/more than 2 files/);
    expect(() => readZip(three, { ...ARCHIVE_LIMITS, entryBytes: 0 })).toThrow(/larger than/);
    expect(() => readZip(three, { ...ARCHIVE_LIMITS, totalBytes: 2 })).toThrow(/unpacks to more/);
  });

  it("IMP-02: refuses an entry larger than it declares", () => {
    const bytes = Buffer.from(
      writeZip([{ name: "a", data: encode("x".repeat(1000)) }], new Date()),
    );
    // Say 10 bytes, in both headers; the real entry is 1000.
    const central = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt32LE(10, central + 24);
    bytes.writeUInt32LE(10, 22);
    expect(() => readZip(bytes, ARCHIVE_LIMITS)).toThrow(
      '"a" in this archive is larger than it says.',
    );
  });

  it("IMP-03: refuses anything malformed or newer, importing nothing", async () => {
    const { files, manifest } = await exportedFiles();
    await refused(encode("just some text, not an archive"), "This file isn't a Tessera archive.");
    await refused(writeZip([{ name: "notes.txt", data: encode("hi") }], new Date()), /no manifest/);
    await refused(pack("{ not json", files), /manifest isn't readable/);
    await refused(
      pack({ ...manifest, format: "zip" }, files),
      "This file isn't a Tessera archive.",
    );
    await refused(pack({ ...manifest, formatVersion: 2 }, files), /newer version of Tessera/);
    const untitled = { ...manifest, workspaces: [{ ...manifest.workspaces[0], title: "" }] };
    await refused(pack(untitled, files), /don't fit Tessera's format/);
    await refused(
      pack({ ...manifest, exported: "savedTool" }, files),
      /more or less than one export/,
    );

    // A tool version from a newer contract, named correctly, is still refused (CON-04).
    const newer = canonicalJson(artifact("<p></p>", 99));
    const hash = createHash("sha256").update(newer).digest("hex");
    const workspace = manifest.workspaces[0] ?? { versions: [] };
    const withNewer = {
      ...manifest,
      workspaces: [{ ...workspace, versions: workspace.versions.map((v) => ({ ...v, hash })) }],
    };
    await refused(
      pack(withNewer, new Map([[`versions/${hash}.json`, encode(newer)]])),
      /can't be used/,
    );
  });

  it("IMP-04: refuses a tool version whose content doesn't match its hash", async () => {
    const { files, manifest } = await exportedFiles();
    const [name, body] = [...files].find(([n]) => n.startsWith("versions/")) ?? [];
    const changed = new Map(files);
    changed.set(name ?? "", encode(new TextDecoder().decode(body).replace("<ul>", "<ol>")));
    await refused(pack(manifest, changed), /doesn't match its name/);
    const missing = new Map(files);
    missing.delete(name ?? "");
    await refused(pack(manifest, missing), /missing from this archive/);
  });

  it("IMP-05: refuses executable content outside tool code", async () => {
    const { files, manifest } = await exportedFiles();
    for (const name of ["scripts/run.js", "migrations/0001.js", "versions/run.js", "engine.wasm"]) {
      await refused(pack(manifest, files, [{ name, data: encode("alert(1)") }]), /doesn't import/);
    }
    const withMigration = { ...manifest, migration: { code: "data => data" } };
    await refused(pack(withMigration, files), /don't fit Tessera's format/);
  });

  it("IMP-06: never overwrites or changes existing work; it comes in as a copy", async () => {
    const clock = testClock();
    const folder = await openDataFolder(newFolder(), { now: clock.now });
    const id = makeWorkspace(folder, clock);
    const bytes = exportWorkspace(folder, id);
    // The person keeps working after exporting.
    saveWorkspaceData(folder, id, { items: [] }, 2);
    const before = snapshot(folder, id);

    const copy = importArchive(folder, bytes);
    const again = importArchive(folder, bytes);
    expect(copy.asCopy).toBe(true);
    expect(snapshot(folder, id)).toEqual(before);
    const ids = [id, copy.workspaces[0]?.id, again.workspaces[0]?.id];
    expect(new Set(ids).size).toBe(3);
    const copied = snapshot(folder, copy.workspaces[0]?.id ?? "");
    expect(copied.workspace).toMatchObject({ title: "Shopping list", dataRevision: 2 });
    expect(copied.versions).toEqual(before.versions);
    expect(copied.savedTools.map((t) => t.name).sort()).toEqual(["Party shop", "Weekly shop"]);
    expect(copied.savedTools.every((t) => !before.savedTools.some((b) => b.id === t.id))).toBe(
      true,
    );
    folder.close();
  });

  it("IMP-07: an import opens no network connection, starts no process and touches no file", async () => {
    const bytes = await exported();
    const folder: DataFolder = await openDataFolder(newFolder());
    const canary = createCanary();
    const wires = armTripwires({ allowFolders: [] });
    try {
      importArchive(folder, bytes);
    } finally {
      wires.disarm();
    }
    expect(wires.trips).toEqual([]);
    expect(canary.changes()).toEqual([]);
    canary.remove();
    expect(listWorkspaces(folder)).toHaveLength(1);
    folder.close();
  });
});
