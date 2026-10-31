---
task_id: cancel-ui
subject: spec/generation
status: in-progress
checkpoint_date: 2026-10-31
---

# Task: Browser cancellation and generation progress

## Objective

Finish browser Cancel and accessible stage/elapsed progress under [issue #152](https://github.com/suredo/Tessera/issues/152). Fix and review the Cancel UI slice before merging, then deliver actual server-stage progress separately.

## Completed

- Server cancellation transport is merged on main at 3ccbb6d477343774c1642ac84d3ebff9b930be70. Browser cancellation is committed on branch feat/cancel-ui at d03018cbc271c6523cd09943008985080e9fa266, [PR #202](https://github.com/suredo/Tessera/pull/202), not merged.
- Task worktree: `test-output/cancel-ui`. Root checkout remains main; enter the task worktree before resuming.
- Browser changes register before generation, retain ownership through review, stop local staging, and preserve confirmed activation/data and mixed-request facts. See `packages/web/src/request-control.ts`, `packages/web/src/generate.ts` and `packages/web/src/App.tsx`.
- Author reports 43 focused tests across six files plus typecheck, lint, format, secrets, coverage and OKF passed on that source. Local Cancel/deadline browsers passed 20/20. Larger local consumer run started before the agent hit its limit; its final result is unverified.

## Authoritative references

- `docs/code/web/package.md` and `docs/code/server/generation.md`: cancellation ownership and truthful outcomes.
- `docs/decisions/adr/0010-generation-progress.md`: approved stage names and elapsed time; streaming deferred.
- `docs/practices/testing.md` and `docs/practices/assistants.md`: targeted evidence, no unchanged retries, independent review and merge gates.

## Decisions and approvals

- Accepted: owner approved agents, cheaper/lower-effort work where appropriate, and squash merging only after fresh independent review, addressed findings and exact-head green CI.
- No live calls authorized for this task. Pending approval: none.
- Keep one author and one reviewer, cheap checks before browser tests, short context, evidence reuse and one CI watcher.

## Open questions / blockers

- [CI run 41062261357](https://github.com/suredo/Tessera/actions/runs/41062261357): Windows has 556 passes, four failures and eight not run; all non-Windows checks pass. All four browser/viewport combinations fail `packages/web/e2e/mixed-request.spec.ts` at line 184: the unchanged-interface/data-review scenario expects "The tool wasn't changed." in the first notice status, but receives empty text. Cause uninvestigated; do not retry unchanged or weaken assertions/timeouts.
- Independent review was interrupted by usage limits before a review comment or review worktree was created. PR has no review posted.
- Actual server-stage/elapsed progress is not implemented. Proposed status capability, provider-stage tracking and polling need design validation; they are not an accepted implementation.

## Next action

1. Investigate the mixed-request notice regression, fix its cause and run affected tests.
2. Complete fresh independent review, address findings, remove this handoff, then require merge-ready OKF and exact-head green CI before merging.
3. Implement and independently review the bounded progress slice; keep #152 open until its acceptance criteria are met.

## Provenance

- Checkpoint verified PR/head/CI on 2026-10-31; this checkpoint changes context/log only. Earlier source evidence belongs to d03018cbc271c6523cd09943008985080e9fa266. Current conversation remains unchanged.
