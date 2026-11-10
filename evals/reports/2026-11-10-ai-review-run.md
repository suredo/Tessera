---
type: Evaluation Report
title: "AI technical review: results"
description: "Results of the AI technical review's first live use under the approved 8-call cap: six reviews of M3's runs in 6 calls, screenshots received as images, every answer complete, all six advised accept with notes, the owner's verdicts and why their agreement isn't yet evidence, and what the reviews found, including one note that was wrong for lack of the tool's starting data."
tags: [reports, live-evaluation, review]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-10T13:30:00Z }
---

# AI technical review: results, 2026-11-10

These are the results of the [AI technical review's live plan](2026-11-10-ai-review-plan.md) (`ENG-07`, `EVAL-03`, `EVAL-04`). **The owner approved its 8-call hard cap on 2026-11-10,** and the reviews ran the same day at `4b3c571` with Claude Code 2.1.321, each with its own cap of 1, in the planned order. There was no provider error, no usage limit, no refused call, and no stop rule reached. Each review is kept with its run and copied, as recorded, to [this report's folder](2026-11-10-ai-review-run/).

| Run | Screenshots sent | Input tokens (cached) | Output tokens | Model time | Advised verdict | Owner's verdict |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| T5, RSVP form | 7 | 14,946 (0) | 2,136 | 17 s | accept with notes | accept with notes |
| T2, reading list (pt-BR) | 6 | 15,395 (1,961) | 2,110 | 17 s | accept with notes | accept with notes |
| T3, spending chart | 6 | 18,706 (1,961) | 1,391 | 11 s | accept with notes | accept with notes |
| T6, tip calculator | 5 | 15,151 (1,000) | 1,442 | 11 s | accept with notes | accept with notes |
| T1, shopping list | 10 | 49,424 (25,258) | 4,229 | 32 s | accept with notes | accept with notes |
| T10's rerun, study planner | 8 | 23,919 (1,961) | 1,625 | 13 s | accept with notes | accept with notes |
| **Total** | **42** | **137,541 (32,141)** | **12,933** | **102 s** | | |

**Calls: 6 of 8.** The 2 in reserve weren't needed and authorize nothing. Input was near the plan's upper estimate of 140,000: T1, with ten screenshots and two versions, took about three times the others.

# Measures

- **Images received: yes.** The first review, T5's, cited what only its screenshots show: the green focus ring on the fields, and the Send answer button cut off at the bottom of the preview. Every later review did the same. This was the first live check of image input (A27), which M2's image check never ran.
- **Answers complete: 6 of 6.** Each answer held exactly the scenario's items, each once, in order (`reviewSchemaFor`).
- **Evidence:** every item named its steps, screenshots, messages or source, such as "Step 6: the fields clear and the history shows 'One record changed' (step-6.png)".
- **Unverified kept unverified: yes.** No control that no step used was marked pass. Controls used in some steps but not others got "partly", and those left unused were named as unverified in the evidence: T6's round-up checkbox, T3's chart-type selector and Remove buttons, and T2's rating and Remove controls.
- **Agreement: 6 of 6 the same, but not yet evidence of agreement.** The owner adopted the reviewer's advised verdict for each run, accept with notes, rather than judging first. The count is recorded as M3's exit criterion asks, with this caveat. In M4's release run, the owner gives each verdict before reading the review, so the count says how far the reviewer can be trusted (`EVAL-04`).

# What the reviews found

Read against the runs' data before any is counted as a defect:

- **The tool's preview is too short.** In almost every run, the list, the results or the main button sat below the visible part of the tool, so neither the screenshots nor the reviewer saw them: T5's answers, T2's book list and filter result, T3's what-if total, T6's large result. This is a layout issue in the host's screens. It also leaves a gap in the evidence, because a screenshot shows only what's in view. Changes to the host's screens are M4's, found by testing real tools in the app ([M4 roadmap](../../docs/roadmap/m4-first-release.md)).
- **T1: "Use again" says the tool opened "with its starting data", and its list was empty.** That is the design: Use again starts from the tool's reusable defaults, which were empty, since the request's own items were its first starting entries. The message is accurate, but the person reads it as if their items should be there. It's a wording question for M4's host screens.
- **T1: "Group them by aisle" left every item under "No aisle".** The request was met as written, since a field was added and no data was lost, but nothing visible changed until the person typed aisles. M4's "useful immediately" guidance covers it (`UX-01`).
- **The host's words "entries" and "records"** came up in T1 and T10 as terms the person may not know (`GEN-12`). This is noted for M4's host screens.
- **T10: "the host said it removed a Friday rule that was never created". This note was wrong.** The planner created the rule as its starting data (`initialState`: `rule-friday`, weekday 5), and "Fridays are fine now" removed it with a real patch, as the step's host facts showed. The review's evidence has each version's source but not its starting data, so the reviewer couldn't see the rule (L-92).

# Against the exit criteria

- **The AI review's agreement with your verdict is recorded:** recorded, 6 of 6, with the caveat above.
- **The reviewer receives approved screenshots as image inputs:** yes, as above.

# Defects and follow-ups

1. **L-92: the review's evidence left out each tool's starting data,** so the reviewer could judge a data change wrong. Fixed after this report: the evidence now has each tool's data at the end and every data change it recorded, with what each record held before. For T10's rerun it shows `rule-friday` (weekday 5) removed by step 4.
2. **The short preview, the "Use again" wording, and "entries" and "records":** recorded for M4's changes to the host's screens.

# Evidence

- **Reviews:** each one as recorded, with the owner's verdict, in [this report's folder](2026-11-10-ai-review-run/), checked to hold nothing private (`ENG-19`).
- **Run folders:** each review's harness ledger and request log, and the review in its run's `report.md`, stay local under `test-output/evals/scenarios/`.
