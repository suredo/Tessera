import path from "node:path";
import { fileURLToPath } from "node:url";
import { intentSchema, type Intent } from "@tessera/contracts";
import { ProviderError, ScriptError } from "@tessera/server";
import { describe, expect, it } from "vitest";
import { loadScenario } from "../src/scenarios/index.ts";
import { outcomeOf, say } from "../src/runner/messages.ts";
import { reportMarkdown } from "../src/runner/report.ts";
import type { RunReport } from "../src/runner/run.ts";
import { answersProvider, loadAnswers, type Answers } from "../src/runner/script.ts";

// The scenario runner's parts that need no browser (EVAL-01, EVAL-02, EVAL-07): what a notice
// claims, the answers a rehearsal or replay gives, and the report. Playing a scenario through the
// host app is the rehearsal itself: node evals/src/runner/cli.ts <scenario-id>.

const scenarios = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scenarios");

const intent = (kind: Intent["kind"], extra: Partial<Intent> = {}) => ({
  kind: "value" as const,
  stage: "intent" as const,
  value: {
    kind,
    interfacePart: null,
    dataPart: null,
    behaviorChange: false,
    lookOnly: false,
    targetsCurrentTool: false,
    language: "en",
    features: [],
    ...extra,
  },
});
const ask = (stage: "intent" | "create", signal?: AbortSignal) => ({
  stage,
  model: "test",
  effort: "low" as const,
  tools: "none" as const,
  system: "",
  prompt: "",
  schema: intentSchema,
  timeLimitMs: 1_000,
  ...(signal ? { signal } : {}),
});

describe("what a notice claims (EVAL-02, GEN-08)", () => {
  it("EVAL-02: reads a claim or an answer from the app's own words", () => {
    const made = say("request.made", { name: "Shopping list", summary: "A list." });
    expect(outcomeOf(made)).toEqual({ claim: "created" });
    expect(outcomeOf(say("request.edited", { name: "List", summary: "Grouped." }))).toEqual({
      claim: "changed",
    });
    expect(
      outcomeOf(say("request.dataChangedOne", { name: "List", summary: "Added cheese." })),
    ).toEqual({ claim: "changed" });
    expect(outcomeOf(say("request.clarify"))).toEqual({ claim: "none", answer: "clarify" });
    expect(outcomeOf(say("request.unsupported"))).toEqual({ claim: "none", answer: "unsupported" });
    expect(outcomeOf(say("request.unchanged"))).toEqual({ claim: "none" });
  });

  it("EVAL-02: a stop reads as stopped, from the app or from the server's own words", () => {
    expect(outcomeOf(say("request.stopped")).answer).toBe("stopped");
    expect(outcomeOf(say("request.failed", { message: "The request was stopped." })).answer).toBe(
      "stopped",
    );
    expect(outcomeOf(say("request.failed", { message: "Something else." }))).toEqual({
      claim: "none",
    });
  });
});

describe("rehearsal and replay answers (EVAL-07, TEST-04)", () => {
  const answers = (list: Answers["answers"]): Answers => ({
    about: "test",
    scenario: "T0-test",
    answers: list,
  });

  it("EVAL-07: answers in order, filling a saved tool's ID by its name when it is used", async () => {
    const saved: { id?: string } = {};
    const provider = answersProvider(
      answers([
        { reply: intent("clarify") },
        { reply: intent("open_saved", { savedToolId: "{{saved:Weekly shopping}}" }) },
      ]),
      (name) => (name === "Weekly shopping" ? saved.id : undefined),
    );
    expect(provider.live).toBe(false);
    expect((await provider.run(ask("intent"))).value).toMatchObject({ kind: "clarify" });
    saved.id = "0b6c2d1e-3f4a-4b5c-8d6e-7f8091a2b3c4";
    expect((await provider.run(ask("intent"))).value).toMatchObject({
      kind: "open_saved",
      savedToolId: saved.id,
    });
    expect(provider.remaining()).toBe(0);
  });

  it("TEST-04: a call for a stage the answers don't have next fails instead of guessing", async () => {
    const provider = answersProvider(answers([{ reply: intent("create") }]), () => undefined);
    await expect(provider.run(ask("create"))).rejects.toThrow(ScriptError);
    await expect(provider.run(ask("intent"))).rejects.toThrow(/no reply left/);
  });

  it("EVAL-07: an answer that takes its time is stopped by a cancel, as a model call would be", async () => {
    const provider = answersProvider(
      answers([{ reply: intent("create"), delayMs: 60_000 }]),
      () => undefined,
    );
    const cancel = new AbortController();
    const running = provider.run(ask("intent", cancel.signal));
    cancel.abort();
    await expect(running).rejects.toThrow(ProviderError);
  });

  it("EVAL-01: every rehearsal is for its scenario and checks as answers", () => {
    for (const id of ["J6-limits", "T1-shopping-list"]) {
      const rehearsal = loadAnswers(path.join(scenarios, "rehearsals", `${id}.json`));
      expect(rehearsal.scenario).toBe(loadScenario(path.join(scenarios, `${id}.yaml`)).id);
      expect(rehearsal.answers.length).toBeLessThanOrEqual(
        loadScenario(path.join(scenarios, `${id}.yaml`)).budget.calls,
      );
    }
  });
});

describe("the report (EVAL-02, A40)", () => {
  it("A40: counts requests at their first attempt apart from lifecycle steps, with the cost", () => {
    const report: RunReport = {
      scenario: "T1-shopping-list",
      mode: "rehearsal",
      startedAt: "2026-10-12T09:00:00.000Z",
      seconds: 12,
      steps: [
        {
          index: 1,
          kind: "say",
          action: "say: A list",
          outcome: "passed",
          notice: "Ready.",
          problems: [],
          seconds: 3,
        },
        {
          index: 2,
          kind: "say",
          action: "say: Group | them",
          outcome: "failed",
          notice: "",
          problems: ["The tool didn't change."],
          seconds: 2,
        },
        {
          index: 3,
          kind: "save",
          action: "save: Weekly",
          outcome: "passed",
          notice: "Saved.",
          problems: [],
          seconds: 1,
        },
        {
          index: 4,
          kind: "reload",
          action: "reload",
          outcome: "blocked",
          notice: "",
          problems: [],
          seconds: 0,
        },
      ],
      ledger: {
        callCount: 4,
        failedCount: 0,
        refusedCount: 0,
        unknownUsageCount: 0,
        inputTokens: 10,
        cachedInputTokens: 0,
        outputTokens: 5,
      } as RunReport["ledger"],
      folder: "x",
    };
    const text = reportMarkdown(report);
    expect(text).toContain("**Requests passed at the first attempt:** 1 of 2.");
    expect(text).toContain("**Lifecycle steps passed:** 1 of 2; every one must pass.");
    expect(text).toContain("**Calls:** 4 (0 failed, 0 refused); tokens in 10, cached 0, out 5.");
    // A table cell keeps its text whole, even with a bar in it.
    expect(text).toContain("| 2 | say: Group \\| them | failed | — | The tool didn't change. |");
  });
});
