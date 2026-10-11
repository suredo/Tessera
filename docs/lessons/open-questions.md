---
type: Lesson
title: "Things the POC did not answer"
description: "What the POC did not answer and Tessera must measure."
tags: [lessons, open-questions]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-11T20:21:39Z }
---
# Things the POC did not answer

These need evidence in Tessera, not assumptions:

- **Success rate at scale.** Every live result was a single run or two repeats. Measure first-attempt pass rates over the agreed real-life scenarios (TEST-05).
- **Cost per useful tool.** Calls and tokens are known per run, but not what "a working tool" costs on average.
- **Does verification generalize?** Two behavior suites existed (study, flow). Whether a small set of verification profiles covers most real requests is unknown.
- **Codex research integration.** Codex generated tools live in the POC, but its web search was never verified for research. Tessera's Codex adapter (M3) gets its own contract tests and probe; research support is checked separately when engines arrive (M5).
- **Real users.** Every request was written by the team. Nobody outside it has used the product.
- **Plan allowance in daily use.** For now Tessera uses the signed-in Claude Code and Codex CLIs on your machine (A3). How far the plan allowance stretches with daily use and evaluation runs is unknown; the internal alpha (A35) measures it. Before other people run Tessera, connections move to API keys or their own provider account (A47).
- **Do people understand the lifecycle?** Observe the internal alpha and a few invited outside testers in observed sessions on your machine during M2/M3, then broader trials in M6. Test Continue, defaults-only Use again, incompatible restoration warnings, finding saved tools and trash without coaching.
