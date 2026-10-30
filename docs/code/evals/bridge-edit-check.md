---
type: Code Module
title: "Bridge edit check"
description: "One frozen behavioral edit of a saved shopping list, exercising bridge prompt context with a fake CLI rehearsal and approved two-call live check."
resource: ../../../evals/spikes/bridge-edit-check/
implements: [ENG-07, ENG-16, ENG-19, GEN-07, DATA-03]
tests: [../../../evals/test/bridge-edit-check.test.ts]
tags: [code, evals, edit, bridge]
status: draft
generated: { by: codex/gpt-6.1-sol, at: 2026-10-30T03:04:13Z }
---

# Purpose

Checks the static bridge prompt slice for [issue 148](https://github.com/suredo/Tessera/issues/148). One host request adds numeric quantity 1 beside Milk and Eggs in the original white saved shopping list, preserving IDs, titles, layout and entries. The owner approved one run capped at two calls. Its [live result](../../../evals/reports/2026-10-30-bridge-edit-check.md) passed the one required case in one edit call, without repair. Unused reserves authorize no repeat.

# Entry points

- `run.ts`: `PLAN` freezes the one-case denominator, cap two (one expected Sonnet low edit plus one shared schema/static/smoke repair reserve), zero reviewer calls and original seven-minute request budget. `REPLY` supplies the white canned answer for the exact fake CLI rehearsal. `editOnlyProvider` guards model delegation; `runBridgeEditCheck` drives the host request through smoke and activation. After integrating the bridge slice and building, rehearse with `node evals/spikes/bridge-edit-check/run.ts --dry-run`. Any additional live invocation requires fresh explicit owner approval of its cap first.

The runner includes the merged static-bridge implementation. Each report records the exact source head and whether the source tree is dirty; the CLI requires an explicit run mode and, for live mode, the matching approved cap.

| Stage | Expected calls | Reserve | Route |
| --- | ---: | ---: | --- |
| Intent | 0 | 0 | Scripted |
| Initial creation | 0 | 0 | Handwritten saved fixture |
| Behavioral edit | 1 | 0 | Sonnet low |
| Schema/static/smoke repair, shared globally | 0 | 1 | Existing Sonnet medium repair route |
| Data / reviewer | 0 | 0 | Refused |

# Invariants

- The handwritten saved fixture is seeded without creation calls. Intent is scripted as behavior-changing, targeting the current tool, with look-only false. Only the exact edit contract at edit/repair stages reaches the capped harness. The actual edit StageSpec must contain bridge prompt provenance before delegation, so the changed generated manifest context is exercised.
- One expected edit and one shared repair reserve cover all failure classes. A third call is refused before the underlying provider. Schema failure may use the existing repair path; other provider errors stop delegation. No intent, creation, data or reviewer model calls are planned. First case failure stops the run; the frozen denominator stays one.
- Activation must preserve workspace identity/name, add one version and one data revision, retain both original IDs/titles and add quantity 1 as the only data field. The title and unordered list remain visible; each original row must show quantity 1 as text or a visible input value. Only the host request is driven; generated controls are inspected, never operated (M2 scope).
- Runs use an allocated port and isolated evaluation storage. Cancellation settles pending calls before storage closes and the cost ledger is summarized. Reports retain exact source head/dirty state, ledger, elapsed time and outcome. Chrome has a fixed 1280 by 800 viewport. Capture scrolls the host to the top and checks both rows in the viewport. Viewport screenshots are authoritative; full-page captures remain supplementary under L-76.

# Depends on / used by

Reuses the [evaluation harness](harness.md), fake CLI adapter and [smoke repair check](smoke-repair.md)'s cancellation wrapper. The [edit fixture](../../../packages/server/test/fixtures/edit-tool.ts) supplies the saved original and free migration answer. Focused tests exercise contract/stage refusal, prompt provenance, shared reserve, provider stops and lossless white-fixture migration. The portable live answer is also replayed through `editedCandidate` (including the actual direct-bridge guard) and `migrateData`, checking retained source, IDs, titles, colors, list markup, schema version and migration history.

# Pitfalls

The exact free rehearsal passed its one required case with one fake edit call at `b60ba875f2c912d695adfb9a34469c42d3a4370e`, with a clean source tree. Evidence stays under ignored `test-output/evals/bridge-edit-check-dry-run-2026-10-30T02-46-45-134Z/` in the evaluation checkout. The inspected viewport shows Milk and Eggs with quantity 1; the stored IDs/titles, white colors and list layout were preserved. The call exercised `bridge@63eefdc4fb28`: 13,677 system characters, 1,477 request characters and 6,512 wrapped-schema characters, or 21,666 total before CLI overhead. This establishes runner behavior, not model quality. Conservatively propose 10,000 to 25,000 input and 2,000 to 6,000 output tokens total under cap two, including CLI overhead and one repair; these are estimates, not token limits or authorization. The subsequent approved live run at clean `d900a427ddf4bbd7fb234b2ab69b0645dc765b09` passed 1/1 in one call: 9,845 input tokens, zero cached input, 514 output and 3.965 model seconds. The report retains its viewport image, sanitized ledger and parsed-answer replay; negative bridge errors were not exercised live. Heavy local phases remain serial across worktrees; full-page captures remain supplementary under L-76.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `run.ts`: `PLAN`, `REPLY`, `editOnlyProvider`, `runBridgeEditCheck`
