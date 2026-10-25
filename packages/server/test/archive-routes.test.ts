import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { EXPORT_ROUTE, IMPORT_ROUTE, importReplySchema, type Artifact } from "@tessera/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { ARCHIVE_LIMITS, archiveRoutes, exportName } from "../src/archives/index.ts";
import { startLocalServer } from "../src/http/index.ts";
import { openDataFolder } from "../src/storage/index.ts";
import { saveVersion } from "../src/versions/index.ts";
import {
  activateVersion,
  createWorkspace,
  listSavedTools,
  listWorkspaces,
  readWorkspaceData,
  saveTool,
} from "../src/workspaces/index.ts";

// The host app's archive routes (APP-06, DATA-05): export answers with the archive as a file, and
// import answers what came in, or why nothing did, in plain words. Every data folder is a new
// temporary one (ENG-19).

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const newFolder = async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-archive-routes-"));
  temps.push(dir);
  return openDataFolder(dir);
};

const tool: Artifact = {
  contractVersion: 2,
  code: { html: "<p>Errands</p>", css: "", js: "" },
  data: {
    schemaVersion: 1,
    schema: {},
    defaults: { tasks: [{ id: "t-1", title: "Buy milk" }] },
    migrations: [],
  },
  capabilities: [],
  pins: [],
  ui: { standardVersion: 1, mode: "standard" },
};

type Answer = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };
/** Sends a same-origin request, as the host page would; a test overrides any header. */
function send(
  port: number,
  route: string,
  body: Uint8Array | string,
  headers: Record<string, string> = {},
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: route,
        method: headers["x-method"] ?? "POST",
        headers: { origin: `http://127.0.0.1:${port}`, ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
const exportOf = (port: number, request: unknown) =>
  send(port, EXPORT_ROUTE, JSON.stringify(request), { "content-type": "application/json" });
const importOf = async (port: number, bytes: Uint8Array | string) => {
  const answer = await send(port, IMPORT_ROUTE, bytes, {
    "content-type": "application/octet-stream",
  });
  return {
    status: answer.status,
    reply: importReplySchema.parse(JSON.parse(answer.body.toString())),
  };
};

/** A data folder with a workspace running the tool, saved to the library; and its server. */
async function serving() {
  const folder = await newFolder();
  const { id } = createWorkspace(folder, "Errands");
  expect(activateVersion(folder, id, saveVersion(folder.db, tool), 0).ok).toBe(true);
  const saved = saveTool(folder, id, "Weekly errands");
  const server = await startLocalServer({ port: 0, routes: archiveRoutes(folder) });
  return { folder, id, saved, server };
}

describe("export (APP-06, DATA-05)", () => {
  it("answers with the workspace's archive, as a file named after it and the day", async () => {
    const { folder, id, server } = await serving();
    const answer = await exportOf(server.port, { exported: "workspace", id });
    expect(answer.status).toBe(200);
    expect(answer.headers["content-type"]).toBe("application/octet-stream");
    const file = `${exportName("Errands", folder.now())}.tessera`;
    expect(answer.headers["content-disposition"]).toBe(
      `attachment; filename="${file}"; filename*=UTF-8''${encodeURIComponent(file)}`,
    );
    // A ZIP file: the archive's container.
    expect(answer.body.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    await server.close();
    folder.close();
  });

  it("answers with a saved tool's archive, named after the tool", async () => {
    const { folder, saved, server } = await serving();
    const answer = await exportOf(server.port, { exported: "savedTool", id: saved.id });
    expect(answer.status).toBe(200);
    const file = `${exportName("Weekly errands", folder.now())}.tessera`;
    expect(answer.headers["content-disposition"]).toContain(`filename="${file}"`);
    await server.close();
    folder.close();
  });

  it("cuts a long name between whole characters, so any valid name exports", async () => {
    const folder = await newFolder();
    // 59 letters, then one outside the Basic Multilingual Plane: two UTF-16 units, at 60 and 61.
    const title = `${"a".repeat(59)}\u{20000}`;
    const { id } = createWorkspace(folder, title);
    const server = await startLocalServer({ port: 0, routes: archiveRoutes(folder) });
    const answer = await exportOf(server.port, { exported: "workspace", id });
    expect(answer.status).toBe(200);
    const day = folder.now().toISOString().slice(0, 10);
    expect(exportName(title, folder.now())).toBe(`${title} ${day}`);
    await server.close();
    folder.close();
  });

  it("refuses plainly what it can't export, and anything but a request for one", async () => {
    const { folder, server } = await serving();
    const missing = await exportOf(server.port, {
      exported: "workspace",
      id: "00000000-0000-4000-8000-000000000000",
    });
    expect(missing.status).toBe(404);
    expect(missing.body.toString()).toBe(
      "There is no workspace with the ID 00000000-0000-4000-8000-000000000000 to export.",
    );
    expect((await exportOf(server.port, { exported: "everything" })).status).toBe(400);
    expect((await send(server.port, EXPORT_ROUTE, "not json")).status).toBe(400);
    expect((await send(server.port, EXPORT_ROUTE, "", { "x-method": "GET" })).status).toBe(405);
    expect((await exportOf(server.port, { pad: "x".repeat(5_000) })).status).toBe(413);
    const foreign = await send(server.port, EXPORT_ROUTE, "{}", { origin: "http://example.com" });
    expect(foreign.status).toBeGreaterThanOrEqual(400);
    await server.close();
    folder.close();
  });
});

describe("import (APP-06, DATA-05)", () => {
  it("brings an export back into another data folder, and says what came in", async () => {
    const source = await serving();
    const archive = (await exportOf(source.server.port, { exported: "workspace", id: source.id }))
      .body;
    const target = await newFolder();
    const server = await startLocalServer({ port: 0, routes: archiveRoutes(target) });

    const { status, reply } = await importOf(server.port, archive);
    expect(status).toBe(200);
    expect(reply).toEqual({
      ok: true,
      exported: "workspace",
      workspaces: [{ id: source.id, title: "Errands" }],
      savedTools: [{ id: source.saved.id, name: "Weekly errands" }],
      asCopy: false,
    });
    expect(listWorkspaces(target).map((w) => w.title)).toEqual(["Errands"]);
    expect(readWorkspaceData(target, source.id).data).toEqual(
      readWorkspaceData(source.folder, source.id).data,
    );

    // Again into the same folder: it comes in as a copy, and changes nothing already there.
    const again = await importOf(server.port, archive);
    expect(again.reply).toMatchObject({ ok: true, asCopy: true });
    expect(listWorkspaces(target)).toHaveLength(2);
    expect(listSavedTools(target)).toHaveLength(2);
    await Promise.all([source.server.close(), server.close()]);
    source.folder.close();
    target.close();
  });

  it("refuses a file that isn't an archive, in plain words, and imports nothing", async () => {
    const folder = await newFolder();
    const server = await startLocalServer({ port: 0, routes: archiveRoutes(folder) });
    const { status, reply } = await importOf(server.port, "not an archive");
    expect(status).toBe(200);
    expect(reply.ok).toBe(false);
    expect(reply.ok === false && reply.message).toMatch(/^[A-Z][^{}<>]*\.$/);
    expect(listWorkspaces(folder)).toEqual([]);
    await server.close();
    folder.close();
  });

  it("refuses a file larger than an archive may be, before reading it", async () => {
    const folder = await newFolder();
    const server = await startLocalServer({ port: 0, routes: archiveRoutes(folder) });
    // It says it is too large; the route answers without reading the body.
    const answer = await send(server.port, IMPORT_ROUTE, "", {
      "content-length": String(ARCHIVE_LIMITS.archiveBytes + 1),
    });
    expect(importReplySchema.parse(JSON.parse(answer.body.toString()))).toEqual({
      ok: false,
      message: "The file is larger than Tessera imports (564 MB). Nothing was imported.",
    });
    expect(listWorkspaces(folder)).toEqual([]);
    await server.close();
    folder.close();
  });
});
