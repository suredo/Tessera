import { ledgerEntrySchema, type LedgerEntry } from "@tessera/contracts";
import { describe, expect, it } from "vitest";
import { say } from "../src/runner/messages.ts";
import { metricsMarkdown, metricsOf } from "../src/runner/metrics.ts";
import type { StepResult } from "../src/runner/run.ts";

// The metrics of a live evaluation (OBS-03), from a fixture ledger and report: per stage, calls,
// failures, time and tokens; per kind of request, repairs and checks passed at the first try.
// Usage nobody reported counts as unknown, never as 0 (CLI-04).

let index = 0;
type Usage = { input: number | null; cached?: number | null; output?: number | null };
const call = (
  stage: string,
  seconds: number | null,
  usage: Usage = { input: 1000 },
  options: { outcome?: "ok" | "failed" | "refused"; parts?: string[] } = {},
): LedgerEntry =>
  ledgerEntrySchema.parse({
    callIndex: index++,
    mode: "live",
    provider: "claude",
    stage,
    model: "m",
    effort: "low",
    promptCharCount: 1,
    ...(options.parts ? { promptParts: options.parts } : {}),
    startedAt: "2026-11-16T10:00:00.000Z",
    usage: {
      inputTokens: usage.input,
      cachedInputTokens: usage.cached === undefined ? 0 : usage.cached,
      outputTokens: usage.output === undefined ? 100 : usage.output,
      durationMs: seconds === null ? null : seconds * 1000,
    },
    outcome:
      options.outcome === "failed"
        ? { kind: "failed", error: "time_limit", message: "Took too long" }
        : options.outcome === "refused"
          ? { kind: "refused", reason: "call_cap" }
          : { kind: "ok" },
  });
const step = (kind: StepResult["kind"], outcome: StepResult["outcome"] = "passed", notice = "") =>
  ({ index: 0, kind, action: "", outcome, notice, problems: [], seconds: 1 }) as StepResult;
// What the host says when a tool was made or changed: only a tool past staging's checks is.
const made = say("request.made", { name: "List", summary: "A list." });
const changed = say("request.edited", { name: "List", summary: "A list." });
const failed = say("request.checkFailed");

describe("a live evaluation's metrics (OBS-03)", () => {
  it("OBS-03, CLI-04: per stage, calls, failures, time and tokens, with unknown usage counted apart, never as 0", () => {
    const metrics = metricsOf([
      {
        report: { steps: [] },
        calls: [
          call("create", 10, { input: 8000, cached: 2000, output: 3000 }),
          call("create", 30, { input: 9000, cached: 2000, output: 5000 }),
          // Usage nobody reported: counted apart, left out of the figures.
          call("create", 20, { input: null, cached: null, output: null }),
          // A failure counts as a call, but not in the time of those that ended well.
          call("create", 99, { input: 7000 }, { outcome: "failed" }),
          // A refused call never started, so isn't counted at all.
          call("create", null, { input: null }, { outcome: "refused" }),
        ],
      },
    ]);
    expect(metrics.stages["create"]).toEqual({
      calls: 4,
      failed: 1,
      seconds: { count: 3, p50: 20, p95: 30, slowest: 30 },
      inputTokens: { count: 3, p50: 8000, p95: 9000, slowest: 9000 },
      cachedInputTokens: { count: 3, p50: 2000, p95: 2000, slowest: 2000 },
      outputTokens: { count: 3, p50: 3000, p95: 5000, slowest: 5000 },
      unknownUsage: 1,
    });
  });

  it("OBS-03, GEN-09: per kind of request, how many needed a repair, and of those reaching them, passed the host's and staging's checks first time", () => {
    const parts = (name: string) => [`${name}@abc123`];
    const metrics = metricsOf([
      {
        report: {
          steps: [
            step("say", "passed", made),
            step("say", "passed", made),
            step("say", "passed", changed),
            step("say"),
            step("say"),
            step("cancel"),
            step("say", "blocked"),
          ],
        },
        calls: [
          // A new tool, straight through.
          call("intent", 2),
          call("create", 20),
          // A new tool whose static check failed, then whose smoke check did.
          call("intent", 2),
          call("create", 20),
          call("repair", 30, undefined, { parts: parts("repair-static") }),
          call("repair", 30, undefined, { parts: parts("repair-smoke") }),
          // A change whose behavior check failed.
          call("intent", 2),
          call("edit", 15),
          call("repair", 30, undefined, { parts: parts("repair-edit-behavior") }),
          // A data change: no tool made, so not counted here.
          call("intent", 2),
          call("data", 2),
          // A request cancelled by the next step, then one that didn't run: neither counted.
          call("intent", 2),
          call("create", 5, undefined, { outcome: "failed" }),
          call("intent", 2),
        ],
      },
    ]);
    expect(metrics.requests).toEqual({
      create: {
        requests: 2,
        repaired: 1,
        hostChecks: { reached: 2, passed: 1, unknown: 0 },
        stagingChecks: { reached: 2, passed: 1, unknown: 0 },
      },
      edit: {
        requests: 1,
        repaired: 1,
        hostChecks: { reached: 1, passed: 1, unknown: 0 },
        stagingChecks: { reached: 1, passed: 0, unknown: 0 },
      },
    });
    expect(metrics.unmatched).toBe(0);
  });

  it("OBS-03: a check counts only once reached: none after a failed stage, staging's none after the host's checks gave up (#385 review)", () => {
    const parts = (name: string) => [`${name}@abc123`];
    const metrics = metricsOf([
      {
        report: {
          steps: [step("say", "failed", failed), step("say", "failed", failed)],
        },
        calls: [
          // The stage itself failed: no answer, so no check was reached.
          call("intent", 2),
          call("create", 180, undefined, { outcome: "failed" }),
          // The static check failed, and so did its repair: staging was never reached.
          call("intent", 2),
          call("create", 20),
          call("repair", 30, undefined, { parts: parts("repair-static") }),
        ],
      },
    ]);
    expect(metrics.requests.create).toEqual({
      requests: 2,
      repaired: 1,
      hostChecks: { reached: 1, passed: 0, unknown: 0 },
      stagingChecks: { reached: 0, passed: 0, unknown: 0 },
    });
    expect(metricsMarkdown(metrics)).toContain(
      "| New tools | 2 | 1 of 2 (50%) | 0 of 1 (0%) | – |",
    );
  });

  it("OBS-03: a repair whose ledger line doesn't say what it repaired leaves its checks unknown, never passed (#385 review)", () => {
    const metrics = metricsOf([
      {
        report: { steps: [step("say", "passed", made)] },
        // An older ledger: no prompt parts on the repair.
        calls: [call("intent", 2), call("create", 20), call("repair", 30)],
      },
    ]);
    expect(metrics.requests.create).toEqual({
      requests: 1,
      repaired: 1,
      hostChecks: { reached: 0, passed: 0, unknown: 1 },
      stagingChecks: { reached: 0, passed: 0, unknown: 1 },
    });
    expect(metricsMarkdown(metrics)).toContain(
      "| New tools | 1 | 1 of 1 (100%) | –; 1 unknown | –; 1 unknown |",
    );
  });

  it("OBS-03: says plainly what it couldn't count, and what each figure is", () => {
    // Two intent calls for one request: an older report can't be matched, so its requests aren't counted.
    const metrics = metricsOf([
      {
        report: { steps: [step("say")] },
        calls: [call("intent", 2), call("intent", 2), call("create", 20, { input: null })],
      },
    ]);
    expect(metrics.unmatched).toBe(1);
    expect(metrics.requests.create.requests).toBe(0);
    const text = metricsMarkdown(metrics);
    expect(text).toContain("One run's requests couldn't be matched to their calls");
    expect(text).toContain(
      "| create | 1 | 0 | 20.0 s / 20.0 s | unknown | 0 / 0 | 100 / 100 | 1 |",
    );
    expect(text).toContain("| New tools | 0 | – | – | – |");
  });
});
