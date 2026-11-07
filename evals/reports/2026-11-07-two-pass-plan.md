---
type: Evaluation Report
title: "Two passes against one: live comparison plan"
description: "The plan for measuring two passes for big tools (GEN-17) against one pass, live: three big requests from the catalogue, each made both ways, the measures and their denominators frozen, a 30-call hard cap, and stop rules, for the owner to approve before any call."
tags: [reports, live-evaluation, generation]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-07T04:44:13Z }
---

# Two passes against one: live comparison plan, 2026-11-07

This is the plan the live evaluation protocol asks for before any call (`ENG-07`, [live evaluation](../../docs/practices/live-evaluation.md)). It is for [issue 153](https://github.com/suredo/Tessera/issues/153): `GEN-17` says two passes are a starting point, "measured against single-pass generation (time to first useful tool, total time, tokens, pass rate) before it becomes final". Two passes are built and off by default (#250, #251). **The owner approved the 30-call hard cap on 2026-11-07,** raising M2's envelope to about 75. Nothing has been run yet: the runner option, scenario files and rehearsals below come first, reviewed, with no calls.

# What is compared

Three big requests, each from the [app catalogue](../../docs/testing/app-catalogue.md) and asking for at least four separate things, so the host's threshold (4 features, a core of 2) makes them in two passes. Each runs **twice, on separate empty data folders**: once in one pass (Tessera as it ships), once in two passes (`twoPass` at its starting point). Each run is one request, nothing else.

| Scenario | The request | What it asks for |
| --- | --- | --- |
| B2, reading list | "I want a list of the books I want to read, with a rating from 1 to 5, a genre for each, a filter by genre and sorting by rating." | list, rating, genre, filter, sort |
| B4, habit tracker | "Help me track three habits every day: walk, read, drink water. Show my streaks, a weekly chart and let me add notes to each day." | habits, daily ticks, streaks, weekly chart, notes |
| B10, study planner | "My exam is in two weeks. Help me organize topics by day, never on Fridays, mark each one done, and show how much is left." | topics, days, the Friday rule, done, progress |

The feature count is the intent stage's, so a request that comes back with fewer than four is made in one pass both times. That case is recorded as such, with its pair compared anyway as two one-pass runs, so it costs no extra call.

# Measures, frozen before the run

- **First-attempt pass rate:** the request ends with an active tool and, for two passes, every feature added, with no step failing its host facts (`EVAL-02`). Denominator: 3 per mode. Repairs count apart (A40).
- **Time to a first useful tool:** from sending to the first activated version: the one tool in one pass, the core in two passes. This comes from the run's ledger and report (`node evals/src/runner/speed.ts`), with each step's own calls, plus the time the core's staging took.
- **Total time:** from sending until the host had said what happened, every feature included.
- **Tokens:** input (cached apart) and output, per mode, from the ledger.
- **What it made:** the screenshots and video of each run, judged by the owner, as the AI review comes in M3 (`EVAL-03`). This also decides whether the two-pass tool has what the request asked for.

# The decision rule

Two passes become the default (`twoPass` on, at its starting point) only if, across the three pairs:

1. their **first-attempt pass rate is no lower** than one pass's;
2. their **time to a first useful tool is shorter** in at least two of the three pairs;
3. their **total tokens are no more than 1.5 times** one pass's; and
4. the owner judges the two-pass tools **at least as complete**.

Otherwise one pass stays the default, the option stays in the code for later measurement, and `GEN-17` is claimed with that measured limit. Either way the result and its numbers go in this report.

# Calls

Routes are the defaults (A18): intent on Haiku 5.5 low, creation and repair on Sonnet 5.5 medium, edits on Sonnet 5.5 low.

| Run | Expected calls | Of which | Repair reserve | Hard cap |
| --- | ---: | --- | ---: | ---: |
| One pass, each of 3 | 2 | 1 intent, 1 create | 1 | 3 |
| Two passes, each of 3 | 5 | 1 intent, 1 core create, 3 feature edits | 2 | 7 |
| **Total** | **21** | | **9** | **30** |

- **Each run has its own hard cap,** enforced by the harness. Unused reserve doesn't move between runs, and doesn't authorize a repeat.
- **M2's envelope** was about 50 calls, with 44 used. The owner raised it to about 75 for this plan's 30-call cap, approved on 2026-11-07.
- **No reviewer calls,** as before.

# Stop rules

- **A provider error** (sign-in, unavailable model, unsupported effort): the harness refuses every later call, and the run stops.
- **A usage limit:** pause; the remaining runs resume after it resets.
- **A run fails at its first call:** that run stops; its pair still runs in the other mode, and the failure counts.
- **The same failure in two runs:** stop, to fix the cause offline before spending more.

# Before the run: what is built, with no calls

One small pull request, reviewed before anything is spent:

- the scenario runner's `--two-pass` option, which starts Tessera with `twoPass` at its starting point;
- the three scenario files, B2, B4 and B10, each a single request with its budget;
- a no-cost rehearsal of each, in both modes, with scripted answers, each passing.
