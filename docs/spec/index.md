# Requirements by area

* [Platform and setup](platform.md) - Windows-first platform, launcher, setup check and data folder (PLAT-01 to PLAT-04).
* [Host app](app.md) - What the person sees and can do: main screen, workspaces, library, versions, trash, details (APP-01 to APP-11).
* [Contracts](contracts.md) - One schema source, explicit output unions, the bridge manifest, versioned contracts and units (CON-01 to CON-05).
* [Generation pipeline](generation.md) - Structured intent, routing, generation, repair, honest messages and time limits (GEN-01 to GEN-18).
* [Runtime and sandbox](runtime.md) - The sandbox, one active runtime, staging before activation, bridge enforcement and the host clock (RUN-01 to RUN-07).
* [Host capabilities](capabilities.md) - What tools can ask the host for: data providers, files in and out, vetted libraries (CAP-01 to CAP-05).
* [Data and persistence](data.md) - How Tessera stores, versions, exports and protects a person's data, including binary assets (DATA-01 to DATA-11).
* [Verification](verification.md) - How the host knows a tool works: static and smoke checks, verification profiles, acceptance checks (VER-01 to VER-09).
* [Provider adapters](providers.md) - Model connections: the Claude Code and Codex CLI adapters now, API keys and other providers later (CLI-01 to CLI-10).
* [Observability, cost and speed](observability.md) - The call ledger, evaluation budget guard, metrics and speed targets (OBS-01 to OBS-04).
* [Security](security.md) - Execution boundaries, untrusted text, local-only serving, least tools and the threat model (SEC-01 to SEC-05).
* [Threat model and boundary checks](threat-model.md) - Tessera's trust boundaries, what M1 tests and what it leaves open, and the numbered negative checks for the sandbox, bridge, imports, assets and migrations (SBX, BRG, IMP, AST, MIG).
* [User experience](ux.md) - Useful immediately, progress, honest labels, accessibility, translation and lifecycle (UX-01 to UX-07).
* [Simulation engines](simulation.md) - Versioned engines, isolated checks and research before code, for a later milestone (SIM-01 to SIM-06).
* [Testing](testing.md) - The test layers required in CI and at milestones (TEST-01 to TEST-06).
* [Evaluation](evaluation.md) - Scenario files, host facts, AI review, human verdict, model matrix and replays (EVAL-01 to EVAL-07).

# Release

* [Acceptance for the first release](acceptance.md) - The conditions under which the first release (v0.1) is accepted.
