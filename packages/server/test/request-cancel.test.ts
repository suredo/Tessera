import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVATION_ROUTE,
  CANCEL_REQUEST_ROUTE,
  CONFIRM_DATA_ROUTE,
  DEFAULT_ROUTES,
  FINISH_DATA_ROUTE,
  GENERATE_ROUTE,
  REGISTER_REQUEST_ROUTE,
  SMOKE_REPAIR_ROUTE,
  generateReplySchema,
  requestControlSchema,
  type Intent,
  type ProviderScript,
} from "@tessera/contracts";
import { candidateFrom, generationRoutes } from "../src/generation/index.ts";
import { RequestControls } from "../src/generation/control.ts";
import { startLocalServer } from "../src/http/index.ts";
import { JobQueue } from "../src/jobs/index.ts";
import { createScriptedProvider, type Provider } from "../src/providers/index.ts";
import { openDataFolder } from "../src/storage/index.ts";
import { saveVersion } from "../src/versions/index.ts";
import {
  activateVersion,
  createWorkspace,
  getWorkspace,
  listWorkspaces,
  workspaceVersions,
} from "../src/workspaces/index.ts";
import { editFixture, styleEdit } from "./fixtures/edit-tool.ts";

const clean: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of clean.splice(0)) await close();
});
const intent: Intent = {
  kind: "create",
  interfacePart: null,
  dataPart: null,
  language: "en",
  features: [],
  targetsCurrentTool: false,
  behaviorChange: false,
  lookOnly: false,
};
const creation: ProviderScript["replies"] = [
  { kind: "value", stage: "intent", value: intent },
  { kind: "value", stage: "create", value: editFixture },
];
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
async function fixture(
  replies = creation,
  wrap: (provider: Provider) => Provider = (p) => p,
  setup?: Promise<void>,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-cancel-"));
  const store = await openDataFolder(dir);
  const built = candidateFrom(editFixture);
  if (built.kind !== "candidate") throw new Error("Bad fixture");
  const workspace = createWorkspace(store, editFixture.name, { data: built.startingData });
  const hash = saveVersion(store.db, built.artifact);
  expect(activateVersion(store, workspace.id, hash, workspace.dataRevision).ok).toBe(true);
  const provider = wrap(createScriptedProvider({ name: "cancel", replies }));
  const jobs = new JobQueue();
  let discoveries = 0;
  const server = await startLocalServer({
    port: 0,
    routes: generationRoutes({
      store,
      jobs,
      routes: () => DEFAULT_ROUTES,
      provider: async () => {
        discoveries++;
        await setup;
        return provider;
      },
    }),
  });
  clean.push(async () => {
    await server.close();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const post = async (route: string, value: unknown = {}) => {
    const response = await fetch(new URL(route, server.url), {
      method: "POST",
      headers: { origin: server.url.replace(/\/$/, ""), "content-type": "application/json" },
      body: JSON.stringify(value),
    });
    const raw = await response.text();
    return {
      status: response.status,
      body: response.status === 200 ? (JSON.parse(raw) as unknown) : raw,
    };
  };
  const register = async () =>
    requestControlSchema.parse((await post(REGISTER_REQUEST_ROUTE)).body).token;
  const cancel = (token: string) => post(CANCEL_REQUEST_ROUTE, { token });
  const ask = (controlToken: string, active = false) =>
    post(GENERATE_ROUTE, {
      request: "Make it dark and add Bread",
      controlToken,
      ...(active ? { workspaceId: workspace.id } : {}),
    });
  const snapshot = () => ({
    workspace: getWorkspace(store, workspace.id),
    history: workspaceVersions(store, workspace.id),
  });
  return {
    store,
    id: workspace.id,
    jobs,
    post,
    register,
    cancel,
    ask,
    snapshot,
    discoveries: () => discoveries,
  };
}
describe("registered request cancellation", () => {
  it("CLI-06 CON-01: unknown, cancelled, expired and replayed registrations cannot start work", async () => {
    const f = await fixture();
    const unknown = randomUUID();
    expect((await f.cancel(unknown)).body).toEqual({ cancelled: false });
    expect((await f.ask(unknown)).status).toBe(409);
    const token = await f.register();
    expect((await f.cancel(token)).body).toEqual({ cancelled: true });
    expect((await f.ask(token)).status).toBe(409);
    const expired = await f.register();
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 420_001);
    expect((await f.ask(expired)).status).toBe(409);
    clock.mockRestore();
    const live = await f.register();
    expect((await f.ask(live)).status).toBe(200);
    expect((await f.ask(live)).status).toBe(409);
    expect(f.discoveries()).toBe(1);
    expect(f.jobs.jobs()).toHaveLength(1);
  });
  it("CLI-06: cancel during setup prevents a later queued submission", async () => {
    const setup = deferred();
    const f = await fixture(creation, (p) => p, setup.promise);
    const token = await f.register();
    const answer = f.ask(token);
    await vi.waitFor(() => expect(f.discoveries()).toBe(1));
    await f.cancel(token);
    setup.resolve();
    expect((await answer).status).toBe(409);
    expect(f.jobs.jobs()).toEqual([]);
  });
  it("CLI-06: queued cancellation records only that job and never calls its provider", async () => {
    const f = await fixture();
    const gate = deferred();
    const blocker = f.jobs.submit("Other request", () => gate.promise);
    const token = await f.register();
    const answer = f.ask(token);
    await vi.waitFor(() => expect(f.jobs.jobs()).toHaveLength(2));
    await f.cancel(token);
    expect(generateReplySchema.parse((await answer).body)).toMatchObject({
      kind: "failed",
      message: "The request was stopped.",
    });
    expect(f.jobs.jobs().map((j) => j.state)).toEqual(["running", "cancelled"]);
    gate.resolve();
    await blocker.outcome;
    expect(listWorkspaces(f.store)).toHaveLength(1);
  });
  it.each(["intent", "create"])(
    "CLI-06 GEN-11: running cancellation during %s waits for provider settlement and rejects late persistence",
    async (stage) => {
      const gate = deferred();
      const started = deferred();
      let signal: AbortSignal | undefined;
      const f = await fixture(creation, (p) => ({
        ...p,
        async run(spec) {
          const result = await p.run(spec); // Capture a valid result before deliberately ignoring abort.
          if (spec.stage !== stage) return result;
          signal = spec.signal;
          started.resolve();
          await gate.promise;
          return result;
        },
      }));
      const token = await f.register();
      const answer = f.ask(token);
      await started.promise;
      await f.cancel(token);
      expect(signal?.aborted).toBe(true);
      expect(f.jobs.jobs()[0]?.state).toBe("running");
      gate.resolve();
      expect(generateReplySchema.parse((await answer).body)).toMatchObject({ kind: "failed" });
      expect(f.jobs.jobs()[0]?.state).toBe("cancelled");
      expect(listWorkspaces(f.store)).toHaveLength(1);
    },
  );
  it("CLI-06 DATA-10: cancellation revokes staging authority without touching another equal-hash request", async () => {
    const f = await fixture([...creation, ...creation]);
    const firstToken = await f.register();
    const secondToken = await f.register();
    const first = generateReplySchema.parse((await f.ask(firstToken)).body);
    const second = generateReplySchema.parse((await f.ask(secondToken)).body);
    if (first.kind !== "candidate" || second.kind !== "candidate") throw new Error("No candidates");
    expect(first.hash).toBe(second.hash);
    await f.cancel(firstToken);
    const activate = (reply: typeof first) =>
      f.post(ACTIVATION_ROUTE, {
        workspaceId: reply.workspaceId,
        hash: reply.hash,
        expectedDataRevision: reply.expectedDataRevision,
        token: reply.activation.token,
      });
    expect((await activate(first)).body).toMatchObject({ ok: false });
    expect((await activate(second)).body).toMatchObject({ ok: true });
    await f.cancel(secondToken); // A completed activation remains committed.
    expect(getWorkspace(f.store, second.workspaceId)?.currentVersion).toBe(second.hash);
  });
  it("CLI-06 GEN-04 GEN-08: cancellation preserves activated mixed facts and revokes data/smoke continuations", async () => {
    const f = await fixture([
      {
        kind: "value",
        stage: "intent",
        value: {
          ...intent,
          kind: "mixed",
          interfacePart: "Make it dark",
          dataPart: "add Bread",
          targetsCurrentTool: true,
          lookOnly: true,
        },
      },
      { kind: "value", stage: "edit", value: styleEdit },
    ]);
    const token = await f.register();
    const reply = generateReplySchema.parse((await f.ask(token, true)).body);
    if (reply.kind !== "candidate") throw new Error("No candidate");
    const pair = { token: reply.activation.token, workspaceId: f.id, hash: reply.hash };
    expect(
      (
        await f.post(ACTIVATION_ROUTE, {
          ...pair,
          expectedDataRevision: reply.expectedDataRevision,
        })
      ).body,
    ).toMatchObject({ ok: true });
    const committed = f.snapshot();
    await f.cancel(token);
    expect((await f.post(FINISH_DATA_ROUTE, pair)).status).toBe(409);
    expect((await f.post(SMOKE_REPAIR_ROUTE, { ...pair, findings: ["Failed"] })).status).toBe(409);
    expect(f.snapshot()).toEqual(committed);
  });
  it("CLI-06 DATA-02 GEN-08: cancellation revokes a review but keeps completed data commits", async () => {
    for (const op of ["replace", "add"] as const) {
      const f = await fixture([
        {
          kind: "value",
          stage: "intent",
          value: { ...intent, kind: "data", targetsCurrentTool: true },
        },
        {
          kind: "value",
          stage: "data",
          value: {
            outcome: "patch",
            summary: "Changed entries.",
            patch: {
              operations: [
                op === "add"
                  ? { op, collection: "items", record: { title: "Bread" } }
                  : {
                      op,
                      collection: "items",
                      id: "i-1",
                      revisionCount: 999,
                      fields: { title: "Oat milk" },
                    },
              ],
            },
          },
        },
      ]);
      const token = await f.register();
      if (op === "add") {
        const submit = f.jobs.submit.bind(f.jobs);
        vi.spyOn(f.jobs, "submit").mockImplementation((request, work) =>
          submit(request, async (signal) => {
            const value = await work(signal);
            await f.cancel(token); // Cancellation reaches the route after commit, before its reply.
            return value;
          }),
        );
      }
      const reply = generateReplySchema.parse((await f.ask(token, true)).body);
      expect(reply.kind).toBe(op === "add" ? "data_changed" : "data_confirmation");
      const beforeCancel = f.snapshot();
      if (reply.kind === "data_confirmation") {
        const gate = deferred();
        const blocker = f.jobs.submit("Other request", () => gate.promise);
        const confirmation = f.post(CONFIRM_DATA_ROUTE, { token: reply.token, approve: true });
        await vi.waitFor(() => expect(f.jobs.jobs().at(-1)?.state).toBe("queued"));
        await f.cancel(token);
        expect((await confirmation).body).toMatchObject({ kind: "failed" });
        expect(f.jobs.jobs().at(-1)?.state).toBe("cancelled");
        gate.resolve();
        await blocker.outcome;
      }
      expect(f.snapshot()).toEqual(beforeCancel);
    }
  });
  it("CLI-06 GEN-09: a cancelled running smoke repair cannot mint replacement activation authority", async () => {
    const started = deferred();
    const gate = deferred();
    let signal: AbortSignal | undefined;
    const f = await fixture(
      [
        ...creation,
        {
          kind: "value",
          stage: "repair",
          value: { ...editFixture, code: { ...editFixture.code, css: "body{color:#222}" } },
        },
      ],
      (provider) => ({
        ...provider,
        async run(spec) {
          const result = await provider.run(spec);
          if (spec.stage === "repair") {
            signal = spec.signal;
            started.resolve();
            await gate.promise;
          }
          return result;
        },
      }),
    );
    const token = await f.register();
    const reply = generateReplySchema.parse((await f.ask(token)).body);
    if (reply.kind !== "candidate") throw new Error("No candidate");
    const before = getWorkspace(f.store, reply.workspaceId);
    const answer = f.post(SMOKE_REPAIR_ROUTE, {
      token: reply.activation.token,
      workspaceId: reply.workspaceId,
      hash: reply.hash,
      findings: ["Failed"],
    });
    await started.promise;
    await f.cancel(token);
    expect(signal?.aborted).toBe(true);
    gate.resolve();
    expect(generateReplySchema.parse((await answer).body)).toMatchObject({ kind: "failed" });
    expect(f.jobs.jobs().at(-1)?.state).toBe("cancelled");
    expect(getWorkspace(f.store, reply.workspaceId)).toEqual(before);
    expect(
      (
        await f.post(ACTIVATION_ROUTE, {
          token: reply.activation.token,
          workspaceId: reply.workspaceId,
          hash: reply.hash,
          expectedDataRevision: reply.expectedDataRevision,
        })
      ).body,
    ).toMatchObject({ ok: false });
  });
  it("CLI-06: registration capacity refuses without evicting active ownership, and expiry cleans up", () => {
    const revoke = vi.fn();
    const controls = new RequestControls(new JobQueue(), revoke);
    const tokens = Array.from({ length: 100 }, () => controls.register()!);
    const owner = controls.claim(tokens[0]!);
    controls.bind(owner, "candidate");
    expect(controls.register()).toBeUndefined();
    expect(controls.cancel(tokens[0]!)).toBe(true);
    expect(revoke).toHaveBeenCalledWith("candidate");
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 420_001);
    expect(controls.register()).toEqual(expect.any(String));
    expect(controls.owner("candidate")).toBeUndefined();
    expect(() => controls.claim(tokens[1]!)).toThrow();
  });
});
