---
type: Decision
title: "ADR 0008. Splitting a request: mixed against data, and the request's own words"
description: "How the intent stage tells a mixed request from a data change (by the records the open tool already keeps), and how the host keeps each split part in the request's own words: the whole request where nothing is split, a word check where it is, one more ask, then the person."
tags: [decisions, generation, intent]
status: stable
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-27T02:25:23Z }
---
# ADR 0008. Splitting a request: mixed against data, and the request's own words

Proposed by Claude Code and accepted by the owner on 2026-10-27, for [issue 144](https://github.com/suredo/Tessera/issues/144), the two design notes the [intent spike's report](../../../evals/reports/2026-10-17-intent-spike.md) asked for before M2's intent stage. It sets how the intent stage (`GEN-01`) and the split of mixed requests (`GEN-04`) work, and answers lesson L-75.

## Context

The spike routed 30 of 31 requests right. Its two loose ends:

1. **Mixed against data.** Its one misroute was "Add a table for the kids and put Ana and Leo at it." in a seating planner. The expected answer was mixed; the model said data. The planner already keeps tables as records, so adding one changes nothing in the tool. The stage had no rule for this, and no way to know what the tool keeps.
2. **The request's own words** (L-75). The prompt asked for the split parts in the request's words, but a data part came back reworded ("Add cheese to the shopping list; remove the apples from it.") and one half translated ("Add 2 litros de leite and 1 pão to the shopping list."). The data stage acts on that text, so a reworded part can change what is done (the L-19 family). A model rewrites free text even when told not to.

`GEN-04` rules out sending the whole request with each part: neither step may see the other's instruction.

## Decision

**Mixed against data: the open tool's records decide.** The intent stage is given what the open tool keeps: each list of records and its fields, from the tool's declared data shape. A request is a data change when everything it adds, changes or removes fits those lists and fields, even when it names a thing ("a table", "a category") that the tool keeps as records. It is mixed only when it also asks for something the tool doesn't have: a new field, a new kind of record, a new view or control. "Add a table for the kids and put Ana and Leo at it." in a planner that keeps tables is data. "Add a price to each item and put 3.50 on the milk." in a list without prices is mixed. The prompt states this rule with both examples, and the fixtures hold such pairs.

**The request's own words: the host checks, and splits only when it must.**

- **Nothing to split, nothing to reword.** When the kind is create, new tool or edit, the interface part the host uses is the whole request; when it is data, the data part is the whole request. A part the model wrote is not used for these kinds, so r19 and r20 of the spike can't happen.
- **A mixed request's two parts must be in the request's words.** The host checks each: every word of the part must be a word of the request, ignoring case and punctuation, in any script (the spike's scorer, `wordsNotInRequest`). A part may leave words out; it may not add, change or translate any.
- **If a part fails, ask once more, then ask the person.** The intent stage is asked again on the same route, told that its parts must quote the request. If a part still fails, nothing is done, and the person is asked, in plain words, to send the change to the tool and the change to the data separately. A part is never repaired by the host, and never translated.

## Options considered

- **Trust the prompt.** The spike showed it isn't enough.
- **Send the whole request with each part.** Simplest, but it breaks `GEN-04`: the data step would see the interface instruction and might act on it.
- **Have the host split the request itself.** Splitting by words would be keyword gating (`GEN-02`) and fails in other languages.
- **Ask the person whenever a part fails, without asking the stage again.** Safer, but a cheap second ask fixes most cases without bothering them.

## Consequences

- The intent request carries the open tool's lists and fields; the data shape is already declared (`DATA-03`), so nothing new is stored.
- At most one extra intent call, on the cheapest route (`CLI-09`), and only for a mixed request whose split fails; it is recorded like any call.
- The spike's r22 expectation becomes data. The M2 fixtures add a mixed and a data request for each pair of the kind above, in more than one language.
- The replay fixture of L-75 (r19, r20, r23) is the first test: r19 and r20 are data, so their reworded parts are never used, and r23's parts pass the check.
- **When to revisit:** if the live evaluation shows mixed requests failing the check often, or the stage calling data changes mixed against the tool's records.
