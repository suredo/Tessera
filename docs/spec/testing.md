---
type: Requirement Area
title: "Testing"
description: "The test layers required in CI and at milestones (TEST-01 to TEST-06)."
tags: [spec, testing]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-10T01:30:00Z }
---
# Testing (`TEST`)

Summary; details are in [the testing practices](../practices/testing.md).

| ID | Requirement |
| --- | --- |
| TEST-01 | Unit tests for contracts, pipeline logic, data patches, checks and adapters, run on every change in CI. |
| TEST-02 | CLI contract tests with fake processes: arguments, environment, stdin, output parsing, error mapping, usage, cancellation. |
| TEST-03 | Scripted-provider end-to-end tests in Playwright, with screenshots, and video when it is recorded to look into a failure (A56): the real pipeline with canned model replies chosen by test configuration, never by words in the request (`ENG-11`). |
| TEST-04 | Replay fixtures: sanitized exports (`DATA-05`) of real live-run outputs, committed and replayed offline, so a live failure becomes a permanent regression test. |
| TEST-05 | Budgeted live evaluations at each milestone, through `OBS-02`. Each evaluation is a set of real-life scenarios in which a simulated person creates tools from nothing and then edits, saves, updates and reopens them. Scenarios, the test application catalogue and judging are defined in [the test scenario docs](../testing/index.md). |
| TEST-06 | Browser coverage: Chrome in CI, on Windows (`PLAT-01`), at fixed viewports: every browser test at 1280 px, and the tests of layout also at 320 px. Edge and other browsers come back later (A56). |
