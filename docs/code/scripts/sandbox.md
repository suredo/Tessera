---
type: Code Module
title: "Clean-setup sandbox"
description: "scripts/sandbox/p1.ps1 starts Windows Sandbox for the clean-setup scenario P1, and p1-prepare.ps1, inside it, downloads Tessera at a pinned commit and installs Node and Tessera, but never Claude Code or Codex."
resource: ../../../scripts/sandbox/
implements: [PLAT-02, PLAT-03]
tags: [code, scripts, platform, setup]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-10T18:30:00Z }
---

# Purpose

Prepares a throwaway Windows for the clean-setup scenario P1 (A43, J0), so the setup check is tried on a machine that has never seen Tessera, Claude Code or Codex. The [procedure](../../testing/clean-setup.md) says how to run it and what to record.

# Entry points

- `scripts/sandbox/p1.ps1`, run on the host in Windows PowerShell 5.1. It says how to turn Windows Sandbox on when it isn't there. It takes the commit to install (`-Commit`, by default `origin/main` as last fetched) and writes `test-output/p1/`: the preparation script, `commit.txt` and `p1.wsb`. That configuration gives the sandbox networking and 4 GB of memory, maps that folder in read-only, and runs the preparation at sign-in. It then starts the sandbox.
- `scripts/sandbox/p1-prepare.ps1`, run inside the sandbox. It downloads the commit's archive from the public repository, installs the Node version its `.nvmrc` names from nodejs.org, runs `corepack pnpm install --frozen-lockfile` and `corepack pnpm build` in `C:\Tessera`, and puts a Tessera shortcut to `Tessera.cmd` on the desktop.

# Invariants

- **Never Claude Code or Codex.** The preparation installs only what Tessera needs to start. The programs that make tools are found, installed and signed in to by following Tessera's setup check, which is what P1 tests (`PLAT-03`).
- **Nothing on the host changes but `test-output/p1/`.** The sandbox sees only that folder, read-only. Tessera's data, the sign-ins and the install are inside the sandbox, and are discarded when it closes. The host's own data folder is never involved (`ENG-19`).
- **A pinned commit.** The sandbox installs one commit, named in `commit.txt`, so a run is tied to what it tested.
- **Short paths.** Tessera goes in `C:\Tessera`: under a long folder, some of its dependencies' paths pass Windows' 260-character limit and the build fails.
