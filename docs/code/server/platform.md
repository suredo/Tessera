---
type: Code Module
title: "Platform helpers"
description: "Paths and starting other programs, the same on Windows, macOS and Linux: absolute paths, no shell, and no Windows batch files."
resource: ../../../packages/server/src/platform/
implements: [PLAT-01]
tests: [../../../packages/server/test/platform.test.ts]
tags: [code, server, platform]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-26T13:18:53Z }
---

# Purpose

Keeps Windows-only assumptions (path separators, letter case, line endings, how programs start) out of the rest of the code (`PLAT-01`), so macOS and Linux can follow without a rewrite. CI runs the tests on Linux and on Windows.

# Entry points

- `src/platform/process.ts`: `runProcess` starts a program and collects its output and exit code, with an optional time limit, cancel signal and input; `findExecutable` finds a program on the PATH.
- `src/platform/paths.ts`: `toPosixPath` for logs and keys, `normalizeNewlines`, and `isInsideFolder`.

# Invariants

- **A cancel stops a program as the time limit does** (`CLI-06`): it is asked to stop, then ended outright a second later, and the result says `cancelled`. A signal already cancelled starts nothing.
- **Input goes on standard input, then end-of-input**, so text too long for the command line reaches the program whole; without input, the program reads end-of-input at once and never waits.

- **Programs start by absolute path, never through a shell.** Arguments reach the program exactly as given, spaces, quotes, `%`, `&` and `|` included, and no shell ever reads them. The program gets the input given, if any, then end-of-input, so one that reads until the end of its input finishes instead of waiting. The result comes when the program exits, once its output has arrived: a program it started and left running can't hold the call open for more than a quarter of a second. At the time limit the program is asked to stop, and ended outright if it hasn't a second later, since outside Windows a program can ignore the request.
- **No Windows batch files.** Windows starts a `.cmd` or `.bat` file only through a shell, so `runProcess` refuses one and says to use the program's own `.exe`. npm's `claude.cmd` shim was the POC's case (L-45).
- **`findExecutable` returns the path a shell would run.** On Windows it tries each extension in `PATHEXT`, matches regardless of letter case, and returns the name as stored on disk. On macOS and Linux it skips files without permission to run. It never follows a link to its target: version managers such as mise and Volta make `node` and `claude` links to one shim that chooses what to run from the name it was started by. It can return a batch file such as `claude.cmd`; `runProcess` then refuses it with its explanation, which the setup check (`PLAT-03`) can pass on.
- **Windows paths compare regardless of case** in `isInsideFolder`, as Windows does. Both paths are resolved first, so `..` can't step outside, and only `..` itself goes up: a name like `..cache` is inside.

# Depends on / used by

Node's `child_process`, `fs` and `path` only. The [launcher](launcher.md) opens the browser with `runProcess` (and finds `xdg-open` with `findExecutable`), and the [local server](local-server.md) keeps files inside the built app with `isInsideFolder`. The CLI adapter (M2) will start Claude Code with `runProcess`, and the setup check (`PLAT-03`) will look for it with `findExecutable`.

# Pitfalls

- **`toPosixPath` is for display and keys,** never for opening files.
- **A time limit stops the process but not the programs it started.** If a program starts others, they need their own stop (M2). Output they write after the program has exited isn't collected.
- **`isInsideFolder` compares paths as text** and doesn't follow links: a link inside the folder that points outside counts as inside. A caller that guards a folder must resolve real paths first.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `index.ts`: `isInsideFolder`, `normalizeNewlines`, `toPosixPath`, `findExecutable`, `runProcess`, `ProcessResult` (type), `RunOptions` (type)
- `paths.ts`: `toPosixPath`, `normalizeNewlines`, `isInsideFolder`
- `process.ts`: `ProcessResult` (type), `RunOptions` (type), `findExecutable`, `runProcess`
