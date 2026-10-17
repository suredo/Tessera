# Evals

* [Evaluation harness](harness.md) - Wraps any provider for an evaluation run: a hard call cap, a ledger and request log for every call, the run's own data folder, and a dry run that can't reach a model.
* [CLI contract spike](cli-contract-spike.md) - The M0 live spike that checks Claude Code accepts a zod-generated schema, keeps working with the locked flags, and returns structured output intact; with a fake claude for its free dry run.
* [Intent spike](intent-spike.md) - The M0 live spike that measures how often a draft intent stage misroutes the POC's failure cases, in several languages, with its request set, draft prompt and report.
