---
type: Decision
title: "ADR 0012. The time limits stay as they are after M2's measurements"
description: "M2's live run met every measurable speed target by a wide margin, on small samples; the stage and request time limits stay unchanged until M3's runs and big tools give enough to set them from."
tags: [decisions, generation, observability]
status: stable
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-07T03:22:23Z }
---

# ADR 0012. The time limits stay as they are after M2's measurements

## Context

`GEN-11` set every stage's time limit from the POC's measurements (creation took 105 to 131 s), to be revisited with real p95 numbers. [Issue 154](https://github.com/suredo/Tessera/issues/154) asks for that revisit from M2's live run. The [speed report](../../../evals/reports/2026-11-07-m2-speed.md) shows the slowest stages far inside the limits: intent 3.5 s, create 14.8 s, edit 19.4 s, repair 8.6 s. But it has only 3 creations and 1 data change, and two passes for big tools (`GEN-17`) aren't built yet. The owner chose on 2026-11-07.

## Decision

- **The limits stay:** 60 s each for intent and a data change, 180 s each for generation and repair, and 7 minutes per request, its planned stages plus one repair.
- **They are revisited with M3's runs,** and again once big tools take two passes, from the same speed figures (`node evals/src/runner/speed.ts`).

## Consequences

- A slow call still has room before it fails, so big tools and slow days aren't cut short; a call that truly hangs still ends at its limit.
- Misses against the speed targets are reported in the figures, not hidden (`OBS-04`), so a regression shows even though no limit catches it.
