---
type: Open Decision
title: "D7. Progress streaming"
description: "Decided on 2026-10-30 by ADR 0010: M2 shows stage names and elapsed time; streaming remains future work."
tags: [decisions, progress-streaming]
status: deprecated
generated: { by: codex/gpt-6.1-sol, at: 2026-10-30T12:29:00Z }
---
# D7. Progress streaming

> **Decided** by the owner on 2026-10-30 in [ADR 0010](../adr/0010-generation-progress.md): stage names and elapsed time for M2; streaming is future work. No streaming spike or live call was run. What follows is the original question.

Requirements: `CLI-07`, `GEN-16`.

Claude Code has a streaming output mode. Open question: does it report useful progress while keeping the final structured output intact? If it does, the person sees real progress ("writing the interface…"). If not, the app shows the stage name and elapsed time.

**Recommendation:** run a spike (a short experiment) in M2. Fall back to elapsed time if streaming complicates the adapter.
