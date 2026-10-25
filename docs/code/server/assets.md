---
type: Code Module
title: "Asset store"
description: "Images stored once by the SHA-256 of their bytes, checked by content and size, swept of interrupted writes at start, and removed only when nothing stored refers to them any more."
resource: ../../../packages/server/src/assets/
implements: [DATA-11, AST-01, AST-02, AST-03, AST-06]
tests: [../../../packages/server/test/assets.test.ts]
tags: [code, server, data, assets]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-25T10:15:16Z }
---

# Purpose

Keeps the person's images (`DATA-11`, A48): photos and other pictures a tool shows. Each is one file in the data folder's `assets` folder, named by the SHA-256 of its bytes, with one row in the `assets` table (migration `0006-assets.sql`, [storage](storage.md)). Tool data names an asset by that ID. Assets never change: an edited image is a new asset, so versions, restore and undo need no copies, and an image many versions use is stored once. The shapes, types and limits are the `asset` contract in `@tessera/contracts` ([contracts package](../contracts/package.md)).

# Entry points

- `src/assets/assets.ts`, each function taking an `AssetStore` (the open data folder's database, clock and folders):
  - `storeAsset` stores bytes as an asset, once, or returns why not (`StoreAssetResult`): empty, too large, not an image, or over the workspace's limit.
  - `getAsset` gives an asset's row, and `readAsset` its row and bytes, for an ID that is a stored asset's.
  - `workspaceAssets` gives the IDs one workspace's data, versions and snapshots name, which the [bridge route](bridge.md) checks before it hands a tool an image (`AST-04`), and `readAssetNow` reads one at once, for that answer.
  - `referencedAssets` gives the IDs something stored still names; `collectAssets` removes every asset nothing names.
  - `sweepAssets` removes what an interrupted write left, at start.
- `src/assets/sniff.ts`: `sniffImage` tells PNG, JPEG and WebP by their bytes, with their dimensions (`Sniffed`).

# Invariants

- **Types are told by content, never by name** (`AST-01`). An image passes only if its header parses as PNG, JPEG or WebP down to its width and height, with every declared length (a JPEG segment's, a WebP container's and its first chunk's) inside the file and long enough to hold what is read: HTML named `.png`, an SVG, a real signature followed by something else, or a header whose lengths lie is refused. All three WebP layouts are read (lossy, lossless and extended).
- **Limits are checked before anything is written** (`AST-02`): 25 MB for one asset, and 500 MB for the assets a workspace's data, versions and snapshots name, with the new one. A refusal says plainly why, and writes no file and no row.
- **A row always has its file.** A new asset is written under a temporary name inside the assets folder, then renamed into place, and only then is its row added. The same bytes always make the same asset, so storing them again adds nothing.
- **An ID is only ever a SHA-256** (`AST-03`). Every lookup checks the ID first, and a file's path is built from the checked ID and the row's type, never from anything a caller passes, so nothing outside the asset store can be read through it.
- **An asset goes only when nothing refers to it** (`DATA-09`, `DATA-11`). What refers to an asset isn't recorded: `collectAssets` looks through everything stored, as JSON text, for its ID ([ADR 0007](../../decisions/adr/0007-asset-references-by-scanning.md)). That is every workspace's data, trashed ones included, every tool version, and every recovery snapshot. A workspace in the trash keeps its assets until it is removed for good. The row goes in one transaction that checks again, then the file; a crash between them leaves a file without a row, which the next start removes.
- **Storing, cleanup and the sweep run one at a time** for each database. Each touches rows and files with waits between them; otherwise cleanup could remove the file of an asset stored again while it waited, leaving a row with no file.
- **The start-up sweep touches only what is the store's** (`AST-06`). It removes every temporary file, and every file named like an asset, in the folder its name belongs in, that has no row. Any other file is left alone, as is everything outside the assets folder. The [launcher](launcher.md) sweeps and then cleans up at start, and cleans up again hourly after the trash's expiry.

# Depends on / used by

Depends on [storage](storage.md) and the contracts. The [launcher](launcher.md) runs the sweep and the clean-up. The [bridge route](bridge.md) hands a tool the images its workspace names. Assets in export archives come next ([#49](https://github.com/suredo/Tessera/issues/49)).

# Pitfalls

- **A new table that stores tool data must be added to the scan.** `REFERENCE_SOURCES` in `assets.ts` lists what is looked through; data undo ([#110](https://github.com/suredo/Tessera/issues/110)) must add its entries there, or cleanup can remove an asset an undo would bring back.
- **A false match only keeps an asset longer.** Any run of 64 hex digits that equals a stored asset's ID keeps it, wherever it sits in the data, including a tool version's code.
- **Headers aren't the whole image.** `sniffImage` doesn't decode an image, so a file can pass and still fail to show.
- **The workspace limit counts what is named when an asset is added.** Two assets added before either is saved into the data are each counted without the other.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `assets.ts`: `AssetStore` (type), `getAsset`, `workspaceAssets`, `readAssetNow`, `referencedAssets`, `StoreAssetRefusal` (type), `StoreAssetResult` (type), `storeAsset`, `readAsset`, `collectAssets`, `sweepAssets`
- `index.ts`: `collectAssets`, `getAsset`, `readAsset`, `readAssetNow`, `referencedAssets`, `storeAsset`, `sweepAssets`, `workspaceAssets`, `AssetStore` (type), `StoreAssetRefusal` (type), `StoreAssetResult` (type), `sniffImage`, `Sniffed` (type)
- `sniff.ts`: `Sniffed` (type), `sniffImage`
