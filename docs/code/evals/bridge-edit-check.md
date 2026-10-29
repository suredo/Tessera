---
type: Code Module
title: "Bridge edit check"
description: "One frozen behavioral edit of a saved shopping list, exercising bridge prompt context with a fake CLI rehearsal and proposed two-call cap."
resource: ../../../evals/spikes/bridge-edit-check/
implements: [ENG-07, ENG-16, ENG-19, GEN-07, DATA-03]
tests: [../../../evals/test/bridge-edit-check.test.ts]
tags: [code, evals, edit, bridge]
status: draft
generated: { by: codex/gpt-6.1-sol, at: 2026-10-29T20:50:34Z }
---

# Purpose

Prepares the static bridge prompt slice for [issue 148](https://github.com/suredo/Tessera/issues/148). One host request adds numeric quantity 1 beside Milk and Eggs in the original white saved shopping list, preserving IDs, titles, layout and entries. This is a proposed evaluation, with no live authorization. Earlier unused reserves cannot fund this run.

# Entry points

- `run.ts`: `PLAN` freezes the one-case denominator, proposed cap two (one expected Sonnet low edit plus one shared schema/static/smoke repair reserve), zero reviewer calls and original seven-minute request budget. `REPLY` supplies the white canned answer for the exact fake CLI rehearsal. `editOnlyProvider` guards model delegation; `runBridgeEditCheck` drives the host request through smoke and activation. After integrating the bridge slice and building, rehearse with `node evals/spikes/bridge-edit-check/run.ts --dry-run`. A live invocation requires fresh explicit owner approval of the proposed cap first.

The source plan starts at `33dc0d751eb66b0a5e1dc567d4fad294048fb878` in isolated branch `test/static-bridge-eval`; static-bridge author head `01d10fad6933e95ebed892d79864c51ac6be1184` is integrated at merge `020c9e2780ab01c49db7f75258cab0f69f3da85b` before rehearsal. Reports record the actual integrated head and whether the source tree is dirty.

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

Reuses the [evaluation harness](harness.md), fake CLI adapter and [smoke repair check](smoke-repair.md)'s cancellation wrapper. The [edit fixture](../../../packages/server/test/fixtures/edit-tool.ts) supplies the saved original and free migration answer. Focused tests exercise contract/stage refusal, prompt provenance, shared reserve, provider stops and lossless white-fixture migration.

# Pitfalls

The changed bridge implementation is integrated; the exact free browser rehearsal still awaits phase coordination. Heavy unit/browser/lint phases must be coordinated across worktrees. The free answer checks runner behavior, not model quality. Conservatively propose 10,000 to 25,000 input and 2,000 to 6,000 output tokens total under cap two, including CLI overhead and one repair; these are estimates, not token limits or authorization. Measure actual prompt and schema sizes from the free CLI capture before seeking approval. No live or browser result is claimed yet.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `run.ts`: `PLAN`, `REPLY`, `editOnlyProvider`, `runBridgeEditCheck`
