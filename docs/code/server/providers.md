---
type: Code Module
title: "Provider adapters"
description: "The one interface every model connection implements, and the scripted provider that answers from a script chosen by test configuration, never by the request's words."
resource: ../../../packages/server/src/providers/
implements: [CLI-01, CLI-04, CLI-05, ENG-11, OBS-02]
tests: [../../../packages/server/test/providers.test.ts, ../../../packages/contracts/test/provider.test.ts]
tags: [code, server, providers]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-17T00:30:48Z }
---

# Purpose

Puts every model connection behind one interface (`CLI-01`): a stage's prompt, schema, model, effort, tool policy, time limit and cancellation go in, and the checked value, its normalized usage (`CLI-04`) and the raw answer come out. So far the only provider is the scripted one, which answers from canned replies so that tests and dry runs (`OBS-02`) run the real code at no cost. The Claude Code adapter follows in M2, Codex in M3.

# Entry points

- `src/providers/provider.ts`: `Provider`, `StageSpec` and `StageResult`; `ProviderError`, a failed call with its kind (`CLI-05`) and what it cost; `UNKNOWN_USAGE`.
- `src/providers/scripted.ts`: `createScriptedProvider` answers from a script; `loadScript` reads one from a JSON fixture file; `ScriptError` means the script doesn't fit the calls made.
- The shapes that cross the boundary (stages, efforts, error kinds, usage and the script itself) are in `packages/contracts/src/provider.ts`.

# Invariants

- **The request text never chooses the reply** (`ENG-11`). A script is chosen by test configuration: the script given to the provider, or the fixture file it is loaded from. The provider never reads the prompt. (In the POC a test marker containing "engine" changed what the product did, L-09.)
- **Replies come in order, and each names its stage.** A call for another stage than the next reply's, or past the end of the script, is a `ScriptError`, so a pipeline that calls stages in an unexpected order fails its test instead of getting the wrong answer. A mismatched call uses up nothing.
- **The host checks every answer**, whatever the provider promises. A canned value goes through the stage's zod schema like a model's would, and one that doesn't fit is a `schema` error, so a script can test a bad answer.
- **A scripted call costs nothing.** A reply without `usage` reports 0 for every field. A reply may give its own usage, to test the ledger.
- **Unknown usage is null, never 0** (`CLI-04`). `ProviderError` carries what a failed call cost, with `UNKNOWN_USAGE` when nothing is known.
- **`live` says whether a call can cost something.** The scripted provider is never live, which is how the evaluation harness tells a dry run from a live one.

# Depends on / used by

Depends on `@tessera/contracts` and zod. The evaluation harness (`evals/`) wraps a provider with its budget guard and ledger. The pipeline (M2) calls stages through it, and the scripted end-to-end tests (`TEST-03`) will choose a script per test through the server's configuration.

# Pitfalls

- **`ScriptError` is not a `ProviderError`.** It means the test or the pipeline is wrong, so nothing should handle it like a model failure.
- **A cancelled call doesn't use a reply.** The scripted provider only checks the signal before it answers, since its answers are immediate. Cancelling a running call is the real adapters' job (`CLI-06`).
- **The time limit is not enforced here.** Canned replies are immediate; the real adapters stop a call at its limit.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `index.ts`: `ProviderError`, `UNKNOWN_USAGE`, `Provider` (type), `StageResult` (type), `StageSpec` (type), `createScriptedProvider`, `loadScript`, `ScriptError`, `ScriptedProvider` (type)
- `provider.ts`: `StageSpec` (type), `StageResult` (type), `Provider` (type), `UNKNOWN_USAGE`, `ProviderError`
- `scripted.ts`: `ScriptError`, `ScriptedProvider` (type), `createScriptedProvider`, `loadScript`
