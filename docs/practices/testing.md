---
type: Practice
title: "Testing"
description: "The five-layer test pyramid and test rules (ENG-11, ENG-13, ENG-14, ENG-17, ENG-20, ENG-31)."
tags: [practices, testing]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-05T07:04:58Z }
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

How `ENG-31` chooses and reports local checks. It applies to the author before saying a change is done, and to the reviewing assistant ([cross-review](assistants.md#cross-review)), who runs only the light ones, as [heavy suites once per pull request](#targeted-local-checks) says. The commands are those in the Checks section of [`AGENTS.md`](../../AGENTS.md).

**Choose by what depends on the change, not by file names.** For a change to code, tests or configuration, run:

- the tests of the behaviour that changed;
- the tests of its consumers: the modules and packages that import or call it, and the browser specs that exercise the changed behaviour;
- the checks every change gets, since they are fast and cover the whole repository: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm secrets`, and the OKF check (`node scripts/okf-check.mjs`, with `--base` and `--pr-body` for a pull request, and `--merge-ready` once it is meant to be final);
- `pnpm contracts:schemas` after a change to `packages/contracts`, and `pnpm coverage` whenever a requirement or lesson ID is added, moved or claimed.

**Docs only.** For a change to documentation and nothing else (Markdown, including `AGENTS.md` and the GitHub templates), the OKF check as above and `pnpm format:check` are enough; the code checks can't be affected. Run `node --test scripts/okf-check.test.mjs` too if the checker changed, and `pnpm coverage` if IDs or claims changed.

**Browser tests locally: only the affected specs, in one browser and one width.** Run them with `pnpm e2e:local <spec files>`: Chrome at 1280 px, with 2 workers. Add Edge or the 320 px width (`pnpm e2e --project=<name> <spec files>`) only when the change depends on them, such as layout at narrow widths or a fix for one browser. Locally only failed tests keep a video; CI records every test. Never run the whole browser suite to cover a change's reach: when a change reaches every browser test (the runtime's wrapper and preamble, the browser test host and other test support, the Playwright configuration), run its own specs and one or two that depend most on it, and leave the rest to CI.

**Broaden the other layers when the impact is wide or unclear.** Run the full unit suite, or every layer the change can reach other than the browser tests, when it touches a shared contract (`packages/contracts` and its generated schemas), shared infrastructure (storage and migrations, the local server and its guard, the runtime's wrapper and preamble), dependencies or the lockfile, test or tool configuration (Vitest, TypeScript, ESLint, Prettier), or when you can't tell what it reaches. When in doubt, broaden.

**A full local run** is allowed when it is justified, such as a failure whose cause CI's trace and video can't explain, or closing a milestone, but it is never the default. Runs under added load or with `--repeat-each`, to reproduce a flaky test, happen only when the owner asks or CI's evidence can't explain the failure, and use at most 2 workers.

**Heavy suites once per pull request, by the author.** The full unit suite, `pnpm typecheck`, the whole of `pnpm lint`, `pnpm build` and browser runs are heavy on the local machine, which has 16 GB shared with the owner's apps. The author runs each one the change can affect at most once per head. The reviewer runs none of them: CI's run on the same head is their evidence. Locally the reviewer runs only light checks: the OKF check, `git diff --check`, and single test files of the changed modules, to confirm a suspected defect or that a fix's regression test fails without the fix. A reviewer who needs a heavy suite says why in the review, and runs it alone.

**Sequence heavyweight local phases.** Run the full unit suite, browser tests (including browser rehearsals), and lint as separate phases on the same machine, including across worktrees and assistant sessions. Wait for one phase to finish before starting another. Vitest runs two unit workers locally and four on CI (`vitest.config.ts`), to bound subprocess and filesystem contention and memory. In [issue 188](https://github.com/suredo/Tessera/issues/188), unrestricted unit workers overlapping six browser workers and other checks exceeded unchanged subprocess-test timeouts. Preserve test inclusion, assertions, timeouts, provider/stage limits and the no-retry rule; record failures instead of rerunning unchanged orchestration. CI still runs every required check.

**Say why the checks are enough.** Each report names what the change can reach and why the checks run cover it.

**On a re-review, test what changed.** Test what changed since the head reviewed last (`git diff <reviewed head>..<new head>`) and what depends on it. Confirm each fix with its regression test, which fails without the fix. Earlier results for areas the new commits don't reach may be reused while they still apply: the same base, and nothing they depend on changed. Name the head they came from.

**Report exactly.** A done claim, a pull request description and a review name the exact head, each check run and its result, the earlier evidence reused and the head it came from, and the limits: what was not run, and why. Targeted checks are never described as a full-suite pass; say "all checks pass" only when all of them ran. The full suite's evidence is CI's run on the same head.

**The safety rules stand.** A failure is reported as it is, wherever it is, even outside the change's area. A flaky test is quarantined with an issue and never retried until it passes (`ENG-20`). No guard is weakened to make a check pass. Choosing fewer local checks never lowers what CI or a milestone requires: CI runs the full suite on every pull request and on `main` (`ENG-02`), and a milestone's closing report (`ENG-30`) rests on the full suite on its closing commit.
