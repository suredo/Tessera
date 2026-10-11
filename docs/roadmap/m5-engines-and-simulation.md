# M5: Engines and simulation (size L, live budget about 50 calls)

**Goal:** people can create goal-driven simulations from everyday requests. The event planner is the first evaluation scenario, created by the simulated person like any other tool, not shipped.

| Deliverable | Requirements |
| --- | --- |
| Engine system: versioned modules, pinning, dependencies, isolated check process, seeded randomness | SIM-01, SIM-02, SEC-01 |
| Engine rules in generation (library first, extend in place, explicit replace, look-only protection) | SIM-03 |
| Structured engine plan → research/spec/reference-check validation → implementation → checks. Research precedes code; new mathematical changes invalidate stale research. Repair malformed required checks instead of dropping them | SIM-04, SEC-02, SEC-04, CLI-03 |
| Forbidden filesystem/network/process access and resource-limit tests before enabling engines; review research tool/prompt-injection boundaries | SEC-01, SEC-05 |
| Simulation verification profile and flow check; decision D9 on modularity | SIM-05, SIM-06 |
| three.js as a vetted library for 3D (T17) | CAP-04 |
| What a created event planner should be able to reach (the evaluation target, not a shipped tool): sketch, run, per-station results, compare layouts, and later moving dots and a heat map per decision D10 | UX-01 |

**Live evaluation:** the eight engine scenarios from the POC plan (M1–M8), plus T9 research board, T16 2D simulation and T17 3D viewer, all created from nothing.

**From the POC:** the whole engine design in [simulation-engines-plan.md](../poc/simulation-engines-plan.md), including its live findings: the engine contract and lint, the shared engine host, the isolated check runner, dependency resolution and pinning, the engine rules in generation, the research stage, the flow check, and their test cases.
