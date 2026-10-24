---
type: Code Module
title: "Tool versions"
description: "Immutable tool versions stored once under the SHA-256 of their canonical JSON, checked against the artifact contract on the way in and read back as current, upgraded or plainly incompatible."
resource: ../../../packages/server/src/versions/
implements: [DATA-04, CON-04, CON-01]
tests: [../../../packages/server/test/versions.test.ts, ../../../packages/contracts/test/artifact.test.ts]
tags: [code, server, versions, data]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-24T08:48:40Z }
---

# Purpose

Stores every tool version, the artifact, so that restore, undo, Continue and Use again can point at an exact one (`DATA-04`). A version is immutable and named by the SHA-256 of its canonical JSON. Reading one back follows `CON-04`: a current version comes back as it is, an older one is upgraded, and anything else is marked incompatible with a plain reason, never used silently. The artifact contract itself lives in `@tessera/contracts` ([contracts package](../contracts/package.md)).

# Entry points

- `src/versions/versions.ts`: `saveVersion` checks an artifact against the contract, stores it and returns its hash; `loadVersion` reads one back as the contract's reading of it (current, upgraded or incompatible); `hashArtifact` names an artifact without storing it.
- The table is created by Tessera's first schema migration, `0001-tool-versions.sql` ([storage](storage.md)).

# Invariants

- **One copy per content.** The hash is of the canonical JSON (keys sorted at every level), so the same content always has the same name, whatever its key order; storing it again keeps the one row.
- **Never changed after it is stored.** The `tool_versions` table refuses every update (a trigger), so a version can only be added or, later, removed with what owns it.
- **Never stored unless it fits the contract.** `saveVersion` parses the artifact first; an invalid one throws and nothing is written.
- **Checked when read.** A stored body that no longer matches its hash, a body that isn't JSON, a version from a newer Tessera and one that no longer fits the contract are each returned as incompatible with a reason (`CON-04`). An older contract version is upgraded through the contract's upgrades: a version 1 artifact reads as version 2 with no migrations. Its stored body and hash stay as they were.

# Depends on / used by

Depends on the [storage](storage.md) module, the artifact contract and Node's `crypto`. Activation and restore (#50), the asset store's references (#49) and the app shell (#53) build on it.

# Pitfalls

- **An upgraded version has a new hash.** Reading an old version upgrades it in memory; saving the upgraded artifact stores it as a new version. Whatever pointed at the old hash still does, until activation (#50) decides to move it.
- **The data schema and defaults are free-form JSON here.** Whether a tool's schema is a valid JSON Schema, and whether its defaults fit it, is checked by activation (#50, `DATA-03`), not by the artifact contract.
- **Removed only with what used it.** When the [trash](trash.md) removes a workspace for good, it removes the versions that workspace used and no workspace refers to any more; a version no workspace has referred to yet is kept. A new table that refers to versions must join that check (#49, #50).

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `index.ts`: `hashArtifact`, `loadVersion`, `saveVersion`
- `versions.ts`: `hashArtifact`, `saveVersion`, `loadVersion`
