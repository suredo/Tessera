# Evals

* [Evaluation harness](harness.md) - Wraps any provider for an evaluation run: a hard call cap, a ledger and request log for every call, the run's own data folder, and a dry run that can't reach a model.
* [CLI contract spike](cli-contract-spike.md) - The M0 live spike that checks Claude Code accepts a zod-generated schema, keeps working with the locked flags, and returns structured output intact; with a fake claude for its free dry run.
* [Intent spike](intent-spike.md) - The M0 live spike that measures how often a draft intent stage misroutes the POC's failure cases, in several languages, with its request set, draft prompt and report.
* [End-to-end slice pilot](slice-pilot.md) - The live pilot of the end-to-end slice: two everyday requests through the real app in Chrome, with the harness capping and recording every call, a dry run with the fake Claude Code first, and the answers kept as a replay fixture.
* [Repair check](repair-check.md) - The live check of the repair stage's prompt parts: creations that failed the host's checks, replayed from the slice pilot at no cost, with only their repairs sent to the model through the harness's cap and ledger.
