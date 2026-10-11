# Testing (`TEST`)

Summary; details are in [the testing practices](../practices/testing.md).

| ID | Requirement |
| --- | --- |
| TEST-01 | Unit tests for contracts, pipeline logic, data patches, checks and adapters, run on every change in CI. |
| TEST-02 | CLI contract tests with fake processes: arguments, environment, stdin, output parsing, error mapping, usage, cancellation. |
| TEST-03 | Scripted-provider end-to-end tests in Playwright, with screenshots and video: the real pipeline with canned model replies chosen by test configuration, never by words in the request (`ENG-11`). |
| TEST-04 | Replay fixtures: sanitized exports (`DATA-05`) of real live-run outputs, committed and replayed offline, so a live failure becomes a permanent regression test. |
| TEST-05 | Budgeted live evaluations at each milestone, through `OBS-02`. Each evaluation is a set of real-life scenarios in which a simulated person creates tools from nothing and then edits, saves, updates and reopens them. Scenarios, the test application catalogue and judging are defined in [the test scenario docs](../testing/index.md). |
| TEST-06 | Browser coverage: Chrome and Edge in CI, at fixed viewports including 320 px, on Windows (`PLAT-01`). |
