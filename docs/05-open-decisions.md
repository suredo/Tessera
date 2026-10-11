# Decisions

Status: draft 0.4 · 2026-10-11 · The decision log (A1–A49) and remaining choices. This file stays the record for A1–A49; new decisions from M0 on get one ADR each ([ENG-08](04-engineering-practices.md#7-documentation)).

---

## Decided (2026-10-11)

| # | Decision | Choice | Notes |
| --- | --- | --- | --- |
| A1 | Scope of the first release | **General UI-on-demand platform** | Tools of any kind from everyday requests. Simulations are one kind, arriving in M5. |
| A2 | Where it runs | **Local-first web app** | Local Node server on 127.0.0.1 and the browser, single user. |
| A3 | How it reaches models | **Signed-in CLIs, for local development and testing** | The Claude Code and Codex CLIs on your machine: quick to connect, and they use plan allowance instead of per-token billing. The CLI problems become design rules (`CLI-*`). Temporary by design; see A47. |
| A4 | Stack | **TypeScript with standard tooling** | Strict TS, Prettier, ESLint, Vitest, Playwright, small vetted dependencies. |
| A5 | Providers in the first release | **Claude Code (M2), then the Codex CLI (M3)** | Both behind the same adapter interface and contract tests (`CLI-01`). Live acceptance runs use Claude Code unless you approve a Codex run. |
| A6 | POC code | **Fresh build, POC as reference** | New repository; port designs and tests deliberately. |
| A7 | Simulation engines | **Later milestone (M5)** | Core platform first. |
| A8 | Way of working | **Solo with AI assistants, GitHub with CI** | Pull requests into `main` and CI gates. Branch protection is not available for private repositories on GitHub Free, so the rules are kept by setup and habit (`ENG-15`). |
| A9 | Where data lives | **SQLite on the local server** | Survives browser changes; backup and export are easy; the browser holds no source of truth (`DATA-01`). Proposed limit: 256 KiB of structured data per tool. Images and other binary files live beside it as files (A48). |
| A10 | Languages | **English first, translatable** | All host text goes through a translation layer from day one; only English ships at first (`UX-05`). Generated tools follow the person's language. |
| A11 | Host UI framework | **React** | Generated tools stay plain HTML, CSS and JS in the sandbox, independent of React. |
| A12 | Built-in tools | **None. Every tool is created by the person** | The first interaction is always creating a tool. The focus is create, edit, save, update, reopen, undo. Examples, tool sets, capabilities, micro-apps and a tool store ("check the store first") may come later; nothing in the design may assume them. |
| A13 | Product framing | **An environment for UIs on demand** | People get the interface they need inside one environment, either by creating it now or by opening one they saved. Later, possibly from a shared store. |
| A14 | Runtime and tooling | **Node.js 22 LTS, pnpm workspaces, Vite, zod** | `.nvmrc` and `engines` pin versions for assistants and CI. zod schemas generate the TypeScript types and the JSON Schema passed to the CLI; verify zod's JSON Schema output against Claude Code's `--json-schema` in an M0 contract test. |
| A15 | React setup | **React 19 with the React Compiler** | The compiler handles memoization, so no hand-written `useMemo`, `useCallback` or `React.memo` unless profiling shows the compiler missed a case (with a comment saying so). Enforced with the React Compiler ESLint rules. |
| A16 | Repository visibility | **Private GitHub repository on GitHub Free** | Research sources and fixtures can be committed as they are; licensing can be decided later. GitHub Free (decided 2026-10-11) means no branch protection or rulesets for private repositories and a limited monthly Actions allowance (`ENG-02`, `ENG-15`). |
| A17 | Generation of big tools | **Two passes, as a starting point to measure** | When the intent stage judges a request as large: first a small working core (fast, verified), then features as edits. Measured in M2 against single-pass before it becomes final. |
| A18 | Default model routing | **Haiku 5.5 low for intent and data actions; Sonnet 5.5 medium for creation and repairs; Sonnet 5.5 low for edits; Sonnet 5.5 medium for research (M5); Opus only by explicit configuration** | Starting point; revisited with M2 metrics. Never an automatic expensive fallback. |
| A19 | Verification profiles | **Accepted: matching tools get hidden test hooks** | Profiles are internal, never shown as tools. A tool whose request matches a profile is asked for stable hooks so the host can verify it. This is what makes "create, edit, save, reopen" dependable. |
| A20 | Project name | **Tessera** | A single tile of a mosaic: each tool a person makes is one piece of their environment, and a later store of pieces fits the image. Works in English and Portuguese. A quick web search (2026-10-11) found no AI app builder with this name, only a software services studio. The private repository exists (`suredo/Tessera`). Workspace packages use pnpm's `workspace:` protocol, so no npm scope is needed while nothing is published. The npm scope, a domain and a basic trademark search are checked before anything goes public (M6). |
| A21 | Opening saved tools | **Both, clearly separated: Continue and Use again** | Continue opens the entry's linked workspace. Use again creates a new workspace from reusable defaults only and leaves that link unchanged (`DATA-07`, A44). |
| A22 | Judging scenarios | **Automatic host facts + AI technical review + your final verdict** | The AI reviewer checks fulfilment, standard style, working controls and coherence, the same way whichever model built the tool. You decide (`EVAL-02` to `EVAL-04`). |
| A23 | Portuguese scenarios | **Yes, a few** | Generated tools follow the person's language; the host stays English (`EVAL-06`). |
| A24 | Test applications | **A tiered catalogue: simple, medium, advanced; modularity later** | Simple: lists, charts, forms, calculators. Medium: video and film finder, article finder, research board, rule-based planners. Advanced: drawing, image and document editing, 2D and 3D simulation. Later: saving and reusing features across tools. See [06-test-scenarios.md](06-test-scenarios.md). |
| A25 | Vetted libraries in the sandbox | **Yes, a few** | Pinned, reviewed versions injected as declared capabilities (`CAP-04`): a chart library first (M3), three.js for 3D (M5). The UI standard covers chart styling. Each library is added by an ADR and updated deliberately. |
| A26 | First editing app | **Image editor** | Open a photo, crop, annotate, export: exercises files in and out and the canvas (`CAP-03`). The document editor comes later. |
| A27 | AI reviewer and screenshots | **Approved screenshots as image inputs; no file tools** | The reviewer gets approved, sanitized screenshots as image inputs (CLI-08). If an adapter cannot pass images, it reviews without them and the report says so. Image input is verified in M2. Other normal stages stay tool-free; research alone has web tools. |
| A28 | Finding saved tools by asking | **Yes: look in saved tools first** | The intent stage sees a short catalogue of saved tools; a match offers Continue or Use again; otherwise a new tool is created (`GEN-18`). The local form of the later "check the store first". |
| A29 | Platform and setup | **Windows first, with a launcher and a setup check** | Windows 10 and 11. A double-click launcher starts Tessera and opens the browser; a setup screen checks Claude Code and explains fixes. The product owner and testers are the first users; macOS, Linux and an installer come later (`PLAT-*`). |
| A30 | Saving | **Always auto-saved, plus a named library** | Every workspace, version and data change is stored as it happens. "Save to my tools" adds a named entry to the library (`DATA-08`). |
| A31 | Deleting | **Trash with 30-day restore** | Nothing is removed without passing through the trash; emptying it early needs confirmation naming what goes (`DATA-09`). |
| A32 | What a saved tool follows | **Its latest version** | Improvements are kept automatically; older versions stay restorable; "Save as a new tool" makes a variant. Future idea: a richer versioning system for tools (named versions, drafts or branches, comparison), which could also let the AI make bigger or complex changes in a draft before they replace the live version. |
| A33 | First live calls | **Two small spikes in M0: about 3 calls for the CLI contract, about 30 Haiku calls for intent routing** | Test the riskiest assumptions first: zod schemas accepted by Claude Code, the locked flags on the current CLI version, intact structured output, and how often a draft intent stage misroutes the POC's failure cases. Everything else up to M1 stays offline. |
| A34 | Estimates | **Relative sizes (S, M, L) only** | Real pace is measured after M0 and M1 and used to forecast the rest. |
| A35 | First real use | **Internal alpha after M2, early observed trials in M2/M3** | You use Tessera daily; a few invited outside testers exercise the lifecycle without coaching, in observed sessions on your machine (A3), using isolated data and separately approved live budgets. Findings feed M3/M4; broader trials remain in M6. Each milestone ends with your sign-off. |
| A36 | Pull request review | **AI review by the other assistant, then you merge** | Branch protection requires passing CI, not an approval (a solo owner cannot approve their own pull requests). Review checklist in the practices (`ENG-15`). |
| A37 | Development assistants | **Claude Code and Codex both develop, review, run and test** | Whoever writes, the other reviews. Both execute the app and tests; approved live evaluations retain the same budget rules. `AGENTS.md` is the single rules file; `CLAUDE.md` imports it. As product providers, Claude Code arrives in M2 and Codex in M3 (A5). |
| A38 | Models for development work | **Matched to the task** | Lighter models for bounded or mechanical work, stronger ones for design, difficult bugs and reviews (`ENG-22`). |
| A39 | Pull request size | **Small: one requirement or a small group, about 400 changed lines** | Excluding tests, fixtures and generated files; larger work split with a short plan (`ENG-21`). |
| A40 | "First attempt" in scenarios | **No user retry/rephrasing; automatic repairs counted** | The 85% target applies to predeclared AI-dependent steps only. Deterministic lifecycle steps are reported separately and must all pass; blocked required steps count in the denominator. |
| A41 | Profiles for M4 | **Items over time, editing with files in/out, and search results with selection** | T4, T14 and T7 respectively; earlier profiles cover the remaining M4 apps except drawing. T5 export is deferred to M4 with CAP-03. |
| A42 | Deadline for outside data (D11) | **Decided at the start of M4** | The first M4 task is a short session to pick the source, so the movie finder (T7) stays in the release acceptance. |
| A43 | Clean-machine setup test | **Windows Sandbox** | A throwaway clean Windows each time, built into Windows 11 Pro; used for the first-run scenario P1. |
| A44 | Reusable starting state | **Use again keeps reusable defaults only** | Defaults are declared separately from original-request/session entries and examples. Keeping session entries for future reuse requires an explicit user choice. |
| A45 | Restoring older interfaces | **Preserve current data; warn about incompatibility** | Check a copy first. If conversion would lose information, show the affected fields/records, warn and obtain confirmation. Keep a recovery snapshot; cancellation or an invalid conversion leaves the current unit intact (`DATA-10`). |
| A46 | Research ordering | **Research before engine implementation code** | A structured plan may precede research; implementation code follows a validated cited spec and reference checks. New unresearched mathematical behavior returns to research. Reuse of an already researched spec is allowed (`SIM-04`). |
| A47 | Connecting to models later | **API keys or the person's own provider account, then more providers** | Signed-in CLIs are for your own local use. Before anyone else runs Tessera on their own machine (M6 trials, the installer), connections move to API keys or the person's own account, behind the same adapter interface (`CLI-10`). Anthropic's Agent SDK documentation does not allow third-party products to offer claude.ai sign-in or subscription limits without prior approval. Later: other providers such as z.ai, Kimi and Grok, or a standalone app that connects to the person's own AI. |
| A48 | Storing images and other binary files | **A content-addressed file store in the data folder, indexed in SQLite** | Files are named by SHA-256, immutable, and referenced from tool data by ID (`DATA-11`). This keeps the database small and quick to back up, stores an image once however many versions use it, and makes undo and restore need no copies. Assets travel inside export archives. In the repository, only small cited screenshots and fixtures are committed; videos and full screenshot sets go to milestone releases (`ENG-10`). |
| A49 | Verifying tools that match no profile | **Try acceptance checks derived from the request (M3 experiment)** | A separate stage writes the checks, the generator exposes the hooks they name, and the host runs them (`VER-09`). Adopted as the default only if M3 measurements against your verdicts are good enough. |

---

## Open

### D7. Progress streaming

Requirements: `CLI-07`, `GEN-16`.

Claude Code has a streaming output mode. Open question: does it report useful progress while keeping the final structured output intact? If it does, the person sees real progress ("writing the interface…"). If not, the app shows the stage name and elapsed time.

**Recommendation:** run a spike (a short experiment) in M2. Fall back to elapsed time if streaming complicates the adapter.

### D9. Engine modularity

Milestone M5, requirement `SIM-06`.

In five live runs Claude always built one combined engine, ignoring the guidance to split reusable parts (L-38).

| Option | Meaning |
| --- | --- |
| a. Guidance only | Accept combined engines; reuse happens when it happens |
| **b. Host-enforced split for known building blocks** | The library ships a few base engines (queue, arrivals). Creating a new engine that duplicates one is rejected, and the model is told to use the base engine |
| c. Always ask the model to plan modules first | An extra planning call before any engine creation |

**Recommendation: b**, decided properly when M5 starts.

### D10. How visual the simulations should be

Milestone M5.

The POC planners showed lines and waits per station, not people moving as dots with a heat map, which was the experience designed in the plan.

| Option | Meaning |
| --- | --- |
| **a. Estimates first, movement later** | Queue estimates and a station view in M5; a movement engine (walking, doorways) as a follow-up |
| b. Movement from the start | Moving dots and a heat map in M5; heavier engine and generation, higher cost |

**Recommendation: a.**

### D11. Outside data for medium apps

Requirement: `CAP-02`. **Deferred, with a deadline: decided at the start of M4** (A42), before the movie finder (T7) is built and tested. Generated tools cannot use the network, so outside data always comes through host-owned providers. Which ones is open. There is a lot of content available, and the right sources depend on what the tests need.

Candidates noted so far:
- YouTube (Data API, needs a key). Its player needs a nested frame, which the sandbox blocks (`RUN-01`), so in the first release thumbnails arrive through the host as assets and videos open on YouTube (`CAP-02`)
- Internet Archive (free, no key; the POC's video provider)
- Public APIs for articles and papers (OpenAlex, Crossref, arXiv)
- Wikipedia and Wikidata

Rules any provider must follow are in `CAP-02`: host-owned, cached, records carry their source, and only the requested search terms/filters are sent. No unrelated workspace contents are forwarded. Part of this decision: whether host-proxied playback of a provider's media is worth adding later.

## Questions for you

Still open:

1. **D11:** outside data sources, at the start of M4.
2. **D7, D9, D10:** settle with a spike in M2 (D7) or when M5 starts (D9, D10).
