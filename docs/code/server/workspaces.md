---
type: Code Module
title: "Workspaces and saved tools"
description: "Workspaces, their version history and data, and the saved-tools library, each change committed to the data folder's database before the call returns."
resource: ../../../packages/server/src/workspaces/
implements: [DATA-08, DATA-04, DATA-02, CON-01, BRG-04, MIG-06]
tests: [../../../packages/server/test/workspaces.test.ts, ../../../packages/server/test/workspace-data.test.ts, ../../../packages/server/test/activation.test.ts]
tags: [code, server, data, workspaces]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-25T00:02:10Z }
---

# Purpose

Keeps what a person makes always saved (`DATA-08`): each workspace, the history of its tool versions, its data, and the named entries of the saved-tools library. Every change is one transaction in the data folder's database ([storage](storage.md)), committed before the function returns, so there is no "unsaved work" for a restart to lose. The shapes are the `workspace`, `workspaceVersion` and `savedTool` contracts in `@tessera/contracts` ([contracts package](../contracts/package.md)); the tables come from the migration `0002-workspaces.sql`.

# Entry points

- `src/workspaces/workspaces.ts`, each function taking a `Store` (the open data folder's database and clock):
  - `createWorkspace`, `renameWorkspace`, `getWorkspace` and `listWorkspaces` (the most recently changed first).
  - `addWorkspaceVersion` makes a stored [tool version](versions.md) the workspace's current one, as the next entry of its history; `workspaceVersions` lists the history.
  - `saveWorkspaceData` replaces the workspace's data and raises its revision.
- `src/workspaces/activation.ts`: `activateVersion` makes a stored tool version the workspace's current one, with its data brought to the version's shape, in one transaction (`DATA-10`), or returns why not (`ActivationResult`).
  - `readWorkspaceData` gives the data as the bridge does (`WorkspaceData`): the data, and each record's revision count by collection and ID. Data the tool hasn't filled yet reads as empty.
  - `patchWorkspaceData` applies a batch of changes through the [patch engine](patches.md), against the records' saved revisions, and returns `{ ok: true, addedIds, workspace }` or the engine's refusal (`WorkspacePatchResult`).
  - `saveTool` (Save to my tools), `renameSavedTool`, `getSavedTool` and `listSavedTools` (by name).

# Invariants

- **Saved as it happens.** Each function commits its change before it returns; a test changes everything, restarts, and finds it all, both through `openDataFolder` and through a full launch and stop.
- **Rows are checked by their contracts when read** (`CON-01`): each row is turned into its contract's shape and parsed, so a stored record that breaks its contract is never handed on.
- **The history only grows** (`DATA-04`). A workspace's current version is the last entry of its history; going back to an older version adds a new entry, so the newer one stays restorable. A trigger refuses any change to an entry, and an entry must name a stored version (a foreign key).
- **Data is kept exactly, or refused whole.** Data the contract can't keep exactly, such as an object with a `__proto__` key, is refused before anything is saved, so a save that succeeds always reads back the same ([contracts package](../contracts/package.md)).
- **A stale data write is refused.** `saveWorkspaceData` takes the revision the new data was made from; if the data changed since, it saves nothing and says so plainly, so a slower writer never replaces newer work.
- **Each record's revision is saved with the data** (`DATA-02`). `record_revisions` holds every record's count; a record with no row is at revision 1. `patchWorkspaceData` reads the data and its revisions, applies the batch and saves the data, the workspace's revision and the records' revisions in one transaction, or nothing. So a batch planned against an older revision is refused whole even after a restart, with the engine's plain message, while a batch touching other records still applies (`BRG-04`).
- **Replacing the data whole moves every record on.** `saveWorkspaceData` gives each record it keeps its next revision, so a change planned before the replacement is refused rather than applied to different content.
- **A revision is never reused.** A record's row is never deleted while its workspace lasts: a removed record keeps its last count, so a record that comes back with the same ID, as a restore can bring it, continues from there, and a change planned before it left stays stale. The rows go only with the workspace, removed for good from the trash.
- **Every collection and record is its own entry.** The revisions `readWorkspaceData` gives are built from entries, so a collection named `constructor` or `toString` is its own, and reading data never touches what objects inherit. A record ID is never `__proto__` (the patch contract refuses it, as JSON refuses that key), since revisions are kept by ID; a list holding such an item is not a list of records.
- **Activation changes code, shape and data together, or nothing** (`DATA-10`). `activateVersion` checks everything before it writes: that the data revision it was planned against is still the workspace's (`MIG-06`), that the version exists and can be read, and that the data reaches the version's shape. A new workspace's first version fills its data from the version's reusable defaults, which must fit the version's own schema (`DATA-03`); a later version migrates the data on a copy through the [data shape](data-shape.md) module, checked against both schemas. Then the data and the version's history entry are written in one transaction, so a refused check, a stale revision or a crash during the commit leaves the committed unit as it was; a test throws after the writes to show the rollback. A version whose data shape is older than the data's is refused here: restoring one converts the data with a loss preview (#50, a later part).
- **A new workspace has no tool and no data**: its current version and data are null until a version is activated and fills the data from the tool's defaults (`DATA-03`).
- **A saved tool follows its workspace** (A32): it names the workspace that Continue opens, not a version, so later improvements are kept.
- **What is in the trash is out of reach.** Trashed workspaces and saved tools are not returned or listed, and changing one is refused with "restore it first" ([trash](trash.md)).
- **Times come from the store's clock**, which tests replace, so the trash's 30 days can be tested without waiting (`DATA-09`).

# Depends on / used by

Depends on [storage](storage.md), [tool versions](versions.md) (through the foreign key) and the contracts. The [trash](trash.md), [export and import](archives.md), activation and restore (#50) and the host app's screens (#53) build on it.

# Pitfalls

- **Two ways to change data.** `patchWorkspaceData` is for a tool's or chat's changes, checked per record. `saveWorkspaceData` replaces the data whole, checked only against the workspace's revision, for defaults and restores (#50). Neither checks the data against the tool's schema yet (#50).
- **Removed records' rows stay.** They are small and go with their workspace; a workspace whose tool adds and removes many records over years keeps one row for each. Pruning them would let a revision be reused.
- **Revisions don't travel in archives.** An exported workspace keeps its data and its revision; after an import every record starts at revision 1, so a change planned before the export can't be applied after it only by luck of matching counts. Plans don't outlive an import.
- **Two writers are module-internal.** `appendVersion` and `replaceData` write inside the caller's transaction; `addWorkspaceVersion`, `saveWorkspaceData` and `activateVersion` wrap them in one. They aren't exported from the module's index, and nothing outside it should call them.
- **`afterWrites` is for tests.** `activateVersion` calls it inside the transaction after its writes; a test throws there to stand for a crash. Production code never passes it.
- **Deleting is the trash's job.** Nothing here deletes a workspace or saved tool; the [trash](trash.md) (`DATA-09`) does, so nothing is removed without passing through it.
- **Errors for a missing ID are plain sentences**, but a title or name that breaks its contract (empty, or over 200 characters) throws zod's error; the API layer turns it into a plain message (#53).

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `activation.ts`: `ActivationRefusal` (type), `ActivationResult` (type), `ActivationOptions` (type), `activateVersion`
- `index.ts`: `activateVersion`, `ActivationOptions` (type), `ActivationRefusal` (type), `ActivationResult` (type), `addWorkspaceVersion`, `createWorkspace`, `getSavedTool`, `getWorkspace`, `listSavedTools`, `listWorkspaces`, `patchWorkspaceData`, `readWorkspaceData`, `renameSavedTool`, `renameWorkspace`, `saveTool`, `saveWorkspaceData`, `workspaceVersions`, `Store` (type), `WorkspaceData` (type), `WorkspacePatchResult` (type)
- `workspaces.ts`: `Store` (type), `getWorkspace`, `existingWorkspace`, `listWorkspaces`, `createWorkspace`, `renameWorkspace`, `addWorkspaceVersion`, `appendVersion`, `workspaceVersions`, `saveWorkspaceData`, `replaceData`, `WorkspaceData` (type), `readWorkspaceData`, `WorkspacePatchResult` (type), `patchWorkspaceData`, `getSavedTool`, `listSavedTools`, `saveTool`, `renameSavedTool`
