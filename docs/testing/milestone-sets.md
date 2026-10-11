---
type: Test Design
title: "Scenario sets per milestone"
description: "Which scenarios run live at each milestone."
tags: [testing, milestone-sets]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-11T20:21:39Z }
---
# Scenario sets per milestone

| Milestone | Live set | Why these |
| --- | --- | --- |
| M2 (pipeline) | T1, T6, T13, plus a short J6 run (ambiguous, impossible, cancel), without `do` steps (they need verification profiles, from M3). P1 clean setup once in Windows Sandbox | Creation, data, edits and honesty across simple and advanced tiers; first run |
| M3 (verification) | T1, T2 (PT), T3, T5 without export, T10; one unmatched-profile tool | Initial list, filtering, chart, form, scheduling and cards profiles. The unmatched tool tests acceptance checks from the request (`VER-09`). Include changing/removing a scheduling policy. |
| M4 (first release) | T1, T3, T4, T5, T7, T10, T11, T12, T13, T14; T2 and T10 in Portuguese; P1 and P2 | 12 app runs plus 2 platform runs, covering J0–J7. New profiles: items over time (T4), files-in/out editing (T14), search/selection (T7). T12 also exercises time rules. Drawing stays smoke-only. T5 export starts here. |
| M5 (engines) | T9, T16, T17 | Research, engines, simulation profile |
| M6 (hardening) | M4 set across the model matrix (Claude Code models and Codex); T8 article finder; T15 document editor | Consistency whichever model builds the tool; the remaining catalogue apps |

P3 runs scripted in CI from M1. The [roadmap envelopes](../roadmap/budgets.md) must be reconciled against per-stage calls for every required run and review before approval.
