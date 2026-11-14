---
task_id: connections
subject: spec/capabilities
status: in-progress
checkpoint_date: 2026-11-14
---

# Task: connections to outside services that the person adds (#349)

## Objective
Build [#349](https://github.com/suredo/Tessera/issues/349) per its [plan](https://github.com/suredo/Tessera/issues/349#issuecomment-6870898870): tools reach services the person added, only through the host, only through the connections they were built for. Steps 1 to 3 are done; steps 4 and 5 remain.

## Completed
- Steps 1 and 2: connections and keys, and reads through the host, `packages/server/src/connections/requests.ts` ([#355](https://github.com/suredo/Tessera/pull/355), [#357](https://github.com/suredo/Tessera/pull/357), [#358](https://github.com/suredo/Tessera/pull/358)).
- Step 3: sample answers in versions ([#359](https://github.com/suredo/Tessera/pull/359)), staging answered from them ([#360](https://github.com/suredo/Tessera/pull/360)), the write permission ([#361](https://github.com/suredo/Tessera/pull/361)) and the question, `packages/web/src/WriteQuestion.tsx` ([#362](https://github.com/suredo/Tessera/pull/362), merged as `685f8ea`).

## Authoritative references
- `docs/decisions/adr/0015-person-connections.md`: points 1 (settings), 6 (answers as data, images as assets) and 7 (the details view).
- `docs/decisions/decision-log.md`: A65 to A70. A67: key scanning is a defence with a documented limit; don't reopen it.
- `docs/spec/threat-model.md`, "Connection checks": CNX-01 to CNX-07; number new ones from CNX-08.
- `docs/code/server/connections.md`, `docs/code/web/package.md`, `docs/code/server/prompts.md`.

## Decisions and approvals
- Accepted: A65 to A70.
- Pending approval: none.

## Open questions / blockers
- The settings screen's and the details view's design have no decision yet; ask the owner where the choice is theirs (`GEN-12`).
- Prompt budget: the largest edit prompt is 21,939 of 22,000, so connections need their own part, sent only to a request that may use one (`OWN_PART_CAPABILITIES` in `packages/contracts/src/bridge.ts`). The creation answer must then name the connections and write their samples.
- Encrypting keys at rest: raised, not asked for.

## Next action
1. Step 4, on this branch, `feat/connections-settings`, in small pull requests:
   - **Settings:** add, list and remove connections in the host app, through the host API's existing `connections.*` actions.
   - **Details view** (`packages/web/src/Details.tsx`): a tool's connections, its permissions with a way to take one back (`connections.takeBackWrites`), and recent requests, which need recording first (never the key).
   - **Prompt part:** tell a request that may use a connection its names, never keys; answers quoted as data (`SEC-02`); the static check in `packages/server/src/checks/js-check.ts` that a tool asks only for its version's connections.
   - **Images** in answers handed over as assets (`DATA-11`).
2. Step 5: the movie finder (T7) through a fake movie service in the scenarios. Claim `CAP-02` once both exist.

## Provenance
- Branch `feat/connections-settings`, from `main` at `685f8ea`, holds only this handoff.
- Each step's PR lists its checks; step 3's last, #362, passed all 15 CI checks.
