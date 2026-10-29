import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DEFAULT_ROUTES } from "@tessera/contracts";
import { withinRequestDeadline } from "../src/generation/deadline.ts";
import { JobQueue } from "../src/jobs/index.ts";
import { ProviderError, type Provider, type StageSpec } from "../src/providers/index.ts";

const call = {
  stage: "create",
  ...DEFAULT_ROUTES.create,
  tools: "none",
  system: "",
  prompt: "",
  schema: z.string(),
  timeLimitMs: 180_000,
} as const;
const result = {
  value: "ok",
  raw: "ok",
  usage: {
    inputTokens: 1,
    cachedInputTokens: 0,
    outputTokens: 1,
    durationMs: 1,
  },
};
const parent = () => new AbortController().signal;
afterEach(() => vi.useRealTimers());

describe("request deadline", () => {
  it("GEN-11: caps each stage by the remaining shared budget and clears its timer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limits: number[] = [];
    const provider: Provider = {
      name: "fake",
      live: false,
      run: (spec) => {
        limits.push(spec.timeLimitMs);
        vi.setSystemTime(Date.now() + 60_000);
        return Promise.resolve({ ...result, value: spec.schema.parse("ok") });
      },
    };
    await withinRequestDeadline(
      provider,
      200_000,
      async (bounded) => {
        await bounded.run(call);
        await bounded.run(call);
      },
      parent(),
    );
    expect(limits).toEqual([180_000, 140_000]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("GEN-11: an expired request never starts a provider call", async () => {
    const run = vi.fn();
    await expect(
      withinRequestDeadline(
        { name: "fake", live: false, run },
        Date.now(),
        (bounded) => bounded.run(call),
        parent(),
      ),
    ).rejects.toMatchObject({ kind: "time_limit" });
    expect(run).not.toHaveBeenCalled();
  });

  it("GEN-11 CLI-06: aborts a call but holds the queue slot until the provider settles, discarding its late answer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let complete!: () => void;
    let signal: AbortSignal | undefined;
    const provider: Provider = {
      name: "late",
      live: false,
      run: (spec) =>
        new Promise((resolve) => {
          signal = spec.signal;
          complete = () => resolve({ ...result, value: spec.schema.parse("ok") });
        }),
    };
    const queue = new JobQueue();
    let stored = false;
    const first = queue.submit("slow", (cancel) =>
      withinRequestDeadline(
        provider,
        100,
        async (bounded) => {
          await bounded.run(call);
          stored = true;
        },
        cancel,
      ),
    );
    const second = vi.fn(() => Promise.resolve("next"));
    const next = queue.submit("next", second);
    await vi.advanceTimersByTimeAsync(100);
    expect(signal?.aborted).toBe(true);
    expect(second).not.toHaveBeenCalled();
    complete();
    expect(await first.outcome).toMatchObject({
      state: "failed",
      error: { kind: "time_limit", usage: result.usage },
    });
    expect(await next.outcome).toEqual({ state: "done", value: "next" });
    expect(stored).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("GEN-11: timeout keeps provider usage and a user cancellation keeps its own cause", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const provider: Provider = {
      name: "stoppable",
      live: false,
      run: (spec: StageSpec<unknown>) =>
        new Promise((_, reject) => {
          spec.signal?.addEventListener(
            "abort",
            () => reject(new ProviderError("cancelled", "Stopped", result.usage)),
            { once: true },
          );
        }),
    };
    const timed = withinRequestDeadline(provider, 100, (bounded) => bounded.run(call), parent());
    const checked = expect(timed).rejects.toMatchObject({
      kind: "time_limit",
      usage: result.usage,
    });
    await vi.advanceTimersByTimeAsync(100);
    await checked;
    const cancel = new AbortController();
    const stopped = withinRequestDeadline(
      provider,
      300,
      (bounded) => bounded.run(call),
      cancel.signal,
    );
    const cancelled = expect(stopped).rejects.toMatchObject({ kind: "cancelled" });
    cancel.abort();
    await cancelled;
    expect(vi.getTimerCount()).toBe(0);
  });
});
