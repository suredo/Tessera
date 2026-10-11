---
type: Lesson
title: "What the POC was"
description: "What the Harness POC was, what it built and what evidence it left."
tags: [lessons, poc-summary]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-11T20:21:39Z }
---
# What the POC was

Covers the whole POC, from the first Codex runs on 2026-10-08 to the last live planner run on 2026-10-11.

**Harness** was a local web app (Node.js, no dependencies) where a person typed what they needed and an AI wrote a small working tool, in HTML, CSS and JavaScript, inside the chat. The person could then change it by talking or by using its controls. Over three days it grew:

- **Foundation:**
  - generated tools in a sandbox, with a bridge for actions on host-held data
  - versions, undo and saved tools
  - a study behavior check
  - two providers (Codex CLI, Claude Code CLI)
- **Final days:**
  - an enforced UI standard
  - a simulation engine system (versioned engines, isolated checks, dependencies)
  - engine rules in generation
  - a research step with web search
  - starting data
  - a flow-planner behavior check
- **Evidence:** 157 offline tests, three recorded browser test suites with video, and about 120 live model calls across many evaluation runs.

This document is self-contained. It summarizes the POC's evaluation reports: two runs of the same student workflow (on Codex and on Claude), a fault-injection and live-matrix simulation, a drawing-tool run, independent review findings, and the engine, research and planner runs from this session. The POC repository is not needed to use it.
