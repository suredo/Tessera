import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_ROUTES,
  GENERATE_ROUTE,
  SMOKE_REPAIR_ROUTE,
  generateReplySchema,
  TOOL_DATA_LIMIT_BYTES,
  type Creation,
  type Intent,
} from "@tessera/contracts";
import { afterAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { generate, generationRoutes } from "../src/generation/index.ts";
import { repairSmoke, type SmokeRepairContext } from "../src/generation/smoke.ts";
import { withinRequestDeadline } from "../src/generation/deadline.ts";
import { workspaceTools } from "../src/host/index.ts";
import { startLocalServer } from "../src/http/index.ts";
import { JobQueue } from "../src/jobs/index.ts";
import { createScriptedProvider, RoutesError, type Provider } from "../src/providers/index.ts";
import { openDataFolder } from "../src/storage/index.ts";
import { loadVersion, saveVersion } from "../src/versions/index.ts";
import {
  activateVersion,
  createWorkspace,
  getWorkspace,
  listWorkspaces,
  replaceData,
  saveTool,
} from "../src/workspaces/index.ts";

// A request carried out as far as the server goes (GEN-01): intent, then create, then the
// candidate stored with its workspace and starting data (GEN-05), ready to stage. Answers come
// from scripts (ENG-11); every data folder is a new temporary one (ENG-19).

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const newFolder = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-pipeline-"));
  temps.push(dir);
  return openDataFolder(dir);
};

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "prompts");
const part = (name: string) =>
  fs.readFileSync(path.join(fixtures, `shopping-list.${name}.txt`), "utf8");
const listSchema = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "title"],
        properties: { id: { type: "string" }, title: { type: "string" } },
      },
    },
  },
};
const tool: Creation = {
  outcome: "tool",
  name: "Shopping list",
  summary: "A list to tick off at the store.",
  code: { html: part("html"), css: part("css"), js: part("js") },
  data: {
    schema: listSchema,
    reusableDefaults: { items: [] },
    initialState: { items: [{ id: "i-1", title: "Milk" }] },
  },
  capabilities: [],
  uiMode: "standard",
};
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
const script = (...replies: unknown[]) =>
  createScriptedProvider({ name: "pipeline", replies: replies as never });
const intentReply = (fields: Partial<Intent> & { kind: Intent["kind"] }) => ({
  kind: "value",
  stage: "intent",
  value: intent(fields),
});
const createReply = (value: unknown) => ({ kind: "value", stage: "create", value });
const repairReply = (value: unknown) => ({ kind: "value", stage: "repair", value });

describe("carrying out a request (GEN-01, GEN-05)", () => {
  it("GEN-11 GEN-08: a synchronous commit begun within budget keeps its candidate when the clock crosses expiry", async () => {
    const folder = await newFolder();
    let now = Date.now();
    const expires = now + 100_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    const database = { ...folder.db };
    folder.db.transaction = (work) => {
      const result = database.transaction(work);
      now = expires + 1;
      return result;
    };
    try {
      const reply = await withinRequestDeadline(
        script(intentReply({ kind: "create" }), createReply(tool)),
        expires,
        (bounded, signal, beforeStore) =>
          generate(
            folder,
            bounded,
            DEFAULT_ROUTES,
            { request: "A list" },
            signal,
            undefined,
            beforeStore,
          ),
        new AbortController().signal,
      );
      expect(reply.kind).toBe("candidate");
      if (reply.kind !== "candidate") throw new Error("Expected committed candidate");
      expect(listWorkspaces(folder)).toMatchObject([
        { id: reply.workspaceId, data: tool.data.initialState },
      ]);
    } finally {
      clock.mockRestore();
      folder.close();
    }
  });

  it("GEN-09: smoke repair retains earlier class budgets and quotes the stored answer with the original language", async () => {
    const folder = await newFolder();
    let context: SmokeRepairContext | undefined;
    const unsafe = { ...tool, code: { ...tool.code, html: '<iframe src="x"></iframe>' } };
    await generate(
      folder,
      script(
        intentReply({ kind: "create", language: "pt-BR" }),
        createReply(unsafe),
        repairReply(tool),
      ),
      DEFAULT_ROUTES,
      { request: "Uma lista de compras" },
      undefined,
      (c) => {
        context = c;
      },
    );
    if (!context) throw new Error("Expected continuation");
    expect(context.repairUsage).toEqual({ static: 1 });
    let calls = 0;
    const scripted = script(repairReply(unsafe));
    const result = await repairSmoke(
      folder,
      {
        ...scripted,
        async run(spec) {
          calls++;
          expect(spec.stage).toBe("repair");
          expect(spec.timeLimitMs).toBe(180_000);
          expect(spec.promptParts?.some((p) => p.startsWith("repair-smoke@"))).toBe(true);
          expect(spec.prompt).toContain("pt-BR");
          expect(spec.prompt).toContain(tool.code.js);
          expect(spec.prompt).toContain("The tool shows nothing.");
          return scripted.run(spec);
        },
      },
      DEFAULT_ROUTES,
      {
        workspaceId: context.reply.workspaceId,
        hash: context.reply.hash,
        findings: ["The tool shows nothing."],
      },
      context,
    );
    expect(result).toMatchObject({ kind: "failed", failure: "static" });
    expect(calls).toBe(1);
    folder.close();
  });

  it("GEN-09, GEN-05: changed workspaces and data declarations are refused, and provider failures get no repair", async () => {
    for (const scenario of ["stale", "data", "provider"] as const) {
      const folder = await newFolder();
      let context: SmokeRepairContext | undefined;
      await generate(
        folder,
        script(intentReply({ kind: "create" }), createReply(tool)),
        DEFAULT_ROUTES,
        { request: "A shopping list" },
        undefined,
        (c) => {
          context = c;
        },
      );
      if (!context) throw new Error("Expected continuation");
      const request = {
        workspaceId: context.reply.workspaceId,
        hash: context.reply.hash,
        findings: ["No label"],
      };
      if (scenario === "stale")
        replaceData(folder, getWorkspace(folder, request.workspaceId)!, { items: [] });
      const before = getWorkspace(folder, request.workspaceId);
      const changed = {
        ...tool,
        data: {
          ...tool.data,
          reusableDefaults: { items: [{ id: "x", title: "Changed" }] },
          initialState: {},
        },
      };
      const provider =
        scenario === "provider"
          ? script({ kind: "error", stage: "repair", error: "time_limit" })
          : script(repairReply(changed));
      const result = await repairSmoke(folder, provider, DEFAULT_ROUTES, request, context);
      expect(result).toMatchObject({
        kind: "failed",
        failure: scenario === "provider" ? "provider" : "smoke",
      });
      expect(getWorkspace(folder, request.workspaceId)).toEqual(before);
      folder.close();
    }
  });

  it("GEN-01, GEN-05: a new tool is stored with a workspace holding its starting data, ready to stage", async () => {
    const folder = await newFolder();
    const provider = script(intentReply({ kind: "create" }), createReply(tool));
    const reply = await generate(folder, provider, DEFAULT_ROUTES, { request: "A shopping list" });
    expect(reply).toMatchObject({
      kind: "candidate",
      name: "Shopping list",
      summary: "A list to tick off at the store.",
      capabilities: [],
      syntheticData: { items: [] },
      expectedDataRevision: 1,
    });
    if (reply.kind !== "candidate") return;
    const workspace = getWorkspace(folder, reply.workspaceId)!;
    expect(workspace).toMatchObject({
      title: "Shopping list",
      currentVersion: null,
      data: { items: [{ id: "i-1", title: "Milk" }] },
    });
    expect(loadVersion(folder.db, reply.hash)?.kind).toBe("ok");
    expect(reply.mountId).toBe(`v-${reply.hash}`);
    // The candidate is served for staging, and its activation keeps the starting data.
    expect(workspaceTools(folder)(reply.mountId)?.code.html).toBe(
      tool.outcome === "tool" && tool.code.html,
    );
    const activated = activateVersion(
      folder,
      reply.workspaceId,
      reply.hash,
      reply.expectedDataRevision,
    );
    expect(activated.ok && activated.workspace.data).toEqual({
      items: [{ id: "i-1", title: "Milk" }],
    });
    folder.close();
  });

  it("GEN-01: an open workspace with no tool yet becomes the new tool's", async () => {
    const folder = await newFolder();
    const empty = createWorkspace(folder, "New chat");
    const provider = script(intentReply({ kind: "create" }), createReply(tool));
    const reply = await generate(folder, provider, DEFAULT_ROUTES, {
      request: "A shopping list",
      workspaceId: empty.id,
    });
    expect(reply).toMatchObject({ kind: "candidate", workspaceId: empty.id });
    expect(getWorkspace(folder, empty.id)?.title).toBe("Shopping list");
    expect(listWorkspaces(folder)).toHaveLength(1);
    folder.close();
  });

  it("DATA-06: starting data larger than a tool may hold stores nothing, in a new or an empty open workspace", async () => {
    const folder = await newFolder();
    const empty = createWorkspace(folder, "New chat");
    const big = {
      ...tool,
      data: {
        schema: { type: "object", properties: { note: { type: "string" } } },
        reusableDefaults: { note: "" },
        initialState: { note: "x".repeat(TOOL_DATA_LIMIT_BYTES + 1) },
      },
    };
    for (const workspaceId of [undefined, empty.id]) {
      const reply = await generate(
        folder,
        // Repaired once, as its class allows, and still too big (GEN-09).
        script(intentReply({ kind: "create" }), createReply(big), repairReply(big)),
        DEFAULT_ROUTES,
        { request: "A note", workspaceId },
      );
      expect(reply).toMatchObject({ kind: "failed", failure: "schema-shape" });
    }
    expect(listWorkspaces(folder)).toHaveLength(1);
    expect(getWorkspace(folder, empty.id)).toMatchObject({ title: "New chat", data: null });
    expect(
      folder.db.get(z.object({ n: z.number() }), "SELECT COUNT(*) AS n FROM tool_versions")?.n,
    ).toBe(0);
    folder.close();
  });

  it("GEN-01: answers that make no tool reach the host as they are, and store nothing", async () => {
    const folder = await newFolder();
    for (const kind of ["clarify", "unsupported"] as const) {
      expect(
        await generate(folder, script(intentReply({ kind })), DEFAULT_ROUTES, { request: "x" }),
      ).toEqual({
        kind: "answer",
        answer: kind,
      });
    }
    const cannot = await generate(
      folder,
      script(
        intentReply({ kind: "create" }),
        createReply({ outcome: "cannot", reason: "Booking needs the internet." }),
      ),
      DEFAULT_ROUTES,
      { request: "Book a table" },
    );
    expect(cannot).toEqual({
      kind: "answer",
      answer: "cannot",
      reason: "Booking needs the internet.",
    });
    expect(listWorkspaces(folder)).toEqual([]);
    folder.close();
  });

  it("GEN-18: a listed saved tool is offered to open", async () => {
    const folder = await newFolder();
    const workspace = createWorkspace(folder, "Errands");
    const saved = saveTool(folder, workspace.id, "Weekly errands");
    const reply = await generate(
      folder,
      script(intentReply({ kind: "open_saved", savedToolId: saved.id, targetsCurrentTool: false })),
      DEFAULT_ROUTES,
      { request: "Open my errands" },
    );
    expect(reply).toEqual({ kind: "open_saved", savedToolId: saved.id });
    folder.close();
  });

  it("GEN-01: a chat data change isn't carried out yet, and changes nothing", async () => {
    const folder = await newFolder();
    const workspace = createWorkspace(folder, "Shopping list");
    const hash = saveVersion(folder.db, {
      contractVersion: 2,
      code: { html: "<p>List</p>", css: "", js: "" },
      data: { schemaVersion: 1, schema: listSchema, defaults: { items: [] }, migrations: [] },
      capabilities: [],
      pins: [],
      ui: { standardVersion: 1, mode: "standard" },
    });
    expect(activateVersion(folder, workspace.id, hash, 0).ok).toBe(true);
    const provider = script(intentReply({ kind: "data", dataPart: "Add milk" }));
    const reply = await generate(folder, provider, DEFAULT_ROUTES, {
      request: "Make it calmer",
      workspaceId: workspace.id,
    });
    expect(reply).toEqual({ kind: "answer", answer: "not_yet" });
    expect(getWorkspace(folder, workspace.id)?.currentVersion).toBe(hash);
    folder.close();
  });

  it("GEN-09: a candidate repaired after failing the host's checks is stored as its repair made it", async () => {
    const folder = await newFolder();
    const failing = { ...tool, code: { html: '<iframe src="x"></iframe>', css: "", js: "" } };
    const reply = await generate(
      folder,
      script(intentReply({ kind: "create" }), createReply(failing), repairReply(tool)),
      DEFAULT_ROUTES,
      { request: "A shopping list" },
    );
    expect(reply).toMatchObject({ kind: "candidate", name: "Shopping list" });
    if (reply.kind !== "candidate") return;
    expect(workspaceTools(folder)(reply.mountId)?.code.html).toBe(
      tool.outcome === "tool" && tool.code.html,
    );
    expect(listWorkspaces(folder)).toHaveLength(1);
    folder.close();
  });

  it("GEN-09: a candidate that still fails the host's checks after its repair stores nothing, and says so plainly", async () => {
    const folder = await newFolder();
    const failing = { ...tool, code: { html: '<iframe src="x"></iframe>', css: "", js: "" } };
    const reply = await generate(
      folder,
      script(intentReply({ kind: "create" }), createReply(failing), repairReply(failing)),
      DEFAULT_ROUTES,
      { request: "A shopping list" },
    );
    expect(reply).toMatchObject({
      kind: "failed",
      failure: "static",
      message: "The tool Tessera made didn't pass its checks, so nothing was changed.",
    });
    expect(reply.kind === "failed" && reply.findings.length).toBeGreaterThan(0);
    expect(listWorkspaces(folder)).toEqual([]);
    folder.close();
  });

  it("CLI-05: a provider failure in either stage is a provider failure, in its own plain words", async () => {
    const folder = await newFolder();
    for (const replies of [
      [{ kind: "error", stage: "intent", error: "usage_limit" }],
      [intentReply({ kind: "create" }), { kind: "error", stage: "create", error: "sign_in" }],
    ]) {
      const reply = await generate(folder, script(...replies), DEFAULT_ROUTES, { request: "x" });
      expect(reply).toMatchObject({ kind: "failed", failure: "provider" });
      expect(generateReplySchema.parse(reply)).toEqual(reply);
    }
    expect(listWorkspaces(folder)).toEqual([]);
    folder.close();
  });
});

describe("the generate route (GEN-01, CLI-06)", () => {
  type Answer = { status: number; body: string };
  const send = (
    port: number,
    method: string,
    body?: string,
    route = GENERATE_ROUTE,
  ): Promise<Answer> =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: route,
          method,
          headers: { origin: `http://127.0.0.1:${port}`, "content-type": "application/json" },
        },
        (res) => {
          let text = "";
          res.setEncoding("utf8").on("data", (chunk: string) => (text += chunk));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
        },
      );
      req.on("error", reject);
      req.end(body);
    });

  it.each([false, true])(
    "GEN-11: shared deadline stops %s smoke repair or static repair without storing a late answer",
    async (smoke) => {
      const folder = await newFolder();
      let now = Date.now();
      const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
      const unsafe = { ...tool, code: { ...tool.code, html: '<iframe src="x"></iframe>' } };
      const scripted = script(
        intentReply({ kind: "create" }),
        createReply(smoke ? tool : unsafe),
        repairReply(
          smoke
            ? {
                ...tool,
                code: { ...tool.code, html: "<h1>Fixed</h1>" },
                data: { ...tool.data, initialState: {} },
              }
            : tool,
        ),
      );
      const limits: number[] = [];
      const provider: Provider = {
        name: "clocked",
        live: false,
        async run(spec) {
          limits.push(spec.timeLimitMs);
          const answer = await scripted.run(spec);
          now += spec.stage === "repair" ? 21_000 : 40_000;
          return answer;
        },
      };
      const server = await startLocalServer({
        port: 0,
        routes: generationRoutes({
          store: folder,
          jobs: new JobQueue(),
          provider: () => Promise.resolve(provider),
          routes: () => DEFAULT_ROUTES,
          requestTimeLimitMs: 100_000,
        }),
      });
      try {
        let reply = generateReplySchema.parse(
          JSON.parse((await send(server.port, "POST", JSON.stringify({ request: "A list" }))).body),
        );
        if (smoke) {
          const initial = generateReplySchema.parse(reply);
          if (initial.kind !== "candidate") throw new Error("Expected candidate");
          const before = getWorkspace(folder, initial.workspaceId);
          now += 5_000; // Time spent staging consumes the same request budget.
          const repair = JSON.stringify({
            workspaceId: initial.workspaceId,
            hash: initial.hash,
            findings: ["Blank"],
          });
          reply = generateReplySchema.parse(
            JSON.parse((await send(server.port, "POST", repair, SMOKE_REPAIR_ROUTE)).body),
          );
          expect(getWorkspace(folder, initial.workspaceId)).toEqual(before);
          expect(
            JSON.parse((await send(server.port, "POST", repair, SMOKE_REPAIR_ROUTE)).body),
          ).toMatchObject({ kind: "failed", failure: "smoke" });
        } else expect(listWorkspaces(folder)).toEqual([]);
        expect(reply).toMatchObject({
          kind: "failed",
          failure: "provider",
          message: "The request took too long. Please try again.",
        });
        expect(limits).toEqual([60_000, 60_000, smoke ? 15_000 : 20_000]);
      } finally {
        clock.mockRestore();
        await server.close();
        folder.close();
      }
    },
  );

  it("GEN-09, GEN-05: smoke repair uses the stored candidate once and preserves starting data", async () => {
    const folder = await newFolder();
    const provider = script(
      intentReply({ kind: "create" }),
      createReply(tool),
      repairReply({
        ...tool,
        code: { ...tool.code, html: "<h1>Repaired list</h1>" },
        data: { ...tool.data, initialState: {} },
      }),
    );
    const server = await startLocalServer({
      port: 0,
      routes: generationRoutes({
        store: folder,
        jobs: new JobQueue({ atOnce: 2 }),
        provider: () => Promise.resolve(provider),
        routes: () => DEFAULT_ROUTES,
      }),
    });
    try {
      const initial = generateReplySchema.parse(
        JSON.parse(
          (await send(server.port, "POST", JSON.stringify({ request: "A shopping list" }))).body,
        ),
      );
      if (initial.kind !== "candidate") throw new Error("Expected initial candidate");
      const before = getWorkspace(folder, initial.workspaceId)!;
      const request = JSON.stringify({
        workspaceId: initial.workspaceId,
        hash: initial.hash,
        findings: ["The tool shows nothing."],
      });
      const answers = await Promise.all([
        send(server.port, "POST", request, SMOKE_REPAIR_ROUTE),
        send(server.port, "POST", request, SMOKE_REPAIR_ROUTE),
      ]);
      const replies = answers.map((answer) => generateReplySchema.parse(JSON.parse(answer.body)));
      const repaired = replies.find((reply) => reply.kind === "candidate");
      expect(replies.filter((reply) => reply.kind === "failed")).toMatchObject([
        { kind: "failed", failure: "smoke" },
      ]);
      expect(repaired).toMatchObject({
        kind: "candidate",
        workspaceId: initial.workspaceId,
        expectedDataRevision: before.dataRevision,
      });
      expect(getWorkspace(folder, initial.workspaceId)).toEqual(before);
      expect(listWorkspaces(folder)).toHaveLength(1);
      if (repaired?.kind !== "candidate") throw new Error("Expected repaired candidate");
      expect(repaired.hash).not.toBe(initial.hash);
      expect(
        JSON.parse((await send(server.port, "POST", request, SMOKE_REPAIR_ROUTE)).body),
      ).toMatchObject({ kind: "failed", failure: "smoke" });
      expect(
        JSON.parse(
          (
            await send(
              server.port,
              "POST",
              JSON.stringify({
                workspaceId: repaired.workspaceId,
                hash: repaired.hash,
                findings: ["Still broken"],
              }),
              SMOKE_REPAIR_ROUTE,
            )
          ).body,
        ),
      ).toMatchObject({ kind: "failed", failure: "smoke" });
      expect(
        activateVersion(folder, repaired.workspaceId, repaired.hash, repaired.expectedDataRevision),
      ).toMatchObject({ ok: true, workspace: { data: before.data } });
      expect((await send(server.port, "POST", "{}", SMOKE_REPAIR_ROUTE)).status).toBe(400);
      expect((await send(server.port, "GET", undefined, SMOKE_REPAIR_ROUTE)).status).toBe(405);
    } finally {
      await server.close();
      folder.close();
    }
  });

  it("GEN-01: answers a request with its outcome, as a job; refuses other methods and empty requests", async () => {
    const folder = await newFolder();
    const jobs = new JobQueue();
    const server = await startLocalServer({
      port: 0,
      routes: generationRoutes({
        store: folder,
        jobs,
        provider: () => Promise.resolve(script(intentReply({ kind: "create" }), createReply(tool))),
        routes: () => DEFAULT_ROUTES,
      }),
    });
    try {
      const answer = await send(
        server.port,
        "POST",
        JSON.stringify({ request: "A shopping list" }),
      );
      expect(answer.status).toBe(200);
      expect(generateReplySchema.parse(JSON.parse(answer.body))).toMatchObject({
        kind: "candidate",
      });
      expect(jobs.jobs()).toMatchObject([{ request: "A shopping list", state: "done" }]);
      expect((await send(server.port, "GET")).status).toBe(405);
      expect((await send(server.port, "POST", JSON.stringify({ request: "  " }))).status).toBe(400);
    } finally {
      await server.close();
      folder.close();
    }
  });

  it("PLAT-03, CLI-09: a setup problem or an unusable routes file is answered in plain words, with no call", async () => {
    const folder = await newFolder();
    const server = await startLocalServer({
      port: 0,
      routes: {
        ...generationRoutes({
          store: folder,
          jobs: new JobQueue(),
          provider: () => Promise.resolve({ problem: "Claude Code isn't signed in." }),
          routes: () => DEFAULT_ROUTES,
        }),
      },
    });
    try {
      const answer = await send(server.port, "POST", JSON.stringify({ request: "A list" }));
      expect(JSON.parse(answer.body)).toEqual({
        kind: "failed",
        failure: "provider",
        message: "Claude Code isn't signed in.",
        findings: [],
      });
    } finally {
      await server.close();
    }
    const unusable = await startLocalServer({
      port: 0,
      routes: generationRoutes({
        store: folder,
        jobs: new JobQueue(),
        provider: () => Promise.resolve(script()),
        routes: () => {
          throw new RoutesError("Tessera can't use the model settings in routes.json.");
        },
      }),
    });
    try {
      const answer = await send(unusable.port, "POST", JSON.stringify({ request: "A list" }));
      expect(JSON.parse(answer.body)).toMatchObject({
        message: "Tessera can't use the model settings in routes.json.",
      });
    } finally {
      await unusable.close();
      folder.close();
    }
  });
});
