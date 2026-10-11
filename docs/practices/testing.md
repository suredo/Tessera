---
type: Practice
title: "Testing"
description: "The five-layer test pyramid and test rules (ENG-11, ENG-13, ENG-14, ENG-17, ENG-20)."
tags: [practices, testing]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-11T20:21:39Z }
---
# Testing

The POC showed that offline tests can pass while live behavior fails (L-08). The pyramid therefore has five layers, and each catches what the one below can't.

| Layer | What | Where it runs | Model calls |
| --- | --- | --- | --- |
| 1. Unit (`TEST-01`) | Contracts, patch engine, pipeline logic, checks, message lint | CI, every change | None |
| 2. Adapter contract (`TEST-02`) | Exact CLI arguments, environment, stdin, output parsing, usage normalization, error mapping, cancellation, against fake processes | CI | None |
| 3. Scripted end to end (`TEST-03`) | Real server, real browser, real pipeline, canned model replies; screenshots and video for each step | CI (Playwright) | None |
| 4. Replay (`TEST-04`) | Sanitized exports of real live outputs replayed through the pipeline and checks | CI | None |
| 5. Live evaluation (`TEST-05`) | Agreed real-life scenarios (tools created from nothing, then edited, saved, reopened) with a real model, under a budget | Manually, at milestones, approved | Budgeted |

| ID | Rule |
| --- | --- |
| ENG-11 | **Test configuration never travels in the user's words.** Scripted scenarios are chosen by a test header, a fixture file or provider configuration, never by markers inside the request text. (In the POC a marker containing "engine" changed what the product did.) |
| ENG-13 | **Every live failure becomes a replay test.** When a live run finds a defect, export the inputs and outputs (`DATA-05`), add a replay test that fails before the fix, then fix. |
| ENG-14 | **Fixed browser contexts.** Each Playwright test sets its viewport when the browser context is created; never resize a live page. Test on Chrome and Edge. Interact through stable hooks (`VER-03`), never by guessing at generated layouts. |
| ENG-17 | **Traceability and stable IDs.** Tests name their requirement ID. CI lists every requirement and lesson, its milestone, proposed/implemented/verified status, evidence and remaining limits. Implementation and tests are read from code docs' `implements` and `tests` fields (`ENG-24`) and from test names. A test name is a coverage link, not proof of general correctness. Deferred work stays visible and excluded from current closure counts. IDs are never reused or renumbered; removed requirements stay retired. |
| ENG-20 | **No flaky tests.** A test that fails intermittently is quarantined at once, with an issue, and fixed before the milestone closes. Tests are never retried until they pass. (The POC had a flaky viewport test whose cause was first misdiagnosed.) |
