import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Artifact, BridgeDataRequest, BridgeReply } from "@tessera/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { BRIDGE_ROUTE } from "@tessera/contracts";
import { storeAsset } from "../src/assets/index.ts";
import { answerDataCall, bridgeRoutes } from "../src/bridge/index.ts";
import { startLocalServer } from "../src/http/index.ts";
import { openDataFolder, type DataFolder } from "../src/storage/index.ts";
import { deleteWorkspace } from "../src/trash/index.ts";
import { saveVersion } from "../src/versions/index.ts";
import {
  addWorkspaceVersion,
  createWorkspace,
  getWorkspace,
  readWorkspaceData,
  saveWorkspaceData,
} from "../src/workspaces/index.ts";
import { post as postTo } from "./support/http.ts";

// The server's side of the bridge (RUN-04, GEN-06, BRG-04): a tool's data call, passed on by the
// host page, is checked again with the stored version's capabilities and answered from saved data.
// Every data folder is a new temporary one, never the real one (ENG-19).

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const newFolder = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-bridge-"));
  temps.push(dir);
  return dir;
};

const tool = (capabilities: string[]): Artifact => ({
  contractVersion: 2,
  code: { html: "<p>Errands</p>", css: "", js: "" },
  data: { schemaVersion: 1, schema: {}, defaults: {}, migrations: [] },
  capabilities,
  pins: [],
  ui: { standardVersion: 1, mode: "standard" },
});
const tasks = {
  tasks: [
    { id: "t-1", title: "Buy milk", done: false },
    { id: "t-2", title: "Call the bank", done: false },
  ],
};

/** A data folder with one workspace running a tool that declares `capabilities`, holding tasks. */
async function workspaceWith(capabilities: string[] = []) {
  const folder = await openDataFolder(newFolder());
  const { id } = createWorkspace(folder, "Errands");
  addWorkspaceVersion(folder, id, saveVersion(folder.db, tool(capabilities)));
  saveWorkspaceData(folder, id, tasks, 0);
  let calls = 0;
  // Every call here has a request ID, so every one gets a reply.
  const ask = (
    action: string,
    args: unknown = {},
    phase: BridgeDataRequest["phase"] = "active",
  ): BridgeReply => {
    const reply = answerDataCall(folder, {
      workspaceId: id,
      phase,
      call: { requestId: `r${(calls += 1)}`, action, args },
    });
    if (!reply) throw new Error("A call with a request ID got no reply.");
    return reply;
  };
  return { folder, id, ask };
}

const titles = (folder: DataFolder, id: string) =>
  (readWorkspaceData(folder, id).data["tasks"] as { title: string }[]).map((t) => t.title);
const done = (id: string, revisionCount: number) => ({
  operations: [{ op: "replace", collection: "tasks", id, revisionCount, fields: { done: true } }],
});

describe("answering a tool's data call on the server (RUN-04)", () => {
  it("reads the saved data with each record's revision", async () => {
    const { folder, ask } = await workspaceWith();
    expect(ask("data.read")).toEqual({
      requestId: "r1",
      ok: true,
      result: { data: tasks, revisions: { tasks: { "t-1": 1, "t-2": 1 } } },
    });
    folder.close();
  });

  it("GEN-06: refuses a write unless the host page says the tool is active, and saves one that is", async () => {
    const { folder, id, ask } = await workspaceWith();
    for (const phase of ["starting", "staging"] as const) {
      expect(ask("data.patch", done("t-1", 1), phase)).toMatchObject({
        ok: false,
        error: { code: "not-active" },
      });
    }
    expect(readWorkspaceData(folder, id).revisions).toEqual({ tasks: { "t-1": 1, "t-2": 1 } });
    expect(ask("data.patch", done("t-1", 1))).toMatchObject({ ok: true, result: { addedIds: [] } });
    expect(readWorkspaceData(folder, id).revisions["tasks"]).toEqual({ "t-1": 2, "t-2": 1 });
    folder.close();
  });

  it("BRG-04: refuses a batch planned against an older revision whole; another record's batch applies", async () => {
    const { folder, id, ask } = await workspaceWith();
    // Someone else changes t-1 first.
    expect(ask("data.patch", done("t-1", 1)).ok).toBe(true);
    const before = getWorkspace(folder, id);
    const stale = ask("data.patch", {
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
    });
    expect(stale).toMatchObject({ ok: false, error: { code: "stale" } });
    expect(!stale?.ok && stale?.error.message).toMatch(
      /^Nothing was changed: .*newer edit is kept/,
    );
    expect(getWorkspace(folder, id)).toEqual(before);
    expect(ask("data.patch", done("t-2", 1)).ok).toBe(true);
    expect(titles(folder, id)).toEqual(["Buy milk", "Call the bank"]);
    folder.close();
  });

  it("passes on the patch engine's other refusals as the bridge's codes", async () => {
    const { folder, id, ask } = await workspaceWith();
    const add = (collection: string, title: string) => ({
      operations: [{ op: "add", collection, record: { title } }],
    });
    const noList = ask("data.patch", add("notes", "No such list"));
    expect(noList).toMatchObject({ ok: false, error: { code: "invalid-args" } });
    expect(!noList.ok && noList.error.message).toMatch(/^Nothing was changed/);
    // Within the call's limit, but over the data's once added (DATA-06).
    expect(ask("data.patch", add("tasks", "x".repeat(262_000)))).toMatchObject({
      ok: false,
      error: { code: "too-large" },
    });
    expect(titles(folder, id)).toEqual(["Buy milk", "Call the bank"]);
    folder.close();
  });

  it("checks the capabilities the stored tool version declares, never the browser's word (CAP-01)", async () => {
    const without = await workspaceWith([]);
    expect(without.ask("clock.now")).toMatchObject({ error: { code: "undeclared-capability" } });
    without.folder.close();
    // Declared, the call passes the check; the clock is the host page's to answer, not the server's.
    const declared = await workspaceWith(["clock"]);
    expect(declared.ask("clock.now")).toMatchObject({
      ok: false,
      error: { code: "failed", message: 'The server doesn\'t answer "clock.now"; the host does.' },
    });
    declared.folder.close();
  });

  it("refuses the shared check's refusals, and calls for a workspace in the trash, changing nothing", async () => {
    const { folder, id, ask } = await workspaceWith();
    expect(ask("fs.read")).toMatchObject({ error: { code: "unknown-action" } });
    expect(ask("data.read", { path: "C:/Users/me/tessera.db" })).toMatchObject({
      error: { code: "invalid-args" },
    });
    deleteWorkspace(folder, id);
    const gone = ask("data.patch", done("t-1", 1));
    expect(gone).toMatchObject({ ok: false, error: { code: "failed" } });
    expect(JSON.stringify(gone)).not.toMatch(/[A-Za-z]:[\\/]|tessera\.db/);
    folder.close();
  });
});

const post = (port: number, body: string, headers: Record<string, string> = {}) =>
  postTo(port, BRIDGE_ROUTE, body, headers);

describe("the bridge's route (SEC-03)", () => {
  it("answers a same-origin POST with the reply, and refuses anything else plainly", async () => {
    const { folder, id } = await workspaceWith();
    const server = await startLocalServer({ port: 0, routes: bridgeRoutes(folder) });
    const request = (call: unknown) => JSON.stringify({ workspaceId: id, phase: "active", call });

    const read = await post(
      server.port,
      request({ requestId: "r1", action: "data.read", args: {} }),
    );
    expect(read.status).toBe(200);
    expect(JSON.parse(read.body)).toMatchObject({ requestId: "r1", ok: true });

    expect((await post(server.port, "not json")).status).toBe(400);
    expect((await post(server.port, JSON.stringify({ workspaceId: id, call: {} }))).status).toBe(
      400,
    );
    expect((await post(server.port, "", { "x-method": "GET" })).status).toBe(405);
    const huge = request({
      requestId: "r2",
      action: "data.read",
      args: { x: "x".repeat(300_000) },
    });
    expect((await post(server.port, huge)).status).toBe(413);
    // Another site's page can't reach it: the guard refuses before the route runs.
    const foreign = await post(
      server.port,
      request({ requestId: "r3", action: "data.read", args: {} }),
      {
        origin: "http://example.com",
      },
    );
    expect(foreign.status).toBeGreaterThanOrEqual(400);
    await server.close();
    folder.close();
  });
});

describe("handing a tool an image (DATA-11, AST-03 to AST-05)", () => {
  const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "assets");
  const png = fs.readFileSync(path.join(fixtures, "photo.png"));
  const jpeg = fs.readFileSync(path.join(fixtures, "photo.jpg"));

  it("DATA-11, AST-05: gives an image the tool's data names as its type and bytes, never a path", async () => {
    const { folder, id, ask } = await workspaceWith();
    const stored = await storeAsset(folder, new Uint8Array(png));
    if (!stored.ok) throw new Error(stored.message);
    saveWorkspaceData(folder, id, { ...tasks, cover: stored.asset.id }, 1);
    const reply = ask("asset.read", { id: stored.asset.id }, "starting");
    expect(reply).toMatchObject({ ok: true });
    const result = (reply as { result: Record<string, string> }).result;
    expect(Object.keys(result).sort()).toEqual(["bytesBase64", "type"]);
    expect(result["type"]).toBe("image/png");
    expect(Buffer.from(result["bytesBase64"]!, "base64").equals(png)).toBe(true);
    // Nothing in the reply says where the image is kept.
    const text = JSON.stringify(reply);
    expect(text).not.toContain(folder.paths.root);
    expect(text).not.toMatch(/assets[\\/]|\.png"/);
    folder.close();
  });

  it("AST-04: refuses an image the tool's workspace doesn't name, even by its ID", async () => {
    const { folder, ask } = await workspaceWith();
    // Another workspace's image, stored in the same data folder.
    const other = createWorkspace(folder, "Holiday").id;
    const stored = await storeAsset(folder, new Uint8Array(jpeg));
    if (!stored.ok) throw new Error(stored.message);
    saveWorkspaceData(folder, other, { photos: [{ id: "p-1", asset: stored.asset.id }] }, 0);
    expect(ask("asset.read", { id: stored.asset.id })).toEqual({
      requestId: expect.any(String) as string,
      ok: false,
      error: { code: "invalid-args", message: "That image isn't one this tool's data names." },
    });
    folder.close();
  });

  it("AST-03: refuses an ID that isn't a SHA-256 before anything is read", async () => {
    const { folder, ask } = await workspaceWith();
    for (const id of ["../tessera.db", "C:/Windows/win.ini", "A".repeat(64), "photo.png"]) {
      expect(ask("asset.read", { id })).toMatchObject({
        ok: false,
        error: { code: "invalid-args" },
      });
    }
    folder.close();
  });
});
