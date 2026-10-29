import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONFIRM_DATA_ROUTE,
  DEFAULT_ROUTES,
  FINISH_DATA_ROUTE,
  GENERATE_ROUTE,
  SMOKE_REPAIR_ROUTE,
  generateReplySchema,
  type Intent,
} from "@tessera/contracts";
import { candidateFrom, generationRoutes } from "../src/generation/index.ts";
import { startLocalServer } from "../src/http/index.ts";
import { JobQueue } from "../src/jobs/index.ts";
import { createScriptedProvider, type Provider } from "../src/providers/index.ts";
import { openDataFolder } from "../src/storage/index.ts";
import { saveVersion } from "../src/versions/index.ts";
import {
  activateVersion,
  createWorkspace,
  getWorkspace,
  workspaceVersions,
} from "../src/workspaces/index.ts";
import { editFixture, noEdit, quantityEdit, styleEdit } from "./fixtures/edit-tool.ts";

const intent: Intent = {
  kind: "mixed",
  interfacePart: "Show quantities",
  dataPart: "Set Milk quantity to 2",
  language: "en",
  features: [],
  targetsCurrentTool: true,
  behaviorChange: true,
  lookOnly: false,
};
const add = {
  outcome: "patch",
  summary: "Add Bread.",
  patch: { operations: [{ op: "add", collection: "items", record: { title: "Bread" } }] },
};
const clean: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of clean.splice(0)) await close();
  vi.restoreAllMocks();
});
async function fixture(
  replies: { stage: "intent" | "edit" | "repair" | "data"; value: unknown }[],
  fields: Partial<Intent> = {},
  limit = 420_000,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-mixed-"));
  const store = await openDataFolder(dir);
  const built = candidateFrom(editFixture);
  if (built.kind !== "candidate") throw new Error("Bad fixture");
  const workspace = createWorkspace(store, editFixture.name, { data: built.startingData });
  const hash = saveVersion(store.db, built.artifact);
  expect(activateVersion(store, workspace.id, hash, workspace.dataRevision).ok).toBe(true);
  const scripted = createScriptedProvider({
    name: "mixed",
    replies: [
      { kind: "value", stage: "intent", value: { ...intent, ...fields } },
      ...replies.map((reply) => ({
        kind: "value" as const,
        ...reply,
        value: reply.value as never,
      })),
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
  const ask = () =>
    post(GENERATE_ROUTE, {
      workspaceId: workspace.id,
      request: `${fields.interfacePart ?? intent.interfacePart} and ${fields.dataPart ?? intent.dataPart}`,
    });
  return { store, id: workspace.id, hash, post, ask, calls };
}
const setQuantity = {
  outcome: "patch",
  summary: "Set Milk quantity to 2.",
  patch: {
    operations: [
      {
        op: "replace",
        collection: "items",
        id: "i-1",
        revisionCount: 999,
        fields: { quantity: 2 },
      },
    ],
  },
};

describe("mixed request sequencing", () => {
  it("GEN-04 DATA-02: equal candidate hashes cannot replace another request's data instructions", async () => {
    const f = await fixture(
      [
        { stage: "edit", value: styleEdit },
        {
          stage: "intent",
          value: { ...intent, interfacePart: "Make it dark", dataPart: "Add Cheese" },
        },
        { stage: "edit", value: styleEdit },
        { stage: "data", value: add },
      ],
      { interfacePart: "Make it dark", dataPart: "Add Bread" },
    );
    const first = await f.ask();
    if (first.kind !== "candidate") throw new Error("Expected candidate");
    const before = getWorkspace(f.store, f.id);
    expect(
      await f.post(GENERATE_ROUTE, {
        workspaceId: f.id,
        request: "Make it dark and Add Cheese",
      }),
    ).toMatchObject({ kind: "failed", message: expect.stringContaining("Another request") });
    expect(getWorkspace(f.store, f.id)).toEqual(before);
    expect(activateVersion(f.store, f.id, first.hash, first.expectedDataRevision).ok).toBe(true);
    expect(await f.post(FINISH_DATA_ROUTE, { workspaceId: f.id, hash: first.hash })).toMatchObject({
      kind: "data_changed",
    });
    expect(f.calls.at(-1)!.prompt).toContain("Add Bread");
    expect(f.calls.at(-1)!.prompt).not.toContain("Add Cheese");
  });
  it("GEN-04 DATA-03: only the interface part reaches editing; data sees the activated shape and waits for entry approval", async () => {
    const f = await fixture([
      { stage: "edit", value: quantityEdit },
      { stage: "data", value: setQuantity },
    ]);
    const original = getWorkspace(f.store, f.id)!;
    const generated = await f.ask();
    if (generated.kind !== "candidate") throw new Error("Expected candidate");
    expect(generated.dataPending).toBe(true);
    expect(f.calls.map((c) => c.stage)).toEqual(["intent", "edit"]);
    expect(f.calls[1]!.prompt).not.toContain("Set Milk quantity to 2");
    expect(getWorkspace(f.store, f.id)).toEqual(original);
    expect(activateVersion(f.store, f.id, generated.hash, generated.expectedDataRevision).ok).toBe(
      true,
    );
    const activated = getWorkspace(f.store, f.id)!;
    const plan = await f.post(FINISH_DATA_ROUTE, { workspaceId: f.id, hash: generated.hash });
    if (plan.kind !== "data_confirmation") throw new Error("Expected data review");
    expect(f.calls[2]!.prompt).toContain("Set Milk quantity to 2");
    expect(f.calls[2]!.prompt).not.toContain("Show quantities");
    expect(f.calls[2]!.prompt).not.toContain("tessera.call");
    expect(plan.changes[0]!.before?.["quantity"]).toBe(1);
    expect(getWorkspace(f.store, f.id)).toEqual(activated);
    expect(await f.post(CONFIRM_DATA_ROUTE, { token: plan.token, approve: true })).toMatchObject({
      kind: "data_changed",
      count: 1,
    });
    expect(getWorkspace(f.store, f.id)?.data?.["items"]).toEqual([
      { id: "i-1", title: "Milk", quantity: 2 },
      { id: "i-2", title: "Eggs", quantity: 1 },
    ]);
    expect(
      await f.post(FINISH_DATA_ROUTE, { workspaceId: f.id, hash: generated.hash }),
    ).toMatchObject({ kind: "failed" });
    expect(f.calls.map((c) => c.stage)).toEqual(["intent", "edit", "data"]);
  });
  it("GEN-04 RUN-03: a data follow-up before activation spends no call and changes no entries", async () => {
    const f = await fixture([{ stage: "edit", value: quantityEdit }]);
    const generated = await f.ask();
    if (generated.kind !== "candidate") throw new Error("Expected candidate");
    const before = getWorkspace(f.store, f.id);
    expect(await f.post(FINISH_DATA_ROUTE, { workspaceId: f.id, hash: generated.hash })).toEqual({
      kind: "answer",
      answer: "data_stale",
    });
    expect(f.calls).toHaveLength(2);
    expect(getWorkspace(f.store, f.id)).toEqual(before);
  });
  it("GEN-04 GEN-07: an identical interface can still apply an independent data addition without version history", async () => {
    const f = await fixture(
      [
        { stage: "edit", value: noEdit },
        { stage: "data", value: add },
      ],
      { interfacePart: "Keep the layout", dataPart: "Add Bread" },
    );
    expect(await f.ask()).toMatchObject({
      kind: "mixed_data",
      interface: { outcome: "unchanged" },
      data: { kind: "data_changed", count: 1 },
    });
    expect(workspaceVersions(f.store, f.id)).toHaveLength(1);
  });
  it("GEN-09 GEN-04: data cannot restart a shape-repair allowance already spent by the edit", async () => {
    const f = await fixture([
      { stage: "edit", value: {} },
      { stage: "repair", value: quantityEdit },
      {
        stage: "data",
        value: {
          ...add,
          patch: {
            operations: [{ op: "add", collection: "items", record: { title: 42, quantity: 1 } }],
          },
        },
      },
    ]);
    const generated = await f.ask();
    if (generated.kind !== "candidate") throw new Error("Expected repaired candidate");
    expect(activateVersion(f.store, f.id, generated.hash, generated.expectedDataRevision).ok).toBe(
      true,
    );
    const before = getWorkspace(f.store, f.id);
    expect(
      await f.post(FINISH_DATA_ROUTE, { workspaceId: f.id, hash: generated.hash }),
    ).toMatchObject({ kind: "failed", failure: "schema-shape" });
    expect(f.calls.map((c) => c.stage)).toEqual(["intent", "edit", "repair", "data"]);
    expect(getWorkspace(f.store, f.id)).toEqual(before);
  });
  it("GEN-09 GEN-04: a smoke repair moves only the remaining data continuation to its repaired candidate", async () => {
    if (styleEdit.files.mode !== "replace") throw new Error("Expected fixture");
    const broken = {
      ...styleEdit,
      files: {
        mode: "replace",
        code: {
          ...styleEdit.files.code,
          html: '<h1>Shopping list</h1><ul id="items"></ul><input id="note">',
        },
      },
    };
    const fixed = {
      ...styleEdit,
      files: {
        mode: "replace",
        code: {
          ...styleEdit.files.code,
          html: '<h1>Shopping list</h1><ul id="items"></ul><label for="note">Note</label><input id="note">',
        },
      },
    };
    const f = await fixture(
      [
        { stage: "edit", value: broken },
        { stage: "repair", value: fixed },
        { stage: "data", value: add },
      ],
      { interfacePart: "Make it dark", dataPart: "Add Bread" },
    );
    const generated = await f.ask();
    if (generated.kind !== "candidate") throw new Error("Expected candidate");
    const repaired = await f.post(SMOKE_REPAIR_ROUTE, {
      workspaceId: f.id,
      hash: generated.hash,
      findings: ["A field has no label"],
    });
    if (repaired.kind !== "candidate") throw new Error("Expected repaired candidate");
    expect(repaired.dataPending).toBe(true);
    expect(
      await f.post(FINISH_DATA_ROUTE, { workspaceId: f.id, hash: generated.hash }),
    ).toMatchObject({ kind: "failed" });
    expect(activateVersion(f.store, f.id, repaired.hash, repaired.expectedDataRevision).ok).toBe(
      true,
    );
    expect(
      await f.post(FINISH_DATA_ROUTE, { workspaceId: f.id, hash: repaired.hash }),
    ).toMatchObject({ kind: "data_changed" });
    expect(f.calls.map((c) => c.stage)).toEqual(["intent", "edit", "repair", "data"]);
  });
  it("GEN-11 GEN-04: staging and queue time do not create a new data deadline", async () => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const f = await fixture(
      [{ stage: "edit", value: styleEdit }],
      { interfacePart: "Make it dark", dataPart: "Add Bread" },
      100_000,
    );
    const generated = await f.ask();
    if (generated.kind !== "candidate") throw new Error("Expected candidate");
    expect(activateVersion(f.store, f.id, generated.hash, generated.expectedDataRevision).ok).toBe(
      true,
    );
    const before = getWorkspace(f.store, f.id);
    now += 100_001;
    expect(
      await f.post(FINISH_DATA_ROUTE, { workspaceId: f.id, hash: generated.hash }),
    ).toMatchObject({ kind: "failed", failure: "provider" });
    expect(f.calls).toHaveLength(2);
    expect(getWorkspace(f.store, f.id)).toEqual(before);
  });
});
