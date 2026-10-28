---
type: Code Module
title: "Smoke repair check"
description: "A browser check of the smoke-repair prompt: canned intent and creation fail on an unlabelled field, only repairs use the capped provider, and activation must preserve the request's entries."
resource: ../../../evals/spikes/smoke-repair/
implements: [ENG-07, ENG-16]
tests: [../../../evals/test/smoke-repair.test.ts]
tags: [code, evals, repair, generation]
status: draft
generated: { by: codex/gpt-6, at: 2026-10-28T03:04:52Z }
---

# Purpose

Rehearses and checks smoke repair from [issue 146](https://github.com/suredo/Tessera/issues/146), through the real app in Chrome. It provides the prompt evidence required by `ENG-16`. A dry run reaches only the fake Claude. The owner approved this run's cap of three calls on 2026-10-28 UTC; approval is specific to this run, not automatic permission to repeat it.

# Entry points

- `run.ts`: `PLAN` caps three repair calls (one expected, two schema/static reserves). `runSmokeRepair` runs one request, records its outcome, screenshot, video, workspace data and the harness ledger under `test-output/evals/`. Build first with `pnpm build`; rehearse with `node evals/spikes/smoke-repair/run.ts --dry-run`. Only after budget approval, use `--live --approved-cap 3`.

# Invariants

- Intent and creation are deterministic replay, never live calls. The canned tool must pass the server checks first. Its missing label must be reported in the first repair's prompt, with the versioned smoke part, before any provider call is spent.
- Only repairs reach the [harness](harness.md), with a hard cap that never grows. There is one required scenario, no automatic retry or reviewer call. Failure ends the run with a report; provider errors follow the product/harness stop rules.
- `cancellableProvider` combines the evaluation's abort signal with each stage's signal and tracks outstanding calls. Browser cleanup aborts and settles those calls before closing application storage or writing the cost summary. A delayed fake-provider test verifies the cancelled call is present in the final ledger.
- Passing requires activation after repair, a field labelled New item, both original entries visible, exactly one workspace and unchanged starting data. The script captures revision 1 before repair and requires only the normal single revision increment from activation. The real browser staging and activation run on an evaluation-only data folder and a free port.

# Limits

The [live check](../../../evals/reports/2026-10-28-smoke-repair.md) passed in one call of the approved three; its sanitized answer is in `replays/smoke-repair-2026-10-28.json` and is replayed through the server checks in the test. One case establishes that the new prompt can repair this failure, not its general success rate. The request and fixture are synthetic; added behavior and the known tool-frame clipping remain outside this check.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `run.ts`: `PLAN`, `cancellableProvider`, `runSmokeRepair`
