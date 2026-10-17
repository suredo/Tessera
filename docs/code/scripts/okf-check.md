---
type: Code Module
title: "OKF check"
description: "Checks the docs bundle, report frontmatter, code docs, task handoffs, skills and the rules files, and fails the build when one breaks a rule; --fix repairs index entries and generated symbol sections."
resource: ../../../scripts/okf-check.mjs
implements: [ENG-05, ENG-08, ENG-24, ENG-25]
tests: [../../../scripts/okf-check.test.mjs]
tags: [code, scripts, docs]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-17T18:27:54Z }
---

# Purpose

Keeps the documentation true by refusing what breaks its rules. It checks that `docs/` is one valid OKF bundle (`ENG-08`): frontmatter fields, types, statuses and actors, index entries that match each concept's title and description, relative links and anchors that resolve, footnotes with a matching source, and a newest-first log. Reports in `evals/reports/` live outside the bundle, so only their frontmatter is checked: the same fields plus `tags`, with the type `Evaluation Report`. It checks code docs against the code (`ENG-24`): `resource` and `tests` paths exist, `implements` IDs are defined in the spec or the practices, every code doc is named by a `Docs:` comment, the symbols named under Entry points are exported, the generated symbol section is current, and, with `--base`, code that changed without its doc. It checks task handoffs and history notes in `context/` (`ENG-25`), that `CLAUDE.md` only imports `AGENTS.md` (`ENG-05`), and that every skill has identical Claude Code and Codex adapters. CI runs it on every pull request, with `--merge-ready` too.

# Entry points

- `scripts/okf-check.mjs`: the whole check, one section per rule family, ending in the report. Its header lists the options: `--fix`, `--base <git-ref>`, `--pr-body <file>` and `--merge-ready`.
- `scripts/okf-lib.mjs`: frontmatter parsing with the YAML library, and the exported symbols of TypeScript code read with the TypeScript parser. The coverage report uses it too.

# Invariants

- **Errors fail, warnings don't.** A past `stale_after`, a handoff older than five days and a handoff over 500 words are warnings; everything else is an error and exits 1.
- **`--fix` writes only what it can derive:** index entries from frontmatter, and code docs' `# Symbols (generated)` sections from the code. It never invents a title or description.
- **Requirement IDs come from tables only:** rows starting `| <ID> |` in `docs/spec/` and `docs/practices/`.
- **`Docs:` comments are read from code under `packages/`, `evals/` and `scripts/`, and from the CI workflows in `.github/workflows/`,** skipping tests, `test/` and `e2e/` folders, `node_modules` and `dist`, since a test may hold sample `Docs:` text. A workflow names its doc in a YAML comment, `# Docs: docs/code/...`.
- **Reports get no bundle rules:** no index entry, and their links aren't checked. Only `.md` files directly in `evals/reports/` are read.
- **Symbols come only from TypeScript files** (`.ts`, `.tsx`, not tests or declarations). A doc whose resource is JavaScript has no generated symbol section and names no bare symbols in backticks under Entry points.
- **The drift check is excused only by a line** `No doc change needed: docs/code/<path>.md: <reason>` in the pull request description.
- **`--merge-ready` fails while any handoff is left** in `context/handoffs/`.

# Depends on / used by

Depends on `yaml` and `typescript` from the workspace, so it needs `pnpm install`, and on git for `--base`. Used by CI's OKF check and merge-ready jobs, by `AGENTS.md` and the definition of done as a check to run, and by the checkpoint procedure. Its tests run in CI's Linux and Windows jobs, since paths and line endings differ on Windows ([CI workflow](../ci/workflow.md)). The coverage report reads the same code docs.

# Pitfalls

- **The drift check watches only this file.** A change to `scripts/okf-lib.mjs` alone doesn't pull this doc in, since a code doc has one `resource`; update the doc by hand when the library's rules change.
- **Its tests build small bundles in temporary folders** and run the check there, so a new rule needs a fixture there, not a change to the real docs.
- **One test reads every doc in this repository** with both parsers, so a doc with odd YAML can fail that test even when the check passes.
