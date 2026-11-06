import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  DEFAULT_ROUTES,
  GENERATE_ROUTE,
  generateReplySchema,
  type Intent,
  type ProviderScript,
} from "@tessera/contracts";
import { generationRoutes } from "../src/generation/index.ts";
import { startLocalServer } from "../src/http/index.ts";
import { JobQueue } from "../src/jobs/index.ts";
import { RequestLedger, UNATTACHED_REQUESTS_KEPT } from "../src/ledger/index.ts";
import { createScriptedProvider, type Provider } from "../src/providers/index.ts";
import { openDataFolder, type DataFolder } from "../src/storage/index.ts";
import { createWorkspace, listWorkspaces } from "../src/workspaces/index.ts";
import { editFixture } from "./fixtures/edit-tool.ts";

// The call ledger (OBS-01, GEN-10): every request and every model call it made, kept in the data
// folder, with unknown usage left unknown (CLI-04).

const clean: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of clean.splice(0).reverse()) await close();
});

async function folder(): Promise<DataFolder> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-ledger-"));
  const store = await openDataFolder(dir);
  clean.push(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return store;
}

const intent = (kind: Exclude<Intent["kind"], "open_saved">): Intent => ({
  kind,
  interfacePart: null,
  dataPart: null,
  language: "en",
  features: [],
  targetsCurrentTool: false,
  behaviorChange: false,
  lookOnly: false,
});

async function serve(store: DataFolder, replies: ProviderScript["replies"]) {
  const provider: Provider = createScriptedProvider({ name: "ledger", replies });
  const server = await startLocalServer({
    port: 0,
    routes: generationRoutes({
      store,
      jobs: new JobQueue(),
      routes: () => DEFAULT_ROUTES,
      provider: () => Promise.resolve(provider),
    }),
  });
  clean.push(() => server.close());
  return async (request: string) => {
    const response = await fetch(new URL(GENERATE_ROUTE, server.url), {
      method: "POST",
      headers: { origin: server.url.replace(/\/$/, ""), "content-type": "application/json" },
      body: JSON.stringify({ request }),
    });
    return generateReplySchema.parse(await response.json());
  };
}

describe("the call ledger (OBS-01, GEN-10)", () => {
  it("OBS-01 CLI-04: a creation keeps the request, attached to its new workspace, and each call with its stage, sizes, parts and usage", async () => {
    const store = await folder();
    const ask = await serve(store, [
      {
        kind: "value",
        stage: "intent",
        value: intent("create"),
        usage: { inputTokens: 1200, cachedInputTokens: 800, outputTokens: 90, durationMs: 3100 },
      },
      { kind: "value", stage: "create", value: editFixture },
    ]);
    const reply = await ask("A shopping list");
    expect(reply.kind).toBe("candidate");
    const workspace = listWorkspaces(store)[0]!;
    const [request, ...older] = new RequestLedger(store).forWorkspace(workspace.id);
    expect(older).toEqual([]);
    expect(request).toMatchObject({
      kind: "generate",
      workspaceId: workspace.id,
      outcome: "candidate",
      findings: [],
    });
    expect(request!.endedAt).not.toBeNull();
    expect(request!.calls.map((c) => [c.index, c.stage, c.outcome])).toEqual([
      [0, "intent", "ok"],
      [1, "create", "ok"],
    ]);
    const [first, second] = request!.calls;
    expect(first).toMatchObject({
      provider: "scripted:ledger",
      inputTokens: 1200,
      cachedInputTokens: 800,
      outputTokens: 90,
      durationMs: 3100,
    });
    expect(first!.promptChars).toBeGreaterThanOrEqual("A shopping list".length);
    expect(first!.systemChars).toBeGreaterThan(0);
    expect(first!.promptParts.length).toBeGreaterThan(0);
    expect(first!.model).not.toBe("");
    // The scripted provider's default usage is zero, so known; the ledger keeps what it is told.
    expect(second!.outputTokens).toBe(0);
  });

  it("GEN-10: a failed call keeps its kind, its plain message and the provider's own words; the request keeps what the person read", async () => {
    const store = await folder();
    const ask = await serve(store, [{ kind: "error", stage: "intent", error: "time_limit" }]);
    const reply = await ask("A shopping list");
    expect(reply.kind).toBe("failed");
    const ledger = new RequestLedger(store);
    // No workspace was made, so the request is kept unattached; find it by its call.
    const id = store.db.all(z.object({ id: z.string() }), "SELECT id FROM requests")[0]!.id;
    const request = ledger.request(id)!;
    expect(request).toMatchObject({ workspaceId: null, outcome: "failed" });
    expect(request.message).toBe(reply.kind === "failed" ? reply.message : "");
    expect(request.calls).toHaveLength(1);
    expect(request.calls[0]).toMatchObject({
      stage: "intent",
      outcome: "failed",
      error: "time_limit",
      message: "The script made this call fail (time_limit).",
    });
  });

  it("GEN-10: the findings a repair fixed are kept, though the request ends well", async () => {
    const store = await folder();
    const unsafe = {
      ...editFixture,
      code: { ...editFixture.code, js: `${editFixture.code.js}\neval("1");` },
    };
    const ask = await serve(store, [
      { kind: "value", stage: "intent", value: intent("create") },
      { kind: "value", stage: "create", value: unsafe },
      { kind: "value", stage: "repair", value: editFixture },
    ]);
    expect((await ask("A shopping list")).kind).toBe("candidate");
    const workspace = listWorkspaces(store)[0]!;
    const [request] = new RequestLedger(store).forWorkspace(workspace.id);
    expect(request).toMatchObject({ outcome: "candidate", findings: [] });
    expect(request!.calls.map((c) => [c.stage, c.outcome])).toEqual([
      ["intent", "ok"],
      ["create", "ok"],
      ["repair", "ok"],
    ]);
    // The static check's reason for the repair, in its own words, on the repair call.
    expect(request!.calls[0]!.diagnostics).toEqual([]);
    expect(request!.calls[2]!.diagnostics.join("\n")).toMatch(/eval/);
  });

  it("GEN-10: a mixed request keeps its entry part's outcome, message and findings", () => {
    return folder().then((store) => {
      const ledger = new RequestLedger(store);
      const workspace = createWorkspace(store, "List");
      const id = ledger.start("generate", workspace.id);
      ledger.finish(id, {
        kind: "mixed_data",
        workspaceId: workspace.id,
        name: "List",
        interface: { outcome: "unchanged" },
        data: {
          kind: "failed",
          failure: "static",
          message: "The entry changes weren't applied.",
          findings: ["items[2].title must be a string"],
        },
      });
      expect(ledger.request(id)).toMatchObject({
        outcome: "mixed_data:failed",
        message: "The entry changes weren't applied.",
        findings: ["items[2].title must be a string"],
      });
      const answered = ledger.start("data", workspace.id);
      ledger.finish(answered, { kind: "answer", answer: "clarify", reason: "Which list?" });
      expect(ledger.request(answered)).toMatchObject({ outcome: "answer", message: "Which list?" });
    });
  });

  it("CLI-04 GEN-10: unknown usage stays unknown, a crash is kept apart from a model failure, and a bad write never stops the call", async () => {
    const store = await folder();
    const errors: unknown[] = [];
    const ledger = new RequestLedger(store, (e) => errors.push(e));
    const id = ledger.start("generate");
    const spec = {
      stage: "intent" as const,
      system: "rules",
      prompt: "hello",
      schema: z.unknown(),
      model: "m",
      effort: "low" as const,
      tools: "none" as const,
      timeLimitMs: 1000,
    };
    const crashing = ledger.record(id, {
      name: "broken",
      live: false,
      run: () => Promise.reject(new TypeError("boom")),
    });
    await expect(crashing.run(spec)).rejects.toThrow("boom");
    const unknown = ledger.record(id, {
      name: "quiet",
      live: false,
      run: () =>
        Promise.resolve({
          value: null as never,
          raw: "null",
          usage: {
            inputTokens: null,
            cachedInputTokens: null,
            outputTokens: null,
            durationMs: null,
          },
        }),
    });
    await unknown.run(spec);
    const calls = ledger.request(id)!.calls;
    expect(calls.map((c) => c.outcome)).toEqual(["crashed", "ok"]);
    expect(calls[0]).toMatchObject({ message: "boom", inputTokens: null });
    expect(calls[1]).toMatchObject({
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      durationMs: null,
      promptChars: 5,
      systemChars: 5,
    });
    // A record that can't be written is reported, and the request carries on.
    store.db.exec("DROP TABLE request_calls");
    await expect(unknown.run(spec)).resolves.toMatchObject({ value: null });
    expect(errors).toHaveLength(1);
  });

  it("OBS-01: a request goes with its workspace, an unknown workspace leaves it unattached, and only the newest unattached ones are kept", async () => {
    const store = await folder();
    const ledger = new RequestLedger(store);
    const workspace = createWorkspace(store, "List");
    const kept = ledger.start("generate", workspace.id);
    const stray = ledger.start("repair", "00000000-0000-4000-8000-000000000009");
    expect(ledger.request(stray)!.workspaceId).toBeNull();
    expect(ledger.forWorkspace(workspace.id).map((r) => r.id)).toEqual([kept]);
    store.db.run("DELETE FROM workspaces WHERE id = ?", workspace.id);
    expect(ledger.request(kept)).toBeUndefined();
    for (let i = 0; i < UNATTACHED_REQUESTS_KEPT; i++) ledger.start("generate");
    const last = ledger.start("generate");
    ledger.finish(last, { kind: "answer", answer: "clarify" });
    expect(ledger.request(stray)).toBeUndefined();
    expect(ledger.request(last)).toMatchObject({ outcome: "answer" });
    const count = store.db.get(
      z.object({ n: z.number() }),
      "SELECT COUNT(*) AS n FROM requests",
    )!.n;
    expect(count).toBe(UNATTACHED_REQUESTS_KEPT);
  });
});
