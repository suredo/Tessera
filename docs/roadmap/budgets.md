---
type: Budget
title: "Live budget summary"
description: "Live-call envelopes per milestone and how they are derived."
tags: [roadmap, budgets]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-07T04:54:43Z }
---
# Live budget summary

| Milestone | Proposed calls | Purpose |
| --- | ---: | --- |
| M0 | ~33 | Spikes: schema acceptance, locked flags, structured output (~3); intent routing over ~30 requests (~30, Haiku) |
| M1 | 0 | Deterministic core, fully tested offline |
| M2 | ~75, **approved** | Pipeline reality check: 3 scenarios, a limits run, probe and image check, and the comparison of two passes with one. The owner approved an envelope of about 35 on 2026-10-26, raised it to about 50 on 2026-11-05 by approving the [M2 live run](../../evals/reports/2026-11-05-m2-live-run.md)'s 29-call cap, and to about 75 on 2026-11-07 by approving the [two-pass comparison](../../evals/reports/2026-11-07-two-pass-plan.md)'s 30-call cap; each run still gets its plan and hard cap, announced before it starts, within it (`ENG-07`). Used so far: 44 (23 for the [M2 live run](../../evals/reports/2026-11-05-m2-live-run.md), capped at 29 across its four scenarios; 5 for the adapter's checks, 8 for the [slice pilot](../../evals/reports/2026-10-27-slice-pilot.md)'s two runs, each capped at 6, 2 for the [repair check](../../evals/reports/2026-10-27-repair-check.md), capped at 3, 1 for the [smoke repair check](../../evals/reports/2026-10-28-smoke-repair.md), capped at 3, 2 for the [edit check](../../evals/reports/2026-10-29-edit-check.md), capped at 4, 2 for the [chat-data check](../../evals/reports/2026-10-29-chat-data-check.md), capped at 3, and 1 for the [bridge edit check](../../evals/reports/2026-10-30-bridge-edit-check.md), capped at 2; unused reserves do not authorize repeats) |
| M3 | ~65 | 5 scenarios and one unmatched tool with reviews, the acceptance-check experiment, the Codex probe |
| M4 | ~140 | 12 app runs plus P1/P2 and reviews; reconcile per-stage costs before approval |
| **Total to the first release** | **~315 provisional** (M0 to M4 as above) | Offline replay uses no calls; changed prompts and new behavior still need approved live evidence |
| M5 | ~85 | Eight engine scenarios with research, plus T9, T16 and T17 (after the first release); re-derived when M5 starts |

**How the envelopes are derived:** a simple scenario run takes about 10 calls including its AI review (T1's own budget is 9 before review); heavier apps take 12–14. Calls use your plan's allowance, so a long run can reach a usage limit partway through: schedule large runs to fit the usage windows, and track tokens as well as calls (`ENG-07`).

Your own use during the internal alpha (from M2) is separate from these evaluation budgets: it is normal product use on your plan.
