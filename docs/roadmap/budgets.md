---
type: Budget
title: "Live budget summary"
description: "Live-call envelopes per milestone and how they are derived."
tags: [roadmap, budgets]
status: draft
generated: { by: codex/gpt-6, at: 2026-10-29T02:26:15Z }
---
# Live budget summary

| Milestone | Proposed calls | Purpose |
| --- | ---: | --- |
| M0 | ~33 | Spikes: schema acceptance, locked flags, structured output (~3); intent routing over ~30 requests (~30, Haiku) |
| M1 | 0 | Deterministic core, fully tested offline |
| M2 | ~35, **approved** | Pipeline reality check: 3 scenarios, a limits run, probe and image check. The owner approved this envelope on 2026-10-26; each run still gets its plan and hard cap, announced before it starts, within it (`ENG-07`). Used so far: 18 (5 for the adapter's checks, 8 for the [slice pilot](../../evals/reports/2026-10-27-slice-pilot.md)'s two runs, each capped at 6, 2 for the [repair check](../../evals/reports/2026-10-27-repair-check.md), capped at 3, 1 for the [smoke repair check](../../evals/reports/2026-10-28-smoke-repair.md), capped at 3, and 2 for the [edit check](../../evals/reports/2026-10-29-edit-check.md), capped at 4) |
| M3 | ~65 | 5 scenarios and one unmatched tool with reviews, the acceptance-check experiment, the Codex probe |
| M4 | ~140 | 12 app runs plus P1/P2 and reviews; reconcile per-stage costs before approval |
| **Total to the first release** | **~270 provisional** | Offline replay uses no calls; changed prompts and new behavior still need approved live evidence |
| M5 | ~85 | Eight engine scenarios with research, plus T9, T16 and T17 (after the first release); re-derived when M5 starts |

**How the envelopes are derived:** a simple scenario run takes about 10 calls including its AI review (T1's own budget is 9 before review); heavier apps take 12–14. Calls use your plan's allowance, so a long run can reach a usage limit partway through: schedule large runs to fit the usage windows, and track tokens as well as calls (`ENG-07`).

Your own use during the internal alpha (from M2) is separate from these evaluation budgets: it is normal product use on your plan.
