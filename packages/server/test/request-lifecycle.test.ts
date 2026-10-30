import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVATION_ROUTE,
  DEFAULT_ROUTES,
  GENERATE_ROUTE,
  SMOKE_REPAIR_ROUTE,
  activationReplySchema,
  generateReplySchema,
} from "@tessera/contracts";
import { generationRoutes } from "../src/generation/index.ts";
import { startLocalServer } from "../src/http/index.ts";
import { JobQueue } from "../src/jobs/index.ts";
import { createScriptedProvider } from "../src/providers/index.ts";
import { openDataFolder } from "../src/storage/index.ts";
import {
  activationRoutes,
  getWorkspace,
  readWorkspaceData,
  workspaceVersions,
} from "../src/workspaces/index.ts";
import { editFixture } from "./fixtures/edit-tool.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0)) await close();
});
async function fixture(copies = 1) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-request-lifecycle-"));
  const store = await openDataFolder(dir);
  const provider = createScriptedProvider({
    name: "lifecycle",
    replies: [
      ...Array.from(
        { length: copies },
        () =>
          [
            {
              kind: "value",
              stage: "intent",
              value: {
                kind: "create",
                interfacePart: null,
                dataPart: null,
                behaviorChange: false,
                lookOnly: false,
                targetsCurrentTool: false,
                language: "en",
                features: [] as string[],
              },
            },
            { kind: "value", stage: "create", value: editFixture },
          ] as const,
      ).flat(),
      {
        kind: "value",
        stage: "repair",
        value: { ...editFixture, code: { ...editFixture.code, css: "body{color:#222}" } },
      },
    ],
  });
  const options = {
    store,
    jobs: new JobQueue(),
    provider: () => Promise.resolve(provider),
    routes: () => DEFAULT_ROUTES,
    requestTimeLimitMs: 10_000,
  };
  const routes = generationRoutes(options);
  const server = await startLocalServer({ port: 0, routes });
  cleanup.push(async () => {
    await server.close();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const post = async (route: string, body: unknown) => {
    const response = await fetch(new URL(route, server.url), {
      method: "POST",
      headers: { origin: server.url.replace(/\/$/, ""), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const raw = await response.text();
    return {
      status: response.status,
      body: response.status === 200 ? (JSON.parse(raw) as unknown) : raw,
    };
  };
  const generated = generateReplySchema.parse(
    (await post(GENERATE_ROUTE, { request: "A list" })).body,
  );
  if (generated.kind !== "candidate") throw new Error("No candidate");
  const activation = (reply = generated) => ({
    workspaceId: reply.workspaceId,
    hash: reply.hash,
    expectedDataRevision: reply.expectedDataRevision,
    token: reply.activation.token,
  });
  const unit = () => ({
    workspace: getWorkspace(store, generated.workspaceId),
    data: readWorkspaceData(store, generated.workspaceId),
    history: workspaceVersions(store, generated.workspaceId),
  });
  return { generated, activation, post, unit, routes, options };
}
describe("request lifecycle authority", () => {
  it("GEN-11 DATA-10: expired candidates cannot activate, and missing authority never falls back", async () => {
    const f = await fixture();
    const before = f.unit();
    const clock = vi.spyOn(Date, "now").mockReturnValue(f.generated.activation.expiresAt);
    expect(
      activationReplySchema.parse((await f.post(ACTIVATION_ROUTE, f.activation())).body),
    ).toMatchObject({ ok: false, reason: "expired" });
    expect(f.unit()).toEqual(before);
    clock.mockRestore();
    expect((await f.post(ACTIVATION_ROUTE, { ...f.activation(), token: undefined })).status).toBe(
      400,
    );
    expect(
      activationReplySchema.parse((await f.post(ACTIVATION_ROUTE, f.activation())).body),
    ).toMatchObject({ ok: false, reason: "expired" });
    expect(f.unit()).toEqual(before);
  });
  it("GEN-11 DATA-10: token binds all fields, is one-use, and a concurrent replay cannot commit twice", async () => {
    const f = await fixture();
    const before = f.unit();
    for (const changed of [
      { hash: "0".repeat(64) },
      { workspaceId: "00000000-0000-4000-8000-000000000001" },
      { expectedDataRevision: 100 },
    ]) {
      expect(
        activationReplySchema.parse(
          (await f.post(ACTIVATION_ROUTE, { ...f.activation(), ...changed })).body,
        ),
      ).toMatchObject({ ok: false, reason: "expired" });
      expect(f.unit()).toEqual(before);
    }
    const replies = await Promise.all([
      f.post(ACTIVATION_ROUTE, f.activation()),
      f.post(ACTIVATION_ROUTE, f.activation()),
    ]);
    expect(replies.map((r) => activationReplySchema.parse(r.body).ok).sort()).toEqual([
      false,
      true,
    ]);
    expect(f.unit().history).toHaveLength(1);
  });
  it("GEN-11 GEN-09: smoke repair revokes the old token and retains the original expiry", async () => {
    const f = await fixture();
    const repaired = generateReplySchema.parse(
      (
        await f.post(SMOKE_REPAIR_ROUTE, {
          workspaceId: f.generated.workspaceId,
          hash: f.generated.hash,
          findings: ["The smoke check failed"],
        })
      ).body,
    );
    expect(repaired.kind).toBe("candidate");
    if (repaired.kind !== "candidate") return;
    expect(repaired.activation.expiresAt).toBe(f.generated.activation.expiresAt);
    expect(repaired.activation.token).not.toBe(f.generated.activation.token);
    expect(
      activationReplySchema.parse((await f.post(ACTIVATION_ROUTE, f.activation())).body),
    ).toMatchObject({ ok: false, reason: "expired" });
    expect(
      activationReplySchema.parse((await f.post(ACTIVATION_ROUTE, f.activation(repaired))).body),
    ).toMatchObject({ ok: true });
  });
  it("GEN-11: recreating the routes loses authority and denies old tokens", async () => {
    const f = await fixture();
    Object.assign(f.routes, generationRoutes(f.options));
    expect(
      activationReplySchema.parse((await f.post(ACTIVATION_ROUTE, f.activation())).body),
    ).toMatchObject({ ok: false, reason: "expired" });
  });
  it("GEN-11: standalone activation defaults to deny even for a stored candidate", async () => {
    const f = await fixture();
    const before = f.unit();
    Object.assign(f.routes, activationRoutes(f.options.store));
    expect(
      activationReplySchema.parse((await f.post(ACTIVATION_ROUTE, f.activation())).body),
    ).toMatchObject({ ok: false, reason: "expired" });
    expect(f.unit()).toEqual(before);
  });
  it("GEN-11: a later equal hash cannot revive expired authority", async () => {
    const f = await fixture(2);
    const clock = vi.spyOn(Date, "now").mockReturnValue(f.generated.activation.expiresAt + 1);
    const later = generateReplySchema.parse(
      (await f.post(GENERATE_ROUTE, { request: "A list" })).body,
    );
    expect(later.kind).toBe("candidate");
    if (later.kind !== "candidate") return;
    expect(later.hash).toBe(f.generated.hash);
    expect(later.activation.expiresAt).toBeGreaterThan(f.generated.activation.expiresAt);
    expect(
      activationReplySchema.parse((await f.post(ACTIVATION_ROUTE, f.activation())).body),
    ).toMatchObject({ ok: false, reason: "expired" });
    expect(
      activationReplySchema.parse((await f.post(ACTIVATION_ROUTE, f.activation(later))).body),
    ).toMatchObject({ ok: true });
    clock.mockRestore();
  });
  it("GEN-11: evicted authority fails closed while newer candidates remain eligible", async () => {
    const f = await fixture(101);
    let latest = f.generated;
    for (let i = 0; i < 100; i += 1) {
      const reply = generateReplySchema.parse(
        (await f.post(GENERATE_ROUTE, { request: "A list" })).body,
      );
      if (reply.kind !== "candidate") throw new Error("No candidate");
      latest = reply;
    }
    expect(
      activationReplySchema.parse((await f.post(ACTIVATION_ROUTE, f.activation())).body),
    ).toMatchObject({ ok: false, reason: "expired" });
    expect(
      activationReplySchema.parse((await f.post(ACTIVATION_ROUTE, f.activation(latest))).body),
    ).toMatchObject({ ok: true });
  });
});
