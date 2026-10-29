---
type: Code Module
title: "Edit check"
description: "Two browser edits of a saved shopping list, with canned intent, capped real edits/repairs, a free rehearsal and preserved entries checked after each activation."
resource: ../../../evals/spikes/edit-check/
implements: [ENG-07, ENG-16]
tests: [../../../evals/test/edit-check.test.ts]
tags: [code, evals, edit, generation]
status: draft
generated: { by: codex/gpt-6, at: 2026-10-29T04:06:00Z }
---

# Purpose

Checks [issue 146](https://github.com/suredo/Tessera/issues/146)'s new edit parts through the real browser/pipeline. The owner explicitly approved one two-case run with a hard cap of four calls: two expected edits plus two repair reserves. No unused earlier smoke budget is reused and a repeat needs new approval.

# Entry points

- `run.ts`: `PLAN` defines the darken and quantity cases; `runEditCheck` runs them in one saved workspace, records screenshots/video, outcomes and the harness ledger. Free mode replays the sanitized live answers. Build first, then rehearse with `node evals/spikes/edit-check/run.ts --dry-run`. The completed one-run live invocation was `--live --approved-cap 4`; another run needs approval.

# Invariants

- Intent is canned by case order, not request-word markers; creation is a hand-written fixture. Only edit/repair calls reach the existing capped harness. Scenario count stays two; a failure stops the run and leaves the next required case blocked and counted. Provider errors end the request/run without retry or a budget increase.
- Each edit must activate a new version in the same workspace, with one normal revision/history increment. The dark edit preserves HTML, JavaScript, declarations and entries and renders the requested colors. The quantity edit preserves ids/titles, gives each entry quantity 1, shows each quantity, and keeps the dark colors. Both rows must be visible before capturing viewport and full-page images (L-76: full-page capture can omit nested-frame content). No tool control is driven; values are inspected in keeping with M2's scenario scope.
- Separate evaluation data and a free port are used. Cleanup reuses the [smoke check](smoke-repair.md)'s tested `cancellableProvider`, aborting/settling model calls before storage closes or cost is summarized.

# Limits

The [live check](../../../evals/reports/2026-10-29-edit-check.md)'s original DOM/data assertions passed both cases in two calls after the exact free rehearsal and fresh-agent review. The intermediate darken screenshot was blank; that case's live visibility is inconclusive (L-76). The runner now waits for visible rows before screenshots and free browser mode replays the recorded answers. The same sanitized answers are replayed sequentially in `edit-check.test.ts`, validating preservation and the migration without live calls. Two cases test these edits, not general edit success or unrelated behavior. Broader replay and semantic verification remain later work; the two unused reserves do not authorize another run.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `run.ts`: `PLAN`, `runEditCheck`
