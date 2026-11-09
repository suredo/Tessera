---
type: Test Design
title: "Scenario file format"
description: "The scenario file format, step types and fields, with a full example."
tags: [testing, scenario-format]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-09T12:38:06Z }
---
# Scenario file format

Scenarios are data files in `evals/scenarios/`, readable by people and the runner. Their one definition is the schema in `evals/src/scenarios/scenario.ts` ([scenario files and host facts](../code/evals/scenarios.md)), and a test loads every file. Example (shortened):

```yaml
id: T1-shopping-list
tier: simple
language: en
person: "A busy parent who shops once a week"
clock: { start: "2026-10-12T09:00", zone: "America/Sao_Paulo" }
budget: { calls: 9 }
profiles: [item-list]
steps:
  - say: "I need a shopping list I can tick off at the store. We need milk, eggs, bread and apples."
    expect: { created: true, profile: item-list, items: [milk, eggs, bread, apples] }
  - do: { click: item-remove, in: { hook: item, text: milk } }   # the tool's own control (from M3)
    expect: { data: changed, version: unchanged }
  - say: "Group them by aisle."                    # look/structure change
    expect: { version: new, data: unchanged }
  - say: "Add cheese and take the apples off."     # data change through chat
    expect: { items: [milk, eggs, bread, cheese], version: unchanged }
  - undo: data                                     # the apples come back
    expect: { items: [milk, eggs, bread, apples], version: unchanged }
  - save: "Weekly shopping"
  - next-day: true                                 # host clock +1 day, reload
    expect: { data: unchanged }
  - switch: new                                    # an empty workspace
  - say: "Open my weekly shopping list"            # find by asking
    expect: { offered: saved, savedTool: "Weekly shopping", created: false }
  - use-again: "Weekly shopping"                   # same tool, fresh data, new workspace
    expect: { workspace: new, items: [] }
  - continue: "Weekly shopping"                    # original saved-entry link is unchanged
    expect: { workspace: original, items: [milk, eggs, bread, apples] }
review: [fulfilment, useful-at-first-sight, standard-style, controls-work, accessibility, messages, code-red-flags, coherence]
```

**Step types:**
- `say`: a chat request
- `do`: use one of the tool's controls, through a hook of one of the scenario's profiles (from M3): `{ click: <hook> }` or `{ fill: <hook>, value: <text> }` (a select takes the choice with that text or value), acting on the one shown element with that hook, or with `in: { hook: <hook>, text: <text> }` on the one inside the one shown element with that hook showing that text, such as one item; with `label: <text>`, of several elements with that hook, the one whose label shows that text, such as one field of a form. A hook none of the scenario's profiles has is refused when the file loads.
- `next-day`: move the host clock and reload
- `reload`
- `save`, `continue`, `use-again`: save the tool, or open a saved one in its two ways
- `undo`: undo an interface or data change
- `cancel`: cancel the request the step before started; that `say` step expects nothing of its own
- `switch`: move to another workspace, or a new empty one (until the app has a control for one, #132, the runner makes it through the store, then opens it in the app)
- `delete`, `restore`: move a workspace or saved tool to the trash and back

**Scenario fields:**
- `clock`: the starting date, time and time zone (`RUN-07`)
- `budget`: the maximum calls for the live run
- `profiles`: the verification profiles the person's tools should match, by their IDs in the registry; a `do` step uses their hooks
- `review`: the AI review items that apply ([AI technical review](judging.md#ai-technical-review-each-scenario-eval-03))

**Answers.** A rehearsal (`evals/scenarios/rehearsals/<id>.json`, written by hand) or a replay (a live run's recording) gives the answers each stage asks for, in order. A saved tool is named as `{{saved:<name>}}`, since its ID is new on every run, and an answer can take its time (`delayMs`) so a `cancel` has something to stop. The [runner](../code/evals/runner.md) plays them.

**Expectations** are host-verified facts ([automatic host facts](judging.md#automatic-host-facts-every-step)): `created` (true or false), `version` (`new` or `unchanged`), `data` (`changed`, `unchanged`, or `kept`: every earlier value is still there, and fields or items may have been added), `workspace` (`new`, `same` or `original`, the one the saved tool's Continue opens), `offered: saved` with `savedTool` (its name), and `answer` (`clarify`, `unsupported` or `stopped`). Each one left out isn't checked; every step also checks that nothing unrelated changed and that no success was claimed that wasn't applied. For tools that match no profile, data expectations are limited to "unchanged", "changed" or "kept", compared by content, plus the smoke check.

T1 entries came from the original session request, so Use again excludes them. Add a defaults fixture with categories/units that survive reuse, while entries, completed flags and examples do not. M1 scripted restore cases also cover: compatible old code retaining today's data; incompatible conversion previewing affected fields/records; cancellation retaining everything; confirmation keeping a recovery snapshot; failed migration; and a write/crash during activation (`DATA-10`). M1 asset cases also cover replacing a photo with a cropped copy, running cleanup and restarting, then undoing the crop: the original must come back (`DATA-04`, `DATA-11`).
