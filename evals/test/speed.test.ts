import { ledgerEntrySchema, type LedgerEntry } from "@tessera/contracts";
import { describe, expect, it } from "vitest";
import type { StepResult } from "../src/runner/run.ts";
import { figures, speedMarkdown, speedOf } from "../src/runner/speed.ts";

// How fast a run was, against the speed targets (OBS-04): stage times from the ledger, request
// times from the report, each request matched to its calls, and misses said as plainly as passes.

let index = 0;
const call = (stage: string, seconds: number | null, ok = true): LedgerEntry =>
  ledgerEntrySchema.parse({
    callIndex: index++,
    mode: "live",
    provider: "claude",
    stage,
    model: "m",
    effort: "low",
    promptCharCount: 1,
    startedAt: "2026-11-05T21:00:00.000Z",
    usage: {
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      durationMs: seconds === null ? null : seconds * 1000,
    },
    outcome: ok ? { kind: "ok" } : { kind: "failed", error: "cancelled", message: "Stopped" },
  });
const step = (
  kind: StepResult["kind"],
  seconds: number,
  outcome: StepResult["outcome"] = "passed",
) => ({ index: 0, kind, action: "", outcome, notice: "", problems: [], seconds }) as StepResult;

describe("a run's speed (OBS-04)", () => {
  it("OBS-04: takes p50 and p95 by nearest rank, so with few samples p95 is the slowest", () => {
    expect(figures([])).toBeUndefined();
    expect(figures([3, 1, 2])).toEqual({ count: 3, p50: 2, p95: 3, slowest: 3 });
    const many = Array.from({ length: 40 }, (_, i) => i + 1);
    expect(figures(many)).toMatchObject({ p50: 20, p95: 38, slowest: 40 });
  });

  it("OBS-04: matches each request to its calls, times it as the person waited, and leaves out a cancelled one and a step that didn't run", () => {
    const speed = speedOf([
      {
        report: {
          steps: [
            step("say", 25),
            step("say", 12),
            step("save", 1),
            step("say", 5),
            step("say", 0.1),
            step("cancel", 2),
            step("say", 40, "blocked"),
          ],
        },
        calls: [
          call("intent", 3),
          call("create", 15),
          call("repair", 8),
          call("intent", 4),
          call("data", 3),
          call("intent", 2),
          call("intent", null, false),
          call("intent", 9),
          call("edit", 20),
        ],
      },
    ]);
    expect(speed.requests).toEqual({
      create: { count: 1, p50: 25, p95: 25, slowest: 25 },
      data: { count: 1, p50: 12, p95: 12, slowest: 12 },
      answer: { count: 1, p50: 5, p95: 5, slowest: 5 },
    });
    // Only calls that ended well, with a known duration, count toward a stage.
    expect(speed.stages["intent"]).toMatchObject({ count: 4, slowest: 9 });
    expect(speed.stages["repair"]).toMatchObject({ count: 1, p95: 8 });
    expect(speed.targets.map((t) => [t.name, t.met])).toEqual([
      ["Intent", true],
      ["A chat data change", true],
      ["A first useful tool", true],
    ]);
  });

  it("OBS-04: says a missed target and an unmeasured one plainly", () => {
    const speed = speedOf([
      { report: { steps: [step("say", 120)] }, calls: [call("intent", 12), call("create", 100)] },
    ]);
    expect(speed.targets.map((t) => [t.name, t.met])).toEqual([
      ["Intent", false],
      ["A chat data change", undefined],
      ["A first useful tool", false],
    ]);
    const text = speedMarkdown(speed);
    expect(text).toContain("| Intent | intent call | 10.0 s | 1 | 12.0 s | missed |");
    expect(text).toContain("| A chat data change | data request | 15.0 s | 0 | – | not measured |");
  });
});
