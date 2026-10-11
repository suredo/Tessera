# Acceptance for the first release

The first release (roadmap M4) is accepted when:

1. **Live evaluation.** The M4 scenario set ([the milestone scenario sets](../testing/milestone-sets.md)) passes in a budgeted live evaluation, with your final verdict (`EVAL-04`), and:
   - at least 85% of predeclared AI-dependent steps passing without user retry/rephrasing; automatic repairs are allowed, counted and reported (A40). Report deterministic lifecycle steps separately and require them all to pass. Failed/blocked required AI steps remain in the denominator; report counts, repeats and per-scenario results, not only a pooled percentage;
   - no unapproved data loss; explicitly confirmed incompatible restores retain a recoverable snapshot (`DATA-10`);
   - no false success message.

   All results are recorded in the ledger.
2. **Applicable mitigations verified.** Every lesson with a planned design mitigation due by M4 has implementation evidence and a regression test. The coverage report maps each lesson to a milestone and records proposed, implemented and verified status separately. Research/engine-specific L-37/L-42 and the engine case of L-31 are due in M5; Codex research compatibility L-44 is due when research runs on Codex, no earlier than M5. Other portions of a shared requirement remain due in their own milestone. A deferred item is visibly out of scope, never counted as a resolved release defect.
3. **Every tool is checked.** Every generated tool gets the smoke check, and tools matching a verification profile get behavior checks with visible status.
4. **The lifecycle works.** Create, edit, save, find by asking, Continue, Use again, restore a version, undo, delete to trash and restore all pass in scripted end-to-end tests and in the live scenarios.
5. **Portability.** Export and import round-trip a workspace, and a fresh clone runs all offline tests without local-only files.
6. **Cost and speed are known.** p50/p95 time and tokens per request type are reported against the speed targets (`OBS-04`), and the creation p95 fits within the stage limits.
7. **Setup works.** On a clean Windows machine (Windows Sandbox, A43), the launcher and setup check guide a tester from a fresh install to a first created tool (scenario P1).
