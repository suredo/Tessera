---
type: Code Module
title: "Tool width check"
description: "Two creation cases check comfortable and wide declarations, through a capped provider with a free fake-CLI rehearsal."
resource: ../../../evals/spikes/ui-width/
implements: [APP-01, ENG-07, ENG-16, OBS-02]
tests: [../../../evals/test/ui-width.test.ts]
tags: [code, evals, app, generation]
status: draft
generated: { by: codex/gpt-6, at: 2026-11-21T00:20:00Z }
---

# Purpose

The [live check](../../../evals/reports/2026-11-20-ui-width.md) passed both resulting host-width cases in two calls, with no repairs: the list omitted the optional field and defaulted to comfortable, while the board explicitly declared wide. The recorded answers replay through the host checks in the test, which narrows the answer to a tool before checking its candidate. The remaining two reserves do not authorize a repeat.

Checks the creation prompt's width declaration for the [UI redesign](../../roadmap/ui-redesign.md). The owner approved at most four live calls on 2026-11-20: a focused shopping list and a three-column board, one creation and one repair reserve each. No intent or reviewer calls are made. Expected usage is roughly 16,000 input and 8,000 output tokens without repairs, up to roughly 36,000 input and 16,000 output tokens with both reserves; the ledger records actual usage, including unknowns.

# Entry points

- `run.ts`: `PLAN` freezes the requests, expected widths and call caps. `caseProvider` refuses any other stage or a third call in a case. `runWidthCheck` uses the existing harness and product creation stage. `node evals/spikes/ui-width/run.ts --dry-run` rehearses the exact path with the fake CLI; `--live --approved-cap 4` uses the real CLI after its free setup checks. Run live only within the owner's approved budget.

# Invariants

The harness has its own new evaluation folder under `test-output/evals`, never the person's data. A failed case stops the run; remaining cases stay blocked and counted. A provider error or a third requested call stops it too. The budget never grows. Reports contain candidate width outcomes and costs; answers, prompt-part versions, requests and diagnostics are kept beside them. The check validates declarations and the server's candidate checks, not tool usability or browser layout. No workspace is activated and there is no browser, screenshot or video in this stage-only check.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `run.ts`: `PLAN`, `caseProvider`, `runWidthCheck`
