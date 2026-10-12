# Task context

Not project knowledge: what is true or agreed lives in `docs/`. This folder holds working context for tasks.

- `handoffs/<task-id>.md`: what to do next for one in-progress task. Written by a checkpoint, read by a resume, and removed when the task's pull request merges or the task is dropped. The check warns when one is more than 5 days old.
- `history/<subject>/<date>-<task-id>.md`: rejected alternatives and reasoning worth keeping, filed under the `docs/` subject they belong to. Not authoritative.

How to write and use them: `docs/practices/checkpoint.md` (`ENG-25`) and `docs/practices/resume.md` (`ENG-26`). Assistants read these files only when checkpointing or resuming.
