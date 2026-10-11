---
subject: practices/checkpoint
task_id: task-checkpoint-workflow
date: 2026-10-11
status: historical
---

# Alternatives rejected for the checkpoint workflow

## Context

The context-checkpoint specification proposed a layout and names that had to be adapted to Tessera. These alternatives were weighed with the owner on 2026-10-11 before `ENG-25` and `ENG-26` were written.

## Outcome

- **`.okf/` as the root, with workflows and context inside it.** Rejected: Tessera's OKF bundle is `docs/`, and the specification itself says to adapt to the repository.
- **Handoffs and history inside `docs/`.** Rejected: they are not current knowledge. Inside the bundle they would need OKF types and index entries, change the indexes at every checkpoint, and show up in normal navigation. They live in `context/`, outside the bundle, and are checked by the same script.
- **Keeping finished handoffs with status `complete`.** Rejected: nothing would ever remove them, which repeats lesson L-14 (long handoff documents of mixed age). A finished task's handoff is removed before its pull request merges; git keeps it.
- **The draft pull request description as the only handoff,** which would have kept `ENG-05` unchanged. Rejected: it needs GitHub access, isn't versioned with the branch, and can't serve work that hasn't reached a pull request yet. `ENG-05` was amended instead, with the owner's approval.
- **The skill names `checkpoint` and `resume`.** Rejected; the reason is recorded in decision A52.

## Relationship to current knowledge

- Canonical: `docs/practices/checkpoint.md`, `docs/practices/resume.md`, `docs/decisions/decision-log.md`
- Superseded by: none

## Sources

- The context-checkpoint specification, as provided by the owner, and the owner's answers on 2026-10-11
- Claude Code skills documentation (a project skill replaces a built-in command of the same name) and Codex skills documentation (`.agents/skills`, `allow_implicit_invocation`)
