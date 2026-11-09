import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { intentSchema, type Intent } from "@tessera/contracts";
import { listWorkspaces, ProviderError, ScriptError, type Store } from "@tessera/server";
import { afterAll, describe, expect, it } from "vitest";
import { loadScenario } from "../src/scenarios/index.ts";
import { featuresMissed, outcomeOf, say } from "../src/runner/messages.ts";
import { reportMarkdown } from "../src/runner/report.ts";
import { dataSettled, runScenario, zonedInstant, type RunReport } from "../src/runner/run.ts";
import { answersProvider, loadAnswers, type Answers } from "../src/runner/script.ts";
import { CANCELLED_WAIT_MS, recordAnswers } from "../src/runner/record.ts";
import { startHarness } from "../src/harness/index.ts";
import { createScriptedProvider } from "@tessera/server";

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
  it("GEN-17, EVAL-02: a big tool whose core stands but whose feature wasn't added, or may have been, isn't a pass", () => {
    const made = say("request.made", { name: "Reading list", summary: "A list and ratings." });
    const missed = `${made} ${say("request.followUpNotAdded", { feature: "Genre", message: "The model is unavailable." })}`;
    expect(outcomeOf(missed)).toEqual({ claim: "created" });
    expect(featuresMissed(missed)).toEqual([
      "A feature wasn't added, so not every feature asked for is in place.",
    ]);
    const unsure = `${made} ${say("request.followUpUncertain", { feature: "Genre", message: "Lost." })}`;
    expect(featuresMissed(unsure)).toEqual([
      "A feature may have been added, so not every feature asked for is in place.",
    ]);
    const all = `${made} ${say("request.followUpAdded", { feature: "Genre", summary: "Added genres." })}`;
    expect(featuresMissed(all)).toEqual([]);
    expect(featuresMissed(made)).toEqual([]);
  });

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

  it("EVAL-01: every M2 scenario has a rehearsal, for it, within its budget, and each big request one for two passes too", () => {
    const ids = fs
      .readdirSync(path.join(scenarios, "rehearsals"))
      .map((f) => path.basename(f, ".json"));
    expect(ids.sort()).toEqual([
      "B10-study-planner",
      "B10-study-planner.two-pass",
      "B2-reading-list",
      "B2-reading-list.two-pass",
      "B4-habit-tracker",
      "B4-habit-tracker.two-pass",
      "J6-limits",
      "T1-shopping-list",
      "T10-study-planner",
      "T13-drawing-board",
      "T2-reading-list",
      "T3-spending-chart",
      "T5-rsvp-form",
      "T6-tip-calculator",
    ]);
    for (const id of ids) {
      const rehearsal = loadAnswers(path.join(scenarios, "rehearsals", `${id}.json`));
      const scenario = loadScenario(path.join(scenarios, `${id.replace(/\.two-pass$/, "")}.yaml`));
      expect(rehearsal.scenario).toBe(scenario.id);
      expect(rehearsal.answers.length).toBeLessThanOrEqual(scenario.budget.calls);
    }
  });
});

describe("live runs become replays (EVAL-07, ENG-07)", () => {
  const roots: string[] = [];
  afterAll(() => roots.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
  const savedId = "0b6c2d1e-3f4a-4b5c-8d6e-7f8091a2b3c4";

  it("EVAL-07: records each call's answer in order, names saved tools, keeps failures and cancels, skips refusals", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-record-"));
    roots.push(root);
    // A real harness ledger and request log, from a dry run of four calls and one refused.
    const harness = startHarness({
      provider: createScriptedProvider({
        name: "record",
        replies: [
          intent("clarify"),
          intent("open_saved", { savedToolId: savedId }),
          { kind: "error", stage: "intent", error: "schema" },
          { kind: "error", stage: "intent", error: "cancelled" },
        ],
      }),
      mode: "dry-run",
      callCap: 4,
      dataFolder: path.join(root, "harness"),
    });
    const call = () => harness.provider.run({ ...ask("intent"), promptParts: ["intent@abc"] });
    await call();
    await call();
    await expect(call()).rejects.toThrow();
    await expect(call()).rejects.toThrow();
    await expect(call()).rejects.toThrow(/used all 4 of its calls/);
    harness.finish();

    const { answers, skipped } = recordAnswers({
      harnessFolder: path.join(root, "harness"),
      scenario: "T1-shopping-list",
      // Quotes and a backslash: names the saved-tool contract allows, kept whole both ways.
      savedTools: [{ id: savedId, name: 'My "weekly" \\ shop' }],
      recorded: { head: "a".repeat(40), at: "2026-11-05T10:00:00.000Z", cliVersion: "2.1.311" },
    });
    expect(skipped).toEqual([]);
    expect(answers.answers.map((a) => a.reply.kind)).toEqual(["value", "value", "error", "error"]);
    expect(answers.answers[1]!.reply).toMatchObject({
      value: { kind: "open_saved", savedToolId: '{{saved:My "weekly" \\ shop}}' },
    });
    expect(answers.answers[3]).toMatchObject({
      reply: { error: "cancelled" },
      delayMs: CANCELLED_WAIT_MS,
    });
    expect(answers.answers[0]!.parts).toEqual(["intent@abc"]);
    // What it recorded replays: the same answers, the saved tool's ID filled in again.
    const replay = answersProvider(answers, (name) =>
      name === 'My "weekly" \\ shop' ? "11111111-2222-4333-8444-555555555555" : undefined,
    );
    expect((await replay.run(ask("intent"))).value).toMatchObject({ kind: "clarify" });
    expect((await replay.run(ask("intent"))).value).toMatchObject({
      savedToolId: "11111111-2222-4333-8444-555555555555",
    });
  });

  it("ENG-16: a replay recorded with other prompt parts runs, flagged as stale", async () => {
    const provider = answersProvider(
      {
        about: "test",
        scenario: "T0-test",
        answers: [{ reply: intent("clarify"), parts: ["intent@old"] }],
      },
      () => undefined,
    );
    await provider.run({ ...ask("intent"), promptParts: ["intent@new"] });
    expect(provider.stale()).toEqual([
      "Call 1 (intent) was recorded with other prompt parts; now intent@new.",
    ]);
    expect(provider.misfits()).toEqual([]);
  });

  it("ENG-07: a run's cap can be lower than the scenario's budget, never higher, and is checked before anything starts", async () => {
    const t1 = loadScenario(path.join(scenarios, "T1-shopping-list.yaml"));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-cap-"));
    roots.push(root);
    const run = (callCap: number) =>
      runScenario(t1, {
        mode: "live",
        provider: createScriptedProvider({ name: "never", replies: [] }),
        folder: path.join(root, String(callCap)),
        callCap,
      });
    for (const callCap of [11, 0, 2.5]) {
      await expect(run(callCap)).rejects.toThrow(
        /whole number from 1 to T1-shopping-list's budget of 10/,
      );
      expect(fs.existsSync(path.join(root, String(callCap)))).toBe(false);
    }
  });
});

describe("the run's clock and its failures (RUN-07, EVAL-02)", () => {
  it("RUN-07, L-83: a scenario whose clock starts after now is refused before anything starts", async () => {
    const t1 = loadScenario(path.join(scenarios, "T1-shopping-list.yaml"));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-clock-"));
    roots.push(root);
    const ahead = { ...t1, clock: { start: "2099-01-01T09:00:00", zone: "Europe/Lisbon" } };
    await expect(
      runScenario(ahead, {
        mode: "live",
        provider: createScriptedProvider({ name: "never", replies: [] }),
        folder: path.join(root, "run"),
      }),
    ).rejects.toThrow(/clock starts at 2099-01-01T09:00:00, after now/);
    expect(fs.existsSync(path.join(root, "run"))).toBe(false);
  });

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
      callCap: 9,
      stale: ["Call 2 (edit) was recorded with other prompt parts; now edit@abc."],
    };
    const text = reportMarkdown(report);
    expect(text).toContain("**Requests passed at the first attempt:** 1 of 2.");
    expect(text).toContain("**Lifecycle steps passed:** 1 of 2; every one must pass.");
    expect(text).toContain(
      "**Calls:** 4 of a hard cap of 9 (0 failed, 0 refused); tokens in 10, cached 0, out 5.",
    );
    expect(text).toContain("**Stale replay:** one answer was recorded with other prompt parts");
    // A table cell keeps its text whole, even with a bar in it.
    expect(text).toContain("| 2 | say: Group \\| them | failed | — | The tool didn't change. |");
  });
});

describe("a do step's wait for its save (EVAL-01, EVAL-02)", () => {
  /** When dataSettled returns, on a virtual clock, with the data's revision moving at `changes`. */
  async function settledAt(changes: number[]): Promise<number> {
    let now = 0;
    const revision = () => changes.filter((at) => at <= now).length;
    await dataSettled(revision, (ms) => {
      now += ms;
      return Promise.resolve();
    });
    return now;
  }

  it("EVAL-02: a save that comes after a second is waited for, then the quiet after it", async () => {
    expect(await settledAt([1_400])).toBe(2_400);
    // Two writes, the second half a second after the first: quiet counts from the last.
    expect(await settledAt([1_400, 1_900])).toBe(2_900);
  });

  it("EVAL-02: a write four seconds late is seen, so a step expecting the data unchanged fails instead of passing", async () => {
    expect(await settledAt([4_000])).toBe(5_000);
  });

  it("EVAL-02: with no write, the wait ends at ten seconds, and the facts say what happened", async () => {
    expect(await settledAt([])).toBe(10_000);
  });
});
