---
type: Code Module
title: "Intent stage"
description: "One cheap call works out what a request asks for, in any language, and the host decides what happens: guardrails no answer gets past, the whole request where nothing is split, and a word check, second ask and hand-back for a mixed split (ADR 0008)."
resource: ../../../packages/server/src/intent/
implements: [GEN-01, GEN-15]
tests: [../../../packages/server/test/intent.test.ts]
tags: [code, server, generation, intent]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-27T02:43:23Z }
---

# Purpose

The first step of every request (`GEN-01`): a cheap model call, on the intent route (Haiku 5.5, low, `CLI-09`), returns structured fields, and the host acts on them, never on the request's words (`GEN-02`). It works in the person's language without prefixes (`GEN-15`). It answers the POC's routing failures (style wording, behavior statements, unrelated, mixed and non-English requests) and the spike's lesson L-75, by [ADR 0008](../../decisions/adr/0008-intent-split.md).

# Entry points

- `src/intent/intent.ts`:
  - `decideIntent` asks the stage about a request (`IntentInput`: the request, the open tool with its lists, the saved tools' IDs) and gives the host's `IntentDecision`: create, new tool, edit, data, mixed, open saved, clarify, unsupported, or ask the person to split it.
  - `recordLists` reads the lists a tool keeps, and their fields, from its declared data shape (`DATA-03`).
  - `wordsNotInRequest` is the word check of a split part.
  - `INTENT_TIME_LIMIT_MS` is the stage's time limit (`GEN-11`).
- Its prompt is assembled by the [prompt assembly](prompts.md) from the intent parts: the instructions, the request, the open tool or none, a tool with no records, and the reminder for a second ask.
- `packages/server/test/fixtures/intent/`: `requests.json`, the 31 requests of the intent spike plus ADR 0008's pairs, each with its context and expected action; `replays.json`, the spike's recorded live answers (`TEST-04`).

# Invariants

- **Guardrails no answer gets past** (`GEN-01`):
  - With no tool open, a request opens a listed saved tool or creates one (A12).
  - A request that isn't about the open tool never changes it: it becomes a new tool. Building a tool while one is open is a new tool too.
  - A saved tool must be one of those listed. Clarify and unsupported reach the person as they are.
- **The open tool's records decide data against mixed** (ADR 0008). The prompt lists each list the tool keeps with its fields, and says that adding what the tool keeps as records is data.
- **Nothing split, nothing reworded** (ADR 0008, L-75). For create, new tool and edit, the interface part is the whole request; for data, the data part is the whole request. A part the model wrote is never used for these.
- **A mixed split must be the request's own words.** Every word of each part must be a word of the request, ignoring case and punctuation, in any script; a missing part fails too. A failing split is asked once more on the same route, with a reminder; a second failure is `ask_to_split`, and nothing is done. The host never repairs or translates a part.
- **At most two calls, both on the intent route,** each recording its prompt parts; a provider failure goes back to the caller (`CLI-05`).

# Depends on / used by

The [provider adapters](providers.md)' routing, the [prompt assembly](prompts.md), and the contracts' intent schema. The generation pipeline (#146) will run it first for every request, and the chat (#150) will say what each decision means; finding saved tools (#145) adds the saved-tools catalogue to its prompt.

# Pitfalls

- **The fixtures are replayed only where live answers exist** (r19, r20 and r23 from the spike). How often the stage routes the rest right is measured by the live evaluation (#155), against `requests.json`.
- **No saved tools are listed in the prompt yet,** so the stage can't choose one; the host would still check any it named. The catalogue comes with #145.
- **It splits a mixed request; it doesn't carry it out.** `GEN-04` also asks that the interface part goes to generation and the data part is applied after the new version is installed, neither seeing the other; the pipeline (#146) does that, and claims it.
- **Destructive data changes need an explicit target** (`GEN-01`); that guardrail belongs to the data stage, which acts on the data part.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `index.ts`: `decideIntent`, `INTENT_TIME_LIMIT_MS`, `recordLists`, `wordsNotInRequest`, `IntentDecision` (type), `IntentInput` (type)
- `intent.ts`: `INTENT_TIME_LIMIT_MS`, `recordLists`, `wordsNotInRequest`, `IntentDecision` (type), `IntentInput` (type), `decideIntent`
