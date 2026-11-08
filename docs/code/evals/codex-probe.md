---
type: Code Module
title: "Codex probe"
description: "The M3 live probe of the Codex adapter against the real CLI: whether strict structured output takes the projected contract, whether the answer comes back intact, and whether a call is offered any tool; with the fake codex for its free dry run."
resource: ../../../evals/spikes/codex-probe/
implements: [CLI-01, CLI-03, CLI-04, CLI-05, ENG-07, TCL-07]
tests: [../../../evals/test/codex-probe.test.ts]
tags: [code, evals, cli, codex, spike]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-08T03:30:00Z }
---

# Purpose

The probe the [M3 roadmap](../../roadmap/m3-verification-and-codex.md) names for the [Codex adapter](../server/providers.md) (#266, A5): it runs a few stages through the product adapter against the real Codex CLI, through the [evaluation harness](harness.md), so the cap, ledger and dry run apply. It settles what the adapter's fake-based contract tests can't: whether the model service takes the schema, whether the answer comes back as the contract has it, and whether a real call is offered any tool. This is spike code: the adapter it calls is the product's.

# Entry points

- `run.ts`: the script. `PLAN` is the approved run (cap, model, effort, time limit); `runProbe` makes the planned calls, keeps each call's raw events and writes `report.json`; `inspectEvents` checks what a call's events show beyond its schema (an event item that is a tool, a failure, missing usage); `fakeProvider` is the dry run's provider, the adapter on `FAKE_CODEX`, the fake program in the server's tests. `withBundledCodex` puts npm's bundled `codex.exe` first on the PATH, as an npm install puts only `codex.cmd` there, and `machineCodexHome` is Tessera's Codex home folder on this machine. Run it with `node evals/spikes/codex-probe/run.ts --dry-run`, or `--live --approved-cap 2`.
- `prompts/`: the system prompt (the CLI contract spike's) and the planned calls: the real create contract, and a request that asks the model to name its tools and to read a file and run a command (`ENG-16`).
- `dry-run-replies.json`: the fake's answers, a rehearsed create answer written as Codex writes it (open maps as JSON text, the absent optional field as null) and an empty tool list.

# Invariants

- **Live only with approval.** `--live` refuses to start without `--approved-cap` equal to `PLAN.callCap`, and the harness refuses every call past it. The owner approved 4 Codex calls on 2026-11-07; the runs below spent them. Changing `PLAN` needs a new approval (`ENG-07`).
- **The product adapter makes every call,** after its free checks: Codex found, at least the tested version, Tessera's home folder with no instructions file, a ChatGPT sign-in, and the restricted catalog written. Anything wrong stops the run before a call is counted (L-71).
- **The first call failing stops the run** (`ENG-07`).
- **A tool named is a failure, even unused:** the no-tools check fails when the model lists any tool, as well as when an event is one (`CLI-03`).
- **A schema failure says which parts of the contract the turned-back answer missed,** so a fault of the projection can be told from the model's.

# Depends on / used by

Depends on the [evaluation harness](harness.md), the [Codex adapter](../server/providers.md) and its strict-schema projection, the creation contract ([contracts](../contracts/package.md)) and the CLI contract spike's `runModeFrom` and `runFolder` ([CLI contract spike](cli-contract-spike.md)). Used only by hand, for #266.

# Pitfalls

- **The first live run, on 2026-11-07, stopped at its first call:** "The 'gpt-5.5' model is not supported when using Codex with a ChatGPT account." It was the one bundled model without code mode; the account lists only the gpt-6 and gpt-5.6 families, all marked code mode only, which the adapter's catalog strips. The adapter didn't recognise the wording, so it reported an unexpected failure; "not supported" now maps to an unavailable model (`CLI-05`).
- **The second live run stopped at its first call too,** on gpt-6-luna: "Invalid schema for response_format 'codex_output_schema': 'schema.properties.answer.oneOf' is not permitted when strict is true." Codex sends `--output-schema` as strict structured output, which refuses `oneOf`, open maps, optional properties and most validation keywords. The adapter now projects each contract onto strict mode and turns the answer back before the host checks it against the contract itself (`toStrictSchema`, `restoreAnswer`). Neither refused call reached the model: no tokens.
- **The third live run answered both calls,** on gpt-6-luna at low effort: the create answer passed the real creation contract after being turned back, with its three open maps written as JSON text and the absent optional field as null; the model said it had no tools, read nothing and ran nothing, and no event was a tool. 836 input tokens, none cached, and 536 output tokens; the create call took 614 input tokens, so Codex's own long instructions were replaced. With no cached input and no reasoning tokens at that effort, how usage counts them stays open (`CLI-04`).
- **npm's install puts only `codex.cmd` on the PATH,** which the adapter refuses (L-45); the probe starts the bundled `codex.exe` instead. Starting npm's launcher is #266's part 2.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `run.ts`: `PLAN`, `plannedCalls`, `CallReport` (type), `ProbeReport` (type), `inspectEvents`, `runProbe`, `FAKE_CODEX`, `fakeProvider`, `withBundledCodex`, `machineCodexHome`
