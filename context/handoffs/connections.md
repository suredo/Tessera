---
task_id: connections
subject: spec/capabilities
status: in-progress
checkpoint_date: 2026-11-14
---

# Task: connections to outside services that the person adds (#349)

## Objective
Build [#349](https://github.com/suredo/Tessera/issues/349) per its [plan](https://github.com/suredo/Tessera/issues/349#issuecomment-6870898870): tools reach services the person added, only through the host, only through the connections they were built for.

## Completed
- Step 1, [#355](https://github.com/suredo/Tessera/pull/355): connections and their keys (`packages/server/src/connections/connections.ts`).
- Step 2a, [#357](https://github.com/suredo/Tessera/pull/357): artifact contract 3, a version's `connections` (`packages/contracts/src/artifact.ts`).
- Step 2b, [#358](https://github.com/suredo/Tessera/pull/358), merged as `35fdc61`: reads through a connection, `packages/server/src/connections/requests.ts`, checks CNX-01 to CNX-06 (`packages/server/test/connection-requests.test.ts`).

## Authoritative references
- `docs/decisions/adr/0015-person-connections.md`: points 4 (first write confirmed, revocable) and 5 (staging never reaches the service).
- `docs/decisions/decision-log.md`: A65 to A68. A67 makes key scanning a defence with a documented limit: don't reopen it.
- `docs/spec/threat-model.md`, "Connection checks": CNX-06's interim refusals are what step 3 replaces; number new checks from CNX-07.
- `docs/code/server/connections.md`: claims CNX-01 to CNX-06, not `CAP-02` yet.

## Decisions and approvals
- Accepted: A65 to A68.
- Pending approval: none.

## Open questions / blockers
- Encrypting keys at rest: raised once, not asked for. Don't build it.
- How the confirmation is shown (the host page's dialog, its words) has no design yet; follow `GEN-12` and the ADR's "where it goes and what it sends", and ask the owner if a choice is theirs.

## Next action
1. Step 3, on this branch, `feat/connections-writes`:
   - **Permission:** stored per workspace and connection (migration 0018 with a `schema-17.sql` fixture, `ENG-18`), taken back from the details view later (step 4).
   - **First write:** the host page asks the person before a tool's first non-GET/HEAD request through a connection; allowed later writes run without asking. Replace the write refusals in `packages/runtime/src/bridge.ts` and `requestThroughConnection`, keeping the server as the authority.
   - **Staging:** made-up answers in place of the refusal (the staging handlers in `packages/runtime/src/staging.ts`); a fake service that fails the test if reached.
2. Codex cross-review (C:\dev\Tessera-codex-review), merge when clean and green, then steps 4 and 5.

## Provenance
- Branch `feat/connections-writes`, from `main` at `35fdc61`, holds only this handoff.
- At `b3f976a` (#358's head) all 15 CI checks passed; locally, server, runtime and evals: 809 tests pass with `--testTimeout=30000`.
