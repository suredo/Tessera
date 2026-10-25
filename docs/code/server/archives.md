---
type: Code Module
title: "Export and import archives"
description: "A workspace or saved tool exported to one archive file and imported back exactly, with the archive checked whole before anything is written and existing work never changed."
resource: ../../../packages/server/src/archives/
implements: [DATA-05, IMP-01, IMP-02, IMP-03, IMP-04, IMP-05, IMP-06, IMP-07]
tests: [../../../packages/server/test/archives.test.ts]
tags: [code, server, data, archives, security]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-25T14:12:19Z }
---

# Purpose

Moves a person's work in one file (`DATA-05`): a [workspace](workspaces.md), with its version history, data and saved tools, or one saved tool with the workspace it follows, exports to an archive and imports back exactly, into the same data folder or another. Importing is a trust boundary in the [threat model](../../spec/threat-model.md), whose import checks IMP-01 to IMP-07 are this module's tests. The host app reaches it through two routes of its own, export and import, which move files; the screens come with #53.

# Entry points

- `src/archives/archive.ts`:
  - `exportWorkspace` and `exportSavedTool` return an archive's bytes; `writeExport` saves them in the data folder's `exports/`, named after what they hold and the day, as `.tessera` (`ARCHIVE_EXTENSION`). `exportName` is that name, without the extension, also given to a download.
  - `importArchive` checks an archive and imports it in one transaction, returning what it imported as `Imported`, which says whether it came in as a copy.
  - `ARCHIVE_LIMITS`: 564 MB per archive, 10,000 files, 25 MB per file and 756 MB in all, unpacked, and at most 100 to 1 compression for files over 64 KB (`DATA-06`). They leave room for a workspace's images at their limit (500 MB), one image per file at the most one may be (`DATA-11`).
- `src/archives/routes.ts`: `archiveRoutes`, the host app's two routes (`APP-06`), which the [launcher](launcher.md) mounts behind the local server's guard (`SEC-03`). The export route takes the contracts' export request, a workspace or saved tool by ID, and answers with the archive as a file to save, named by `exportName`; what it can't export gets the module's plain sentence (404), and a request that isn't one gets 400. The import route takes a file's bytes, up to the archive limit, and answers the contracts' import reply: what came in, by ID and name, and whether as a copy, or the plain reason nothing did ([contracts](../contracts/package.md)).
- `src/archives/zip.ts`: `writeZip` and `readZip`, the container; `ArchiveError` is every refusal, with a plain sentence (`GEN-12`). `ZipEntry` and `ZipLimits` are their shapes.
- The manifest is the archive manifest contract in `@tessera/contracts` ([contracts package](../contracts/package.md)).

# Invariants

- **The format.** A ZIP file with `manifest.json` (format `tessera-archive`, format version 2, what was exported and when, the workspace with its history, the saved tools, and the images it names with their rows) and each tool version's canonical JSON as `versions/<hash>.json`, and each image's bytes as `assets/<id>`. Nothing else is accepted. A format 1 archive, from before images, still imports.
- **An export carries the images what it carries names** (`DATA-11`): those named in its workspaces' data and tool versions, exactly what import checks against, so a workspace's photos travel with it and come back on import with their dates. Undo history and recovery snapshots don't travel, so neither do images only they name; the archive still imports.
- **Exactly back.** Importing an export into an empty data folder gives the same IDs, titles, data, data revisions, version history, version bodies, saved tools and times; a test exports, deletes the whole data folder, imports and compares. What is in the [trash](trash.md) isn't exported.
- **An export always imports.** The writer stores an entry as it is, instead of deflating it, when deflating would pack it tighter than the reader's ratio limit, so ordinary data that compresses very well (such as long repeated text) still round-trips; then the export is read back with the import's own limits, and one that would be refused is refused when exporting, saying why. Codex's review of [pull request 67](https://github.com/suredo/Tessera/pull/67) found an export of 100 KB of repeated text that its own import refused.
- **Checked whole before anything is written.** The archive is read in memory, never unpacked to disk, and checked in this order: the container (IMP-01, IMP-02), the manifest against its contract and format version (IMP-03), the manifest against the files beside it (IMP-05), each tool version against its name and the artifact contract (IMP-04, `CON-04`), and each image against its name, its listed type, size and dimensions by its content, something in the archive that names it, and a workspace's limit (`AST-01`, `AST-02`). Only then are the images stored, through the asset store, which checks them again, and one transaction writes the rest, so a refused import leaves nothing behind. All of that runs while holding the asset store, so cleanup can't remove an image before the workspace that names it is written. If that transaction fails after the images are stored, nothing names them, and cleanup removes them.
- **The container is a strict subset of ZIP** (IMP-01, IMP-02), read here rather than by a general-purpose library: every entry is listed and checked before any is unpacked, so limits, names and ratios are refused without unpacking. Names that could escape (`..`, empty parts, absolute paths, drive letters, backslashes, NUL) are refused, as are repeated names, links, encryption, ZIP64 and any compression but none or deflate. Each entry is unpacked by `node:zlib` with a hard cap at the size it declares, and its size and CRC must match.
- **Only tool code and images, stored as data** (IMP-05, `SEC-01`): the manifest, tool versions and, from format 2, images as `assets/<id>` are the only files, and every shape is strict, so a migration, script or engine is refused. Tool code is stored and only ever runs in the sandbox; an image is only ever bytes a tool shows through a `blob:` URL.
- **Existing work is never changed** (IMP-06). If any workspace or saved tool ID in the archive is already here, in use or in the trash, everything comes in as a copy with new IDs. Tool versions are named by their content, so one already here is the same version and is kept as it is.
- **A file over the limit is refused before it is read.** The import route refuses a body whose declared length is over the archive limit without reading it, and stops reading one that grows past it (IMP-02, `DATA-06`).
- **No network, no process, and files only in the asset store** (IMP-07): an import reads only the bytes it is given, writes the database, and writes an image's file only through the [asset store](assets.md), inside its folder. One test runs an archive without images with the tripwires on and no folder allowed; another runs one with an image with only the asset store's folder allowed.

# Depends on / used by

Depends on [workspaces and saved tools](workspaces.md), [storage](storage.md), the artifact and archive contracts and Node's `zlib` and `crypto`. It also depends on the [asset store](assets.md) for the images it carries. The archive routes, through them the export and import screens (#53), and the P2 scenario ("move to another data folder") will use it.

# Pitfalls

- **Why not a ZIP library**: the one tried, `fflate`, unpacks into a buffer of the declared size without checking the CRC, so an entry larger than it declares is silently cut short instead of refused (IMP-02). `node:zlib`'s `maxOutputLength` and `crc32` give both checks; the container around them is about 200 lines.
- **A new format version** needs `ARCHIVE_FORMAT_VERSION` raised and a reader for the old one kept; an older Tessera refuses the new one plainly.
- **Imported versions get the import's time** as their stored time; the history keeps the original times.
- **The limits are first guesses** (`DATA-06`). An archive is read whole in memory, so importing one at the limit holds about that much at once.
- **Importing is async,** since images are files; exporting reads them at once.
- **The archive-size test uses a small limit:** one at 564 MB would cost a test that much memory, so `IMP-02` checks the reader's size refusal with a stand-in limit and the real limit's value separately.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `archive.ts`: `ARCHIVE_LIMITS`, `ARCHIVE_EXTENSION`, `exportWorkspace`, `exportSavedTool`, `exportName`, `writeExport`, `Imported` (type), `importArchive`
- `index.ts`: `ARCHIVE_EXTENSION`, `ARCHIVE_LIMITS`, `exportName`, `exportSavedTool`, `exportWorkspace`, `importArchive`, `writeExport`, `Imported` (type), `archiveRoutes`, `ArchiveError`, `readZip`, `writeZip`, `ZipEntry` (type), `ZipLimits` (type)
- `routes.ts`: `archiveRoutes`
- `zip.ts`: `ArchiveError`, `ZipLimits` (type), `ZipEntry` (type), `writeZip`, `readZip`
