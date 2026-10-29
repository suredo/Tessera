import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { dataPlanSchema, editSchema, intentSchema } from "@tessera/contracts";
import {
  activateVersion,
  candidateFrom,
  checkedDataPlan,
  commitDataPlan,
  createWorkspace,
  getWorkspace,
  openDataFolder,
  readWorkspaceData,
  saveVersion,
  ProviderError,
  type StageSpec,
} from "@tessera/server";
import { dataOnlyProvider, PLAN, REPLIES, SHOPPING } from "../spikes/chat-data-check/run.ts";

const spec = (
  stage: StageSpec<unknown>["stage"],
  schema: StageSpec<unknown>["schema"] = dataPlanSchema,
): StageSpec<unknown> => ({
  stage,
  schema,
  system: "",
  prompt: "",
  model: "fake",
  effort: "low",
  tools: "none",
  timeLimitMs: 1000,
});
const fake = () => {
  const run = vi.fn<(call: StageSpec<unknown>) => void>();
  const provider = dataOnlyProvider({
    name: "free",
    live: false,
    run(call) {
      run(call);
      return Promise.resolve({
        value: call.schema.parse(REPLIES[0]),
        raw: "",
        usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, durationMs: 0 },
      });
    },
  });
  return { run, provider };
};
describe("chat-data evaluation preparation", () => {
  it("GEN-04 DATA-02: replays live plans across style activation, preserving entries until approval", async () => {
    const replay = JSON.parse(
      fs.readFileSync(
        new URL(
          "../spikes/chat-data-check/replays/chat-data-check-2026-10-29.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as { replays: { request: string; dataPart?: string; answer: unknown }[] };
    expect(replay.replays).toHaveLength(2);
    const built = candidateFrom(SHOPPING);
    if (built.kind !== "candidate") throw new Error("Invalid fixture");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-chat-data-replay-"));
    const store = await openDataFolder(dir);
    try {
      const workspace = createWorkspace(store, SHOPPING.name, { data: built.startingData });
      const initialHash = saveVersion(store.db, built.artifact);
      expect(activateVersion(store, workspace.id, initialHash, workspace.dataRevision).ok).toBe(
        true,
      );
      const plan = (index: number, artifact: typeof built.artifact) => {
        const step = replay.replays[index]!;
        const answer = dataPlanSchema.parse(step.answer);
        if (answer.outcome !== "patch") throw new Error("Expected recorded patch");
        const result = checkedDataPlan(
          {
            request: step.dataPart ?? step.request,
            language: "en",
            artifact,
            snapshot: readWorkspaceData(store, workspace.id),
          },
          answer,
        );
        if (result.kind !== "planned") throw new Error("Recorded plan refused");
        return result.plan;
      };
      const add = plan(0, built.artifact);
      expect(add.needsConfirmation).toBe(false);
      expect(add.addedIds).toHaveLength(1);
      expect(add.addedIds[0]).not.toBe("i-1");
      expect(commitDataPlan(store, workspace.id, initialHash, built.artifact, add)).toMatchObject({
        ok: true,
        changed: true,
      });
      const retained = [
        { id: "i-1", title: "Milk", quantity: 1 },
        { id: "i-2", title: "Eggs", quantity: 1 },
        { id: add.addedIds[0], title: "Bread", quantity: 1 },
      ];
      expect(readWorkspaceData(store, workspace.id).data["items"]).toEqual(retained);
      const styled = {
        ...built.artifact,
        code: { ...built.artifact.code, css: "body{background:#111111;color:#eeeeee}" },
      };
      const styledHash = saveVersion(store.db, styled);
      const beforeStyle = getWorkspace(store, workspace.id)!;
      expect(activateVersion(store, workspace.id, styledHash, beforeStyle.dataRevision).ok).toBe(
        true,
      );
      expect(readWorkspaceData(store, workspace.id).data["items"]).toEqual(retained);
      const beforeReview = getWorkspace(store, workspace.id);
      const replace = plan(1, styled);
      expect(replace.needsConfirmation).toBe(true);
      expect(replace.preview).toEqual([
        {
          collection: "items",
          id: "i-1",
          before: retained[0],
          after: { ...retained[0], quantity: 2 },
        },
      ]);
      expect(getWorkspace(store, workspace.id)).toEqual(beforeReview);
      // The browser evidence covers the approval button; this explicit commit replays approval.
      expect(commitDataPlan(store, workspace.id, styledHash, styled, replace)).toMatchObject({
        ok: true,
        changed: true,
      });
      expect(readWorkspaceData(store, workspace.id).data["items"]).toEqual([
        { ...retained[0], quantity: 2 },
        retained[1],
        retained[2],
      ]);
    } finally {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it("ENG-07 GEN-04: scripts both intents and style, routes only data/shape repair, and freezes two cases", async () => {
    const { provider, run } = fake();
    expect(PLAN.cases).toHaveLength(2);
    expect(PLAN.expectedCalls + PLAN.repairReserve).toBe(PLAN.callCap);
    expect((await provider.run(spec("intent", intentSchema))).value).toMatchObject({
      kind: "data",
    });
    await provider.run(spec("data"));
    expect((await provider.run(spec("intent", intentSchema))).value).toMatchObject({
      kind: "mixed",
      interfacePart: PLAN.cases[1].interfacePart,
      dataPart: PLAN.cases[1].dataPart,
    });
    expect((await provider.run(spec("edit", editSchema))).value).toMatchObject({
      data: { mode: "unchanged" },
    });
    await provider.run(spec("data"));
    await provider.run(spec("repair"));
    await expect(provider.run(spec("repair"))).rejects.toThrow("reserve exhausted");
    await expect(provider.run(spec("data"))).rejects.toThrow("two data calls");
    await expect(provider.run(spec("intent", intentSchema))).rejects.toThrow("two frozen intents");
    await expect(provider.run(spec("repair", editSchema))).rejects.toThrow("data-contract");
    expect(run.mock.calls.map(([call]) => call.stage)).toEqual(["data", "data", "repair"]);
  });
  it("ENG-07: a provider failure stops every later call without retry", async () => {
    const run = vi.fn<() => Promise<never>>(() =>
      Promise.reject(new ProviderError("unavailable_model", "Unavailable")),
    );
    const provider = dataOnlyProvider({ name: "free-error", live: false, run: () => run() });
    await expect(provider.run(spec("data"))).rejects.toThrow("Unavailable");
    await expect(provider.run(spec("repair"))).rejects.toThrow("run stopped");
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("DATA-02 DATA-03: rehearsed additions preserve entries and replacement requires review of only Milk", () => {
    const built = candidateFrom(SHOPPING);
    if (built.kind !== "candidate") throw new Error("Invalid shopping fixture");
    const input = {
      request: PLAN.cases[0].request,
      language: "en",
      artifact: built.artifact,
      snapshot: { data: built.startingData, revisions: { items: { "i-1": 1, "i-2": 1 } } },
    };
    const add = checkedDataPlan(
      input,
      dataPlanSchema.parse(REPLIES[0]) as Extract<
        ReturnType<typeof dataPlanSchema.parse>,
        { outcome: "patch" }
      >,
    );
    if (add.kind !== "planned") throw new Error("Invalid addition");
    expect(add.plan.needsConfirmation).toBe(false);
    expect(add.plan.preview).toHaveLength(1);
    expect(add.plan.preview[0]?.before).toBeNull();
    const update = checkedDataPlan(
      input,
      dataPlanSchema.parse(REPLIES[1]) as Extract<
        ReturnType<typeof dataPlanSchema.parse>,
        { outcome: "patch" }
      >,
    );
    if (update.kind !== "planned") throw new Error("Invalid replacement");
    expect(update.plan.needsConfirmation).toBe(true);
    expect(update.plan.preview).toEqual([
      {
        collection: "items",
        id: "i-1",
        before: { id: "i-1", title: "Milk", quantity: 1 },
        after: { id: "i-1", title: "Milk", quantity: 2 },
      },
    ]);
    expect(input.snapshot.data).toEqual(SHOPPING.data.initialState);
  });
});
