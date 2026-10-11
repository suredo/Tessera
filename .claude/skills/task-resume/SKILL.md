---
name: task-resume
description: "Resume a checkpointed Tessera task in a new session from its handoff, reading only the docs it references. Run only when the user asks, with a task ID."
disable-model-invocation: true
argument-hint: "<task-id>"
---

Follow `docs/practices/resume.md` (ENG-26). It is the only definition of this workflow; these lines only point to it.

- The task ID is the one given with the command or named by the user. Without one, list `context/handoffs/` and ask which task is meant.
- Read the handoff first, then only the docs it references. Don't load other subjects or `context/history/` unless the next step needs them.
- State a short plan and proceed only as the user's current instructions allow.
