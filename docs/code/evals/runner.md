---
type: Code Module
title: "Scenario runner"
description: "Plays a scenario through the host app in Chrome, step by step, with every call through the harness, checks each step's host facts and writes the report; rehearsal and replay modes call no model."
resource: ../../../evals/src/runner/
implements: [EVAL-01, EVAL-02, EVAL-07, TEST-04, OBS-04]
tests: [../../../evals/test/runner.test.ts, ../../../evals/test/speed.test.ts, ../../../packages/web/e2e/scenario-replays.spec.ts, ../../../packages/web/e2e/scenario-do.spec.ts]
tags: [code, evals, scenarios, live-evaluation]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-09T12:38:06Z }
---

# Purpose

The second part of the scenario runner (#155). It plays a [scenario file](scenarios.md) against a real Tessera, as a person would: an empty Tessera on the run's own data folder, the host app in Chrome, and every model call through the [harness](harness.md), which caps and records it. After each step it reads what Tessera stored and checks the step's host facts (`EVAL-02`), then writes a report. A rehearsal plays hand-written answers to try a scenario at no cost; a replay plays a live run's recorded answers (`EVAL-07`, `TEST-04`). A live run (`--live --cap <n>`) calls Claude Code within the owner's approved cap and is recorded as answers that replay offline.

# Entry points

- `src/runner/cli.ts`: `node evals/src/runner/cli.ts <scenario-id> [--replay <answers file> | --live --cap <n>] [--two-pass]`, after `pnpm build`. Without a flag it plays the scenario's rehearsal, `evals/scenarios/rehearsals/<id>.json`. `--two-pass` starts Tessera with big tools made in two passes at their starting point (`GEN-17`), plays `<id>.two-pass.json` as the rehearsal, names the run's folder and report so, and records it in the report. `--live` is LIVE: it needs the owner's approved cap (`ENG-07`), runs Claude Code's free checks first (found, recent enough, signed in) and writes the run's answers as `answers.json`. The evidence (report, screenshots, video, ledger, answers) goes to `test-output/evals/scenarios/`.
- `src/runner/run.ts`: `runScenario` plays one scenario (`RunReport`, `StepResult`, `RunMode`); `zonedInstant` is a wall time's instant in a zone. `STEP_LIMIT_MS` is how long a request may take; `NEW_WORKSPACE` is the title of the empty workspace a `switch: new` step opens.
- `src/runner/script.ts`: `answersProvider` answers each call from an answers file (`answersSchema`, `loadAnswers`, `Answers`), one at a time through the scripted provider, so each answer must be for the stage called, and keeps each call they didn't fit and each stale one (`AnswersProvider`). `mapStrings` changes an answer's strings, never its JSON text, so a saved tool's name with quotes or backslashes stays whole.
- `src/runner/speed.ts`: how fast a run was against the speed targets (`OBS-04`). `speedOf` takes runs as `readRun` reads them from a run folder (its report and harness ledger) and gives `Speed`: each stage's model time and each kind of request's time as the person waited (`RequestKind`), as `figures` (count, p50, p95 and slowest, by nearest rank), and each of `SPEED_TARGETS` met, missed or not measured. `speedMarkdown` writes them as tables. `node evals/src/runner/speed.ts <run folder>...` prints them; the [M2 speed report](../../../evals/reports/2026-11-07-m2-speed.md) is its first use.
- `src/runner/messages.ts`: `outcomeOf` reads what a notice claims, in the app's own words from `en.ts`; `say` fills one of them.
- `src/runner/replay.ts`: `replayScenario` plays a scenario from an answers file, a rehearsal or a recorded live run, with no call: the command's rehearsal and replay modes use it, and so does `packages/web/e2e/scenario-replays.spec.ts`, which replays every file in `evals/scenarios/replays/` in CI and expects each run's steps to pass or fail as listed there, with their problems (`EVAL-07`, `TEST-04`). The list follows today's scenario files, so after a scenario's expectation is corrected it can differ from the live report, whose score stays frozen. A new recording needs its expected failed steps listed there.
- `src/runner/record.ts`: `recordAnswers` turns a run's ledger and request log into answers that replay it (`EVAL-07`); `CANCELLED_WAIT_MS` is how long a cancelled call's answer waits in the replay.
- `src/runner/report.ts`: `reportMarkdown`, the report a person reads.
- `evals/scenarios/rehearsals/`: a rehearsal for each M2 scenario, written by hand: `J6-limits`, `T1-shopping-list`, `T6-tip-calculator` and `T13-drawing-board`; and for the first of the M3 live set, `T2-reading-list`, `T3-spending-chart` and `T5-rsvp-form`, whose tools pass their profiles' behavior checks (`VER-03`), the chart's after its edit too. The tools in them pass creation's checks; the calculator works in whole cents, so it shows the catalogue's 100.63 and 25.16 each.

# Invariants

- **The person's way in.** Each step uses the host app's own controls: the request box, the review's Apply, Save to my tools, the offer's Continue and Use again or my tools, History's undo and restore, the trash. A change to existing entries waits for review, and the runner applies it, as the person would. One exception: the app has no control for an empty workspace yet (#132), so `switch: new` makes one through the store and then opens it in the app.
- **A `do` step uses the tool's own control** (`EVAL-01`, from M3). The runner finds, in the open tool's own frame, the one shown element marked with the step's hook (a hook of one of the scenario's verification profiles, `VER-03`), inside the one shown element its `in` names when it names one, such as the item showing Milk, or of several, the one whose label shows the step's `label`, as a person finds a form's field, and clicks it or types the value into it, as the person would; a select takes the choice whose text or value it is. A real click is the person's first interaction, so the tool may save (`GEN-06`). It then waits for the control's save (`dataSettled`, `DO_WAIT`): every step waits for the first change, up to ten seconds, whatever it expects, so a step expecting the data unchanged is watched as long and a late write fails it; once the data has changed, it waits for a second of quiet. Only then are the step's host facts read, so a save within that window is the step's own; one later than ten seconds would be the next step's. A step that changes nothing therefore takes ten seconds. A hook shown no times or several times fails the step in plain words, with how many it found. `packages/web/e2e/scenario-do.spec.ts` plays one from scripted answers: typing an item, adding it, removing another inside its item, and a step whose item isn't there; the added item is saved a second and a half after its click.
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
- **Each screenshot waits for the tool to show something** (L-81): after a workspace opens, its nested frames load again, so a screenshot taken at once showed an empty panel. The wait is at most 5 s and only for the picture; the facts are read before it, and each step's result records what its screenshot shows (`tool`, `empty` or `no tool`), and the replay spec fails on an `empty` one.
- **A request's outcome is read from the chat** (`APP-01`): after a `say` or `cancel` step, the report's message is Tessera's newest reply in the chat; after the other steps, the notice.
- **A big tool's request passes only with every feature in place** (`GEN-17`). `featuresMissed` reads, in the app's own words, a reply that says a feature wasn't added or may have been; the step fails with it, though the core stands and `outcomeOf` still reads the creation.
- **A scenario's clock must start in the past** (L-83): the browser runs on the scenario's time and the server on its own, so a clock ahead of now makes every deadline look past to the browser. `runScenario` refuses it before anything starts, with the cap check.
- **Speed is judged on what a run can time** (`OBS-04`). Each step's report records the ledger calls it asked for (`calls`, from the harness's `callsAsked`), so a request is matched to its own calls, an intent retry included, and timed as the person waited, staging included; one sent only to be cancelled isn't timed. A report from before that is matched in order, one intent call and the calls after it, only when its intent calls pair one to one with its requests; otherwise its requests are left untimed and the figures say so. With fewer than 20 samples, p95 is the slowest. The runner doesn't time the host's screens or a saved tool's mount, so those targets read as not measured.
- **A notice can be stale.** A step that shows no new message, such as `next-day`, reports the last one (Continue from my tools has its own since L-77); the facts never rely on a notice alone.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `messages.ts`: `outcomeOf`, `featuresMissed`, `say`
- `record.ts`: `CANCELLED_WAIT_MS`, `recordAnswers`
- `replay.ts`: `replayScenario`
- `report.ts`: `reportMarkdown`
- `run.ts`: `STEP_LIMIT_MS`, `NEW_WORKSPACE`, `RunMode` (type), `StepResult` (type), `Screenshot` (type), `RunReport` (type), `zonedInstant`, `runScenario`, `DO_WAIT`, `dataSettled`
- `script.ts`: `answersSchema`, `Answers` (type), `loadAnswers`, `mapStrings`, `AnswersProvider` (type), `answersProvider`
- `speed.ts`: `SPEED_TARGETS`, `RequestKind` (type), `Figures` (type), `Speed` (type), `figures`, `speedOf`, `speedMarkdown`, `readRun`
