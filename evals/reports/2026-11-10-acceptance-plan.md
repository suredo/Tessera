---
type: Evaluation Report
title: "Acceptance-check experiment: live plan"
description: "The plan for M3's acceptance-check experiment (VER-09, A49): four requests for tools no profile fits, each made with checks written from the request, in the V9 scenario; the measures and adoption rule frozen before the run; a hard cap of 16 calls in M3's envelope; expected tokens and time; and stop rules. No call is made before the owner approves the cap."
tags: [reports, live-evaluation, verification]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-10T22:00:00Z }
---

# Acceptance-check experiment: live plan, 2026-11-10

This is the plan the live evaluation protocol asks for before any call (`ENG-07`, [live evaluation](../../docs/practices/live-evaluation.md)). It covers M3's acceptance-check experiment (`VER-09`, A49): "the VER-09 report gives meaningful, wrongly-failed and wrongly-passed rates against your verdicts, with a decision on adopting it" ([M3 roadmap](../../docs/roadmap/m3-verification-and-codex.md)). **Nothing runs until the owner approves the hard cap below.** Its scenario's rehearsal passes at no cost.

# What runs

[V9-acceptance-checks](../scenarios/V9-acceptance-checks.yaml), with Tessera's acceptance-check experiment on. It makes four tools that no verification profile fits, one request each, each in a new workspace:

| Step | Request | What a meaningful check could show |
| --- | --- | --- |
| 1 | A unit converter from kilometres to miles and back | Typing 10 km shows about 6.2 miles |
| 2 | A word counter for pasted text | Pasting a sentence shows its word count |
| 3 | A dice roller for two dice, each die and the total | Rolling shows two dice and a total; the values are random |
| 4 | A tip calculator for a bill, a tip percent and people | A bill of 100, 10% and 2 people shows 55 each |

For each one:
1. The intent stage decides.
2. If no profile fits, the acceptance stage writes up to three checks from the request alone.
3. Creation is told their hooks and what they check, as quoted data.
4. Staging runs them after the smoke check. A failure gets one behavior repair.

The routes are the defaults (A18): intent and acceptance on Haiku 5.5 low, creation and repair on Sonnet 5.5 medium, all on Claude Code. Only creation runs, because only a new tool gets checks.

Step 3 is chosen on purpose: a dice roller's values can't be predicted, so a meaningful check must look at something other than a value, such as two dice and a total. Step 4 overlaps T6, so its checks can be compared with what the AI review found there.

# Measures, frozen before the run

Each is counted per request, out of 4. A request blocked by an earlier failure stays in the denominator.

- **Checks written:** the acceptance stage answered checks; or none, with its reason; or failed. A profile matched instead is reported apart: the experiment doesn't apply to that request.
- **Meaningful checks:** for each check written, the owner judges whether it tests what the request asked through the tool's own controls. Reported as meaningful checks out of all checks written.
- **The checks' result:** passed at once, passed after their one behavior repair, or failed after it. A request the cap refused before its tool was made is counted apart, as stopped by the budget, and stays in the denominator.
- **Wrongly failed:** a tool the owner judges does what was asked, but whose checks failed it, with or without a repair. This is the cost: a good tool refused or needlessly repaired.
- **Wrongly passed:** a tool the owner judges doesn't do what was asked, in something a check claimed to cover, yet the checks passed. This is the risk: false confidence.
- **Owner's verdict on each tool:** accept, accept with notes, or reject, given before reading the checks' results.
- **Cost:** calls, input tokens (cached apart), output tokens and model seconds, with the acceptance stage's share apart.

# The adoption rule, frozen before the run

With four requests, the rates are small-sample evidence, not a population estimate (`docs/testing/judging.md`). The rule is set now, so the result can't shape it:

- **Adopt as the default for tools that fit no profile** only if:
  1. at least 3 of the 4 requests got checks, and
  2. at least 3 of every 4 checks written are meaningful, and
  3. no tool was wrongly failed, and
  4. no tool was wrongly passed.
- **Keep it as an experiment, off by default,** and measure it again in M4's release run, which has 14 scenarios, if it meets 1 and 2 but not 3 or 4, or if the sample is too thin to say.
- **Drop it** if fewer than 2 requests got checks, or fewer than half the checks are meaningful.

The owner decides on the result, and the decision is recorded as a decision-log entry.

# Calls

| | Each request | All four |
| --- | ---: | ---: |
| Intent | 1 | 4 |
| Acceptance | 1 | 4 |
| Create | 1 | 4 |
| **Expected** | **3** | **12** |
| Reserve, shared by the four: repairs | | 4 |
| **Hard cap** | | **16** |

- **The hard cap is the whole scenario's,** the scenario file's budget, enforced by the harness. It has no allowance for each request: the reserve is shared, and a call past the cap is refused.
- **What one request may spend:** the pipeline gives each creation one repair of each kind of failure: its data's shape, the static check, the smoke check, and the behavior check, which the checks from the request count as (`GEN-09`). So a request may use up to 7 calls: intent, acceptance, create and four repairs. One that uses more than its 3 leaves less for the later ones, which the cap may then stop. That is counted as above, never retried within the cap.
- **No retries:** a request whose checks fail again after their behavior repair is counted as failed.
- **M3's envelope** is about 65 calls, with 44 used ([budgets](../../docs/roadmap/budgets.md)). This cap of 16 leaves about 5.

# Expected tokens and time

From the M3 live run's ledgers:
- **Intent:** about 5,000 input and 500 output tokens.
- **Acceptance:** about 3,000 input and 500 output, Haiku.
- **Create:** about 10,000 input (a few hundred more for the checks) and 3,000–10,000 output.

| Run | Input tokens | Output tokens | Model time |
| --- | ---: | ---: | ---: |
| **Expected, four requests** | about 75,000 | about 25,000 | 3–6 minutes |
| **With every reserve used** | about 130,000 | about 45,000 | up to 10 minutes |

One scenario run takes about 5 to 10 minutes, in one sitting.

# Stop rules

The ones the runner and harness enforce:
- **The first request fails** (no tool made): the runner stops the scenario, and the later requests aren't asked.
- **A provider error** (sign-in, unavailable model, usage limit): the harness refuses every later call, and the run stops. The runner can't resume part of a scenario, so after a usage limit the requests left unmade are reported as stopped. Running the scenario again needs the owner's approval of a new cap.

Not a stop:
- **An acceptance stage that answers none, or can't be used.** Each costs one Haiku call, and the tool is still made and measured, without checks. So each is counted under "checks written", and the run goes on. If it happens for every request, the result is plain: the experiment is dropped under the rule above, at the cost of four cheap calls.
- **Anything else,** such as two requests failing the same way, is seen in the report after the run, not stopped on: the runner doesn't stop on it. With four requests, at most 16 calls can be spent either way.

# Record

- **The run's folder:** report, harness ledger, request log, each step's screenshot and the video, under `test-output/evals/scenarios/`. Its recorded answers become a replay in `evals/scenarios/replays/` (`EVAL-07`).
- **A results report** in `evals/reports/`, with:
  - each request's checks, in their own words;
  - the owner's judgment of each check, and their verdict on each tool;
  - the measures above;
  - the decision under the frozen rule.
- **Defects:** every defect gets a lessons entry, a replay test and a fix (`ENG-13`).

**Asking for:** approval of the 16-call hard cap above, in M3's envelope of about 65.
