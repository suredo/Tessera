# Roadmap

Status: draft 0.3 · 2026-10-11 · Target milestones and provisional call envelopes. Before each evaluation, derive calls per stage including intent, generation, data actions, repair reserves and review, then approve the actual hard cap ([ENG-07](04-engineering-practices.md#6-live-evaluation-protocol)). The estimates below are not guaranteed sufficient for complete coverage.

**Order principle: build the deterministic core first, then add the model.** Apart from a tiny spike in M0 that tests the riskiest assumptions early (A33), everything up to M1 runs without model calls. The POC kept finding host bugs during expensive live runs; this order finds them in CI instead.

```text
M0 Foundations ─► M1 Runtime & data ─► M2 Pipeline ─► M3 Verification ─► M4 First release (v0.1)
   (+ spike)                             │                                  │
                                    internal alpha                M5 Engines & simulation
                                    (you use it daily)                      │
                                                                  M6 Hardening & second provider
```

- **Sizes** are relative (S, M, L) for one person directing AI assistants (A34). They are not dates. Real pace is measured after M0 and M1 and used to forecast the rest.
- **Sign-off:** every milestone ends with a short report in `evals/reports/` (what was delivered, exit criteria results, live costs, open issues) and your sign-off before the next one starts.

---

## M0: Foundations (size S, live spike about 3 calls)

**Goal:** a repository where doing the right thing is the default, and the riskiest assumptions are tested before anything is built on them.

| Deliverable | Requirements |
| --- | --- |
| Name check (A20): confirm `tessera` is usable as the GitHub repository, npm scope `@tessera` (or an alternative scope) and a domain, and do a basic trademark search for software | — |
| Private GitHub repo outside synced folders; branch protection (CI required, linear history); PR, issue and task-brief templates; GitHub milestones M0–M6; Dependabot alerts; secret scanning in a pre-commit hook and CI | ENG-01, ENG-03, ENG-19 |
| Import POC_Results with target-vs-implemented labels: spec/practices/UI standard into `docs/reference/`, ADRs, scenarios into `evals/`, lessons into `docs/lessons.md`. Preserve a sanitized evidence index and available portable fixtures; identify missing raw evidence | ENG-08, ENG-10 |
| pnpm workspace with packages scoped `@tessera/*`: `contracts`, `server`, `web` (React), `runtime`, `evals`; SQLite access layer chosen | spec §3, DATA-01 |
| Translation layer for host text from the first component, with a lint rule that fails on hard-coded host text | UX-05 |
| Windows CI runners; small platform helpers for paths and processes; Node 22 (`.nvmrc`), TypeScript strict, Vite, React 19 with the React Compiler and its ESLint rules, Prettier, ESLint, Vitest, Playwright (Chrome and Edge), all running in CI | PLAT-01, ENG-02, ENG-04, TEST-01, TEST-03, TEST-06, RUN-06 |
| `AGENTS.md` as the single rules file with the non-negotiables; `CLAUDE.md` that only imports it, enforced in CI; both assistants (Claude Code, Codex) set up for development, with the cross-review workflow and checklist | ENG-05, ENG-15, ENG-21, ENG-22 |
| Requirement/lesson coverage report: milestone, proposed/implemented/verified status and evidence. Deferred work cannot count as resolved | ENG-17 |
| Docs structure and link checker in CI | ENG-08 |
| Contracts package with zod: generation of TS types and JSON Schema; unit-named numeric fields as a convention | CON-01, CON-05 |
| Scripted provider skeleton (scenario selected by test configuration) and budget-guarded evaluation harness with dry-run mode | ENG-11, OBS-02 |
| **Live spike (about 3 calls, A33):** (1) a zod-generated schema of realistic size is accepted by Claude Code's `--json-schema`; (2) the locked flags (`CLI-03`) still work on the current CLI version; (3) structured output returns intact. Results are written up as an ADR | CON-01, CLI-03 |

**Exit criteria:**
- The name check is done.
- CI is green on an empty feature, on Windows.
- A sample Playwright test records video.
- The evaluation harness dry run produces a ledger.
- The spike report is signed off. If the schema or flags fail, the contracts approach is adjusted before M1.

**From the POC:** the recording approach for browser runs (a video plus a screenshot per step, driven over the browser's debugging protocol), the budget-guarded live server with its dry-run mode, and the documentation link checker.

---

## M1: Runtime and data core (size M, no model calls)

**Goal:** a hand-written tool runs safely inside the host app, its data is always saved and versioned, and it survives everything.

| Deliverable | Requirements |
| --- | --- |
| Artifact contract and storage of immutable, hashed versions | CON-04, DATA-04 |
| Sandbox runtime: opposite-loopback wrapper, opaque child, CSP, MessageChannel bridge, one active runtime, watchdog | RUN-01, RUN-02 |
| Bridge API manifest with runtime enforcement (declared actions and capabilities, revisions, instance, no pre-activation writes); host clock in the bridge | CON-03, RUN-04, GEN-06, RUN-07, CAP-01 |
| Patch engine: stable IDs, sequential resolution, atomic batches, revision checks, size limits | DATA-02, DATA-06 |
| Per-tool schema, separate reusable defaults/session data, bounded migrations, atomic code/schema/data activation and restore, recovery snapshots and loss-preview confirmation | DATA-03, DATA-07, DATA-10 |
| SQLite storage in the user data folder; always saved; trash with 30-day restore; export and import; numbered schema migrations with backup before migrating | DATA-01, DATA-05, DATA-08, DATA-09, PLAT-04, ENG-18 |
| Staging and verification panel with rollback (with a stub check) | RUN-03 |
| Host stylesheets (accessibility floor, UI standard layer) | RUN-05, VER-06 (styles part) |
| Host app shell around a hand-written test tool: main screen, empty state, workspaces, saved-tools library with Continue and Use again, versions with restore, undo, trash, export and import screens; host accessibility checked in CI | APP-01 to APP-06, APP-08, APP-11, DATA-07, UX-07 |
| Launcher (start, free port, single instance, open browser); server bound to 127.0.0.1 with Host-header and same-origin checks on every route | PLAT-02, SEC-03 |
| Threat model and negative runtime/import/migration boundary tests. Executable migrations stay disabled until isolation is demonstrated; declarative migrations may be used first | SEC-01, SEC-05 |

**Exit criteria:**
- The POC's 13 boundary checks are ported to Playwright and pass.
- The 250-operation patch stress test is ported and passes.
- Every change survives a server restart (always saved).
- The scripted trash-expiry scenario (P3) runs in CI.
- Delete to trash and restore round-trips, and expiry after 30 days works with a test clock.
- Export, wipe and import restores a workspace exactly.
- Continue targets the saved entry's linked workspace; Use again keeps defaults but drops original-session entries without retargeting Continue.
- Compatible restore preserves current data. Incompatible restore shows losses and requires confirmation; cancellation, failed migration and interrupted commits retain the committed unit. A recovery snapshot restores the pre-conversion unit.
- Lifecycle tests pass, including restoring minimized mode after a reload.
- The launcher starts one copy and finds a free port.
- Requests with a foreign Host header are refused.
- Host accessibility checks pass.

**From the POC:** the sandbox design (opposite-loopback wrapper, opaque child frame, strict CSP, MessageChannel bridge), the validated and atomic action batches with revision checks, the artifact contract with hashing, the default UI and accessibility stylesheets, and the 13 browser boundary checks. Port the behavior and the test cases, not the code style.

---

## M2: Generation pipeline (size L, live budget about 25 calls) → internal alpha

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
| Smoke check for every candidate (mount, render, no errors, accessibility floor, 390 px) | VER-02 |
| Host-composed outcome messages, plain-language lint, name and declaration preservation, scoped CSS edits | GEN-08, GEN-12, GEN-13, GEN-14 |
| Ledger with diagnostics; details view (basic) | OBS-01, GEN-10, UX-06, APP-09 |
| Progress display (per decision D7) and cancel | GEN-16, CLI-07, UX-02, APP-10 |
| Two-pass generation for big tools, measured against single-pass; default model routing recorded per stage | GEN-17, CLI-09 |
| Speed targets measured and reported | OBS-04 |
| Scenario runner: scenario files, automatic host facts, live and replay modes, evaluation report | EVAL-01, EVAL-02, EVAL-07 |
| Replay tests from the POC's recorded failures, where exports exist | TEST-04 |

**Live evaluation (about 25 calls, `TEST-05`):**
- One probe call plus a sanitized screenshot-input check. Folder reading requires allowlist and outside-folder denial tests; otherwise use approved image input with file tools disabled (CLI-08, A27).
- The M2 scenario set from [06-test-scenarios.md](06-test-scenarios.md#6-scenario-sets-per-milestone): T1 shopping list, T6 calculator, T13 drawing board, and a short limits run (ambiguous, impossible, cancel). In M2, scenarios use only chat, reload, save, Continue, Use again, undo and the trash. Steps that drive a tool's own controls (`do`) need verification profiles and start in M3.

**Exit criteria:**
- Every GEN rule has a scripted end-to-end test.
- The setup check guides a fresh machine to a working connection: the clean-setup scenario (P1) passes once in Windows Sandbox (A43).
- Finding a saved tool by asking works in scripted tests and in the live run.
- The live run shows no false success messages and no data loss.
- The first-attempt pass rate, stage time p95 and speed targets are recorded, and the time limits are updated from them.
- **Internal alpha:** you use Tessera for real tasks. Invite a few outside testers for observed M2/M3 sessions covering creation, Continue, Use again and restore warnings without coaching, using isolated data and separately approved live caps. Findings feed M3/M4; broader trials remain in M6.

**From the POC:** the Claude Code flags and error mapping, usage normalization including cache writes, the action-planner patterns (data patches, mixed-request split into interface and data parts), scoped CSS-only edits with identical HTML and JS, the repair loop with diagnostics, starting data, and the intent fixtures from every routing failure.

---

## M3: Verification (size M, live budget about 35 calls)

**Goal:** the host knows whether a tool works. Every tool already gets static and smoke checks from M2; tools matching a verification profile now also get behavior checks.

| Deliverable | Requirements |
| --- | --- |
| Verification-profile registry (internal, not tools) with a first set chosen from the M3 scenarios (item list, filtering, chart from data, form, scheduling and cards). Each profile has hooks, schema, prompt part, synthetic fixture and behavior check, all from one definition | VER-03, VER-04, P3 |
| Versioned policy checks, including removing/replacing a previously verified restriction | VER-05 |
| UI standard checks completed: static style checks and custom mode | VER-06, UX-04 |
| Diagnostics with expected, observed, whose rule and unit hints; behavior repair loop | VER-07, GEN-09 |
| Verified status in the UI and details view | VER-08, UX-03 |
| AI technical reviewer, reading screenshots from the run folder only, and the human verdict in the evaluation report | EVAL-03, EVAL-04 |
| Reviewer allowlist and traversal/symlink denial tests, or approved image inputs with file tools disabled; record the actual boundary | CLI-08, SEC-05 |
| `do` steps in scenarios, driving tools through profile hooks | EVAL-01 |
| First vetted library: a chart library, added by ADR and styled by the UI standard | CAP-04 |

**Live evaluation (provisional envelope about 35 calls, including reviews):** T1, T2 (Portuguese), T3, T5 and T10 cover the initial profiles. T5 covers form/submissions only; export waits for CAP-03 in M4. Add one unmatched-profile tool labelled behavior-unverified. Include that extra run and review in the approved cap.

**Exit criteria:**
- Each profile's check catches a deliberately broken scripted candidate.
- The live run's checks pass, or fail with useful diagnostics.
- Profiles matched wrongly are counted, with fewer than 1 in 10 wrong.
- The AI review's agreement with your verdict is recorded.

**From the POC:** the study and flow check patterns (stable hooks, a synthetic fixture, checks driven in a hidden verification panel, failures sent to a behavior repair), the lesson that every checked requirement must be stated in the prompt, and the UI-standard enforcement (prompt part, layered stylesheets, static checks, custom mode).

---

## M4: First release, v0.1 (size L, live budget about 85 calls)

**Goal:** a person can use it for real tasks.

| Deliverable | Requirements |
| --- | --- |
| First task: decide the outside data source for the movie finder (D11, A42) | CAP-02 |
| "Useful immediately" generation guidance and checks (stated data, sensible defaults, labelled examples, no past-dated defaults) | UX-01, GEN-05 |
| Three more profiles: items over time (T4), editing with files in/out (T14), and search results with selection (T7). Recurring chores combine item-list and time rules | VER-03, VER-05 |
| Files in and out (for the image editor, T14); the first data provider for T7, with sources chosen when testing it (D11) | CAP-02, CAP-03 |
| Details view complete (source, versions, checks, ledger, diagnostics) | UX-06, APP-09, OBS-01 |
| Metrics report from the ledger | OBS-03 |
| Fixes for the issues found during the internal alpha | — |

**Live acceptance evaluation (provisional envelope about 85 calls, including reviews):** ten English app runs, T2 and T10 in Portuguese, plus P1/P2: 14 scenario runs total. T2 is a distinct app, not a duplicate of the ten English apps. Derive a per-stage cap before approval; revise the budget rather than silently dropping required coverage. Every scenario starts empty. Score AI-dependent steps separately from deterministic lifecycle steps, as specified in release acceptance.

**Exit criteria:** spec §19, release acceptance, with your verdict on every scenario. Tag `v0.1.0` and publish the changelog (`ENG-23`). This is the first release.

---

## M5: Engines and simulation (size L, live budget about 50 calls)

**Goal:** people can create goal-driven simulations from everyday requests. The event planner is the first evaluation scenario, created by the simulated person like any other tool, not shipped.

| Deliverable | Requirements |
| --- | --- |
| Engine system: versioned modules, pinning, dependencies, isolated check process, seeded randomness | SIM-01, SIM-02, SEC-01 |
| Engine rules in generation (library first, extend in place, explicit replace, look-only protection) | SIM-03 |
| Structured engine plan → research/spec/reference-check validation → implementation → checks. Research precedes code; new mathematical changes invalidate stale research. Repair malformed required checks instead of dropping them | SIM-04, SEC-02, SEC-04, CLI-03 |
| Forbidden filesystem/network/process access and resource-limit tests before enabling engines; review research tool/prompt-injection boundaries | SEC-01, SEC-05 |
| Simulation verification profile and flow check; decision D9 on modularity | SIM-05, SIM-06 |
| three.js as a vetted library for 3D (T17) | CAP-04 |
| What a created event planner should be able to reach (the evaluation target, not a shipped tool): sketch, run, per-station results, compare layouts, and later moving dots and a heat map per decision D10 | UX-01 |

**Live evaluation:** the eight engine scenarios from the POC plan (M1–M8), plus T9 research board, T16 2D simulation and T17 3D viewer, all created from nothing.

**From the POC:** the whole engine design in [simulation-engines-plan.md](reference/simulation-engines-plan.md), including its live findings: the engine contract and lint, the shared engine host, the isolated check runner, dependency resolution and pinning, the engine rules in generation, the research stage, the flow check, and their test cases.

---

## M6: Hardening and second provider (size M)

- Cross-browser coverage (Firefox best effort), performance under large tools, accessibility audit.
- Broader security audit of boundaries already tested before shipping in M1/M3/M5. Engine network isolation is an M5 prerequisite, not a gap left until M6.
- Cost work: scoped JavaScript edits, prompt caching across calls where the CLI allows it, measuring savings.
- Codex adapter behind the same contract tests, with a live probe.
- Model matrix: the M4 scenario set run with different generation models, to compare quality and style consistency (`EVAL-05`).
- macOS and Linux support, and an installer, so people outside the team can try it (`PLAT-01`).
- Trials with real people outside the team (POC gap: nobody outside the team ever used it).

**Later, after M6:**
- A richer versioning system for tools (named versions, drafts or branches, comparison), also usable by the AI for bigger changes in a draft (A32).
- Modularity: saving and reusing features across tools ([06-test-scenarios.md](06-test-scenarios.md#34-later-modularity)).
- AI inside tools (`CAP-05`).
- A tool store ("check the store first", A12).

---

## Live budget summary

| Milestone | Proposed calls | Purpose |
| --- | ---: | --- |
| M0 | ~3 | Spike: schema acceptance, locked flags, structured output |
| M1 | 0 | Deterministic core, fully tested offline |
| M2 | ~25 | Pipeline reality check: 3 scenarios plus a limits run |
| M3 | ~35 | Verification profiles: 5 scenarios plus AI reviews |
| M4 | ~85 | Provisional envelope: 12 app runs plus P1/P2 and reviews; reconcile per-stage costs before approval |
| **Total to the first release** | **~150 provisional** | Planning envelope, not a guaranteed coverage budget. Offline replay uses no calls; changed prompts and new behavior still need approved live evidence |
| M5 | ~50 | Engines, research, simulations (after the first release) |

Your own use during the internal alpha (from M2) is separate from these evaluation budgets: it is normal product use on your plan.
