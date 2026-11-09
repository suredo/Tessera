---
type: Code Module
title: "Scenario files and host facts"
description: "Scenario files in evals/scenarios/, their one schema and loader, and the host facts each step is checked against without a model."
resource: ../../../evals/src/scenarios/
implements: [EVAL-01, EVAL-02]
tests: [../../../evals/test/scenarios.test.ts]
tags: [code, evals, scenarios]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-09T11:31:18Z }
---

# Purpose

The first part of the scenario runner (#155). Scenarios are data files (`EVAL-01`), written as the [scenario file format](../../testing/scenario-format.md) describes, and each step's expected host facts are checked from what Tessera stored, with no model (`EVAL-02`). The [runner](runner.md) plays them through the host app, with the [harness](harness.md) guarding and recording every call.

# Entry points

- `evals/scenarios/*.yaml`: the M2 live set ([milestone sets](../../testing/milestone-sets.md)): `T1-shopping-list`, `T6-tip-calculator`, `T13-drawing-board` and `J6-limits`, each in its M2 form, without steps that drive a tool's own controls. Their budgets are the M2 roadmap's: 10, 7, 7 and 5 calls. `B2-reading-list`, `B4-habit-tracker` and `B10-study-planner` are big single requests from the catalogue (T2, T4, T10), for the [two-pass comparison](../../../evals/reports/2026-11-07-two-pass-plan.md) (`GEN-17`); each has a rehearsal for one pass and one for two (`<id>.two-pass.json`).
- `src/scenarios/scenario.ts`:
  - `scenarioSchema`, `stepSchema` and `expectationSchema`, the format's one definition (P3), and their types `Scenario`, `Step` and `Expectation`.
  - `loadScenario` reads and checks one file, whose name must be its ID, and `loadScenarios` every file in a folder; a file that isn't a scenario raises `ScenarioError` with each problem in plain words.
  - `stepKind` names a step's kind, one of `STEPS`, the kinds the runner plays.
  - A do step (`DoAction`) clicks the element marked with a hook, or fills it with a value, perhaps inside the one element its in field names by a hook and the text it shows. The scenario lists its verification profiles, by their IDs in the registry, and each hook a do step names must be one of theirs: any other name would be guessing at the tool's markup (`VER-04`).
- `src/scenarios/facts.ts`:
  - `readHostState` reads what Tessera stored (each workspace's tool version and a hash of its data, the saved tools) with the workspace the host app has open (`HostState`, `WorkspaceFacts`).
  - `checkFacts` compares the state before and after a step, with what the host app showed (`StepOutcome`) and what the step acts on by name (`StepTarget`: the saved tool a Continue or Use again opens, by name, and the one workspace a delete moves to the trash, by ID, since titles repeat), against the step's expectation, and gives each difference in plain words.

# Invariants

- **Every scenario starts from an empty Tessera,** so its first step is a request (`say`). A test checks every file in `evals/scenarios/`.
- **Only the facts a step names are checked, plus what every step keeps:**
  - Nothing unrelated changed: a workspace other than the one open before or after keeps its version and data, and none goes away unless the step deletes that very workspace.
  - No saved tool's Continue moves to another workspace, and none goes away except with the workspace a delete takes (`DATA-07`, `DATA-09`).
  - No success claimed that wasn't applied (`GEN-08`): "made" needs a workspace that gained a tool, "changed" needs a changed version or data.
- **A tool is made when a workspace gains one:** a new workspace, or the empty one that was open, which a creation takes over (`GEN-01`).
- **Continue's "original" is the named saved tool's workspace before the step,** so a Use again or anything else that moved its link can't make a later Continue pass (`DATA-07`).
- **Data is compared by content,** as a hash of its canonical JSON: for tools that match no verification profile, a step can expect it changed, unchanged or `kept`. `kept` passes when every earlier value is still there, with added fields and items allowed, so a change that adds a field to every record (a migration) counts as keeping the data, while a changed or removed value fails ("Some of the earlier data is gone or changed.").
- **A `cancel` step follows the request it cancels,** a `say` step that expects nothing of its own; the schema refuses any other order.

# Depends on / used by

Depends on `yaml` (2.9.1, already in the lockfile through other packages) to read the files, zod, `canonicalJson` from `@tessera/contracts`, and the workspace store of `@tessera/server`. The [scenario runner](runner.md) uses it.

# Pitfalls

- **Played by the [runner](runner.md),** in rehearsal and replay so far; the live mode comes with the M2 live evaluation.
- **Expectations are host facts, not quality.** Whether a tool does what was asked is the AI review's (`EVAL-03`), from the scenario's `review` items.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `facts.ts`: `WorkspaceFacts` (type), `HostState` (type), `StepOutcome` (type), `StepTarget` (type), `keeps`, `readHostState`, `checkFacts`
- `index.ts`: `expectationSchema`, `loadScenario`, `loadScenarios`, `STEPS`, `DoAction` (type), `ScenarioError`, `scenarioSchema`, `stepKind`, `stepSchema`, `Expectation` (type), `Scenario` (type), `Step` (type), `checkFacts`, `readHostState`, `HostState` (type), `StepOutcome` (type), `StepTarget` (type), `WorkspaceFacts` (type)
- `scenario.ts`: `expectationSchema`, `Expectation` (type), `DoAction` (type), `stepSchema`, `Step` (type), `STEPS`, `scenarioSchema`, `Scenario` (type), `stepKind`, `ScenarioError`, `loadScenario`, `loadScenarios`
