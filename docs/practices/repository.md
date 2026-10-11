---
type: Practice
title: "Repository, version control and releases"
description: "Git, GitHub Free, CI, synced folders and releases (ENG-01 to ENG-03, ENG-23)."
tags: [practices, repository]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-11T20:21:39Z }
stale_after: 2027-04-11T00:00:00Z
---
# Repository, version control and releases

| ID | Rule |
| --- | --- |
| ENG-01 | **Git from the first commit, in a private GitHub repository on GitHub Free** (A16). One topic per branch (`feat/…`, `fix/…`, `docs/…`, `chore/…`). Commits follow Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`). GitHub milestones M0–M6 match the [roadmap](../roadmap/index.md), and every issue belongs to one. |
| ENG-02 | **CI on every pull request.** Required checks: typecheck, lint, format check, unit tests, CLI contract tests, scripted end-to-end tests (Playwright, Chrome and Edge), host accessibility checks (`APP-11`), the OKF documentation check (frontmatter, indexes, links, log and code-doc drift: `ENG-08`, `ENG-24`), prompt-size budgets (`GEN-03`), the requirement-coverage report (`ENG-17`), and the rule-file check (`ENG-05`). CI never makes live model calls. The fast checks run on Linux runners. One Windows job runs the platform tests and the Playwright suites with the accessibility checks (`PLAT-01`). Windows minutes use up a private repository's monthly Actions allowance faster than Linux minutes, so keep that job lean and report Actions usage in each milestone report. If the allowance gets tight, run the Windows job only on pull requests that touch runtime, platform or web code. Dependabot security alerts and update proposals are on. |
| ENG-03 | **Not in a synced folder.** The repository lives outside OneDrive, Dropbox and similar (for example `C:\dev\tessera`). GitHub is the backup. Sync tools can lock or replace files mid-write. |
| ENG-23 | **Releases.** Semantic versioning; `v0.1.0` is the first release (M4). The changelog is generated from Conventional Commits at each release and reviewed by hand. Releases are tags on `main`. |
