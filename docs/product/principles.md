---
type: Principles
title: "Principles"
description: "The seven rules every design choice follows, from \"the model proposes, the host decides\" to local-first privacy."
tags: [product, principles]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-11T20:21:39Z }
---
# Principles

These come straight from what went wrong and right in the POC.

| # | Principle | Meaning in practice |
| --- | --- | --- |
| P1 | **The model proposes, the host decides** | Every model output is a structured proposal. The host validates it, applies it, or sends it back for repair. Permissions, data integrity, versions, sandboxing and verification are never left to the model. |
| P2 | **Verify outcomes, not claims** | A tool counts as working only when host checks pass. A message like "I added your topics" is shown only if the host confirms the topics were added. |
| P3 | **One definition, many uses** | Each contract (bridge API, verification profiles, checks, UI standard) is defined once. Prompt text, types, static checks and runtime enforcement are generated from that definition, so nothing can say one thing in the prompt and check another. |
| P4 | **Structured over guessed** | Intent comes from a structured model answer that the host checks, not from keyword matching. Keyword rules may only act as tested safety nets, never as the main decision. |
| P5 | **Testable by design** | Generated tools that match a verification profile expose stable hooks, so the host can test them even though their design changes every time. |
| P6 | **Nothing invisible** | Every model call, failure reason and check result is recorded. The person sees plain words; the details view shows everything. |
| P7 | **Local-first and private** | Persistent data stays locally. Model calls send the task context needed by their stage through the signed-in CLI; that context can include user-provided data. Data-provider requests send only the explicitly requested search terms/filters (`CAP-02`). Neither path silently forwards unrelated workspace contents. Asset content, such as a photo, is sent to a model only when a stage needs it and the person is told (`DATA-11`). |
