---
type: Code Package
title: "Contracts package"
description: "@tessera/contracts: every shape that crosses a boundary, defined once with zod, with its generated JSON Schema and the unit rule for numbers."
resource: ../../../packages/contracts/
implements: [CON-01, CON-02, CON-05, GEN-01, CLI-04]
tests: [../../../packages/contracts/test/intent.test.ts, ../../../packages/contracts/test/provider.test.ts, ../../../packages/contracts/test/schemas.test.ts, ../../../packages/contracts/test/units.test.ts]
tags: [code, contracts]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-17T00:30:48Z }
---

# Purpose

Defines each shape that crosses a boundary once, with zod (`CON-01`): model outputs now, and bridge messages, artifacts and stored records from M1. The host validates with the zod schema, TypeScript takes its types from it, and the JSON Schema handed to the CLI is generated from it, so the three can't drift apart. So far it holds the draft answer of the intent stage (`GEN-01`), which the M0 live spikes will use, and what crosses the provider boundary: stages, efforts, error kinds, normalized usage (`CLI-04`) and the scripts a scripted provider answers from.

# Entry points

- `src/index.ts`: everything the package exports.
- `src/intent.ts`: `intentSchema` and its `Intent` type.
- `src/provider.ts`: `STAGES`, `EFFORTS`, `PROVIDER_ERROR_KINDS`, `usageSchema`, where unknown is null and never 0, and `providerScriptSchema`, the canned replies of a scripted provider ([provider adapters](../server/providers.md)).
- `src/json-schema.ts`: `contracts`, the list of contracts whose JSON Schema leaves the process, and `renderSchemaFiles`, which produces the schema files.
- `src/units.ts`: the unit rule (`CON-05`) and `numericFieldsWithoutUnit`, which checks it.
- `scripts/generate-schemas.ts`: writes `schemas/*.schema.json`. Run it as `pnpm contracts:schemas`.

# Invariants

- **One definition.** A shape exists only as a zod schema here. The files in `schemas/` are generated and never edited by hand. A test fails while they differ from the zod definitions.
- **zod and the JSON Schema agree.** Constraints are written so they appear in the JSON Schema too: discriminated unions, enums, patterns, strict objects. A zod-only refinement would let the model's contract and the host's check disagree. The intent tests check both on the same valid and invalid samples.
- **A field means one thing** (`CON-02`). Each `kind` of intent is its own branch: `savedToolId` exists only for `open_saved`, and `null` means only "nothing".
- **Numbers name their unit** (`CON-05`). A numeric field ends in a unit (`Ms`, `Seconds`, `Minutes`, `Hours`, `Days`, `Bytes`, `Px`, `Percent`, `Tokens`, `Usd`), or it is unitless: a name ending in `Count`, `Index` or `Version`, or exactly `count`, `index` or `version`. A test checks every contract, looking through unions, intersections and shared definitions (`$ref`) while keeping the field's name. A new unit is added to `UNIT_SUFFIXES` in `src/units.ts`, which keeps both lists.
- **Platform-free.** The browser host, the sandboxed runtime and the server all import this package, so `src/` uses no Node or browser APIs. Only `scripts/` and `test/` use Node.

# Depends on / used by

Depends on zod. The server uses it, its provider adapters included, and so will the host, the runtime, the evaluation harness and the live spikes (#19, #20).

# Pitfalls

- **After changing a contract, run `pnpm contracts:schemas`** and commit the result, or the schema test fails.
- **The provider shapes are not in `contracts` yet,** so they have no schema file and the unit test doesn't see them; `provider.test.ts` checks the units of `usageSchema` itself. A canned reply's value is any JSON: its shape is the stage's own contract.
- **The intent contract is a draft.** The intent spike (#20) and the generation pipeline (M2) may change it. Claude Code's acceptance of the generated schema, including `oneOf`, is checked by the CLI spike (#19).

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `src/index.ts`: `INTENT_KINDS`, `intentSchema`, `Intent` (type), `contracts`, `renderSchemaFiles`, `toJsonSchema`, `ContractName` (type), `EFFORTS`, `effortSchema`, `PROVIDER_ERROR_KINDS`, `providerErrorKindSchema`, `providerScriptSchema`, `scriptedReplySchema`, `STAGES`, `stageSchema`, `usageSchema`, `Effort` (type), `ProviderErrorKind` (type), `ProviderScript` (type), `ScriptedReply` (type), `Stage` (type), `Usage` (type), `numericFieldsWithoutUnit`, `UNIT_SUFFIXES`, `UNITLESS_NAMES`, `UNITLESS_SUFFIXES`
- `src/intent.ts`: `INTENT_KINDS`, `intentSchema`, `Intent` (type)
- `src/json-schema.ts`: `contracts`, `ContractName` (type), `toJsonSchema`, `renderSchemaFiles`
- `src/provider.ts`: `STAGES`, `stageSchema`, `Stage` (type), `EFFORTS`, `effortSchema`, `Effort` (type), `PROVIDER_ERROR_KINDS`, `providerErrorKindSchema`, `ProviderErrorKind` (type), `usageSchema`, `Usage` (type), `scriptedReplySchema`, `ScriptedReply` (type), `providerScriptSchema`, `ProviderScript` (type)
- `src/units.ts`: `UNIT_SUFFIXES`, `UNITLESS_SUFFIXES`, `UNITLESS_NAMES`, `numericFieldsWithoutUnit`
