---
type: Code Module
title: "Platform helpers"
description: "Paths and starting other programs, the same on Windows, macOS and Linux: absolute paths, no shell, and no Windows batch files."
resource: ../../../packages/server/src/platform/
implements: [PLAT-01]
tests: [../../../packages/server/test/platform.test.ts]
tags: [code, server, platform]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T00:50:39Z }
---

# Purpose

Keeps Windows-only assumptions (path separators, letter case, line endings, how programs start) out of the rest of the code (`PLAT-01`), so macOS and Linux can follow without a rewrite. CI runs the tests on Linux and on Windows.

# Entry points

- `src/platform/process.ts`: `runProcess` starts a program and collects its output and exit code, with an optional time limit; `findExecutable` finds a program on the PATH.
- `src/platform/paths.ts`: `toPosixPath` for logs and keys, `normalizeNewlines`, and `isInsideFolder`.

# Invariants

- **Programs start by absolute path, never through a shell.** Arguments reach the program exactly as given, spaces, quotes, `%`, `&` and `|` included, and no shell ever reads them. The program gets no input, so one that reads until the end of its input finishes instead of waiting. The result comes when the program exits, once its output has arrived: a program it started and left running can't hold the call open for more than a quarter of a second.
- **No Windows batch files.** Windows starts a `.cmd` or `.bat` file only through a shell, so `runProcess` refuses one and says to use the program's own `.exe`. npm's `claude.cmd` shim was the POC's case (L-45).
- **`findExecutable` returns the file's real name and path, as a shell would find it.** On Windows it tries each extension in `PATHEXT`, matches regardless of letter case, and returns the name as stored on disk. On macOS and Linux it skips files without permission to run. It can return a batch file such as `claude.cmd`; `runProcess` then refuses it with its explanation, which the setup check (`PLAT-03`) can pass on.
- **Windows paths compare regardless of case** in `isInsideFolder`, as Windows does. Both paths are resolved first, so `..` can't step outside, and only `..` itself goes up: a name like `..cache` is inside.

# Depends on / used by

Node's `child_process`, `fs` and `path` only. The CLI adapter (M2) will start Claude Code with `runProcess`, and the setup check (`PLAT-03`) will look for it with `findExecutable`.

# Pitfalls

- **`toPosixPath` is for display and keys,** never for opening files.
- **A time limit stops the process but not the programs it started.** If a program starts others, they need their own stop (M2). Output they write after the program has exited isn't collected.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `index.ts`: `isInsideFolder`, `normalizeNewlines`, `toPosixPath`, `findExecutable`, `runProcess`, `ProcessResult` (type), `RunOptions` (type)
- `paths.ts`: `toPosixPath`, `normalizeNewlines`, `isInsideFolder`
- `process.ts`: `ProcessResult` (type), `RunOptions` (type), `findExecutable`, `runProcess`
