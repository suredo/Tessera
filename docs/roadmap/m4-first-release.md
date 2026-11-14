---
type: Milestone
title: "M4: First release, v0.1"
description: "Useful-immediately generation, more profiles, files and data providers, and the v0.1 acceptance run."
tags: [roadmap, first-release]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-14T16:48:17Z }
---
# M4: First release, v0.1 (size L, live budget about 140 calls)

**Goal:** a person can use it for real tasks.

| Deliverable | Requirements |
| --- | --- |
| First task: decide the outside data source for the movie finder (D11, A42): decided on 2026-11-14, connections the person adds ([ADR 0015](../decisions/adr/0015-person-connections.md)) | CAP-02 |
| "Useful immediately" generation guidance and checks (stated data, sensible defaults, labelled examples, no past-dated defaults) | UX-01, GEN-05 |
| Three more profiles: items over time (T4), editing with files in/out (T14), and search results with selection (T7). Recurring chores combine item-list and time rules | VER-03, VER-05 |
| Files in and out through the asset store (for the image editor, T14); connections to outside services for T7, which the person adds (ADR 0015), with images delivered as assets and videos opened on their own site | CAP-02, CAP-03, DATA-11 |
| Connection boundary checks ([#349](https://github.com/suredo/Tessera/issues/349)) | CNX-01, CNX-02, CNX-03, CNX-04, CNX-05, CNX-06, CNX-07 |
| Details view complete (source, versions, checks, ledger, diagnostics) | UX-06, APP-09, OBS-01 |
| Metrics report from the ledger | OBS-03 |
| Discussing without building: a question or an idea gets a plain answer, and nothing is built until asked (A59) | GEN-19, GEN-01 |
| Fixes for the issues found during the internal alpha | — |
| Changes to the host app's own screens, found by testing real tools made in M4 (owner's choice, 2026-11-07: UI changes wait until generated tools can be tested in the app) | — |

**Live acceptance evaluation (provisional envelope about 140 calls, including reviews):** ten English app runs, T2 and T10 in Portuguese, plus P1/P2: 14 scenario runs total. App runs take about 10–14 calls each with review (T7, T10 and T14 at the high end); P1 and P2 about 5 together. T2 is a distinct app, not a duplicate of the ten English apps. Derive a per-stage cap before approval; revise the budget rather than silently dropping required coverage. Every scenario starts empty. Score AI-dependent steps separately from deterministic lifecycle steps, as specified in release acceptance.

**Exit criteria:** [release acceptance](../spec/acceptance.md), with your verdict on every scenario. Tag `v0.1.0` and publish the changelog (`ENG-23`). This is the first release.
