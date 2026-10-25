---
type: Code Module
title: "Development data"
description: "pnpm seed fills a development data folder with hand-written sample tools, and pnpm dev starts Tessera on it; neither ever touches the real user data folder."
resource: ../../../scripts/
implements: [ENG-19]
tests: [../../../packages/web/e2e/samples.spec.ts]
tags: [code, scripts, development]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-25T20:50:51Z }
---

# Purpose

Gives the owner, and anyone developing Tessera, a Tessera with something in it before tools can be generated (M2), without touching a person's own work (`ENG-19`, `PLAT-04`). `pnpm seed` fills a development data folder with hand-written sample tools that exercise every screen of the host app, and `pnpm dev` builds the app and starts Tessera on that folder.

# Entry points

- `scripts/dev-data.ts`: `devFolder` gives the development folder: the one named, or `DEFAULT_DEV_FOLDER`, `dev-data/` in the repository, which git ignores.
- `scripts/seed.ts`: `pnpm seed [folder]`. `seedSamples` fills an empty data folder with:
  - a shopping list that went from version 1 to version 2, which added ticking items off, with items added one change at a time, so its history has undo entries and restoring version 1 previews the ticks it would lose;
  - garden notes saved to my tools as "Garden journal";
  - an old packing list in the trash;
  - "Ideas", a workspace without a tool.
- `scripts/dev.ts`: `pnpm dev [folder]`. It builds the app, then starts Tessera through the [launcher](../server/launcher.md), with the data folder variable set to the development folder.

# Invariants

- **Never the real data folder.** `devFolder` refuses the real user data folder, any folder inside it and any folder holding it, whatever `TESSERA_DATA_DIR` says, with a plain sentence.
- **Never under a running Tessera.** The seed takes the launcher's own lock (`LOCK_FILE`) while it writes, so it refuses while Tessera runs on the folder, and Tessera can't start halfway through.
- **Only an empty folder is seeded.** A folder that already has workspaces is refused; to start again, close Tessera and delete the folder.
- **The samples are real tools, tested as the owner will use them.** `samples.spec.ts` seeds a test Tessera's own temporary folder and adds and ticks items through the tool, sees the change in the history, and previews the lossy restore.

# Depends on / used by

The [workspaces](../server/workspaces.md), [trash](../server/trash.md), [tool versions](../server/versions.md) and [storage](../server/storage.md) modules and the [launcher](../server/launcher.md). The owner uses it for M1's visual check; the browser tests use `seedSamples`.

# Pitfalls

- **A tool can't use a `<form>` to submit.** A tool's frame allows scripts only (`SBX-*`), so a form never submits and its submit event never fires: the first sample tool silently saved nothing. The samples add with a button and the Enter key. Generated tools (M2) need the same.
- **`pnpm dev` builds first,** since the launcher serves the built app.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `coverage-report.ts`: `MILESTONES`, `Milestone` (type), `Status` (type), `Requirement` (type), `Lesson` (type), `Coverage` (type), `testTitles`, `collect`, `render`
- `dev-data.ts`: `DEFAULT_DEV_FOLDER`, `devFolder`
- `seed.ts`: `seedSamples`
