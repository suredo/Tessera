---
type: Test Design
title: "Test application catalogue"
description: "The test apps (simple, medium, advanced), platform scenarios and later modularity scenarios."
tags: [testing, app-catalogue]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-11T20:21:39Z }
---
# Test application catalogue

These apps are test examples only; the simulated person creates them from nothing.

Three tiers, from simple to advanced, plus a few platform scenarios. Each app entry names the request a simulated person might start with, what it exercises, the verification profile it suggests (`VER-03`), and any host capability it needs (`CAP-*`). Language "PT" marks the Portuguese variants.

## Platform scenarios

These have no app of their own. They test Tessera around the tools.

| ID | Scenario | How | Proves |
| --- | --- | --- | --- |
| P1 | **Clean setup** | In **Windows Sandbox** (A43), a fresh Windows each time: install the prerequisites, start the launcher, follow the setup check through "Claude Code missing", "not signed in" and "ready", then create a first tool (T1's opening request) | J0; release acceptance item 7 |
| P2 | **Move to another data folder** | Export a workspace and a saved tool, import them into an empty data folder, then continue working | `DATA-05`, portability |
| P3 | **Trash expiry** | Delete a tool, move the test clock 31 days forward, restart: the tool is gone; one deleted at day 29 is restorable | `DATA-09` (scripted only, no model calls) |

## Simple

| ID | App | Opening request (example) | Exercises | Profile | Needs |
| --- | --- | --- | --- | --- | --- |
| T1 | Shopping list | "I need a shopping list I can tick off at the store. We need milk, eggs, bread and apples." | Listing, starting data, tick off, grouping, use again weekly | Item list | — |
| T2 | Reading list (PT) | "Quero uma lista dos livros que quero ler, com nota de 1 a 5 e filtro por gênero." | Listing, ratings, sort and filter, Portuguese output | Item list, filtering | — |
| T3 | Spending chart | "Show my spending this month as a chart: rent 1200, food 450, transport 120, fun 200." | Charts from entered data, totals (1970), "what if food was 20% less?" (360, total 1880) | Chart from data | Chart library (`CAP-04`) |
| T4 | Habit tracker | "Help me track three habits every day: walk, read, drink water. Show my streaks." | Dates, streaks across next-day sessions, weekly chart | Items over time | `RUN-07` clock |
| T5 | RSVP form | "Make a form for my party guests: name, how many people, food allergies. Show me the answers." | M3: forms, validation/errors, answers. M4: export | Form with submissions | `CAP-03` for M4 export only |
| T6 | Tip and split calculator | "Split a bill of 87.50 between 4 friends with a 15% tip." | Exact numbers (total 100.63, 25.16 each). Since 4 × 25.16 = 100.64, how the tool handles the extra cent, and says so, is part of the test. Changing inputs | Calculation | — |

## Medium

| ID | App | Opening request (example) | Exercises | Profile | Needs |
| --- | --- | --- | --- | --- | --- |
| T7 | Movie and video finder | "Find old science-fiction films I can watch and let me keep a watchlist." | Searching an outside source, filter and sort, compare, watchlist, thumbnails delivered as assets, opening a video on its own site | Search results with selection | `CAP-02` data provider (source decided at the start of M4, D11); `DATA-11` assets |
| T8 | Article finder | "Find recent articles about sleep and memory and let me save the ones I want to read." | Search, save, tag, reading notes | Search results with selection | `CAP-02` (source decided with D11) |
| T9 | Research board | "Research whether standing desks help with back pain and show me the sources and what they say." | Cited findings, comparing sources, honest limits | Cited findings | `CAP-02` plus the research stage (M5) |
| T10 | Study planner (PT variant too) | "My exam is in two weeks. Help me organize topics; I study evenings, never Fridays. Later I'll paste notes to make flashcards." | Rules enforced, notes to cards, mixed requests, next day | Scheduling with rules, notes to cards | `RUN-07` clock |
| T11 | Tutor bookings | "A booking sheet for my tutoring: Monday to Thursday 2–7 pm, one-hour sessions, never double-booked." | Conflicts, "move João to Thursday 4 pm" when that slot is taken | Scheduling with rules | `RUN-07` clock |
| T12 | Family chores board | "A chores board for my family: Ana, Leo and me. Ana does laundry every Saturday." | Board, recurring items, filter "only mine", checking off in the tool | Item list (board) | `RUN-07` clock |

## Advanced

| ID | App | Opening request (example) | Exercises | Profile | Needs |
| --- | --- | --- | --- | --- | --- |
| T13 | Drawing board | "A simple drawing board where I can sketch with the mouse." | Pointer input, shapes, undo, "remove the red line" through chat | Smoke only, at first | — |
| T14 | Image editor | "Let me open a photo, crop it, add arrows and text, and save it." | Opening a file, canvas editing, export. **The first editing app tested** (A26) | Editing with files in and out | `CAP-03` file import and export; `DATA-11` assets |
| T15 | Document editor | "A simple editor for my notes with headings, lists and an outline on the side." | Rich text editing, structure, export. Tested after the image editor | Editing | `CAP-03` export |
| T16 | 2D simulation | "Will my party layout work for 120 guests? Where will lines form?" | Engines, research, run and compare, flow check (M5) | Simulation with a run control | Engines (M5); chart library (`CAP-04`) |
| T17 | 3D viewer or simulation | "Show the solar system in 3D and let me speed time up or down." | WebGL, animation, pause and speed, performance | Simulation with a run control | three.js as a vetted library (`CAP-04`, M5) |

## Later: modularity

Once the core is dependable, scenarios test reuse of **features**, not just whole tools. A person saves part of a tool (a chart panel, a search bar, a booking calendar). Later, when a new request needs something matching, Tessera offers or reuses that saved feature instead of generating it again. Example: build T3 (spending chart), save its chart; then request T4 (habit tracker), and the saved chart is reused for streaks. This depends on the POC's engine and modularity lessons (D9, L-38) and comes after M5.
