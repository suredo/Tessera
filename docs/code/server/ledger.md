---
type: Code Module
title: "Call ledger"
description: "Every request the host carries out and every model call it made, kept in the data folder: stage, route, sizes, prompt parts, usage, outcome and the failure reasons, with unknown usage left unknown."
resource: ../../../packages/server/src/ledger/
implements: [OBS-01, GEN-10]
tests: [../../../packages/server/test/ledger.test.ts]
tags: [code, server, ledger, observability]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-06T05:11:01Z }
---

# Purpose

Keeps what the host learns from each request instead of throwing it away (`OBS-01`, `GEN-10`): which stages ran, on which route, how big the prompts were, what they cost, how each call ended and why the request failed. The person reads a plain message; this is for the details view ([issue 151](https://github.com/suredo/Tessera/issues/151)) and for diagnosis. Evaluation runs keep their own ledger files through the [harness](../evals/harness.md); this one is the product's, in the data folder's database.

# Entry points

- `src/ledger/ledger.ts`: `RequestLedger` over a store, with rows shaped as the contracts' `LedgerRequest` and `LedgerCall`. Its start method opens a request's record, with the workspace it acts on when one is known, and returns its ID; its record method wraps a provider so each call is written when it ends; its finish method records the reply's kind, its plain message and findings, and attaches the request to the reply's workspace. Its forWorkspace method lists a workspace's newest requests, and its request method reads one, each with its calls in order. `UNATTACHED_REQUESTS_KEPT` is how many requests without a workspace are kept.
- The [generation routes](generation.md) start a request for every generate, smoke repair and data call once its control check passes, record each model call through the provider, and finish it with whatever reply the person gets, including a missing provider, an unusable routes file and a stop.

# Invariants

- **Unknown usage stays unknown** (`CLI-04`): tokens and time are stored as the provider gave them, `NULL` when it didn't know, never 0.
- **What the person asked isn't kept,** only the prompt's and the instructions' sizes in characters and the prompt parts with their versions (`ENG-16`).
- **A failure keeps its reasons** (`GEN-10`), even when the request ends well: a model failure keeps its kind, its plain message and what the provider itself said; a crash, an error that isn't a model failure, is kept apart as `crashed`; a repair call keeps the host's findings it was asked to fix, from the stage call's diagnostics, so a static or smoke check that a repair then satisfied is still on record; and the request keeps the reply's message and its check findings. A mixed request's are its entry part's, which can fail after the interface part is done, with an outcome such as `mixed_data:failed`.
- **The ledger never changes a request.** A write that fails goes to the error handler the ledger was given (the console by default) and the call or reply goes on as if it had been recorded.
- **Calls are numbered per request** in the order they end, across every provider wrapper the request used.
- **A request goes with its workspace:** the rows are deleted with it, when it leaves the trash for good. A request for a workspace that doesn't exist stays unattached; the newest `UNATTACHED_REQUESTS_KEPT` unattached ones are kept and older ones go.

# Depends on / used by

Depends on the [storage](storage.md) database (migration `0010-request-ledger.sql`), the [provider](providers.md) interface and `GenerateReply` from `@tessera/contracts`. Used by the [generation routes](generation.md).

# Pitfalls

- **Only a workspace's requests are shown.** The [host API](host-api.md)'s `details.get` reads the newest 20 for the browser's details view; requests with no workspace (an unclear request, a failed creation) are kept but not shown anywhere yet.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `index.ts`: `RequestLedger`, `UNATTACHED_REQUESTS_KEPT`, `RequestKind` (type), `LedgerCall` (type), `LedgerRequest` (type)
- `ledger.ts`: `UNATTACHED_REQUESTS_KEPT`, `RequestKind` (type), `RequestLedger`
