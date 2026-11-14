import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CONNECTION_SAMPLE_LIMIT,
  DEFAULT_ROUTES,
  type Creation,
  type Intent,
} from "@tessera/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { addConnection } from "../src/connections/index.ts";
import { generate } from "../src/generation/index.ts";
import { repairSmoke, type SmokeRepairContext } from "../src/generation/smoke.ts";
import { toolConnections } from "../src/generation/tool-connections.ts";
import { promptBudget } from "../src/prompts/index.ts";
import { createScriptedProvider, type Provider, type StageSpec } from "../src/providers/index.ts";
import { openDataFolder, type DataFolder } from "../src/storage/index.ts";
import { loadVersion } from "../src/versions/index.ts";

// A request that may use a connection, through the pipeline with scripted answers (CAP-02, A66,
// A74, #349 step 4): the intent stage is told the person's connections by name and chooses; the
// host gives the tool only those it chose that the person has; creation and edit are told them,
// with their addresses and never the key, and their answers keep only those. No model is called.
// Every data folder is a new temporary one (ENG-19).

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const KEY = "made-up-key-91d2";

async function folderWithMovies(): Promise<DataFolder> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-connections-generation-"));
  temps.push(dir);
  const folder = await openDataFolder(dir);
  addConnection(folder, {
    name: "movies",
    origins: ["https://api.example.com"],
    auth: { kind: "header", name: "Authorization", prefix: "Bearer " },
    key: KEY,
  });
  addConnection(folder, {
    name: "watch-list",
    origins: ["https://lists.example.com"],
    auth: { kind: "none" },
    key: null,
  });
  return folder;
}

const intent = (fields: Partial<Intent> & { kind: Intent["kind"] }): Intent =>
  ({
    interfacePart: null,
    dataPart: null,
    behaviorChange: false,
    lookOnly: false,
    targetsCurrentTool: true,
    language: "en",
    features: [],
    ...fields,
  }) as Intent;

const sample = { statusCode: 200, contentType: "application/json", body: '{"results":[]}' };
const uses = (name: string) => ({ [name]: { samples: { "/search": sample } } });
const js = (name: string) =>
  `tessera.call("connection.request", { connection: "${name}", method: "GET", path: "/search?q=alien" })` +
  `.then((a) => { document.getElementById("text").textContent = String(a.statusCode); });`;
const finder = (name: string, extra: Partial<Extract<Creation, { outcome: "tool" }>> = {}) => ({
  outcome: "tool" as const,
  name: "Movie finder",
  summary: "Finds movies by title.",
  code: { html: '<p id="text">Movies</p>', css: "", js: js(name) },
  data: { schema: { type: "object" }, reusableDefaults: {}, initialState: {} },
  capabilities: ["connection" as const],
  connections: uses(name),
  uiMode: "standard" as const,
  ...extra,
});

/** A scripted provider giving these answers by stage, and every call it got. */
function scripted(...replies: { stage: string; value: unknown }[]) {
  const script = createScriptedProvider({
    name: "connections",
    replies: replies.map((r) => ({ kind: "value", ...r })) as never,
  });
  const calls: StageSpec<unknown>[] = [];
  const provider: Provider = {
    ...script,
    run: (spec) => {
      calls.push(spec);
      return script.run(spec);
    },
  };
  return { provider, calls };
}
const partsOf = (spec: StageSpec<unknown>) => (spec.promptParts ?? []).map((p) => p.split("@")[0]);

describe("a request that may use a connection (CAP-02, A66, A74)", () => {
  it("A74: the intent stage gets the person's connections by name, and the tool only those it chose that the person has", async () => {
    const folder = await folderWithMovies();
    const { provider, calls } = scripted(
      { stage: "intent", value: intent({ kind: "create", connections: ["movies", "bank"] }) },
      { stage: "create", value: finder("movies") },
    );
    const reply = await generate(folder, provider, DEFAULT_ROUTES, { request: "Find movies" });
    expect(reply).toMatchObject({ kind: "candidate", capabilities: ["connection"] });
    if (reply.kind !== "candidate") return;
    // Staging gets the samples the tool carries (A69).
    expect(reply.connections).toEqual(uses("movies"));
    const version = loadVersion(folder.db, reply.hash);
    expect(version?.kind === "ok" && version.artifact.connections).toEqual(uses("movies"));

    // The intent stage was told the names, never more.
    expect(calls[0]!.prompt).toContain('["movies","watch-list"]');
    expect(calls[0]!.prompt).not.toContain("api.example.com");
    // Creation was told how, and which, by name and address: only movies, as bank isn't the
    // person's; never the key.
    expect(partsOf(calls[1]!)).toEqual(
      expect.arrayContaining(["connections", "connections-quoted"]),
    );
    expect(calls[1]!.prompt).toContain('[{"name":"movies","origins":["https://api.example.com"]}]');
    expect(calls[1]!.prompt).not.toContain("watch-list");
    for (const call of calls) {
      expect(`${call.system}${call.prompt}`).not.toContain(KEY);
    }
    folder.close();
  });

  it("A66 A74: a connection the request didn't give the tool is a repair, naming the ones it may use", async () => {
    const folder = await folderWithMovies();
    const { provider, calls } = scripted(
      { stage: "intent", value: intent({ kind: "create", connections: ["movies"] }) },
      { stage: "create", value: finder("watch-list") },
      { stage: "repair", value: finder("movies") },
    );
    const reply = await generate(folder, provider, DEFAULT_ROUTES, { request: "Find movies" });
    expect(reply).toMatchObject({ kind: "candidate", connections: uses("movies") });
    expect(calls.map((c) => c.stage)).toEqual(["intent", "create", "repair"]);
    expect(calls[2]!.prompt).toContain(
      "The tool uses the connection watch-list, which isn't one the request lists. It may use: movies.",
    );
    folder.close();
  });

  it("A74: a request that needs no connection gets no connection parts, and its tool none", async () => {
    const folder = await folderWithMovies();
    const { provider, calls } = scripted(
      { stage: "intent", value: intent({ kind: "create" }) },
      {
        stage: "create",
        value: finder("movies", { code: { html: "<p>Hi</p>", css: "", js: "" }, connections: {} }),
      },
    );
    const reply = await generate(folder, provider, DEFAULT_ROUTES, { request: "A greeting" });
    expect(reply).toMatchObject({ kind: "candidate", capabilities: [] });
    expect(partsOf(calls[1]!)).not.toContain("connections");
    folder.close();
  });

  it("A74: an edit keeps the tool's connections and may add one the request gives it", async () => {
    const folder = await folderWithMovies();
    const first = scripted(
      { stage: "intent", value: intent({ kind: "create", connections: ["movies"] }) },
      { stage: "create", value: finder("movies") },
    );
    const made = await generate(folder, first.provider, DEFAULT_ROUTES, { request: "Find movies" });
    if (made.kind !== "candidate") throw new Error("Expected a candidate");
    // Activate it, as the app does once staging passes.
    const { activateVersion } = await import("../src/workspaces/index.ts");
    expect(activateVersion(folder, made.workspaceId, made.hash, made.expectedDataRevision).ok).toBe(
      true,
    );
    const both = { ...uses("movies"), ...uses("watch-list") };
    const second = scripted(
      { stage: "intent", value: intent({ kind: "edit", connections: ["watch-list"] }) },
      {
        stage: "edit",
        value: {
          outcome: "edit",
          summary: "Adds a watch list.",
          files: { mode: "unchanged" },
          connections: { mode: "replace", connections: both },
          data: { mode: "unchanged" },
        },
      },
    );
    const edited = await generate(folder, second.provider, DEFAULT_ROUTES, {
      request: "Let me add movies to my watch list",
      workspaceId: made.workspaceId,
    });
    expect(edited).toMatchObject({ kind: "candidate", connections: both });
    // The edit was told both, and its tool's sample paths.
    expect(second.calls[1]!.prompt).toContain('"connections":{"movies":["/search"]}');
    expect(second.calls[1]!.prompt).toContain('"name":"watch-list"');
    expect(partsOf(second.calls[1]!)).toContain("connections-edit");
    folder.close();
  });

  it("A74 GEN-09: a smoke repair of a connected creation keeps its connections and is told them", async () => {
    const folder = await folderWithMovies();
    let context: SmokeRepairContext | undefined;
    const { provider } = scripted(
      { stage: "intent", value: intent({ kind: "create", connections: ["movies"] }) },
      { stage: "create", value: finder("movies") },
    );
    const reply = await generate(
      folder,
      provider,
      DEFAULT_ROUTES,
      { request: "Find movies" },
      undefined,
      (c) => {
        context = c;
      },
    );
    if (reply.kind !== "candidate" || !context) throw new Error("Expected a candidate");
    // The repair leaves connections out: the failed candidate's are kept.
    const noConnections: Record<string, unknown> = { ...finder("movies") };
    delete noConnections["connections"];
    const repair = scripted({ stage: "repair", value: noConnections });
    const repaired = await repairSmoke(
      folder,
      repair.provider,
      DEFAULT_ROUTES,
      {
        workspaceId: reply.workspaceId,
        hash: reply.hash,
        findings: ["The list stayed empty."],
        failure: "smoke",
      },
      context,
    );
    expect(repaired).toMatchObject({ kind: "candidate", connections: uses("movies") });
    expect(partsOf(repair.calls[0]!)).toEqual(
      expect.arrayContaining(["connections", "connections-repair"]),
    );
    expect(repair.calls[0]!.prompt).toContain('"connections":{"movies":["/search"]}');
    folder.close();
  });
});

describe("an edit's smoke repair (A74, #368 review)", () => {
  it("A74 GEN-03: it is told the edit's new connections by path, keeps their samples, and stays within budget", async () => {
    const folder = await folderWithMovies();
    // A tool with no connections, active.
    const first = scripted(
      { stage: "intent", value: intent({ kind: "create" }) },
      {
        stage: "create",
        value: finder("movies", {
          code: { html: '<p id="text">Hi</p>', css: "", js: "" },
          connections: {},
        }),
      },
    );
    const made = await generate(folder, first.provider, DEFAULT_ROUTES, { request: "A page" });
    if (made.kind !== "candidate") throw new Error("Expected a candidate");
    const { activateVersion } = await import("../src/workspaces/index.ts");
    expect(activateVersion(folder, made.workspaceId, made.hash, made.expectedDataRevision).ok).toBe(
      true,
    );
    // An edit that adds movies, with two samples as long as a sample may be.
    const long = (path: string) => ({
      statusCode: 200,
      contentType: "text/plain",
      body: `${path} ${"x".repeat(CONNECTION_SAMPLE_LIMIT - path.length - 1)}`,
    });
    const movies = {
      movies: { samples: { "/search": long("/search"), "/details": long("/details") } },
    };
    let context: SmokeRepairContext | undefined;
    const second = scripted(
      { stage: "intent", value: intent({ kind: "edit", connections: ["movies"] }) },
      {
        stage: "edit",
        value: {
          outcome: "edit",
          summary: "Finds movies.",
          files: {
            mode: "replace",
            code: { html: '<p id="text">Movies</p>', css: "", js: js("movies") },
          },
          connections: { mode: "replace", connections: movies },
          data: { mode: "unchanged" },
        },
      },
    );
    const edited = await generate(
      folder,
      second.provider,
      DEFAULT_ROUTES,
      { request: "Find movies", workspaceId: made.workspaceId },
      undefined,
      (c) => {
        context = c;
      },
    );
    if (edited.kind !== "candidate" || !context) throw new Error("Expected a candidate");
    // The repair leaves connections out.
    const repair = scripted({
      stage: "repair",
      value: {
        outcome: "edit",
        summary: "Finds movies.",
        files: {
          mode: "replace",
          code: { html: '<p id="text">Films</p>', css: "", js: js("movies") },
        },
        data: { mode: "unchanged" },
      },
    });
    const repaired = await repairSmoke(
      folder,
      repair.provider,
      DEFAULT_ROUTES,
      {
        workspaceId: edited.workspaceId,
        hash: edited.hash,
        findings: ["Nothing showed."],
        failure: "smoke",
      },
      context,
    );
    expect(repaired).toMatchObject({ kind: "candidate", connections: movies });
    const call = repair.calls[0]!;
    expect(`${call.system}${call.prompt}`).not.toContain("x".repeat(100));
    expect(call.prompt).toContain('"connections":{"movies":["/details","/search"]}');
    expect(partsOf(call)).toContain("connections-repair");
    expect(call.system.length + call.prompt.length).toBeLessThanOrEqual(
      promptBudget("repair", true),
    );
    folder.close();
  });
});

describe("what a request gives a tool (A74)", () => {
  it("A74: the ones it uses stay; new ones join, if the person has them, up to three in all", async () => {
    const folder = await folderWithMovies();
    for (const name of ["a-one", "b-two", "c-three"]) {
      addConnection(folder, {
        name,
        origins: [`https://${name}.example.com`],
        auth: { kind: "none" },
        key: null,
      });
    }
    expect(toolConnections(folder, { connections: ["movies", "nobody"] }).allowed).toEqual([
      "movies",
    ]);
    const given = toolConnections(
      folder,
      { connections: ["a-one", "b-two", "c-three"] },
      uses("movies"),
    );
    expect(given.allowed).toEqual(["movies", "a-one", "b-two"]);
    expect(given.quoted.map((q) => q.name)).toEqual(["movies", "a-one", "b-two"]);
    // A connection it uses that the person removed is still allowed, but not quoted.
    const gone = toolConnections(folder, { connections: [] }, uses("removed-one"));
    expect(gone).toEqual({ allowed: ["removed-one"], quoted: [] });
    folder.close();
  });
});
