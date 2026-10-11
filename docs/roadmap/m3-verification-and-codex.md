# M3: Verification and the Codex adapter (size M, live budget about 65 calls)

**Goal:** the host knows whether a tool works. Every tool already gets static and smoke checks from M2; tools matching a verification profile now also get behavior checks.

| Deliverable | Requirements |
| --- | --- |
| Verification-profile registry (internal, not tools) with a first set chosen from the M3 scenarios (item list, filtering, chart from data, form, scheduling and cards). Each profile has hooks, schema, prompt part, synthetic fixture and behavior check, all from one definition | VER-03, VER-04, P3 |
| Versioned policy checks, including removing/replacing a previously verified restriction | VER-05 |
| UI standard checks completed: static style checks and custom mode | VER-06, UX-04 |
| Diagnostics with expected, observed, whose rule and unit hints; behavior repair loop | VER-07, GEN-09 |
| Verified status in the UI and details view | VER-08, UX-03 |
| Acceptance checks from the request (experiment): an acceptance stage, its hooks in the generation prompt, checks run before activation, results compared with your verdicts | VER-09, CLI-09 |
| AI technical reviewer, receiving approved screenshots as image inputs, and the human verdict in the evaluation report | EVAL-03, EVAL-04 |
| Codex CLI adapter behind the same interface: executable resolution, locked flags, clean environment, usage normalization, error mapping, version gate; the same contract tests as Claude Code's, plus one probe call (A5) | CLI-01 to CLI-05, CLI-08, TEST-02 |
| Codex boundary tests: no file or web tools in normal stages, clean environment, setup check covers Codex | CLI-03, CLI-08, PLAT-03, SEC-05 |
| `do` steps in scenarios, driving tools through profile hooks | EVAL-01 |
| First vetted library: a chart library, added by ADR and styled by the UI standard | CAP-04 |

**Live evaluation (provisional envelope about 65 calls, including reviews):** T1, T2 (Portuguese), T3, T5 and T10 cover the initial profiles, at about 10 calls each with review (T10 about 14). T5 covers form/submissions only; export waits for CAP-03 in M4. Add one unmatched-profile tool (about 7), acceptance-stage calls for the VER-09 experiment (about 8) and the Codex probe (1). Live scenarios run on Claude Code unless you approve a Codex run.

**Exit criteria:**
- Each profile's check catches a deliberately broken scripted candidate.
- The live run's checks pass, or fail with useful diagnostics.
- Profiles matched wrongly are counted, with fewer than 1 in 10 wrong.
- The AI review's agreement with your verdict is recorded.
- The VER-09 report gives meaningful, wrongly-failed and wrongly-passed rates against your verdicts, with a decision on adopting it.
- The Codex adapter passes the same contract tests as Claude Code's, and its probe is recorded.

**From the POC:** the study and flow check patterns (stable hooks, a synthetic fixture, checks driven in a hidden verification panel, failures sent to a behavior repair), the lesson that every checked requirement must be stated in the prompt, and the UI-standard enforcement (prompt part, layered stylesheets, static checks, custom mode).
