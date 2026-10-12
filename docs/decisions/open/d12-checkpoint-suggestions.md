---
type: Open Decision
title: "D12. Suggesting a checkpoint"
description: "Whether assistants may suggest a checkpoint on their own, and on what signals (decide during M0)."
tags: [decisions, checkpoint]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-12T00:21:12Z }
stale_after: 2027-04-11T00:00:00Z
---
# D12. Suggesting a checkpoint

Rules: `ENG-25`, `ENG-26`. Decision: A52.

A checkpoint runs only when the owner asks ([`ENG-25`](../../practices/checkpoint.md)), but nothing says whether an assistant may suggest one. The context-checkpoint specification behind A52 deferred automatic suggestions, hook-based triggers and token thresholds; until now that was recorded only in the description of [PR 5](https://github.com/suredo/Tessera/pull/5).

A suggestion could come when:

- the task switches subject;
- the session has run long, or the tool is about to summarize the earlier conversation on its own, which loses detail that no checkpoint has saved;
- the task stops for a while, waiting on a review or on the owner.

Options:

1. **No suggestions.** The owner decides alone. Simple, but a long session can lose detail to the tool's own summarizing before anyone checkpoints.
2. **A one-line suggestion, never a run.** The assistant says why ("we've moved from the asset store to the importer") and carries on; the owner decides. Nothing to build, and it works the same in both tools.
3. **Hooks.** A tool hook suggests a checkpoint at a context-size threshold or just before summarizing. Claude Code can run a hook before it summarizes (`PreCompact`); whether Codex offers the same needs checking, and both assistants must behave alike (`ENG-05`).

**Recommendation:** option 2, decided when both assistants are set up for development in M0, after a few real checkpoints show where sessions actually run long. Consider option 3 only if suggestions keep coming too late.
