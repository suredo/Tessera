import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_ROUTES,
  intentSchema,
  type Intent,
  type ScriptedReply,
  type Stage,
} from "@tessera/contracts";
import {
  assemblePrompt,
  createScriptedProvider,
  runStage,
  type Provider,
  type StageSpec,
} from "@tessera/server";
import { afterAll, describe, expect, it } from "vitest";
import {
  HarnessError,
  readLedger,
  readRequestLog,
  startHarness,
  SUMMARY_FILE,
} from "../src/harness/index.ts";

// Every run gets a new folder under the system's temporary folder, never a real data folder (ENG-19).
const root = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-evals-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
let runs = 0;
const newFolder = () => path.join(root, `run-${++runs}`);

const intent: Intent = {
  kind: "create",
  interfacePart: "A shopping list I can tick off",
  dataPart: null,
  behaviorChange: false,
  lookOnly: false,
  targetsCurrentTool: false,
  language: "en",
  features: [],
};
const value = (stage: Stage): ScriptedReply => ({ kind: "value", stage, value: intent });
const spec = (stage: Stage, prompt = "I need a shopping list"): StageSpec<Intent> => ({
  stage,
  system: "Read the request.",
  prompt,
  schema: intentSchema,
  model: "haiku-5.5",
  effort: "low",
  tools: "none",
  timeLimitMs: 10_000,
});
const dryRun = (replies: ScriptedReply[], callCap = 5) => {
  const scripted = createScriptedProvider({ name: "test", replies });
  const harness = startHarness({
    provider: scripted,
    mode: "dry-run",
    callCap,
    dataFolder: newFolder(),
  });
  return { scripted, harness };
};

describe("evaluation harness (OBS-02, ENG-07)", () => {
  it("rehearses a run at no cost and leaves its ledger, request log and summary", async () => {
    const { harness } = dryRun([value("intent"), value("intent")]);
    await harness.provider.run(spec("intent", "I need a shopping list"));
    await harness.provider.run(spec("intent", "Add cheese"));
    const summary = harness.finish();

    expect(summary).toEqual({
      callCount: 2,
      failedCount: 0,
      refusedCount: 0,
      unknownUsageCount: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
    });
    const ledger = readLedger(harness.dataFolder);
    expect(ledger.map((e) => [e.callIndex, e.mode, e.stage, e.outcome.kind])).toEqual([
      [0, "dry-run", "intent", "ok"],
      [1, "dry-run", "intent", "ok"],
    ]);
    expect(ledger[1]).toMatchObject({ provider: "scripted:test", promptCharCount: 10 });
    expect(readRequestLog(harness.dataFolder).map((e) => e.prompt)).toEqual([
      "I need a shopping list",
      "Add cheese",
    ]);
    const written: unknown = JSON.parse(
      fs.readFileSync(path.join(harness.dataFolder, SUMMARY_FILE), "utf8"),
    );
    expect(written).toMatchObject({ mode: "dry-run", callCap: 5, callCount: 2 });
  });

  it("refuses every call past the hard cap, without reaching the provider", async () => {
    const { scripted, harness } = dryRun([value("intent"), value("intent"), value("intent")], 2);
    await harness.provider.run(spec("intent"));
    await harness.provider.run(spec("intent"));
    await expect(harness.provider.run(spec("intent"))).rejects.toThrow(HarnessError);
    expect(scripted.remaining()).toBe(1);
    expect(harness.callsUsed()).toBe(2);
    expect(readLedger(harness.dataFolder).at(-1)?.outcome).toEqual({
      kind: "refused",
      reason: "call_cap",
    });
    expect(harness.finish()).toMatchObject({ callCount: 2, refusedCount: 1 });
  });

  it("keeps calls made at the same time under the cap", async () => {
    const { harness } = dryRun([value("intent"), value("intent"), value("intent")], 2);
    const results = await Promise.allSettled(
      [1, 2, 3].map(() => harness.provider.run(spec("intent"))),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(harness.callsUsed()).toBe(2);
  });

  it("records when a call started, not when it ended", async () => {
    let clockMs = Date.parse("2026-10-17T09:00:00Z");
    const scripted = createScriptedProvider({ name: "slow", replies: [value("create")] });
    // A call that takes five minutes on the run's clock.
    const slow: Provider = {
      name: "slow",
      live: false,
      run: async (callSpec) => {
        const result = await scripted.run(callSpec);
        clockMs += 5 * 60_000;
        return result;
      },
    };
    const harness = startHarness({
      provider: slow,
      mode: "dry-run",
      callCap: 1,
      dataFolder: newFolder(),
      now: () => new Date(clockMs),
    });
    await harness.provider.run(spec("create"));
    expect(readLedger(harness.dataFolder)[0]?.startedAt).toBe("2026-10-17T09:00:00.000Z");
  });

  it("records failed and broken calls, and stops after a provider error", async () => {
    const { harness } = dryRun([
      { kind: "value", stage: "intent", value: { kind: "create" } },
      value("intent"),
      { kind: "error", stage: "create", error: "sign_in" },
      value("edit"),
    ]);
    await expect(harness.provider.run(spec("intent"))).rejects.toMatchObject({ kind: "schema" });
    // The script expects an intent call, so a create call is a broken test: recorded, not hidden.
    await expect(harness.provider.run(spec("create"))).rejects.toThrow(/intent reply next/);
    await harness.provider.run(spec("intent"));
    await expect(harness.provider.run(spec("create"))).rejects.toMatchObject({ kind: "sign_in" });
    await expect(harness.provider.run(spec("edit"))).rejects.toThrow(/stopped/);

    expect(readLedger(harness.dataFolder).map((e) => e.outcome.kind)).toEqual([
      "failed",
      "crashed",
      "ok",
      "failed",
      "refused",
    ]);
    expect(readRequestLog(harness.dataFolder).map((e) => e.answer === null)).toEqual([
      true,
      true,
      false,
      true,
    ]);
    // A crash's cost is unknown: counted, never added as 0 (CLI-04).
    expect(harness.finish()).toMatchObject({ callCount: 4, failedCount: 3, unknownUsageCount: 1 });
  });

  it("CLI-09: records the route each stage ran on, as the routing table gave it", async () => {
    const { harness } = dryRun([value("intent"), value("create")]);
    const routes = {
      ...DEFAULT_ROUTES,
      create: { model: "claude-opus-5-5", effort: "high" },
    } as const;
    for (const stage of ["intent", "create"] as const) {
      await runStage(harness.provider, routes, {
        stage,
        system: "Read the request.",
        prompt: "I need a shopping list",
        schema: intentSchema,
        timeLimitMs: 10_000,
      });
    }
    expect(readLedger(harness.dataFolder).map((e) => [e.stage, e.model, e.effort])).toEqual([
      ["intent", "claude-haiku-5-5", "low"],
      ["create", "claude-opus-5-5", "high"],
    ]);
  });

  it("ENG-16, GEN-03: records the prompt parts each call was built from, and the instructions' size", async () => {
    const { harness } = dryRun([value("create"), value("intent")]);
    const prompt = assemblePrompt({
      stage: "create",
      request: "I need a shopping list",
      uiMode: "standard",
    });
    await runStage(harness.provider, DEFAULT_ROUTES, {
      stage: "create",
      system: prompt.system,
      prompt: prompt.prompt,
      promptParts: prompt.parts,
      schema: intentSchema,
      timeLimitMs: 10_000,
    });
    // A call made without parts records none, never a guess.
    await runStage(harness.provider, DEFAULT_ROUTES, {
      stage: "intent",
      system: "Read the request.",
      prompt: "I need a shopping list",
      schema: intentSchema,
      timeLimitMs: 10_000,
    });
    const [made, bare] = readLedger(harness.dataFolder);
    expect(made).toMatchObject({
      promptParts: prompt.parts,
      systemCharCount: prompt.system.length,
      promptCharCount: prompt.prompt.length,
    });
    expect(bare).toMatchObject({ promptParts: [], systemCharCount: "Read the request.".length });
  });

  it("refuses a run whose provider, cap or data folder is wrong, before any call", () => {
    let reached = false;
    const live: Provider = {
      name: "live-fake",
      live: true,
      run: () => {
        reached = true;
        return Promise.reject(new Error("unreachable"));
      },
    };
    const scripted = createScriptedProvider({ name: "test", replies: [] });
    const start = (options: Partial<Parameters<typeof startHarness>[0]>) => () =>
      startHarness({
        provider: scripted,
        mode: "dry-run",
        callCap: 3,
        dataFolder: newFolder(),
        ...options,
      });

    expect(start({ provider: live })).toThrow(/can reach a real model/);
    expect(start({ mode: "live" })).toThrow(/answers from a script/);
    for (const callCap of [0, -1, 2.5, Number.NaN])
      expect(start({ callCap })).toThrow(HarnessError);
    const used = newFolder();
    fs.mkdirSync(used);
    fs.writeFileSync(path.join(used, "tessera.db"), "");
    expect(start({ dataFolder: used })).toThrow(/new or empty/);
    expect(reached).toBe(false);
  });
});
