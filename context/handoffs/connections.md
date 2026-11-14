---
task_id: connections
subject: spec/capabilities
status: in-progress
checkpoint_date: 2026-11-14
---

# Task: connections to outside services that the person adds (#349)

## Objective
Build [#349](https://github.com/suredo/Tessera/issues/349) in five pull requests, per its [plan](https://github.com/suredo/Tessera/issues/349#issuecomment-6870898870): tools reach services the person added, only through the host, only through the connections they were built for.

## Completed
- Step 1 merged in [#355](https://github.com/suredo/Tessera/pull/355): `packages/contracts/src/connection.ts`, `packages/server/src/connections/connections.ts`, migration `packages/server/src/storage/schema/0017-connections.sql` with the fixture `packages/server/test/fixtures/databases/schema-16.sql`, and the host API's `connections.list`, `connections.add` and `connections.remove`. Keys never leave the server.
- A66 (only a tool's own connections) merged in [#356](https://github.com/suredo/Tessera/pull/356).

## Authoritative references
- `docs/decisions/adr/0015-person-connections.md`: the decision, with A66 under its point 2.
- `docs/spec/capabilities.md`: `CAP-02`.
- `docs/spec/threat-model.md`: the connections row in the trust boundaries table, whose checks step 2 numbers. Don't use `CON-`: the contract requirements already use it.
- `docs/code/server/connections.md`: step 1's code doc. It claims no requirement yet, on purpose: `CAP-02` must stay "proposed" in `pnpm coverage` until the request path and its boundary checks exist.

## Decisions and approvals
- Accepted: A65 and A66 (`docs/decisions/decision-log.md`). Reads run freely; a tool's first write through a connection is confirmed; checks never reach the real service.
- Pending approval: none.

## Open questions / blockers
- Encrypting keys at rest: the owner hasn't asked for it. Raise it once, without building it.

## Next action
1. Step 2, on this branch, `feat/connections-requests`:
   - **Artifact contract 3:** add a list of connection names (`packages/contracts/src/artifact.ts`), upgraded through `ARTIFACT_UPGRADES` to an empty list.
   - **Capability and bridge action:** a `connection` capability and its bridge action. Keep the action out of the general bridge manifest's prompt projection (`packages/contracts/src/json-schema.ts`): the largest edit prompt is 21,939 of 22,000.
   - **Runtime handler** (`packages/runtime/src/bridge.ts`): refuses in staging and refuses writes until step 3.
   - **Server route:** checks the tool's version names the connection, allows only the connection's origins, refuses redirects, adds the key, limits size and time, and gives answers with provenance.
   - **Tests:** a local fake service.
2. Codex cross-review (C:\dev\Tessera-codex-review), merge when clean and green, then steps 3 to 5.

## Provenance
- Issues: #349, #348 (closed). PRs: #354, #355, #356.
- Branch `feat/connections-requests` holds only this handoff.
- At #356's merge, `879ca77`, `okf-check` passed. Server tests that time out locally at 5 seconds (CLI-01, CLI-05, a GEN-11 test) pass with a longer limit.
