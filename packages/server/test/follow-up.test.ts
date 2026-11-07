import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CANCEL_REQUEST_ROUTE,
  DEFAULT_ROUTES,
  FOLLOW_UP_ROUTE,
  REGISTER_REQUEST_ROUTE,
  requestControlSchema,
  GENERATE_ROUTE,
  generateReplySchema,
  type GenerateReply,
  type Intent,
} from "@tessera/contracts";
import { generationRoutes } from "../src/generation/index.ts";
import { TWO_PASS_STARTING_POINT } from "../src/generation/two-pass.ts";
import { startLocalServer } from "../src/http/index.ts";
import { JobQueue } from "../src/jobs/index.ts";
import { createScriptedProvider, type Provider } from "../src/providers/index.ts";
import { openDataFolder } from "../src/storage/index.ts";
import { activateVersion, getWorkspace, workspaceVersions } from "../src/workspaces/index.ts";
import { editFixture, styleEdit } from "./fixtures/edit-tool.ts";

// A big tool's follow-up features (GEN-17): once the version before them is active, each comes as
// its own edit request, with the host's own intent and a request's whole time limit (GEN-11),
// asked for by the activated candidate's token, once; the rest are named as still to come.

const features = ["Items", "Ticking off", "Aisles", "Prices"].map((name) => ({
  name,
  request: `${name.toLowerCase()} please`,
}));
const intent: Intent = {
  kind: "create",
  interfacePart: null,
  dataPart: null,
  language: "pt-BR",
  features,
  targetsCurrentTool: false,
  behaviorChange: false,
  lookOnly: false,
};
/** An edit with its own look, so each one changes the tool. */
const edit = (summary: string) => ({
  ...styleEdit,
  summary,
  files: {
    mode: "replace" as const,
    code: { ...editFixture.code, css: `body{background:#111}/* ${summary} */` },
  },
});

const clean: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of clean.splice(0)) await close();
});

async function fixture(after: { stage: "edit"; value: unknown }[], limit = 420_000) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-follow-up-"));
  const store = await openDataFolder(dir);
  const scripted = createScriptedProvider({
    name: "follow-up",
    replies: [
      { kind: "value", stage: "intent", value: intent },
      { kind: "value", stage: "create", value: editFixture as never },
      ...after.map((reply) => ({ kind: "value" as const, ...reply, value: reply.value as never })),
    ],
  });
  const calls: { stage: string; prompt: string; limit: number }[] = [];
  const provider: Provider = {
    name: "capture",
    live: false,
    run(spec) {
      calls.push({ stage: spec.stage, prompt: spec.prompt, limit: spec.timeLimitMs });
      return scripted.run(spec);
    },
  };
  const server = await startLocalServer({
    port: 0,
    routes: generationRoutes({
      store,
      jobs: new JobQueue(),
      provider: () => Promise.resolve(provider),
      routes: () => DEFAULT_ROUTES,
      requestTimeLimitMs: limit,
      twoPass: TWO_PASS_STARTING_POINT,
    }),
  });
  clean.push(async () => {
    await server.close();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const post = async (route: string, value: unknown) => {
    const response = await fetch(new URL(route, server.url), {
      method: "POST",
      headers: { origin: server.url.replace(/\/$/, ""), "content-type": "application/json" },
      body: JSON.stringify(value),
    });
    expect(response.status).toBe(200);
    return generateReplySchema.parse(await response.json());
  };
  /** Any route's status and body, for the host app's control routes. */
  const raw = async (route: string, value: unknown = {}) => {
    const response = await fetch(new URL(route, server.url), {
      method: "POST",
      headers: { origin: server.url.replace(/\/$/, ""), "content-type": "application/json" },
      body: JSON.stringify(value),
    });
    return { status: response.status, body: (await response.json().catch(() => null)) as unknown };
  };
  /** A registered control, as the host app always sends one (CLI-06). */
  const register = async () =>
    requestControlSchema.parse((await raw(REGISTER_REQUEST_ROUTE)).body).token;
  /** Activates a candidate as staging would, and answers what asks for the next feature. */
  const activate = (reply: GenerateReply) => {
    if (reply.kind !== "candidate") throw new Error(`Expected a candidate, got ${reply.kind}`);
    expect(
      activateVersion(store, reply.workspaceId, reply.hash, reply.expectedDataRevision).ok,
    ).toBe(true);
    return { workspaceId: reply.workspaceId, hash: reply.hash, token: reply.activation.token };
  };
  return { store, post, raw, register, activate, calls };
}

describe("a big tool's follow-up features (GEN-17)", () => {
  it("GEN-17, GEN-11: adds each feature still to come as its own checked edit, in order, until none are left", async () => {
    const f = await fixture([
      { stage: "edit", value: edit("Added aisles.") },
      { stage: "edit", value: edit("Added prices.") },
    ]);
    const core = await f.post(GENERATE_ROUTE, { request: "A shopping list with four things" });
    expect(core).toMatchObject({ kind: "candidate", followUps: ["Aisles", "Prices"] });
    const first = await f.post(FOLLOW_UP_ROUTE, f.activate(core));
    expect(first).toMatchObject({
      kind: "candidate",
      operation: "edit",
      summary: "Added aisles.",
      followUps: ["Prices"],
    });
    const second = await f.post(FOLLOW_UP_ROUTE, f.activate(first));
    expect(second).toMatchObject({ kind: "candidate", summary: "Added prices." });
    expect(second).not.toHaveProperty("followUps");
    const done = f.activate(second);
    expect(workspaceVersions(f.store, done.workspaceId)).toHaveLength(3);
    // Nothing is left to ask for, and no intent call was spent on a feature.
    expect(await f.post(FOLLOW_UP_ROUTE, done)).toMatchObject({ kind: "failed" });
    expect(f.calls.map((c) => c.stage)).toEqual(["intent", "create", "edit", "edit"]);
    // Each edit is told its feature, as written, in the request's language.
    expect(f.calls[2]!.prompt).toContain("aisles please");
    expect(f.calls[2]!.prompt).toContain("pt-BR");
    expect(f.calls[3]!.prompt).toContain("prices please");
    expect(f.calls[2]!.limit).toBeGreaterThan(0);
  });

  it("GEN-17: is asked for once, only after the version before it is active, and never with another version", async () => {
    const f = await fixture([{ stage: "edit", value: edit("Added aisles.") }]);
    const core = await f.post(GENERATE_ROUTE, { request: "A shopping list with four things" });
    if (core.kind !== "candidate") throw new Error("Expected a candidate");
    const asked = { workspaceId: core.workspaceId, hash: core.hash, token: core.activation.token };
    // Before activation the version isn't the current one: nothing is made, and the turn is used.
    expect(await f.post(FOLLOW_UP_ROUTE, asked)).toEqual({ kind: "answer", answer: "stale" });
    expect(await f.post(FOLLOW_UP_ROUTE, asked)).toMatchObject({ kind: "failed" });
    expect(f.calls.map((c) => c.stage)).toEqual(["intent", "create"]);
    expect(getWorkspace(f.store, core.workspaceId)?.currentVersion).toBeNull();
  });

  it("GEN-17: a token from another request, or with another hash, adds nothing", async () => {
    const f = await fixture([]);
    const core = await f.post(GENERATE_ROUTE, { request: "A shopping list with four things" });
    const asked = f.activate(core);
    expect(
      await f.post(FOLLOW_UP_ROUTE, { ...asked, token: "00000000-0000-4000-8000-000000000000" }),
    ).toMatchObject({ kind: "failed" });
    expect(await f.post(FOLLOW_UP_ROUTE, { ...asked, hash: "0".repeat(64) })).toMatchObject({
      kind: "failed",
    });
    expect(f.calls.map((c) => c.stage)).toEqual(["intent", "create"]);
  });

  it("GEN-17, GEN-11: with a registered control, a follow-up asked after the core's own deadline is still its own request", async () => {
    const f = await fixture([{ stage: "edit", value: edit("Added aisles.") }], 600);
    const controlToken = await f.register();
    const core = await f.post(GENERATE_ROUTE, {
      request: "A shopping list with four things",
      controlToken,
    });
    if (core.kind !== "candidate") throw new Error("Expected a candidate");
    const asked = f.activate(core);
    // Past the core's deadline, within the follow-up's kept window.
    await new Promise((done) =>
      setTimeout(done, Math.max(0, core.activation.expiresAt - Date.now()) + 50),
    );
    const added = await f.raw(FOLLOW_UP_ROUTE, asked);
    expect(added.status).toBe(200);
    expect(added.body).toMatchObject({ kind: "candidate", summary: "Added aisles." });
  });

  it("GEN-17, CLI-06: Cancel after the core stops the features still to come", async () => {
    const f = await fixture([{ stage: "edit", value: edit("Added aisles.") }]);
    const controlToken = await f.register();
    const core = await f.post(GENERATE_ROUTE, {
      request: "A shopping list with four things",
      controlToken,
    });
    const asked = f.activate(core);
    expect((await f.raw(CANCEL_REQUEST_ROUTE, { token: controlToken })).body).toEqual({
      cancelled: true,
    });
    const refused = await f.raw(FOLLOW_UP_ROUTE, asked);
    expect(refused.status).toBe(409);
    expect(f.calls.map((c) => c.stage)).toEqual(["intent", "create"]);
  });
});
