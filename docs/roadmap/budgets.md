# Live budget summary

| Milestone | Proposed calls | Purpose |
| --- | ---: | --- |
| M0 | ~33 | Spikes: schema acceptance, locked flags, structured output (~3); intent routing over ~30 requests (~30, Haiku) |
| M1 | 0 | Deterministic core, fully tested offline |
| M2 | ~35 | Pipeline reality check: 3 scenarios, a limits run, probe and image check |
| M3 | ~65 | 5 scenarios and one unmatched tool with reviews, the acceptance-check experiment, the Codex probe |
| M4 | ~140 | 12 app runs plus P1/P2 and reviews; reconcile per-stage costs before approval |
| **Total to the first release** | **~270 provisional** | Offline replay uses no calls; changed prompts and new behavior still need approved live evidence |
| M5 | ~85 | Eight engine scenarios with research, plus T9, T16 and T17 (after the first release); re-derived when M5 starts |

**How the envelopes are derived:** a simple scenario run takes about 10 calls including its AI review (T1's own budget is 9 before review); heavier apps take 12–14. Calls use your plan's allowance, so a long run can reach a usage limit partway through: schedule large runs to fit the usage windows, and track tokens as well as calls (`ENG-07`).

Your own use during the internal alpha (from M2) is separate from these evaluation budgets: it is normal product use on your plan.
