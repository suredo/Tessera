---
type: Test Design
title: "Judging"
description: "How scenarios are judged: host facts, AI technical review and your final verdict."
tags: [testing, judging]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-11T20:21:39Z }
---
# Judging

## Automatic host facts (every step)

These are checked by the runner with no model:
- The tool was created or changed as expected, or not changed when it shouldn't be.
- Data is exactly as expected, and nothing unrelated changed.
- The smoke check and any profile behavior check passed.
- No false success: the message matches what the host applied (`GEN-08`).
- Time, calls and tokens are within the step and scenario budgets.

**First attempt** (A40): an AI-dependent step passes without user retry/rephrasing; automatic repairs are counted separately. Freeze the required AI-step denominator before the run, including steps blocked by an earlier failure. Report numerator/denominator, per-scenario results, repeats, repairs, time and tokens. The 85% target applies only to AI-dependent steps. Deterministic lifecycle steps are scored separately and must all pass. Small samples are milestone evidence, not a population success-rate estimate.

## AI technical review (each scenario, `EVAL-03`)

After a live run, a separate reviewer model receives the requests, the final source of each tool version, the screenshots, the messages and the host facts. It returns a structured review with these items, named as in the scenario's `review` field:

| Item | Question |
| --- | --- |
| `fulfilment` | Does the tool do what was asked, at each step? (yes / partly / no, with evidence) |
| `useful-at-first-sight` | Does a new tool show something meaningful at once, instead of an empty form (`UX-01`)? |
| `standard-style` | Does it follow defaults where unspecified and preserve explicit user styles/custom designs? Does unrelated appearance stay consistent? |
| `controls-work` | Do exercised controls perform their labelled actions? Cite browser/host evidence. Source or screenshots alone cannot prove unexercised controls work; mark those unverified. |
| `accessibility` | Labels, names, focus, contrast, narrow layout |
| `messages` | Plain words, no internal terms, no claims beyond what the host did |
| `code-red-flags` | Startup data writes, reading the system clock instead of the host clock, ignored errors, unbounded loops |
| `coherence` | Does each change build on the last, or does the tool lose or reinvent parts? |

The reviewer receives approved screenshots as image inputs and has no file tools (`CLI-08`). It applies the same rubric whichever model built the tool. Its opinion supplements observed checks and cannot upgrade untested behavior to verified behavior.

## Your final verdict (`EVAL-04`)

Each live evaluation produces a report with the video, screenshots per step, host facts, AI review and costs. You mark each scenario **accept**, **accept with notes** or **reject**, and your notes become lessons and issues. We also track how often the AI review agrees with your verdict, so we learn how far it can be trusted.
