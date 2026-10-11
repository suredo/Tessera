---
type: Requirement Area
title: "Platform and setup"
description: "Windows-first platform, launcher, setup check and data folder (PLAT-01 to PLAT-04)."
tags: [spec, platform, setup]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-11T20:21:39Z }
---
# Platform and setup (`PLAT`)

| ID | Requirement |
| --- | --- |
| PLAT-01 | **Windows first** (A29). The first release supports Windows 10 and 11. Code avoids Windows-only assumptions (paths, process spawning, line endings) behind small platform helpers, so macOS and Linux can follow without a rewrite. |
| PLAT-02 | **Launcher.** One double-click (a shortcut or script) starts the local server, picks a free port if the default is taken, prevents a second copy from running, and opens the browser at Tessera. Closing it stops the server cleanly. |
| PLAT-03 | **Setup check.** On start, and from the setup screen (`APP-07`), Tessera checks: Node version; Claude Code (and, from M3, Codex) installed (path and version, `CLI-02`); signed in; minimum version met. Each failure is explained in plain words, with the exact fix. Nothing that needs the model is offered until the check passes. |
| PLAT-04 | **Data location.** The SQLite file, asset files (`DATA-11`), exports and logs live in one user data folder, shown on the setup screen and easy to back up. It is never inside a cloud-synced folder by default (L-02). |
