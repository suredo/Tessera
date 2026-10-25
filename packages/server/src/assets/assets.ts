import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  ASSET_LIMIT_BYTES,
  assetIdSchema,
  assetSchema,
  WORKSPACE_ASSETS_LIMIT_BYTES,
  type Asset,
  type AssetType,
} from "@tessera/contracts";
import { z } from "zod";
import type { DataFolder } from "../storage/index.ts";
import { sniffImage } from "./sniff.ts";

// The asset store (DATA-11): each image is one file in the data folder's assets folder, named by
// the SHA-256 of its bytes, with one row in `assets`. Assets never change: an edited image is a new
// asset. A new file is written under a temporary name and renamed into place before its row
// commits, so a row always has its file; a file left without a row by a crash is removed at the
// next start. What refers to an asset isn't recorded: cleanup looks through everything stored for
// its ID (the owner's decision on #49), so an asset is removed only when nothing holds it.

/** What the store needs of an open data folder: its database, clock and folders. */
export type AssetStore = Pick<DataFolder, "db" | "now" | "paths">;

const EXTENSIONS: Record<AssetType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const MB = 1024 * 1024;
// Temporary files are written here, inside the assets folder, so a rename never crosses drives.
const TEMP = ".incoming";
const STORED_NAME = /^([0-9a-f]{64})\.(png|jpg|webp)$/;

const assetFromRow = z
  .object({
    hash: z.string(),
    type: z.string(),
    size_bytes: z.number(),
    width_px: z.number(),
    height_px: z.number(),
    original_name: z.string().nullable(),
    created_at: z.string(),
  })
  .transform((row) => ({
    id: row.hash,
    type: row.type,
    sizeBytes: row.size_bytes,
    widthPx: row.width_px,
    heightPx: row.height_px,
    originalName: row.original_name,
    createdAt: row.created_at,
  }))
  .pipe(assetSchema);
const SELECT_ASSET =
  "SELECT hash, type, size_bytes, width_px, height_px, original_name, created_at FROM assets";

// The file of an asset: under a folder named by its hash's first two digits. Only ever built from
// a checked ID and the row's type, never from anything a caller passes as a path (AST-03).
const fileOf = (store: AssetStore, asset: Pick<Asset, "id" | "type">) =>
  path.join(store.paths.assets, asset.id.slice(0, 2), `${asset.id}.${EXTENSIONS[asset.type]}`);

export const getAsset = (store: AssetStore, id: string): Asset | undefined =>
  assetIdSchema.safeParse(id).success
    ? store.db.get(assetFromRow, `${SELECT_ASSET} WHERE hash = ?`, id)
    : undefined;

// Everything stored that may name an asset, as JSON text: every workspace's data, trashed ones
// included, every tool version, and every recovery snapshot. A new table that stores tool data,
// such as data undo (#110), must be added here, or cleanup can remove an asset it still holds.
const REFERENCE_SOURCES = [
  "SELECT data AS text FROM workspaces",
  "SELECT body AS text FROM tool_versions",
  "SELECT data AS text FROM recovery_snapshots",
];
// The same, for one workspace: its data, the versions in its history and its snapshots.
const WORKSPACE_SOURCES = [
  "SELECT data AS text FROM workspaces WHERE id = ?",
  "SELECT v.body AS text FROM tool_versions v JOIN workspace_versions w ON w.hash = v.hash WHERE w.workspace_id = ?",
  "SELECT data AS text FROM recovery_snapshots WHERE workspace_id = ?",
];
const textRow = z.object({ text: z.string() });

// Storing, cleanup and the sweep each touch rows and files with waits between them, so they run
// one at a time per database: otherwise cleanup could remove the file of an asset stored again
// while it waited, leaving a row with no file.
const queues = new WeakMap<object, Promise<unknown>>();
function exclusively<T>(store: AssetStore, work: () => Promise<T>): Promise<T> {
  const run = (queues.get(store.db) ?? Promise.resolve()).then(work, work);
  queues.set(
    store.db,
    run.catch(() => {}),
  );
  return run;
}
const HASH_TEXT = /[0-9a-f]{64}/g;

// Every 64-hex-digit run in the texts that is a stored asset's ID. A run that happens to match an
// asset only keeps it longer; one is never missed, wherever in the data it sits.
function idsIn(store: AssetStore, queries: readonly string[], ...params: string[]): Set<string> {
  const known = new Set(
    store.db.all(z.object({ hash: z.string() }), "SELECT hash FROM assets").map((r) => r.hash),
  );
  const found = new Set<string>();
  for (const query of queries) {
    for (const { text } of store.db.all(textRow, query, ...params)) {
      for (const [run] of text.matchAll(HASH_TEXT)) if (known.has(run)) found.add(run);
    }
  }
  return found;
}

/** The IDs of the assets something stored still refers to (DATA-09, DATA-11). */
export const referencedAssets = (store: AssetStore): Set<string> => idsIn(store, REFERENCE_SOURCES);

export type StoreAssetRefusal = "empty" | "too-large" | "not-an-image" | "workspace-full";
export type StoreAssetResult =
  { ok: true; asset: Asset } | { ok: false; reason: StoreAssetRefusal; message: string };

const refuse = (reason: StoreAssetRefusal, message: string): StoreAssetResult => ({
  ok: false,
  reason,
  message: `Nothing was saved: ${message}`,
});

/**
 * Stores `bytes` as an asset, once: the same bytes always give the same asset. Checked first, by
 * content and size, and, for a workspace, against what its assets add up to; nothing is written
 * unless every check passes (AST-01, AST-02).
 */
export function storeAsset(
  store: AssetStore,
  bytes: Uint8Array,
  options: { originalName?: string; workspaceId?: string } = {},
): Promise<StoreAssetResult> {
  return exclusively(store, () => storeNow(store, bytes, options));
}

async function storeNow(
  store: AssetStore,
  bytes: Uint8Array,
  options: { originalName?: string; workspaceId?: string },
): Promise<StoreAssetResult> {
  if (bytes.byteLength === 0) return refuse("empty", "the file is empty.");
  if (bytes.byteLength > ASSET_LIMIT_BYTES) {
    return refuse(
      "too-large",
      `the file is ${Math.ceil(bytes.byteLength / MB)} MB, over the limit of ${ASSET_LIMIT_BYTES / MB} MB for one file.`,
    );
  }
  const sniffed = sniffImage(bytes);
  if (!sniffed.ok) {
    return refuse("not-an-image", "the file isn't a PNG, JPEG or WebP image, whatever its name.");
  }
  const id = createHash("sha256").update(bytes).digest("hex");
  const existing = getAsset(store, id);
  if (options.workspaceId !== undefined) {
    const held = idsIn(store, WORKSPACE_SOURCES, options.workspaceId);
    held.delete(id);
    let total = bytes.byteLength;
    for (const other of held) total += getAsset(store, other)?.sizeBytes ?? 0;
    if (total > WORKSPACE_ASSETS_LIMIT_BYTES) {
      return refuse(
        "workspace-full",
        `the workspace's images would come to ${Math.ceil(total / MB)} MB, over the limit of ${WORKSPACE_ASSETS_LIMIT_BYTES / MB} MB.`,
      );
    }
  }
  if (existing) return { ok: true, asset: existing };

  const asset = assetSchema.parse({
    id,
    type: sniffed.type,
    sizeBytes: bytes.byteLength,
    widthPx: sniffed.widthPx,
    heightPx: sniffed.heightPx,
    originalName: options.originalName?.slice(0, 255) ?? null,
    createdAt: store.now().toISOString(),
  });
  const file = fileOf(store, asset);
  const temp = path.join(store.paths.assets, TEMP, randomUUID());
  await fs.promises.mkdir(path.dirname(temp), { recursive: true });
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.promises.writeFile(temp, bytes, { flush: true });
    // In place before its row: a row never names a missing file. Same bytes, same name, so a file
    // a crash left here is replaced by an identical one.
    await fs.promises.rename(temp, file);
  } finally {
    await fs.promises.rm(temp, { force: true });
  }
  store.db.run(
    "INSERT OR IGNORE INTO assets (hash, type, size_bytes, width_px, height_px, original_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    asset.id,
    asset.type,
    asset.sizeBytes,
    asset.widthPx,
    asset.heightPx,
    asset.originalName,
    asset.createdAt,
  );
  return { ok: true, asset: getAsset(store, id) ?? asset };
}

/** An asset's row and bytes, or undefined for an ID that isn't a stored asset's (AST-03). */
export async function readAsset(
  store: AssetStore,
  id: string,
): Promise<{ asset: Asset; bytes: Uint8Array } | undefined> {
  const asset = getAsset(store, id);
  if (!asset) return undefined;
  return { asset, bytes: new Uint8Array(await fs.promises.readFile(fileOf(store, asset))) };
}

/**
 * Removes every asset nothing refers to any more: its row, in one transaction that checks again,
 * then its file. A crash between the two leaves a file without a row, which the next start's sweep
 * removes. Returns the IDs removed. `beforeFiles` is for tests: it runs after the rows go and
 * before the files do.
 */
export function collectAssets(
  store: AssetStore,
  options: { beforeFiles?: () => Promise<void> } = {},
): Promise<string[]> {
  return exclusively(store, () => collectNow(store, options));
}

async function collectNow(
  store: AssetStore,
  options: { beforeFiles?: () => Promise<void> },
): Promise<string[]> {
  const removed = store.db.transaction(() => {
    const held = referencedAssets(store);
    const unheld = store.db.all(assetFromRow, SELECT_ASSET).filter((asset) => !held.has(asset.id));
    for (const asset of unheld) store.db.run("DELETE FROM assets WHERE hash = ?", asset.id);
    return unheld;
  });
  await options.beforeFiles?.();
  for (const asset of removed) await fs.promises.rm(fileOf(store, asset), { force: true });
  return removed.map((asset) => asset.id);
}

/**
 * At start: removes what an interrupted write left, inside the assets folder only. That is every
 * temporary file, and every stored file whose name is an asset's but has no row; a file named
 * otherwise isn't the store's, and is left alone (AST-06). Returns the paths removed.
 */
export function sweepAssets(store: AssetStore): Promise<string[]> {
  return exclusively(store, () => sweepNow(store));
}

async function sweepNow(store: AssetStore): Promise<string[]> {
  const root = store.paths.assets;
  const removed: string[] = [];
  const temp = path.join(root, TEMP);
  for (const name of await fs.promises.readdir(temp).catch(() => [])) {
    await fs.promises.rm(path.join(temp, name), { force: true });
    removed.push(path.join(temp, name));
  }
  const folders = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const folder of folders) {
    if (!folder.isDirectory() || !/^[0-9a-f]{2}$/.test(folder.name)) continue;
    const dir = path.join(root, folder.name);
    for (const file of await fs.promises.readdir(dir, { withFileTypes: true })) {
      const name = STORED_NAME.exec(file.name);
      if (!file.isFile() || !name || !name[1]!.startsWith(folder.name)) continue;
      if (getAsset(store, name[1]!)) continue;
      await fs.promises.rm(path.join(dir, file.name), { force: true });
      removed.push(path.join(dir, file.name));
    }
  }
  return removed;
}
