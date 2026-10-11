# Scenario file format

Scenarios are data files in `evals/scenarios/`, readable by people and the runner. Example (shortened):

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
  - do: { hook: toggle-item, item: milk }          # the tool's own control (from M3)
    expect: { item: { milk: done }, version: unchanged }
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
- `do`: use one of the tool's controls, through a profile hook (from M3)
- `next-day`: move the host clock and reload
- `reload`
- `save`, `continue`, `use-again`: save the tool, or open a saved one in its two ways
- `undo`: undo an interface or data change
- `cancel`: cancel a running request
- `switch`: move to another workspace, or a new empty one
- `delete`, `restore`: move a workspace or saved tool to the trash and back

**Scenario fields:**
- `clock`: the starting date, time and time zone (`RUN-07`)
- `budget`: the maximum calls for the live run
- `profiles`: the verification profiles the person's tools should match
- `review`: the AI review items that apply ([AI technical review](judging.md#ai-technical-review-each-scenario-eval-03))

**Expectations** are host-verified facts ([automatic host facts](judging.md#automatic-host-facts-every-step)). For tools that match no profile, data expectations are limited to "unchanged" or "changed", compared by content hash, plus the smoke check.

T1 entries came from the original session request, so Use again excludes them. Add a defaults fixture with categories/units that survive reuse, while entries, completed flags and examples do not. M1 scripted restore cases also cover: compatible old code retaining today's data; incompatible conversion previewing affected fields/records; cancellation retaining everything; confirmation keeping a recovery snapshot; failed migration; and a write/crash during activation (`DATA-10`). M1 asset cases also cover replacing a photo with a cropped copy, running cleanup and restarting, then undoing the crop: the original must come back (`DATA-04`, `DATA-11`).
