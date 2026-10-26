---
type: Code Module
title: "Provider adapters"
description: "The one interface every model connection implements: the Claude Code adapter, with locked flags, a clean environment, normalized usage and plain errors, and the scripted provider that answers from a script chosen by test configuration."
resource: ../../../packages/server/src/providers/
implements: [CLI-01, CLI-02, CLI-03, CLI-04, CLI-05, CLI-08, TEST-02, ENG-11, OBS-02]
tests: [../../../packages/server/test/claude.test.ts, ../../../packages/server/test/providers.test.ts, ../../../packages/contracts/test/provider.test.ts]
tags: [code, server, providers]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-26T12:51:02Z }
---
# Purpose

Puts every model connection behind one interface (`CLI-01`): a stage's system prompt, request, schema, model, effort, tool policy, time limit and cancellation go in, and the checked value, its normalized usage (`CLI-04`) and the raw answer come out. Two providers implement it. The Claude Code adapter (#139) is the product's one way to call a model; it took over the M0 spike's caller and the findings of [ADR 0002](../../decisions/adr/0002-claude-code-cli-contract.md). The scripted provider answers from canned replies, so tests and dry runs (`OBS-02`) run the real code at no cost. Codex follows in M3 behind the same interface.

# Entry points

- `src/providers/provider.ts`: `Provider`, `StageSpec` and `StageResult`; `ProviderError`, a failed call with its kind (`CLI-05`) and what it cost; `UNKNOWN_USAGE`.
- `src/providers/claude.ts`: the Claude Code adapter.
  - `createClaudeProvider` runs a stage through the claude program given (`ClaudeOptions`). `findClaude` finds the real one and checks it without spending a call: on the PATH as a program, at least `TESTED_CLI_VERSION`, and signed in (`CLI-02`). It answers a `ClaudeStatus` with a plain message for each problem, for the setup check (`PLAT-03`).
  - `buildArgs` gives the locked flags (`CLI-03`), `MAX_TURNS` the CLI's turn limit, and `wrapSchema` wraps a contract's JSON Schema as `{ answer: … }` (`ANSWER_KEY`).
  - `cleanEnvironment` is the allowlisted environment (`CLI-08`); `resultEnvelopeSchema` reads the CLI's result (`ResultEnvelope`); `toUsage` normalizes usage (`CLI-04`).
  - `failureKind` reads which failure a result is, and `FAILURE_MESSAGES` is what the person reads for each (`CLI-05`); `versionOf` and `atLeast` read and compare versions.
- `src/providers/scripted.ts`: `createScriptedProvider` answers from a script; `loadScript` reads one from a JSON fixture file; `ScriptError` means the script doesn't fit the calls made.
- The shapes that cross the boundary (stages, efforts, error kinds, usage and the script itself) are in `packages/contracts/src/provider.ts`.
- `test/support/fake-claude.ts`: a stand-in for the claude program. It records the arguments, working folder and environment it got, checks `--json-schema` as the real one does, and prints canned result envelopes by call order; it can also wait, print raw text or exit with an error, for the contract tests (`TEST-02`). The M0 spikes' dry runs use it too.

# Invariants

- **The locked flags, exactly** (`CLI-03`, ADR 0002): `--print --output-format json --json-schema <wrapped schema> --model --effort --tools "" --safe-mode --strict-mcp-config --no-session-persistence --permission-mode dontAsk --max-turns 3 --system-prompt <the stage's system prompt>`, then the request. Only research gets web tools; no stage gets file tools. A contract test checks the whole argument list.
- **The schema travels wrapped** as `{ answer: <contract> }`, in draft-07, with shared definitions moved to the top, because the API takes it as a tool's input schema, which must be an object at the top level (L-72). The answer is unwrapped before it is checked.
- **A clean start for every call** (`CLI-08`): an allowlisted environment, so API keys never switch billing to the API and a parent Claude Code session's variables never redirect the call; and a new, empty working folder outside the repository, removed afterwards.
- **The host checks every answer**, whatever the provider promises (`CLI-01`). An answer that doesn't fit the stage's contract is a `schema` failure, with what the call cost.
- **A failure is read from `is_error`, never `subtype`**, which can say `success` for a failed call (L-71). Each known failure (sign-in, usage limit, unavailable model, unsupported effort, schema, turn limit, time limit, cancelled) is a `ProviderError` whose message starts with the plain sentence for the person and keeps the CLI's own words after it, for the ledger (`CLI-05`, `GEN-10`). A failure the adapter can't name, or output that isn't a result, is a plain `Error`: a crash to look into, never a guess. Provider errors stop the request; they are not repaired.
- **Every call is bounded.** `--max-turns` is not a hard bound (L-73), so each call also stops at its time limit (`time_limit`); a cancel stops the running CLI at once (`cancelled`), and a call cancelled before it starts never starts.
- **Unknown usage is null, never 0** (`CLI-04`). Input counts uncached input, cache writes and cache reads; cached input is also given apart; a missing part makes the total unknown.
- **No call is spent to find out the CLI isn't usable** (`CLI-02`). `findClaude` reads `claude --version` and `claude auth status`, which reach no model. On Windows it looks for `claude.exe` first, since npm's `claude.cmd`, which can't start without a shell (L-45), could come earlier on the PATH.
- **Older than tested is refused; newer is used and recorded.** ADR 0002 tested the flags on 2.1.296. A newer CLI is accepted, its version is recorded with each run, and the probe, a tiny real call, checks the flags still work on it.
- **The request text never chooses a scripted reply** (`ENG-11`). A script is chosen by test configuration: the script given to the provider, or the fixture file it is loaded from. The provider never reads the prompt. (In the POC a test marker containing "engine" changed what the product did, L-09.) The fake claude program answers by call order for the same reason.
- **Scripted replies come in order, and each names its stage.** A call for another stage than the next reply's, or past the end of the script, is a `ScriptError`, so a pipeline that calls stages in an unexpected order fails its test instead of getting the wrong answer.
- **`live` says whether a call can cost something.** Only the adapter on the real claude program is live, which is how the evaluation harness tells a dry run from a live one.

# Depends on / used by

Depends on `@tessera/contracts`, zod, and the [platform](platform.md) helpers `runProcess` and `findExecutable`. The evaluation harness (`evals/`) wraps a provider with its budget guard and ledger, and the M0 spikes call the adapter through it. The pipeline (M2) calls stages through it, model routing (#140) chooses each stage's model and effort, and the setup check (#142) shows `findClaude`'s answer.

# Pitfalls

- **`ScriptError` is not a `ProviderError`.** It means the test or the pipeline is wrong, so nothing should handle it like a model failure.
- **The scripted provider doesn't enforce time limits or stop a running call.** Its answers are immediate; the adapter does both.
- **Failure texts are matched by words.** The CLI gives no stable error codes, so `failureKind` reads its text. A new wording falls through to a plain `Error`, never a wrong kind; add its words, with a test, when one is seen.
- **The tested version is a floor, not a pin.** A new CLI release can change a flag's meaning; the probe on each new version is the check, and the version in the ledger traces a change to it.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `claude.ts`: `TESTED_CLI_VERSION`, `MAX_TURNS`, `ANSWER_KEY`, `wrapSchema`, `buildArgs`, `cleanEnvironment`, `resultEnvelopeSchema`, `ResultEnvelope` (type), `toUsage`, `FAILURE_MESSAGES`, `failureKind`, `ClaudeOptions` (type), `createClaudeProvider`, `versionOf`, `atLeast`, `ClaudeStatus` (type), `findClaude`
- `index.ts`: `ProviderError`, `UNKNOWN_USAGE`, `Provider` (type), `StageResult` (type), `StageSpec` (type), `createScriptedProvider`, `loadScript`, `ScriptError`, `ScriptedProvider` (type), `ANSWER_KEY`, `atLeast`, `buildArgs`, `cleanEnvironment`, `createClaudeProvider`, `FAILURE_MESSAGES`, `failureKind`, `findClaude`, `MAX_TURNS`, `resultEnvelopeSchema`, `TESTED_CLI_VERSION`, `toUsage`, `versionOf`, `wrapSchema`, `ClaudeOptions` (type), `ClaudeStatus` (type), `ResultEnvelope` (type)
- `provider.ts`: `StageSpec` (type), `StageResult` (type), `Provider` (type), `UNKNOWN_USAGE`, `ProviderError`
- `scripted.ts`: `ScriptError`, `ScriptedProvider` (type), `createScriptedProvider`, `loadScript`
