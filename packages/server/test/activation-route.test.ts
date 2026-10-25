import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ACTIVATION_ROUTE,
  activationReplySchema,
  type Artifact,
  type Migration,
} from "@tessera/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { startLocalServer } from "../src/http/index.ts";
import { openDataFolder, type DataFolder } from "../src/storage/index.ts";
import { deleteWorkspace } from "../src/trash/index.ts";
import { saveVersion } from "../src/versions/index.ts";
import {
  activateVersion,
  activationRoutes,
  createWorkspace,
  getWorkspace,
  patchWorkspaceData,
  readWorkspaceData,
  workspaceVersions,
} from "../src/workspaces/index.ts";
import { post } from "./support/http.ts";

// The activation route (RUN-03, DATA-10, MIG-06): once a candidate has passed its checks, the host
// page asks the server to activate it. The server does it atomically or refuses plainly, changing
// nothing. Every data folder is a new temporary one, never the real one (ENG-19).

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const newFolder = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-activation-route-"));
  temps.push(dir);
  return dir;
};

const schema = (fields: string[]) =>
  ({
    type: "object",
    properties: {
      tasks: {
        type: "array",
        items: {
          type: "object",
          required: ["id", ...fields],
          properties: Object.fromEntries(
            ["id", ...fields].map((field) => [field, { type: "string" }] as const),
          ),
          additionalProperties: false,
        },
      },
    },
  }) as Artifact["data"]["schema"];
const toV2: Migration = {
  fromVersion: 1,
  toVersion: 2,
  operations: [{ op: "renameField", collection: "tasks", from: "name", to: "title" }],
};
const version = (html: string, data: Partial<Artifact["data"]>): Artifact => ({
  contractVersion: 2,
  code: { html, css: "", js: "" },
  data: {
    schemaVersion: 1,
    schema: schema(["name"]),
    defaults: { tasks: [] },
    migrations: [],
    ...data,
  },
  capabilities: [],
  pins: [],
  ui: { standardVersion: 1, mode: "standard" },
});

/** A workspace running version 1 with one task, version 2 saved, and the route served. */
async function served() {
  const folder = await openDataFolder(newFolder());
  const { id } = createWorkspace(folder, "Errands");
  const first = saveVersion(
    folder.db,
    version("<p>1</p>", { defaults: { tasks: [{ id: "t-1", name: "Buy milk" }] } }),
  );
  const second = saveVersion(
    folder.db,
    version("<p>2</p>", { schemaVersion: 2, schema: schema(["title"]), migrations: [toV2] }),
  );
  expect(activateVersion(folder, id, first, 0).ok).toBe(true);
  const server = await startLocalServer({ port: 0, routes: activationRoutes(folder) });
  const activate = (body: unknown, headers?: Record<string, string>) =>
    post(server.port, ACTIVATION_ROUTE, JSON.stringify(body), headers);
  const close = async () => {
    await server.close();
    folder.close();
  };
  return { folder, id, first, second, server, activate, close };
}

/** Everything activation may change. */
const unit = (folder: DataFolder, id: string) => ({
  workspace: getWorkspace(folder, id),
  history: workspaceVersions(folder, id).map((v) => v.hash),
  data: readWorkspaceData(folder, id),
});

describe("the activation route (RUN-03, DATA-10)", () => {
  it("DATA-10: activates a version that passed its checks, migrating the data, and answers with the workspace", async () => {
    const { folder, id, first, second, activate, close } = await served();
    const reply = await activate({ workspaceId: id, hash: second, expectedDataRevision: 1 });
    expect(reply.status).toBe(200);
    const parsed = activationReplySchema.parse(JSON.parse(reply.body));
    expect(parsed).toMatchObject({
      ok: true,
      migrationCount: 1,
      workspace: { id, currentVersion: second },
    });
    expect(unit(folder, id)).toMatchObject({
      history: [first, second],
      data: { data: { tasks: [{ id: "t-1", title: "Buy milk" }] } },
    });
    await close();
  });

  it("MIG-06: refuses an activation planned before the data changed, and changes nothing", async () => {
    const { folder, id, second, activate, close } = await served();
    expect(
      patchWorkspaceData(folder, id, {
        operations: [
          {
            op: "replace",
            collection: "tasks",
            id: "t-1",
            revisionCount: 1,
            fields: { name: "Oat milk" },
          },
        ],
      }).ok,
    ).toBe(true);
    const before = unit(folder, id);
    const reply = await activate({ workspaceId: id, hash: second, expectedDataRevision: 1 });
    expect(reply.status).toBe(200);
    expect(activationReplySchema.parse(JSON.parse(reply.body))).toEqual({
      ok: false,
      reason: "stale",
      message:
        "Nothing was changed: the data changed after this change was planned, and that newer data is kept.",
    });
    expect(unit(folder, id)).toEqual(before);
    await close();
  });

  it("DATA-10: an unknown version is refused, and nothing changes", async () => {
    const { folder, id, activate, close } = await served();
    const before = unit(folder, id);
    const reply = await activate({
      workspaceId: id,
      hash: "0".repeat(64),
      expectedDataRevision: 1,
    });
    expect(activationReplySchema.parse(JSON.parse(reply.body))).toMatchObject({
      ok: false,
      reason: "no-version",
    });
    expect(unit(folder, id)).toEqual(before);
    await close();
  });

  it("SEC-03: refuses malformed, oversized, non-POST and cross-site requests plainly, before activating anything", async () => {
    const { folder, id, second, server, activate, close } = await served();
    const before = unit(folder, id);
    const valid = { workspaceId: id, hash: second, expectedDataRevision: 1 };
    expect((await post(server.port, ACTIVATION_ROUTE, "not json")).status).toBe(400);
    expect((await activate({ ...valid, hash: "not a hash" })).status).toBe(400);
    expect((await activate({ ...valid, expectedDataRevision: -1 })).status).toBe(400);
    expect((await activate({ ...valid, extra: true })).status).toBe(400);
    expect((await activate({ ...valid, padding: "x".repeat(5000) })).status).toBe(413);
    expect((await post(server.port, ACTIVATION_ROUTE, "", { "x-method": "GET" })).status).toBe(405);
    // Another site's page can't reach it: the guard refuses before the route runs.
    const foreign = await activate(valid, { origin: "http://example.com" });
    expect(foreign.status).toBeGreaterThanOrEqual(400);
    expect(unit(folder, id)).toEqual(before);
    await close();
  });

  it("DATA-09: a workspace that is missing or in the trash gets a plain 404", async () => {
    const { folder, id, second, activate, close } = await served();
    const missing = await activate({
      workspaceId: "00000000-0000-4000-8000-000000000000",
      hash: second,
      expectedDataRevision: 0,
    });
    expect(missing).toEqual({
      status: 404,
      body: "There is no workspace with the ID 00000000-0000-4000-8000-000000000000.",
    });
    deleteWorkspace(folder, id);
    const trashed = await activate({ workspaceId: id, hash: second, expectedDataRevision: 1 });
    expect(trashed).toEqual({
      status: 404,
      body: "The workspace is in the trash; restore it first.",
    });
    await close();
  });
});
