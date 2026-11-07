---
task_id: stage-time-limits
subject: spec/generation
status: in-progress
checkpoint_date: 2026-11-07
---

# Task: make each stage's time limit configurable (GEN-11, #146)

## Objective
Close the last gap in `GEN-11`: "Every stage has a configurable time limit." Today only the request's overall limit can be set; every stage uses a fixed constant. Then claim `GEN-11` and close [#146](https://github.com/suredo/Tessera/issues/146).

## Completed
- Nothing on this task yet. `main` is at `7b0164c`, with no open pull requests. #259 un-claimed `GEN-11` and names the gap in `docs/code/server/generation.md` ("Server stages share a request deadline", GEN-11, in part).

## Authoritative references
- `docs/spec/generation.md`: `GEN-11`. Defaults: intent 60 s, generation and repair 180 s each, a request 7 minutes.
- `docs/decisions/adr/0012-time-limits-after-m2.md`: the owner kept these defaults after M2's measurements. Changing the values needs the owner; making them configurable doesn't.
- The constants: `packages/server/src/intent/intent.ts` (`INTENT_TIME_LIMIT_MS`), `packages/server/src/generation/create.ts` (`GENERATION_TIME_LIMIT_MS`, `REPAIR_TIME_LIMIT_MS`; editing uses them in `packages/server/src/generation/edit.ts`), `packages/server/src/generation/data.ts` (`DATA_TIME_LIMIT_MS`). The overall limit, `requestTimeLimitMs`, is in `packages/server/src/generation/routes.ts` (`GenerationOptions`, checked there); `packages/server/src/generation/deadline.ts` caps each call by the time left.

## Decisions and approvals
- Accepted: ADR 0012 (keep the default values).
- Pending approval: none.

## Open questions / blockers
- Where should configuration live? Either `GenerationOptions` plus `LaunchOptions`, the way `twoPass` is passed (`packages/server/src/launcher/launcher.ts`), or the routes file (`packages/contracts/src/routes.ts`, today model and effort per stage). Prefer the first unless the owner wants it user-editable. Ask if unsure.

## Next action
1. Add per-stage limits (intent, create, edit, repair, data) with the defaults above, checked like `requestTimeLimitMs`, threaded to each stage's call.
2. Tests: a configured limit reaches the provider call, and a bad value is refused at startup.
3. Docs: the generation doc claims `GEN-11`; add a `docs/log.md` line. Then close #146.

## Provenance
- Session of 2026-11-06/07: PRs #244 to #260; the last merged is #260 (APP-05, version notes).
- Working rules: one heavy job at a time, Codex reviews included; local tests use one worker and record nothing (`docs/practices/testing.md`).
- Other M2 work, not this task: GEN-17's measurement needs a new plan and budget (`evals/reports/2026-11-07-two-pass-plan.md`, #153); POC replays (#156); M2's close-out and the owner's visual testing.
