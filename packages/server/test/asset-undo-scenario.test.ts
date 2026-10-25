import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { collectAssets, getAsset, readAsset, storeAsset } from "../src/assets/index.ts";
import { launch, type Launched } from "../src/launcher/index.ts";
import type { DataFolder } from "../src/storage/index.ts";
import {
  createWorkspace,
  listUndo,
  patchWorkspaceData,
  readWorkspaceData,
  saveWorkspaceData,
  undoDataChange,
  UNDO_LIMIT,
} from "../src/workspaces/index.ts";

// The M1 exit criterion for assets (DATA-11, DATA-04), through a real Tessera started and stopped
// by its launcher: "Replacing it with a cropped copy, running cleanup, restarting and then undoing
// the crop brings the original back; once that undo entry is discarded, cleanup removes the
// original." The data folder is a temporary one, never the real one (ENG-19).

const temps: string[] = [];
const running: Launched[] = [];
afterAll(async () => {
  await Promise.all(running.flatMap((l) => (l.status === "started" ? [l.stop()] : [])));
  temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
});

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "assets");
// Two different images stand for a photo and its cropped copy: an edited image is a new asset.
const original = new Uint8Array(fs.readFileSync(path.join(fixtures, "photo.png")));
const cropped = new Uint8Array(fs.readFileSync(path.join(fixtures, "photo.webp")));

async function start(dataDir: string): Promise<DataFolder & { stop(): Promise<void> }> {
  const launched = await launch({ dataDir, port: 0, openBrowser: () => Promise.resolve() });
  running.push(launched);
  if (launched.status !== "started") throw new Error("Tessera didn't start.");
  return Object.assign(launched.dataFolder, { stop: () => launched.stop() });
}

async function stored(folder: DataFolder, bytes: Uint8Array) {
  const result = await storeAsset(folder, bytes);
  if (!result.ok) throw new Error(result.message);
  return result.asset.id;
}

/** A started Tessera with a workspace whose one photo is the original. */
async function withPhoto() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-scenario-"));
  temps.push(dataDir);
  const folder = await start(dataDir);
  const { id } = createWorkspace(folder, "Holiday");
  const first = await stored(folder, original);
  saveWorkspaceData(folder, id, { photos: [{ id: "p-1", asset: first }] }, 0);
  return { dataDir, folder, id, first };
}

/** Replaces the photo with its cropped copy, as a tool's change would. */
async function crop(folder: DataFolder, id: string) {
  const copy = await stored(folder, cropped);
  const revision = readWorkspaceData(folder, id).revisions["photos"]!["p-1"]!;
  const result = patchWorkspaceData(folder, id, {
    operations: [
      {
        op: "replace",
        collection: "photos",
        id: "p-1",
        revisionCount: revision,
        fields: { asset: copy },
      },
    ],
  });
  if (!result.ok) throw new Error(result.message);
  return copy;
}

const shownAsset = (folder: DataFolder, id: string) =>
  (readWorkspaceData(folder, id).data["photos"] as { asset: string }[])[0]!.asset;

describe("a cropped photo and its undo (M1 exit criterion, DATA-11, DATA-04)", () => {
  it("DATA-11: cleanup and a restart keep the original while the crop can be undone, and undoing brings it back", async () => {
    const { dataDir, folder, id, first } = await withPhoto();
    const copy = await crop(folder, id);
    // Nothing shows the original now, but the crop's undo entry names it: cleanup keeps it.
    expect(await collectAssets(folder)).toEqual([]);
    await folder.stop();

    // A restart sweeps and cleans up too, and keeps it.
    const again = await start(dataDir);
    expect(getAsset(again, first)).toBeDefined();
    const undo = listUndo(again, id)[0]!.number;
    expect(undoDataChange(again, id, undo)).toMatchObject({ ok: true });
    expect(shownAsset(again, id)).toBe(first);
    const back = await readAsset(again, first);
    expect(Buffer.from(back!.bytes).equals(Buffer.from(original))).toBe(true);
    // The cropped copy: nothing names it now that its change is undone and used up.
    expect(await collectAssets(again)).toEqual([copy]);
    await again.stop();
  });

  it("DATA-11: once the crop's undo entry is discarded, cleanup removes the original", async () => {
    const { folder, id, first } = await withPhoto();
    const copy = await crop(folder, id);
    expect(await collectAssets(folder)).toEqual([]);
    // 100 newer changes discard the crop's undo entry (DATA-04).
    for (let i = 0; i < UNDO_LIMIT; i += 1) {
      const revision = readWorkspaceData(folder, id).revisions["photos"]!["p-1"]!;
      patchWorkspaceData(folder, id, {
        operations: [
          {
            op: "replace",
            collection: "photos",
            id: "p-1",
            revisionCount: revision,
            fields: { note: `${i}` },
          },
        ],
      });
    }
    expect(await collectAssets(folder)).toEqual([first]);
    expect(getAsset(folder, first)).toBeUndefined();
    expect(getAsset(folder, copy)).toBeDefined();
    await folder.stop();
  });
});
