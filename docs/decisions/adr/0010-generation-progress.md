---
type: Decision
title: "ADR 0010. Stage names and elapsed time during generation"
description: "D7 is decided for M2: show stage names and elapsed time; streaming remains future work."
tags: [decisions, generation, progress]
status: stable
generated: { by: codex/gpt-6.1-sol, at: 2026-10-30T12:29:00Z }
---

# ADR 0010. Stage names and elapsed time during generation

## Context

[D7](../open/d07-progress-streaming.md) left the progress display dependent on a CLI streaming spike. The owner explicitly chose stage names and elapsed time on 2026-10-30 while planning [#152](https://github.com/suredo/Tessera/issues/152), without spending live calls on streaming.

## Decision

M2 shows the current stage and elapsed time (`GEN-16`, `CLI-07`), with cancellation through job control (`CLI-06`). Streaming output remains future work. This is an owner choice, not a measured claim about the CLI's streaming behavior.

## Consequences

The structured provider output and existing deadlines remain unchanged. #152 delivers cancellation and accessible progress in bounded slices; the server cancellation transport alone does not complete it. A future streaming proposal needs its own evidence and explicit live-call budget before any model call.
