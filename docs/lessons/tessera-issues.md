---
type: Lesson
title: "Tessera issues"
description: "Issues found while building Tessera, from L-70 on: what happened, the cause, the mitigation and where it was found."
tags: [lessons, issues]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-17T03:28:33Z }
---
# Tessera issues

Every defect a live run finds gets an entry here, a replay test and a fix (`ENG-07`, `ENG-13`). IDs continue the [POC issue catalogue](issue-catalogue.md), which ends at L-69, so one search finds a lesson wherever it is; they are never reused or renumbered (`ENG-17`). The status key is the catalogue's: **D** a structural control or automatic check, **R** a risk reduction, **A** accepted.

| ID | What happened | Root cause | Mitigation | Status | Found in |
| --- | --- | --- | --- | --- | --- |
| L-70 | Claude Code refused the intent contract's JSON Schema before calling a model: it checks `--json-schema` with a draft-07 validator, and the contracts generated draft 2020-12. The dry run had passed. | The CLI's schema dialect was untested, and the fake CLI didn't check schemas | CON-01, ENG-13 (draft-07 from `jsonSchemaOf`; the fake checks like the CLI) | D | CLI contract spike, run 1 ([ADR 0002](../decisions/adr/0002-claude-code-cli-contract.md)) |
| L-71 | A live call was spent on a CLI that wasn't signed in. The desktop app's sign-in doesn't reach a CLI started from a clean environment, and the failure said `subtype: success` with `is_error: true`. | No free sign-in check before calls; the result's `subtype` doesn't mean success | CLI-02, CLI-05 | D | CLI contract spike, run 2 |
| L-72 | The API refused the intent contract as a tool's input schema, which must be an object at the top level; the contract is a union (`CON-02`). | The CLI passes `--json-schema` to the API as a tool's input schema | CLI-03 (every contract travels wrapped as `{ answer: <contract> }`), ENG-13 | D | CLI contract spike, run 3 |
| L-73 | A call ran 4 turns under `--max-turns 3`, most likely retrying a structured answer. | `--max-turns` is not a hard bound | CLI-03 (every call also bounded by its time limit), OBS-01 (turns recorded) | R | CLI contract spike, run 4 |
| L-74 | A CLI started from inside a Claude Code session (such as the desktop app) inherits about 30 `CLAUDE_*` variables plus `ANTHROPIC_BASE_URL` and `CLAUDE_CODE_SIMPLE`, which change where and how it calls the model. Removing only API keys would have let them through. Found before any call was spent. | The environment was inherited and filtered by a denylist | CLI-08 (an allowlisted environment) | D | CLI contract spike, preparation |
