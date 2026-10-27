---
type: Code Module
title: "Prompt assembly"
description: "Prompts built from versioned part files, chosen by the stage and the intent's structured fields: base rules, the bridge manifest and the UI standard generated from their one definitions, the tool's code and diagnostics; each part's version recorded, and each stage's fixture prompt within its budget."
resource: ../../../packages/server/src/prompts/
implements: [GEN-03, ENG-16, GEN-02, VER-06, CON-03]
tests: [../../../packages/server/test/prompts.test.ts]
tags: [code, server, prompts, generation]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-27T02:43:23Z }
---

# Purpose

Keeps prompts small and every change to them tracked (`GEN-03`, `ENG-16`). The POC's single prompt reached about 18,000 characters and carried every contract into every request, and nothing recorded which prompt produced which result. Here a stage's prompt is built from the parts it needs, each a file reviewed like code, and every call records the parts' versions.

# Entry points

- `packages/server/prompts/`: the parts, one Markdown file each, with `{{placeholders}}` for what is filled in: `base.md` (the rules every tool follows), `bridge.md`, `ui-standard.md` (the standard's look), `accessibility.md` (the rules every tool keeps, whatever its look), `request.md`, `source.md`, `diagnostics.md`, the probe's `probe.md` and `probe-request.md`, and the [intent stage](intent.md)'s `intent*.md`.
- `src/prompts/prompts.ts`:
  - `assemblePrompt` builds a generation stage's prompt (`PromptInput` to `AssembledPrompt`): the instructions, the request, each part as name@version, and the size.
  - `assembleIntentPrompt` builds the intent stage's prompt: its instructions, then the open tool (`OpenTool`) with each `RecordList` it keeps, or none, the request, and on a second ask the reminder; `INTENT_PROMPT_BUDGET` caps it.
  - `fixedPart` gives a part used as it is, such as the probe's.
  - `fillPart`, `partText` and `partVersion` read, fill and version a part. `PROMPT_PARTS` lists them, `PROMPT_BUDGETS` caps each stage, and `manifestForPrompt` is the bridge manifest as the bridge part quotes it.

# Invariants

- **Every prompt's words are in a part file** (`ENG-16`), never an inline string; a test fails if a file isn't a listed part or a listed part has no file. The probe's words moved there too.
- **A part's version is a hash of its text.** For an instruction part it covers what was generated into it (the manifest, the UI tokens), so a change to either changes the version. For a request part it covers only the wording, since what it quotes changes with every call. A stage call carries them, and the [evaluation harness](../evals/harness.md)'s ledger records them with the instructions' size.
- **Parts are chosen by the stage and structured fields, never the request's words** (`GEN-02`): base rules always; the bridge manifest unless the intent says the request only changes the look; the UI standard's look only for a tool in standard mode, and the accessibility rules in either mode, since a custom look never drops them (`UX-04`); the tool's code for edit and repair, which need it; what the checks found for repair. A test runs requests full of words a keyword rule would act on, and gets the same parts.
- **The manifest and the UI tokens come from their one definitions** (`CON-03`, `VER-06`, P3): the bridge part quotes the contracts' bridge manifest as compact JSON, without the schema-version line, a pattern beside a format that says the same, or the bounds every JSON integer has; the UI standard part lists the runtime's UI tokens. The standard's rules are the POC's, ported.
- **Quoted material is data** (`SEC-02`): the tool's code sits between markers and is called data, and the base rules say quoted material is never instructions.
- **Each stage's fixture prompt stays within its budget** (`GEN-03`): about 13,300 characters for creation, 17,200 for an edit and 17,400 for a repair of the shopping-list fixture (`packages/server/test/fixtures/prompts`), against budgets of 14,500, 18,500 and 19,000. CI fails past them.
- **Filling a part is exact:** a placeholder without a value, or a value without a placeholder, is an error, and a value is never read as a replacement pattern.

# Depends on / used by

The [contracts](../contracts/package.md)' bridge manifest and intent, and the [runtime](../runtime/package.md)'s UI tokens. The [setup check](setup.md)'s probe uses its fixed parts. The intent stage (#144) and generation (#146) will add their parts and use `assemblePrompt`.

# Pitfalls

- **The replay suite doesn't exist yet** (`TEST-04`, #156). `ENG-16` asks every prompt change to pass it; until it exists, a change to a part is reviewed and its tests run, and one that changes behavior gets a small budgeted live check.
- **The bridge manifest is most of the instructions,** about 7,000 characters, and grows with every action. The budgets will say when it needs a shorter form.
- **Create, edit, repair and intent are assembled so far.** Data actions, research, review and acceptance get their parts with their stages.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `index.ts`: `assembleIntentPrompt`, `assemblePrompt`, `fillPart`, `fixedPart`, `INTENT_PROMPT_BUDGET`, `manifestForPrompt`, `partText`, `PROMPT_BUDGETS`, `PROMPT_PARTS`, `partVersion`, `AssembledPrompt` (type), `OpenTool` (type), `RecordList` (type), `GenerationStage` (type), `PromptInput` (type), `PromptPart` (type)
- `prompts.ts`: `PROMPT_PARTS`, `PromptPart` (type), `GenerationStage` (type), `PROMPT_BUDGETS`, `partText`, `partVersion`, `fillPart`, `manifestForPrompt`, `PromptInput` (type), `AssembledPrompt` (type), `assemblePrompt`, `INTENT_PROMPT_BUDGET`, `RecordList` (type), `OpenTool` (type), `assembleIntentPrompt`, `fixedPart`
