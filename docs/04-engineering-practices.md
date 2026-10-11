# Engineering practices

Status: draft 0.4 · 2026-10-11 · Target practices. Rules have stable IDs; never renumber them (`ENG-17`).

---

## 1. Repository, version control and releases

| ID | Rule |
| --- | --- |
| ENG-01 | **Git from the first commit, in a private GitHub repository on GitHub Free** (A16). One topic per branch (`feat/…`, `fix/…`, `docs/…`, `chore/…`). Commits follow Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`). GitHub milestones M0–M6 match the [roadmap](03-roadmap.md), and every issue belongs to one. |
| ENG-02 | **CI on every pull request.** Required checks: typecheck, lint, format check, unit tests, CLI contract tests, scripted end-to-end tests (Playwright, Chrome and Edge), host accessibility checks (`APP-11`), documentation link check, prompt-size budgets (`GEN-03`), the requirement-coverage report (`ENG-17`), and the rule-file check (`ENG-05`). CI never makes live model calls. The fast checks run on Linux runners. One Windows job runs the platform tests and the Playwright suites with the accessibility checks (`PLAT-01`). Windows minutes use up a private repository's monthly Actions allowance faster than Linux minutes, so keep that job lean and report Actions usage in each milestone report. If the allowance gets tight, run the Windows job only on pull requests that touch runtime, platform or web code. Dependabot security alerts and update proposals are on. |
| ENG-03 | **Not in a synced folder.** The repository lives outside OneDrive, Dropbox and similar (for example `C:\dev\tessera`). GitHub is the backup. Sync tools can lock or replace files mid-write. |
| ENG-23 | **Releases.** Semantic versioning; `v0.1.0` is the first release (M4). The changelog is generated from Conventional Commits at each release and reviewed by hand. Releases are tags on `main`. |

## 2. Code standards

| ID | Rule |
| --- | --- |
| ENG-04 | **TypeScript, strict, formatted, linted.** `strict: true`, no `any` without a comment saying why. Prettier for formatting (line width about 100) and ESLint for rules. Keep functions small and named, and leave a comment where code does something non-obvious. Shared shapes come only from `packages/contracts` (`CON-01`). React components rely on the React Compiler (A15): no hand-written `useMemo`, `useCallback` or `React.memo` unless profiling shows the compiler missed a case, with a comment saying so. ESLint enforces the compiler and hooks rules. |
| ENG-12 | **No text surgery on code.** Change code with an editor or the assistant's edit tool, never with ad hoc scripts that search and replace text in source files. Many failed edits in the POC came from shell and Python escaping. Use a codemod tool when a change spans many files. |
| ENG-16 | **Prompts are code.** Every prompt part (`GEN-03`) lives in a versioned file in the repository, never in an inline string. A change to a prompt part is reviewed like code, must pass the replay suite (`TEST-04`), and, when it changes behavior meaningfully, gets a small budgeted live check. Each ledger entry records the prompt part versions used, so a change in outcomes can be traced to a prompt change. (In the POC, one added prompt sentence changed live outcomes, and nothing recorded which prompt produced which result.) |
| ENG-18 | **Storage migrations.** Changes to Tessera's own SQLite schema are numbered migration files, applied in order, and tested on fixture databases from earlier versions. Before migrating real data, the host makes an automatic backup in the data folder and keeps it until the next successful start. |

Dependencies: allowed, but small and justified in the pull request. Prefer well-maintained libraries (zod, acorn, Playwright, Vitest) over writing parsers or test runners by hand. Pin versions, keep a lockfile, and review Dependabot's proposals like any other change.

## 3. Working with AI assistants

Both Claude Code and Codex develop, review, run the app and execute tests/evaluations (A37). Approved live budgets apply equally to both.

| ID | Rule |
| --- | --- |
| ENG-05 | **One rules file for every assistant.** `AGENTS.md` is the single source of rules: what the project is, how to run checks, the non-negotiables (section 3.1), where the spec and ADRs live. It stays under about 100 lines. `CLAUDE.md` contains only the import line `@AGENTS.md`, so Claude Code reads the same rules, and CI fails if `CLAUDE.md` contains anything else. No long handoff documents: the pull request description is the handoff. |
| ENG-06 | **Every task starts from a brief with acceptance criteria.** Use the template in section 3.2. The criteria name spec requirement IDs. Tests that show the criteria are met are written in the same pull request. |
| ENG-15 | **Review and merge** (A36). Every pull request gets an AI review by **the other assistant**: Codex reviews Claude Code's work and the reverse. If the other is unavailable, a fresh session of the same assistant reviews it. The review follows the checklist in section 3.4 and is posted on the pull request. The product owner reads the summary and review, then merges. GitHub Free offers no branch protection or rulesets for private repositories, so the rules are kept by setup and habit: `main` changes only through pull requests; the repository allows squash merges only, which keeps history linear; a local pre-push hook, installed by the setup script, refuses direct pushes to `main`; and the product owner merges only when CI is green and the review is posted. Assistants never push to `main` and never merge. |
| ENG-21 | **Small pull requests** (A39). One requirement or a small group per pull request, around 400 changed lines excluding tests, fixtures and generated files. Larger work is split, with a short plan in the first issue or pull request. |
| ENG-22 | **Model matched to task** (A38). Development assistants use lighter, cheaper models for bounded or mechanical work (renames, tests from a clear spec, docs updates) and stronger models for design, difficult bugs and reviews. This only affects development; the product's routing is `CLI-09`. |

### 3.1 Non-negotiables for every assistant

1. Never weaken a guard (validation, sandbox, check, budget) to make something pass. Fix the cause, or ask.
2. Never make live model calls, or run scripts marked LIVE, without explicit approval of a budget (section 6).
3. Run typecheck, lint and the relevant tests before saying something is done, and report results faithfully, including failures.
4. Keep one definition per contract (`P3`). If a prompt, check and type disagree, fix the source definition.
5. Keep user-facing text plain (`GEN-12`).
6. Update the reference docs touched by the change in the same pull request (section 7).
7. Never use the real user data folder; development, tests and evaluations each use their own (`ENG-19`).

### 3.2 Task brief template

```markdown
## Goal
One or two sentences, in user terms.

## Requirements
Spec IDs this implements or changes (e.g. GEN-04, DATA-02).

## Acceptance criteria
- Observable result 1 (how it is tested)
- Observable result 2
- What must NOT change

## Out of scope
…

## Size and plan
Expected size; if over ~400 lines, how it is split.

## Live budget
None / N calls, with the reason (needs approval).
```

### 3.3 Pull request template

```markdown
## What and why
## Requirements touched (IDs)
## Tests added or changed (named by requirement ID)
## Prompt parts changed (if any), with replay results
## Docs updated
## Live calls used (if any): count, tokens, ledger link
## Risks / follow-ups
## Written by: Claude Code / Codex · Reviewed by: the other
```

### 3.4 AI review checklist

The reviewing assistant checks, and reports each item as fine or a finding with evidence:

1. **Fulfils the brief:** every acceptance criterion is met and tested; nothing out of scope slipped in.
2. **Spec rules:** the touched requirement IDs are honored, and no other requirement is broken (especially `P1`–`P7`, `GEN-06`, `GEN-08`, `DATA-02`, `SEC-*`).
3. **Guards intact:** no validation, check, budget or sandbox rule was weakened.
4. **One definition:** no duplicated schema, prompt text or rule.
5. **Tests:** they would fail without the change; they are named by requirement ID; nothing is flaky.
6. **Plain text:** user-facing messages use no internal terms.
7. **Docs:** reference docs match the change.
8. **Size:** within about 400 lines, or split as planned.

## 4. Definition of done

| ID | Rule |
| --- | --- |
| ENG-09 | A change is done when: (1) its acceptance criteria pass in tests named by requirement ID; (2) CI is green; (3) the cross-assistant review is posted and its findings resolved or answered; (4) reference docs are updated; (5) any lesson it addresses is marked in the lessons document; (6) no new warnings; (7) user-facing text is reviewed for plain language. Live-evaluation results, when used, are linked. |

## 5. Testing

The POC showed that offline tests can pass while live behavior fails (L-08). The pyramid therefore has five layers, and each catches what the one below can't.

| Layer | What | Where it runs | Model calls |
| --- | --- | --- | --- |
| 1. Unit (`TEST-01`) | Contracts, patch engine, pipeline logic, checks, message lint | CI, every change | None |
| 2. Adapter contract (`TEST-02`) | Exact CLI arguments, environment, stdin, output parsing, usage normalization, error mapping, cancellation, against fake processes | CI | None |
| 3. Scripted end to end (`TEST-03`) | Real server, real browser, real pipeline, canned model replies; screenshots and video for each step | CI (Playwright) | None |
| 4. Replay (`TEST-04`) | Sanitized exports of real live outputs replayed through the pipeline and checks | CI | None |
| 5. Live evaluation (`TEST-05`) | Agreed real-life scenarios (tools created from nothing, then edited, saved, reopened) with a real model, under a budget | Manually, at milestones, approved | Budgeted |

| ID | Rule |
| --- | --- |
| ENG-11 | **Test configuration never travels in the user's words.** Scripted scenarios are chosen by a test header, a fixture file or provider configuration, never by markers inside the request text. (In the POC a marker containing "engine" changed what the product did.) |
| ENG-13 | **Every live failure becomes a replay test.** When a live run finds a defect, export the inputs and outputs (`DATA-05`), add a replay test that fails before the fix, then fix. |
| ENG-14 | **Fixed browser contexts.** Each Playwright test sets its viewport when the browser context is created; never resize a live page. Test on Chrome and Edge. Interact through stable hooks (`VER-03`), never by guessing at generated layouts. |
| ENG-17 | **Traceability and stable IDs.** Tests name their requirement ID. CI lists every requirement and lesson, its milestone, proposed/implemented/verified status, evidence and remaining limits. A test name is a coverage link, not proof of general correctness. Deferred work stays visible and excluded from current closure counts. IDs are never reused or renumbered; removed requirements stay retired. |
| ENG-20 | **No flaky tests.** A test that fails intermittently is quarantined at once, with an issue, and fixed before the milestone closes. Tests are never retried until they pass. (The POC had a flaky viewport test whose cause was first misdiagnosed.) |

## 6. Live evaluation protocol

| ID | Rule |
| --- | --- |
| ENG-07 | Live model calls follow this protocol. |

1. **Plan:** list required scenarios, AI-dependent versus deterministic steps, calls per stage, repair reserves, reviewer calls and expected tokens. Reconcile with the roadmap envelope and approve the actual hard cap. Schedule large runs to fit the plan's usage windows. Freeze scoring denominators; blocked required steps remain counted. No automatic budget increase.
2. **Rehearse:** run the exact script in dry-run mode, with canned replies and zero cost (`OBS-02`). Fix script problems first.
3. **Run:** use a separate port and the evaluation data folder, never the person's real data (`ENG-19`). The budget guard refuses calls past the cap.
4. **Stop rules:**
   - **Step 1 fails:** stop the run. Later steps would only spend calls with nothing to build on.
   - **A step fails twice:** stop that step, fix the cause offline, and ask before spending more.
   - **Provider errors** (sign-in, unavailable model): stop.
   - **Usage limit reached:** pause. Resume the remaining scenarios after the limit resets, without re-running scenarios that already finished.
5. **Record:** keep the call ledger, request log, diagnostics, screenshots, video and a short written result, with the cost: calls, input tokens (cached), output tokens and model seconds.
6. **Learn:** every defect gets a lessons entry, a replay test (`ENG-13`) and a fix.

Reference costs from the POC (Claude Sonnet 5.5, medium effort):
- Creating a complex tool: about 105–131 s, 9–10k input and 15–19k output tokens.
- An edit: about 20–60 s.
- A data action (Haiku): 5–12 s.
- Research: 34–85 s, 13–90k input tokens.

## 7. Documentation

| ID | Rule |
| --- | --- |
| ENG-08 | Documentation has four kinds, each with one job. |

| Kind | Location | Rule |
| --- | --- | --- |
| Reference | The planning set in `docs/` (01–06) now; `docs/reference/` for implementation references (contracts, architecture) once code exists | The spec labels target requirements and delivery status. Implementation references describe current behavior only. Historical POC copies live in `docs/poc/`, are labelled, and are subordinate to the spec and decisions. Update with code; version/status metadata is allowed, but dated execution reports stay separate. |
| Decisions | [05-open-decisions.md](05-open-decisions.md) for A1–A49; `docs/adr/NNNN-title.md` for new decisions from M0 on | The decision log stays as it is. Each new decision gets one ADR: context, decision, consequences. Never edited afterwards; superseded by a new ADR. |
| Evaluations and milestone reports | `evals/reports/YYYY-MM-DD-name.md` | Dated results of live runs, and each milestone's closing report (delivered, exit criteria, live costs, open issues) with the product owner's sign-off. Historical: never updated to look current. |
| Changelog | `CHANGELOG.md` | What changed per release (`ENG-23`). |

CI checks links and anchors, as the POC did. The README stays short: what the project is, how to run it, where the docs are.

On import, preserve a sanitized evidence index (run/date, provider, scope, measured result and available portable report/fixture). Missing raw evidence stays marked unavailable. Never turn a proposed fix into a measured success claim. The UI-standard version remains contract metadata.

## 8. Evidence, secrets and data

| ID | Rule |
| --- | --- |
| ENG-10 | **Test outputs and evidence.** Test outputs (videos, screenshots, logs) go to a gitignored `test-output/` folder, and runs older than the last few are pruned automatically. Evidence worth keeping (live evaluation reports, replay fixtures) is committed in `evals/` in a sanitized, portable form. Nothing needed to reproduce a test lives only on one machine. Images and video follow the rules below, so the repository stays small (A48). |
| ENG-19 | **Secrets and data separation.** No credentials, API keys, tokens or personal data are ever committed; CLI sign-ins are never copied. Fixtures and replay exports are sanitized before committing. Development, automated tests and live evaluations each use their own data folder, chosen by configuration; none ever touches the real user data folder (`PLAT-04`). A pre-commit check and CI scan for likely secrets. |

### 8.1 Images and video in the repository

| What | Where | Rule |
| --- | --- | --- |
| Screenshots cited by a report | `evals/reports/<report>/` | Only the ones the report cites, as WebP or optimized PNG, aimed at under 300 KB each |
| Videos and full screenshot sets | A GitHub release per milestone (`evidence-m2`, …) | Never committed. Zipped and attached to the release; the milestone report links to it |
| Test fixture images | `evals/fixtures/assets/` | Small, generated or owned by you, with metadata (such as photo location) stripped |
| Images in docs | `docs/images/` | Diagrams as SVG or Mermaid in Markdown where possible; screenshots as WebP |

The pre-commit check refuses video files and any image over 1 MB. Git LFS is not used for now. The running app's own images (photos people open in tools) never go in the repository: they live in the asset store in the user data folder (`DATA-11`).

## 9. Issue and lesson tracking

- GitHub Issues for bugs and tasks, labelled by area (`gen`, `runtime`, `data`, `ver`, `cli`, `ux`, `app`, `docs`) and assigned to a milestone (`ENG-01`).
- The lessons document continues as [01-lessons-learned.md](01-lessons-learned.md). New lessons get IDs and a mitigation requirement, just like the POC catalogue.
