---
type: Decision
title: "ADR 0013. The Codex CLI contract"
description: "What the M3 Codex probe found on Codex CLI 0.166.0, and the rules it sets: Tessera's own Codex home folder and sign-in, a restricted catalog of models, contracts projected onto strict structured output, and the choice of program kept per data folder."
tags: [decisions, cli, codex, contracts]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-08T03:50:00Z }
---
# ADR 0013. The Codex CLI contract

From the M3 Codex adapter ([issue 266](https://github.com/suredo/Tessera/issues/266), A5), the second program behind `CLI-01`, after [ADR 0002](0002-claude-code-cli-contract.md) for Claude Code. Rules 1, 2 and 5 are the owner's choices of 2026-11-07; the rest follow from Codex's source and the probe, and wait for the owner's confirmation. Code: the [provider adapters](../../code/server/providers.md), the [setup check](../../code/server/setup.md) and the [Codex probe](../../code/evals/codex-probe.md).

## Context

Codex is a coding agent: by default it reads instruction files, offers file, shell, web and other tools, and gives the model a long instruction text of its own. Tessera needs a call with one stage's instructions, one request, one answer shape and no tools but research's web search (`CLI-03`). The adapter was built from Codex 0.166.0's help, its `debug` commands and its source at the tag `rust-v0.166.0`, then probed with the 4 calls the owner approved.

Two things no setting reached, found by Codex's review of the adapter: Codex reads a global `AGENTS.md` from its home folder in every call, and a model's metadata adds tools (`apply_patch` for every model; code-mode and clock tools for some) whatever is disabled.

## What happened

| Run | Calls | Result | Cause | Fix |
| --- | --- | --- | --- | --- |
| 1 | 1 | "The 'gpt-5.5' model is not supported when using Codex with a ChatGPT account." No tokens. | The only bundled model without code mode isn't offered to a ChatGPT plan | Routes name the plan's models; the wording maps to an unavailable model (`CLI-05`) |
| 2 | 1 | "Invalid schema for response_format 'codex_output_schema': 'schema.properties.answer.oneOf' is not permitted when strict is true." No tokens. | `--output-schema` is sent as strict structured output | Contracts are projected onto strict mode and turned back (rule 4) |
| 3 | 2 | Both passed, on gpt-6-luna at low effort: a create answer passed the creation contract after being turned back; asked to list its tools, read a file and run a command, the model named none and did neither, and no event was a tool. That is the model's report and the events' absence, not a view of the tool list the request carried. | | |

Run 3 used 836 input tokens, none cached, and 536 output tokens; the create call's 614 input tokens show Codex's own instructions were replaced. Before the probe, `codex debug prompt-input` with the locked settings showed that a home-folder `AGENTS.md` was the only thing besides the request that reached the model.

## Decision

1. **Tessera's own Codex home folder** (the owner's choice): one per account, outside every data folder (`%LOCALAPPDATA%\Tessera\codex-home` on Windows), so one sign-in serves development, evaluations and use. The person signs in there once with the command the setup check gives; a sign-in is never copied (`ENG-19`). The setup check and every call refuse while an `AGENTS.md` or `AGENTS.override.md` is in it, and report it rather than delete it.
2. **A restricted catalog of models** (the owner's choice, tried first): every call is given `model_catalog_json`, built by the setup check from the installed Codex's own `codex debug models --bundled`, with the file-editing tool, the metadata's extra tools and code mode taken out of every model. It follows the installed version, and a call refuses to start without it.
3. **Locked settings:** `codex exec --json` with the stage's model and effort; every feature that grants a tool disabled by name, the plan and input tools, sub-agents and cloud skills switched off; no project instruction files and none of Codex's own notes; the stage's system prompt as `model_instructions_file`, replacing Codex's; a read-only sandbox, no approvals, the person's config and rules ignored, ephemeral, no git check, a fresh empty folder; web search `disabled`, `live` for research only; the request on standard input.
4. **Contracts projected onto strict structured output:** the wrapped draft-07 schema (ADR 0002, rule 2) becomes one strict mode takes: any-of unions, every property required with optional ones nullable, open maps (the free-form data schema, defaults and entries) as a string holding JSON, tuples as lists, the core keywords only. The answer is turned back, guided by the original schema, and the host checks it against the contract itself, which stays the one definition (`P3`, `CON-01`). What the projection drops, that check still enforces.
5. **The choice of program** (the owner's choice): made on the status screen, kept in the data folder, Claude Code until one is made. The setup check checks both, and Tessera is ready when Node.js and the chosen one pass (`PLAT-03`). Each program has its own routes file.
6. **A ChatGPT sign-in only:** `codex login status` must say "Logged in using ChatGPT"; another sign-in, such as an API key, could be billed apart from the plan, so the setup check refuses it (`CLI-08`'s reason for the environment allowlist, applied to the sign-in).
7. **Codex's routes** (`CLI-09`): gpt-6-luna low where Claude Code uses Haiku, gpt-6.1-sol at the same effort where it uses Sonnet; gpt-6-astra, like Opus, only by explicit configuration.
8. **npm's install:** npm puts only `codex.cmd` on the PATH, which can't be started without a shell (L-45); Tessera starts npm's own launcher script beside it with Node.
9. **The tested version is 0.166.0;** an older Codex is refused (`CLI-02`).

## Open questions

- **Usage counting** (`CLI-04`): whether `input_tokens` includes cached input and `output_tokens` the reasoning tokens. Run 3 had neither, so it stays assumed (nothing is added) until a run has both.
- **Other failure shapes:** only an unavailable model and a refused schema have been seen; a sign-in or usage-limit failure still reads by its words, and anything unknown is an error, never a guess (`CLI-05`).
- **Removing code mode from models marked code-mode-only** worked for gpt-6-luna with no tools; whether answers on those models change without it is for M3's Codex runs to show.
- **The catalog follows Codex's internal format,** which a new version may change; the version gate stops an older Codex, and the setup check refuses a catalog it can't read, but a newer Codex is accepted untested.

## Consequences

- The spec takes over the decisions: `CLI-03` (Codex's locked settings and the restricted catalog), `CLI-08` (Tessera's Codex home folder and the ChatGPT sign-in), `CLI-09` (Codex's routes), `CON-01` (the projection for strict structured output).
- The probe's failures are lessons L-86 and L-87 in [Tessera issues](../../lessons/tessera-issues.md); npm's batch file is L-88.
- The [threat model](../../spec/threat-model.md) numbers the trusted CLIs' checks, Codex's included (`SEC-05`).
- Live acceptance runs still use Claude Code unless the owner approves a Codex run (A5).
