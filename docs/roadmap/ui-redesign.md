---
type: Milestone
title: "UI redesign: the tool comes first"
description: "The separate UI redesign milestone: the tool at its declared width with chat and workspaces hidden by default, chat floating or docked on the right, one ask bar, a 64 px header, and a phone layout."
tags: [roadmap, ux, app, redesign]
status: draft
generated: { by: codex/gpt-6, at: 2026-11-20T21:34:00Z }
---
# UI redesign: the tool comes first

The owner approved this scope on 2026-11-20 as a separate **UI redesign** milestone. It changes how the host app frames tools (`APP-01` to `APP-11`), not how tools are generated, except for one new declaration (below). The mockups are in `design/ui-redesign/` (`overview.html` first); `design/ui-redesign/render.mjs` renders them with Playwright: `node design/ui-redesign/render.mjs design/ui-redesign <out folder> '[["a-focus.html",1440,900]]'`.

## Why

A review of the current app (ten screenshots, three design rounds) found: the tool gets about half the screen at 1280 px; every workspace card repeats Save, Rename, Export and Move to trash; Undo and history sit below the tool, out of sight; on a phone the screen is navigation and cards before any tool; and everything has the same borders and weight.

## The design

| State | Mockup | What it is |
| --- | --- | --- |
| Focus, the default | `design/ui-redesign/a-focus.html` | Workspaces closed, chat hidden, the tool at its declared width, an ask bar in a footer |
| Floating chat | `design/ui-redesign/b-chat-floating.html` | The conversation over the tool on the right, about 380 px, movable, with a position menu |
| Docked chat | `design/ui-redesign/c-chat-docked.html` | The conversation beside the tool on the right; the tool narrows; a resizable divider |
| Workspaces | `design/ui-redesign/d-workspaces-open.html` | A drawer over the tool: New tool, My tools, recent work with search, Import, Connections, Trash, Setup and status |
| A wide tool | `design/ui-redesign/g-wide-tool.html` | A board that declares wide uses the full width |
| Phone | `design/ui-redesign/e-mobile.html`, `design/ui-redesign/f-mobile-chat.html` | The tool full screen; the conversation as a bottom sheet; the ask bar at the bottom |

- **Header, about 64 px:** a Workspaces control, the tool's name with a quiet "Changes kept on this computer" (and "In My tools" only when it is), Undo, History, an outlined Save to My tools, full screen, and one More menu (Rename, Save as a new tool, Export, Details, Minimize, Expand, Move to trash). No "YOUR TOOL" row and no second menu. On a phone: Workspaces, the title, Undo and More only.
- **Tool width:** each tool declares `comfortable` (centred, about 1,100 px at most; the default) or `wide` (the full width), as part of what generation produces, beside its UI mode. Expand always gives the full width.
- **One way into the chat:** the ask bar in its own footer, the tool's scroll area ending above it. Typing changes no layout; sending opens the conversation in the chosen position and shows progress (`APP-10`); an "Open conversation" button opens it without sending.
- **Chat position:** a menu in the chat's header, "Float over tool" or "Dock beside tool", remembered; the floating panel can be moved to four corners, by pointer or keyboard. Floating chat is non-modal; the workspaces drawer and the phone sheet are modal (focus contained, Escape closes, focus returns to the opener).
- **Kept across panel changes:** the tool's scroll position and the field the person was typing in.
- **Look:** the same sage palette and system fonts, fewer borders and boxes, text actions in place of outlined buttons, 44 px targets.

## Approved decisions

1. **Reword `APP-01`** in `docs/spec/app.md`: the chat is hidden, floating or docked on wide screens, and a bottom sheet on narrow ones.
2. **The width declaration** (`comfortable` or `wide`) belongs in the artifact contract, the creation prompt and its check: a contract change (`P3`). Existing tools must remain readable.
3. **The default:** every tool opens in Focus; the chat's position is remembered for when it opens.
4. **Scheduling:** a separate UI redesign milestone; it does not change the scope of M0-M6.

## Exit criteria

- All seven mockup states work at the relevant desktop or phone width, with the host retaining its existing workspace, library, version, import, trash and setup actions (`APP-01` to `APP-10`).
- Switching chat or drawer state preserves the running tool, its scroll position and in-progress input (`RUN-02`, `APP-01`).
- The width declaration is validated from one contract definition, generated schemas agree, and earlier stored tools remain readable (`CON-01`, `CON-04`).
- Browser checks cover the desktop states at 1280 px and phone states at 320 px, keyboard operation, modal focus containment and return, and automated accessibility (`APP-11`).
- CI passes and the owner signs off the milestone report. No live calls are authorized by this milestone; any live prompt evaluation requires a separate approved budget (`ENG-07`).

## Suggested pull requests

Progress: the first slice is implemented on `feat/ui-width`, with contract 4 compatibility and generated schemas. The host layout is still pending. The creation prompt's live check needs a separately approved budget (`ENG-07`, `ENG-16`).

1. `APP-01` reworded and the width declaration in the contract, prompt and check, with tests.
2. The header and the single More menu; Undo and History in it; history as a panel.
3. The workspaces drawer replacing the left column.
4. The ask bar and the conversation panel, floating and docked, with the position menu and its memory.
5. The phone layout with the bottom sheet.
6. Visual polish, and browser tests at 1280 and 320 px for each state, with an accessibility pass (`APP-11`).
