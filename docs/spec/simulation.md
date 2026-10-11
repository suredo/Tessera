---
type: Requirement Area
title: "Simulation engines"
description: "Versioned engines, isolated checks and research before code, for a later milestone (SIM-01 to SIM-06)."
tags: [spec, simulation, engines]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-11T20:21:39Z }
---
# Simulation engines (`SIM`, later milestone)

The POC's [simulation-engines-plan.md](../poc/simulation-engines-plan.md) is the reference design. Requirements to carry over when M5 starts:

| ID | Requirement |
| --- | --- |
| SIM-01 | Engines are versioned modules, separate from tools. Each has a spec, source, an interface (methods), dependencies pinned as `id@version`, and checks. Tools pin engine versions, and undo restores the matching versions. |
| SIM-02 | Engine checks run in an isolated process (`SEC-01`). Every check runs twice and full results are compared, to prove repeatability. Randomness comes only from a seeded generator; `Math.random` and `Date` are unavailable. |
| SIM-03 | Rules: check the library first; build changes on the existing engine; replace only on an explicit request; look-only edits never touch engines; new versions keep all methods and earlier checks. |
| SIM-04 | **Research before implementation code** (A46). For a new engine, replacement or extension that changes mathematical behavior/settings: first produce a structured change plan without implementation code, then obtain and validate the cited research spec/reference checks, then generate code against that spec. The host compares declared settings and methods with the base contract; do not trust a `newMaths` flag alone. If code reveals unresearched mathematical changes, reject it and return to research before regenerating. Pure reuse or a change covered by the existing researched spec needs no new research. Malformed required reference checks are repaired or cause an explicit failure; never silently remove acceptance coverage. Only research has web tools. Cache by research inputs/spec version and budget its high cost (34–85 s and up to 90k input tokens per POC call). |
| SIM-05 | The simulation verification profile (`VER-03`) has hooks (a run control, a text summary of results, the plan in a standard shape) and a synthetic fixture. |
| SIM-06 | Modularity: decide in [D9](../decisions/open/d09-engine-modularity.md) whether splitting reusable engines is a rule the host enforces or guidance. In five live POC runs Claude always built one combined engine. |
