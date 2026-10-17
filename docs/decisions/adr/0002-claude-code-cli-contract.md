---
type: Decision
title: "ADR 0002. The Claude Code CLI contract"
description: "What the M0 CLI spike found on Claude Code 2.1.296, and the rules it sets for passing schemas, flags, environment and sign-in to the CLI."
tags: [decisions, cli, contracts]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-17T03:24:15Z }
---
# ADR 0002. The Claude Code CLI contract

Proposed on 2026-10-17, from the M0 live spike ([issue 19](https://github.com/suredo/Tessera/issues/19), A33); **awaiting the owner's sign-off**. It answers A14's question (does Claude Code accept zod's JSON Schema?) and tests `CLI-03`'s locked flags. Code: the [CLI contract spike](../../code/evals/cli-contract-spike.md).

## Context

Before anything is built on the CLI, the spike checked three things on the installed version, **Claude Code 2.1.296**: that it accepts a zod-generated schema of realistic size through `--json-schema`, that the locked flags of a normal stage still work, and that structured output comes back intact. The plan was three calls on `claude-haiku-5-5` at low effort, with a hard cap of 3, rehearsed first against a fake `claude` ([ENG-07](../../practices/live-evaluation.md)). The calls: the intent contract (3.4k characters, a union), a nested generation-shaped schema, and a request that asks the model to read a file and run a command.

## What happened

Four runs, each approved by the owner. The first three stopped at their first call, before any model answered; each cause was fixed offline, with a replay test (`ENG-13`).

| Run | Result | Cause | Fix |
| --- | --- | --- | --- |
| 1 | The CLI refused the schema: `no schema with key or ref "https://json-schema.org/draft/2020-12/schema"` | The CLI checks `--json-schema` with a draft-07 validator | Contracts generate draft-07 |
| 2 | `success` with `is_error: true`, 0 tokens | The CLI wasn't signed in on its own; the desktop app's sign-in doesn't reach a CLI started with a clean environment | Free `claude auth status` check before a live run |
| 3 | The API refused the request: `400 tools.1.custom.input_schema.type: Field required` | The CLI sends the schema as a tool's input schema, which must be an object at the top level; the intent contract is a union | Every contract travels wrapped as `{ answer: <contract> }` |
| 4 | All three calls answered; every answer passed its contract | | |

Run 4, call by call (tokens: input including cache, of which read from cache; output, of which thinking):

| Call | Turns | Input | Output | Time | Notes |
| --- | --- | --- | --- | --- | --- |
| Intent | 2 | 2,576 (0) | 499 (241) | 3.6 s | |
| Nested schema | **4** | 11,077 (5,725) | 3,584 (301) | 14.1 s | More turns than `--max-turns 3` |
| No tools | 2 | 2,580 (1,916) | 666 (358) | 3.9 s | No tool attempted (`permission_denials` empty) |

**Cost:** 6 calls counted against the approved caps. Runs 1 to 3 used one each, and no model answered: run 2 reported 0 tokens, runs 1 and 3 reported no usage (unknown). Run 4: 16,233 input tokens (7,641 from cache), 4,749 output, 21.5 s of model time; the CLI's list-price estimate is about US$0.004, drawn from the plan's allowance.

## Decision

1. **JSON Schema draft-07.** Every schema that leaves the process is generated as draft-07 (`jsonSchemaOf` in `@tessera/contracts`). For today's contracts only `$schema` differs from draft 2020-12. A zod feature that only 2020-12 can express is avoided or checked first.
2. **Every contract travels wrapped in an object** for the CLI: `{ "answer": <contract> }`, with shared definitions at the top, and the adapter unwraps the answer before checking it. The contracts keep their discriminated unions (`CON-02`); this rule lives in the adapter only. The alternative, making every contract an object at the top level, would bend each contract around one provider.
3. **The CLI starts from an allowlisted environment,** not from the parent's environment with API keys removed. A parent Claude Code session (such as the desktop app) sets about 30 `CLAUDE_*` variables plus `ANTHROPIC_BASE_URL` and `CLAUDE_CODE_SIMPLE`, which change where and how the CLI calls the model. This extends `CLI-08`.
4. **Sign-in is checked for free first,** with `claude auth status`, before a live run and in the setup probe (`CLI-02`). A missing sign-in otherwise costs a call and reports `success` with `is_error`.
5. **Failure is read from `is_error`, never from `subtype`:** a failed call can say `subtype: "success"`. The envelope also carries `api_error_status` and `terminal_reason`, which the M2 error mapping (`CLI-05`) should use instead of reading the CLI's text.
6. **The locked flags stay as tested:** `--print --output-format json --json-schema --model --effort --tools "" --safe-mode --strict-mcp-config --no-session-persistence --permission-mode dontAsk --max-turns 3 --system-prompt`, then the request. All were accepted by 2.1.296. This is the tested version that `CLI-03` asks the adapter to enforce.
7. **`--max-turns` is not a hard bound.** The flag is missing from the help but accepted, and a call ran 4 turns under `--max-turns 3`, most likely because the CLI retried a structured answer. The M2 adapter keeps the flag, enforces the stage's time limit, and records `num_turns` in the ledger, so a runaway call is visible and bounded by time.

## Open questions

- **An extra tool in the request.** Run 3's error names `tools.1`, so the API request carried another tool even with `--tools ""`. The no-tools call attempted nothing, but which tool it is wasn't seen. The M2 adapter's tests should find out before a stage relies on "no tools".
- **User settings.** `--safe-mode` disables customizations but not user settings, which can set environment variables and permissions. Whether to add `--setting-sources` to the locked flags is decided with the M2 adapter.
- **The prompt as an argument** is limited to about 32,000 characters on Windows. The M2 adapter should send it on standard input.

## Consequences

- The contracts package generates draft-07, and its schema files changed by one line each (this pull request).
- On sign-off, the spec takes over decisions 3 to 5: `CLI-08` (allowlisted environment), `CLI-02` (free sign-in check) and `CLI-05` (read `is_error` and the error fields), and `CLI-03` records 2.1.296 as the tested version.
- The M2 Claude Code adapter starts from the spike's caller, with these rules and the open questions above as its first tests.
- The intent spike (#20) can now run on the same caller. Its first answer chose `new_tool` where `create` also fits, which the intent spike should look at.
