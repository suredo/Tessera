---
type: Code Module
title: "Patch engine"
description: "Applies a batch of changes to a tool's data in memory: add, replace and remove on stable IDs, resolved one at a time, all or nothing, refused if a record it touches changed after it was planned, and within the data limit."
resource: ../../../packages/server/src/patches/
implements: [DATA-02, DATA-06]
tests: [../../../packages/server/test/patches.test.ts, ../../../packages/contracts/test/patch.test.ts]
tags: [code, server, data, patches]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-19T07:34:46Z }
---

# Purpose

Every change to a tool's data, from the tool itself or later from chat, is a small batch of operations on records with stable IDs (`DATA-02`). The engine applies a batch to a copy of the data and returns the new data, or a plain reason why nothing changed, so a person can keep using a tool while a chat change is being prepared and never loses their own edit. It holds the data limit (`DATA-06`). The batch's shape is a contract, `patchBatchSchema` in `@tessera/contracts` ([contracts package](../contracts/package.md)).

# Entry points

- `src/patches/patches.ts`:
  - `createDataState` starts tracking a tool's data: every record it already holds is at revision 1. It throws if a list holds two records with one ID.
  - `applyPatch` applies a batch, given as untrusted input, and returns `{ ok: true, state, addedIds }` or `{ ok: false, reason, message, operationIndex }`, where the reason is invalid, stale or too large and the message starts with "Nothing was changed:".
  - `revisionOf` gives a record's revision count, which a change planned against that record carries.
- The patch contract and the data limit live in the contracts package's `src/patch.ts`.

# Invariants

- **Records and collections.** A collection is a top-level list of the tool's data whose items are all objects with an `id`, such as `tasks: [{ id, title }]`. Other fields, such as `title` or `units: ["kg"]`, are not records and no operation changes them.
- **Stable IDs from the host.** `add` never names an ID: the engine gives one (a random UUID by default) and returns it in `addedIds`, so two adds never conflict, whoever planned them and when.
- **Nothing replaces a whole record.** `replace` sets the fields it names and keeps the others; no operation sets `id`. A field name starts with a letter, so it is never `__proto__`.
- **Resolved one at a time.** Each operation finds its record by ID in the working copy left by the ones before it, so removing a record never shifts which record a later operation changes (L-23). Editing a record the same batch removed is refused.
- **Per-record revisions.** Each `replace` and `remove` carries the record's revision count from when it was planned. The batch is refused as stale if any record it touches has a different count now, or is gone; records it doesn't touch never make it stale. The count rises by one for each batch that changes the record, however many of its operations do.
- **All or nothing.** The engine works on a copy and never changes the state it was given; a refused batch leaves no trace.
- **The data limit.** The result is measured as UTF-8 JSON. Over `TOOL_DATA_LIMIT_BYTES` (256 KiB) the batch is refused with the size in KB, unless it makes the data smaller.

# Depends on / used by

Depends on the patch contract and zod. The bridge (#46) will apply a tool's own changes through it and checks BRG-04 end to end; storage (#48) and activation (#50) will store the data and revisions and give the engine the tool's current state; chat (M2) will plan batches against a state it read earlier.

# Pitfalls

- **In memory only.** Nothing here is stored: persisting the data with its revisions, and applying a batch inside a transaction, comes with storage and activation. Revisions are a `Map` keyed by `collection/id`, never a plain object, so an ID can't reach `Object.prototype`.
- **No check against the tool's data schema.** A change that fits the patch contract but not the tool's declared schema is applied; checking data against the schema comes with activation (#50, `DATA-03`).
- **A record is only found at the top level.** Lists nested inside a record, and top-level fields that aren't lists of records, can't be changed by a patch yet.
- **An empty `fields` changes nothing,** but is still checked: its record must exist and be current. JSON Schema can't require a non-empty map without a zod-only rule, so the contract allows it.
- **The stress test is a reconstruction.** The POC's 250-operation stress test isn't in this repository; `patches.test.ts` rebuilds it from its description: two editors, the tool and chat, with seeded random batches checked against a plain model of records by ID.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `index.ts`: `applyPatch`, `createDataState`, `revisionOf`, `DataState` (type), `PatchOptions` (type), `PatchRefusal` (type), `PatchResult` (type), `ToolData` (type)
- `patches.ts`: `ToolData` (type), `DataState` (type), `PatchRefusal` (type), `PatchResult` (type), `PatchOptions` (type), `createDataState`, `revisionOf`, `applyPatch`
