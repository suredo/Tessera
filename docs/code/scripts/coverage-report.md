---
type: Code Module
title: "Coverage report"
description: "Every requirement and lesson with its milestone, proposed, implemented or verified status, evidence and remaining limits, read from the docs and the tests; run in CI."
resource: ../../../scripts/coverage-report.ts
implements: [ENG-17, ENG-24, ENG-28, SEC-05]
tests: [../../../scripts/test/coverage-report.test.ts]
tags: [code, scripts, coverage]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-25T21:48:30Z }
---

# Purpose

Shows, for every requirement in the spec and the practices and every lesson, where it stands (`ENG-17`): its milestone, its status, the evidence and what is still missing. Progress is read from here, not from closed issues (`ENG-28`). It reads only the repository: the spec's and practices' tables, the roadmap's milestone tables, the lessons' tables, code docs' `implements` and `tests` (`ENG-24`), and test names. `pnpm coverage` writes it to `test-output/coverage-report.md`, and CI writes it to the job summary on every pull request.

# Entry points

- `scripts/coverage-report.ts`: `collect` reads a repository into `Coverage` (each `Requirement` and `Lesson`, and the unknown IDs); `render` writes it as Markdown; `testTitles` reads the test names a file declares. `MILESTONES` lists M0 to M6.
- The `pnpm coverage` command in `package.json` sets the current milestone (`--milestone M1` since M0's sign-off on 2026-10-17). Change it when the owner signs off a milestone.

# Invariants

The status rules:

- **A requirement's milestone** is the earliest milestone whose roadmap tables list it.
- **Verified** needs a code doc that `implements` the ID and, among that doc's own `tests`, a file with a test name naming it. **Implemented** needs only the code doc. Anything else is **proposed**.
- **A test name alone is a link, not proof.** A requirement named only in tests stays proposed, with "named in tests only, not proof" among its limits and the test files listed.
- **Work in a later milestone never counts as resolved.** A requirement counts toward the current milestone only once its milestone is reached; before that it is listed, with its status, as "deferred", and kept out of the counted totals.
- **A practice with no milestone counts from the start;** without code evidence it is "a working rule: followed in review". A spec requirement in no milestone never counts, and says so.
- **A lesson** takes the status of its least advanced mitigation, and the latest milestone among its scheduled mitigations; it counts only when all its mitigations do. A lesson without mitigations is "accepted" if the catalogue says A. An R lesson always carries "residual risk: depends on the model".
- **Only real test declarations are evidence.** Test names are read from the syntax tree: the plain-text first argument of each `it`, `test` or `describe` call, `.skip` and the like included. A call written in a comment or inside a string, as test fixtures often are, is not a test.
- **Only this checkout is read.** A folder with its own `.git`, such as an assistant's worktree of another branch under `.claude/worktrees/`, is left out, so its tests and IDs never count for this commit.
- **The threat model's checks stay tested** (`SEC-05`). A test reads this repository with `collect` and fails unless every numbered check in the [threat model](../../spec/threat-model.md), the sandbox, bridge, import, asset and migration checks, is verified: claimed by a code doc and named by one of its tests. A check added without a test fails CI.
- **Unknown IDs fail it:** an ID in a test name, a code doc's `implements` or a lesson's mitigations that nothing defines. Only known prefixes count as IDs, so a name like SHA-256 isn't one.

# Depends on / used by

Depends on `scripts/okf-lib.mjs` for frontmatter, and on the docs' layout: requirement tables in `docs/spec/` and `docs/practices/`, milestone files `docs/roadmap/m<N>-*.md`, lesson tables with `ID`, `Mitigation` and `Status` columns in `docs/lessons/`, code docs in `docs/code/`. Used by CI's `coverage` check and by milestone reports.

# Pitfalls

- **Scripts count as evidence only through code docs,** like any other code: the OKF check and the git hooks have theirs ([OKF check](okf-check.md), [git hooks](git-hooks.md)). A new script whose tests name an ID shows "named in tests only" until it has one.
- **A test name built at run time isn't seen,** such as a template with `${…}` or a name from `it.each`. Write the ID in plain text.
- **The first version matched test names with a pattern** over the raw text, which counted commented-out tests and sample strings, and walked into nested checkouts; Codex's review of [pull request 40](https://github.com/suredo/Tessera/pull/40) found both.
- **The milestone comes from tables only, and from IDs written out.** An ID mentioned only in a milestone's prose or exit criteria isn't scheduled there, and neither is one inside a range such as "CLI-01 to CLI-05": only CLI-01 and CLI-05 are read.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `coverage-report.ts`: `MILESTONES`, `Milestone` (type), `Status` (type), `Requirement` (type), `Lesson` (type), `Coverage` (type), `testTitles`, `collect`, `render`
