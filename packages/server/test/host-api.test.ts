import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  HOST_ACTIONS,
  HOST_ROUTE,
  hostReplySchema,
  type Artifact,
  type HostActionName,
} from "@tessera/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { answerHost, hostRoutes, workspaceTools } from "../src/host/index.ts";
import { startLocalServer } from "../src/http/index.ts";
import { openDataFolder, type DataFolder } from "../src/storage/index.ts";
import { saveVersion } from "../src/versions/index.ts";
import { activateVersion, patchWorkspaceData } from "../src/workspaces/index.ts";
import { post } from "./support/http.ts";

// The host app's API (APP-03 to APP-08): every action the contracts list, answered from the
// existing modules, with arguments and results checked against the contract (CON-01), and nothing
// of the server's internals in a refusal. Every data folder is a new temporary one (ENG-19).

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const newFolder = async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-host-api-"));
  temps.push(dir);
  return openDataFolder(dir);
};

const tool: Artifact = {
  contractVersion: 2,
  code: { html: "<p>Errands</p>", css: "", js: "" },
  data: { schemaVersion: 1, schema: {}, defaults: { tasks: [] }, migrations: [] },
  capabilities: [],
  pins: [],
  ui: { standardVersion: 1, mode: "standard" },
};

/** Asks the host API, expecting it to succeed; returns the result. */
function ask<A extends HostActionName>(folder: DataFolder, action: A, args: unknown = {}) {
  const reply = hostReplySchema.parse(answerHost(folder, { action, args }));
  if (!reply.ok) throw new Error(`${action}: ${reply.error.message}`);
  return HOST_ACTIONS[action].result.parse(reply.result) as ReturnType<
    (typeof HOST_ACTIONS)[A]["result"]["parse"]
  >;
}
const refusal = (folder: DataFolder, action: string, args: unknown = {}) =>
  answerHost(folder, { action, args });

describe("the host app's API (APP-03 to APP-08)", () => {
  it("APP-03: lists, creates, renames and deletes workspaces", async () => {
    const folder = await newFolder();
    const { workspace } = ask(folder, "workspaces.create", { title: "Errands" });
    expect(
      ask(folder, "workspaces.rename", { id: workspace.id, title: "Chores" }).workspace,
    ).toMatchObject({
      title: "Chores",
    });
    expect(ask(folder, "workspaces.list").workspaces.map((w) => w.title)).toEqual(["Chores"]);
    expect(ask(folder, "workspaces.delete", { id: workspace.id }).entry).toMatchObject({
      kind: "workspace",
      name: "Chores",
    });
    expect(ask(folder, "workspaces.list").workspaces).toEqual([]);
    // A trashed workspace is refused in the trash module's own plain words.
    expect(refusal(folder, "workspaces.rename", { id: workspace.id, title: "x" })).toEqual({
      ok: false,
      error: { code: "refused", message: "The workspace is in the trash; restore it first." },
    });
    expect(ask(folder, "trash.restoreWorkspace", { id: workspace.id }).workspace.title).toBe(
      "Chores",
    );
    folder.close();
  });

  it("APP-04, DATA-07: saves to the library, and continues or uses again from it", async () => {
    const folder = await newFolder();
    const { workspace } = ask(folder, "workspaces.create", { title: "This week" });
    expect(activateVersion(folder, workspace.id, saveVersion(folder.db, tool), 0).ok).toBe(true);
    const { savedTool } = ask(folder, "library.save", {
      workspaceId: workspace.id,
      name: "Errands",
    });
    expect(ask(folder, "library.list").savedTools).toEqual([savedTool]);
    expect(ask(folder, "library.continue", { id: savedTool.id }).workspace.id).toBe(workspace.id);
    const again = ask(folder, "library.useAgain", { id: savedTool.id, title: "Next week" });
    expect(again).toMatchObject({ ok: true, workspace: { title: "Next week" } });
    expect(ask(folder, "library.rename", { id: savedTool.id, name: "Chores" }).savedTool.name).toBe(
      "Chores",
    );
    expect(ask(folder, "library.delete", { id: savedTool.id }).entry.kind).toBe("savedTool");
    expect(ask(folder, "trash.restoreSavedTool", { id: savedTool.id }).savedTool.id).toBe(
      savedTool.id,
    );
    folder.close();
  });

  it("APP-05, DATA-04: lists versions, plans and restores one, and undoes a data change", async () => {
    const folder = await newFolder();
    const { workspace } = ask(folder, "workspaces.create", { title: "Errands" });
    const first = saveVersion(folder.db, tool);
    const second = saveVersion(folder.db, { ...tool, code: { ...tool.code, html: "<p>2</p>" } });
    expect(activateVersion(folder, workspace.id, first, 0).ok).toBe(true);
    expect(activateVersion(folder, workspace.id, second, 1).ok).toBe(true);
    expect(
      ask(folder, "versions.list", { workspaceId: workspace.id }).versions.map((v) => v.hash),
    ).toEqual([first, second]);
    expect(ask(folder, "versions.planRestore", { workspaceId: workspace.id, hash: first })).toEqual(
      {
        ok: true,
        keepsData: true,
      },
    );
    expect(
      ask(folder, "versions.restore", {
        workspaceId: workspace.id,
        hash: first,
        expectedDataRevision: 2,
      }),
    ).toMatchObject({ ok: true, workspace: { currentVersion: first } });
    expect(ask(folder, "snapshots.list", { workspaceId: workspace.id }).snapshots).toEqual([]);

    expect(
      patchWorkspaceData(folder, workspace.id, {
        operations: [{ op: "add", collection: "tasks", record: { title: "Buy milk" } }],
      }).ok,
    ).toBe(true);
    const [entry] = ask(folder, "undo.list", { workspaceId: workspace.id }).entries;
    expect(entry).toMatchObject({ kind: "records", recordCount: 1 });
    expect(
      ask(folder, "undo.undo", { workspaceId: workspace.id, number: entry!.number }),
    ).toMatchObject({
      ok: true,
      workspace: { data: { tasks: [] } },
    });
    folder.close();
  });

  it("DATA-09: lists the trash and empties it only with its confirmation", async () => {
    const folder = await newFolder();
    const { workspace } = ask(folder, "workspaces.create", { title: "Old" });
    ask(folder, "workspaces.delete", { id: workspace.id });
    const trash = ask(folder, "trash.list");
    expect(trash.entries).toHaveLength(1);
    expect(refusal(folder, "trash.empty", { confirmation: "not it" })).toMatchObject({
      ok: false,
      error: { code: "refused" },
    });
    expect(ask(folder, "trash.empty", { confirmation: trash.confirmation }).removed).toHaveLength(
      1,
    );
    folder.close();
  });

  it("CON-01: refuses an unknown action or arguments that don't fit, and keeps a database error's words to itself", async () => {
    const folder = await newFolder();
    for (const request of [
      { action: "workspaces.drop", args: {} },
      { action: "toString", args: {} },
      { action: "workspaces.rename", args: { id: "not an id", title: "x" } },
      { action: "workspaces.create", args: { title: "x", extra: true } },
      "not a request",
    ]) {
      expect(answerHost(folder, request)).toMatchObject({ ok: false, error: { code: "invalid" } });
    }
    expect(refusal(folder, "workspaces.create", { title: "" })).toMatchObject({
      ok: false,
      error: { code: "invalid" },
    });
    // A database error is the host's failure, in plain words, with nothing of the database's.
    folder.db.exec("DROP TABLE saved_tools");
    const failed = refusal(folder, "library.list");
    expect(failed).toEqual({
      ok: false,
      error: { code: "failed", message: "Tessera couldn't do that. Nothing was changed." },
    });
    folder.close();
  });
});

describe("the host route and the tools it serves (RUN-01, SEC-03)", () => {
  it("answers a same-origin POST, and refuses anything else plainly", async () => {
    const folder = await newFolder();
    const server = await startLocalServer({ port: 0, routes: hostRoutes(folder) });
    const created = await post(
      server.port,
      HOST_ROUTE,
      JSON.stringify({ action: "workspaces.create", args: { title: "Errands" } }),
    );
    expect(created.status).toBe(200);
    expect(JSON.parse(created.body)).toMatchObject({
      ok: true,
      result: { workspace: { title: "Errands" } },
    });
    expect((await post(server.port, HOST_ROUTE, "not json")).status).toBe(400);
    expect((await post(server.port, HOST_ROUTE, "", { "x-method": "GET" })).status).toBe(405);
    expect((await post(server.port, HOST_ROUTE, "x".repeat(70_000))).status).toBe(413);
    const foreign = await post(server.port, HOST_ROUTE, "{}", { origin: "http://example.com" });
    expect(foreign.status).toBeGreaterThanOrEqual(400);
    await server.close();
    folder.close();
  });

  it("RUN-01: a workspace's mount shows its current tool, and nothing for one without a tool", async () => {
    const folder = await newFolder();
    const { workspace } = ask(folder, "workspaces.create", { title: "Errands" });
    const toolFor = workspaceTools(folder);
    expect(toolFor(workspace.id)).toBeUndefined();
    expect(activateVersion(folder, workspace.id, saveVersion(folder.db, tool), 0).ok).toBe(true);
    expect(toolFor(workspace.id)).toEqual({ code: tool.code, ui: tool.ui });
    expect(toolFor("not-a-workspace")).toBeUndefined();
    ask(folder, "workspaces.delete", { id: workspace.id });
    expect(toolFor(workspace.id)).toBeUndefined();
    folder.close();
  });
});
