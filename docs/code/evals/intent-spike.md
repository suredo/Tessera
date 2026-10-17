---
type: Code Module
title: "Intent spike"
description: "The M0 live spike that measures how often a draft intent stage misroutes the POC's failure cases, in several languages, with its request set, draft prompt and report."
resource: ../../../evals/spikes/intent/
implements: [GEN-01, GEN-02, GEN-15, GEN-18, ENG-07, ENG-11, ENG-16]
tests: [../../../evals/test/intent-spike.test.ts]
tags: [code, evals, intent, spike]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-17T05:13:53Z }
---

# Purpose

Measures, before the core is built on it, how often a draft intent stage (`GEN-01`) sends a request to the wrong place (A33, issue #20). The request set comes from the POC's routing failures: style wording (L-16, L-20), behavior statements (L-17), unrelated requests (L-18), mixed requests (L-19) and asking for a saved tool (L-67, `GEN-18`), plus create, data, clarify and unsupported requests, about a third of them not in English (`GEN-15`). It reports the misroute rate per category and lists every misroute; categories with a high rate get a design note before M2. Spike code: the production intent stage is built in M2.

# Entry points

- `run.ts`: the script. `PLAN` is the approved run (one call per request, no retries); `runIntentSpike` makes the calls through the [evaluation harness](harness.md) and writes `report.json` and `report.md`; `score` decides a misroute; `renderPrompt` builds each request's message; `renderReport` writes the Markdown report; `expectedReplies` and `fakeProvider` make the dry run. Run it with `node evals/spikes/intent/run.ts --dry-run`, or `--live --approved-cap 31` once the owner has approved the request set and the budget.
- `requests.json`: the request set, each with its category, source lesson or requirement, context, language and expected answer. `contexts.json`: what each request sees: the tool open now, if any, and the saved tools.
- `prompts/system.md`: the draft intent prompt, with each kind defined and examples of the POC's failure families (`ENG-16`). `prompts/request.md`: the message for one request.
- The caller, the fake claude and the live checks are the [CLI contract spike](cli-contract-spike.md)'s.

# Invariants

- **A misroute is a wrong kind, or the wrong saved tool.** Differences in the flags (`lookOnly`, `behaviorChange`, `targetsCurrentTool`, whether an interface or data part was found) and in the language are listed apart. A language is checked by its primary subtag, so `pt-BR` passes for `pt`.
- **No keyword gating** (`GEN-02`). Every request gets the same system prompt; only the message with the context and the request changes. A test checks that every call in the dry run got the same system prompt.
- **The prompt's examples are not the test requests,** so the run measures the prompt, not recall. A test checks that no request appears in the system prompt.
- **The dry run is the exact run,** against the fake claude, which answers each request with its expected answer by call order, never by the request's words (`ENG-11`).
- **Stop rules** (`ENG-07`): the run stops if the first call fails, if the harness refuses a call, or after two failed calls in a row. A misroute is a result, not a failure.

# Depends on / used by

Depends on the [CLI contract spike](cli-contract-spike.md)'s caller, the [evaluation harness](harness.md), the intent contract in `@tessera/contracts` and zod. Run once, for #20; its findings feed the design notes before M2 and the production intent stage.

# Pitfalls

- **The expected answers are judgment calls,** reviewed by the owner before the run. A "misroute" on a request with two reasonable answers says more about the request than the prompt; the report keeps the request text so it can be judged.
- **31 requests is a small sample:** one misroute in a category of 3 is 33%. Read the rates with the counts.
- **The contexts are made up and short.** Real catalogues are longer; the M2 stage needs its own measurement.
- **The score doesn't read the split parts' words.** The live run on 2026-10-17 misrouted 1 request in 31, but its data parts were reworded and once half translated (L-75), which only reading the answers showed. Results and the design notes they call for: [the report](../../../evals/reports/2026-10-17-intent-spike.md).

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `run.ts`: `PLAN`, `IntentRequest` (type), `contexts`, `requests`, `renderPrompt`, `Scored` (type), `score`, `RequestResult` (type), `CategoryResult` (type), `IntentReport` (type), `runIntentSpike`, `renderReport`, `expectedReplies`, `fakeProvider`
