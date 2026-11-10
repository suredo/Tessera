---
type: Evaluation Report
title: "Acceptance-check experiment: results"
description: "Results of M3's acceptance-check experiment (VER-09, A49) under the approved 16-call cap: four tools no profile fits, made in 12 calls, each with checks from the request that passed at once; the owner accepted all four and judged 8 of the 9 checks meaningful; the frozen rule says adopt, which the owner chose (A57), after fixing a check that could pass on text shown before its steps (L-93)."
tags: [reports, live-evaluation, verification]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-10T15:40:00Z }
---

# Acceptance-check experiment: results, 2026-11-10

These are the results of the [acceptance-check experiment's live plan](2026-11-10-acceptance-plan.md) (`ENG-07`, `VER-09`, A49). **The owner approved its 16-call hard cap on 2026-11-10,** and [V9-acceptance-checks](../scenarios/V9-acceptance-checks.yaml) ran the same day at `3a9323d` with Claude Code 2.1.321, with the experiment on. There was no provider error, no usage limit, no refused call, and no stop rule reached. The run took 120 s.

| Step | Request | Intent | Checks written | Checks' result | Owner's verdict |
| --- | --- | --- | ---: | --- | --- |
| 1 | A unit converter from kilometres to miles and back | create, no profile | 2 | passed at once | accept |
| 2 | A word counter for pasted text | new tool, no profile | 3 | passed at once | accept |
| 3 | A dice roller for two dice, each die and the total | new tool, no profile | 1 | passed at once | accept |
| 4 | A tip calculator for a bill, a tip percent and people | new tool, no profile | 3 | passed at once | accept |

**Calls: 12 of 16.** Each request used its expected three: intent, acceptance and create. No repair was needed, so the 4 in reserve weren't used, and they authorize nothing.

# The checks, in their own words

Each check's steps go through the hooks the acceptance stage named, and each tool marked every one of them (`data-hook`). A "shows" check looks for its text in the hooked element, capitals and repeated spaces aside. The owner's judgment of each is beside it.

| # | Tool | The check says | Steps, then what is expected | Meaningful |
| --- | --- | --- | --- | --- |
| 1 | km and miles | "Typing 100 kilometres and converting to miles shows about 62.1 miles." | Type 100 in km-input, press to-miles-button; miles-result shows "62.1" | yes |
| 2 | km and miles | "Typing 10 miles and converting to kilometres shows about 16.09 kilometres." | Type 10 in miles-input, press to-km-button; km-result shows "16.09" | yes, the "and back" |
| 3 | Word counter | "Pasting four words shows four words." | Fill text-input with "alpha beta gamma delta"; word-count shows "4" | yes |
| 4 | Word counter | "Pasting four words shows twenty-two characters." | The same text; character-count shows "22" | yes |
| 5 | Word counter | "Pasting two different words shows two words." | Fill "zeta eta"; word-count shows "2" | yes, though close to 3 |
| 6 | Dice roller | "Pressing Roll shows a total of the dice." | Press roll-button; dice-total shows "Total" | **no** |
| 7 | Tip calculator | "Splitting a 100 bill with a 20 percent tip between 4 people shows 30.00 each." | Fill bill, tip and people; amount-per-person shows "30.00" | yes |
| 8 | Tip calculator | "Splitting a 60 bill with a 15 percent tip between 3 people shows 23.00 each." | The same; "23.00" | yes |
| 9 | Tip calculator | "Changing the number of people to 2 on a 100 bill with a 10 percent tip shows 55.00 each." | The same; "55.00" | yes |

**Check 6 proved nothing.** The dice roller's total reads "Total: –" before any roll, so the check passed whether or not Roll did anything. The tool works, as its code shows, so it isn't a wrongly passed tool; but the check couldn't have caught one that didn't (L-93). Every expected value in the others is right: 100 km is 62.14 miles, 10 miles 16.09 km, "alpha beta gamma delta" 22 characters, and the three splits 30.00, 23.00 and 55.00.

# Measures

- **Checks written: 4 of 4.** No request matched a profile, so the experiment applied to each.
- **Meaningful checks: 8 of 9** (89%).
- **The checks' result:** 4 passed at once, none after a repair, none failed. None was stopped by the budget.
- **Wrongly failed: 0.** No good tool was failed or repaired.
- **Wrongly passed: 0.** No tool the owner judged broken was passed, since none was judged broken.
- **Owner's verdicts: accept, 4 of 4.** Judged from each step's screenshot, the video and the tools' code, before the checks were shown. That judgment wasn't fully blind: a tool opens only after its checks pass, so all four opening already said they had passed.
- **Cost:** 12 calls; 77,989 input tokens (49,209 cached), 14,271 output and 85 s of model time. The acceptance stage's share: 4 calls, 21,005 input (12,540 cached), 6,786 output and 38 s, about 9.6 s a request. Its output was three to four times the plan's 500 tokens a call, so the stage adds about 10 s to each new tool that fits no profile.

# The decision

Under the [rule frozen before the run](2026-11-10-acceptance-plan.md#the-adoption-rule-frozen-before-the-run): at least 3 of 4 requests got checks (4), at least 3 in 4 checks were meaningful (8 of 9), and no tool was wrongly failed or wrongly passed. **The rule says adopt.** The owner chose to adopt the checks as the default for new tools that fit no profile, with L-93 fixed first (A57).

What this sample doesn't show, so it is watched in M4's release run:
- **Only "shows" checks were written.** No live check counted a change or expected a text hidden.
- **No check failed,** so no behavior repair from a check ran live, and the wrongly-failed rate rests on four good tools.
- **Four requests** are small-sample evidence, not a population estimate (`docs/testing/judging.md`).

# Defects and follow-ups

1. **L-93: a "shows" check passed on text the tool showed before its steps.** Fixed with this report: such a check now proves nothing, so it neither fails the tool nor counts it as checked against the request, and the stage's prompt asks for what only its steps make the tool show. The run's replay now records the dice roller without "checked against your request", and its other three tools with it.
2. **The tip calculator's result sat below its frame's visible edge** in its screenshot, as the [AI review](2026-11-10-ai-review-run.md) found in most runs. It is the short preview recorded for M4's host screens.
3. **Turning the checks on by default** for new tools that fit no profile follows in its own change (A57).

# Evidence

- **Replay:** the run's recorded answers, checked to hold nothing private (`ENG-19`), are [V9-acceptance-checks.json](../scenarios/replays/V9-acceptance-checks.json), replayed in CI (`EVAL-07`).
- **Run folder:** the report, harness ledger, request log, screenshots and video stay local under `test-output/evals/scenarios/`.
