---
type: Code Module
title: "Scenario runner"
description: "Plays a scenario through the host app in Chrome, step by step, with every call through the harness, checks each step's host facts and writes the report; rehearsal and replay modes call no model."
resource: ../../../evals/src/runner/
implements: [EVAL-01, EVAL-02, EVAL-07, TEST-04]
tests: [../../../evals/test/runner.test.ts, ../../../packages/web/e2e/scenario-replays.spec.ts]
tags: [code, evals, scenarios, live-evaluation]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-05T22:27:23Z }
---

# Purpose

The second part of the scenario runner (#155). It plays a [scenario file](scenarios.md) against a real Tessera, as a person would: an empty Tessera on the run's own data folder, the host app in Chrome, and every model call through the [harness](harness.md), which caps and records it. After each step it reads what Tessera stored and checks the step's host facts (`EVAL-02`), then writes a report. A rehearsal plays hand-written answers to try a scenario at no cost; a replay plays a live run's recorded answers (`EVAL-07`, `TEST-04`). A live run (`--live --cap <n>`) calls Claude Code within the owner's approved cap and is recorded as answers that replay offline.

# Entry points

- `src/runner/cli.ts`: `node evals/src/runner/cli.ts <scenario-id> [--replay <answers file> | --live --cap <n>]`, after `pnpm build`. Without a flag it plays the scenario's rehearsal, `evals/scenarios/rehearsals/<id>.json`. `--live` is LIVE: it needs the owner's approved cap (`ENG-07`), runs Claude Code's free checks first (found, recent enough, signed in) and writes the run's answers as `answers.json`. The evidence (report, screenshots, video, ledger, answers) goes to `test-output/evals/scenarios/`.
- `src/runner/run.ts`: `runScenario` plays one scenario (`RunReport`, `StepResult`, `RunMode`); `zonedInstant` is a wall time's instant in a zone. `STEP_LIMIT_MS` is how long a request may take; `NEW_WORKSPACE` is the title of the empty workspace a `switch: new` step opens.
- `src/runner/script.ts`: `answersProvider` answers each call from an answers file (`answersSchema`, `loadAnswers`, `Answers`), one at a time through the scripted provider, so each answer must be for the stage called, and keeps each call they didn't fit and each stale one (`AnswersProvider`). `mapStrings` changes an answer's strings, never its JSON text, so a saved tool's name with quotes or backslashes stays whole.
- `src/runner/messages.ts`: `outcomeOf` reads what a notice claims, in the app's own words from `en.ts`; `say` fills one of them.
- `src/runner/replay.ts`: `replayScenario` plays a scenario from an answers file, a rehearsal or a recorded live run, with no call: the command's rehearsal and replay modes use it, and so does `packages/web/e2e/scenario-replays.spec.ts`, which replays every file in `evals/scenarios/replays/` in CI and expects each live run's report step for step, its failed steps and their problems included (`EVAL-07`, `TEST-04`). A new recording needs its expected failed steps listed there.
- `src/runner/record.ts`: `recordAnswers` turns a run's ledger and request log into answers that replay it (`EVAL-07`); `CANCELLED_WAIT_MS` is how long a cancelled call's answer waits in the replay.
- `src/runner/report.ts`: `reportMarkdown`, the report a person reads.
- `evals/scenarios/rehearsals/`: a rehearsal for each M2 scenario, written by hand: `J6-limits`, `T1-shopping-list`, `T6-tip-calculator` and `T13-drawing-board`. The tools in them pass creation's checks; the calculator works in whole cents, so it shows the catalogue's 100.63 and 25.16 each.

# Invariants

- **The person's way in.** Each step uses the host app's own controls: the request box, the review's Apply, Save to my tools, the offer's Continue and Use again or my tools, History's undo and restore, the trash. A change to existing entries waits for review, and the runner applies it, as the person would. One exception: the app has no control for an empty workspace yet (#132), so `switch: new` makes one through the store and then opens it in the app.
- **The open workspace is read, never chosen.** It comes from the tool panel's `data-workspace-id` hook (`VER-03`). After a reload the runner doesn't reopen anything: whatever the app opens is what the facts check.
- **No model in a rehearsal or a replay.** The harness's dry run refuses a provider that can reach one (`ENG-07`).
- **A live run's cap is the approved one:** it must be given, and may be lower than the scenario file's budget, never higher; the runner checks it before anything starts, and the harness refuses any call past it.
- **A live run becomes a replay** (`EVAL-07`): each call in order, as its parsed answer, a failure as that failure, and a cancelled call as one that waits to be cancelled; a refused call never started and isn't kept. Saved tools' IDs become `{{saved:<name>}}`, and each answer keeps the prompt parts it was recorded with, with the run's commit, time and Claude Code version. A replay asked with other prompt parts still runs, and its report says it is stale (`ENG-16`).
- **Answers that don't fit fail the run.** An answer for a stage the pipeline doesn't ask for next, or a call with no answer left, fails the call. The host shows that as an ordinary failed request, which a step expecting nothing to change would pass, so the answers provider keeps each misfit (`misfits`) and the runner fails its step with "needs a new live run", whatever the host showed (`TEST-04`).
- **A saved tool is named, not numbered, in answers.** IDs are new on every run, so an answer says `{{saved:<name>}}`, filled with that saved tool's ID in the run's own Tessera when the call is made.
- **A cancel has a request to stop.** An answer can take its time (`delayMs`), and a cancel stops it as it would stop a model call.
- **The first step decides the run.** If it fails, the rest are reported as blocked; otherwise every step is played and judged on its own.
- **The run's own data folders** (`ENG-19`): Tessera's under the run folder, refused if it is the real one, and the harness's beside it.
- **The host's clock starts at the scenario's time in its own zone** (`RUN-07`): `zonedInstant` turns the wall time into the instant, across date and daylight-saving changes, for the server and the browser, which also shows the zone. A next-day step moves both a day.
- **A run always ends the same way:** Tessera stops, the harness writes its summary and the report is written, even when Chrome won't start; the steps not played are blocked and the report says why it stopped.

# Depends on / used by

Depends on the [harness](harness.md), the [scenario files and host facts](scenarios.md), the launcher and stores of `@tessera/server`, the web app's build and its `en.ts` messages, and Playwright with the installed Chrome. The M2 live evaluation uses it next.

# Pitfalls

- **Not in CI.** A rehearsal starts Chrome and Tessera and takes about a minute; run it locally, alone (`ENG-31`). Its parts that need no browser are unit-tested.
- **A recorded run is reviewed before it is kept.** `answers.json` holds what the model answered; it is copied into `evals/scenarios/replays/` only after a person checks it holds nothing private (`ENG-19`).
- **Continue and Use again wait for the workspace they open** (L-80): Continue's own, or one that didn't exist before Use again, for up to 30 s, never just any tool panel, since the one already showing would pass on a slow machine. If it never opens, the host facts report it.
- **A notice can be stale.** A step that shows no new message, such as `next-day`, reports the last one (Continue from my tools has its own since L-77); the facts never rely on a notice alone.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `messages.ts`: `outcomeOf`, `say`
- `record.ts`: `CANCELLED_WAIT_MS`, `recordAnswers`
- `replay.ts`: `replayScenario`
- `report.ts`: `reportMarkdown`
- `run.ts`: `STEP_LIMIT_MS`, `NEW_WORKSPACE`, `RunMode` (type), `StepResult` (type), `RunReport` (type), `zonedInstant`, `runScenario`
- `script.ts`: `answersSchema`, `Answers` (type), `loadAnswers`, `mapStrings`, `AnswersProvider` (type), `answersProvider`
