import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ASSET_LIMIT_BYTES, type Artifact } from "@tessera/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  collectAssets,
  getAsset,
  readAsset,
  referencedAssets,
  sniffImage,
  storeAsset,
  sweepAssets,
} from "../src/assets/index.ts";
import { openDataFolder, type DataFolder } from "../src/storage/index.ts";
import { deleteWorkspace, emptyTrash, listTrash } from "../src/trash/index.ts";
import { saveVersion } from "../src/versions/index.ts";
import { activateVersion, createWorkspace, saveWorkspaceData } from "../src/workspaces/index.ts";

// The asset store (DATA-11, DATA-09, AST-01 to AST-03, AST-06): images stored once by their
// SHA-256, checked by content, removed only when nothing refers to them. Every data folder is a
// new temporary one, never the real one (ENG-19).

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const newFolder = async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-assets-"));
  temps.push(dir);
  return openDataFolder(dir);
};

// Tiny images Chrome drew, 4 by 3 pixels.
const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "assets");
const image = (name: string) => new Uint8Array(fs.readFileSync(path.join(fixtures, name)));
const png = image("photo.png");
const jpeg = image("photo.jpg");
const webp = image("photo.webp");
const bytesOf = (text: string) => new TextEncoder().encode(text);

/** Every file under the assets folder, relative to it. */
const filesIn = (folder: DataFolder) =>
  fs.existsSync(folder.paths.assets)
    ? (fs.readdirSync(folder.paths.assets, { recursive: true }) as string[])
        .map((f) => f.replaceAll("\\", "/"))
        .filter((f) => fs.statSync(path.join(folder.paths.assets, f)).isFile())
        .sort()
    : [];
const rows = (folder: DataFolder) =>
  folder.db.all(z.object({ hash: z.string() }), "SELECT hash FROM assets ORDER BY hash");

async function stored(folder: DataFolder, bytes: Uint8Array) {
  const result = await storeAsset(folder, bytes);
  if (!result.ok) throw new Error(result.message);
  return result.asset;
}

/** A workspace whose data names `ids`, as a tool would keep them. */
function workspaceHolding(folder: DataFolder, ids: string[]) {
  const { id } = createWorkspace(folder, "Photos");
  saveWorkspaceData(folder, id, { photos: ids.map((asset, i) => ({ id: `p-${i}`, asset })) }, 0);
  return id;
}

// Minimal WebP headers in the two layouts Chrome doesn't write: lossy (VP8) and lossless (VP8L).
function webpHeader(chunk: "VP8 " | "VP8L", frame: number[]) {
  const bytes = new Uint8Array(40);
  bytes.set(bytesOf("RIFF"), 0);
  new DataView(bytes.buffer).setUint32(4, 32, true);
  bytes.set(bytesOf("WEBP"), 8);
  bytes.set(bytesOf(chunk), 12);
  bytes.set(frame, 20);
  return bytes;
}

describe("telling an image by its content (AST-01)", () => {
  it("DATA-11: knows PNG, JPEG and WebP by their bytes, with their dimensions", () => {
    for (const [bytes, type] of [
      [png, "image/png"],
      [jpeg, "image/jpeg"],
      [webp, "image/webp"],
    ] as const) {
      expect(sniffImage(bytes)).toEqual({ ok: true, type, widthPx: 4, heightPx: 3 });
    }
    // Lossy: a key frame's start code, then 14-bit width and height, little-endian.
    const lossy = webpHeader("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, 4, 0, 3, 0]);
    expect(sniffImage(lossy)).toEqual({ ok: true, type: "image/webp", widthPx: 4, heightPx: 3 });
    // Lossless: a signature byte, then width - 1 and height - 1 in 14 bits each: 3 and 2 here.
    const lossless = webpHeader("VP8L", [0x2f, 0x03, 0x80, 0x00, 0x00]);
    expect(sniffImage(lossless)).toEqual({
      ok: true,
      type: "image/webp",
      widthPx: 4,
      heightPx: 3,
    });
  });

  it("AST-01: refuses what isn't one, whatever it's named or how its header starts", () => {
    const lying = [
      bytesOf("<html><script>alert(1)</script></html>"),
      bytesOf('<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>'),
      // A PNG signature, then a page.
      new Uint8Array([...png.subarray(0, 8), ...bytesOf("<html>".repeat(10))]),
      // A JPEG start, then no frame at all.
      new Uint8Array([0xff, 0xd8, 0xff, 0xd9, ...bytesOf("text".repeat(10))]),
      // A WebP container whose size runs past its end.
      new Uint8Array([...webp.subarray(0, 4), 0xff, 0xff, 0xff, 0x7f, ...webp.subarray(8)]),
      // A PNG claiming no width.
      (() => {
        const zero = png.slice();
        zero.set([0, 0, 0, 0], 16);
        return zero;
      })(),
      new Uint8Array(),
    ];
    for (const bytes of lying) expect(sniffImage(bytes)).toEqual({ ok: false });
  });
});

describe("the asset store (DATA-11)", () => {
  it("DATA-11: stores an image once, named by its SHA-256, with its row", async () => {
    const folder = await newFolder();
    const asset = await stored(folder, png);
    expect(asset).toMatchObject({ type: "image/png", sizeBytes: png.byteLength, widthPx: 4 });
    expect(asset.id).toMatch(/^[0-9a-f]{64}$/);
    expect(filesIn(folder)).toEqual([`${asset.id.slice(0, 2)}/${asset.id}.png`]);
    // The same bytes again are the same asset, and one file.
    expect((await stored(folder, png)).id).toBe(asset.id);
    expect(filesIn(folder)).toHaveLength(1);
    const read = await readAsset(folder, asset.id);
    expect(read?.asset).toEqual(asset);
    expect(Buffer.from(read!.bytes).equals(Buffer.from(png))).toBe(true);
    folder.close();
  });

  it("DATA-08: an asset is there after a restart", async () => {
    const folder = await newFolder();
    const asset = await stored(folder, jpeg);
    const dir = folder.paths.root;
    folder.close();
    const again = await openDataFolder(dir);
    expect((await readAsset(again, asset.id))?.asset).toEqual(asset);
    again.close();
  });

  it("AST-01, AST-02: refuses a file that isn't an image, or is too large, with a plain message, writing nothing", async () => {
    const folder = await newFolder();
    expect(
      await storeAsset(folder, bytesOf("<html></html>"), { originalName: "photo.png" }),
    ).toEqual({
      ok: false,
      reason: "not-an-image",
      message: "Nothing was saved: the file isn't a PNG, JPEG or WebP image, whatever its name.",
    });
    const huge = new Uint8Array(ASSET_LIMIT_BYTES + 1);
    huge.set(png);
    expect(await storeAsset(folder, huge)).toEqual({
      ok: false,
      reason: "too-large",
      message: "Nothing was saved: the file is 26 MB, over the limit of 25 MB for one file.",
    });
    expect(await storeAsset(folder, new Uint8Array())).toMatchObject({ reason: "empty" });
    expect(filesIn(folder)).toEqual([]);
    expect(rows(folder)).toEqual([]);
    folder.close();
  });

  it("AST-02: refuses an image that takes a workspace's images over their limit", async () => {
    const folder = await newFolder();
    // Twenty rows of the largest size, 500 MB in all, held by the workspace's data. Rows alone:
    // no 500 MB of files needed.
    const big = Array.from({ length: 20 }, (_, i) => i.toString(16).padStart(2, "0").repeat(32));
    for (const hash of big) {
      folder.db.run(
        "INSERT INTO assets (hash, type, size_bytes, width_px, height_px, original_name, created_at) VALUES (?, 'image/png', ?, 1, 1, NULL, ?)",
        hash,
        ASSET_LIMIT_BYTES,
        new Date().toISOString(),
      );
    }
    const workspaceId = workspaceHolding(folder, big);
    expect(await storeAsset(folder, png, { workspaceId })).toEqual({
      ok: false,
      reason: "workspace-full",
      message:
        "Nothing was saved: the workspace's images would come to 501 MB, over the limit of 500 MB.",
    });
    expect(filesIn(folder)).toEqual([]);
    // Another workspace has room.
    const other = createWorkspace(folder, "Other").id;
    expect((await storeAsset(folder, png, { workspaceId: other })).ok).toBe(true);
    folder.close();
  });

  it("AST-03: an ID that isn't a SHA-256 reads nothing, from the store or outside it", async () => {
    const folder = await newFolder();
    const asset = await stored(folder, png);
    fs.writeFileSync(path.join(folder.paths.root, "secret.txt"), "secret");
    for (const id of [
      "../secret.txt",
      "..\\secret.txt",
      path.join(folder.paths.root, "secret.txt"),
      `${asset.id.slice(0, 2)}/${asset.id}.png`,
      asset.id.toUpperCase(),
      `${asset.id}/`,
      "",
    ]) {
      expect(getAsset(folder, id)).toBeUndefined();
      expect(await readAsset(folder, id)).toBeUndefined();
    }
    folder.close();
  });
});

describe("removing assets nothing refers to (DATA-09, DATA-11)", () => {
  it("DATA-11: keeps an asset while a workspace's data, a version or a snapshot names it, and only then removes it", async () => {
    const folder = await newFolder();
    const [inData, inVersion, loose] = [
      await stored(folder, png),
      await stored(folder, jpeg),
      await stored(folder, webp),
    ];
    const workspace = workspaceHolding(folder, [inData.id]);
    // A version whose reusable defaults name an asset keeps it, as Use again starts from them.
    const version: Artifact = {
      contractVersion: 2,
      code: { html: "", css: "", js: "" },
      data: { schemaVersion: 1, schema: {}, defaults: { cover: inVersion.id }, migrations: [] },
      capabilities: [],
      pins: [],
      ui: { standardVersion: 1, mode: "standard" },
    };
    saveVersion(folder.db, version);
    expect(referencedAssets(folder)).toEqual(new Set([inData.id, inVersion.id]));

    expect(await collectAssets(folder)).toEqual([loose.id]);
    expect(getAsset(folder, loose.id)).toBeUndefined();
    expect(filesIn(folder)).toHaveLength(2);

    // The data lets go of its photo: then it goes too.
    saveWorkspaceData(folder, workspace, { photos: [] }, 1);
    expect(await collectAssets(folder)).toEqual([inData.id]);
    expect(filesIn(folder)).toEqual([`${inVersion.id.slice(0, 2)}/${inVersion.id}.jpg`]);
    folder.close();
  });

  it("DATA-09: the trash keeps an asset until its workspace is removed for good", async () => {
    const folder = await newFolder();
    const asset = await stored(folder, png);
    const workspace = workspaceHolding(folder, [asset.id]);
    deleteWorkspace(folder, workspace);
    expect(await collectAssets(folder)).toEqual([]);
    expect(getAsset(folder, asset.id)).toBeDefined();
    emptyTrash(folder, listTrash(folder).confirmation);
    expect(await collectAssets(folder)).toEqual([asset.id]);
    expect(filesIn(folder)).toEqual([]);
    folder.close();
  });

  it("DATA-10: a recovery snapshot keeps the assets of the unit it holds", async () => {
    const folder = await newFolder();
    const asset = await stored(folder, png);
    const { id } = createWorkspace(folder, "Photos");
    const hash = saveVersion(folder.db, {
      contractVersion: 2,
      code: { html: "", css: "", js: "" },
      data: { schemaVersion: 1, schema: {}, defaults: {}, migrations: [] },
      capabilities: [],
      pins: [],
      ui: { standardVersion: 1, mode: "standard" },
    });
    expect(activateVersion(folder, id, hash, 0).ok).toBe(true);
    folder.db.run(
      "INSERT INTO recovery_snapshots (id, workspace_id, version_hash, data, created_at) VALUES ('s-1', ?, ?, ?, ?)",
      id,
      hash,
      JSON.stringify({ photos: [{ id: "p-0", asset: asset.id }] }),
      new Date().toISOString(),
    );
    expect(await collectAssets(folder)).toEqual([]);
    folder.close();
  });
});

describe("the start-up sweep (AST-06)", () => {
  it("AST-06: removes files an interrupted write left, and nothing else", async () => {
    const folder = await newFolder();
    const kept = await stored(folder, png);
    // A crash after the rename, before the row: a stored file with no row.
    const orphan = "c".repeat(64);
    fs.mkdirSync(path.join(folder.paths.assets, "cc"), { recursive: true });
    fs.writeFileSync(path.join(folder.paths.assets, "cc", `${orphan}.png`), png);
    // A crash during the write: a temporary file.
    fs.mkdirSync(path.join(folder.paths.assets, ".incoming"), { recursive: true });
    fs.writeFileSync(path.join(folder.paths.assets, ".incoming", "half"), "half");
    // Files that aren't the store's: a note, and an asset-like name in the wrong folder.
    fs.writeFileSync(path.join(folder.paths.assets, "notes.txt"), "mine");
    fs.mkdirSync(path.join(folder.paths.assets, "dd"));
    fs.writeFileSync(path.join(folder.paths.assets, "dd", `${"e".repeat(64)}.png`), png);
    // And one beside the store, outside it.
    fs.writeFileSync(path.join(folder.paths.root, `${"f".repeat(64)}.png`), png);

    const removed = (await sweepAssets(folder)).map((p) => path.relative(folder.paths.assets, p));
    expect(removed.map((p) => p.replaceAll("\\", "/")).sort()).toEqual([
      ".incoming/half",
      `cc/${orphan}.png`,
    ]);
    expect(filesIn(folder)).toEqual(
      [`${kept.id.slice(0, 2)}/${kept.id}.png`, `dd/${"e".repeat(64)}.png`, "notes.txt"].sort(),
    );
    expect(fs.existsSync(path.join(folder.paths.root, `${"f".repeat(64)}.png`))).toBe(true);
    folder.close();
  });
});
