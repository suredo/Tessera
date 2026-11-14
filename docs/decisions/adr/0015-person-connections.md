---
type: Decision
title: "ADR 0015. Outside services through connections the person adds"
description: "Decides D11 (CAP-02, A65): no vetted sources; the person adds a connection to any service, a tool uses one by name through the host, reads run freely, a tool's first write through a connection is confirmed, and checks never reach the real service."
tags: [decisions, capabilities, outside-data, security]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-14T04:00:00Z }
---
# ADR 0015. Outside services through connections the person adds

Decides [D11](../open/d11-outside-data.md), due at the start of M4 (A42), and amends `CAP-02`. The approach is the owner's choice of 2026-11-14, after a comparison of movie sources (the Internet Archive, TMDB, OMDb and Wikidata) for the movie finder (T7).

## Context

`CAP-02` planned host-owned providers on vetted sources, chosen by Tessera, with only search terms sent. The owner doesn't want Tessera to choose: a person may want data from a particular API, to add something to a service through its API, or anything else, and Tessera shouldn't limit what they can reach.

What must still hold:

- **A tool's code is written by a model and read by no one.** It runs beside the person's data. If it could reach any address, a bad answer, or text injected into what it fetched (`SEC-02`), could send the workspace anywhere, unseen (`RUN-01`).
- **History and undo stop at the machine.** A write to an outside service (a post, a delete, a payment) can't be undone by Tessera (`DATA-04`).
- **A key in a tool's code can be read by the tool.** Any tool, or anything injected into one, could leak it.
- **Every candidate is checked before the person sees it** (`VER-02`, `VER-03`), and a check must not do anything real (`BRG-06`).

## Decision

1. **The person adds connections.** In Tessera's settings, a connection names a service, the addresses it may reach (a host such as `api.example.com`, with its scheme), and, if the service needs one, a key or token and how it is sent. Tessera chooses no sources: any service the person names can be one. Keys are stored by the host, never in a tool or its data, and never sent to a model.
2. **A tool uses a connection by name,** as it uses the clock or the chart helper: it declares the capability, and calls a bridge action with the connection's name, a path under its addresses, and the request. The host makes the request, adds the key, and returns the answer with where it came from. Generated code still never fetches anything itself, and the sandbox is unchanged (`RUN-01`).
3. **Reads run freely.** A request that only reads (GET, HEAD) runs without asking.
4. **A tool's first write through a connection is confirmed.** The first request that may change something (POST, PUT, PATCH, DELETE) from a tool through a connection asks the person, in plain words, where it goes and what it sends. Once they allow it, that tool's later writes through that connection run without asking. They can take the permission back at any time in the details view.
5. **Checks never reach the real service.** In staging, a connection answers with recorded or made-up answers, never the service, so building and checking a tool reads and writes nothing outside.
6. **What comes back is data, never instructions** (`SEC-02`). Wherever it is quoted to a model, it is quoted as data. Images in an answer that the tool shows are fetched by the host and handed over as assets (`DATA-11`); a page or video opens in a new browser tab through the host, after the person clicks, as before.
7. **The details view shows each tool's connections, its permission to write, and its recent requests** (where, when, read or write, the outcome), never the key (`OBS-01`).

## Consequences

- D11 is closed without a source. The movie finder (T7) is tested through a connection to whatever movie service its scenario sets up, so the release acceptance keeps it.
- `CAP-02` becomes connections: its search-terms-only rule becomes "only what the tool's request says, to the connection's addresses", and P7 says so.
- New work for M4: the connections settings, key storage, the bridge action and capability, the first-write confirmation, staging's recorded answers, and the details view's part ([#349](https://github.com/suredo/Tessera/issues/349)). The threat model gains a row for connections.
- Rejected: **vetted sources only** (the owner's choice: too limiting); **tools fetching any address** (an unreviewed tool could send the person's data anywhere, and a check would reach the real service); **confirming every write** (the owner chose the first write per tool and connection, so a tool that posts often stays usable).
- Open for later: whether a connection can be shared between people or exported with a workspace (a key must never travel in an archive), and limits on how often a tool may call.
