---
type: Requirement Area
title: "Host app"
description: "What the person sees and can do: main screen, workspaces, library, versions, trash, details (APP-01 to APP-11)."
tags: [spec, host-app, ui]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-26T13:42:59Z }
---
# Host app (`APP`)

What the person sees and can do. Visual design follows the same UI standard as generated tools, adapted for the host (`VER-06`).

| ID | Requirement |
| --- | --- |
| APP-01 | **Main screen.** Every tool opens in Focus, with chat and workspaces hidden. On wide screens the chat can float over the tool or dock beside it on the right with a resizable divider; on narrow screens it opens as a bottom sheet. The chat's preferred position is remembered for when it opens. One ask bar stays in a footer outside the tool's scroll area; typing leaves the layout alone, sending opens the chat, and the conversation can also be opened without sending. A tool declares a comfortable centred width (the default, at most about 1,100 px) or the full available width; expand always uses the full width. The tool panel can be expanded or full screen. Opening, closing or repositioning chat and workspaces preserves the running tool, its scroll position and unfinished input. Window controls (minimize, expand, full screen, versions, save, details) belong to the host, never to generated tools. |
| APP-02 | **First run and empty state.** With no workspaces, the screen invites the person to describe what they need. There are no example tools (A12). |
| APP-03 | **Workspaces.** A list of workspaces (name, last used, saved or not), with switching, renaming, and deleting to the trash. Switching keeps exactly one tool running (`RUN-02`), and the chat belongs to its workspace; what is said with no tool open is kept in the empty screen's own chat (A62). |
| APP-04 | **Saved tools library.** The person's saved tools with name, short description, last update and search. Each entry offers **Continue** and **Use again** (`DATA-07`), plus rename, **Save as a new tool**, and delete to the trash. |
| APP-05 | **Versions.** For the current tool: versions with the change summary, time and verification results. **Restore** brings back older interface code as a new version while preserving current data. If compatibility conversion would lose information, show the affected fields/records and obtain confirmation before proceeding; retain a recovery snapshot. Cancel keeps the current version and data (`DATA-10`). **Undo** steps back one change at a time, for interface or data changes (`DATA-04`). |
| APP-06 | **Export and import** of a workspace or a saved tool to and from a file (`DATA-05`), with validation and a plain report of what was imported. |
| APP-07 | **Setup and status, on the Settings page** (A101). Claude Code status (installed, version, signed in), the data folder, storage size, and the probe (`CLI-02`, `PLAT-03`). |
| APP-08 | **Trash.** Deleted workspaces and saved tools, with restore and the date each will be removed. Emptying the trash early asks for confirmation and names what will be removed (`DATA-09`). |
| APP-09 | **Details view.** Source, versions, checks, the ledger and diagnostics, behind a "details" control and out of the person's way (`UX-06`, `OBS-01`). |
| APP-10 | **Progress and cancel** for running requests (`GEN-16`, `UX-02`). |
| APP-11 | **Accessible host.** The host app itself meets WCAG 2.2 AA: everything works by keyboard, controls are labelled, contrast is sufficient, focus is visible, and reduced motion is respected. It is tested with an automated accessibility checker in CI. |
