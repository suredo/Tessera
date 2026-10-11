---
type: Practice
title: "Code standards"
description: "TypeScript standards, no text surgery, prompts as code, storage migrations and dependencies (ENG-04, ENG-12, ENG-16, ENG-18)."
tags: [practices, code]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-11T20:21:39Z }
---
# Code standards

| ID | Rule |
| --- | --- |
| ENG-04 | **TypeScript, strict, formatted, linted.** `strict: true`, no `any` without a comment saying why. Prettier for formatting (line width about 100) and ESLint for rules. Keep functions small and named, and leave a comment where code does something non-obvious. Shared shapes come only from `packages/contracts` (`CON-01`). React components rely on the React Compiler (A15): no hand-written `useMemo`, `useCallback` or `React.memo` unless profiling shows the compiler missed a case, with a comment saying so. ESLint enforces the compiler and hooks rules. |
| ENG-12 | **No text surgery on code.** Change code with an editor or the assistant's edit tool, never with ad hoc scripts that search and replace text in source files. Many failed edits in the POC came from shell and Python escaping. Use a codemod tool when a change spans many files. |
| ENG-16 | **Prompts are code.** Every prompt part (`GEN-03`) lives in a versioned file in the repository, never in an inline string. A change to a prompt part is reviewed like code, must pass the replay suite (`TEST-04`), and, when it changes behavior meaningfully, gets a small budgeted live check. Each ledger entry records the prompt part versions used, so a change in outcomes can be traced to a prompt change. (In the POC, one added prompt sentence changed live outcomes, and nothing recorded which prompt produced which result.) |
| ENG-18 | **Storage migrations.** Changes to Tessera's own SQLite schema are numbered migration files, applied in order, and tested on fixture databases from earlier versions. Before migrating real data, the host makes an automatic backup in the data folder and keeps it until the next successful start. |

Dependencies: allowed, but small and justified in the pull request. Prefer well-maintained libraries (zod, acorn, Playwright, Vitest) over writing parsers or test runners by hand. Pin versions, keep a lockfile, and review Dependabot's proposals like any other change.
