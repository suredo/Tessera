---
type: Requirement Area
title: "Host app"
description: "What the person sees and can do: main screen, workspaces, library, versions, trash, details (APP-01 to APP-11)."
tags: [spec, host-app, ui]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-11T20:21:39Z }
---
# Host app (`APP`)

What the person sees and can do. Visual design follows the same UI standard as generated tools, adapted for the host (`VER-06`).

| ID | Requirement |
| --- | --- |
| APP-01 | **Main screen.** A chat and a tool panel side by side on wide screens, stacked on narrow ones, with a resizable divider. The tool panel can be inline, expanded or full screen. Window controls (minimize, expand, full screen, versions, save, details) belong to the host, never to generated tools. |
| APP-02 | **First run and empty state.** With no workspaces, the screen invites the person to describe what they need. There are no example tools (A12). |
| APP-03 | **Workspaces.** A list of workspaces (name, last used, saved or not), with switching, renaming, and deleting to the trash. Switching keeps exactly one tool running (`RUN-02`), and the chat belongs to its workspace. |
| APP-04 | **Saved tools library.** The person's saved tools with name, short description, last update and search. Each entry offers **Continue** and **Use again** (`DATA-07`), plus rename, **Save as a new tool**, and delete to the trash. |
| APP-05 | **Versions.** For the current tool: versions with the change summary, time and verification results. **Restore** brings back older interface code as a new version while preserving current data. If compatibility conversion would lose information, show the affected fields/records and obtain confirmation before proceeding; retain a recovery snapshot. Cancel keeps the current version and data (`DATA-10`). **Undo** steps back one change at a time, for interface or data changes (`DATA-04`). |
| APP-06 | **Export and import** of a workspace or a saved tool to and from a file (`DATA-05`), with validation and a plain report of what was imported. |
| APP-07 | **Setup and status screen.** Claude Code status (installed, version, signed in), the data folder, storage size, and the probe (`CLI-02`, `PLAT-03`). |
| APP-08 | **Trash.** Deleted workspaces and saved tools, with restore and the date each will be removed. Emptying the trash early asks for confirmation and names what will be removed (`DATA-09`). |
| APP-09 | **Details view.** Source, versions, checks, the ledger and diagnostics, behind a "details" control and out of the person's way (`UX-06`, `OBS-01`). |
| APP-10 | **Progress and cancel** for running requests (`GEN-16`, `UX-02`). |
| APP-11 | **Accessible host.** The host app itself meets WCAG 2.2 AA: everything works by keyboard, controls are labelled, contrast is sufficient, focus is visible, and reduced motion is respected. It is tested with an automated accessibility checker in CI. |
