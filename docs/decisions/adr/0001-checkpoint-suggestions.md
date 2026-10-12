---
type: Decision
title: "ADR 0001. Suggesting a checkpoint"
description: "An assistant may suggest a checkpoint in one line, saying why; it never runs one unasked (decides D12)."
tags: [decisions, checkpoint]
status: stable
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-12T04:41:26Z }
---
# ADR 0001. Suggesting a checkpoint

Decided by the owner on 2026-10-12. It settles open decision [D12](../open/d12-checkpoint-suggestions.md) and builds on A52. Rules: [`ENG-25`](../../practices/checkpoint.md), [`ENG-26`](../../practices/resume.md).

## Context

`ENG-25` runs a checkpoint only when the owner asks, and said nothing about whether an assistant may suggest one. The specification behind A52 deferred suggestions, hooks and token thresholds. Meanwhile a long session can lose detail when the tool summarizes the earlier conversation on its own, before anyone has checkpointed.

## Decision

An assistant may suggest a checkpoint in one line, saying why: the task has switched subject, the session has run long or the tool is close to summarizing it, or the task now waits on a review or on the owner. It never runs a checkpoint unasked, and it doesn't repeat a suggestion the owner declined for the same reason. No hooks and no token thresholds.

The alternatives were no suggestions at all, which risks losing detail to the tool's own summarizing, and hooks that suggest one at a context-size threshold. Claude Code can run a hook before it summarizes, but Codex's support is unverified, and both assistants must behave alike (`ENG-05`).

## Consequences

- `ENG-25` and `AGENTS.md` say that an assistant may suggest a checkpoint.
- Nothing to build or configure, and both tools behave the same.
- If suggestions keep coming too late, a new ADR can add hooks.
