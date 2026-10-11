# Observability, cost and speed (`OBS`)

| ID | Requirement |
| --- | --- |
| OBS-01 | **Call ledger.** Every model call records: stage, model, effort, prompt characters, input, output and cached tokens, time, outcome and diagnostics. It is persisted, viewable per workspace and per request, and exportable. |
| OBS-02 | **Evaluation harness with a budget guard.** A built-in live-evaluation mode enforces a hard call cap, logs every call and request, and has a dry-run mode with canned replies, so scripts are rehearsed at no cost. This carries over the POC's budget-guarded live server. |
| OBS-03 | **Metrics.** Per stage: p50/p95 time, tokens, repair rate and check pass rate, computed from the ledger and reported after each live evaluation. |
| OBS-04 | **Speed targets** (starting points, revisited with M2 measurements). Host screens respond within 100 ms. A saved tool opens and mounts within 5 s. Intent within 10 s at p95. A chat data change within 15 s at p95. A first useful tool (the core pass, `GEN-17`) within 90 s at p95. Misses are reported in the metrics, not hidden. |
