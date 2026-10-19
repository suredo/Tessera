---
type: Code Module
title: "Launcher"
description: "Starting Tessera with one double-click: one copy per data folder, a free port, the browser opened, and a clean stop when its window closes."
resource: ../../../packages/server/src/launcher/
implements: [PLAT-02]
tests: [../../../packages/server/test/launcher.test.ts]
tags: [code, server, platform, launcher]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-19T00:31:05Z }
---

# Purpose

Starts Tessera with one double-click (`PLAT-02`): it starts the [local server](local-server.md), which finds a free port if the default is taken, never lets a second copy run, opens the browser at Tessera, and stops the server cleanly when its window closes. The installer and the other platforms come in M6.

# Entry points

- `Tessera.cmd`, at the repository's root: the double-click on Windows. It runs `main.ts` with Node, and pauses on an error so the window stays open to read it.
- `src/launcher/main.ts`: the entry point. It chooses the data folder, launches, prints where Tessera runs, and stops it on Ctrl+C, Ctrl+Break, a stop signal or a closed window (which Windows reports as SIGHUP).
- `src/launcher/launcher.ts`: `launch` starts a copy, or opens the one already running; `openInBrowser` opens an address in the default browser.

# Invariants

- **Development and tests choose their own data folder** with `TESSERA_DATA_DIR` (`ENG-19`). `TESSERA_OPEN_BROWSER=0` starts Tessera without a browser, for tests.

- **One copy per data folder.** The copy that runs keeps `tessera.lock` in the data folder, naming its address and a random instance ID. A second launch asks that address for its instance ID; if it answers, the launch only opens the browser there and starts nothing.
- **A lock is written only once its server answers,** and is created whole, through a hard link that fails when the name is taken, so another launcher never reads half a lock. When two launches race, one wins and the other closes its server and opens the winner's.
- **A lock nobody answers for is replaced.** A copy that was killed, or a computer that lost power, leaves its lock behind; the next launch removes it, unless another launcher has replaced it in the meantime.
- **Only addresses on this computer are opened.** A lock naming anything but `http://127.0.0.1:<port>` counts as left behind.
- **The browser opens without a shell,** through `runProcess`: `rundll32` on Windows, `open` on macOS and `xdg-open` elsewhere. If it fails, Tessera keeps running and prints the address to open.
- **A clean stop removes the lock, then closes the server** and its open connections, so the port is free.

# Depends on / used by

The [local server](local-server.md) and the [platform helpers](platform.md) (`runProcess`, `findExecutable`). The setup check (`PLAT-03`, M2) will run from here.

# Pitfalls

- **The data folder's default is provisional:** `%LOCALAPPDATA%\Tessera` on Windows. The storage work (`PLAT-04`) settles where it lives and moves the default with it.
- **Windows has no stop signals between programs.** A test can't close the window the way a person does, so on Windows the tests stop a copy through `stop()` and kill one outright to leave its lock behind; the signal path is tested on Linux.
- **Replacing a stale lock is not atomic.** The launcher checks that the lock is still the stale one, then removes it. Two launchers replacing the same stale lock at that same instant could both start, with the lock naming only one of them.
- **Node must be on the PATH** for `Tessera.cmd`; the setup check and the installer handle that later.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `index.ts`: `launch`, `openInBrowser`, `LaunchOptions` (type), `Launched` (type)
- `launcher.ts`: `LaunchOptions` (type), `Launched` (type), `openInBrowser`, `launch`
