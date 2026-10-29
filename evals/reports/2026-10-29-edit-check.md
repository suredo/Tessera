---
type: Evaluation Report
title: "Saved-tool edits: live check"
description: "Two browser edits passed in two live calls: a dark theme and a lossless quantity migration in the same saved shopping list."
tags: [reports, edit, generation]
status: stable
generated: { by: codex/gpt-6, at: 2026-10-29T04:06:00Z }
---

# Saved-tool edits: live check, 2026-10-29

The owner explicitly approved one two-case run capped at four Claude calls: two expected edits and two repair reserves. Intent was canned and the initial saved list was hand-written; only edit/repair could reach the model. The exact script was rehearsed for free and independently reviewed before the live run. Product head: `fead0273ce41f0616fffde8df729c02f9499b43f`; runner head: `cb82aa29fe4680f6fcfeafdabe28bec77e151da1`. Script: `evals/spikes/edit-check/run.ts` ([code doc](../../docs/code/evals/edit-check.md)).

**Original DOM/data checks passed 2/2 required cases, using two calls of the approved four; intermediate darken visual confirmation is inconclusive.** No repair, failed, refused or unknown-usage calls. Sonnet 5.5, low effort; 16,579 input tokens (3,372 read from cache), 800 output tokens, 6.622 seconds model time; 21.084 seconds for the browser run. M2 has now used 18 of its approved envelope of about 35 calls. Unused reserves do not authorize a repeat.

| Required case | Observation |
| --- | --- |
| Darken the saved list | Computed background #111111 and text #eeeeee; HTML, JavaScript, data declaration and Milk/Eggs DOM text/data unchanged. Screenshot blank; visibility not established at that intermediate point |
| Add quantities, keeping dark colors and entries | Both entries retained their ids/titles and gained quantity 1 through the declared v1-to-v2 migration; both quantities and dark colors rendered |
| Lifecycle, checked after each edit | One workspace with the same title/id, one activation revision/history increment per edit, three total versions and final data revision 4 |
| Honest host outcome | Both notices said Shopping list was updated and described the requested change |

Both calls used `edit@2e80b2067d6d`, `edit-declarations@7eb300505e9f` and `ui-edit@722f0daf16a5`; the quantity case additionally used the existing bridge part. No repair part ran. Full part manifests and costs are in the ledger.

# Evidence and limits

Local evidence: `test-output/evals/edit-check-live-2026-10-29T02-25-52-495Z/`, including `report.json`, `darken.png`, `quantities.png`, browser video and `harness/{ledger,requests}.jsonl`. Exact free rehearsal: `test-output/evals/edit-check-dry-run-2026-10-29T00-06-19-648Z/`; independent rehearsal also passed. After adding visible-row assertions, the recorded answers passed both free browser cases at `test-output/evals/edit-check-dry-run-2026-10-29T03-17-55-481Z/`. Sanitized answers are committed at `evals/spikes/edit-check/replays/edit-check-2026-10-29.json`, without provider/session metadata. A free regression test validates them sequentially against the original artifact and data, checks preservation and applies the quantity migration.

The final live screenshot shows both entries and quantities. The live darken screenshot captured a blank panel despite the preceding text/computed-style assertions passing; it is not visual evidence of that intermediate result. Those assertions did not explicitly wait for visible rows. The runner now waits for both rows to be visible and captures viewport and full-page images. In the free recorded-answer run `test-output/evals/edit-check-dry-run-2026-10-29T04-04-55-641Z/`, both cases passed, the darken viewport image shows Milk/Eggs and the dark theme, while the immediately following full-page image is blank. Full-page capture can therefore omit this nested-frame content; the exact browser capture cause is not established. This offline observation does not change the original live visual result. No repeat live run was authorized or made. The existing tool-frame height/clipping issue from the [slice pilot](2026-10-27-slice-pilot.md), finding 8, also remains outside this check. The quantity edit displays values; no tool controls were driven. This establishes these two edits under the original assertions, with limited intermediate visual evidence, not general edit success, destructive-edit support or semantic preservation of arbitrary behavior. Canned intent does not validate intent routing. Broader replay and preservation work remain #156 and #150.
