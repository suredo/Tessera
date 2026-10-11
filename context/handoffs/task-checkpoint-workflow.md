---
task_id: task-checkpoint-workflow
subject: practices/checkpoint
status: ready-for-review
checkpoint_date: 2026-10-11
---

# Task: task checkpoint and resume workflow

## Objective

Add the documentation-first checkpoint and resume workflow from the owner's context-checkpoint specification: one procedure in `docs/`, thin skills for Claude Code and Codex, handoffs and history in `context/`, checked by the OKF script.

## Completed

- Procedures: `docs/practices/checkpoint.md` (`ENG-25`) and `docs/practices/resume.md` (`ENG-26`), with both templates.
- Skills: `task-checkpoint` and `task-resume` in `.claude/skills/` and `.agents/skills/`, manual-only in both tools.
- `context/README.md`; the alternatives considered are in `context/history/practices/checkpoint/2026-10-11-task-checkpoint-workflow.md`.
- `scripts/okf-check.mjs` validates handoffs, history notes and skill parity; `scripts/okf-check.test.mjs` has 17 passing cases.
- Rule updates: `ENG-05` amended, `ENG-09` item 8, L-14 mapped to `ENG-25`, `AGENTS.md` "Changing sessions", `docs/log.md`.

## Authoritative references

- `docs/practices/checkpoint.md` — the procedure and where each finding goes
- `docs/practices/resume.md` — what a new session reads, and what wins
- `docs/decisions/decision-log.md` — decision A52
- `AGENTS.md` — the "Changing sessions" section

## Decisions and approvals

- Accepted: A52 (approved by the owner on 2026-10-11, amending `ENG-05`).
- Pending approval: none.

## Open questions / blockers

- `/task-resume` in Claude Code is untested until a session that starts after this branch exists runs it (acceptance test T6).
- `$task-resume` in Codex follows the Codex docs but has not been tried here.

## Next action

1. In a new Claude Code session on this branch, run `/task-resume task-checkpoint-workflow` and record what it read and proposed.
2. Do the same in Codex with `$task-resume task-checkpoint-workflow`.
3. Address review findings on the pull request.
4. When the owner asks to merge, remove this handoff in the last commit first.

## Provenance

- Branch `feat/task-checkpoint`; the pull request is opened from it.
- Checks at checkpoint: `node scripts/okf-check.mjs`, 0 errors; `node --test scripts/okf-check.test.mjs`, 17 of 17 passing.
