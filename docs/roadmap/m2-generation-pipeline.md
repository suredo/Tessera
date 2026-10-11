# M2: Generation pipeline (size L, live budget about 35 calls) → internal alpha

**Goal:** everyday requests create and change tools reliably, with honest results and full visibility. At the end, you start using Tessera for real tasks (A35).

| Deliverable | Requirements |
| --- | --- |
| Claude Code adapter: executable resolution, probe, locked flags, clean environment, usage normalization, error mapping, version gate; full contract tests | CLI-01 to CLI-05, CLI-08, TEST-02 |
| Job control: queue, cancel before start, supersede | CLI-06 |
| Setup check and status screen (Claude Code installed, version, signed in; probe) | PLAT-03, APP-07 |
| Structured intent stage with the POC failure cases as fixtures (style, behavior statements, unrelated, mixed, non-English) | GEN-01, GEN-02, GEN-15 |
| Finding saved tools by asking: saved-tools catalogue in the intent stage, Continue or Use again offered | GEN-18 |
| Modular prompt assembly from versioned prompt files, with size budgets in CI and prompt versions recorded in the ledger; includes the UI standard's prompt part | GEN-03, ENG-16, VER-06 (prompt part) |
| Create, edit and repair with explicit output unions, failure classes, change detection, starting data, mixed-request split, stage time limits | CON-02, GEN-04, GEN-05, GEN-07, GEN-09, GEN-11 |
| Static checks with a real parser (forbidden APIs, undeclared actions and capabilities, unknown methods, startup writes, system clock reads) | VER-01 |
| Smoke check for every candidate (mount, render, no errors, accessibility floor, 320 px) | VER-02 |
| Host-composed outcome messages, plain-language lint, name and declaration preservation, scoped CSS edits | GEN-08, GEN-12, GEN-13, GEN-14 |
| Ledger with diagnostics; details view (basic) | OBS-01, GEN-10, UX-06, APP-09 |
| Progress display (per decision D7) and cancel | GEN-16, CLI-07, UX-02, APP-10 |
| Two-pass generation for big tools, measured against single-pass; default model routing recorded per stage | GEN-17, CLI-09 |
| Speed targets measured and reported | OBS-04 |
| Scenario runner: scenario files, automatic host facts, live and replay modes, evaluation report | EVAL-01, EVAL-02, EVAL-07 |
| Replay tests from the POC's recorded failures, where exports exist | TEST-04 |

**Live evaluation (about 35 calls, `TEST-05`):** T1 about 10, T6 about 7, T13 about 7, the limits run about 5, probe and image check 2, repair reserve about 4.
- One probe call plus a check that a sanitized screenshot reaches the model as an image input (CLI-08, A27).
- The M2 scenario set from [the milestone scenario sets](../testing/milestone-sets.md): T1 shopping list, T6 calculator, T13 drawing board, and a short limits run (ambiguous, impossible, cancel). In M2, scenarios use only chat, reload, save, Continue, Use again, undo and the trash. Steps that drive a tool's own controls (`do`) need verification profiles and start in M3.

**Exit criteria:**
- Every GEN rule has a scripted end-to-end test.
- The setup check guides a fresh machine to a working connection: the clean-setup scenario (P1) passes once in Windows Sandbox (A43).
- Finding a saved tool by asking works in scripted tests and in the live run.
- The live run shows no false success messages and no data loss.
- The first-attempt pass rate, stage time p95 and speed targets are recorded, and the time limits are updated from them.
- **Internal alpha:** you use Tessera for real tasks. Invite a few outside testers for observed M2/M3 sessions on your machine (the CLIs are signed in to your accounts, A3), covering creation, Continue, Use again and restore warnings without coaching, using isolated data and separately approved live caps. Findings feed M3/M4; broader trials remain in M6.

**From the POC:** the Claude Code flags and error mapping, usage normalization including cache writes, the action-planner patterns (data patches, mixed-request split into interface and data parts), scoped CSS-only edits with identical HTML and JS, the repair loop with diagnostics, starting data, and the intent fixtures from every routing failure.
