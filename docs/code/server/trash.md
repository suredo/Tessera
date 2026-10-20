---
type: Code Module
title: "Trash"
description: "Deleted workspaces and saved tools wait in the trash, restorable for 30 days, then are removed for good; emptying it early names what it removes and is confirmed against that list."
resource: ../../../packages/server/src/trash/
implements: [DATA-09]
tests: [../../../packages/server/test/trash.test.ts]
tags: [code, server, data, trash]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-19T07:58:03Z }
---

# Purpose

Makes deleting safe (`DATA-09`, A31): deleting a [workspace or saved tool](workspaces.md) moves it to the trash, where it can be restored for 30 days, and only then is it removed for good. Nothing is removed any other way. Emptying the trash early removes exactly the list the person was shown. The shapes are the `trashEntry` and `trash` contracts in `@tessera/contracts`; the columns come from the migration `0003-trash.sql`.

# Entry points

- `src/trash/trash.ts`, each function taking a store (the open data folder's database and clock):
  - `deleteWorkspace` and `deleteSavedTool` move one to the trash and return its entry.
  - `restoreWorkspace` and `restoreSavedTool` bring one back.
  - `listTrash` returns what can still be restored, the most recently deleted first, with the confirmation that empties exactly that.
  - `emptyTrash` takes that confirmation and removes those entries for good.
  - `removeExpired` removes what has been in the trash for 30 days or more; the [launcher](launcher.md) runs it at every start and hourly.

# Invariants

- **A deleted row stays until it is removed for good.** Deleting sets `deleted_at`; the [workspace functions](workspaces.md) no longer list it, and refuse to change it with a plain "restore it first". Restoring clears `deleted_at`, so a restored workspace is exactly what was deleted: its data, its version history and its saved tools.
- **A workspace takes its saved tools with it** (they would have nothing to open): they share its trash entry, named in it, and come back with it. A saved tool deleted on its own has its own entry; restoring it brings its workspace back too if that is in the trash, so Continue always has a workspace to open.
- **30 days, by the store's clock.** An entry can be restored until 30 days after it was deleted, to the millisecond; from then on it is no longer listed, restoring it is refused plainly, and the next sweep removes it. Tests move the clock instead of waiting, and the P3 scenario does it across a real restart.
- **Emptying early is confirmed against the list shown.** `listTrash`'s confirmation is a hash of the entries it lists. `emptyTrash` removes them only if the trash still lists exactly those; if anything was deleted or restored since, it removes nothing and says so. It returns the entries it removed, by name.
- **Removing for good takes what only it used**: a removed workspace's version history and saved tools (a cascade), and the tool versions it used that no workspace refers to any more. A version saved for work in progress, which no workspace refers to yet, is never touched.
- **Every change is one transaction**, so a crash leaves the trash as it was before or after, never in between.

# Depends on / used by

Depends on the [workspace functions](workspaces.md), [storage](storage.md) and the contracts. The [launcher](launcher.md) sweeps expired entries; [Export](archives.md) leaves out what is in the trash, and an import never reuses an ID still in it; the trash screen (#53) builds on it.

# Pitfalls

- **A new table that refers to tool versions** (undo history, recovery snapshots, [issue 50](https://github.com/suredo/Tessera/issues/50)) must be added to the check before a version is removed, or a removal fails on its foreign key. Assets (`DATA-11`, [issue 49](https://github.com/suredo/Tessera/issues/49)) add their own references the same way.
- **Expired entries are hidden before they are removed.** Between the 30-day mark and the next sweep, the rows still exist but nothing lists or restores them; `emptyTrash` removes them too.
- **The sweep runs hourly in a running copy**; a copy left running across the 30-day mark removes the entry within the hour, and a stopped one at its next start.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `index.ts`: `deleteSavedTool`, `deleteWorkspace`, `emptyTrash`, `listTrash`, `removeExpired`, `restoreSavedTool`, `restoreWorkspace`
- `trash.ts`: `listTrash`, `deleteWorkspace`, `deleteSavedTool`, `restoreWorkspace`, `restoreSavedTool`, `removeExpired`, `emptyTrash`
