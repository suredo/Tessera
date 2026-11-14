import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CONNECTIONS_LIMIT,
  HOST_ACTIONS,
  hostReplySchema,
  type HostActionName,
} from "@tessera/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { ARCHIVE_LIMITS, exportWorkspace } from "../src/archives/archive.ts";
import { readZip } from "../src/archives/zip.ts";
import { answerHost } from "../src/host/index.ts";
import { openDataFolder, type DataFolder } from "../src/storage/index.ts";
import { createWorkspace } from "../src/workspaces/index.ts";
import { writesAllowed } from "../src/connections/index.ts";

// Connections to outside services that the person adds (CAP-02, ADR 0015), through the host API:
// a connection names a service, the origins it may reach and how its key is sent; the key is kept
// by the host and no reply, listing or export carries it. Every data folder is a new temporary one
// (ENG-19). No request reaches any service: the request path is #349's next step.

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const newFolder = async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-connections-"));
  temps.push(dir);
  return openDataFolder(dir);
};

const KEY = "sk-test-0123456789-never-shown";
const movies = {
  name: "movies",
  origins: ["https://api.example.com", "https://images.example.com"],
  auth: { kind: "header", name: "Authorization", prefix: "Bearer " },
  key: KEY,
};

function ask<A extends HostActionName>(folder: DataFolder, action: A, args: unknown = {}) {
  const reply = hostReplySchema.parse(answerHost(folder, { action, args }));
  if (!reply.ok) throw new Error(`${action}: ${reply.error.message}`);
  return HOST_ACTIONS[action].result.parse(reply.result) as ReturnType<
    (typeof HOST_ACTIONS)[A]["result"]["parse"]
  >;
}
const refusal = (folder: DataFolder, action: string, args: unknown) =>
  hostReplySchema.parse(answerHost(folder, { action, args }));

describe("connections the person adds (CAP-02, ADR 0015)", () => {
  it("CAP-02: adds, lists and removes a connection, and no reply carries its key, only that it has one", async () => {
    const folder = await newFolder();
    const added = ask(folder, "connections.add", { connection: movies });
    const { addedAt, ...kept } = added.connection;
    expect(kept).toEqual({
      name: "movies",
      origins: movies.origins,
      auth: movies.auth,
      hasKey: true,
    });
    expect(Number.isNaN(Date.parse(addedAt))).toBe(false);
    ask(folder, "connections.add", {
      connection: {
        name: "weather",
        origins: ["https://weather.example.org"],
        auth: { kind: "none" },
        key: null,
      },
    });
    const listed = ask(folder, "connections.list");
    expect(listed.connections.map((c) => [c.name, c.hasKey])).toEqual([
      ["movies", true],
      ["weather", false],
    ]);
    expect(JSON.stringify([added, listed])).not.toContain(KEY);
    ask(folder, "connections.remove", { name: "movies" });
    expect(ask(folder, "connections.list").connections.map((c) => c.name)).toEqual(["weather"]);
    folder.close();
  });

  it("CAP-02: an export never carries a connection's key", async () => {
    const folder = await newFolder();
    ask(folder, "connections.add", { connection: movies });
    const workspace = createWorkspace(folder, "Old science fiction films");
    // Every entry, unzipped: the archive's entries are compressed, so its raw bytes show nothing.
    const entries = [...readZip(exportWorkspace(folder, workspace.id), ARCHIVE_LIMITS).values()];
    const text = entries.map((bytes) => Buffer.from(bytes).toString("utf8")).join(" ");
    // The search sees what the export holds: the workspace's own title is there.
    expect(text).toContain("Old science fiction films");
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("api.example.com");
    folder.close();
  });

  it("CNX-07: the host app allows a tool's changes through a connection and takes them back; a tool can't name another workspace's", async () => {
    const folder = await newFolder();
    ask(folder, "connections.add", { connection: movies });
    const { id } = createWorkspace(folder, "Movie finder");
    expect(
      ask(folder, "connections.allowWrites", { workspaceId: id, connection: "movies" }),
    ).toEqual({});
    expect(writesAllowed(folder, id, "movies")).toBe(true);
    ask(folder, "connections.takeBackWrites", { workspaceId: id, connection: "movies" });
    expect(writesAllowed(folder, id, "movies")).toBe(false);
    // Refused plainly for a connection or a workspace that isn't there.
    const unknown = refusal(folder, "connections.allowWrites", {
      workspaceId: id,
      connection: "weather",
    });
    expect(unknown).toMatchObject({
      ok: false,
      error: { message: "There is no connection called weather." },
    });
    const gone = refusal(folder, "connections.allowWrites", {
      workspaceId: "00000000-0000-4000-8000-000000000009",
      connection: "movies",
    });
    expect(gone).toMatchObject({
      ok: false,
      error: { message: "That tool is gone or in the trash." },
    });
    folder.close();
  });

  it("CAP-02: refuses a taken name, an unknown one to remove, and more than the limit, in plain words", async () => {
    const folder = await newFolder();
    ask(folder, "connections.add", { connection: movies });
    expect(refusal(folder, "connections.add", { connection: movies })).toEqual({
      ok: false,
      error: { code: "refused", message: "There is already a connection called movies." },
    });
    expect(refusal(folder, "connections.remove", { name: "films" })).toEqual({
      ok: false,
      error: { code: "refused", message: "There is no connection called films." },
    });
    for (let i = 1; i < CONNECTIONS_LIMIT; i += 1)
      ask(folder, "connections.add", {
        connection: {
          name: `s${i}`,
          origins: [`https://s${i}.example.com`],
          auth: { kind: "none" },
          key: null,
        },
      });
    const over = refusal(folder, "connections.add", {
      connection: {
        name: "one-more",
        origins: ["https://more.example.com"],
        auth: { kind: "none" },
        key: null,
      },
    });
    expect(over).toMatchObject({ ok: false, error: { code: "refused" } });
    folder.close();
  });

  it("CAP-02: an address is an origin alone, and a key comes exactly when the connection sends one", async () => {
    const folder = await newFolder();
    const invalid = (connection: object) =>
      refusal(folder, "connections.add", { connection: { ...movies, ...connection } });
    for (const origins of [
      ["https://api.example.com/v3"],
      ["https://someone@api.example.com"],
      ["ftp://api.example.com"],
      ["https://API.example.com"],
      ["https://api.example.com", "https://api.example.com"],
      [],
    ])
      expect(invalid({ origins }), JSON.stringify(origins)).toMatchObject({
        ok: false,
        error: { code: "invalid" },
      });
    expect(invalid({ key: null })).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(invalid({ auth: { kind: "none" } })).toMatchObject({
      ok: false,
      error: { code: "invalid" },
    });
    expect(invalid({ name: "Movies" })).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(invalid({ key: "line\nbreak" })).toMatchObject({
      ok: false,
      error: { code: "invalid" },
    });
    expect(ask(folder, "connections.list").connections).toEqual([]);
    folder.close();
  });
});
