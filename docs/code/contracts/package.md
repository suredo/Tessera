---
type: Code Package
title: "Contracts package"
description: "@tessera/contracts: every shape that crosses a boundary, defined once with zod, with its generated JSON Schema and the unit rule for numbers."
resource: ../../../packages/contracts/
implements: [CON-01, CON-02, CON-04, CON-05, GEN-01, CLI-04, OBS-01, DATA-08, DATA-09, DATA-05, DATA-02]
tests: [../../../packages/contracts/test/artifact.test.ts, ../../../packages/contracts/test/intent.test.ts, ../../../packages/contracts/test/json.test.ts, ../../../packages/contracts/test/patch.test.ts, ../../../packages/contracts/test/provider.test.ts, ../../../packages/contracts/test/schemas.test.ts, ../../../packages/contracts/test/units.test.ts]
tags: [code, contracts]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-20T07:40:12Z }
---

# Purpose

Defines each shape that crosses a boundary once, with zod (`CON-01`): model outputs now, and bridge messages, artifacts and stored records from M1. The host validates with the zod schema, TypeScript takes its types from it, and the JSON Schema handed to the CLI is generated from it, so the three can't drift apart. So far it holds the draft answer of the intent stage (`GEN-01`), which the M0 live spikes will use, and what crosses the provider boundary: stages, efforts, error kinds, normalized usage (`CLI-04`) and the scripts a scripted provider answers from. The first stored records are an evaluation run's call ledger and request log (`OBS-01`, `OBS-02`), the first artifact is a tool version (`CON-04`, `DATA-04`), and the first change to a tool's data is a patch batch (`DATA-02`). Workspaces, their version history and saved tools are the first records the server keeps for a person (`DATA-08`), the trash says what is deleted and when it goes (`DATA-09`), and an export archive's manifest says what it holds (`DATA-05`).

# Entry points

- `src/index.ts`: everything the package exports.
- `src/artifact.ts`: `artifactSchema`, a tool version: code, data schema, reusable defaults, capabilities, pins and UI mode; `canonicalJson`, the text its hash is taken of; and `readArtifact`, which reads a stored version of any contract version as current, upgraded (through `ARTIFACT_UPGRADES`) or incompatible with a reason (`CON-04`, [tool versions](../server/versions.md)).
- `src/workspace.ts`: `workspaceSchema`, `workspaceVersionSchema` and `savedToolSchema`, what the server stores for each workspace, version history entry and saved tool ([workspaces](../server/workspaces.md)).
- `src/trash.ts`: `TRASH_RETENTION_DAYS` (30), `trashEntrySchema`, a deleted workspace (with the saved tools that went with it) or saved tool, and `trashSchema`, the trash with the confirmation that empties exactly it ([trash](../server/trash.md)).
- `src/archive.ts`: `archiveManifestSchema`, the manifest of an export archive, with `archivedWorkspaceSchema`, a workspace with its whole history; `ARCHIVE_FORMAT` and `ARCHIVE_FORMAT_VERSION` name the format ([archives](../server/archives.md)).
- `src/json.ts`: `jsonValueSchema` and `jsonObjectSchema`, the JSON Tessera stores (a tool version's data schema and defaults, a workspace's data, a patch's values), `RESERVED_JSON_KEY`, and `refusingReservedKey`, the one rule that refuses the reserved key at any depth, which any contract wraps itself in (the patch batch does).
- `src/patch.ts`: `patchBatchSchema`, a batch of add, replace and remove operations on records with stable IDs, which the [patch engine](../server/patches.md) applies; `recordIdSchema`; and `TOOL_DATA_LIMIT_BYTES`, the data limit (`DATA-06`). A replace names its fields in a map, `fields: { done: true }`, so the tool's own field names carry any unit (`CON-05`).
- `src/intent.ts`: `intentSchema` and its `Intent` type.
- `src/provider.ts`: `STAGES`, `EFFORTS`, `PROVIDER_ERROR_KINDS`, `usageSchema`, where unknown is null and never 0, and `providerScriptSchema`, the canned replies of a scripted provider ([provider adapters](../server/providers.md)).
- `src/ledger.ts`: `ledgerEntrySchema` and `requestLogEntrySchema`, one line each per call of an evaluation run ([evaluation harness](../evals/harness.md)). A ledger entry's outcome is a discriminated union, so an error kind exists only on a failed call (`CON-02`).
- `src/json-schema.ts`: `contracts`, the list of contracts whose JSON Schema leaves the process; `jsonSchemaOf`, the JSON Schema of any zod schema in `JSON_SCHEMA_TARGET`, the draft the CLI accepts; and `renderSchemaFiles`, which produces the schema files.
- `src/units.ts`: the unit rule (`CON-05`) and `numericFieldsWithoutUnit`, which checks it.
- `scripts/generate-schemas.ts`: writes `schemas/*.schema.json`. Run it as `pnpm contracts:schemas`.

# Invariants

- **Stored JSON is kept exactly or refused whole.** A JavaScript object can't keep an own `__proto__` key, and zod's own JSON schemas silently drop one, so `jsonValueSchema` and `jsonObjectSchema` refuse any object with that key, at any depth, before parsing; the generated JSON Schema refuses it too (`propertyNames`). Every other key is kept, including `constructor` and `toString`. Codex's review of [pull request 63](https://github.com/suredo/Tessera/pull/63) found the silent loss.
- **One definition.** A shape exists only as a zod schema here. The files in `schemas/` are generated and never edited by hand. A test fails while they differ from the zod definitions.
- **zod and the JSON Schema agree.** Constraints are written so they appear in the JSON Schema too: discriminated unions, enums, patterns, strict objects. A zod-only refinement would let the model's contract and the host's check disagree. The intent tests check both on the same valid and invalid samples.
- **JSON Schema draft-07.** Claude Code checks `--json-schema` with a draft-07 validator and refuses draft 2020-12: the CLI contract spike's first live call found it on 2.1.296 (#19). Every schema that leaves the process comes from `jsonSchemaOf`, and the intent tests validate with the same kind of validator. For today's contracts the two drafts differ only in `$schema`.
- **A field means one thing** (`CON-02`). Each `kind` of intent is its own branch: `savedToolId` exists only for `open_saved`, and `null` means only "nothing".
- **Numbers name their unit** (`CON-05`). A numeric field ends in a unit (`Ms`, `Seconds`, `Minutes`, `Hours`, `Days`, `Bytes`, `Px`, `Percent`, `Tokens`, `Usd`), or it is unitless: a name ending in `Count`, `Index`, `Version` or `Revision`, or exactly `count`, `index`, `version` or `revision`. A test checks every contract, looking through unions, intersections and shared definitions (`$ref`) while keeping the field's name. A new unit is added to `UNIT_SUFFIXES` in `src/units.ts`, which keeps both lists.
- **Platform-free.** The browser host, the sandboxed runtime and the server all import this package, so `src/` uses no Node or browser APIs. Only `scripts/` and `test/` use Node.

# Depends on / used by

Depends on zod. The server uses it, its provider adapters included, and so does the evaluation harness; the host, the runtime and the live spikes (#19, #20) will too.

# Pitfalls

- **After changing a contract, run `pnpm contracts:schemas`** and commit the result, or the schema test fails.
- **zod records drop a `__proto__` key silently,** while the JSON Schema refuses it. The patch contract keeps them agreeing (`CON-01`): its JSON values refuse `__proto__` as a key at any depth, and `patchBatchSchema` refuses a batch holding one before zod parses it, so both validators refuse the same batches and nothing sets a prototype. A new contract carrying free-form JSON across a boundary should do the same; the artifact's `z.json()` data schema and defaults don't yet.
- **The script format is not in `contracts`,** since it never leaves the process: it has no schema file. Usage reaches `contracts` inside the ledger entry. A canned reply's value is any JSON: its shape is the stage's own contract.
- **The intent contract is a draft.** The intent spike (#20) and the generation pipeline (M2) may change it. Claude Code's acceptance of the generated schema, including `oneOf`, is checked by the CLI spike (#19).
- **zod features that only draft 2020-12 can express** (such as tuples written as `prefixItems`) would be written differently or refused by the CLI. Check a new contract's generated file before relying on it.
- **A union contract can't go to the CLI as it is.** The API takes the schema as a tool's input schema, which must be an object at the top level, so the caller wraps every contract as `{ answer: <contract> }` and unwraps the reply ([CLI contract spike](../evals/cli-contract-spike.md)). The files in `schemas/` stay the contracts themselves.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `src/archive.ts`: `ARCHIVE_FORMAT`, `ARCHIVE_FORMAT_VERSION`, `archivedWorkspaceSchema`, `ArchivedWorkspace` (type), `archiveManifestSchema`, `ArchiveManifest` (type)
- `src/artifact.ts`: `ARTIFACT_CONTRACT_VERSION`, `UI_MODES`, `artifactSchema`, `Artifact` (type), `canonicalJson`, `ArtifactUpgrades` (type), `ARTIFACT_UPGRADES`, `ArtifactReading` (type), `readArtifact`
- `src/index.ts`: `ARCHIVE_FORMAT`, `ARCHIVE_FORMAT_VERSION`, `archivedWorkspaceSchema`, `archiveManifestSchema`, `ArchivedWorkspace` (type), `ArchiveManifest` (type), `ARTIFACT_CONTRACT_VERSION`, `ARTIFACT_UPGRADES`, `artifactSchema`, `canonicalJson`, `readArtifact`, `UI_MODES`, `Artifact` (type), `ArtifactReading` (type), `ArtifactUpgrades` (type), `jsonObjectSchema`, `jsonValueSchema`, `refusingReservedKey`, `RESERVED_JSON_KEY`, `JsonValue` (type), `INTENT_KINDS`, `intentSchema`, `Intent` (type), `contracts`, `JSON_SCHEMA_TARGET`, `jsonSchemaOf`, `renderSchemaFiles`, `toJsonSchema`, `ContractName` (type), `ledgerEntrySchema`, `requestLogEntrySchema`, `RUN_MODES`, `LedgerEntry` (type), `RequestLogEntry` (type), `patchBatchSchema`, `recordIdSchema`, `TOOL_DATA_LIMIT_BYTES`, `PatchBatch` (type), `PatchOperation` (type), `EFFORTS`, `effortSchema`, `PROVIDER_ERROR_KINDS`, `providerErrorKindSchema`, `providerScriptSchema`, `scriptedReplySchema`, `STAGES`, `stageSchema`, `usageSchema`, `Effort` (type), `ProviderErrorKind` (type), `ProviderScript` (type), `ScriptedReply` (type), `Stage` (type), `Usage` (type), `numericFieldsWithoutUnit`, `UNIT_SUFFIXES`, `UNITLESS_NAMES`, `UNITLESS_SUFFIXES`, `TRASH_RETENTION_DAYS`, `trashEntrySchema`, `trashSchema`, `Trash` (type), `TrashEntry` (type), `savedToolSchema`, `workspaceSchema`, `workspaceVersionSchema`, `SavedTool` (type), `Workspace` (type), `WorkspaceVersion` (type)
- `src/intent.ts`: `INTENT_KINDS`, `intentSchema`, `Intent` (type)
- `src/json-schema.ts`: `contracts`, `ContractName` (type), `JSON_SCHEMA_TARGET`, `jsonSchemaOf`, `toJsonSchema`, `renderSchemaFiles`
- `src/json.ts`: `RESERVED_JSON_KEY`, `JsonValue` (type), `refusingReservedKey`, `jsonValueSchema`, `jsonObjectSchema`
- `src/ledger.ts`: `RUN_MODES`, `ledgerEntrySchema`, `LedgerEntry` (type), `requestLogEntrySchema`, `RequestLogEntry` (type)
- `src/patch.ts`: `TOOL_DATA_LIMIT_BYTES`, `recordIdSchema`, `PatchOperation` (type), `patchBatchSchema`, `PatchBatch` (type)
- `src/provider.ts`: `STAGES`, `stageSchema`, `Stage` (type), `EFFORTS`, `effortSchema`, `Effort` (type), `PROVIDER_ERROR_KINDS`, `providerErrorKindSchema`, `ProviderErrorKind` (type), `usageSchema`, `Usage` (type), `scriptedReplySchema`, `ScriptedReply` (type), `providerScriptSchema`, `ProviderScript` (type)
- `src/trash.ts`: `TRASH_RETENTION_DAYS`, `trashEntrySchema`, `TrashEntry` (type), `trashSchema`, `Trash` (type)
- `src/units.ts`: `UNIT_SUFFIXES`, `UNITLESS_SUFFIXES`, `UNITLESS_NAMES`, `numericFieldsWithoutUnit`
- `src/workspace.ts`: `workspaceSchema`, `Workspace` (type), `workspaceVersionSchema`, `WorkspaceVersion` (type), `savedToolSchema`, `SavedTool` (type)
