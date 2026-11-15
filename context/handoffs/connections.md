---
task_id: connections
subject: spec/capabilities
status: in-progress
checkpoint_date: 2026-11-14
---

# Task: connections to outside services that the person adds (#349)

## Objective
Build [#349](https://github.com/suredo/Tessera/issues/349) per its [plan](https://github.com/suredo/Tessera/issues/349#issuecomment-6870898870): tools reach services the person added, only through the host and only through their own connections. Steps 1 to 3 are done, and step 4 is done except images; step 5 remains.

## Completed
- Step 4, merged:
  - Connections section: [#363](https://github.com/suredo/Tessera/pull/363) (A71).
  - Details view, with connections, Take back and recent requests: [#364](https://github.com/suredo/Tessera/pull/364) and [#365](https://github.com/suredo/Tessera/pull/365) (A72, A73).
  - Static check, so a tool asks only for its own connections: [#366](https://github.com/suredo/Tessera/pull/366) (`CNX-01`).
  - Generation prompt parts and room: [#367](https://github.com/suredo/Tessera/pull/367).
  - Intent stage chooses connections and the host gives them: [#368](https://github.com/suredo/Tessera/pull/368), merged as `e7b2a5f` (A74).
- Every PR passed Codex's review and all 15 CI checks.

## Authoritative references
- `docs/decisions/adr/0015-person-connections.md`: point 6 (images as assets) and point 5 (samples).
- `docs/decisions/decision-log.md`: A65 to A74. A74 sets the prompt room: a request with connections gets 2,000 more characters; intent is at 10,900; a tool gets at most 3 connections.
- `docs/spec/capabilities.md` (`CAP-02`), `docs/spec/data.md` (`DATA-11`), `docs/spec/threat-model.md` (CNX-01 to CNX-07; number new ones from CNX-08).
- `docs/code/server/connections.md`, `docs/code/server/assets.md`, `docs/code/server/generation.md`, `docs/code/server/prompts.md`.

## Decisions and approvals
- Accepted: A65 to A74.
- Pending approval: none. Live model calls need the owner's budget approval (`docs/practices/live-evaluation.md`). The owner said scripted replies only, no live calls.

## Open questions / blockers
- The intent stage's instructions changed for every request: the connections field, and the narrower "unsupported" rule. Only scripted replies have checked them; a budgeted live check is the owner's call.
- Prompt room is tight: the largest creation with connections is 21,934 of 22,000.
- Encrypting keys at rest: raised, not asked for.

## Next action
1. On this branch, `feat/connections-images`: images in a connection's answer that the tool shows, fetched by the host and handed over as assets (ADR 0015 point 6, `DATA-11`). Decide first how a tool asks for one (a bridge action naming the image's address under the connection's origins), and say what is open.
2. Step 5: the movie finder (T7) through a fake movie service in the eval scenarios, with scripted replies, then claim `CAP-02` in the code docs.

## Provenance
- Branch `feat/connections-images`, from `main` at `e7b2a5f`, holds only this handoff.
- Local checks per PR are listed in each PR body; the last, #368, also ran the full server suite (722 pass, 4 skipped).
