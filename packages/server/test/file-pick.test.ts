import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ASSET_LIMIT_BYTES,
  FILE_PICK_ROUTE,
  PICK_HOLD_HOURS,
  type Artifact,
  type BridgeReply,
  type FilePickRequest,
} from "@tessera/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { collectAssets, getAsset } from "../src/assets/index.ts";
import { answerDataCall, answerFilePick, bridgeRoutes } from "../src/bridge/index.ts";
import { startLocalServer } from "../src/http/index.ts";
import { openDataFolder } from "../src/storage/index.ts";
import { deleteWorkspace } from "../src/trash/index.ts";
import { saveVersion } from "../src/versions/index.ts";
import {
  addWorkspaceVersion,
  createWorkspace,
  saveWorkspaceData,
} from "../src/workspaces/index.ts";
import { post } from "./support/http.ts";

// Files in on the server (CAP-03, A80): an image the person picked for a tool is checked again,
// with the stored version's capabilities and only for an active tool, stored as an asset by its
// content, and held for the workspace for a day, so the tool can read it and save its ID in its
// data. Every data folder is a new temporary one, never the real one (ENG-19).

const temps: string[] = [];
const opened: { close(): void }[] = [];
afterAll(() => {
  opened.forEach((folder) => folder.close());
  temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
});
const newFolder = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-pick-"));
  temps.push(dir);
  return dir;
};

// A tiny image Chrome drew, 4 by 3 pixels.
const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "assets");
const png = new Uint8Array(fs.readFileSync(path.join(fixtures, "photo.png")));
const jpeg = new Uint8Array(fs.readFileSync(path.join(fixtures, "photo.jpg")));

const tool = (capabilities: string[]): Artifact => ({
  contractVersion: 4,
  connections: {},
  code: { html: "<p>Photos</p>", css: "", js: "" },
  data: { schemaVersion: 1, schema: {}, defaults: {}, migrations: [] },
  capabilities,
  pins: [],
  ui: { standardVersion: 1, mode: "standard" },
});

const HOUR = 3_600_000;

/** A data folder on a clock the test moves, with a workspace running a tool that may pick. */
async function photos(capabilities: string[] = ["files"]) {
  let at = Date.parse("2026-11-15T10:00:00.000Z");
  const folder = await openDataFolder(newFolder(), { now: () => new Date(at) });
  opened.push(folder);
  const workspace = (title: string) => {
    const { id } = createWorkspace(folder, title);
    addWorkspaceVersion(folder, id, saveVersion(folder.db, tool(capabilities)));
    return id;
  };
  const id = workspace("Photos");
  let calls = 0;
  const call = (action = "file.pick", args: unknown = {}) => ({
    requestId: `r${(calls += 1)}`,
    action,
    args,
  });
  const pick = async (
    bytes: Uint8Array,
    options: Partial<FilePickRequest> = {},
  ): Promise<BridgeReply> => {
    const reply = await answerFilePick(
      folder,
      { workspaceId: id, phase: "active", call: call(), name: "beach.png", ...options },
      bytes,
    );
    if (!reply) throw new Error("A call with a request ID got no reply.");
    return reply;
  };
  const read = async (assetId: string, workspaceId = id) =>
    answerDataCall(folder, {
      workspaceId,
      phase: "active",
      call: call("asset.read", { id: assetId }),
    });
  const later = (hours: number) => (at += hours * HOUR);
  return { folder, id, workspace, call, pick, read, later };
}

const assetCount = (folder: Awaited<ReturnType<typeof photos>>["folder"]) =>
  folder.db.get(z.object({ n: z.number() }), "SELECT count(*) AS n FROM assets")?.n;
const messageOf = (reply: BridgeReply) => (reply.ok ? "" : reply.error.message);
const idOf = (reply: BridgeReply) => {
  if (!reply.ok) throw new Error(reply.error.message);
  return (reply.result as { file: { id: string } }).file.id;
};

describe("an image the person picked for a tool, on the server (CAP-03, A80)", () => {
  it("CAP-03, DATA-11: keeps it as an asset and answers with its ID and what it is, never a path", async () => {
    const { folder, pick, read } = await photos();
    const reply = await pick(png);
    expect(reply).toMatchObject({
      ok: true,
      result: {
        file: { type: "image/png", name: "beach.png", sizeBytes: png.byteLength, widthPx: 4 },
      },
    });
    const id = idOf(reply);
    expect(JSON.stringify(reply)).not.toMatch(/assets[/\\]|\.png"?\s*$|[A-Z]:\\/);
    expect(getAsset(folder, id)).toMatchObject({ originalName: "beach.png" });
    // Held for the workspace, so the tool reads it before its data names it.
    expect(await read(id)).toMatchObject({ ok: true, result: { type: "image/png" } });
  });

  it("CAP-03, AST-04: another workspace's tool can't read it, even by its ID", async () => {
    const { pick, read, workspace } = await photos();
    const id = idOf(await pick(png));
    const other = workspace("Other photos");
    expect(await read(id, other)).toMatchObject({ ok: false, error: { code: "invalid-args" } });
  });

  it("CAP-01, GEN-06: refuses a tool that didn't declare files, and one whose person hasn't clicked, keeping nothing", async () => {
    const undeclared = await photos([]);
    expect(await undeclared.pick(png)).toMatchObject({
      ok: false,
      error: { code: "undeclared-capability" },
    });
    expect(assetCount(undeclared.folder)).toBe(0);

    const { folder, pick } = await photos();
    for (const phase of ["starting", "staging"] as const) {
      const refused = await pick(png, { phase });
      expect(refused).toMatchObject({ ok: false, error: { code: "not-active" } });
      expect(messageOf(refused)).toContain("Nothing was kept");
    }
    expect(assetCount(folder)).toBe(0);
  });

  it("AST-01: refuses a file that isn't a PNG, JPEG or WebP image, whatever its name, plainly", async () => {
    const { folder, pick } = await photos();
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    const refused = await pick(html, { name: "photo.png" });
    expect(refused).toMatchObject({ ok: false, error: { code: "invalid-args" } });
    expect(messageOf(refused)).toContain("isn't a PNG, JPEG or WebP");
    expect(await pick(new Uint8Array())).toMatchObject({
      ok: false,
      error: { code: "invalid-args" },
    });
    expect(assetCount(folder)).toBe(0);
  });

  it("RUN-04: only a file.pick call brings a file, and a tool in the trash keeps nothing", async () => {
    const { folder, id, call, pick } = await photos();
    const reply = await answerFilePick(
      folder,
      { workspaceId: id, phase: "active", call: call("data.read"), name: "beach.png" },
      png,
    );
    expect(reply).toMatchObject({ ok: false, error: { code: "invalid-args" } });
    // A workspace in the trash runs no tool, so it declares nothing, as for its data calls.
    deleteWorkspace(folder, id);
    expect(await pick(png)).toMatchObject({ ok: false });
    expect(assetCount(folder)).toBe(0);
  });

  it("DATA-09, A80: cleanup keeps a picked image for a day, then only if the tool's data names it", async () => {
    const { folder, id, pick, later } = await photos();
    const kept = idOf(await pick(png, { name: "kept.png" }));
    const dropped = idOf(await pick(jpeg, { name: "dropped.jpg" }));
    saveWorkspaceData(folder, id, { photos: [{ id: "p-1", asset: kept }] }, 0);

    later(PICK_HOLD_HOURS - 1);
    expect(await collectAssets(folder)).toEqual([]);
    later(2);
    expect(await collectAssets(folder)).toEqual([dropped]);
    expect(getAsset(folder, kept)).toBeDefined();
  });

  it("A80: picking the same image again holds it a day from then", async () => {
    const { folder, pick, later } = await photos();
    const id = idOf(await pick(png));
    later(PICK_HOLD_HOURS - 1);
    expect(idOf(await pick(png, { name: "again.png" }))).toBe(id);
    later(PICK_HOLD_HOURS - 1);
    expect(await collectAssets(folder)).toEqual([]);
    later(2);
    expect(await collectAssets(folder)).toEqual([id]);
  });
});

describe("the route for a picked file (SEC-03)", () => {
  it("takes the bytes with the call in the query, and refuses anything else plainly", async () => {
    const { folder, id, call } = await photos();
    const server = await startLocalServer({ port: 0, routes: bridgeRoutes(folder) });
    const query = (request: unknown) =>
      `${FILE_PICK_ROUTE}?request=${encodeURIComponent(JSON.stringify(request))}`;
    const good = { workspaceId: id, phase: "active", call: call(), name: "beach.png" };
    const bytes = { "content-type": "application/octet-stream" };
    try {
      const picked = await post(server.port, query(good), png, bytes);
      expect(picked.status).toBe(200);
      expect(JSON.parse(picked.body)).toMatchObject({ ok: true, result: { file: { widthPx: 4 } } });

      // No request, a path for a name, or a request that isn't JSON: refused before anything.
      expect((await post(server.port, FILE_PICK_ROUTE, png, bytes)).status).toBe(400);
      const path = { ...good, call: call(), name: "../../secret.png" };
      expect((await post(server.port, query(path), png, bytes)).status).toBe(400);
      expect((await post(server.port, `${FILE_PICK_ROUTE}?request=%7B`, png, bytes)).status).toBe(
        400,
      );
      // Too large, by what it declares or what it sends.
      const large = new Uint8Array(ASSET_LIMIT_BYTES + 1);
      expect((await post(server.port, query({ ...good, call: call() }), large, bytes)).status).toBe(
        413,
      );
      // Only POST, and only from Tessera's own pages.
      expect((await post(server.port, query(good), png, { "x-method": "PUT" })).status).toBe(405);
      const away = { ...bytes, origin: "http://localhost:9" };
      expect((await post(server.port, query({ ...good, call: call() }), png, away)).status).toBe(
        403,
      );
    } finally {
      await server.close();
    }
  });
});
