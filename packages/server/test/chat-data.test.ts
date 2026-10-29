import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ROUTES, dataPlanSchema, type DataPlan } from "@tessera/contracts";
import {
  candidateFrom,
  checkedDataPlan,
  commitDataPlan,
  planDataChange,
} from "../src/generation/index.ts";
import { assembleDataPrompt, DATA_PROMPT_BUDGET } from "../src/prompts/index.ts";
import { createScriptedProvider, type Provider } from "../src/providers/index.ts";
import { openDataFolder } from "../src/storage/index.ts";
import { saveVersion } from "../src/versions/index.ts";
import {
  activateVersion,
  createWorkspace,
  getWorkspace,
  listUndo,
  patchWorkspaceData,
  readWorkspaceData,
} from "../src/workspaces/index.ts";
import { editFixture } from "./fixtures/edit-tool.ts";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((clean) => clean()));
async function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-chat-data-"));
  const store = await openDataFolder(dir);
  cleanups.push(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const built = candidateFrom(editFixture);
  if (built.kind !== "candidate") throw new Error("Bad fixture");
  const workspace = createWorkspace(store, editFixture.name, { data: built.startingData });
  const hash = saveVersion(store.db, built.artifact);
  expect(activateVersion(store, workspace.id, hash, workspace.dataRevision).ok).toBe(true);
  return {
    store,
    id: workspace.id,
    hash,
    artifact: built.artifact,
    input: {
      request: "Rename Milk to Oat milk",
      language: "en",
      artifact: built.artifact,
      snapshot: readWorkspaceData(store, workspace.id),
    },
  };
}
const rename: Extract<DataPlan, { outcome: "patch" }> = {
  outcome: "patch",
  summary: "Rename Milk to Oat milk.",
  patch: {
    operations: [
      {
        op: "replace",
        collection: "items",
        id: "i-1",
        revisionCount: 999,
        fields: { title: "Oat milk" },
      },
    ],
  },
};
const add: Extract<DataPlan, { outcome: "patch" }> = {
  outcome: "patch",
  summary: "Add Bread.",
  patch: { operations: [{ op: "add", collection: "items", record: { title: "Bread" } }] },
};

describe("chat data planning", () => {
  it("CON-02 DATA-02: explicit plans reuse patch validation and cannot supply IDs or whole data", () => {
    expect(dataPlanSchema.safeParse(add).success).toBe(true);
    expect(
      dataPlanSchema.safeParse({
        ...add,
        patch: {
          operations: [{ op: "add", collection: "items", record: { id: "mine", title: "Bread" } }],
        },
      }).success,
    ).toBe(false);
    expect(
      dataPlanSchema.safeParse({ outcome: "patch", summary: "Replace", data: {} }).success,
    ).toBe(false);
    expect(dataPlanSchema.safeParse({ outcome: "unchanged", patch: add.patch }).success).toBe(
      false,
    );
  });
  it("DATA-02 GEN-01: host binds target revisions and builds the exact confirmation preview on copies", async () => {
    const f = await fixture();
    const before = getWorkspace(f.store, f.id);
    const planned = checkedDataPlan(f.input, rename);
    if (planned.kind !== "planned") throw new Error("Expected plan");
    expect(planned.plan.batch.operations[0]).toMatchObject({ revisionCount: 2 });
    expect(planned.plan.needsConfirmation).toBe(true);
    expect(planned.plan.preview).toEqual([
      {
        collection: "items",
        id: "i-1",
        before: { id: "i-1", title: "Milk" },
        after: { id: "i-1", title: "Oat milk" },
      },
    ]);
    expect(getWorkspace(f.store, f.id)).toEqual(before);
    expect(
      checkedDataPlan(f.input, {
        ...rename,
        patch: {
          operations: [{ op: "remove", collection: "items", id: "missing", revisionCount: 1 }],
        },
      }).kind,
    ).toBe("failed");
  });
  it("DATA-02: concurrent edits to other entries survive, but the touched entry wins against a stale plan", async () => {
    const f = await fixture();
    const planned = checkedDataPlan(f.input, rename);
    if (planned.kind !== "planned") throw new Error("Expected plan");
    expect(
      patchWorkspaceData(f.store, f.id, {
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
    expect(commitDataPlan(f.store, f.id, f.hash, f.artifact, planned.plan)).toMatchObject({
      ok: true,
      changed: true,
    });
    expect(readWorkspaceData(f.store, f.id).data["items"]).toEqual([
      { id: "i-1", title: "Oat milk" },
      { id: "i-2", title: "Duck eggs" },
    ]);
    const after = getWorkspace(f.store, f.id);
    expect(commitDataPlan(f.store, f.id, f.hash, f.artifact, planned.plan)).toMatchObject({
      ok: false,
      reason: "stale",
    });
    expect(getWorkspace(f.store, f.id)).toEqual(after);
    expect(listUndo(f.store, f.id)).toHaveLength(2);
  });
  it("DATA-03 DATA-10: commits check live data and the original active version inside the transaction", async () => {
    const f = await fixture();
    const planned = checkedDataPlan(f.input, add);
    if (planned.kind !== "planned") throw new Error("Expected plan");
    expect(planned.plan.needsConfirmation).toBe(false);
    expect(planned.plan.addedIds).toHaveLength(1);
    expect(commitDataPlan(f.store, f.id, "0".repeat(64), f.artifact, planned.plan)).toMatchObject({
      ok: false,
      reason: "stale",
    });
    expect(
      patchWorkspaceData(f.store, f.id, {
        operations: [
          {
            op: "replace",
            collection: "items",
            id: "i-2",
            revisionCount: 2,
            fields: { title: 42 },
          },
        ],
      }).ok,
    ).toBe(true);
    const before = getWorkspace(f.store, f.id);
    expect(commitDataPlan(f.store, f.id, f.hash, f.artifact, planned.plan)).toMatchObject({
      ok: false,
      reason: "invalid",
    });
    expect(getWorkspace(f.store, f.id)).toEqual(before);
  });
  it("GEN-07 GEN-11: identical final data adds no history and a stopped plan cannot start storage", async () => {
    const f = await fixture();
    const before = getWorkspace(f.store, f.id);
    expect(
      checkedDataPlan(f.input, {
        ...rename,
        patch: {
          operations: [
            {
              ...rename.patch.operations[0]!,
              op: "replace",
              collection: "items",
              id: "i-1",
              revisionCount: 2,
              fields: { title: "Milk" },
            },
          ],
        },
      }).kind,
    ).toBe("unchanged");
    const planned = checkedDataPlan(f.input, add);
    if (planned.kind !== "planned") throw new Error("Expected plan");
    expect(() =>
      commitDataPlan(f.store, f.id, f.hash, f.artifact, planned.plan, () => {
        throw new Error("Stopped");
      }),
    ).toThrow("Stopped");
    expect(getWorkspace(f.store, f.id)).toEqual(before);
    expect(listUndo(f.store, f.id)).toEqual([]);
  });
  it("GEN-09: one bounded shape repair uses the original snapshot, not the guessed revision or failed data", async () => {
    const f = await fixture();
    const scripted = createScriptedProvider({
      name: "data",
      replies: [
        {
          kind: "value",
          stage: "data",
          value: {
            ...add,
            patch: { operations: [{ op: "add", collection: "items", record: { title: 42 } }] },
          },
        },
        { kind: "value", stage: "repair", value: add },
      ],
    });
    const calls: string[] = [];
    const provider: Provider = {
      name: "capture",
      live: false,
      run(spec) {
        calls.push(spec.prompt);
        return scripted.run(spec);
      },
    };
    expect((await planDataChange(provider, DEFAULT_ROUTES, f.input)).kind).toBe("planned");
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('"title":"Milk"');
    expect(calls[1]).toContain("--- failed-plan ---");
    const failing = createScriptedProvider({
      name: "limited",
      replies: [{ kind: "error", stage: "data", error: "sign_in" }],
    });
    expect(await planDataChange(failing, DEFAULT_ROUTES, f.input)).toMatchObject({
      kind: "failed",
      failure: "provider",
    });
  });
  it("GEN-03 GEN-04 SEC-02: only data context is quoted, and oversized contexts spend no call", async () => {
    const f = await fixture();
    const prompt = assembleDataPrompt({
      request: "Add Bread",
      language: "pt-BR",
      schema: f.artifact.data.schema,
      ...f.input.snapshot,
    });
    expect(prompt.size).toBeLessThan(DATA_PROMPT_BUDGET);
    expect(prompt.prompt).toContain("--- data-context ---");
    expect(prompt.prompt).not.toContain(editFixture.code.js);
    expect(prompt.prompt).toContain("pt-BR");
    const provider = createScriptedProvider({ name: "no call", replies: [] });
    expect(
      await planDataChange(provider, DEFAULT_ROUTES, {
        ...f.input,
        snapshot: {
          ...f.input.snapshot,
          data: { items: [{ id: "i", title: "x".repeat(DATA_PROMPT_BUDGET) }] },
        },
      }),
    ).toMatchObject({ kind: "cannot" });
  });
});
