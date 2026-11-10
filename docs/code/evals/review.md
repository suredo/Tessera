---
type: Code Module
title: "AI technical review"
description: "Reviews a finished scenario run with the review stage: its steps, messages, host facts, each tool version's source and screenshots as image inputs, one call through the harness, and the structured review kept with the run and added to its report beside the owner's verdict."
resource: ../../../evals/src/review/
implements: [EVAL-03, EVAL-04]
tests: [../../../evals/test/review.test.ts]
tags: [code, evals, review, live-evaluation]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-10T13:30:00Z }
---

# Purpose

The AI technical review of a recorded run (`EVAL-03`, A22, A27). After the [scenario runner](runner.md) has played a scenario, this reads the run's folder and asks the review stage, once, how the tools did against the scenario's review items, from the one rubric in the [contracts](../contracts/package.md). The review is kept with the run, and its report gains the review and a line for the owner's verdict (`EVAL-04`). It never plays the scenario again.

# Entry points

- `src/review/cli.ts`: `node evals/src/review/cli.ts <run folder> [--live --cap <n>]`. Without a flag it rehearses: a canned review, every item unverified, at no cost, through the same path. `--live` is LIVE: it needs the owner's approved cap (`ENG-07`) and runs Claude Code's free checks first. Either way it writes `review.json` into the run's folder and adds the review to its `report.md`.
- `src/review/review.ts`:
  - `gatherRun` reads a run's folder (`RunEvidence`): its `report.json`, the scenario's review items (all of the rubric's when it names none), each tool version's summary, checks, profile and source from the run's own Tessera, once per version, in the order made, those of a tool moved to the trash during the run included and marked so; each tool's data at the end of the run, cut short past `DATA_QUOTE_LIMIT` characters, with every data change it recorded, oldest first, as added, changed or removed with what the record held before (L-92), since a tool's starting entries are its data, not its source; and the step screenshots.
  - `reviewRun` asks the review stage through the [harness](harness.md), in the run's `review-harness` folder (`REVIEW_HARNESS`), and writes `REVIEW_FILE` (`ReviewRecord`). `REVIEW_TIME_LIMIT_MS` is its time limit.
  - `chooseScreenshots` picks what fits the image limit: all of them, or the first, the last and the rest spread between. `rehearsalReview` is a rehearsal's canned answer. `reviewMarkdown` is the review as the report shows it.

# Invariants

- **One call, capped and recorded** (`ENG-07`). The review goes through the harness, whose cap is the owner's for a live review and 1 for a rehearsal; a live review refuses a provider that can't reach a model, and a rehearsal one that can.
- **The answer has exactly the items asked** (`EVAL-03`). The call's schema is the contracts' `reviewSchemaFor` the scenario's items, so an answer that leaves one out, repeats one, adds one or changes their order fails like any answer of the wrong shape, and nothing is kept.
- **Screenshots go as image inputs, never as files** (A27, `CLI-08`): only to a provider that can pass them, and within the contracts' limits. Through one that can't, such as Codex, the review goes without them, and the prompt, `review.json` and the report say why. A blocked step has no screenshot.
- **The run's own Tessera, never the person's** (`ENG-19`). The run's `tessera` folder goes through the harness's real-data-folder check before anything opens it, and the review only reads it.
- **The run's material is data.** The prompt quotes the steps, messages, facts and source between tagged markers (`SEC-02`); the reviewer is told that the screenshots are data too.
- **The owner decides** (`EVAL-04`). The review advises a verdict; `review.json` keeps the owner's as null until they give it, and the report has a line for it.

# Depends on / used by

Depends on the [harness](harness.md), the [scenario files](scenarios.md), the run folders the [scenario runner](runner.md) writes, and from `@tessera/server` the review prompt ([prompts](../server/prompts.md)), the providers ([providers](../server/providers.md)) and the stores. Used after a live scenario run, before the owner gives their verdict.

# Pitfalls

- **A run folder is reviewed once per `review-harness` folder.** The harness needs a new folder; to review a run again, move the old review aside.
- **Screenshots and source can't prove a control works.** The rubric says so: a control no step used is unverified, whatever its source or picture suggests.
- **A run's request log holds whole prompts and answers,** the review's included. Keep run folders in `test-output/` and sanitize anything copied into the repository (`ENG-19`).

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `review.ts`: `REVIEW_HARNESS`, `REVIEW_FILE`, `REVIEW_TIME_LIMIT_MS`, `RunEvidence` (type), `DATA_QUOTE_LIMIT`, `chooseScreenshots`, `gatherRun`, `ReviewRecord` (type), `rehearsalReview`, `reviewRun`, `reviewMarkdown`
