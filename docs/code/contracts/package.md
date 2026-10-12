---
type: Code Package
title: "Contracts package"
description: "@tessera/contracts: every shape that crosses a boundary, defined once with zod, with its generated JSON Schema and the unit rule for numbers."
resource: ../../../packages/contracts/
implements: [CON-01, CON-02, CON-05, GEN-01]
tests: [../../../packages/contracts/test/intent.test.ts, ../../../packages/contracts/test/schemas.test.ts, ../../../packages/contracts/test/units.test.ts]
tags: [code, contracts]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-12T08:11:39Z }
---

# Purpose

Defines each shape that crosses a boundary once, with zod (`CON-01`): model outputs now, and bridge messages, artifacts and stored records from M1. The host validates with the zod schema, TypeScript takes its types from it, and the JSON Schema handed to the CLI is generated from it, so the three can't drift apart. So far it holds one contract: the draft answer of the intent stage (`GEN-01`), which the M0 live spikes will use.

# Entry points

- `src/index.ts`: everything the package exports.
- `src/intent.ts`: `intentSchema` and its `Intent` type.
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

Depends on zod. The server uses it, and so will the host, the runtime, the evaluation harness and the live spikes (#19, #20).

# Pitfalls

- **After changing a contract, run `pnpm contracts:schemas`** and commit the result, or the schema test fails.
- **The intent contract is a draft.** The intent spike (#20) and the generation pipeline (M2) may change it. Claude Code's acceptance of the generated schema, including `oneOf`, is checked by the CLI spike (#19).
