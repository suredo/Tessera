---
type: Code Module
title: "CLI contract spike"
description: "The M0 live spike that checks Claude Code accepts a zod-generated schema, keeps working with the locked flags, and returns structured output intact; with a fake claude for its free dry run."
resource: ../../../evals/spikes/cli-contract/
implements: [CON-01, CLI-03, CLI-04, CLI-05, CLI-08, ENG-07, ENG-13, ENG-16]
tests: [../../../evals/test/cli-contract-spike.test.ts]
tags: [code, evals, cli, spike]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-26T13:18:53Z }
---

# Purpose

Tests the riskiest assumptions about Claude Code before anything is built on them (A33, issue #19): that it accepts a zod-generated JSON Schema through `--json-schema` (`CON-01`, A14), that the locked flags of a normal stage still work on the installed version (`CLI-03`), and that structured output comes back intact. It runs three calls through the [evaluation harness](harness.md), so the cap, ledger and dry run apply. The results become an ADR. This is spike code: the Claude Code adapter (M2) replaces its caller.

# Entry points

- `run.ts`: the script. `PLAN` is the approved run (cap, model, effort, time limit); `runSpike` makes the planned calls and writes `report.json`; `inspectEnvelope` checks what a call shows beyond its schema (turns, attempted tools, usage); `fakeProvider` is the dry run's provider. Run it with `node evals/spikes/cli-contract/run.ts --dry-run`, or `--live --approved-cap 3` once the owner has approved the budget.
- `claude-cli.ts`: what the spikes need beyond the product's [Claude Code adapter](../server/providers.md), which their calls now go through (#139): `fakeClaudeProvider` (the adapter on `FAKE_CLAUDE`, the fake program in the server's tests), `liveClaudeProvider` (after the adapter's free checks), `runModeFrom` (the `--dry-run` or `--live --approved-cap` arguments) and `runFolder`. The locked flags, environment and usage reading now live in the adapter.
- `artifact-draft.ts`: `artifactDraftSchema`, a spike-only schema shaped like a generation answer.
- `prompts/`: the system prompt and the three planned requests (`ENG-16`).

# Invariants

- **Live only with approval.** `--live` refuses to start without `--approved-cap` equal to `PLAN.callCap`, and the harness refuses every call past it. Changing `PLAN` needs a new approval (`ENG-07`).
- **The dry run is the exact run.** It uses the same caller, arguments, environment and checks, and starts a real process; only the program is the fake, which never reaches a model and is chosen by configuration, not by the prompt (`ENG-11`). The fake refuses a schema the real CLI refuses: it checks `--json-schema` with a default (draft-07) ajv, as Claude Code 2.1.296 does.
- **The schema is the contract's own,** from `jsonSchemaOf` in `@tessera/contracts`, in draft-07, wrapped by `wrapSchema` as `{ answer: <contract> }`. The CLI hands it to the API as a tool's input schema, which must be an object at the top level, while a contract may be a union (`CON-02`). Shared definitions move to the top so references still resolve, and the caller unwraps the answer before checking it. The fake refuses a schema that isn't an object, as the API did.
- **Locked flags** (`CLI-03`): the spikes' calls go through the product adapter, so they get its flags, as the [provider adapters](../server/providers.md) doc lists them: the request on standard input and the system prompt from a file. In M0 the spike passed both as arguments (`--system-prompt <prompt>`, then the request), which is what ADR 0002 tested. No stage gets file tools.
- **An allowlisted environment** (`CLI-08`): only the variables the CLI needs to start and find its sign-in. API keys would switch billing to the API (L-52), and a parent Claude Code session sets variables such as `ANTHROPIC_BASE_URL` and `CLAUDE_CODE_SIMPLE` that change where and how the CLI calls the model.
- **A fresh, empty working folder** outside the repository for each call, removed afterwards (`CLI-08`).
- **Usage counts cache writes and reads as input** (`CLI-04`, L-47); a missing part makes the total unknown, never 0.
- **The first call failing stops the run** (`ENG-07`), whether it throws or answers but fails a check: later calls would spend budget with nothing to build on.

# Depends on / used by

Depends on the [evaluation harness](harness.md), the platform helpers' `runProcess` and `findExecutable` ([platform](../server/platform.md)), the intent contract and zod. Run once, for #19; its caller also serves the [intent spike](intent-spike.md) (#20). The M2 adapter takes over its findings.

# Pitfalls

- **The first live run, on 2026-10-17, stopped at its first call:** Claude Code 2.1.296 refused the draft 2020-12 schema before calling a model. The contracts now generate draft-07, and a replay test keeps the fake refusing what the CLI refused (`ENG-13`). The dry run had passed because the fake didn't check schemas then.
- **The second live run stopped at its first call too:** the CLI wasn't signed in on its own. A parent Claude Code session (such as the desktop app) signs its sessions in, but the allowlisted environment rightly cuts the spike off from that. The result said `success` with `is_error` true and 0 tokens. A live run now checks `claude auth status` first, which costs no call, and the ledger keeps the CLI's own words for a failure.
- **The third live run stopped at its first call as well:** the API refused the intent schema with `400 tools.1.custom.input_schema.type: Field required`, since a union has no top-level `type`. Every schema is now wrapped in an object. The error names `tools.1`, so the request carried another tool even with `--tools ""`; the no-tools check looks at that.
- **The fourth live run answered all three calls,** with every answer passing its contract. One check flags a call that ran 4 turns under `--max-turns 3`: the flag is not a hard bound. Results and the rules they set: [ADR 0002](../../decisions/adr/0002-claude-code-cli-contract.md).
- **`--max-turns` is not in the help of Claude Code 2.1.296.** The POC relied on it. If the CLI rejects it, the first call fails before reaching a model and the run stops; the ADR then says how `CLI-03`'s turn limit is kept.
- **The prompt travels as a command-line argument,** which Windows limits to about 32,000 characters. The spike's prompts are small; the M2 adapter should send the prompt on standard input.
- **The error mapping reads the CLI's text,** which can change between versions; anything it doesn't recognize is recorded as a crash, not guessed.
- **`--safe-mode` doesn't skip user settings.** Settings can still set environment variables and permissions; whether `--setting-sources` should also be locked is a question for the ADR.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `artifact-draft.ts`: `artifactDraftSchema`
- `claude-cli.ts`: `FAKE_CLAUDE`, `fakeClaudeProvider`, `liveClaudeProvider`, `runModeFrom`, `runFolder`
- `run.ts`: `PLAN`, `plannedCalls`, `CallReport` (type), `SpikeReport` (type), `inspectEnvelope`, `runSpike`, `fakeProvider`
