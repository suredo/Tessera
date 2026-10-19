---
type: Code Module
title: "Workspaces and saved tools"
description: "Workspaces, their version history and data, and the saved-tools library, each change committed to the data folder's database before the call returns."
resource: ../../../packages/server/src/workspaces/
implements: [DATA-08, DATA-04, CON-01]
tests: [../../../packages/server/test/workspaces.test.ts]
tags: [code, server, data, workspaces]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-19T07:47:22Z }
---

# Purpose

Keeps what a person makes always saved (`DATA-08`): each workspace, the history of its tool versions, its data, and the named entries of the saved-tools library. Every change is one transaction in the data folder's database ([storage](storage.md)), committed before the function returns, so there is no "unsaved work" for a restart to lose. The shapes are the `workspace`, `workspaceVersion` and `savedTool` contracts in `@tessera/contracts` ([contracts package](../contracts/package.md)); the tables come from the migration `0002-workspaces.sql`.

# Entry points

- `src/workspaces/workspaces.ts`, each function taking a `Store` (the open data folder's database and clock):
  - `createWorkspace`, `renameWorkspace`, `getWorkspace` and `listWorkspaces` (the most recently changed first).
  - `addWorkspaceVersion` makes a stored [tool version](versions.md) the workspace's current one, as the next entry of its history; `workspaceVersions` lists the history.
  - `saveWorkspaceData` replaces the workspace's data and raises its revision.
  - `saveTool` (Save to my tools), `renameSavedTool`, `getSavedTool` and `listSavedTools` (by name).

# Invariants

- **Saved as it happens.** Each function commits its change before it returns; a test changes everything, restarts, and finds it all, both through `openDataFolder` and through a full launch and stop.
- **Rows are checked by their contracts when read** (`CON-01`): each row is turned into its contract's shape and parsed, so a stored record that breaks its contract is never handed on.
- **The history only grows** (`DATA-04`). A workspace's current version is the last entry of its history; going back to an older version adds a new entry, so the newer one stays restorable. A trigger refuses any change to an entry, and an entry must name a stored version (a foreign key).
- **A stale data write is refused.** `saveWorkspaceData` takes the revision the new data was made from; if the data changed since, it saves nothing and says so plainly, so a slower writer never replaces newer work.
- **A new workspace has no tool and no data**: its current version and data are null until a version is added and activation fills the data from the tool's defaults (`DATA-03`, [issue 50](https://github.com/suredo/Tessera/issues/50)).
- **A saved tool follows its workspace** (A32): it names the workspace that Continue opens, not a version, so later improvements are kept.
- **What is in the trash is out of reach.** Trashed workspaces and saved tools are not returned or listed, and changing one is refused with "restore it first" ([trash](trash.md)).
- **Times come from the store's clock**, which tests replace, so the trash's 30 days can be tested without waiting (`DATA-09`).

# Depends on / used by

Depends on [storage](storage.md), [tool versions](versions.md) (through the foreign key) and the contracts. The [trash](trash.md), export and import ([issue 48](https://github.com/suredo/Tessera/issues/48)), activation and restore (#50) and the host app's screens (#53) build on it.

# Pitfalls

- **Whole data, not patches.** `saveWorkspaceData` stores the data the [patch engine](https://github.com/suredo/Tessera/issues/47) produced; it doesn't apply patches or check per-record revisions, and it doesn't check the data against the tool's schema (#50).
- **Deleting is the trash's job.** Nothing here deletes a workspace or saved tool; the [trash](trash.md) (`DATA-09`) does, so nothing is removed without passing through it.
- **Errors for a missing ID are plain sentences**, but a title or name that breaks its contract (empty, or over 200 characters) throws zod's error; the API layer turns it into a plain message (#53).

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `index.ts`: `addWorkspaceVersion`, `createWorkspace`, `getSavedTool`, `getWorkspace`, `listSavedTools`, `listWorkspaces`, `renameSavedTool`, `renameWorkspace`, `saveTool`, `saveWorkspaceData`, `workspaceVersions`, `Store` (type)
- `workspaces.ts`: `Store` (type), `getWorkspace`, `listWorkspaces`, `createWorkspace`, `renameWorkspace`, `addWorkspaceVersion`, `workspaceVersions`, `saveWorkspaceData`, `getSavedTool`, `listSavedTools`, `saveTool`, `renameSavedTool`
