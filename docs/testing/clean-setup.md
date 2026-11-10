---
type: Test Design
title: "Clean setup in Windows Sandbox (P1)"
description: "How to run the clean-setup scenario P1 (A43, J0): start a throwaway Windows with Tessera downloaded and built but no Claude Code or Codex, then follow Tessera's setup check from 'missing' through 'not signed in' to 'ready', and make T1's first tool with each program."
tags: [testing, platform, setup]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-10T20:30:00Z }
---

# Clean setup in Windows Sandbox (P1)

P1 checks that a person can get from a fresh Windows to a first tool by following Tessera's own guidance (`PLAT-02`, `PLAT-03`, journey J0, [release acceptance](../spec/acceptance.md) item 7). It runs in **Windows Sandbox** (A43): a clean Windows each time, thrown away with everything in it, including any sign-in, when its window closes. The [catalogue](app-catalogue.md) defines the scenario; [the sandbox scripts](../code/scripts/sandbox.md) prepare it.

**It runs in M4's release run, not in M3 (A58).** **It makes live model calls, so it needs the owner's approval of its cap first** ([live evaluation](../practices/live-evaluation.md)).

# Once per machine

Windows Sandbox comes with Windows 11 Pro but is off by default. In PowerShell run as administrator:

```powershell
Enable-WindowsOptionalFeature -Online -FeatureName Containers-DisposableClientVM -All
```

Then restart Windows. The sandbox takes about 4 GB of memory while it runs, so close other heavy work first.

# Steps

1. **Start it.** In this checkout, run `powershell -ExecutionPolicy Bypass -File scripts\sandbox\p1.ps1 -CallCap <approved cap>`. It starts the sandbox with `origin/main` as last fetched (`-Commit <hash>` picks another). Tessera in the sandbox refuses any model call past the cap (`TESSERA_CALL_CAP`, ENG-07). Inside, a window downloads Tessera, installs Node and builds Tessera. That takes a few minutes, and ends with "Ready".
2. **Start Tessera:** double-click Tessera on the sandbox's desktop. Its window says the cap, and the browser opens at Tessera.
3. **Claude Code missing.** The setup check should say Claude Code isn't installed, with the exact fix (`PLAT-03`). Follow only what Tessera says, and note anything you had to find elsewhere.
4. **Not signed in.** Once Claude Code is installed, check again. It should say Claude Code isn't signed in, with the fix. Sign in as it says.
5. **Ready.** Check again: Claude Code is ready, and the setup check offers making a tool.
6. **First tool, Claude Code.** Ask T1's opening request: "I need a shopping list I can tick off at the store. We need milk, eggs, bread and apples." Note what happens and whether the tool works.
7. **Codex, the same way.** On the status screen, choose Codex. Follow the check from missing through not signed in to ready. Codex keeps a sign-in of its own for Tessera, which the fix names. Then ask the same request in a new workspace.
8. **Close the sandbox.** Everything in it is discarded, including both sign-ins.

At each step, take a screenshot (Win+Shift+S, then paste it into a file on the host through the clipboard) or write down what the screen said. Never ask a request twice: one that fails is recorded as failed.

# What to record

- Each setup-check screen's words, and whether its fix was enough to go on without looking anything up.
- Each first request's outcome, its call count and time, from the status screen or the request's details, and your verdict on the tool.
- Anything confusing, with the step it happened at. Each defect gets a lessons entry and a fix (`ENG-13`).

The results go in a report in `evals/reports/`.
