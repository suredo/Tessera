---
task_id: ui-redesign
subject: roadmap/ui-redesign
status: in-progress
checkpoint_date: 2026-11-20
---

# Task: redesign the host app around the tool

## Objective
Build the redesign the owner agreed on 2026-11-20: the tool first, chat and workspaces hidden by default, the chat floating or docked on the right, one ask bar, a 64 px header and a phone layout. The owner asked Codex to finish it.

## Completed
- Three design rounds with Codex, reviewed by Claude Code and the owner; the final mockups are in `design/ui-redesign/`.
- The proposal, with the design, pending decisions and a split into pull requests: `docs/roadmap/ui-redesign.md`.
- Nothing of the redesign is implemented yet.

## Authoritative references
- `docs/roadmap/ui-redesign.md`: the design and the six suggested pull requests.
- `docs/spec/app.md`: `APP-01` to `APP-11`; `APP-01` needs rewording (pending).
- `packages/web/src/App.tsx`, `packages/web/src/ToolPanel.tsx`, `packages/web/src/Split.tsx`, `packages/web/src/app.css`: today's layout.
- `docs/decisions/decision-log.md`: A89 (the panel fits its tool), A92 (what the sandbox limits).

## Decisions and approvals
- Accepted by the owner: the direction of round three (focus default, floating or docked chat on the right, one ask bar, a smaller header, a comfortable or wide width per tool).
- Pending approval, ask before building: rewording `APP-01`; adding the width declaration (`comfortable` or `wide`) to the artifact contract, prompt and check; opening every tool in Focus; which milestone this belongs to.

## Open questions / blockers
- PR #408 (copying after a click, chart values on hover, A92) is open at `3825ffe`: Codex's re-review of the reduced change was stopped by low memory and never ran; review it, then merge when green (the owner merges reviewed, green PRs through the assistant).
- After #408: dialogs Tessera draws inside the tool's panel, named for the tool, only after the person's click, answered in checks; the static check would steer `confirm`, `alert` and `prompt` to them (A92 says why native dialogs stay off).
- Reading the clipboard stays refused (SBX-13) unless the owner asks for a host-mediated paste.
- A Tessera dev server may still be running at `http://127.0.0.1:4317`; stop it before heavy tests (16 GB machine, one heavy job at a time).

## Next action
1. Ask the owner the four pending decisions in `docs/roadmap/ui-redesign.md`.
2. Then start with pull request 1 there: `APP-01` and the width declaration, with tests.
3. Before that, finish #408's review and merge.

## Provenance
- Branch docs/ui-redesign, from main at 3279da5; this handoff, `docs/roadmap/ui-redesign.md` and `design/ui-redesign/`.
- Checks: `node scripts/okf-check.mjs`, 0 errors.
- Design rounds: Codex sessions run by Claude Code on 2026-11-20; the round-two session id was `01a1fa4b-6711-7412-88a1-6dc4cb6b220b`.
