import { randomUUID } from "node:crypto";

// Job control (CLI-06): AI jobs run a set number at a time, one by default, and the rest wait in
// order. A job cancelled while it waits never starts; one cancelled while it runs is stopped
// through its signal. A newer request may replace the jobs before it, which are cancelled and kept,
// marked as replaced. Every request stays in the record with how it ended: none disappears (L-50).

/** How many AI jobs run at once unless configured otherwise (CLI-06). */
export const JOBS_AT_ONCE = 1;

export type JobState = "queued" | "running" | "done" | "failed" | "cancelled";

/** A request and where it stands. A replaced job is cancelled and names the job that replaced it. */
export type Job = Readonly<{
  id: string;
  request: string;
  state: JobState;
  replacedBy?: string;
}>;

/**
 * The work a job does. It stops and rejects once `signal` aborts, as the provider adapters do; if it
 * finishes first, its result stands, so a cancel that comes too late never hides work that was done.
 */
export type JobWork<T> = (signal: AbortSignal) => Promise<T>;

/** How a job ended. A failure carries the work's own error, for the caller to report. */
export type JobOutcome<T> =
  | { state: "done"; value: T }
  | { state: "failed"; error: unknown }
  | { state: "cancelled"; replacedBy?: string };

export type JobQueueOptions = {
  /** How many jobs run at once (CLI-06): a whole number, at least 1. */
  atOnce?: number;
  /** Told of every change to a job, with the job as it now stands. */
  onChange?: (job: Job) => void;
  /**
   * Told when `onChange` throws. The queue carries on regardless, so a broken display never strands
   * a job; by default the error is written to the console.
   */
  onChangeError?: (error: unknown) => void;
};

type Entry = {
  job: Job;
  work: JobWork<unknown>;
  controller: AbortController;
  settle: (outcome: JobOutcome<unknown>) => void;
  /** The running jobs this one replaced: it starts only once they have all stopped. */
  after: Entry[];
};

export class JobQueue {
  readonly atOnce: number;
  readonly #onChange: (job: Job) => void;
  readonly #onChangeError: (error: unknown) => void;
  readonly #entries = new Map<string, Entry>();
  readonly #waiting: Entry[] = [];
  #running = 0;

  constructor(options: JobQueueOptions = {}) {
    const atOnce = options.atOnce ?? JOBS_AT_ONCE;
    if (!Number.isInteger(atOnce) || atOnce < 1) {
      throw new RangeError(`atOnce must be a whole number of at least 1, not ${atOnce}`);
    }
    this.atOnce = atOnce;
    this.#onChange = options.onChange ?? (() => {});
    this.#onChangeError =
      options.onChangeError ??
      ((error) => console.error("A job's change couldn't be passed on:", error));
  }

  /**
   * Queues a request's work, and starts it if a place is free. With `replace`, every job not yet
   * finished is cancelled first and marked as replaced by this one, which starts once they have
   * stopped. `outcome` never rejects: it says how the job ended.
   */
  submit<T>(
    request: string,
    work: JobWork<T>,
    options: { replace?: boolean } = {},
  ): { job: Job; outcome: Promise<JobOutcome<T>> } {
    const id = randomUUID();
    const after: Entry[] = [];
    if (options.replace) {
      for (const entry of this.#entries.values()) {
        if (finished(entry.job.state)) continue;
        if (entry.job.state === "running") after.push(entry);
        this.#cancel(entry, id);
      }
    }
    let settle!: (outcome: JobOutcome<unknown>) => void;
    const outcome = new Promise<JobOutcome<unknown>>((resolve) => (settle = resolve));
    const entry: Entry = {
      job: { id, request, state: "queued" },
      work,
      controller: new AbortController(),
      settle,
      after,
    };
    this.#entries.set(id, entry);
    this.#waiting.push(entry);
    this.#tell(entry.job);
    this.#startNext();
    return { job: entry.job, outcome: outcome as Promise<JobOutcome<T>> };
  }

  /**
   * Cancels a job: one that hasn't started never will, and one that is running is stopped. False
   * if there is no such job or it has already ended.
   */
  cancel(id: string): boolean {
    const entry = this.#entries.get(id);
    if (entry === undefined || finished(entry.job.state)) return false;
    this.#cancel(entry);
    return true;
  }

  /** Every request so far, oldest first, with where it stands. */
  jobs(): Job[] {
    return [...this.#entries.values()].map((entry) => entry.job);
  }

  #cancel(entry: Entry, replacedBy?: string) {
    if (replacedBy !== undefined) this.#update(entry, { replacedBy });
    if (entry.job.state === "queued") {
      this.#waiting.splice(this.#waiting.indexOf(entry), 1);
      this.#end(entry, { state: "cancelled", ...(replacedBy && { replacedBy }) });
    } else {
      entry.controller.abort();
    }
  }

  #startNext() {
    while (this.#running < this.atOnce && this.#waiting.length > 0) {
      // A free place isn't enough for a replacement: the jobs it replaced must have stopped, and
      // the jobs after it wait with it, so none overtakes the newest request.
      if (this.#waiting[0]!.after.some((replaced) => !finished(replaced.job.state))) return;
      const entry = this.#waiting.shift()!;
      this.#running += 1;
      this.#update(entry, { state: "running" });
      const { signal } = entry.controller;
      new Promise<unknown>((resolve) => resolve(entry.work(signal))).then(
        (value) => this.#finish(entry, { state: "done", value }),
        (error: unknown) =>
          this.#finish(
            entry,
            signal.aborted
              ? {
                  state: "cancelled",
                  ...(entry.job.replacedBy !== undefined && { replacedBy: entry.job.replacedBy }),
                }
              : { state: "failed", error },
          ),
      );
    }
  }

  #finish(entry: Entry, outcome: JobOutcome<unknown>) {
    this.#running -= 1;
    // Done work that a replacement came too late to stop was not replaced.
    if (outcome.state === "done" && entry.job.replacedBy !== undefined) {
      entry.job = { id: entry.job.id, request: entry.job.request, state: entry.job.state };
    }
    this.#end(entry, outcome);
    this.#startNext();
  }

  #end(entry: Entry, outcome: JobOutcome<unknown>) {
    this.#update(entry, { state: outcome.state });
    entry.settle(outcome);
  }

  #update(entry: Entry, change: Partial<Job>) {
    entry.job = { ...entry.job, ...change };
    this.#tell(entry.job);
  }

  #tell(job: Job) {
    try {
      this.#onChange(job);
    } catch (error) {
      try {
        this.#onChangeError(error);
      } catch {
        // Nothing more can be told; the job carries on.
      }
    }
  }
}

const finished = (state: JobState) =>
  state === "done" || state === "failed" || state === "cancelled";
