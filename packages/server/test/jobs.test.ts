import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { JOBS_AT_ONCE, JobQueue, type Job } from "../src/jobs/index.ts";
import { createClaudeProvider } from "../src/providers/index.ts";

// Job control (CLI-06), with the Claude Code adapter on the fake claude program, so a cancel stops
// a real process; it never reaches a model (ENG-11). The POC's queue lost both requests when a
// newer one replaced a running one, and ran a request cancelled while it waited (L-50).

const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), "support", "fake-claude.ts");
const temps: string[] = [];
afterAll(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

const reply = (title: string, delayMs = 0) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  structured_output: { answer: { title } },
  usage: {
    input_tokens: 1,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 1,
  },
  _delayMs: delayMs,
});
const SLOW = 10_000;

/** A queue whose jobs call the adapter on the fake, with these replies in call order. */
function setup(replies: unknown[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-jobs-test-"));
  temps.push(dir);
  const repliesFile = path.join(dir, "replies.json");
  const calls = path.join(dir, "calls");
  fs.writeFileSync(repliesFile, JSON.stringify(replies));
  const provider = createClaudeProvider({
    executable: process.execPath,
    leadingArgs: [fake, repliesFile, calls],
    live: false,
  });
  const changes: Job[] = [];
  const queue = new JobQueue({ onChange: (job) => changes.push(job) });
  const ask = (request: string, options: { replace?: boolean } = {}) =>
    queue.submit(
      request,
      async (signal) => {
        const result = await provider.run({
          stage: "create",
          system: "Make the tool the person asks for.",
          prompt: request,
          schema: z.strictObject({ title: z.string() }),
          model: "claude-sonnet-5-5",
          effort: "medium",
          tools: "none",
          timeLimitMs: 20_000,
          signal,
        });
        return result.value.title;
      },
      options,
    );
  const prompts = () =>
    fs.existsSync(calls)
      ? fs
          .readdirSync(calls)
          .sort()
          .map(
            (file) =>
              (JSON.parse(fs.readFileSync(path.join(calls, file), "utf8")) as { stdin: string })
                .stdin,
          )
      : [];
  const states = (job: { id: string }) =>
    changes.filter((change) => change.id === job.id).map((change) => change.state);
  /** Waits until the fake has started this many calls, so a cancel reaches a running process. */
  const started = async (count: number) => {
    while (prompts().length < count) await new Promise((resolve) => setTimeout(resolve, 20));
  };
  return { queue, ask, prompts, changes, states, started };
}

const view = (jobs: Job[]) =>
  jobs.map(({ request, state, replacedBy }) => ({ request, state, replacedBy }));

describe("job control (CLI-06)", () => {
  it("CLI-06: runs one job at a time by default, the next starting only when the last has ended", async () => {
    expect(JOBS_AT_ONCE).toBe(1);
    const { queue, ask, changes } = setup([reply("Shopping list", 300), reply("Calculator")]);
    const first = ask("a shopping list");
    const second = ask("a calculator");
    expect(view(queue.jobs()).map((job) => job.state)).toEqual(["running", "queued"]);
    expect(await first.outcome).toEqual({ state: "done", value: "Shopping list" });
    expect(await second.outcome).toEqual({ state: "done", value: "Calculator" });
    const order = changes.map((change) => `${change.request}: ${change.state}`);
    expect(order.indexOf("a calculator: running")).toBeGreaterThan(
      order.indexOf("a shopping list: done"),
    );
  });

  it("CLI-06: a job cancelled while it waits never starts, and the ones after it still run", async () => {
    const { queue, ask, prompts, states } = setup([reply("Shopping list", 300), reply("Notes")]);
    const first = ask("a shopping list");
    const second = ask("a calculator");
    const third = ask("some notes");
    expect(queue.cancel(second.job.id)).toBe(true);
    expect(await second.outcome).toEqual({ state: "cancelled" });
    expect(await first.outcome).toMatchObject({ state: "done" });
    expect(await third.outcome).toEqual({ state: "done", value: "Notes" });
    expect(states(second.job)).toEqual(["queued", "cancelled"]);
    expect(prompts()).toEqual(["a shopping list", "some notes"]);
    expect(queue.cancel(second.job.id)).toBe(false);
    expect(queue.cancel("no-such-job")).toBe(false);
  });

  it("CLI-06: cancelling a running job stops its Claude Code process during a slow call and records it as cancelled", async () => {
    const { queue, ask, started } = setup([reply("late", SLOW)]);
    const began = Date.now();
    const slow = ask("a drawing board");
    await started(1);
    expect(queue.cancel(slow.job.id)).toBe(true);
    expect(await slow.outcome).toEqual({ state: "cancelled" });
    expect(Date.now() - began).toBeLessThan(SLOW - 2000);
    expect(view(queue.jobs())).toEqual([
      { request: "a drawing board", state: "cancelled", replacedBy: undefined },
    ]);
  });

  it("CLI-06, L-50: a newer request replaces the running and waiting ones, which stay recorded as cancelled, and then runs", async () => {
    const { queue, ask, prompts, started } = setup([reply("late", SLOW), reply("Calculator")]);
    const began = Date.now();
    const running = ask("a shopping list");
    const waiting = ask("a to-do list");
    await started(1);
    const newer = ask("a calculator", { replace: true });
    expect(await running.outcome).toEqual({ state: "cancelled", replacedBy: newer.job.id });
    expect(await waiting.outcome).toEqual({ state: "cancelled", replacedBy: newer.job.id });
    expect(await newer.outcome).toEqual({ state: "done", value: "Calculator" });
    expect(Date.now() - began).toBeLessThan(SLOW - 2000);
    // No request disappears: each keeps its words, and the replaced ones say they weren't done.
    expect(view(queue.jobs())).toEqual([
      { request: "a shopping list", state: "cancelled", replacedBy: newer.job.id },
      { request: "a to-do list", state: "cancelled", replacedBy: newer.job.id },
      { request: "a calculator", state: "done", replacedBy: undefined },
    ]);
    expect(prompts()).toEqual(["a shopping list", "a calculator"]);
  });

  it("CLI-06: the replacing job starts only once the replaced one's process has stopped", async () => {
    const { ask, changes, started } = setup([reply("late", SLOW), reply("Calculator")]);
    const running = ask("a shopping list");
    await started(1);
    const newer = ask("a calculator", { replace: true });
    expect(await newer.outcome).toEqual({ state: "done", value: "Calculator" });
    const order = changes.map((change) => `${change.request}: ${change.state}`);
    expect(order.indexOf("a calculator: running")).toBeGreaterThan(
      order.indexOf("a shopping list: cancelled"),
    );
    expect(await running.outcome).toMatchObject({ state: "cancelled" });
  });

  it("CLI-06: a failed call is recorded as failed with its error, and the next job still runs", async () => {
    const { ask } = setup([
      { type: "result", subtype: "error_max_turns", is_error: true, result: "" },
      reply("Notes"),
    ]);
    const failing = ask("a shopping list");
    const next = ask("some notes");
    const outcome = await failing.outcome;
    expect(outcome).toMatchObject({ state: "failed" });
    expect((outcome as { error: unknown }).error).toBeInstanceOf(Error);
    expect(await next.outcome).toEqual({ state: "done", value: "Notes" });
  });
});

describe("job control without a process (CLI-06)", () => {
  const deferred = () => {
    let resolve!: (value: string) => void;
    const promise = new Promise<string>((done) => (resolve = done));
    return { promise, resolve };
  };

  it("CLI-06: runs as many jobs at once as configured", async () => {
    const queue = new JobQueue({ atOnce: 2 });
    const a = deferred();
    const b = deferred();
    const first = queue.submit("one", () => a.promise);
    const second = queue.submit("two", () => b.promise);
    const third = queue.submit("three", () => Promise.resolve("three"));
    expect(queue.jobs().map((job) => job.state)).toEqual(["running", "running", "queued"]);
    b.resolve("two");
    expect(await third.outcome).toEqual({ state: "done", value: "three" });
    a.resolve("one");
    expect(await first.outcome).toEqual({ state: "done", value: "one" });
    expect(await second.outcome).toEqual({ state: "done", value: "two" });
  });

  /** Work that, once cancelled, takes until `stopped` is called to stop. */
  const slowToStop = () => {
    let stop!: () => void;
    const stopping = new Promise<void>((done) => (stop = done));
    let started = false;
    const work = (signal: AbortSignal) => {
      started = true;
      return new Promise<string>((_, reject) =>
        signal.addEventListener(
          "abort",
          () => void stopping.then(() => reject(new Error("stopped"))),
        ),
      );
    };
    return { work, stopped: () => stop(), started: () => started };
  };
  const turn = () => new Promise((resolve) => setTimeout(resolve, 20));

  it("CLI-06: a replacement waits for the jobs it replaced to stop, even with a place free", async () => {
    const queue = new JobQueue({ atOnce: 2 });
    const old = slowToStop();
    const replaced = queue.submit("a shopping list", old.work);
    let newerStarted = false;
    const newer = queue.submit(
      "a calculator",
      () => {
        newerStarted = true;
        return Promise.resolve("Calculator");
      },
      { replace: true },
    );
    const later = queue.submit("some notes", () => Promise.resolve("Notes"));
    await turn();
    expect(newerStarted).toBe(false);
    expect(queue.jobs().map((job) => job.state)).toEqual(["running", "queued", "queued"]);
    old.stopped();
    expect(await replaced.outcome).toEqual({ state: "cancelled", replacedBy: newer.job.id });
    expect(await newer.outcome).toEqual({ state: "done", value: "Calculator" });
    expect(await later.outcome).toEqual({ state: "done", value: "Notes" });
  });

  it("CLI-06: a replacement of two running jobs starts only once both have stopped", async () => {
    const queue = new JobQueue({ atOnce: 2 });
    const first = slowToStop();
    const second = slowToStop();
    const one = queue.submit("one", first.work);
    const two = queue.submit("two", second.work);
    let newerStarted = false;
    const newer = queue.submit(
      "three",
      () => {
        newerStarted = true;
        return Promise.resolve("three");
      },
      { replace: true },
    );
    first.stopped();
    expect(await one.outcome).toMatchObject({ state: "cancelled" });
    await turn();
    expect(newerStarted).toBe(false);
    second.stopped();
    expect(await two.outcome).toMatchObject({ state: "cancelled" });
    expect(await newer.outcome).toEqual({ state: "done", value: "three" });
  });

  it("CLI-06: a display that throws never strands a job: outcomes settle, the queue drains and the error is passed on", async () => {
    const errors: unknown[] = [];
    const queue = new JobQueue({
      onChange: (job) => {
        if (job.state === "queued" || job.state === "done") throw new Error(`display failed`);
      },
      onChangeError: (error) => errors.push(error),
    });
    const first = queue.submit("one", () => Promise.resolve(1));
    const second = queue.submit("two", () => Promise.resolve(2));
    expect(await first.outcome).toEqual({ state: "done", value: 1 });
    expect(await second.outcome).toEqual({ state: "done", value: 2 });
    expect(queue.jobs().map((job) => job.state)).toEqual(["done", "done"]);
    expect(errors).toHaveLength(4);

    const quiet = new JobQueue({
      onChange: () => {
        throw new Error("display failed");
      },
      onChangeError: () => {
        throw new Error("and so did its report");
      },
    });
    expect(await quiet.submit("three", () => Promise.resolve(3)).outcome).toEqual({
      state: "done",
      value: 3,
    });
  });

  it("CLI-06: refuses a number of jobs at once that isn't a whole number of at least 1", () => {
    for (const atOnce of [0, -1, 1.5, Number.NaN]) {
      expect(() => new JobQueue({ atOnce })).toThrow(RangeError);
    }
  });

  it("CLI-06: a cancel that comes after the work has finished never hides that it was done", async () => {
    const queue = new JobQueue();
    const work = deferred();
    const job = queue.submit("a shopping list", () => work.promise);
    const newer = queue.submit("a calculator", () => Promise.resolve("Calculator"), {
      replace: true,
    });
    work.resolve("Shopping list");
    expect(await job.outcome).toEqual({ state: "done", value: "Shopping list" });
    expect(queue.jobs()[0]).toEqual({ id: job.job.id, request: "a shopping list", state: "done" });
    expect(await newer.outcome).toEqual({ state: "done", value: "Calculator" });
  });

  it("CLI-06: work that throws before it starts waiting is a failed job, not a lost one", async () => {
    const queue = new JobQueue();
    const broken = queue.submit("broken", () => {
      throw new Error("no");
    });
    expect(await broken.outcome).toMatchObject({ state: "failed" });
    expect(await queue.submit("next", () => Promise.resolve(1)).outcome).toEqual({
      state: "done",
      value: 1,
    });
  });
});
