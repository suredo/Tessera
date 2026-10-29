import { describe, expect, it, vi } from "vitest";
import { dataPlanSchema, editSchema, intentSchema } from "@tessera/contracts";
import { candidateFrom, checkedDataPlan, ProviderError, type StageSpec } from "@tessera/server";
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
