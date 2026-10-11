---
task_id: task-checkpoint-workflow
subject: practices/checkpoint
status: ready-for-review
checkpoint_date: 2026-10-11
---

# Task: task checkpoint and resume workflow

## Objective

Add the documentation-first checkpoint and resume workflow from the owner's context-checkpoint specification. That specification is not in the repository; its result is `ENG-25`, `ENG-26` and decision A52, which are what count now.

## Completed

- Procedures `docs/practices/checkpoint.md` (`ENG-25`, with the handoff and history templates) and `docs/practices/resume.md` (`ENG-26`).
- Skills `task-checkpoint` and `task-resume` in `.claude/skills/` and `.agents/skills/`, manual-only in both tools.
- `context/` with this handoff and the history note `context/history/practices/checkpoint/2026-10-11-task-checkpoint-workflow.md`.
- `scripts/okf-check.mjs` checks handoffs, history notes and skill parity; `scripts/okf-check.test.mjs` passes 17 of 17.
- Rule updates: `ENG-05`, `ENG-09` item 8, L-14 mapped to `ENG-25`, `AGENTS.md` "Changing sessions", `docs/log.md`.
- Fresh-session resume check, Claude Code: read only the skill, `ENG-26` and this handoff, verified every path, and reported five unresolvable references, now fixed here and prevented by `ENG-25` step 6. The command reached it as text from another session, so the skill was found through the `AGENTS.md` fallback.
- Codex: `$task-resume` loaded the skill and followed `ENG-26`, but in a chat with earlier context.

## Authoritative references

- `docs/practices/checkpoint.md` — the procedure and where each finding goes
- `docs/practices/resume.md` — what a new session reads, and what wins
- `docs/decisions/decision-log.md` — decision A52
- `AGENTS.md` — the "Changing sessions" section

## Decisions and approvals

- Accepted: A52 (approved by the owner on 2026-10-11, amending `ENG-05`).
- Pending approval: none.

## Open questions / blockers

- The fresh-session resume check (the specification's test "T6", not Tessera's T6 test app) still needs two runs the owner types: `/task-resume` in a new interactive Claude Code session, and `$task-resume` in a new Codex chat. Codex skill docs: https://developers.openai.com/codex/skills

## Next action

1. Record the owner's two fresh-session runs on the pull request.
2. Address review findings on the pull request.
3. When the owner asks to merge, remove this handoff in the last commit first.

## Provenance

- Branch `feat/task-checkpoint`; pull request https://github.com/suredo/Tessera/pull/5
- Checks: `node scripts/okf-check.mjs`, 0 errors; `node --test scripts/okf-check.test.mjs`, 17 of 17.
