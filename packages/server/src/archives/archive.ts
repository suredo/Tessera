import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  ARCHIVE_FORMAT,
  ARCHIVE_FORMAT_VERSION,
  archiveManifestSchema,
  canonicalJson,
  readArtifact,
  type ArchivedWorkspace,
  type ArchiveManifest,
  type SavedTool,
  type Workspace,
} from "@tessera/contracts";
import { z } from "zod";
import type { DataFolder } from "../storage/index.ts";
import {
  getSavedTool,
  getWorkspace,
  listSavedTools,
  workspaceVersions,
  type Store,
} from "../workspaces/index.ts";
import { ArchiveError, readZip, writeZip, type ZipLimits } from "./zip.ts";

// Export and import (DATA-05): a workspace or saved tool, with its version history, data and
// saved tools, goes into one archive file and comes back exactly. Importing is a trust boundary
// (threat model, IMP-01 to IMP-07): the archive is checked whole, in memory, before anything is
// written, nothing is ever written outside the database, and existing work is never changed.

/** The most an archive may hold (DATA-06); assets (DATA-11) will revisit them. */
export const ARCHIVE_LIMITS: ZipLimits = {
  archiveBytes: 64 * 1024 * 1024,
  entryCount: 10_000,
  entryBytes: 8 * 1024 * 1024,
  totalBytes: 256 * 1024 * 1024,
  compressionRatio: 100,
};

export const ARCHIVE_EXTENSION = ".tessera";
const MANIFEST = "manifest.json";
const VERSION_FILE = /^versions\/([0-9a-f]{64})\.json$/;

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const bodyRow = z.object({ body: z.string() });

function archive(
  store: Store,
  exported: ArchiveManifest["exported"],
  workspaces: readonly Workspace[],
  savedTools: readonly SavedTool[],
): Uint8Array {
  const bodies = new Map<string, string>();
  const archived: ArchivedWorkspace[] = workspaces.map((workspace) => {
    const versions = workspaceVersions(store, workspace.id);
    for (const { hash } of versions) {
      const found = store.db.get(bodyRow, "SELECT body FROM tool_versions WHERE hash = ?", hash);
      // A version changed outside Tessera is never passed on (CON-04).
      if (!found || sha256(found.body) !== hash) {
        throw new ArchiveError(
          `A version of "${workspace.title}" is damaged, so it can't be exported.`,
        );
      }
      bodies.set(hash, found.body);
    }
    const { id, title, data, dataRevision, createdAt, updatedAt } = workspace;
    return { id, title, data, dataRevision, createdAt, updatedAt, versions };
  });
  const exportedAt = store.now();
  const manifest = archiveManifestSchema.parse({
    format: ARCHIVE_FORMAT,
    formatVersion: ARCHIVE_FORMAT_VERSION,
    exported,
    exportedAt: exportedAt.toISOString(),
    workspaces: archived,
    savedTools,
  });
  const text = (value: string) => new TextEncoder().encode(value);
  const bytes = writeZip(
    [
      { name: MANIFEST, data: text(`${JSON.stringify(manifest, null, 2)}\n`) },
      ...[...bodies].map(([hash, body]) => ({ name: `versions/${hash}.json`, data: text(body) })),
    ],
    exportedAt,
    { maxCompressionRatio: ARCHIVE_LIMITS.compressionRatio },
  );
  // An export must import: the reader's limits are the one definition of what an archive may be.
  try {
    readZip(bytes, ARCHIVE_LIMITS);
  } catch (error) {
    if (!(error instanceof ArchiveError)) throw error;
    const title = workspaces[0]?.title ?? "This workspace";
    throw new ArchiveError(`"${title}" is too large to export as one archive. ${error.message}`);
  }
  return bytes;
}

/** A workspace, with its version history, data and the saved tools that open it, as an archive. */
export function exportWorkspace(store: Store, id: string): Uint8Array {
  const workspace = getWorkspace(store, id);
  if (!workspace) throw new ArchiveError(`There is no workspace with the ID ${id} to export.`);
  const savedTools = listSavedTools(store).filter((tool) => tool.workspaceId === id);
  return archive(store, "workspace", [workspace], savedTools);
}

/** A saved tool with the workspace it follows, as an archive. */
export function exportSavedTool(store: Store, id: string): Uint8Array {
  const tool = getSavedTool(store, id);
  const workspace = tool && getWorkspace(store, tool.workspaceId);
  if (!tool || !workspace) {
    throw new ArchiveError(`There is no saved tool with the ID ${id} to export.`);
  }
  return archive(store, "savedTool", [workspace], [tool]);
}

/**
 * Writes an archive into the data folder's exports, named after what it holds and the day, never
 * over an existing file, and returns its path.
 */
export function writeExport(
  folder: Pick<DataFolder, "paths" | "now">,
  name: string,
  bytes: Uint8Array,
): string {
  const safe =
    name
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N} _-]+/gu, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60) || "export";
  const day = folder.now().toISOString().slice(0, 10);
  for (let n = 1; ; n++) {
    const file = path.join(
      folder.paths.exports,
      `${safe} ${day}${n === 1 ? "" : ` (${n})`}${ARCHIVE_EXTENSION}`,
    );
    try {
      fs.writeFileSync(file, bytes, { flag: "wx" });
      return file;
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
    }
  }
}

export type Imported = {
  exported: ArchiveManifest["exported"];
  workspaces: Workspace[];
  savedTools: SavedTool[];
  /** True when something with the same IDs was already here, so it came in as a copy. */
  asCopy: boolean;
};

const decode = (data: Uint8Array): string => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    throw new ArchiveError("This archive is damaged, so nothing was imported.");
  }
};

const looseManifest = z.object({ format: z.unknown(), formatVersion: z.unknown() });

// The manifest, checked against its contract and for a format this build reads (IMP-03).
function readManifest(files: Map<string, Uint8Array>): ArchiveManifest {
  const data = files.get(MANIFEST);
  if (!data) throw new ArchiveError("This archive has no manifest, so it isn't a Tessera archive.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(decode(data));
  } catch (error) {
    if (error instanceof ArchiveError) throw error;
    throw new ArchiveError("This archive's manifest isn't readable, so nothing was imported.");
  }
  const loose = looseManifest.safeParse(parsed);
  if (!loose.success || loose.data.format !== ARCHIVE_FORMAT) {
    throw new ArchiveError("This file isn't a Tessera archive.");
  }
  if (
    typeof loose.data.formatVersion === "number" &&
    loose.data.formatVersion > ARCHIVE_FORMAT_VERSION
  ) {
    throw new ArchiveError(
      "This archive was made by a newer version of Tessera. Update Tessera to import it.",
    );
  }
  const manifest = archiveManifestSchema.safeParse(parsed);
  if (!manifest.success) {
    throw new ArchiveError(
      "This archive's contents don't fit Tessera's format, so nothing was imported.",
    );
  }
  return manifest.data;
}

// What the manifest says must hang together, and match the files beside it (IMP-03, IMP-05).
function checkConsistent(manifest: ArchiveManifest, files: Map<string, Uint8Array>): Set<string> {
  const refuse = (why: string) => new ArchiveError(`${why}, so nothing was imported.`);
  const expected = manifest.exported === "workspace" ? [1, null] : [1, 1];
  if (
    manifest.workspaces.length !== expected[0] ||
    (expected[1] !== null && manifest.savedTools.length !== expected[1])
  ) {
    throw refuse("This archive holds more or less than one export");
  }
  const workspaceIds = new Set(manifest.workspaces.map((w) => w.id));
  const toolIds = new Set(manifest.savedTools.map((t) => t.id));
  if (toolIds.size !== manifest.savedTools.length)
    throw refuse("This archive repeats a saved tool");
  for (const tool of manifest.savedTools) {
    if (!workspaceIds.has(tool.workspaceId)) {
      throw refuse(`The saved tool "${tool.name}" in this archive has no workspace`);
    }
  }
  const hashes = new Set<string>();
  for (const workspace of manifest.workspaces) {
    workspace.versions.forEach((version, i) => {
      if (version.index !== i + 1)
        throw refuse(`The history of "${workspace.title}" is out of order`);
      hashes.add(version.hash);
    });
  }
  for (const name of files.keys()) {
    if (name === MANIFEST) continue;
    const hash = VERSION_FILE.exec(name)?.[1];
    // Only the manifest and tool versions: no scripts, migrations or other files (IMP-05).
    if (hash === undefined)
      throw refuse(`This archive has a file Tessera doesn't import, "${name}"`);
    if (!hashes.has(hash)) throw refuse("This archive has a tool version nothing uses");
  }
  for (const hash of hashes) {
    if (!files.has(`versions/${hash}.json`))
      throw refuse("A tool version is missing from this archive");
  }
  return hashes;
}

// Each tool version must be exactly what its name says, and one this build can read (IMP-04).
function checkedVersions(hashes: Set<string>, files: Map<string, Uint8Array>) {
  return [...hashes].map((hash) => {
    const body = decode(files.get(`versions/${hash}.json`) as Uint8Array);
    if (sha256(body) !== hash) {
      throw new ArchiveError(
        "A tool version in this archive doesn't match its name, so nothing was imported.",
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new ArchiveError(
        "A tool version in this archive isn't readable, so nothing was imported.",
      );
    }
    const reading = readArtifact(parsed);
    if (reading.kind === "incompatible") {
      throw new ArchiveError(`A tool version in this archive can't be used: ${reading.reason}`);
    }
    // Stored versions are canonical JSON, so their name is the hash of exactly this text.
    if (canonicalJson(parsed) !== body) {
      throw new ArchiveError(
        "A tool version in this archive isn't stored the way Tessera stores it, so nothing was imported.",
      );
    }
    return { hash, body, contractVersion: (parsed as { contractVersion: number }).contractVersion };
  });
}

const taken = z.object({ n: z.number() });

/**
 * Imports an archive, checked whole before anything is written, in one transaction. What is
 * already here is never changed: if any of its IDs are taken, everything comes in as a copy with
 * new IDs (IMP-06).
 */
export function importArchive(store: Store, bytes: Uint8Array): Imported {
  const files = readZip(bytes, ARCHIVE_LIMITS);
  const manifest = readManifest(files);
  const versions = checkedVersions(checkConsistent(manifest, files), files);

  return store.db.transaction(() => {
    const exists = (table: "workspaces" | "saved_tools", id: string) =>
      (store.db.get(taken, `SELECT COUNT(*) AS n FROM ${table} WHERE id = ?`, id)?.n ?? 0) > 0;
    const asCopy =
      manifest.workspaces.some((w) => exists("workspaces", w.id)) ||
      manifest.savedTools.some((t) => exists("saved_tools", t.id));
    const newIds = new Map<string, string>();
    const idOf = (id: string) => {
      if (!asCopy) return id;
      if (!newIds.has(id)) newIds.set(id, randomUUID());
      return newIds.get(id) as string;
    };

    const at = store.now().toISOString();
    for (const version of versions) {
      store.db.run(
        "INSERT OR IGNORE INTO tool_versions (hash, contract_version, body, created_at) VALUES (?, ?, ?, ?)",
        version.hash,
        version.contractVersion,
        version.body,
        at,
      );
    }
    for (const workspace of manifest.workspaces) {
      const id = idOf(workspace.id);
      store.db.run(
        "INSERT INTO workspaces (id, title, data, data_revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        id,
        workspace.title,
        JSON.stringify(workspace.data),
        workspace.dataRevision,
        workspace.createdAt,
        workspace.updatedAt,
      );
      for (const version of workspace.versions) {
        store.db.run(
          "INSERT INTO workspace_versions (workspace_id, number, hash, created_at) VALUES (?, ?, ?, ?)",
          id,
          version.index,
          version.hash,
          version.createdAt,
        );
      }
    }
    for (const tool of manifest.savedTools) {
      store.db.run(
        "INSERT INTO saved_tools (id, name, workspace_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        idOf(tool.id),
        tool.name,
        idOf(tool.workspaceId),
        tool.createdAt,
        tool.updatedAt,
      );
    }
    return {
      exported: manifest.exported,
      workspaces: manifest.workspaces.map((w) => getWorkspace(store, idOf(w.id)) as Workspace),
      savedTools: manifest.savedTools.map((t) => getSavedTool(store, idOf(t.id)) as SavedTool),
      asCopy,
    };
  });
}
