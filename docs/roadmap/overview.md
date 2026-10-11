---
type: Roadmap
title: "Overview"
description: "Build order, the milestone diagram, sizes and sign-off."
tags: [roadmap, overview]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-11T20:21:39Z }
---
# Roadmap

Milestones and provisional call envelopes, derived per scenario run. Before each evaluation, derive calls per stage including intent, generation, data actions, repair reserves and review, then approve the actual hard cap ([ENG-07](../practices/live-evaluation.md)).

**Order principle: build the deterministic core first, then add the model.** Apart from two small spikes in M0 that test the riskiest assumptions early (A33), everything up to M1 runs without model calls. The POC kept finding host bugs during expensive live runs; this order finds them in CI instead.

```text
M0 Foundations ─► M1 Runtime & data ─► M2 Pipeline ─► M3 Verification ─► M4 First release (v0.1)
   (+ spike)                             │                                  │
                                    internal alpha                M5 Engines & simulation
                                    (you use it daily)                      │
                                                                  M6 Hardening & API connections
```

- **Sizes** are relative (S, M, L) for one person directing AI assistants (A34). They are not dates. Real pace is measured after M0 and M1 and used to forecast the rest.
- **Sign-off:** every milestone ends with a short report in `evals/reports/` (what was delivered, exit criteria results, live costs, open issues) and your sign-off before the next one starts.
