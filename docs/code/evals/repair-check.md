---
type: Code Module
title: "Repair check"
description: "The live check of the repair stage's prompt parts: creations that failed the host's checks, replayed from the slice pilot at no cost, with only their repairs sent to the model through the harness's cap and ledger."
resource: ../../../evals/spikes/repair-check/
implements: [ENG-07, ENG-16]
tests: []
tags: [code, evals, repair, generation]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-27T10:11:48Z }
---

# Purpose

Checks that the repair stage's prompt parts (`GEN-09`) get a real model to fix a creation that failed the host's checks, as `ENG-16` asks of a prompt change while the replay suite (#156) doesn't exist. Its results are in the [repair check report](../../../evals/reports/2026-10-27-repair-check.md).

# Entry points

- `run.ts`: the script. `PLAN` is the approved run (a cap of 3 calls, two cases); `runCheck` runs it and writes `report.json` with each case's class before its repair, its outcome and its repairs, and the ledger's summary. Run it with `node evals/spikes/repair-check/run.ts --dry-run`, or `--live --approved-cap 3` once the owner has approved the budget.
  - The schema-shape case is the slice pilot's first live shopping list, whose defaults lacked the list its schema requires.
  - The static case is the same tool with its defaults right and one added line that builds HTML at run time.
- `replays/repair-check-2026-10-27.json`: the live run's repair answers, for the replay suite (#156).

# Invariants

- **Only repairs reach the model.** Creation's answers come from the [slice pilot](slice-pilot.md)'s replay fixture; every other stage goes through the [evaluation harness](harness.md), which caps, records and logs each call (`ENG-07`).
- **Each case must fail as named before its repair,** or the run stops before any call.
- **The dry run is the exact run** (`ENG-11`), with the fake Claude Code answering each case's fixed tool.
- **Its own data folder** (`ENG-19`), under the run's folder in `test-output/`.

# Depends on / used by

`createTool` and `candidateFrom` from the server, the [evaluation harness](harness.md), the [CLI contract spike](cli-contract-spike.md)'s run modes and providers, and the slice pilot's replay. Nothing depends on it.

# Pitfalls

- **Two cases, one repair each.** It shows the parts work on these failures, not how often repair succeeds; the M2 evaluation measures that.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `run.ts`: `PLAN`, `CaseReport` (type), `runCheck`
