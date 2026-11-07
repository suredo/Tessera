---
type: Evaluation Report
title: "Two passes against one: live comparison plan and results"
description: "The plan for measuring two passes for big tools (GEN-17) against one pass, live, and what happened: the run stopped after three of six runs on its own stop rule, the same check failing twice, a likely false positive of the startup-write check (L-84); 10 of 30 calls used, and the comparison inconclusive."
tags: [reports, live-evaluation, generation]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-07T06:10:11Z }
---

# Two passes against one: live comparison plan, 2026-11-07

This is the plan the live evaluation protocol asks for before any call (`ENG-07`, [live evaluation](../../docs/practices/live-evaluation.md)). It is for [issue 153](https://github.com/suredo/Tessera/issues/153): `GEN-17` says two passes are a starting point, "measured against single-pass generation (time to first useful tool, total time, tokens, pass rate) before it becomes final". Two passes are built and off by default (#250, #251). **The owner approved the 30-call hard cap on 2026-11-07,** raising M2's envelope to about 75. Before the run, the runner option, scenario files and rehearsals below came first, reviewed, with no calls; the [results](#results-stopped-after-three-runs-2026-11-07) follow.

# What is compared

Three big requests, each from the [app catalogue](../../docs/testing/app-catalogue.md) and asking for at least four separate things, so the host's threshold (4 features, a core of 2) makes them in two passes. Each runs **twice, on separate empty data folders**: once in one pass (Tessera as it ships), once in two passes (`twoPass` at its starting point). Each run is one request, nothing else.

| Scenario | The request | What it asks for |
| --- | --- | --- |
| B2, reading list | "I want a list of the books I want to read, with a rating from 1 to 5, a genre for each, a filter by genre and sorting by rating." | list, rating, genre, filter, sort |
| B4, habit tracker | "Help me track three habits every day: walk, read, drink water. Show my streaks, a weekly chart and let me add notes to each day." | habits, daily ticks, streaks, weekly chart, notes |
| B10, study planner | "My exam is in two weeks. Help me organize topics by day, never on Fridays, mark each one done, and show how much is left." | topics, days, the Friday rule, done, progress |

The feature count is the intent stage's, so a request that comes back with fewer than four is made in one pass both times. That pair stays in every denominator, but it **didn't exercise two passes**: a pair exercised them only when its two-pass run made a core and asked for at least one feature after it. Such a pair is never re-run with other words, and its unused calls authorize nothing.

# Measures, frozen before the run

- **First-attempt pass rate:** the request ends with an active tool and, for two passes, every feature added, with no step failing its host facts (`EVAL-02`). Denominator: 3 per mode. Repairs count apart (A40).
- **Time to a first useful tool:** from sending to the first activated version: the one tool in one pass, the core in two passes. This comes from the run's ledger and report (`node evals/src/runner/speed.ts`), with each step's own calls, plus the time the core's staging took.
- **Total time:** from sending until the host had said what happened, every feature included.
- **Tokens:** input (cached apart) and output, per mode, from the ledger.
- **What it made:** the screenshots and video of each run, judged by the owner, as the AI review comes in M3 (`EVAL-03`). This also decides whether the two-pass tool has what the request asked for.

# The decision rule

**The comparison decides only if at least two of the three pairs exercised two passes.** Otherwise it is inconclusive: one pass stays the default, `GEN-17` stays unmeasured, and no replacement calls are authorized; a new plan would need its own approval.

When it decides, two passes become the default (`twoPass` on, at its starting point) only if, across the three pairs:

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

# Expected tokens and time

From the [M2 live run](2026-11-05-m2-live-run.md)'s ledger, the closest measurement: intent about 4,000 input and 500 output tokens; a creation about 8,000 input and 2,500 output; an edit about 9,000 input (the whole tool's code is quoted) and 1,500 output. Big tools are larger, so these are doubled for creation and edits. Estimates, not limits:

| Run | Input tokens | Output tokens | Model time |
| --- | ---: | ---: | ---: |
| One pass, each | about 20,000 | about 5,500 | 15–60 s |
| Two passes, each | about 75,000 | about 14,500 | 60–150 s |
| **Expected, all six** | **about 285,000** (half or more from cache, as in the live run) | **about 60,000** | **4–11 minutes** |
| **With every reserve used** (9 repairs, each about a creation's size) | about 430,000 | about 105,000 | up to 20 minutes |

- **Run order:** pair by pair, B2, B4 then B10, one pass first, then two passes, each on its own empty data folder. Each pair takes a few minutes, so the six runs fit in one sitting, well inside a usage window.
- **A usage limit** pauses the run; finished runs aren't repeated.

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

# Results: stopped after three runs, 2026-11-07

The run started at `0a02a94`, with Claude Code 2.1.319, on the default routes. **It stopped after three of its six runs, as its own stop rule says: the same failure in two runs.** It used **10 of its 30 calls**. The unused 20 authorize nothing; resuming needs the owner's word.

| Run | Calls (cap) | Outcome | Time to a first useful tool | Time as the person waited | Tokens in (cached) / out |
| --- | ---: | --- | ---: | ---: | --- |
| B2, one pass | 2 (3) | **passed**: "Reading List is ready", with ratings, genres, a genre filter and sorting | 22.9 s | 23.4 s | 12,369 (0) / 3,027 |
| B2, two passes | 5 (7) | **failed**: the core and Genre were added; Genre filter didn't pass its checks after its repair, so sorting was never asked for | 22.7 s (the core) | 83.9 s | 53,004 (23,546) / 13,355 |
| B4, one pass | 3 (3) | **failed**: the tool didn't pass its checks after its repair; nothing was made | never: nothing activated | 56.9 s | 24,486 (12,475) / 9,065 |
| B4, two passes; B10, both | — | not run | — | — | — |

- **Time to a first useful tool** is from the server starting the request to the first version's activation, both read from the run's data folder (its `requests` and `workspace_versions`). The runner doesn't record the moment the person sent it, which comes just before. For B2, the core came no sooner than the whole tool did in one pass: 22.7 s against 22.9 s.
- **The B2 two-pass run was said honestly:** "Reading list is ready. … Genre was added. … Genre filter wasn't added: … Your tool and entries were kept." The runner scored it failed, as #253 made it do.
- **The same check failed both runs:** the static check's startup-write rule. It said `data.patch` "writes data during startup" for every write in the code. In both tools each write is in a function that runs only when the person acts: a function passed to `addEventListener`, or called from a handler's closure, never from the startup code. **This looks like a false positive of the check, not a faulty tool** ([L-84](../../docs/lessons/tessera-issues.md)). B4's creation also tripped the rules on property names computed at run time and on `Object.assign`, there on plain objects. Those rules are deliberately conservative (ADR 0009), but their message says "an element or the page".
- **The comparison is inconclusive:** only one pair (B2) ran both ways, below the two exercised pairs the decision needs. One pass stays the default, and `GEN-17` stays unmeasured.
- **What came next:** the owner chose on 2026-11-07 to keep the check as strict. A narrower rule ([#255](https://github.com/suredo/Tessera/pull/255)) let real startup writes through, and was closed. The base prompt now steers the code the check can verify instead. A new run of the comparison needs a new plan and the owner's word; this run's unused 20 calls authorize nothing.

