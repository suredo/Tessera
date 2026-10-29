---
type: Code Module
title: "Chat data check"
description: "Two frozen browser data cases with scripted intent/style, actual replacement approval, capped data calls, and a free rehearsal."
resource: ../../../evals/spikes/chat-data-check/
implements: [ENG-07, ENG-19, GEN-04, DATA-02, DATA-03]
tests: [../../../evals/test/chat-data-check.test.ts]
tags: [code, evals, data, generation]
status: draft
generated: { by: codex/gpt-6.1-sol, at: 2026-10-29T10:31:50Z }
---

# Purpose

Prepares issue [146](https://github.com/suredo/Tessera/issues/146)'s integrated chat-data check. The proposed hard cap is three calls: two expected data plans plus one shared schema/shape repair reserve, no reviewer calls. This proposal does not authorize a live run. The [M2 envelope](../../roadmap/m2-generation-pipeline.md) remains about 35 calls; the owner must reconcile prior spending and explicitly approve this run's cap under the [live evaluation protocol](../../practices/live-evaluation.md).

# Entry points

- `run.ts`: `PLAN` freezes two cases; `SHOPPING` seeds the saved shopping tool with Milk/Eggs and quantities; `REPLIES` supplies the free data answers; `dataOnlyProvider` scripts intent and the mixed style edit, while `runChatDataCheck` drives the real browser, approval and assertions. Build first, then run `node evals/spikes/chat-data-check/run.ts --dry-run`.

# Invariants

- The exact runner and its two-case denominator are shared by free and live modes. Case one adds Bread quantity 1. Case two changes colors and sets Milk quantity 2, retaining Milk, Eggs and Bread and their IDs. Intent and the style edit are scripted by call order. Only the data contract, including one global schema/shape repair reserve, can reach the harness. A provider failure stops later calls; there is no automatic retry or budget increase.
- The mixed case must activate the style before data review; persisted entries must still equal the prior snapshot at review time. The runner inspects the actual host review and clicks its approval button, then checks persisted data and visible runtime rows. Add-only case creates no tool version; the mixed case creates one. HTML, JavaScript and data declarations remain equal to the initial fixture.
- Separate evaluation data and an allocated port isolate the run from real data. The fixed Chrome viewport is 1280 by 800. Result capture scrolls the host to the top and requires all rows in the viewport before viewport and full-page screenshots; video and both review captures are retained too. First failure stops the cases, leaving later required cases blocked and counted. Cleanup aborts and settles pending calls before storage closes and the ledger finishes.

# Depends on / used by

Uses the product pipeline, the [evaluation harness](harness.md), fake CLI adapter and the [smoke check](smoke-repair.md)'s cancellation wrapper. No tool controls are driven, matching M2 scope.

# Pitfalls

This is a narrow integration check, not an intent accuracy or interface generation evaluation. Free canned responses establish runner behavior without measuring model quality. The free rehearsal captured 1,100 system characters per call, request prompts of 774 and 865 characters, and a 3,882-character wrapped schema per call: 11,603 characters total. At about four characters per token this is roughly 2,901 input tokens before CLI/provider overhead. For approval, conservatively estimate 10,000?25,000 input and 1,000?4,000 output tokens total under cap three, including one repair and CLI/provider overhead. These are estimates, not token limits or approved costs. Both data calls route to claude-haiku-5-5. No live cost estimate has yet been approved. The final free rehearsal passed both cases and both viewport images visibly preserve all entries; its actual review shows Milk changing from 1 to 2. Full-page images can shrink, clip or omit nested runtime content despite passing row visibility assertions (L-76). Viewport captures are authoritative runtime evidence; full-page captures are supplementary and must not be described as visually verified. The JSON report records this limit. Run outputs stay under ignored `test-output/evals/`.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `run.ts`: `PLAN`, `SHOPPING`, `REPLIES`, `dataOnlyProvider`, `runChatDataCheck`

