---
type: Evaluation Report
title: "UI redesign: closing report"
description: "What the UI redesign milestone delivered, each exit criterion with its evidence, the final comparison of all seven mockup states, the full suite on the closing commit, live calls, what the milestone learned, and where each open item goes. Waiting for the owner's hands-on testing and sign-off."
tags: [reports, milestone, ui-redesign]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-26T00:12:27Z }
---

# UI redesign: closing report, 2026-11-25

Milestone: [UI redesign: the tool comes first](../../docs/roadmap/ui-redesign.md). **Status: waiting for the owner's hands-on testing and sign-off.**

The goal was that the tool comes first: it opens at its declared width with the conversation and workspaces out of the way, one ask bar in a footer, a 64 px header with every tool action, and a phone layout. The seven mockup states in `design/ui-redesign/` are the approved design.

## What was delivered

26 pull requests merged, #409 to #438 (#409, #410, #417, #419, #421 to #436, #438), each reviewed by Codex before merging. Issues #411 to #415 and #420 are closed; #416 closes with this report's sign-off.

| Deliverable | Pull requests | Result |
| --- | --- | --- |
| Approved scope, mockups and the reworded `APP-01` | #409 | Delivered |
| Tools declare `comfortable` or `wide`, in the contract, prompt and check; earlier tools stay readable (#411) | #410 | Delivered; checked live in two calls ([width check](2026-11-20-ui-width.md)) |
| The header with Undo, History, Save, full screen and one More menu (#412) | #417, #423, #427, #428, #435 | Delivered |
| The workspaces drawer, replacing the left column (#413) | #419, #429 | Delivered |
| Focus, the footer ask bar, and the conversation floating in four corners or docked on the right, remembered (#414) | #421, #425, #426, #433 | Delivered |
| The phone screen and the conversation as a modal bottom sheet (#415) | #431, #432 | Delivered |
| The look: the sage tints, fewer borders, text actions, the mockups' sizes, icons and colors (#416) | #430, #433, #435, #436 | Delivered, with the departures the owner approved (below) |
| A rule and a tool for comparing the app with its design: `ENG-32` (A93) and `pnpm design:compare`, at the browser tests' widths and at each mockup's own size, with measured differences | #424, #434 | Delivered |

Also: the roadmap's status corrected (#422), and one browser test quarantined under `ENG-20` (#438, issue #437).

## Exit criteria

| Criterion | Result | Evidence |
| --- | --- | --- |
| All seven mockup states work at the relevant desktop or phone width, with the host keeping its workspace, library, version, import, trash and setup actions | Met | The final comparison below; the browser specs `chat-layout`, `tool-header`, `workspace-drawer`, `app`, `history`, `library`, `trash`, `archives` and `status` in the full suite |
| Switching chat or drawer state keeps the running tool, its scroll and unfinished input | Met | "APP-01, APP-11, RUN-02: chat toggles, floating corners and docking preserve runtime, input and scroll"; "modal drawer contains focus and preserves the tool, input and scroll"; "header panels keep the running tool, unfinished input and its scroll" |
| The width declaration is checked from one contract definition, schemas agree, and earlier tools stay readable | Met | #410's contract and compatibility tests; the generated schemas' test |
| Browser checks at 1280 px and 320 px: keyboard, modal focus containment and return, automated accessibility | Met | The layout specs run at both widths (A56); axe checks in `a11y`, `tool-header`, `workspace-drawer` and `chat-layout`; the sheet's and drawer's focus tests |
| CI passes and the owner signs off this report; no live calls beyond the approved four | CI met; sign-off pending | The full suite below; 2 of the 4 approved calls used |

## The final comparison (`ENG-32`)

On `cf569fe`, `pnpm design:compare` compared each state with its mockup at the mockup's own size (1440x900, 390x844), with a stored conversation, and at 1280 and 320 px. I read all seven same-size pairs and each measured-differences list. Each difference left is one the owner approved:

| State | Result |
| --- | --- |
| a-focus | Matches, apart from the approved differences |
| b-chat-floating | Matches, apart from the approved differences |
| c-chat-docked | Matches, apart from the approved differences; the conversation opens 380 px wide |
| d-workspaces-open | Matches, apart from the approved differences |
| g-wide-tool | Matches, apart from the approved differences |
| e-mobile | Matches, apart from the approved differences |
| f-mobile-chat | Matches, apart from the approved differences |

The approved departures, each recorded in the [decision log](../../docs/decisions/decision-log.md):

- **A89:** the tool's card fits its page (at least 20rem), not the mockup's fixed 700 px.
- **A94:** no "Today · tool" line above the messages; the Position menu lines up with its button.
- **A95:** each recent row keeps its More menu, shown on hover or focus.
- **A96:** the tool's page keeps the UI standard's #f9faf8; the ask bar keeps the controls' #81867e border.
- **A97:** the scrollbar's reserved room, so the tool sits 7.5 px left of centre or is 15 px narrower; Save's darker border; the floating title after its grip; the UI standard's text colors; 44 px Send and phone Open conversation, so the ask field is narrower.
- **A98:** Close conversation stays 44 px; the drawer search keeps the controls' border.
- **A99:** the docked divider's handle is darker than the mockup's, for 3:1 contrast.

Not differences in the app: the mockups show other sample tools and content; `d-workspaces-open`'s page is 18 px taller than its window; the mockup's New tool plus is drawn green on green by its own stylesheet; the phone mockups draw a home indicator.

**Not checked:** hover and focus styles against the mockups, real phones, screen readers, and windows other than these four sizes. The comparison is by eye and by measuring named parts; a part no selector names is seen only in the pictures.

## The full suite on the closing commit

The closing commit is `cf569fe` on `main`, the merge of #436. CI's [run 45724895176](https://github.com/suredo/Tessera/actions/runs/45724895176) there: **every job passed** (`ENG-31`).

| Check | Result |
| --- | --- |
| typecheck, lint, format:check, secrets, build | passed |
| unit tests (`test`) | passed: 120 files, 1,235 tests |
| OKF check, merge-ready, coverage | passed |
| Windows platform | passed |
| Windows browser tests, three parts | passed: **395 passed, 2 skipped**, in Chrome, every spec at 1280 px and the layout specs at 320 px |

The two skipped tests are quarantined under `ENG-20`: `file-pick.spec.ts:108` (#437, M4) and `samples.spec.ts:28`, whose issue #214 was closed while the test is still skipped. Neither belongs to this milestone; both are listed below.

## What the milestone learned

- **Behaviour tests don't check a design.** The first four slices passed every test and review while a menu opened in the wrong corner and most of the mockups' look was missing. `ENG-32` now asks each look-changing pull request to compare named mockup states, and only the owner approves a departure.
- **Scaled pictures hide sizes, and "matches" by eye was often wrong.** Pairs of a 1440 px mockup shrunk beside a 1280 px app hid a 16 px strip under the footer, stretched drawer rows and a 40 px Send that three pull requests called 44 px. Measuring at the same size found them; `pnpm design:compare` now does both.
- **Measuring isn't enough either.** After the measurements showed only approved differences, reading the pictures found a missing divider handle (removed by a fix in #433), other icons and paragraph gaps. The final check reads every picture as well.
- **Matching a mockup can break a rule.** The mockup's handle had 2:1 contrast, under the 3:1 `APP-11` needs; Codex's review caught it, and the owner chose the darker one (A99).
- **A reviewer that can't render reviews by reading.** Codex's sandbox can't start Chrome, so the author's renderings were the only rendered evidence; each review said so.

## Live calls

**2 of the 4 calls the owner approved** on 2026-11-20, for the width check ([report](2026-11-20-ui-width.md)), billed as plan use. No other live call was made.

## Coverage

From `pnpm coverage` on `cf569fe` (current milestone M4): 173 of 189 requirements due are verified, 16 proposed. The redesign's requirements, `APP-01` to `APP-11` and `RUN-02`, are among the verified ones.

## Open items and where they go

| Item | Where it goes |
| --- | --- |
| #416, verify and polish all seven states | Closes with this report's sign-off |
| #418, Chrome's `ERR_NO_BUFFER_SPACE` in CI | Moved to M4 with the owner's approval, 2026-11-24 |
| #437, the quarantined `file-pick` test | M4, where its test belongs; fixed before M4 closes (`ENG-20`) |
| `samples.spec.ts:28`, still quarantined under the closed #214 | Not this milestone's; to reopen #214 or file a new M4 issue, for the owner to choose |
| Pages with no mockup: History, Details, My tools, Trash, Connections, Setup | They take the new tints and header but keep their outlined buttons; no approved design covers them |

## For the owner's test

Run `pnpm dev` and try: each tool opening in Focus; the conversation floating, moved to each corner, docked and resized, and remembered after a reload; the drawer from the header, with search and a row's More; a wide tool; full screen and Expand; and a narrow window or a phone, with the sheet. The side-by-side pictures are in `test-output/design-compare/` after `pnpm build` and `pnpm design:compare`.

**Sign-off:** pending.
