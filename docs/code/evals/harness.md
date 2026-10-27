---
type: Code Module
title: "Evaluation harness"
description: "Wraps any provider for an evaluation run: a hard call cap, a ledger and request log for every call, the run's own data folder, and a dry run that can't reach a model."
resource: ../../../evals/src/harness/
implements: [OBS-02, ENG-07, ENG-19, CLI-04]
tests: [../../../evals/test/harness.test.ts]
tags: [code, evals, live-evaluation]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-27T00:24:24Z }
---

# Purpose

Makes every evaluation run follow the [live evaluation protocol](../../practices/live-evaluation.md) (`ENG-07`) by construction (`OBS-02`). A script calls models only through the harness's provider, which refuses calls past the approved hard cap, records each call in a ledger, with its prompt parts and sizes, and each request in a log, and stops after a provider error. A dry run uses the [scripted provider](../server/providers.md), so the exact script is rehearsed at no cost before any call is spent. The live spikes (#19, #20) are its first users; the scenario runner (M2) builds on it.

# Entry points

- `src/harness/harness.ts`: `startHarness` checks a run's options, creates its data folder and returns the guarded provider, and its `Harness` writes the summary when the run finishes. `HarnessError` means the harness refused a call or a run.
- `src/harness/ledger.ts`: `readLedger`, `readRequestLog` and `summarizeLedger`, and the file names `LEDGER_FILE`, `REQUEST_LOG_FILE` and `SUMMARY_FILE`.
- The ledger and request log entries are contracts, defined in `packages/contracts/src/ledger.ts` with their JSON Schema in `packages/contracts/schemas/` ([contracts package](../contracts/package.md)).

# Invariants

- **The cap is hard.** It is set when the run starts, must be a whole number of at least 1, and never grows. A call past it is refused before it reaches the provider and recorded as `refused`. A call is counted before it starts, so calls made at the same time can't pass the cap together. Raising the budget means a new approval and a new run.
- **A dry run can't reach a model.** It refuses any provider whose `live` is true, and a live run refuses the scripted provider, so the ledger's `mode` is always true.
- **Every call leaves a trace.** Each call, refused ones included, gets a ledger line: stage, model, effort, prompt size, usage and outcome (`ok`, `failed` with its error kind, its plain message and the provider's own words as `detail`, `crashed` for a bug, or `refused`). Each call that started gets a request log line with its prompt and raw answer. Lines are appended as calls end, so a run that breaks keeps what it recorded; a ledger line still gives the time its call started, read before the call.
- **Provider errors stop the run** (`ENG-07`). After a sign-in, usage limit, unavailable model or unsupported effort error, every later call is refused. A usage limit pauses: the rest resumes as a new run once the limit resets.
- **Unknown cost is never 0** (`CLI-04`). The summary counts calls with unknown usage and leaves their unknown parts out of the totals.
- **The run's own data folder** (`ENG-19`). It must be new or empty, so it can never be someone's real data folder, and it holds the ledger, request log and summary.

# Depends on / used by

Depends on `@tessera/contracts` and on the `Provider` interface from `@tessera/server`. Used by the live spikes (#19, #20) and, from M2, the scenario runner.

# Pitfalls

- **The request log holds whole prompts and answers.** Keep run folders out of the repository (`test-output/` is ignored) and sanitize anything before committing it (`ENG-19`).
- **The data folder is not yet checked against the real user data folder,** which doesn't exist until M1 (`PLAT-04`). The "new or empty" rule covers it until then; add the check when the data folder lands.
- **Not yet recorded:** prompt part versions (`ENG-16`) and diagnostics (`OBS-01`), which arrive with the prompts and pipeline in M2. The step-level stop rules (step 1 fails, a step fails twice) belong to the scenario runner.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `harness.ts`: `RunMode` (type), `HarnessOptions` (type), `Harness` (type), `HarnessError`, `startHarness`
- `index.ts`: `HarnessError`, `startHarness`, `Harness` (type), `HarnessOptions` (type), `RunMode` (type), `LEDGER_FILE`, `readLedger`, `readRequestLog`, `REQUEST_LOG_FILE`, `summarizeLedger`, `SUMMARY_FILE`, `LedgerSummary` (type)
- `ledger.ts`: `LEDGER_FILE`, `REQUEST_LOG_FILE`, `SUMMARY_FILE`, `LedgerSummary` (type), `appendLine`, `readLedger`, `readRequestLog`, `summarizeLedger`
