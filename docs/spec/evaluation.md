---
type: Requirement Area
title: "Evaluation"
description: "Scenario files, host facts, AI review, human verdict, model matrix and replays (EVAL-01 to EVAL-07)."
tags: [spec, evaluation]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-11T20:21:39Z }
---
# Evaluation (`EVAL`)

Details, the scenario format and the test application catalogue are in [the test scenario docs](../testing/index.md).

| ID | Requirement |
| --- | --- |
| EVAL-01 | **Scenario files.** Real-life scenarios are data files (`evals/scenarios/*.yaml`): a person, a goal, a language, a budget, and steps (`say`, `do`, `next-day`, `reload`, `save`, `continue`, `use-again`, `undo`, `cancel`, `switch`, `delete`, `restore`) with expected host facts. Every scenario starts from an empty Tessera. |
| EVAL-02 | **Automatic host facts.** The runner checks every step without a model: created or changed as expected, data exact, nothing unrelated changed, checks passed, no false success, within budget. |
| EVAL-03 | **AI technical review.** A separate reviewer scores fulfilment, defaults or explicitly requested styles, exercised controls, accessibility, messages, code and coherence, with evidence. Use the same rubric regardless of generator model. Screenshots arrive as approved image inputs; the reviewer has no file tools (CLI-08, A27). Unexercised behavior remains unverified; screenshots/source alone do not prove controls work. Store the structured review with the run. |
| EVAL-04 | **Human final verdict.** Each live evaluation produces a report with video, screenshots per step, host facts, the AI review and costs. The product owner marks each scenario accept, accept with notes, or reject. Agreement between the AI review and the human verdict is tracked. |
| EVAL-05 | **Model matrix.** Selected scenarios run with different generation models (for example Sonnet, Opus and Codex), so tool quality and style consistency can be compared across models. |
| EVAL-06 | **Languages.** A few scenarios are in Portuguese (A23). They check that generated tools follow the person's language while the host stays English. |
| EVAL-07 | **Live runs become replays.** The outputs of each approved live run are stored as a replay scenario and run in CI (`TEST-04`). |
