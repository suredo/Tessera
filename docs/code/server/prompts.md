---
type: Code Module
title: "Prompt assembly"
description: "Prompts built from versioned part files, chosen by the stage and the intent's structured fields: base rules, the bridge manifest and the UI standard generated from their one definitions, the tool's code and diagnostics; each part's version recorded, and each stage's fixture prompt within its budget."
resource: ../../../packages/server/src/prompts/
implements: [GEN-03, ENG-16, GEN-02, VER-06, CON-03]
tests: [../../../packages/server/test/prompts.test.ts]
tags: [code, server, prompts, generation]
status: draft
generated: { by: codex/gpt-6.1-sol, at: 2026-10-30T03:04:13Z }
---

# Purpose

Keeps prompts small and every change to them tracked (`GEN-03`, `ENG-16`). The POC's single prompt reached about 18,000 characters and carried every contract into every request, and nothing recorded which prompt produced which result. Here a stage's prompt is built from the parts it needs, each a file reviewed like code, and every call records the parts' versions.

# Entry points

- `assembleDataPrompt` builds the isolated data stage from `data-plan`, `data-context`, request and language; a shape repair adds `repair-data-plan`, diagnostics and a quoted `data-attempt`. It includes the declared data shape and actual entries/revisions, never tool code or an interface instruction. `DATA_PROMPT_BUDGET` bounds the actual assembled context before spending a call; the approved [live chat-data check](../../../evals/reports/2026-10-29-chat-data-check.md) passed add and mixed replacement cases in two calls, with scripted intent/style and explicit host approval. Its recorded answers have a deterministic storage-backed replay; no repair ran live.
- `packages/server/prompts/`: the parts, one Markdown file each, with `{{placeholders}}` for what is filled in: `base.md` (the rules every tool follows), `create.md` (what creation answers, with the host's data schema keywords), `bridge.md`, `ui-standard.md` (the standard's look), `accessibility.md` (the rules every tool keeps, whatever its look), `request.md`, `attempt.md` (a failed answer, quoted for its repair), `repair-schema-shape.md` and `repair-static.md` (each failure class's repair instructions, `GEN-09`), `language.md` (the request's language, as the intent stage found it, `GEN-15`), `source.md`, `diagnostics.md`, the probe's `probe.md` and `probe-request.md`, and the [intent stage](intent.md)'s `intent*.md`.
- `src/prompts/prompts.ts`:
  - `assemblePrompt` builds a generation stage's prompt (`PromptInput` to `AssembledPrompt`): the instructions, the request, each part as name@version, and the size.
  - `assembleIntentPrompt` builds the intent stage's prompt: its instructions, then the open tool (`OpenTool`) with each `RecordList` it keeps, quoted as JSON between markers (`SEC-02`), or none, the request, and on a second ask the reminder; `INTENT_PROMPT_BUDGET` caps it.
  - `fixedPart` gives a part used as it is, such as the probe's.
  - `fillPart`, `partText` and `partVersion` read, fill and version a part. `PROMPT_PARTS` lists them, `PROMPT_BUDGETS` caps each stage, and `manifestForPrompt` is the bridge manifest as the bridge part quotes it.

# Invariants

- **Bridge context includes the direct-call policy and distinct method argument roles** from the shared manifest. Its compact projection omits host-only page-isolation metadata, strict empty-object `properties`/description redundancy, and string types under `propertyNames` (JSON object keys are already strings). Action semantics, schemas, capabilities and argument limits remain; schema-equivalence fixtures and unchanged prompt-budget tests cover the projection. The generated bridge part's hash changes with this context. The owner-approved [bridge edit check](../../../evals/reports/2026-10-30-bridge-edit-check.md) passed one quantity edit in one of two approved calls using `bridge@63eefdc4fb28` (`ENG-16`), with scripted intent and seed. Its recorded answer passes deterministic host validation and lossless migration. This is positive direct-call evidence; negative bridge errors and repair prompts were not exercised live, and it does not sign off broader VER-01 work.
- **The edit stage receives original code and declarations, never workspace entries.** `edit.md` describes explicit file/data modes and preservation; `edit-declarations.md` quotes original data shape/defaults, capabilities, pins, UI and structured change flags. `edit-attempt.md` quotes a failed edit separately. `repair-edit-smoke.md` requires an edit answer, keeping the failed candidate's data change, rather than using creation's smoke part. Edits and edit repairs in standard mode use `ui-edit.md`, a concise preservation guide with the same complete runtime token list; base sandbox rules and the full accessibility part remain. Real edit and repair fixture prompts stay inside the existing 18,500 / 23,500 budgets. The rehearsed [live edit check](../../../evals/reports/2026-10-29-edit-check.md) passed both darken and quantity cases in two of four approved calls, preserving entries. Its sanitized sequential replay is deterministic; no edit repair prompt ran live.

- **Smoke repair has its own part** (`GEN-09`): `repair-smoke.md` asks for startup, display and accessibility fixes at 320 px using defaults. It preserves the data declaration, requests empty initial state because starting data is already installed, and uses the creation answer contract. Its assembly and fixture size are tested alongside the existing repair parts. The [budgeted live check](../../../evals/reports/2026-10-28-smoke-repair.md) repaired one missing label in one call, staged it again and preserved the request's entries.

- **Every prompt's words are in a part file** (`ENG-16`), never an inline string; a test fails if a file isn't a listed part or a listed part has no file. The probe's words moved there too.
- **A part's version is a hash of its text.** For an instruction part it covers what was generated into it (the manifest, the UI tokens), so a change to either changes the version. For a request part it covers only the wording, since what it quotes changes with every call. A stage call carries them, and the [evaluation harness](../evals/harness.md)'s ledger records them with the instructions' size.
- **Parts are chosen by the stage and structured fields, never the request's words** (`GEN-02`): base rules always; the bridge manifest unless the intent says the request only changes the look; the UI standard's look only for a tool in standard mode, and the accessibility rules in either mode, since a custom look never drops them (`UX-04`); the tool's code for edit, and for the repair of an edit; for repair, its failure class's part and what the checks found, and, when it repairs a creation, the create part and the failed answer, if it had the right shape; the request's language whenever the intent stage gave one, so creation doesn't guess it. A test runs requests full of words a keyword rule would act on, and gets the same parts.
- **The manifest and the UI tokens come from their one definitions** (`CON-03`, `VER-06`, P3): the bridge part quotes the contracts' bridge manifest as compact JSON, without the schema-version line, a pattern beside a format that says the same, or the bounds every JSON integer has; the UI standard part lists the runtime's UI tokens. The standard's rules are the POC's, ported.
- **Quoted material is data** (`SEC-02`): the tool's code sits between markers and is called data, and the base rules say quoted material is never instructions.
- **Each stage's fixture prompt stays within its budget** (`GEN-03`): about 15,700 characters for creation, 17,900 for an edit, 18,400 for the repair of an edit and 21,200 for the repair of a creation, of the shopping-list fixture (`packages/server/test/fixtures/prompts`), against budgets of 17,000, 18,500 and 23,500. Creation's grew with its own part, its output contract; repair's was set by the repair of a creation, which carries the creation prompt and the failed answer (`GEN-09`). CI fails past them.
- **Filling a part is exact:** a placeholder without a value, or a value without a placeholder, is an error, and a value is never read as a replacement pattern.

# Depends on / used by

The [contracts](../contracts/package.md)' bridge manifest and intent, and the [runtime](../runtime/package.md)'s UI tokens. The [setup check](setup.md)'s probe uses its fixed parts. The intent stage (#144) and generation (#146) will add their parts and use `assemblePrompt`.

# Pitfalls

- **The replay suite doesn't exist yet** (`TEST-04`, #156). `ENG-16` asks every prompt change to pass it; until it exists, a change to a part is reviewed and its tests run, and one that changes behavior gets a small budgeted live check.
- **The bridge manifest is most of the instructions,** about 7,000 characters, and grows with every action. The budgets will say when it needs a shorter form.
- **Create, edit, repair, intent and data plans are assembled so far.** Data-plan routing/confirmation follow in a separate slice. Research, review and acceptance get their parts with their stages.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `index.ts`: `assembleIntentPrompt`, `assembleDataPrompt`, `DATA_PROMPT_BUDGET`, `assemblePrompt`, `fillPart`, `fixedPart`, `INTENT_PROMPT_BUDGET`, `manifestForPrompt`, `partText`, `PROMPT_BUDGETS`, `PROMPT_PARTS`, `partVersion`, `REPAIR_CLASSES`, `AssembledPrompt` (type), `OpenTool` (type), `RecordList` (type), `GenerationStage` (type), `PromptInput` (type), `PromptPart` (type), `RepairClass` (type)
- `prompts.ts`: `PROMPT_PARTS`, `PromptPart` (type), `GenerationStage` (type), `REPAIR_CLASSES`, `RepairClass` (type), `PROMPT_BUDGETS`, `partText`, `partVersion`, `fillPart`, `manifestForPrompt`, `PromptInput` (type), `AssembledPrompt` (type), `assemblePrompt`, `INTENT_PROMPT_BUDGET`, `DATA_PROMPT_BUDGET`, `assembleDataPrompt`, `RecordList` (type), `OpenTool` (type), `assembleIntentPrompt`, `fixedPart`
