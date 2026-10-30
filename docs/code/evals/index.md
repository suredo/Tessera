# Evals

* [Evaluation harness](harness.md) - Wraps any provider for an evaluation run: a hard call cap, a ledger and request log for every call, the run's own data folder, and a dry run that can't reach a model.
* [CLI contract spike](cli-contract-spike.md) - The M0 live spike that checks Claude Code accepts a zod-generated schema, keeps working with the locked flags, and returns structured output intact; with a fake claude for its free dry run.
* [Intent spike](intent-spike.md) - The M0 live spike that measures how often a draft intent stage misroutes the POC's failure cases, in several languages, with its request set, draft prompt and report.
* [End-to-end slice pilot](slice-pilot.md) - The live pilot of the end-to-end slice: two everyday requests through the real app in Chrome, with the harness capping and recording every call, a dry run with the fake Claude Code first, and the answers kept as a replay fixture.
* [Repair check](repair-check.md) - The live check of the repair stage's prompt parts: creations that failed the host's checks, replayed from the slice pilot at no cost, with only their repairs sent to the model through the harness's cap and ledger.
* [Smoke repair check](smoke-repair.md) - A browser check of the smoke-repair prompt: canned intent and creation fail on an unlabelled field, only repairs use the capped provider, and activation must preserve the request's entries.
* [Edit check](edit-check.md) - Two browser edits of a saved shopping list, with canned intent, capped real edits/repairs, a free rehearsal and preserved entries checked after each activation.
* [Chat data check](chat-data-check.md) - Two frozen browser data cases with scripted intent/style, actual replacement approval, capped data calls, and a free rehearsal.

* [Bridge edit check](bridge-edit-check.md) - One frozen behavioral edit of a saved shopping list, exercising bridge prompt context with a fake CLI rehearsal and approved two-call live check.
