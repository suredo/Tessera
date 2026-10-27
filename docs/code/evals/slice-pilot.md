---
type: Code Module
title: "End-to-end slice pilot"
description: "The live pilot of the end-to-end slice: two everyday requests through the real app in Chrome, with the harness capping and recording every call, a dry run with the fake Claude Code first, and the answers kept as a replay fixture."
resource: ../../../evals/spikes/slice-pilot/
implements: [ENG-07, ENG-11]
tests: []
tags: [code, evals, pilot, generation]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-27T09:36:03Z }
---

# Purpose

Tries the end-to-end slice of #146 on a real model before more is built on it. Two everyday requests go through the real app: the request box, the intent and create stages, the static check, staging behind the smoke check, and activation. Its results are in the [pilot report](../../../evals/reports/2026-10-27-slice-pilot.md).

# Entry points

- `run.ts`: the script. `PLAN` is the approved run (two requests, a cap of 6 calls, a request limit); `runPilot` runs it and writes `report.json` with each request's message and time, a screenshot of each, a video of the whole run, the workspaces made and the ledger's summary. Run it with `node evals/spikes/slice-pilot/run.ts --dry-run`, or `--live --approved-cap 6` once the owner has approved the budget, after `pnpm build`.
- `replays/pilot-2026-10-27.json` and `replays/pilot-2026-10-27-2.json`: the two live runs' answers, each stage's structured output by call order, for the replay suite (#156).

# Invariants

- **Live only with approval** (`ENG-07`). `--live` refuses to start without `--approved-cap` equal to `PLAN.callCap`, and the [evaluation harness](harness.md) refuses every call past it and records each in its ledger and request log.
- **The dry run is the exact run** (`ENG-11`): the same script and app, with the provider swapped for the product adapter on the fake claude program, answering from canned envelopes.
- **Its own data folders** (`ENG-19`): Tessera's and the harness's, under the run's folder in `test-output/`, never the person's.
- **The real app, in Chrome**, driven by Playwright through its request box. A request is done when the box takes requests again and the app has said something new.

# Depends on / used by

The [evaluation harness](harness.md), the [CLI contract spike](cli-contract-spike.md)'s run modes and providers, the launcher, and Playwright. Nothing depends on it; the scenario runner (#155) replaces it for the M2 evaluation.

# Pitfalls

- **It needs the built app** (`packages/web/dist`); without it, it stops before any call.
- **Its pictures can lag under load.** On a busy machine a headless screenshot, or the video's last frames, can catch a tool before it is fully painted and make it look narrow; the run's report found the app itself sizes the frame right. Watch the video before reading a screenshot as a defect.
- **No tests of its own.** It is a one-off run, rehearsed by its dry run; the pipeline it drives has its own tests.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `run.ts`: `PLAN`, `RequestReport` (type), `runPilot`
