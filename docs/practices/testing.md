---
type: Practice
title: "Testing"
description: "The five-layer test pyramid and test rules (ENG-11, ENG-13, ENG-14, ENG-17, ENG-20, ENG-31)."
tags: [practices, testing]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-02T00:55:49Z }
---
# Testing

The POC showed that offline tests can pass while live behavior fails (L-08). The pyramid therefore has five layers, and each catches what the one below can't.

| Layer | What | Where it runs | Model calls |
| --- | --- | --- | --- |
| 1. Unit (`TEST-01`) | Contracts, patch engine, pipeline logic, checks, message lint | CI, every change | None |
| 2. Adapter contract (`TEST-02`) | Exact CLI arguments, environment, stdin, output parsing, usage normalization, error mapping, cancellation, against fake processes | CI | None |
| 3. Scripted end to end (`TEST-03`) | Real server, real browser, real pipeline, canned model replies; screenshots and video for each step | CI (Playwright) | None |
| 4. Replay (`TEST-04`) | Sanitized exports of real live outputs replayed through the pipeline and checks | CI | None |
| 5. Live evaluation (`TEST-05`) | Agreed real-life scenarios (tools created from nothing, then edited, saved, reopened) with a real model, under a budget | Manually, at milestones, approved | Budgeted |

| ID | Rule |
| --- | --- |
| ENG-11 | **Test configuration never travels in the user's words.** Scripted scenarios are chosen by a test header, a fixture file or provider configuration, never by markers inside the request text. (In the POC a marker containing "engine" changed what the product did.) |
| ENG-13 | **Every live failure becomes a replay test.** When a live run finds a defect, export the inputs and outputs (`DATA-05`), add a replay test that fails before the fix, then fix. |
| ENG-14 | **Fixed browser contexts.** Each Playwright test sets its viewport when the browser context is created; never resize a live page. Test on Chrome and Edge. Interact through stable hooks (`VER-03`), never by guessing at generated layouts. A test that opens a second page brings each page to the front (`bringToFront`) before using it, as a person would: on a loaded machine a page left behind another answered each step in 40 s or more, against about 1 s in front ([issue 206](https://github.com/suredo/Tessera/issues/206)). |
| ENG-17 | **Traceability and stable IDs.** Tests name their requirement ID. CI lists every requirement and lesson, its milestone, proposed/implemented/verified status, evidence and remaining limits. Implementation and tests are read from code docs' `implements` and `tests` fields (`ENG-24`) and from test names. A test name is a coverage link, not proof of general correctness. Deferred work stays visible and excluded from current closure counts. IDs are never reused or renumbered; removed requirements stay retired. |
| ENG-20 | **No flaky tests.** A test that fails intermittently is quarantined at once, with an issue, and fixed before the milestone closes. Tests are never retried until they pass. (The POC had a flaky viewport test whose cause was first misdiagnosed.) |
| ENG-31 | **Targeted local checks; the full suite in CI.** Locally, before saying a change is done and when reviewing it, run the checks the change can affect, as set out in [targeted local checks](#targeted-local-checks). CI runs the full suite on every pull request and on `main` (`ENG-02`), nothing merges without it green (`ENG-09`), and closing a milestone is verified with the full suite. A full local run is allowed when it is justified, but it isn't the default. |

## Targeted local checks

How `ENG-31` chooses and reports local checks. It applies to the author before saying a change is done, and to the reviewing assistant ([cross-review](assistants.md#cross-review)). The commands are those in the Checks section of [`AGENTS.md`](../../AGENTS.md).

**Choose by what depends on the change, not by file names.** For a change to code, tests or configuration, run:

- the tests of the behaviour that changed;
- the tests of its consumers: the modules and packages that import or call it, and the browser tests that load it (for example, the runtime's scripts reach every browser test through the test host);
- the checks every change gets, since they are fast and cover the whole repository: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm secrets`, and the OKF check (`node scripts/okf-check.mjs`, with `--base` and `--pr-body` for a pull request, and `--merge-ready` once it is meant to be final);
- `pnpm contracts:schemas` after a change to `packages/contracts`, and `pnpm coverage` whenever a requirement or lesson ID is added, moved or claimed.

**Docs only.** For a change to documentation and nothing else (Markdown, including `AGENTS.md` and the GitHub templates), the OKF check as above and `pnpm format:check` are enough; the code checks can't be affected. Run `node --test scripts/okf-check.test.mjs` too if the checker changed, and `pnpm coverage` if IDs or claims changed.

**Broaden when the impact is wide or unclear.** Run the full suite, or every layer the change can reach, when it touches a shared contract (`packages/contracts` and its generated schemas), shared infrastructure (storage and migrations, the local server and its guard, the runtime's wrapper and preamble, the browser test host and other test support), dependencies or the lockfile, test or tool configuration (Vitest, Playwright, TypeScript, ESLint, Prettier), or when you can't tell what it reaches. When in doubt, broaden.

**A full local run** is allowed when it is justified, such as for a change that reaches most of the code, a failure whose cause isn't clear, or closing a milestone, but it is never the default.

**Sequence heavyweight local phases.** Run the full unit suite, browser tests (including browser rehearsals), and lint as separate phases on the same machine, including across worktrees and assistant sessions. Wait for one phase to finish before starting another. Vitest caps unit workers at four in `vitest.config.ts` to bound subprocess and filesystem contention. In [issue 188](https://github.com/suredo/Tessera/issues/188), unrestricted unit workers overlapping six browser workers and other checks exceeded unchanged subprocess-test timeouts. Preserve test inclusion, assertions, timeouts, provider/stage limits and the no-retry rule; record failures instead of rerunning unchanged orchestration. CI still runs every required check.

**Say why the checks are enough.** Each report names what the change can reach and why the checks run cover it.

**On a re-review, test what changed.** Test what changed since the head reviewed last (`git diff <reviewed head>..<new head>`) and what depends on it. Confirm each fix with its regression test, which fails without the fix. Earlier results for areas the new commits don't reach may be reused while they still apply: the same base, and nothing they depend on changed. Name the head they came from.

**Report exactly.** A done claim, a pull request description and a review name the exact head, each check run and its result, the earlier evidence reused and the head it came from, and the limits: what was not run, and why. Targeted checks are never described as a full-suite pass; say "all checks pass" only when all of them ran. The full suite's evidence is CI's run on the same head.

**The safety rules stand.** A failure is reported as it is, wherever it is, even outside the change's area. A flaky test is quarantined with an issue and never retried until it passes (`ENG-20`). No guard is weakened to make a check pass. Choosing fewer local checks never lowers what CI or a milestone requires: CI runs the full suite on every pull request and on `main` (`ENG-02`), and a milestone's closing report (`ENG-30`) rests on the full suite on its closing commit.
