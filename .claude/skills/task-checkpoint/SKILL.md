---
name: task-checkpoint
description: "Checkpoint the current Tessera task before changing sessions: route lasting findings to their docs, keep useful history apart, and write one short handoff. Run only when the user asks."
disable-model-invocation: true
---

Follow `docs/practices/checkpoint.md` (ENG-25). It is the only definition of this workflow; these lines only point to it.

- Work on the current task only. Use the task ID the user gives, or the existing handoff's ID if the task already has one.
- Changes to authoritative docs (product, spec, practices, roadmap, decisions, `AGENTS.md`) need the user's explicit approval. Without it, record the exact proposed change in the handoff as pending.
- Writing the handoff does not clear or shorten this conversation. Say so in the report, and tell the user to continue in a new session with `task-resume <task-id>`.
