# Real-life test scenarios

Status: draft 0.4 · 2026-10-11 · Target evaluation design. Requirements refer to [02-spec.md](02-spec.md). These apps are test examples only; the simulated person creates them from nothing.

---

## 1. What a scenario is

A scenario is a short story about one person with a goal, played against a real Tessera. It includes:

- **A person and a goal, in everyday words:** "I need a shopping list I can tick off at the store", never "create a list component".
- **An empty start.** The person creates every tool.
- **Several sessions.** "The next day" is a step: the host clock moves forward, the page reloads, the person continues or reopens a saved tool. Waiting is simulated, never real (`RUN-07`). Each scenario sets its starting date and time, so it runs identically every time.
- **Mixed actions:** chat requests, the tool's own controls, undo, save, continue, use again, finding a saved tool by asking, deleting and restoring from the trash.
- **A language.** Most scenarios are in English; a few are in Portuguese (A23).
- **A budget:** the maximum model calls for its live run.

Model-driven scenarios have live and replay forms. P3 is scripted only; P1 also includes clean-machine/manual steps that model-output replay cannot reproduce.

| Form | Runs | Purpose |
| --- | --- | --- |
| **Live** | At milestones, with approval, under its call budget ([ENG-07](04-engineering-practices.md#6-live-evaluation-protocol)) | Real model behavior |
| **Replay** | In CI on every pull request, no model calls | Recorded answers pass through the real pipeline/checks (`TEST-04`). This protects handling of known outputs; it does not establish that changed prompts/models produce good new outputs. |

**How replay stays honest.** Recorded answers are fed in the order the stages ask for them. If the pipeline now asks for a stage the recording doesn't have (for example, after a prompt or routing change, `ENG-16`), the replay **fails with "needs a new live run"** instead of guessing or passing. Prompt-part versions are compared too: a replay recorded with older prompt parts is flagged as stale in the report.

---

## 2. Journeys every scenario set must cover

Each scenario covers several journeys. By M4 the set must cover all J0–J7. M2 intentionally omits automated hands-on `do` steps; M3 adds them. Earlier human exploratory sessions may exercise controls, with those observations labelled separately from automated evidence.

| | Journey | What it proves | POC evidence it guards against |
| --- | --- | --- | --- |
| J0 | **First run:** a clean Windows machine, the launcher, the setup check, the first tool | A tester gets from nothing to a first tool with plain guidance (`PLAT-02`, `PLAT-03`) | The POC needed manual CLI configuration (`claude.exe` path, sign-in) |
| J1 | **Create from nothing,** including stated starting data | A useful tool from one request (`GEN-05`, `UX-01`) | 120 stated guests were dropped; planners opened empty |
| J2 | **Grow it:** look-only, behavior, data and mixed requests | Each request goes to the right place and nothing else changes (`GEN-01`, `GEN-04`, `GEN-13`) | Style misrouted; behavior statements got questions; mixed requests lost a part |
| J3 | **Come back:** next day, reload, continue, use again, find a saved tool by asking ("open my shopping list") | Data, versions and the tool's place survive; saved tools are found, not rebuilt (`DATA-07`, `GEN-18`, `UX-07`) | Lost minimized state; browser-only storage |
| J4 | **A second, unrelated tool** | It opens separately; the first is untouched (`GEN-01`) | An unrelated request overwrote the current tool |
| J5 | **Mistakes:** undo interface, undo data, restore an older version, delete and restore from the trash | Undo and restore are safe and exact; nothing is lost (`DATA-04`, `DATA-09`) | Undo had to refuse overwriting newer work |
| J6 | **Limits:** ambiguous, impossible, cancel, very big | Honest answers, no invented data, recoverable (`GEN-08`, `GEN-17`, `UX-03`) | Fake success messages; 2-minute silent waits |
| J7 | **Hands-on:** use the tool's own controls, then change the same data through chat, and the reverse, including a chat change prepared while the person edits a different record | Controls and chat act on the same saved data and never contradict each other; unrelated edits never block each other (`DATA-02`) | Chat edits once changed the wrong record; a seeded write raced a user change |

---

## 3. Test application catalogue

Three tiers, from simple to advanced, plus a few platform scenarios. Each app entry names the request a simulated person might start with, what it exercises, the verification profile it suggests (`VER-03`), and any host capability it needs (`CAP-*`). Language "PT" marks the Portuguese variants.

### 3.0 Platform scenarios

These have no app of their own. They test Tessera around the tools.

| ID | Scenario | How | Proves |
| --- | --- | --- | --- |
| P1 | **Clean setup** | In **Windows Sandbox** (A43), a fresh Windows each time: install the prerequisites, start the launcher, follow the setup check through "Claude Code missing", "not signed in" and "ready", then create a first tool (T1's opening request) | J0; release acceptance item 7 |
| P2 | **Move to another data folder** | Export a workspace and a saved tool, import them into an empty data folder, then continue working | `DATA-05`, portability |
| P3 | **Trash expiry** | Delete a tool, move the test clock 31 days forward, restart: the tool is gone; one deleted at day 29 is restorable | `DATA-09` (scripted only, no model calls) |

### 3.1 Simple

| ID | App | Opening request (example) | Exercises | Profile | Needs |
| --- | --- | --- | --- | --- | --- |
| T1 | Shopping list | "I need a shopping list I can tick off at the store. We need milk, eggs, bread and apples." | Listing, starting data, tick off, grouping, use again weekly | Item list | — |
| T2 | Reading list (PT) | "Quero uma lista dos livros que quero ler, com nota de 1 a 5 e filtro por gênero." | Listing, ratings, sort and filter, Portuguese output | Item list, filtering | — |
| T3 | Spending chart | "Show my spending this month as a chart: rent 1200, food 450, transport 120, fun 200." | Charts from entered data, totals (1970), "what if food was 20% less?" (360, total 1880) | Chart from data | Chart library (`CAP-04`) |
| T4 | Habit tracker | "Help me track three habits every day: walk, read, drink water. Show my streaks." | Dates, streaks across next-day sessions, weekly chart | Items over time | `RUN-07` clock |
| T5 | RSVP form | "Make a form for my party guests: name, how many people, food allergies. Show me the answers." | M3: forms, validation/errors, answers. M4: export | Form with submissions | `CAP-03` for M4 export only |
| T6 | Tip and split calculator | "Split a bill of 87.50 between 4 friends with a 15% tip." | Exact numbers (total 100.63, 25.16 each). Since 4 × 25.16 = 100.64, how the tool handles the extra cent, and says so, is part of the test. Changing inputs | Calculation | — |

### 3.2 Medium

| ID | App | Opening request (example) | Exercises | Profile | Needs |
| --- | --- | --- | --- | --- | --- |
| T7 | Movie and video finder | "Find old science-fiction films I can watch and let me keep a watchlist." | Searching an outside source, filter and sort, compare, watchlist, thumbnails delivered as assets, opening a video on its own site | Search results with selection | `CAP-02` data provider (source decided at the start of M4, D11); `DATA-11` assets |
| T8 | Article finder | "Find recent articles about sleep and memory and let me save the ones I want to read." | Search, save, tag, reading notes | Search results with selection | `CAP-02` (source decided with D11) |
| T9 | Research board | "Research whether standing desks help with back pain and show me the sources and what they say." | Cited findings, comparing sources, honest limits | Cited findings | `CAP-02` plus the research stage (M5) |
| T10 | Study planner (PT variant too) | "My exam is in two weeks. Help me organize topics; I study evenings, never Fridays. Later I'll paste notes to make flashcards." | Rules enforced, notes to cards, mixed requests, next day | Scheduling with rules, notes to cards | `RUN-07` clock |
| T11 | Tutor bookings | "A booking sheet for my tutoring: Monday to Thursday 2–7 pm, one-hour sessions, never double-booked." | Conflicts, "move João to Thursday 4 pm" when that slot is taken | Scheduling with rules | `RUN-07` clock |
| T12 | Family chores board | "A chores board for my family: Ana, Leo and me. Ana does laundry every Saturday." | Board, recurring items, filter "only mine", checking off in the tool | Item list (board) | `RUN-07` clock |

### 3.3 Advanced

| ID | App | Opening request (example) | Exercises | Profile | Needs |
| --- | --- | --- | --- | --- | --- |
| T13 | Drawing board | "A simple drawing board where I can sketch with the mouse." | Pointer input, shapes, undo, "remove the red line" through chat | Smoke only, at first | — |
| T14 | Image editor | "Let me open a photo, crop it, add arrows and text, and save it." | Opening a file, canvas editing, export. **The first editing app tested** (A26) | Editing with files in and out | `CAP-03` file import and export; `DATA-11` assets |
| T15 | Document editor | "A simple editor for my notes with headings, lists and an outline on the side." | Rich text editing, structure, export. Tested after the image editor | Editing | `CAP-03` export |
| T16 | 2D simulation | "Will my party layout work for 120 guests? Where will lines form?" | Engines, research, run and compare, flow check (M5) | Simulation with a run control | Engines (M5); chart library (`CAP-04`) |
| T17 | 3D viewer or simulation | "Show the solar system in 3D and let me speed time up or down." | WebGL, animation, pause and speed, performance | Simulation with a run control | three.js as a vetted library (`CAP-04`, M5) |

### 3.4 Later: modularity

Once the core is dependable, scenarios test reuse of **features**, not just whole tools. A person saves part of a tool (a chart panel, a search bar, a booking calendar). Later, when a new request needs something matching, Tessera offers or reuses that saved feature instead of generating it again. Example: build T3 (spending chart), save its chart; then request T4 (habit tracker), and the saved chart is reused for streaks. This depends on the POC's engine and modularity lessons (D9, L-38) and comes after M5.

---

## 4. Scenario file format

Scenarios are data files in `evals/scenarios/`, readable by people and the runner. Example (shortened):

```yaml
id: T1-shopping-list
tier: simple
language: en
person: "A busy parent who shops once a week"
clock: { start: "2026-10-12T09:00", zone: "America/Sao_Paulo" }
budget: { calls: 9 }
profiles: [item-list]
steps:
  - say: "I need a shopping list I can tick off at the store. We need milk, eggs, bread and apples."
    expect: { created: true, profile: item-list, items: [milk, eggs, bread, apples] }
  - do: { hook: toggle-item, item: milk }          # the tool's own control (from M3)
    expect: { item: { milk: done }, version: unchanged }
  - say: "Group them by aisle."                    # look/structure change
    expect: { version: new, data: unchanged }
  - say: "Add cheese and take the apples off."     # data change through chat
    expect: { items: [milk, eggs, bread, cheese], version: unchanged }
  - undo: data                                     # the apples come back
    expect: { items: [milk, eggs, bread, apples], version: unchanged }
  - save: "Weekly shopping"
  - next-day: true                                 # host clock +1 day, reload
    expect: { data: unchanged }
  - switch: new                                    # an empty workspace
  - say: "Open my weekly shopping list"            # find by asking
    expect: { offered: saved, savedTool: "Weekly shopping", created: false }
  - use-again: "Weekly shopping"                   # same tool, fresh data, new workspace
    expect: { workspace: new, items: [] }
  - continue: "Weekly shopping"                    # original saved-entry link is unchanged
    expect: { workspace: original, items: [milk, eggs, bread, apples] }
review: [fulfilment, useful-at-first-sight, standard-style, controls-work, accessibility, messages, code-red-flags, coherence]
```

**Step types:**
- `say`: a chat request
- `do`: use one of the tool's controls, through a profile hook (from M3)
- `next-day`: move the host clock and reload
- `reload`
- `save`, `continue`, `use-again`: save the tool, or open a saved one in its two ways
- `undo`: undo an interface or data change
- `cancel`: cancel a running request
- `switch`: move to another workspace, or a new empty one
- `delete`, `restore`: move a workspace or saved tool to the trash and back

**Scenario fields:**
- `clock`: the starting date, time and time zone (`RUN-07`)
- `budget`: the maximum calls for the live run
- `profiles`: the verification profiles the person's tools should match
- `review`: the AI review items that apply (section 5.2)

**Expectations** are host-verified facts (section 5.1). For tools that match no profile, data expectations are limited to "unchanged" or "changed", compared by content hash, plus the smoke check.

T1 entries came from the original session request, so Use again excludes them. Add a defaults fixture with categories/units that survive reuse, while entries, completed flags and examples do not. M1 scripted restore cases also cover: compatible old code retaining today's data; incompatible conversion previewing affected fields/records; cancellation retaining everything; confirmation keeping a recovery snapshot; failed migration; and a write/crash during activation (`DATA-10`). M1 asset cases also cover replacing a photo with a cropped copy, running cleanup and restarting, then undoing the crop: the original must come back (`DATA-04`, `DATA-11`).

---

## 5. Judging

### 5.1 Automatic host facts (every step)

These are checked by the runner with no model:
- The tool was created or changed as expected, or not changed when it shouldn't be.
- Data is exactly as expected, and nothing unrelated changed.
- The smoke check and any profile behavior check passed.
- No false success: the message matches what the host applied (`GEN-08`).
- Time, calls and tokens are within the step and scenario budgets.

**First attempt** (A40): an AI-dependent step passes without user retry/rephrasing; automatic repairs are counted separately. Freeze the required AI-step denominator before the run, including steps blocked by an earlier failure. Report numerator/denominator, per-scenario results, repeats, repairs, time and tokens. The 85% target applies only to AI-dependent steps. Deterministic lifecycle steps are scored separately and must all pass. Small samples are milestone evidence, not a population success-rate estimate.

### 5.2 AI technical review (each scenario, `EVAL-03`)

After a live run, a separate reviewer model receives the requests, the final source of each tool version, the screenshots, the messages and the host facts. It returns a structured review with these items, named as in the scenario's `review` field:

| Item | Question |
| --- | --- |
| `fulfilment` | Does the tool do what was asked, at each step? (yes / partly / no, with evidence) |
| `useful-at-first-sight` | Does a new tool show something meaningful at once, instead of an empty form (`UX-01`)? |
| `standard-style` | Does it follow defaults where unspecified and preserve explicit user styles/custom designs? Does unrelated appearance stay consistent? |
| `controls-work` | Do exercised controls perform their labelled actions? Cite browser/host evidence. Source or screenshots alone cannot prove unexercised controls work; mark those unverified. |
| `accessibility` | Labels, names, focus, contrast, narrow layout |
| `messages` | Plain words, no internal terms, no claims beyond what the host did |
| `code-red-flags` | Startup data writes, reading the system clock instead of the host clock, ignored errors, unbounded loops |
| `coherence` | Does each change build on the last, or does the tool lose or reinvent parts? |

The reviewer receives approved screenshots as image inputs and has no file tools (`CLI-08`). It applies the same rubric whichever model built the tool. Its opinion supplements observed checks and cannot upgrade untested behavior to verified behavior.

### 5.3 Your final verdict (`EVAL-04`)

Each live evaluation produces a report with the video, screenshots per step, host facts, AI review and costs. You mark each scenario **accept**, **accept with notes** or **reject**, and your notes become lessons and issues. We also track how often the AI review agrees with your verdict, so we learn how far it can be trusted.

---

## 6. Scenario sets per milestone

| Milestone | Live set | Why these |
| --- | --- | --- |
| M2 (pipeline) | T1, T6, T13, plus a short J6 run (ambiguous, impossible, cancel), without `do` steps (they need verification profiles, from M3). P1 clean setup once in Windows Sandbox | Creation, data, edits and honesty across simple and advanced tiers; first run |
| M3 (verification) | T1, T2 (PT), T3, T5 without export, T10; one unmatched-profile tool | Initial list, filtering, chart, form, scheduling and cards profiles. The unmatched tool tests acceptance checks from the request (`VER-09`). Include changing/removing a scheduling policy. |
| M4 (first release) | T1, T3, T4, T5, T7, T10, T11, T12, T13, T14; T2 and T10 in Portuguese; P1 and P2 | 12 app runs plus 2 platform runs, covering J0–J7. New profiles: items over time (T4), files-in/out editing (T14), search/selection (T7). T12 also exercises time rules. Drawing stays smoke-only. T5 export starts here. |
| M5 (engines) | T9, T16, T17 | Research, engines, simulation profile |
| M6 (hardening) | M4 set across the model matrix (Claude Code models and Codex); T8 article finder; T15 document editor | Consistency whichever model builds the tool; the remaining catalogue apps |

P3 runs scripted in CI from M1. The [roadmap envelopes](03-roadmap.md#live-budget-summary) must be reconciled against per-stage calls for every required run and review before approval.

---

## 7. Decisions from these discussions

| Topic | Decision |
| --- | --- |
| Opening saved tools | Continue and Use again, clearly separated (A21) |
| Judging | Host facts, AI technical review, your final verdict (A22) |
| Languages | A few scenarios in Portuguese (A23) |
| Test apps | Tiered catalogue; modularity later (A24) |
| Charts and 3D | A few vetted libraries in the sandbox (A25) |
| First editing app | Image editor (A26) |
| Reviewer screenshots | Approved screenshots as image inputs; no file tools (A27, CLI-08) |
| Images and files in tools | A content-addressed asset store in the data folder (A48, DATA-11) |
| Tools matching no profile | Acceptance checks from the request, as an M3 experiment (A49, VER-09) |
| First attempt | No retry or rephrasing by the person; automatic repairs allowed, counted and reported (A40) |
| M4 profiles | Items over time, editing with files in/out and search results with selection (A41) |
| Outside data sources | Decided at the start of M4, so T7 stays in the release acceptance (A42, D11) |
| Clean-machine setup | Run in Windows Sandbox (A43) |
