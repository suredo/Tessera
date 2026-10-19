---
type: Lesson
title: "What worked: keep these"
description: "The designs and practices from the POC that Tessera keeps."
tags: [lessons, what-worked]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-19T00:25:05Z }
---
# What worked: keep these

| Area | What to keep | Evidence |
| --- | --- | --- |
| Core idea | Generated code, not templates, can make useful tools from everyday requests: a study planner with enforced scheduling, notes to flashcards, a drawing tool, a task board, a converter, an event planner | Live runs on Codex and Claude |
| Ownership | **The host owns data, permissions, versions and lifecycle; generated code only presents.** Every safety fix was possible because of this split | All evaluations |
| Sandbox | Opaque-origin child frame, opposite-loopback wrapper, strict CSP and MessageChannel bridge. Passed 13/13 boundary checks every time it was tested; network probes never reached the server | POC boundary evaluations, repeated after each runtime change. The list itself did not come across; the [threat model](../spec/threat-model.md) reconstructs it as SBX-01 to SBX-13 |
| Data safety | Atomic, revision-checked patch batches with stable IDs; stale changes rejected; AI changes never replace whole objects | 250-operation stress test |
| Versions | Immutable, hashed tool versions; staging and rollback; undo that refuses to overwrite newer work | Many live runs |
| Behavior checks | Host-driven checks with synthetic data before activation (study suite, flow suite), with failures sent to repair. They turned "the model says it works" into "the host saw it work" | Study and flow gates live |
| Diagnostics to repair | Precise failure messages fed back to the model fixed problems that vague ones could not | The note-restore check failed 4 times with a vague message and passed first time once the message was precise |
| UI standard | One doc used in prompts, host stylesheets, static checks and a custom mode. Generated tools looked consistent; focus stayed visible | Recorded UI suite 16/16 |
| Engines | Versioned engine modules with pinned dependencies, isolated checks, seeded randomness, and identical results in Node and the browser | Engine browser check 5/5; live extension accepted |
| Research | A cited spec and reference checks before engine acceptance. The POC drafted code first; Tessera requires research before implementation code (SIM-04). The runs recorded models and limitations | Live research probe; planner runs |
| Testing approach | A scripted-provider server running the real pipeline with canned replies; recorded browser runs with video; a budget-guarded live server with a dry-run mode | Used for every test suite and live run in the last two days of the POC |
| Live testing discipline | Approved budgets, hard call caps, rehearsals before spending, per-call logs, and stopping after repeated failure | Phase 4 used 32 calls and found 8 real bugs |
| Model routing | Cheap model for intent and data actions (Haiku/Luna low); stronger model for generation; no silent expensive fallback | Usage ledgers |
