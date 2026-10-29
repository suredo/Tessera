import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONFIRM_DATA_ROUTE,
  DEFAULT_ROUTES,
  GENERATE_ROUTE,
  generateReplySchema,
  type Intent,
} from "@tessera/contracts";
import { candidateFrom, generationRoutes } from "../src/generation/index.ts";
import { startLocalServer } from "../src/http/index.ts";
import { JobQueue } from "../src/jobs/index.ts";
import { createScriptedProvider } from "../src/providers/index.ts";
import { openDataFolder } from "../src/storage/index.ts";
import { saveVersion } from "../src/versions/index.ts";
import {
  activateVersion,
  createWorkspace,
  getWorkspace,
  listUndo,
  patchWorkspaceData,
  readWorkspaceData,
  workspaceVersions,
} from "../src/workspaces/index.ts";
import { editFixture } from "./fixtures/edit-tool.ts";

const intent: Intent = {
  kind: "data",
  interfacePart: null,
  dataPart: null,
  language: "en",
  features: [],
  targetsCurrentTool: true,
  behaviorChange: false,
  lookOnly: false,
};
const clean: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of clean.splice(0)) await close();
  vi.restoreAllMocks();
});
async function fixture(operation: unknown, limit = 420_000) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-data-flow-"));
  const folder = await openDataFolder(dir);
  const built = candidateFrom(editFixture);
  if (built.kind !== "candidate") throw new Error("Bad fixture");
  const workspace = createWorkspace(folder, editFixture.name, { data: built.startingData });
  const hash = saveVersion(folder.db, built.artifact);
  expect(activateVersion(folder, workspace.id, hash, workspace.dataRevision).ok).toBe(true);
  const provider = createScriptedProvider({
    name: "data-flow",
    replies: [
      { kind: "value", stage: "intent", value: intent },
      {
        kind: "value",
        stage: "data",
        value: {
          outcome: "patch",
          summary: "Proposed entry change.",
          patch: { operations: [operation] },
        } as never,
      },
    ],
  });
  let available = true;
  const server = await startLocalServer({
    port: 0,
    routes: generationRoutes({
      store: folder,
      jobs: new JobQueue(),
      provider: () => Promise.resolve(available ? provider : { problem: "Offline" }),
      routes: () => DEFAULT_ROUTES,
      requestTimeLimitMs: limit,
    }),
  });
  clean.push(async () => {
    await server.close();
    folder.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const post = async (route: string, body: unknown) => {
    const response = await fetch(new URL(route, server.url), {
      method: "POST",
      headers: { origin: server.url.replace(/\/$/, ""), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    return generateReplySchema.parse(await response.json());
  };
  const ask = () =>
    post(GENERATE_ROUTE, { workspaceId: workspace.id, request: "Change the named entry" });
  return {
    folder,
    id: workspace.id,
    hash,
    post,
    ask,
    offline: () => {
      available = false;
    },
  };
}
const rename = {
  op: "replace",
  collection: "items",
  id: "i-1",
  revisionCount: 999,
  fields: { title: "Oat milk" },
};

describe("chat patch lifecycle", () => {
  it("DATA-02 GEN-08: adds commit as data only, keeping tool history and host IDs", async () => {
    const f = await fixture({ op: "add", collection: "items", record: { title: "Bread" } });
    const before = getWorkspace(f.folder, f.id)!;
    const reply = await f.ask();
    expect(reply).toMatchObject({ kind: "data_changed", workspaceId: f.id, count: 1 });
    const after = getWorkspace(f.folder, f.id)!;
    expect(after.currentVersion).toBe(before.currentVersion);
    expect(after.dataRevision).toBe(before.dataRevision + 1);
    expect(workspaceVersions(f.folder, f.id)).toHaveLength(1);
    expect(listUndo(f.folder, f.id)).toHaveLength(1);
    const hostId: unknown = expect.any(String);
    expect(after.data?.["items"]).toEqual([
      { id: "i-1", title: "Milk" },
      { id: "i-2", title: "Eggs" },
      { id: hostId, title: "Bread" },
    ]);
  });
  it("GEN-01 DATA-02: exact existing-entry changes wait for approval, apply once without a provider, and preserve unrelated writes", async () => {
    const f = await fixture(rename);
    const before = getWorkspace(f.folder, f.id)!;
    const reply = await f.ask();
    if (reply.kind !== "data_confirmation") throw new Error("Expected review");
    expect(reply.changes).toEqual([
      {
        collection: "items",
        id: "i-1",
        before: { id: "i-1", title: "Milk" },
        after: { id: "i-1", title: "Oat milk" },
      },
    ]);
    expect(getWorkspace(f.folder, f.id)).toEqual(before);
    expect(
      patchWorkspaceData(f.folder, f.id, {
        operations: [
          {
            op: "replace",
            collection: "items",
            id: "i-2",
            revisionCount: 2,
            fields: { title: "Duck eggs" },
          },
        ],
      }).ok,
    ).toBe(true);
    f.offline();
    const results = await Promise.all(
      [true, true].map((approve) => f.post(CONFIRM_DATA_ROUTE, { token: reply.token, approve })),
    );
    expect(results.filter((r) => r.kind === "data_changed")).toHaveLength(1);
    expect(results.filter((r) => r.kind === "failed")).toHaveLength(1);
    expect(readWorkspaceData(f.folder, f.id).data["items"]).toEqual([
      { id: "i-1", title: "Oat milk" },
      { id: "i-2", title: "Duck eggs" },
    ]);
    expect(listUndo(f.folder, f.id)).toHaveLength(2);
  });
  it("GEN-01 DATA-04: cancelling a removal changes no data or undo history and consumes its token", async () => {
    const f = await fixture({ op: "remove", collection: "items", id: "i-1", revisionCount: 2 });
    const before = getWorkspace(f.folder, f.id);
    const reply = await f.ask();
    if (reply.kind !== "data_confirmation") throw new Error("Expected review");
    expect(await f.post(CONFIRM_DATA_ROUTE, { token: reply.token, approve: false })).toMatchObject({
      answer: "data_cancelled",
    });
    expect(await f.post(CONFIRM_DATA_ROUTE, { token: reply.token, approve: true })).toMatchObject({
      kind: "failed",
    });
    expect(getWorkspace(f.folder, f.id)).toEqual(before);
    expect(listUndo(f.folder, f.id)).toEqual([]);
  });
  it("DATA-02: a touched entry changed while reviewing wins over the approved old patch", async () => {
    const f = await fixture(rename);
    const reply = await f.ask();
    if (reply.kind !== "data_confirmation") throw new Error("Expected review");
    expect(
      patchWorkspaceData(f.folder, f.id, {
        operations: [{ ...rename, revisionCount: 2, fields: { title: "Fresh milk" } }],
      }).ok,
    ).toBe(true);
    const before = getWorkspace(f.folder, f.id);
    expect(await f.post(CONFIRM_DATA_ROUTE, { token: reply.token, approve: true })).toEqual({
      kind: "answer",
      answer: "data_stale",
    });
    expect(getWorkspace(f.folder, f.id)).toEqual(before);
  });
  it("GEN-11: review time consumes the original budget; an expired plan never writes", async () => {
    const start = Date.now();
    let now = start;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const f = await fixture(rename, 100_000);
    const reply = await f.ask();
    if (reply.kind !== "data_confirmation") throw new Error("Expected review");
    const before = getWorkspace(f.folder, f.id);
    now += 100_001;
    expect(await f.post(CONFIRM_DATA_ROUTE, { token: reply.token, approve: true })).toMatchObject({
      kind: "failed",
      message: "This review expired. Please ask for the change again.",
    });
    expect(getWorkspace(f.folder, f.id)).toEqual(before);
    expect(listUndo(f.folder, f.id)).toEqual([]);
  });
});
