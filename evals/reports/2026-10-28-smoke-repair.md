---
type: Evaluation Report
title: "Smoke repair: live check"
description: "One browser smoke failure repaired in one live call, staged again and activated with both starting entries preserved; capped at three calls and rehearsed first."
tags: [reports, repair, generation]
status: stable
generated: { by: codex/gpt-6, at: 2026-10-28T03:04:52Z }
---

# Smoke repair: live check, 2026-10-28

The owner explicitly approved one case with a hard cap of three Claude calls: one expected smoke repair and two schema/static reserves. Intent and creation were canned; only repair reached the model. The exact browser script was rehearsed with fake Claude first, including a regression test proving that aborted evaluations settle their calls before finalizing the ledger. Script: `evals/spikes/smoke-repair/run.ts` ([code doc](../../docs/code/evals/smoke-repair.md)). Product code was `7dbc2b466313d45f7682355a2221e1686f31d3a2`; evaluation runner was `441aebd6013c9f2862ffa2d0e8cf285a73d96155`.

The request asked for a shopping list showing milk and eggs, with a field labelled New item. The canned tool passed schema and static checks but had one unlabelled field. Real Chrome staging reported **1 field has no label**, and the repair route sent that finding with the stored candidate, original request and language to Sonnet 5.5, medium effort, with `repair-smoke@4232866d177a`.

**Passed, using one call of the approved three.** No failed or refused calls. Input 8,857 tokens (0 read from cache), output 1,564, model time 10.16 seconds; about 20.6 seconds for the browser run. M2 has used 16 of its approved envelope of about 35 calls. The two unused reserved calls were not spent and are not permission to repeat the run.

| Required observation | Result |
| --- | --- |
| First repair follows an actual browser smoke failure | Smoke part and missing-label diagnostic recorded in the call |
| Repaired candidate passes server checks and browser staging | Passed and activated |
| Requested field has an accessible name | New item found by accessible textbox name |
| Original entries survive once | Exactly Milk and Eggs visible; saved data unchanged |
| Repair does not reinstall starting data | One workspace, revision 1 before repair and 2 after the normal single activation commit |
| Honest host outcome | Shopping list is ready. A list of what to buy. |

# Evidence and limits

Local evidence: `test-output/evals/smoke-repair-live-2026-10-28T03-02-54-854Z/`, with `report.json`, `outcome.png`, the browser video, and `harness/ledger.jsonl` plus `requests.jsonl`. A sanitized repair answer is committed at `evals/spikes/smoke-repair/replays/smoke-repair-2026-10-28.json`; it contains only the synthetic request and tool, with provider/session metadata removed. A regression test replays its server checks without a live call.

This establishes the smoke part can repair this missing label, not a general repair success rate. The model added styling and an Add control beyond the minimal label repair; that extra behavior was not exercised and is not claimed as verified. The screenshot still shows the tool-frame clipping already reported in the [slice pilot](2026-10-27-slice-pilot.md), finding 8; that remains a separate owner visual check at M2's end. No new failure of the required scenario was found, and no extra call or automatic retry was used.
