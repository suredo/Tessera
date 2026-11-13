---
type: Code Module
title: "Call ledger"
description: "Every request the host carries out and every model call it made, kept in the data folder: stage, route, sizes, prompt parts, usage, outcome and the failure reasons, with unknown usage left unknown."
resource: ../../../packages/server/src/ledger/
implements: [OBS-01, GEN-10]
tests: [../../../packages/server/test/ledger.test.ts]
tags: [code, server, ledger, observability]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:30:00Z }
---

# Purpose

Keeps what the host learns from each request instead of throwing it away (`OBS-01`, `GEN-10`): which stages ran, on which route, how big the prompts were, what they cost, how each call ended and why the request failed. The person reads a plain message; this is for the details view ([issue 151](https://github.com/suredo/Tessera/issues/151)) and for diagnosis. Evaluation runs keep their own ledger files through the [harness](../evals/harness.md); this one is the product's, in the data folder's database.

# Entry points

- `src/ledger/ledger.ts`: `RequestLedger` over a store, with rows shaped as the contracts' `LedgerRequest` and `LedgerCall`. Its start method opens a request's record, with the workspace it acts on when one is known, and returns its ID; its record method wraps a provider so each call is written when it ends; its finish method records the reply's kind, its plain message and findings, and attaches the request to the reply's workspace. Its forWorkspace method lists a workspace's newest requests, its unattached method the newest that made no workspace, and its request method reads one, each with its calls in order. `UNATTACHED_REQUESTS_KEPT` is how many requests without a workspace are kept.
- The [generation routes](generation.md) start a request for every generate, smoke repair and data call once its control check passes, record each model call through the provider, and finish it with whatever reply the person gets, including a missing provider, an unusable routes file and a stop.

# Invariants

- **Unknown usage stays unknown** (`CLI-04`): tokens and time are stored as the provider gave them, `NULL` when it didn't know, never 0.
- **What a request was told of the conversation before it is kept as where it is kept** (A62): its subject, a workspace's ID or null for the empty screen's chat, and the chat messages' numbers, in `told` (migration `0016-request-told.sql`), written by `told` as the request's job starts; never the words, which the details view reads from the chat while it keeps them. NULL for a request told nothing, or run before this.
- **What the person asked isn't kept,** only the prompt's and the instructions' sizes in characters and the prompt parts with their versions (`ENG-16`).
- **A call keeps the code it answered with** (`GEN-10`), so an answer the host's checks refused can still be read in the details view: a created tool's or a replaced edit's HTML, CSS and JavaScript, or a style edit's CSS (`answerCode`, migration `0013-call-code.sql`). Only the code: never the request, nor the entries an answer starts a tool with. An answer refused for its shape keeps its code too: the provider's schema failure carries the answer unchecked (`ProviderError.answer`), and the call still fails. A call with no code, such as intent or a data plan, keeps none, and so does one whose code is over `CALL_CODE_LIMIT` (256 KiB, in UTF-8 bytes as stored, `keptCode`), rather than a part of it. It goes with its request, as the rest of the call does.
- **A failure keeps its reasons** (`GEN-10`), even when the request ends well: a model failure keeps its kind, its plain message and what the provider itself said; a crash, an error that isn't a model failure, is kept apart as `crashed`; a repair call keeps the host's findings it was asked to fix, from the stage call's diagnostics, so a static or smoke check that a repair then satisfied is still on record; and the request keeps the reply's message and its check findings. A mixed request's are its entry part's, which can fail after the interface part is done, with an outcome such as `mixed_data:failed`.
- **An outcome says what came of a request:** the reply's kind; for an answer, which one (`answer:clarify`), and for a mixed request its entry part's after another colon (`mixed_data:answer:data_stale`), so the details view can say what Tessera replied (`OBS-01`, L-100). Requests recorded before keep plain `answer`. A discussion keeps its answer as the request's message, the words the person read (`GEN-19`), as any other plain message is kept.
- **The ledger never changes a request.** A write that fails goes to the error handler the ledger was given (the console by default) and the call or reply goes on as if it had been recorded.
- **Calls are numbered per request** in the order they end, across every provider wrapper the request used.
- **A request goes with its workspace:** the rows are deleted with it, when it leaves the trash for good. A request for a workspace that doesn't exist stays unattached; the newest `UNATTACHED_REQUESTS_KEPT` unattached ones are kept and older ones go.

# Depends on / used by

Depends on the [storage](storage.md) database (migration `0010-request-ledger.sql`), the [provider](providers.md) interface and `GenerateReply` from `@tessera/contracts`. Used by the [generation routes](generation.md).

# Pitfalls

- **Requests with no workspace are shown apart.** The [host API](host-api.md)'s `details.get` reads a workspace's newest 20 and, separately, the newest 20 that made no workspace (an unclear request, a failed creation), so a failed first creation's reasons can be seen from the empty screen too.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `index.ts`: `RequestLedger`, `UNATTACHED_REQUESTS_KEPT`, `RequestKind` (type), `LedgerCall` (type), `LedgerRequest` (type)
- `ledger.ts`: `UNATTACHED_REQUESTS_KEPT`, `RequestKind` (type), `CALL_CODE_LIMIT`, `keptCode`, `answerCode`, `RequestLedger`
