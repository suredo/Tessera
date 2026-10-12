---
type: Practice
title: "Task resume"
description: "How a new session continues a checkpointed task from its handoff, reading only what the next step needs (ENG-26)."
tags: [practices, resume, handoff]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-12T00:52:39Z }
---
# Task resume

| ID | Rule |
| --- | --- |
| ENG-26 | **Resume a task from its handoff** (A52). In a new session, `task-resume <task-id>`, or "follow `docs/practices/resume.md` for `<task-id>`", continues a task checkpointed under [`ENG-25`](checkpoint.md), reading as little as the next step allows. It runs only when asked. |

## Procedure

1. **Read the handoff only:** `context/handoffs/<task-id>.md`. If it doesn't exist, list `context/handoffs/` and ask which task is meant; never guess.
2. **Take stock:** the objective, status, what is done, blockers, pending approvals and the first next action.
3. **Check it still holds.** Confirm that every referenced path exists and that the branch matches what the handoff describes (`git status`, `git log --oneline -5`). If a reference is missing or has changed, say so and find the current version through `docs/index.md` and the folder indexes. If `checkpoint_date` is more than 5 days old, also list what changed on `main` since then in the docs it references (`git log --oneline --since=<checkpoint_date> main -- <paths>`), and say so before relying on them. Never fill a gap from memory, yours or a tool's ([`ENG-27`](assistants.md)), or invent missing content.
4. **Read only what the next action needs,** following the handoff's references. Don't preload neighbouring subjects or `context/history/`; open a history note only when the handoff or a doc links to it and the task needs that reasoning.
5. **State a short plan, then proceed only as the owner's current instructions allow.** Pending approvals stay pending until the owner decides.

## What wins

Current owner instructions and safety rules → authoritative docs and the code, as `AGENTS.md` describes → the handoff → history notes → assumptions. A handoff never overrides a newer approved spec or decision; when they disagree, the authoritative doc wins and the handoff is corrected at the next checkpoint.
