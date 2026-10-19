---
type: Code Module
title: "Launcher"
description: "Starting Tessera with one double-click: one copy per data folder, a free port, the browser opened, and a clean stop when its window closes."
resource: ../../../packages/server/src/launcher/
implements: [PLAT-02]
tests: [../../../packages/server/test/launcher.test.ts]
tags: [code, server, platform, launcher]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-19T04:33:49Z }
---

# Purpose

Starts Tessera with one double-click (`PLAT-02`): it starts the [local server](local-server.md), which finds a free port if the default is taken, never lets a second copy run, opens the browser at Tessera, and stops the server cleanly when its window closes. The installer and the other platforms come in M6.

# Entry points

- `Tessera.cmd`, at the repository's root: the double-click on Windows. It runs `main.ts` with Node, and pauses on an error so the window stays open to read it.
- `src/launcher/main.ts`: the entry point. It chooses the data folder, launches, prints where Tessera runs, and stops it on Ctrl+C, Ctrl+Break, a stop signal or a closed window (which Windows reports as SIGHUP).
- `src/launcher/launcher.ts`: `launch` starts a copy, or opens the one already running; `openInBrowser` opens an address in the default browser.

# Invariants

- **Development and tests choose their own data folder** with `TESSERA_DATA_DIR` (`ENG-19`). `TESSERA_OPEN_BROWSER=0` starts Tessera without a browser, for tests.

- **One copy per data folder.** The copy that runs holds an exclusive lock on `tessera.lock` in the data folder for as long as it runs, through `tryLockFile` from [storage](storage.md). A launch that can't take the lock starts nothing: it waits up to 10 seconds for the holder's address and opens the browser there, or says that Tessera is already starting in another window.
- **The system releases the lock** when its holder ends, however it ends, so a copy that was killed, or a computer that lost power, leaves nothing that blocks the next start. There is no stale lock to check and remove, so two launches recovering at the same moment can't both start: whichever takes the lock is the only one.
- **Only the lock's holder writes the address.** It removes any address left in `tessera.address`, which a killed copy can leave, then starts the server and writes its address and a random instance ID there. Another launch trusts an address only once the server there answers `/api/instance` with that ID, so a half-written or left-behind address is never opened.
- **A copy that fails to start leaves nothing running.** Whatever fails after it takes the lock, such as a full disk when it writes its address, its server closes before the lock is released, so the next launch never takes the lock while that copy still listens.
- **Only addresses on this computer are opened.** An address naming anything but `http://127.0.0.1:<port>` is never used.
- **The browser opens without a shell,** through `runProcess`: `rundll32` on Windows, `open` on macOS and `xdg-open` elsewhere. If it fails, Tessera keeps running and prints the address to open.
- **It can stop cleanly once it says it's running.** `main.ts` installs its stop handlers before it launches, so a stop that comes right after the ready line still removes the address and closes the server. A stop during the launch just exits: the system releases the lock, and the next copy removes the address left behind.
- **A clean stop removes the address, closes the server** and its open connections, so the port is free, **and then releases the lock.**

# Depends on / used by

The [local server](local-server.md), [storage](storage.md)'s `tryLockFile`, and the [platform helpers](platform.md) (`runProcess`, `findExecutable`). The setup check (`PLAT-03`, M2) will run from here.

# Pitfalls

- **The data folder's default is provisional:** `%LOCALAPPDATA%\Tessera` on Windows. The storage work (`PLAT-04`) settles where it lives and moves the default with it.
- **Windows has no stop signals between programs.** A test can't close the window the way a person does, so on Windows the tests stop a copy through `stop()` and kill one outright to check that its lock is released; the signal path is tested on Linux.
- **A launch can wait up to 10 seconds** while the holder starts. A holder that is stuck, rather than killed, keeps the lock; the launch then says so and starts nothing.
- **Node must be on the PATH** for `Tessera.cmd`; the setup check and the installer handle that later.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `index.ts`: `launch`, `openInBrowser`, `LaunchOptions` (type), `Launched` (type)
- `launcher.ts`: `LaunchOptions` (type), `Launched` (type), `openInBrowser`, `launch`
