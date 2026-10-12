---
type: Milestone
title: "M0: Foundations"
description: "Repository, tooling, CI, contracts and two small live spikes."
tags: [roadmap, foundations]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-12T02:02:46Z }
---
# M0: Foundations (size S, live spikes about 33 calls)

**Goal:** a repository where doing the right thing is the default, and the riskiest assumptions are tested before anything is built on them.

| Deliverable | Requirements |
| --- | --- |
| Private repository on GitHub Free, outside synced folders (created 2026-10-11 as `suredo/Tessera`). GitHub Free has no branch protection for private repositories, so: squash-only merges, a local pre-push hook that refuses direct pushes to `main`, and merging only on green CI (`ENG-15`). Issue and pull request templates and the [tracking rules](../practices/tracking.md): written before M0 (2026-10-12, A54). Remaining: GitHub labels and milestones M0–M6 (`ENG-28`); Dependabot alerts; secret scanning in a pre-commit hook and CI | ENG-01, ENG-03, ENG-15, ENG-19, ENG-28 |
| Planning docs in OKF: done before M0 (2026-10-11, A50). Remaining: scenarios move to `evals/` with the runner; preserve a sanitized evidence index and available portable fixtures; identify missing raw evidence | ENG-08, ENG-10 |
| pnpm workspace with packages scoped `@tessera/*`: `contracts`, `server`, `web` (React), `runtime`, `evals`; SQLite access layer chosen | [Architecture](../product/architecture.md), DATA-01 |
| Translation layer for host text from the first component, with a lint rule that fails on hard-coded host text | UX-05 |
| Small platform helpers for paths and processes; Node 22 (`.nvmrc`), TypeScript strict, Vite, React 19 with the React Compiler and its ESLint rules, Prettier, ESLint, Vitest, Playwright (Chrome and Edge), all running in CI: Linux runners for the fast checks, one Windows job for platform tests and Playwright | PLAT-01, ENG-02, ENG-04, TEST-01, TEST-03, TEST-06, RUN-06 |
| `AGENTS.md` and `CLAUDE.md`: written before M0 (2026-10-11), with the docs protocol and the non-negotiables. Remaining: a CI check that `CLAUDE.md` only imports `AGENTS.md`; both assistants (Claude Code, Codex) set up for development, with the cross-review workflow and checklist; decide [D12](../decisions/open/d12-checkpoint-suggestions.md), whether assistants may suggest a checkpoint | ENG-05, ENG-15, ENG-21, ENG-22, ENG-25 |
| Requirement/lesson coverage report: milestone, proposed/implemented/verified status and evidence. Deferred work cannot count as resolved | ENG-17 |
| The OKF check (`scripts/okf-check.mjs`, written before M0) and its tests (`scripts/okf-check.test.mjs`) run in CI, with the code-doc drift check against the pull request's base. A separate `merge-ready` job runs it with `--merge-ready` on pull requests and on `main`: it stays red while a task handoff is left, so merging only on green CI (`ENG-15`) also makes sure the handoff is gone (`ENG-25`). With the TypeScript tooling: switch its frontmatter parsing to a YAML library, check symbols named in code docs, and generate their symbol sections. The first package gets its code docs | ENG-08, ENG-24, ENG-25 |
| Contracts package with zod: generation of TS types and JSON Schema; unit-named numeric fields as a convention | CON-01, CON-05 |
| Scripted provider skeleton (scenario selected by test configuration) and budget-guarded evaluation harness with dry-run mode | ENG-11, OBS-02 |
| **Live spike (about 3 calls, A33):** (1) a zod-generated schema of realistic size is accepted by Claude Code's `--json-schema`; (2) the locked flags (`CLI-03`) still work on the current CLI version; (3) structured output returns intact. Results are written up as an ADR | CON-01, CLI-03 |
| **Intent spike (about 30 calls, Haiku 5.5 low, A33):** a draft intent prompt and schema run once over about 30 requests built from the POC's routing failures (L-16 to L-20, L-67) and non-English wording. Report the misroute rate per category. This tests the POC's most repeated failure family before the core is built on its assumptions | GEN-01, GEN-02, GEN-15 |

**Exit criteria:**
- CI is green on an empty feature, on Linux and Windows.
- A sample Playwright test records video.
- The OKF check runs in CI and fails on a deliberately broken code doc (missing `resource`, code changed without its doc).
- The evaluation harness dry run produces a ledger.
- The tracking rules (`ENG-28` to `ENG-30`) are reviewed against the issues and pull requests M0 produced, including where the line between issue and pull-request-only work fell.
- The spike reports are signed off. If the schema or flags fail, the contracts approach is adjusted before M1. Intent categories with a high misroute rate get a design note before M2.

**From the POC:** the recording approach for browser runs (a video plus a screenshot per step, driven over the browser's debugging protocol), the budget-guarded live server with its dry-run mode, and the documentation link checker.
