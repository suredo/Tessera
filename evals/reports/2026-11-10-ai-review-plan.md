---
type: Evaluation Report
title: "AI technical review: live plan"
description: "The plan for the AI technical review's first live use: reviewing M3's six recorded scenario runs (T1, T2 in Portuguese, T3, T5, T6, and T10's rerun) with screenshots as image inputs, with what it checks, a hard cap of 8 calls, expected tokens and time, and stop rules. No call is made before the owner approves the cap."
tags: [reports, live-evaluation, review]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-10T12:00:00Z }
---

# AI technical review: live plan, 2026-11-10

**The owner approved the 8-call cap on 2026-11-10, and the reviews ran the same day: [the results](2026-11-10-ai-review-run.md).**

This is the plan the live evaluation protocol asks for before any call (`ENG-07`, [live evaluation](../../docs/practices/live-evaluation.md)). It covers the AI technical review (`EVAL-03`, A22, A27) of M3's recorded scenario runs, through [the review command](../../docs/code/evals/review.md). **Nothing runs until the owner approves the hard cap below.** The command's rehearsal, which goes through the same path with a canned answer, reviewed T10's rerun at no cost.

# What it is for

M3's roadmap asks for an "AI technical reviewer, receiving approved screenshots as image inputs, and the human verdict in the evaluation report" ([M3 roadmap](../../docs/roadmap/m3-verification-and-codex.md)), with the exit criterion "the AI review's agreement with your verdict is recorded". This run answers:

- **Do the screenshots reach the model as images?** The review sends them in a stream-json message, never as files (A27, `CLI-08`). This was never checked live; M2's image check didn't run. The first call answers it.
- **Does the review answer what the rubric asks, with evidence?** Each scenario's items, each once, marked with the steps, screenshots, messages or source that show it.
- **How far does it agree with the owner?** The owner then gives each scenario a verdict: accept, accept with notes or reject. The review's advised verdict is compared with it.

It does not cover the acceptance-check experiment (`VER-09`), which gets its own plan.

# The runs reviewed

The six M3 runs that made a tool, from the [M3 live run](2026-11-09-m3-live-run.md), each from its folder under `test-output/evals/scenarios/`, as recorded on 2026-11-09. T10's first run made no tool, so only its rerun is reviewed.

| Run | Steps | Tools (versions) | Screenshots sent | Review items |
| --- | ---: | --- | ---: | ---: |
| T5, RSVP form | 7 | 1 (1) | 7 | 8 |
| T2, reading list (pt-BR) | 6 | 1 (1) | 6 | 8 |
| T3, spending chart | 6 | 1 (2) | 6 | 8 |
| T6, tip calculator | 5 | 1 (3) | 5 | 7 |
| T1, shopping list | 10 | 1 (2) | 10 | 7 |
| T10's rerun, study planner | 8 | 2 (2) | 8 | 8 |

- **Item counts corrected after approval:** T6 and T1 ask for 7 items, not 8, since their scenarios leave out `controls-work`. The plan first said 8 for both. Nothing else changes: the items come from the scenario files.
- **Route:** the review stage's default, Claude Sonnet 5.5 at medium effort, on Claude Code (2.1.321).
- **Order:** T5 first, the smallest, as the image check. Then the others from smallest to largest.
- **Each review** goes through its own capped harness, with the scenario's rubric items. The answer must hold exactly those items, each once, in order (`reviewSchemaFor`).
- **The T10 rerun's folder** keeps its earlier rehearsal's `review-harness`, moved aside before the live review.

# Measures

- **Images received:** whether the first review's answer cites what only its screenshots show, such as a layout or a colour. If it says it can't see them, or the call fails on the image message, the image input doesn't work.
- **Answers complete:** reviews whose answer held every item asked, out of 6. One that fails the shape is counted, never retried within this cap.
- **Evidence:** for each item, whether its evidence names a step, a screenshot, a message, a host fact or source, read by the owner.
- **Unverified kept unverified:** no control that no step used is marked pass. Read against the run's steps.
- **Agreement:** the owner's verdict for each of the six runs, beside the review's advised one. Agreement is reported as counts, such as "4 of 6 the same", not as a rate.
- **Cost:** calls, input tokens (cached apart), output tokens and model seconds, from each review's harness.

# Calls

| | Calls |
| --- | ---: |
| Reviews, one each | 6 |
| Reserve: one more review of a run whose first failed for a cause fixed offline, with the owner's consent | 2 |
| **Hard cap** | **8** |

- **Each review's own cap** is 1, set on its command (`--cap 1`). The reserve is used only as the stop rules allow, one review at a time, each still capped at 1.
- **M3's envelope** is about 65 calls, with 38 used ([budgets](../../docs/roadmap/budgets.md)). This cap of 8 leaves about 19 for the acceptance-check experiment, which comes with its own plan.

# Expected tokens and time

From T10's rehearsal: a prompt of about 26,500 characters with 8 screenshots, the largest of the six.

- **Input:** text, about 3,000 to 7,500 tokens. Images, about 1,400 tokens each at 1280 × 800, so about 7,000 to 14,000. In all, about 10,000 to 21,000 tokens for each review.
- **Output:** about 1,500 to 3,000 tokens: 8 items with their evidence, a verdict and notes.

| Run | Input tokens | Output tokens | Model time |
| --- | ---: | ---: | ---: |
| **Expected, all six** | about 100,000 | about 15,000 | 5–12 minutes |
| **With the reserve used** | about 140,000 | about 21,000 | up to 16 minutes |

The six fit in one sitting, inside a usage window.

# Stop rules

As the protocol says:
- **The first review fails on its images** (the call is refused, or the answer says no image arrived): stop. Fix the image message offline and ask before spending more.
- **A review fails:** don't retry. The next run is still reviewed. A second failure of the same kind stops the run, to fix the cause offline.
- **A provider error** (sign-in, unavailable model): stop.
- **A usage limit:** pause, then resume the remaining runs after it resets. Finished reviews aren't repeated.

# Record

- **Each run's folder:** `review.json` and the review section of `report.md` (`EVAL-03`), and the review's harness ledger and request log.
- **A results report** in `evals/reports/`, with each review's marks, its advised verdict, the owner's verdict once given, the agreement counts, and the cost. A sanitized copy of each review goes beside it.
- **Defects:** every defect gets a lessons entry, a replay test and a fix (`ENG-13`).

**Asking for:** approval of the 8-call hard cap above, in M3's envelope of about 65.
