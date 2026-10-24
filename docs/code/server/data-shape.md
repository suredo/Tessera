---
type: Code Module
title: "Data shape"
description: "A tool's data shape: its declared JSON Schema checked for safety before it is compiled, and declarative migrations run on a copy, checked against both schemas."
resource: ../../../packages/server/src/data-shape/
implements: [DATA-03, MIG-03, MIG-04, MIG-05]
tests: [../../../packages/server/test/data-shape.test.ts]
tags: [code, server, data]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-24T23:24:16Z }
---

# Purpose

Each tool declares a versioned data shape: a JSON Schema and a schema version, with the migrations that bring data of each earlier version to it (`DATA-03`, the [artifact contract](../contracts/package.md)). This module checks data against such a schema, and migrates data from one shape to the next, on a copy, without running any code (`SEC-01`). Activation and restore (#50) commit what it returns, or keep the committed unit.

# Entry points

- `src/data-shape/schema.ts`: `compileToolSchema` checks a tool's schema and compiles it with Ajv, or says why it can't be used; `checkToolData` says whether data fits a schema, and if not where and why. `TOOL_SCHEMA_LIMIT_BYTES` is the largest schema accepted.
- `src/data-shape/migrate.ts`: `migrateData` migrates data from the shape it is in (`DataShape`: a schema version and its schema) to a tool version's, and returns the new data or a refusal with a reason (`MigrationRefusal`) and a message that starts with "Nothing was changed:". `applyMigrations` runs migrations on a copy.

# Invariants

- **Migrations are data, never code** (`SEC-01`). The six operations of the [migration contract](../contracts/package.md) (rename a list or a field, add fields with constant values, remove a field, map values by a table, convert between numbers and text) are carried out here by fixed code; nothing evaluates migration text, so executable migrations stay disabled. The contract refuses code, unknown operations and anything out of bounds (`MIG-01`, `MIG-02`).
- **Checked against both schemas, on a copy** (`DATA-03`, `MIG-03`). The data must fit its own schema before it is migrated, and the result must fit the target's. The migrations run on a copy, so data that fails half way, or a result that doesn't fit, leaves what it was given untouched.
- **Bounded and repeatable** (`MIG-04`). Each step goes from one schema version to the next, and a missing step is refused. The result's size as JSON is kept exactly as each change is made, and the run stops as soon as it would pass the data limit (`DATA-06`), or the data's own size if that is larger, so a single operation that would grow the data without end is refused after a few records, never built whole. The migrations run twice, on two copies, and two different results are refused.
- **A conversion never changes a value.** `setType` turns text into a number only when the number stands for exactly the same decimal, compared as decimals whatever notation JavaScript prints ("12.50" becomes 12.5 and "0.0000001" becomes 1e-7; "999999999999999.99", "-0" and "1e3" are refused), and a number into its shortest text.
- **Nothing outside** (`MIG-05`). A migration, compiling its schemas included, opens no connection, starts no process and touches no file; a test runs one under the tripwires.
- **A schema may only ask for checks that grow with the data.** Checking runs in the server and a tool's schema will come from a model (M2), so a schema may use only `TOOL_SCHEMA_KEYWORDS`: types, properties and required fields, items, enums and constants, and numeric, length, item and property bounds. No patterns or formats (a regular expression can take exponential time, even on a text of 64 characters), no references (`{ "$ref": "#" }` recurses without end), no combinators and no `uniqueItems`. Before anything recursive reads it (its canonical JSON, the subset check, Ajv), a first pass without recursion counts its parts and depth, values in `const`, `enum` and `default` included, and refuses one with more than `TOOL_SCHEMA_MAX_PARTS` parts or nested too deeply, so a schema thousands of levels deep is a refusal, not a crash. It must also be at most `TOOL_SCHEMA_LIMIT_BYTES`, nest at most `TOOL_SCHEMA_MAX_DEPTH` levels, list at most `TOOL_SCHEMA_MAX_ENUM` enum values, and name draft-07 if it names a draft. Anything else is refused with where and why, before Ajv compiles it. Each schema compiles in an Ajv of its own; compiled checks are kept by the schema's canonical JSON.
- **Only the data's own fields count.** Ajv runs with own-property semantics, so a required field named like something objects inherit, such as `constructor`, is present only when the data has it.

# Depends on / used by

Depends on the contracts and Ajv (draft-07, the owner's choice on #50). Activation and restore (#50) will use it.

# Pitfalls

- **Draft-07 only.** Ajv runs in its draft-07 mode, the draft the contracts' schemas use (`CON-01`); a tool schema using a newer draft's keywords is refused as unknown keywords.
- **The keyword list is deliberately short.** Richer keywords (patterns, combinators, references) can be added later only with a bound on their cost and a test that tries to break it. Ajv's stricter style checks, such as requiring every required property to be listed, would refuse valid schemas, so they are off.
- **An enum or constant is compared by value.** Its cost is bounded by the schema's size limit and the data's.
- **The migration runner is replaceable in tests.** `migrateData`'s last argument is the step that runs the migrations; tests pass one that differs between runs to show that is refused. Production code never passes it.
- **Converting back is not a migration.** Migrations only go forward. Restoring a version with an older shape projects the data onto the older schema, with a loss preview (#50, a later part).

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `index.ts`: `applyMigrations`, `migrateData`, `DataShape` (type), `MigrationRefusal` (type), `MigrationResult` (type), `checkToolData`, `compileToolSchema`, `TOOL_SCHEMA_LIMIT_BYTES`, `SchemaCheck` (type)
- `migrate.ts`: `DataShape` (type), `MigrationRefusal` (type), `MigrationResult` (type), `applyMigrations`, `migrateData`
- `schema.ts`: `TOOL_SCHEMA_LIMIT_BYTES`, `TOOL_SCHEMA_MAX_DEPTH`, `TOOL_SCHEMA_MAX_ENUM`, `TOOL_SCHEMA_MAX_PARTS`, `TOOL_SCHEMA_KEYWORDS`, `SchemaCheck` (type), `compileToolSchema`, `checkToolData`
