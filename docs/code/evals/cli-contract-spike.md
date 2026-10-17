---
type: Code Module
title: "CLI contract spike"
description: "The M0 live spike that checks Claude Code accepts a zod-generated schema, keeps working with the locked flags, and returns structured output intact; with a fake claude for its free dry run."
resource: ../../../evals/spikes/cli-contract/
implements: [CON-01, CLI-03, CLI-04, CLI-05, CLI-08, ENG-07, ENG-16]
tests: [../../../evals/test/cli-contract-spike.test.ts]
tags: [code, evals, cli, spike]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-17T02:39:49Z }
---

# Purpose

Tests the riskiest assumptions about Claude Code before anything is built on them (A33, issue #19): that it accepts a zod-generated JSON Schema through `--json-schema` (`CON-01`, A14), that the locked flags of a normal stage still work on the installed version (`CLI-03`), and that structured output comes back intact. It runs three calls through the [evaluation harness](harness.md), so the cap, ledger and dry run apply. The results become an ADR. This is spike code: the Claude Code adapter (M2) replaces its caller.

# Entry points

- `run.ts`: the script. `PLAN` is the approved run (cap, model, effort, time limit); `runSpike` makes the planned calls and writes `report.json`; `inspectEnvelope` checks what a call shows beyond its schema (turns, attempted tools, usage); `fakeProvider` is the dry run's provider. Run it with `node evals/spikes/cli-contract/run.ts --dry-run`, or `--live --approved-cap 3` once the owner has approved the budget.
- `claude-cli.ts`: `buildArgs` (the locked flags), `cleanEnvironment`, `toUsage`, `createClaudeCliProvider` and the result envelope it reads, `resultEnvelopeSchema`.
- `fake-claude.ts`: a stand-in for the claude program that records the arguments, working folder and environment it was given, checks `--json-schema` as the real one does, and prints canned result envelopes from `dry-run-replies.json`.
- `artifact-draft.ts`: `artifactDraftSchema`, a spike-only schema shaped like a generation answer.
- `prompts/`: the system prompt and the three planned requests (`ENG-16`).

# Invariants

- **Live only with approval.** `--live` refuses to start without `--approved-cap` equal to `PLAN.callCap`, and the harness refuses every call past it. Changing `PLAN` needs a new approval (`ENG-07`).
- **The dry run is the exact run.** It uses the same caller, arguments, environment and checks, and starts a real process; only the program is the fake, which never reaches a model and is chosen by configuration, not by the prompt (`ENG-11`). The fake refuses a schema the real CLI refuses: it checks `--json-schema` with a default (draft-07) ajv, as Claude Code 2.1.296 does.
- **The schema is the contract's own,** from `jsonSchemaOf` in `@tessera/contracts`, in draft-07.
- **Locked flags** (`CLI-03`): `--print --output-format json --json-schema <schema> --model --effort --tools "" --safe-mode --strict-mcp-config --no-session-persistence --permission-mode dontAsk --max-turns 3 --system-prompt <prompt>`, then the request. No stage gets file tools.
- **An allowlisted environment** (`CLI-08`): only the variables the CLI needs to start and find its sign-in. API keys would switch billing to the API (L-52), and a parent Claude Code session sets variables such as `ANTHROPIC_BASE_URL` and `CLAUDE_CODE_SIMPLE` that change where and how the CLI calls the model.
- **A fresh, empty working folder** outside the repository for each call, removed afterwards (`CLI-08`).
- **Usage counts cache writes and reads as input** (`CLI-04`, L-47); a missing part makes the total unknown, never 0.
- **The first call failing stops the run** (`ENG-07`): later calls would spend budget with nothing to build on.

# Depends on / used by

Depends on the [evaluation harness](harness.md), the platform helpers' `runProcess` and `findExecutable` ([platform](../server/platform.md)), the intent contract and zod. Used once, for #19; the M2 adapter takes over its findings.

# Pitfalls

- **The first live run, on 2026-10-17, stopped at its first call:** Claude Code 2.1.296 refused the draft 2020-12 schema before calling a model. The contracts now generate draft-07, and a replay test keeps the fake refusing what the CLI refused (`ENG-13`). The dry run had passed because the fake didn't check schemas then.
- **`--max-turns` is not in the help of Claude Code 2.1.296.** The POC relied on it. If the CLI rejects it, the first call fails before reaching a model and the run stops; the ADR then says how `CLI-03`'s turn limit is kept.
- **The prompt travels as a command-line argument,** which Windows limits to about 32,000 characters. The spike's prompts are small; the M2 adapter should send the prompt on standard input.
- **The error mapping reads the CLI's text,** which can change between versions; anything it doesn't recognize is recorded as a crash, not guessed.
- **`--safe-mode` doesn't skip user settings.** Settings can still set environment variables and permissions; whether `--setting-sources` should also be locked is a question for the ADR.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `artifact-draft.ts`: `artifactDraftSchema`
- `claude-cli.ts`: `MAX_TURNS`, `buildArgs`, `cleanEnvironment`, `resultEnvelopeSchema`, `ResultEnvelope` (type), `toUsage`, `ClaudeCliOptions` (type), `createClaudeCliProvider`
- `run.ts`: `PLAN`, `plannedCalls`, `CallReport` (type), `SpikeReport` (type), `inspectEnvelope`, `runSpike`, `fakeProvider`
