---
type: Evaluation Report
title: "End-to-end slice pilot: two live runs"
description: "Two everyday requests through the real app on Claude Code, run twice: first one tool made and one refused by the host's checks, with the findings that set the next work; then, after the fixes, both made and activated in English, with a video of the run."
tags: [reports, pilot, generation]
status: stable
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-27T09:35:41Z }
---
# End-to-end slice pilot: two live runs, 2026-10-27

The end-to-end slice of [issue 146](https://github.com/suredo/Tessera/issues/146) is the request box, the intent and create stages, the static check, staging behind the smoke check, and activation. This run tried it on a real model before more is built on it, as agreed with Codex and the owner. The owner approved two requests with a hard cap of 6 calls. The run was rehearsed first with the fake Claude Code, which made and activated both rehearsal tools in 4 calls. The script, its code doc and the replay fixture are in `evals/spikes/slice-pilot/` ([code doc](../../docs/code/evals/slice-pilot.md)).

Claude Code 2.1.311. Calls 4 (cap 6), failed 0, refused 0. Input 23,995 tokens (10,705 from cache), output 5,498, 33.3 s of model time. After it, M2's live budget stood at 9 of about 35 calls.

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
5. **A screenshot showed both tools clipped to about 110 px wide** right after they were made, the rehearsal's too. Reopened in a fresh session they fill their frame, and a probe that reads the frames finds every frame at its full 926 px. The second run's video settles it: see below.

## Second run, after the fixes

The owner approved a second run of the same two requests, with the same cap of 6 calls, after the fixes for findings 3 and 4: the static check's bridge values ([pull request 174](https://github.com/suredo/Tessera/pull/174)), and, in the pull request that adds this section, the create part's sentence on defaults and the request's language given to creation (`GEN-15`). The script now records a video of the whole run. Rehearsed first with the fake Claude Code.

Calls 4 (cap 6), failed 0, refused 0. Input 24,205 tokens (15,838 from cache), output 5,398, 33.9 s of model time. M2's live budget now stands at 13 of about 35 calls.

| Request | Intent (Haiku 5.5, low) | Create (Sonnet 5.5, medium) | Outcome | Time |
| --- | --- | --- | --- | --- |
| The shopping list | create, en, 3.5 s | a tool, 15.7 s | Made, staged, activated: "Shopping list is ready." | 28 s |
| "A simple calculator." | new_tool, en, 3.1 s | a tool, 11.6 s | Made, staged, activated: "Calculator is ready." | 24 s |

6. **Both fixes held.** The shopping list's reusable defaults fit its schema on their own, and it passed the host's checks, the static check included, and the smoke check. The calculator is in English, as are both summaries. Creation's prompt carried the new `language` part.
7. **The clipping is the capture, not the app.** In the video, the shopping list shows at its full width, as a person would see it; only the screenshot caught it narrow. The calculator was still being painted when the recording stopped, a few seconds after it opened, and looked narrow in its last frames. The same answers, replayed offline with the fake Claude Code, render at full width and centred, and every frame measures its full 926 px from its start. So the narrow pictures come from a busy machine's headless capture, not from how Tessera sizes a tool.
8. **A tool's frame has a fixed height** of 20rem (about 326 px here), so the shopping list's third item and the calculator's lower rows sit below its edge, to be scrolled to or seen in full screen. Not a defect of either tool; whether the frame should grow with its tool is a question for the owner's visual check.

The second run's answers are kept as a second replay fixture (`evals/spikes/slice-pilot/replays/pilot-2026-10-27-2.json`).

## What comes next

- Repair by failure class (`GEN-09`), the next part of #146: the first run's defaults are its first real case.
- The frame's fixed height (finding 8), for the owner's visual check at the end of M2.

The first run's live answers are kept as a replay fixture (`evals/spikes/slice-pilot/replays/pilot-2026-10-27.json`), the first for the replay suite (#156).
