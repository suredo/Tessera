---
type: Practice
title: "Repository, version control and releases"
description: "Git, GitHub Free, CI, synced folders and releases (ENG-01 to ENG-03, ENG-23)."
tags: [practices, repository]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-21T05:40:05Z }
stale_after: 2027-04-11T00:00:00Z
---
# Repository, version control and releases

| ID | Rule |
| --- | --- |
| ENG-01 | **Git from the first commit, in a public GitHub repository on GitHub Free** ([ADR 0005](../decisions/adr/0005-public-repository.md), which replaced A16's private one). Nothing secret or personal goes into code, docs, issues or pull requests. One topic per branch (`feat/…`, `fix/…`, `docs/…`, `chore/…`). Commits follow Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`). Issues, labels and milestones follow [`ENG-28`](tracking.md). |
| ENG-02 | **CI on every pull request.** Required checks: typecheck, lint, format check, unit tests, CLI contract tests, scripted end-to-end tests (Playwright, Chrome and Edge), host accessibility checks (`APP-11`), the OKF documentation check (frontmatter, indexes, links, log and code-doc drift: `ENG-08`, `ENG-24`), the merge-ready job, red while a task handoff is left (`ENG-25`), prompt-size budgets (`GEN-03`), the requirement-coverage report (`ENG-17`), and the rule-file check (`ENG-05`). CI never makes live model calls. The fast checks run on Linux runners. One Windows job runs the platform tests and the Playwright suites with the accessibility checks (`PLAT-01`). Actions minutes are free for the public repository (ADR 0005); keep the Windows job lean anyway, so CI stays fast. Dependabot security alerts and update proposals are on. |
| ENG-03 | **Not in a synced folder.** The repository lives outside OneDrive, Dropbox and similar (for example `C:\dev\tessera`). GitHub is the backup. Sync tools can lock or replace files mid-write. |
| ENG-23 | **Releases.** Semantic versioning; `v0.1.0` is the first release (M4). The changelog is generated from Conventional Commits at each release and reviewed by hand. Releases are tags on `main`. |
