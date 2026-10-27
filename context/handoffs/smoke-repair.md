---
task_id: smoke-repair
subject: spec/generation
status: in-progress
checkpoint_date: 2026-10-27
---

# Task: repair of smoke-check failures (next part of #146)

## Objective
A candidate that fails the smoke check while the browser stages it gets one repair, as schema-shape and static failures already do (`GEN-09`), before the person is told it failed. Issue: https://github.com/suredo/Tessera/issues/146.

## Completed
- Server-side repair by class, merged in https://github.com/suredo/Tessera/pull/176 (`8932db6`). `createTool` in `packages/server/src/generation/create.ts` repairs schema-shape and static failures, using `REPAIR_BUDGETS` (one per class), the `repair` route and the parts `attempt`, `repair-schema-shape` and `repair-static`.
- Live repair check: 2 calls, both repaired (`evals/reports/2026-10-27-repair-check.md`).
- Pilot fixes and second live run, merged in https://github.com/suredo/Tessera/pull/175: creation is told the request's language, and defaults must fit the schema.
- M2's live budget: 15 of about 35 calls used (`docs/roadmap/budgets.md`).

## Authoritative references
- `docs/spec/generation.md`: GEN-09 (each class has its own budget and prompt part; provider errors are never repaired) and GEN-11 (repair gets 180 s).
- `docs/code/server/generation.md`: how repair works now.
- `docs/code/server/prompts.md`: the parts, and the repair budget (23,500 characters, set by the repair of a creation).
- `docs/code/web/package.md`: `carryOut` stages a candidate behind the smoke check.

## Decisions and approvals
- Accepted: none new.
- Pending approval: none. Any live check of a new `repair-smoke` part needs the owner to approve its budget first (`docs/practices/live-evaluation.md`).

## Open questions / blockers
- **Where the loop lives.** The smoke check runs in the browser (`packages/web/src/generate.ts`, `carryOut`). On failure, `stageCandidate` in `packages/runtime/src/staging.ts` returns `check-failed` with one `reason` string. A repair needs a server route that takes the workspace, the candidate's hash and the findings, and answers with a new candidate. It also needs the stored version as the failed answer, and its starting data must not be replaced twice.
- **Diagnostics.** `smokeCheck` (`packages/runtime/src/checks.ts`) gives one reason. Repair works better with specific findings (L-29 in `docs/lessons/issue-catalogue.md`).
- **The tool frame's fixed height** (finding 8 in `evals/reports/2026-10-27-slice-pilot.md`) waits for the owner's visual check at the end of M2.

## Next action
1. Design the smoke-repair route (contracts first: `packages/contracts/src/generation.ts`), plus a `repair-smoke` prompt part and a `smoke` entry in `REPAIR_BUDGETS` and `REPAIR_CLASSES` (`packages/server/src/prompts/prompts.ts`).
2. Have `carryOut` ask for the repair once on `check-failed`, then stage the repaired candidate. Add a browser test in `packages/web/e2e/request.spec.ts`.
3. Open the PR with milestone "M2: Generation pipeline" and label `gen`, then get Codex's cross-review.

## Provenance
- Branch `feat/smoke-repair`, from `main` at `8932db6`; no pull request yet.
- Checks at the last merge: CI fully green on https://github.com/suredo/Tessera/pull/176.
