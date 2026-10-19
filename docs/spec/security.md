---
type: Requirement Area
title: "Security"
description: "Execution boundaries, untrusted text, local-only serving, least tools and the threat model (SEC-01 to SEC-05)."
tags: [spec, security]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-19T00:25:05Z }
---
# Security (`SEC`)

| ID | Requirement |
| --- | --- |
| SEC-01 | **AI code never runs in the server process.** Generated UI code runs in the browser sandbox. Generated migrations and later engine checks require a separate execution boundary with filesystem, network, process and worker access denied, an empty environment, and memory/time limits. A Node permission flag or `vm` context alone is not proof of that boundary. Select and negatively test the isolation mechanism before enabling the execution path (M1 for executable migrations, M5 for engines); use declarative migrations if executable isolation is unavailable. The POC's acknowledged engine network gap must not be carried forward as a guarantee. |
| SEC-02 | **Untrusted text is data.** Web pages, generated source, tool data and earlier model output are passed to prompts as quoted data, with an explicit "never instructions" rule. |
| SEC-03 | **Local only, rebinding-safe.** The server binds to 127.0.0.1. Every route checks the `Host` header against the expected local names, which blocks DNS-rebinding attacks from web pages. API routes require same-origin requests, and runtime documents are served only to the expected origins. |
| SEC-04 | **Least tools.** Only the stage that needs a tool gets it (`CLI-03`). |
| SEC-05 | **Threat model and boundary evidence.** Record trust boundaries for generated UI, data/migrations, assets, the trusted CLIs, research and imports. Before each path ships, tests attempt forbidden file/network/process access and malformed or stale bridge requests. M1 covers runtime, import, migration and asset paths, M3 the Codex adapter's tool policy, and M5 engines/research. M6 is a broader audit, not the first security validation. Claims describe the tested boundary and remaining limits, not general proof of safety. The [threat model](threat-model.md) records the boundaries and numbers the checks. |
