---
type: Evaluation Report
title: "Repair check: live run"
description: "The repair stage's prompt parts on a real model: the slice pilot's shopping list, refused for its defaults, and a copy refused by the static check, each repaired in one call into a candidate the host accepts."
tags: [reports, repair, generation]
status: stable
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-27T10:11:48Z }
---
# Repair check: live run, 2026-10-27

Repair by failure class ([pull request 176](https://github.com/suredo/Tessera/pull/176), `GEN-09`) adds three prompt parts: the failed answer quoted (`attempt`), and one part for each class the server repairs (`repair-schema-shape`, `repair-static`). Until the replay suite exists, a prompt change that changes behavior gets a small live check (`ENG-16`), as Codex's review asked. The owner approved two repair calls with a hard cap of 3. Creation's answers were replayed from the [slice pilot](2026-10-27-slice-pilot.md) at no cost, and only the repairs reached the model. The run was rehearsed first with the fake Claude Code. Script and code doc: `evals/spikes/repair-check/` ([code doc](../../docs/code/evals/repair-check.md)).

Claude Code 2.1.311. Calls 2 (cap 3), failed 0, refused 0. Input 22,524 tokens (3,188 from cache), output 5,862, 27.4 s of model time. M2's live budget now stands at 15 of about 35 calls.

| Case | Failed with | Repair (Sonnet 5.5, medium) | Outcome |
| --- | --- | --- | --- |
| The pilot's live shopping list: its defaults lacked the required list `items` | schema-shape | 13.5 s | A candidate the host accepts |
| The same tool, defaults right, with one line building HTML at run time | static | 13.9 s | A candidate the host accepts |

## Findings

1. **Both repairs worked in one call,** and each changed only what was wrong. The shape repair changed the reusable defaults to `{"items":[]}`; the code, the schema and the request's entries came back identical. The static repair came back with the defaults, schema and entries unchanged.
2. **The static repair dropped the refused line instead of rewriting it.** The line showed an item count through HTML built at run time. The repair answered with the tool's code exactly as it was before that line was added, so the count is gone. The part allows that ("drop that feature if the rules leave no way to keep it"), but here a way existed: setting `textContent`. The person never asked for the count, so nothing they wanted was lost. A repair of a feature the person did ask for is untested; the M2 evaluation should include one.
3. **A repair takes about as long as a creation** (13 to 14 s here, against 12 to 16 s for creation in the pilot), within its 180 s limit (`GEN-11`).

## What comes next

- Repair of smoke failures, which the browser finds while staging, in the next part of #146.
- A case in the M2 evaluation where repair must keep a feature the person asked for.

The repair answers are kept as a replay fixture (`evals/spikes/repair-check/replays/repair-check-2026-10-27.json`).
