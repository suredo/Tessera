---
type: Evaluation Report
title: "End-to-end slice pilot: live run"
description: "Two everyday requests through the real app on Claude Code: one tool made, staged and activated, one refused by the host's checks, and the findings that set the next work, among them a false positive in the static check."
tags: [reports, pilot, generation]
status: stable
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-27T08:48:53Z }
---
# End-to-end slice pilot: live run, 2026-10-27

The end-to-end slice of [issue 146](https://github.com/suredo/Tessera/issues/146) is the request box, the intent and create stages, the static check, staging behind the smoke check, and activation. This run tried it on a real model before more is built on it, as agreed with Codex and the owner. The owner approved two requests with a hard cap of 6 calls. The run was rehearsed first with the fake Claude Code, which made and activated both rehearsal tools in 4 calls. The script, its code doc and the replay fixture are in `evals/spikes/slice-pilot/` ([code doc](../../docs/code/evals/slice-pilot.md)).

Claude Code 2.1.311. Calls 4 (cap 6), failed 0, refused 0. Input 23,995 tokens (10,705 from cache), output 5,498, 33.3 s of model time. M2's live budget now stands at 9 of about 35 calls.

| Request | Intent (Haiku 5.5, low) | Create (Sonnet 5.5, medium) | Outcome | Time |
| --- | --- | --- | --- | --- |
| "I need a shopping list I can tick off at the store, with milk, eggs and bread on it." | create, en, 2.9 s | a tool, 16.3 s | Refused by the host's checks: nothing stored | 28 s |
| "A simple calculator." | create, en, 2.3 s | a tool, 11.8 s | Made, staged, activated: "Calculadora is ready." | 23 s |

## Findings

1. **The pieces fit together.** Both requests went through the intent stage, creation and the host's checks, in the real app with no change; the calculator went on through staging behind the smoke check and activation. The calculator passed the static check and the smoke check: it showed something, ran without errors, fitted 320 px and had named buttons. The routing held: intent on Haiku, creation on Sonnet, each as recorded.
2. **Creation is fast:** 12 to 16 s of model time, against the POC's 105 to 131 s. The 180 s limit (`GEN-11`) has room, and the request took under 30 s overall.
3. **The shopping list's defaults didn't fit its own schema.** The schema marked the list `items` as required, while the reusable defaults were `{}`; only the request's entries held `items`. The host refused it, rightly (`DATA-03`), and stored nothing. One sentence in the create part should prevent this: the defaults must fit the schema by themselves, with every required list, empty if need be.

   **Behind that refusal, the static check would also have refused it, wrongly.** The host stops at the first failing check, so the run only showed the defaults. Checked offline, the same answer failed the static check three times, on ordinary code: `revisionCount: revs[id]`, where `revs` holds the revisions the tool read from the bridge. The value tracking had counted the bridge as holding the page once a page value was passed to it (Codex found this reviewing the report). [Pull request 174](https://github.com/suredo/Tessera/pull/174) fixes it: what crosses the bridge is plain data. With that fix and only the defaults corrected, the answer passes the host's checks offline. The smoke check, and whether repair (`GEN-09`) would fix the defaults in one call, are untested.
4. **The calculator came out in Portuguese** ("Calculadora", and a Portuguese summary) for an English request. The intent stage answered `en`, but the create stage isn't told the request's language (`GEN-15`), and Claude Code's settings hold no language. The fix is on the host's side: give the create stage the language the intent stage found, as a structured field.
5. **A screenshot showed both tools clipped to about 110 px wide** right after they were made, the rehearsal's too. Reopened in a fresh session they fill their frame, and a probe that reads the frames finds every frame at its full 926 px. It looks like a stale first paint, captured before the tool's frame learned its size (the timing behind #106). Whether a person sees it in a normal window is still open.

## What comes next

- The static check's false positive on bridge values (finding 3), in pull request 174.
- The create part's defaults sentence, and the request's language passed to creation (findings 3 and 4), in the next pull request, with tests.
- Repair by failure class (`GEN-09`), the next part of #146.
- Finding 5 is checked by the owner in a normal window before it is investigated further.

The live answers are kept as a replay fixture (`evals/spikes/slice-pilot/replays/pilot-2026-10-27.json`), the first for the replay suite (#156).
