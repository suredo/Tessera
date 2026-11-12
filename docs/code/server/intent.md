---
type: Code Module
title: "Intent stage"
description: "One cheap call works out what a request asks for, in any language, and the host decides what happens: guardrails no answer gets past, the whole request where nothing is split, and a word check, second ask and hand-back for a mixed split (ADR 0008)."
resource: ../../../packages/server/src/intent/
implements: [GEN-01, GEN-15, GEN-18, GEN-19, VER-03]
tests: [../../../packages/server/test/intent.test.ts]
tags: [code, server, generation, intent]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-12T03:00:00Z }
---

# Purpose

The first step of every request (`GEN-01`): a cheap model call, on the intent route (Haiku 5.5, low, `CLI-09`), returns structured fields, and the host acts on them, never on the request's words (`GEN-02`). It works in the person's language without prefixes (`GEN-15`). It answers the POC's routing failures (style wording, behavior statements, unrelated, mixed and non-English requests) and the spike's lesson L-75, by [ADR 0008](../../decisions/adr/0008-intent-split.md).

# Entry points

- `src/intent/intent.ts`:
  - `decideIntent` asks the stage about a request (`IntentInput`: the request, the open tool with its lists, the person's saved tools, the most recently used first) and gives the host's `IntentDecision`: create, new tool, edit, data, mixed, open saved, clarify, unsupported, discuss (a question or an idea, answered in words, `GEN-19`), ask the person to split it, or approve or decline the entry changes waiting for review (L-98).
  - `recordLists` reads the lists a tool keeps, and their fields, from its declared data shape (`DATA-03`).
  - `wordsNotInRequest` is the word check of a split part.
  - `INTENT_TIME_LIMIT_MS` is the stage's default time limit (`GEN-11`); `IntentInput.timeLimitMs` replaces it with the configured one.
  - `savedToolCatalogue` chooses the saved tools the stage is shown (`GEN-18`): each one's ID, name and description, in the order given, until the next would pass `CATALOGUE_MAX_TOOLS` (20) or `CATALOGUE_MAX_CHARACTERS` (3,000, as quoted). It stops there rather than skip one, so the most recent always come first. While entry changes wait for review, the stage is told their summary too, so the catalogue gives up as many characters as the summary takes once quoted (as the prompt assembly measures it): a summary of quotes or backslashes counts twice. So waiting changes never make the prompt longer than a full catalogue could (`GEN-03`). When no review waits and the request follows a discussion (`IntentInput.discussed`, `GEN-19`), the stage is told the discussion's answer instead, quoted the same way, and the catalogue gives up the room it takes, so "do that" is read as what the answer describes.
- Its prompt is assembled by the [prompt assembly](prompts.md) from the intent parts: the instructions, with the verification profiles listed from their registry so the answer can name the one the tool fits (`VER-03`), the request, the open tool or none, a tool with no records, the saved tools or none, the entry changes waiting for review when some do, and the reminder for a second ask. The answer also says whether the finished tool shows a chart (its drawsCharts field), which brings the chart part into the generation prompt (`CAP-04`).
- `packages/server/test/fixtures/intent/`: `requests.json`, the 31 requests of the intent spike plus ADR 0008's pairs, each with its context (the open tool, and the saved tools with their names and descriptions) and expected action; `replays.json`, the spike's recorded live answers (`TEST-04`).

# Invariants

- **Guardrails no answer gets past** (`GEN-01`):
  - With no tool open, a request opens a listed saved tool or creates one (A12), unless it is unclear, unsupported or only a question or an idea.
  - A question or an idea (`discuss`) is never built, with a tool open or not, whatever the answer says it targets (`GEN-19`). The prompt says a change asked politely or as a question ("can you make it blue?") is that change, not a discussion.
  - A request that isn't about the open tool never changes it: it becomes a new tool. Building a tool while one is open is a new tool too.
  - A saved tool must be one of those the stage was shown in the catalogue; one left out, or unknown, is treated as no match. Clarify and unsupported reach the person as they are.
  - A request approves or declines entry changes only while some wait (`IntentInput.proposal`, given only when the server still holds them for the open workspace); otherwise such an answer is clarify, and nothing is applied (L-98). The decision only names the answer: the review's own route applies or drops the changes, with its checks (`DATA-02`).
- **The open tool's records decide data against mixed** (ADR 0008). The prompt lists each list the tool keeps with its fields, and says that adding what the tool keeps as records is data.
- **The waiting changes are quoted data** (`SEC-02`). Their summary is the data stage's words, so it goes in as JSON between markers, like the open tool.
- **The open tool is quoted data** (`SEC-02`). Its name and lists come from the tool, which may be generated or imported, so they go in as JSON between markers, and the instructions say they are never instructions; only the request says what the person wants.
- **Nothing split, nothing reworded** (ADR 0008, L-75). For create, new tool and edit, the interface part is the whole request; for data, the data part is the whole request. A part the model wrote is never used for these.
- **A mixed split must be the request's own words.** Every word of each part must be a word of the request, ignoring case and punctuation, in any script; a missing part fails too. A word keeps its marks (a changed vowel sign in Devanagari is a changed word), and text is normalized first, so an accent typed as a separate mark matches the accented letter. A failing split is asked once more on the same route, with a reminder; a second failure is `ask_to_split`, and nothing is done. The host never repairs or translates a part.
- **At most two calls, both on the intent route,** each recording its prompt parts; a provider failure goes back to the caller (`CLI-05`).

# Depends on / used by

The [provider adapters](providers.md)' routing, the [prompt assembly](prompts.md), and the contracts' intent schema. The generation pipeline (#146) will run it first for every request, and the chat (#150) will say what each decision means.

# Pitfalls

- **The fixtures are replayed only where live answers exist** (r19, r20 and r23 from the spike). How often the stage routes the rest right is measured by the live evaluation (#155), against `requests.json`.
- **Finding a saved tool depends on its name and description,** which the person or a creation wrote (`APP-04`). A tool with neither saying what it is for is hard to find by asking; the person still has the library.
- **It splits a mixed request; it doesn't carry it out.** `GEN-04` also asks that the interface part goes to generation and the data part is applied after the new version is installed, neither seeing the other; the pipeline (#146) does that, and claims it.
- **Destructive data changes need an explicit target** (`GEN-01`); that guardrail belongs to the data stage, which acts on the data part.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `index.ts`: `CATALOGUE_MAX_CHARACTERS`, `CATALOGUE_MAX_TOOLS`, `decideIntent`, `INTENT_TIME_LIMIT_MS`, `recordLists`, `savedToolCatalogue`, `wordsNotInRequest`, `IntentDecision` (type), `IntentInput` (type)
- `intent.ts`: `INTENT_TIME_LIMIT_MS`, `CATALOGUE_MAX_TOOLS`, `CATALOGUE_MAX_CHARACTERS`, `savedToolCatalogue`, `recordLists`, `wordsNotInRequest`, `IntentDecision` (type), `IntentInput` (type), `decideIntent`
