---
type: Code Module
title: "Job control"
description: "AI jobs run one at a time by default, the rest waiting in order: a job cancelled while it waits never starts, one cancelled while it runs is stopped, and a newer request can replace the ones before it, which stay recorded as cancelled."
resource: ../../../packages/server/src/jobs/
implements: [CLI-06]
tests: [../../../packages/server/test/jobs.test.ts]
tags: [code, server, jobs, cli]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-26T22:28:33Z }
---

# Purpose

Keeps every AI request accounted for (`CLI-06`). The POC's ad hoc queue lost both requests when a newer one replaced a running one, and ran a request cancelled while it waited (L-50). Here each request is a job with a state, kept in the record however it ends, so the chat (#132, #150) can show it and mark one that wasn't done.

# Entry points

- `src/jobs/jobs.ts`: `JobQueue` runs jobs. its submit method queues a request's work and returns the `Job` and its `JobOutcome`, cancel cancels one, and jobs lists every request so far with where it stands. `JOBS_AT_ONCE` is the default number of jobs at once; `JobWork` is the work a job does, given a cancel signal.

# Invariants

- **One job at a time unless configured** (`atOnce`, a whole number of at least 1). The rest wait in the order they came; the next starts only when one has ended.
- **A job cancelled while it waits never starts.** Its work is never called, and the jobs after it still run.
- **A job cancelled while it runs is stopped through its signal.** The provider adapters stop the Claude Code process when the signal aborts ([platform](platform.md)), and the job is recorded as cancelled once its work has stopped.
- **A newer request can replace the jobs before it.** With `replace`, every job not yet ended is cancelled and names the job that replaced it, and the new one starts only once they have stopped, so two never write at once. The replaced requests stay in the record with their words, marked as cancelled.
- **No request disappears.** Every job ends as done, failed or cancelled, `outcome` never rejects, and work that throws is a failed job whose error the caller reports.
- **A late cancel never hides done work.** If the work finished before it saw the cancel, the job is done, and a replacement that came too late is not recorded as having replaced it.

# Depends on / used by

Node's `crypto` for job IDs only. Its tests run the [Claude Code adapter](providers.md) on the fake claude program, so a cancel stops a real process. The generation pipeline (#146) will run each request through it, the progress display (#152) will show its jobs and offer cancel, and the chat (#150) will show each request's state.

# Pitfalls

- **Work must stop when its signal aborts** and save nothing after that; the queue can't stop work that ignores it, only wait for it.
- **The record is kept in memory for the session.** Keeping it across restarts belongs with the chat history (#150) and the ledger (#151).

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `index.ts`: `JOBS_AT_ONCE`, `JobQueue`, `Job` (type), `JobOutcome` (type), `JobQueueOptions` (type), `JobState` (type), `JobWork` (type)
- `jobs.ts`: `JOBS_AT_ONCE`, `JobState` (type), `Job` (type), `JobWork` (type), `JobOutcome` (type), `JobQueueOptions` (type), `JobQueue`
