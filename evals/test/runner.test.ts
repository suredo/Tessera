import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { intentSchema, type Intent } from "@tessera/contracts";
import { listWorkspaces, ProviderError, ScriptError, type Store } from "@tessera/server";
import { afterAll, describe, expect, it } from "vitest";
import { loadScenario } from "../src/scenarios/index.ts";
import { outcomeOf, say } from "../src/runner/messages.ts";
import { reportMarkdown } from "../src/runner/report.ts";
import { runScenario, zonedInstant, type RunReport } from "../src/runner/run.ts";
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

  it("TEST-04: a call for a stage the answers don't have next fails instead of guessing, and is kept to fail the run", async () => {
    const provider = answersProvider(answers([{ reply: intent("create") }]), () => undefined);
    await expect(provider.run(ask("create"))).rejects.toThrow(ScriptError);
    await expect(provider.run(ask("intent"))).rejects.toThrow(/no reply left/);
    // The host turns these into ordinary failed requests, so the runner reads them from here.
    expect(provider.misfits()).toEqual([
      expect.stringMatching(
        /needs a new live run: .*has a intent reply next, but the call is for create/,
      ),
      expect.stringMatching(/needs a new live run: .*no reply left for the intent call/),
    ]);
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

  it("EVAL-01: every M2 scenario has a rehearsal, for it, within its budget", () => {
    const ids = fs
      .readdirSync(path.join(scenarios, "rehearsals"))
      .map((f) => path.basename(f, ".json"));
    expect(ids.sort()).toEqual([
      "J6-limits",
      "T1-shopping-list",
      "T13-drawing-board",
      "T6-tip-calculator",
    ]);
    for (const id of ids) {
      const rehearsal = loadAnswers(path.join(scenarios, "rehearsals", `${id}.json`));
      expect(rehearsal.scenario).toBe(loadScenario(path.join(scenarios, `${id}.yaml`)).id);
      expect(rehearsal.answers.length).toBeLessThanOrEqual(
        loadScenario(path.join(scenarios, `${id}.yaml`)).budget.calls,
      );
    }
  });
});

describe("the run's clock and its failures (RUN-07, EVAL-02)", () => {
  const roots: string[] = [];
  afterAll(() => roots.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

  it("RUN-07: a scenario's start is its wall time in its own zone, across a date and a clock change", () => {
    const iso = (ms: number) => new Date(ms).toISOString();
    expect(iso(zonedInstant("2026-10-12T09:00:00", "America/Sao_Paulo"))).toBe(
      "2026-10-12T12:00:00.000Z",
    );
    // Early morning in Tokyo is the day before in UTC.
    expect(iso(zonedInstant("2026-10-12T05:00:00", "Asia/Tokyo"))).toBe("2026-10-11T20:00:00.000Z");
    // Just after New York's clocks go forward, and in summer time.
    expect(iso(zonedInstant("2026-03-08T03:30:00", "America/New_York"))).toBe(
      "2026-03-08T07:30:00.000Z",
    );
    expect(iso(zonedInstant("2026-07-01T12:00:00", "UTC"))).toBe("2026-07-01T12:00:00.000Z");
  });

  it("EVAL-02: a browser that won't start still stops Tessera, blocks every step and leaves a report", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-runner-"));
    roots.push(root);
    const webRoot = path.join(root, "web");
    fs.mkdirSync(webRoot);
    fs.writeFileSync(path.join(webRoot, "index.html"), "<!doctype html><title>Tessera</title>");
    let store: Store | undefined;
    const report = await runScenario(loadScenario(path.join(scenarios, "J6-limits.yaml")), {
      mode: "rehearsal",
      provider: answersProvider(
        loadAnswers(path.join(scenarios, "rehearsals", "J6-limits.json")),
        () => undefined,
      ),
      folder: path.join(root, "run"),
      webRoot,
      onStarted: (started) => (store = started),
      launchBrowser: () => Promise.reject(new Error("Chrome isn't installed.")),
    });
    expect(report.stopped).toBe("Chrome isn't installed.");
    expect(report.steps.every((s) => s.outcome === "blocked")).toBe(true);
    expect(report.ledger.callCount).toBe(0);
    expect(fs.existsSync(path.join(root, "run", "report.json"))).toBe(true);
    // Tessera was stopped: its data folder is closed.
    expect(() => listWorkspaces(store!)).toThrow();
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
