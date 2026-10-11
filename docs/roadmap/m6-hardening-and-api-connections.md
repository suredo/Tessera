---
type: Milestone
title: "M6: Hardening and API connections"
description: "Hardening, API-key connections, other platforms and outside trials."
tags: [roadmap, hardening-and-api-connections]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-11T20:21:39Z }
---
# M6: Hardening and API connections (size M)

- Cross-browser coverage (Firefox best effort), performance under large tools, accessibility audit.
- Broader security audit of boundaries already tested before shipping in M1/M3/M5. Engine network isolation is an M5 prerequisite, not a gap left until M6.
- Cost work: scoped JavaScript edits, prompt caching across calls where the provider allows it, measuring savings.
- API-key connections (Anthropic and OpenAI first) behind the same adapter interface, so people other than you can run Tessera with their own account. Subscription sign-in is never offered to others (`CLI-10`, A47).
- Model matrix: the M4 scenario set run with different generation models, Claude Code and Codex included, to compare quality and style consistency (`EVAL-05`).
- Name check before anything goes public: npm scope (if packages are published), a domain and a basic trademark search for software (A20).
- macOS and Linux support, and an installer, so people outside the team can try it (`PLAT-01`). Needs the API-key connections above.
- Trials with real people outside the team (POC gap: nobody outside the team ever used it).

**Later, after M6:**
- More providers through the same interface (z.ai, Kimi, Grok and others), or a standalone app that connects to the person's own AI account (A47).
- A richer versioning system for tools (named versions, drafts or branches, comparison), also usable by the AI for bigger changes in a draft (A32).
- Modularity: saving and reusing features across tools ([modularity scenarios](../testing/app-catalogue.md#later-modularity)).
- AI inside tools (`CAP-05`).
- A tool store ("check the store first", A12).
