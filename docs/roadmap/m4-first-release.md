---
type: Milestone
title: "M4: First release, v0.1"
description: "Useful-immediately generation, more profiles, files and data providers, and the v0.1 acceptance run."
tags: [roadmap, first-release]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-11T20:21:39Z }
---
# M4: First release, v0.1 (size L, live budget about 140 calls)

**Goal:** a person can use it for real tasks.

| Deliverable | Requirements |
| --- | --- |
| First task: decide the outside data source for the movie finder (D11, A42) | CAP-02 |
| "Useful immediately" generation guidance and checks (stated data, sensible defaults, labelled examples, no past-dated defaults) | UX-01, GEN-05 |
| Three more profiles: items over time (T4), editing with files in/out (T14), and search results with selection (T7). Recurring chores combine item-list and time rules | VER-03, VER-05 |
| Files in and out through the asset store (for the image editor, T14); the first data provider for T7, with result images delivered as assets and videos opened on their own site; sources chosen at the start of M4 (D11) | CAP-02, CAP-03, DATA-11 |
| Details view complete (source, versions, checks, ledger, diagnostics) | UX-06, APP-09, OBS-01 |
| Metrics report from the ledger | OBS-03 |
| Fixes for the issues found during the internal alpha | — |

**Live acceptance evaluation (provisional envelope about 140 calls, including reviews):** ten English app runs, T2 and T10 in Portuguese, plus P1/P2: 14 scenario runs total. App runs take about 10–14 calls each with review (T7, T10 and T14 at the high end); P1 and P2 about 5 together. T2 is a distinct app, not a duplicate of the ten English apps. Derive a per-stage cap before approval; revise the budget rather than silently dropping required coverage. Every scenario starts empty. Score AI-dependent steps separately from deterministic lifecycle steps, as specified in release acceptance.

**Exit criteria:** [release acceptance](../spec/acceptance.md), with your verdict on every scenario. Tag `v0.1.0` and publish the changelog (`ENG-23`). This is the first release.
