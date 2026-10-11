---
type: Practice
title: "Code documentation"
description: "How code is documented as OKF concepts and kept true to the code (ENG-24)."
tags: [practices, code-docs]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-11T20:49:45Z }
---
# Code documentation

| ID | Rule |
| --- | --- |
| ENG-24 | **Code is documented as OKF concepts, checked against the code** (A51). Each module or subsystem has one concept in `docs/code/`, mirroring the packages (`docs/code/server/assets.md` for `packages/server/src/assets/`). It says what the code is for, which requirements it implements, where to start, the rules that must hold, what it depends on and its pitfalls. It never restates signatures or walks through the code: the code, its types and the zod schemas stay the source of truth for how things work. |

## What a code doc contains

Frontmatter, in addition to the fields in [`ENG-08`](documentation.md#frontmatter):

| Field | Rule |
| --- | --- |
| `type` | `Code Package` for a package, `Code Module` for a module or subsystem. |
| `resource` | The relative path to the code it describes, a folder or a file. |
| `implements` | Requirement IDs from the spec or the engineering practices, for example `[DATA-11, ENG-18]`. |
| `tests` | Relative paths to the tests that check it. |

Body sections, in this order, when they apply:

1. `# Purpose`: what the module is for and which requirements it implements.
2. `# Entry points`: the files and symbols to start from, named by file and symbol, never by line number.
3. `# Invariants`: rules that must hold, such as "an asset file is renamed into place before its row commits".
4. `# Depends on / used by`.
5. `# Pitfalls`: what has broken before or is easy to get wrong.
6. `# Symbols (generated)`: exported symbols, written by a script and never edited by hand.

## How it stays true

1. **References are checked.** The OKF check fails when a code doc's `resource` or `tests` path does not exist, or an `implements` ID is not in the spec or the engineering practices. Named symbols are checked once the TypeScript tooling exists (M0), which also writes the generated symbol section.
2. **Code changes pull in their docs.** When a pull request changes files under a code doc's `resource`, the check fails unless that doc changes too, or the pull request description has a line `No doc change needed: docs/code/<path>.md: <reason>`. The reviewing assistant checks the reason ([review checklist](assistants.md#ai-review-checklist), item 7).
3. **Links go both ways.** Each module's main file starts with a comment naming its doc, for example `// Docs: docs/code/server/assets.md`. The check fails if that doc does not exist, and if a code doc is not named by any code file.
4. **Coverage comes from the docs.** The coverage report (`ENG-17`) reads `implements` and `tests` to show, for each requirement, the code that implements it and the tests that check it.

Code docs start with the first package in M0. Writing or updating them is part of the [definition of done](definition-of-done.md).

## Example

```markdown
---
type: Code Module
title: Asset store
description: Stores images and other binary files by content hash and hands them to tools as blobs.
resource: ../../../packages/server/src/assets/
implements: [DATA-11, DATA-09, DATA-05]
tests: [../../../packages/server/test/assets.test.ts]
tags: [code, data, assets]
status: stable
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-02T10:00:00Z }
verified: { by: human:suredo, at: 2026-11-03T09:00:00Z }
---

# Purpose

Stores images and other binary files once, named by their SHA-256 hash, and hands them to tools as blobs (DATA-11). …
```
