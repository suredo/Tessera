---
type: Code Module
title: "Export and import archives"
description: "A workspace or saved tool exported to one archive file and imported back exactly, with the archive checked whole before anything is written and existing work never changed."
resource: ../../../packages/server/src/archives/
implements: [DATA-05, IMP-01, IMP-02, IMP-03, IMP-04, IMP-05, IMP-06, IMP-07]
tests: [../../../packages/server/test/archives.test.ts]
tags: [code, server, data, archives, security]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-19T07:58:03Z }
---

# Purpose

Moves a person's work in one file (`DATA-05`): a [workspace](workspaces.md), with its version history, data and saved tools, or one saved tool with the workspace it follows, exports to an archive and imports back exactly, into the same data folder or another. Importing is a trust boundary in the [threat model](../../spec/threat-model.md), whose import checks IMP-01 to IMP-07 are this module's tests. Assets inside archives come with [issue 49](https://github.com/suredo/Tessera/issues/49); the screens with #53.

# Entry points

- `src/archives/archive.ts`:
  - `exportWorkspace` and `exportSavedTool` return an archive's bytes; `writeExport` saves them in the data folder's `exports/`, named after what they hold and the day, as `.tessera` (`ARCHIVE_EXTENSION`).
  - `importArchive` checks an archive and imports it in one transaction, returning what it imported as `Imported`, which says whether it came in as a copy.
  - `ARCHIVE_LIMITS`: 64 MB per archive, 10,000 files, 8 MB per file and 256 MB in all, unpacked, and at most 100 to 1 compression for files over 64 KB (`DATA-06`).
- `src/archives/zip.ts`: `writeZip` and `readZip`, the container; `ArchiveError` is every refusal, with a plain sentence (`GEN-12`). `ZipEntry` and `ZipLimits` are their shapes.
- The manifest is the archive manifest contract in `@tessera/contracts` ([contracts package](../contracts/package.md)).

# Invariants

- **The format.** A ZIP file with `manifest.json` (format `tessera-archive`, format version 1, what was exported and when, the workspace with its history, and the saved tools) and each tool version's canonical JSON as `versions/<hash>.json`. Nothing else is accepted.
- **Exactly back.** Importing an export into an empty data folder gives the same IDs, titles, data, data revisions, version history, version bodies, saved tools and times; a test exports, deletes the whole data folder, imports and compares. What is in the [trash](trash.md) isn't exported.
- **Checked whole before anything is written.** The archive is read in memory, never unpacked to disk, and checked in this order: the container (IMP-01, IMP-02), the manifest against its contract and format version (IMP-03), the manifest against the files beside it (IMP-05), and each tool version against its name and the artifact contract (IMP-04, `CON-04`). Only then does one transaction write it, so a refused import leaves nothing behind.
- **The container is a strict subset of ZIP** (IMP-01, IMP-02), read here rather than by a general-purpose library: every entry is listed and checked before any is unpacked, so limits, names and ratios are refused without unpacking. Names that could escape (`..`, empty parts, absolute paths, drive letters, backslashes, NUL) are refused, as are repeated names, links, encryption, ZIP64 and any compression but none or deflate. Each entry is unpacked by `node:zlib` with a hard cap at the size it declares, and its size and CRC must match.
- **Only tool code, stored as data** (IMP-05, `SEC-01`): the manifest and tool versions are the only files, and every shape is strict, so a migration, script or engine is refused. Tool code is stored and only ever runs in the sandbox.
- **Existing work is never changed** (IMP-06). If any workspace or saved tool ID in the archive is already here, in use or in the trash, everything comes in as a copy with new IDs. Tool versions are named by their content, so one already here is the same version and is kept as it is.
- **No network, no process, no file** (IMP-07): an import only reads the bytes it is given and writes to the database; a test runs it with the tripwires on and no folder allowed.

# Depends on / used by

Depends on [workspaces and saved tools](workspaces.md), [storage](storage.md), the artifact and archive contracts and Node's `zlib` and `crypto`. The export and import screens (#53) and the P2 scenario ("move to another data folder") will use it; assets (#49) add `assets/<hash>` entries and their checks.

# Pitfalls

- **Why not a ZIP library**: the one tried, `fflate`, unpacks into a buffer of the declared size without checking the CRC, so an entry larger than it declares is silently cut short instead of refused (IMP-02). `node:zlib`'s `maxOutputLength` and `crc32` give both checks; the container around them is about 200 lines.
- **A new format version** needs `ARCHIVE_FORMAT_VERSION` raised and a reader for the old one kept; an older Tessera refuses the new one plainly.
- **Imported versions get the import's time** as their stored time; the history keeps the original times.
- **The limits are first guesses** (`DATA-06`); assets will need larger ones (#49).

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `archive.ts`: `ARCHIVE_LIMITS`, `ARCHIVE_EXTENSION`, `exportWorkspace`, `exportSavedTool`, `writeExport`, `Imported` (type), `importArchive`
- `index.ts`: `ARCHIVE_EXTENSION`, `ARCHIVE_LIMITS`, `exportSavedTool`, `exportWorkspace`, `importArchive`, `writeExport`, `Imported` (type), `ArchiveError`, `readZip`, `writeZip`, `ZipEntry` (type), `ZipLimits` (type)
- `zip.ts`: `ArchiveError`, `ZipLimits` (type), `ZipEntry` (type), `writeZip`, `readZip`
