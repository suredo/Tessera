---
type: Test Design
title: "What a scenario is"
description: "What a real-life test scenario is, its live and replay forms, and how replay stays honest."
tags: [testing, scenarios]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-11T20:21:39Z }
---
# What a scenario is

A scenario is a short story about one person with a goal, played against a real Tessera. It includes:

- **A person and a goal, in everyday words:** "I need a shopping list I can tick off at the store", never "create a list component".
- **An empty start.** The person creates every tool.
- **Several sessions.** "The next day" is a step: the host clock moves forward, the page reloads, the person continues or reopens a saved tool. Waiting is simulated, never real (`RUN-07`). Each scenario sets its starting date and time, so it runs identically every time.
- **Mixed actions:** chat requests, the tool's own controls, undo, save, continue, use again, finding a saved tool by asking, deleting and restoring from the trash.
- **A language.** Most scenarios are in English; a few are in Portuguese (A23).
- **A budget:** the maximum model calls for its live run.

Model-driven scenarios have live and replay forms. P3 is scripted only; P1 also includes clean-machine/manual steps that model-output replay cannot reproduce.

| Form | Runs | Purpose |
| --- | --- | --- |
| **Live** | At milestones, with approval, under its call budget ([ENG-07](../practices/live-evaluation.md)) | Real model behavior |
| **Replay** | In CI on every pull request, no model calls | Recorded answers pass through the real pipeline/checks (`TEST-04`). This protects handling of known outputs; it does not establish that changed prompts/models produce good new outputs. |

**How replay stays honest.** Recorded answers are fed in the order the stages ask for them. If the pipeline now asks for a stage the recording doesn't have (for example, after a prompt or routing change, `ENG-16`), the replay **fails with "needs a new live run"** instead of guessing or passing. Prompt-part versions are compared too: a replay recorded with older prompt parts is flagged as stale in the report.
