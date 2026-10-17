---
type: Requirement Area
title: "Contracts"
description: "One schema source, explicit output unions, the bridge manifest, versioned contracts and units (CON-01 to CON-05)."
tags: [spec, contracts, schemas]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-17T03:28:33Z }
---
# Contracts (`CON`)

| ID | Requirement |
| --- | --- |
| CON-01 | **One schema source.** All cross-boundary shapes are defined once in `packages/contracts`, with zod (A14): artifacts, bridge messages, stored records, and every model output (intent, generation, repair, review). TypeScript types and the JSON Schema passed to the CLI (`--json-schema`) are generated from it, in draft-07, the version Claude Code accepts (L-70, [ADR 0002](../decisions/adr/0002-claude-code-cli-contract.md)). No hand-written duplicate schemas. |
| CON-02 | **No overloaded meanings.** Model outputs use explicit discriminated unions, for example `files: { mode: "unchanged" }` versus `{ mode: "replace", ... }`. A `null` never means two different things. (The POC read `files: null` as "nothing to change" and discarded a valid engine-only change.) |
| CON-03 | **Bridge API manifest.** Every host API available to generated code (actions, capabilities, arguments, return values, limits, examples) is listed in one machine-readable manifest. The prompt's API section, the static checks (`VER-01`) and runtime enforcement (`RUN-04`) are all generated from it. |
| CON-04 | **Versioned contracts.** Artifacts and stored records carry contract versions. Older saved tools are revalidated on open and either migrated or clearly marked incompatible. They never fail silently. |
| CON-05 | **Units in contracts.** Any numeric field that has a unit names it (`waitSeconds`, not `wait`). Prompts ask generated code and checks to name units the same way. (The POC lost a live run to seconds versus minutes.) |
