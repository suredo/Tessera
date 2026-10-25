---
type: Decision
title: "ADR 0007. Asset references found by scanning"
description: "The asset store finds what still refers to an asset by looking through everything stored when it cleans up, rather than keeping reference rows that every write path must update; it changes DATA-11's wording."
tags: [decisions, data, assets]
status: stable
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-25T09:33:55Z }
---
# ADR 0007. Asset references found by scanning

Decided by the owner on 2026-10-25, while the asset store was planned ([#49](https://github.com/suredo/Tessera/issues/49)). It refines A48 in the [decision log](../decision-log.md), and changes the wording of `DATA-11` in the [data spec](../../spec/data.md).

## Context

`DATA-11` said SQLite keeps one row per asset "plus the references to it", and that an asset is deleted only when nothing references it: no workspace, version, data undo entry, trash entry or recovery snapshot. Tool data names an asset by its ID, the SHA-256 of its bytes.

By M1, tool data is written in many places: patches through the bridge, whole saves, activation and its migrations, restore, recovery snapshots, Use again, import, and soon data undo (#110). Each would have to add and remove reference rows exactly right. One that forgot would let cleanup delete a photo something still shows.

## Options

1. **Reference rows,** as the spec read: every write path updates a table of references, and cleanup deletes the assets with none. Cleanup is quick, but correctness rests on every path, today's and future ones.
2. **Find references when cleaning up:** cleanup looks through everything stored for asset IDs, and deletes only assets none of it holds.

## Decision

Option 2. Cleanup reads every workspace's data (trashed ones included), every tool version and every recovery snapshot, and later every data undo entry, as JSON text. Any run of 64 hex digits that is a stored asset's ID keeps that asset.

## Consequences

- **No write path can forget a reference,** because none records one. A new table that stores tool data must be added to the scan instead; the [asset store](../../code/server/assets.md) doc names this as a pitfall.
- **A false match only keeps an asset longer.** A string that happens to equal an asset's ID keeps it; nothing referred to is ever missed, wherever in the data it sits.
- **Cleanup costs a read of everything stored.** It runs at start and hourly, beside the trash's expiry, not on every change. That's fine for one person's data; if it ever isn't, the scan can keep a cache, without changing who decides.
- **A workspace's asset limit is checked when an asset is added,** from the assets its data, versions and snapshots name, plus the new one.
