# Patterns behind the issues

Most issues come from seven patterns. Fixing the pattern fixes the family.

1. **Trusting text instead of checking structure.** Model messages were taken as outcomes; regex did intent detection; self-reported flags were believed. Issues L-16, L-17, L-20, L-25, L-26, L-31, L-33, L-36, L-37, L-62. **Rule:** the model proposes structured data; the host verifies (P1, P2, P4).
2. **Two definitions of one thing.** The prompt said one thing and the check another; schemas were duplicated; contracts lived only in prose. Issues L-04, L-05, L-06, L-24, L-27, L-28, L-39, L-65. **Rule:** one definition, many uses (P3, CON-01, CON-03, VER-04, ENG-05).
3. **Untestable outputs.** Designs differed every run, so tests couldn't hold onto anything, and offline tests didn't predict live results. Issues L-08, L-10, L-15, L-40, L-68, L-69. **Rule:** verification profiles that ask matching tools for stable hooks (P5, VER-03), a host clock, and a test pyramid that includes automated browser tests, replays and live evaluations.
4. **No engineering baseline.** No version control, a synced folder, no formatter, local-only evidence, no retention policy, scattered handoffs. Issues L-01, L-02, L-03, L-07, L-11, L-13, L-14. **Rule:** the [engineering practices](../practices/index.md), from the first commit.
5. **Implicit external contracts.** CLI flags, executable paths, token fields, versions, billing and time limits were all discovered by failure. Issues L-35, L-44, L-45, L-46, L-47, L-51, L-52. **Rule:** adapter contract tests and probes, and limits set from measurements (CLI-02, CLI-03, GEN-11, TEST-02).
6. **Invisible failures.** Diagnostics were dropped, usage was missing, check failures were vague, progress was silent. Issues L-12, L-29, L-48, L-49, L-66. **Rule:** nothing invisible (P6, OBS-01, GEN-10, VER-07, ENG-16).
7. **Undefined product concepts.** Nobody had defined what save, reopen and reuse meant, or how a person gets back to a tool they made. Issues L-64, L-67. **Rule:** a [glossary](../product/glossary.md), and lifecycle requirements for each concept (DATA-07, DATA-08, DATA-09, GEN-18, APP-04).
