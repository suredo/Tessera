---
type: Code Module
title: "CI workflow"
description: "GitHub Actions CI on every pull request and on main: the fast checks on Linux, the OKF check and merge-ready, and one Windows job for the checker's tests, the platform tests and the browser tests."
resource: ../../../.github/workflows/ci.yml
implements: [ENG-02, TEST-01]
tests: [../../../scripts/test/ci-workflow.test.ts]
tags: [code, ci, github]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-19T03:48:01Z }
---

# Purpose

Runs every check on every pull request and on every push to `main` (`ENG-02`), so nothing merges on a local run alone. The fast checks run on Linux: typecheck, lint, format check, the unit tests of every package and script (`TEST-01`), the secret scan, the web app's build and the coverage report (`ENG-17`), each as its own job, plus the [OKF check](../scripts/okf-check.md) with its tests and, on pull requests, its drift check, and the merge-ready job that stays red while a task handoff is left (`ENG-25`). One Windows job runs what depends on the platform: the OKF check's tests, the platform helpers, SQLite storage, the [launcher](../server/launcher.md) and the [local server](../server/local-server.md) (`PLAT-01`, `DATA-01`, `PLAT-02`, `SEC-03`), and the browser tests in Chrome and Edge (`TEST-06`, `RUN-06`), whose evidence is in the [web package](../web/package.md). CI makes no model calls.

# Entry points

- `.github/workflows/ci.yml`: the whole workflow. Its header comment lists what each job covers. The jobs are the OKF check, merge-ready, one job per workspace check (a matrix over the scripts in `package.json`), and the Windows job.
- `scripts/test/ci-workflow.test.ts`: reads the workflow and checks that it runs on every change, runs each check above, keeps one Windows job, and gives no job a secret.
- `.github/dependabot.yml`: weekly update proposals for the workspace and the actions, which `ENG-02` also asks for. It isn't this doc's resource, so the drift check doesn't watch it.

# Invariants

- **Every pull request and every push to `main` runs it.** A pull request also runs again when its description is edited, since a "No doc change needed" line can change the drift check's result.
- **No secrets, read-only access.** No job reads `secrets.*`, and the token can only read the repository, so CI can't reach a model provider or change the repository.
- **One Windows job, kept lean.** Windows minutes use the private repository's Actions allowance faster than Linux minutes (`ENG-02`). Only tests that depend on the platform run there: paths and line endings in the OKF check, the platform helpers, SQLite storage, the launcher and local server, and the browsers. If the allowance gets tight, `ENG-02` says to run it only on pull requests that touch runtime, platform or web code.
- **Actions are pinned by commit,** with the version in a comment; Dependabot proposes updates.
- **A check is never weakened to make CI pass** (`AGENTS.md`).

# Depends on / used by

Depends on GitHub Actions' Ubuntu and Windows runners, with Chrome and Edge preinstalled on Windows; Node from `.nvmrc` and pnpm through Corepack; and the workspace's scripts in `package.json`. Used on every pull request and on `main`. Its coverage report job writes to the job summary, and its Windows job keeps the browser videos for 14 days (`ENG-10`).

# Pitfalls

- **The tests read the workflow, not a run.** They show what CI is told to run; a green run on the pull request shows it passed.
- **`ENG-02` lists checks that later milestones bring:** CLI contract tests, scripted end-to-end tests, host accessibility checks (`APP-11`) and prompt-size budgets (`GEN-03`). Each joins this workflow, and its test, when its code lands.
- **The checker's tests ran only on Linux until M1,** so a failure that only Windows paths or line endings cause reached review in [pull request 41](https://github.com/suredo/Tessera/pull/41).
- **The drift check needs the full history** (fetch depth 0) to diff against the pull request's base.
