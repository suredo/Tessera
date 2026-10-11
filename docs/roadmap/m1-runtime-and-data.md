# M1: Runtime and data core (size L, no model calls)

**Goal:** a hand-written tool runs safely inside the host app, its data is always saved and versioned, and it survives everything.

This is the largest milestone. Split it into pull requests by area (storage and assets, runtime and bridge, data model and restore, host app) and report pace once storage and the runtime have landed.

| Deliverable | Requirements |
| --- | --- |
| Artifact contract and storage of immutable, hashed versions | CON-04, DATA-04 |
| Sandbox runtime: opposite-loopback wrapper, opaque child, CSP, MessageChannel bridge, one active runtime, watchdog | RUN-01, RUN-02 |
| Bridge API manifest with runtime enforcement (declared actions and capabilities, revisions, instance, no pre-activation writes); host clock in the bridge | CON-03, RUN-04, GEN-06, RUN-07, CAP-01 |
| Patch engine: stable IDs, sequential resolution, atomic batches, per-record revision checks, size limits | DATA-02, DATA-06 |
| Per-tool schema, separate reusable defaults/session data, bounded migrations, atomic code/schema/data activation and restore, recovery snapshots and loss-preview confirmation | DATA-03, DATA-07, DATA-10 |
| SQLite storage in the user data folder; always saved; trash with 30-day restore; export and import as archives; numbered schema migrations with backup before migrating | DATA-01, DATA-05, DATA-08, DATA-09, PLAT-04, ENG-18 |
| Asset store: content-addressed files with SQLite rows and references, type checks by content, limits, blob delivery over the bridge, removal only when unreferenced, assets inside export archives | DATA-11, DATA-05, DATA-09, RUN-01 |
| Staging and verification panel with rollback (with a stub check) | RUN-03 |
| Host stylesheets (accessibility floor, UI standard layer) | RUN-05, VER-06 (styles part) |
| Host app shell around a hand-written test tool: main screen, empty state, workspaces, saved-tools library with Continue and Use again, versions with restore, undo, trash, export and import screens; host accessibility checked in CI | APP-01 to APP-06, APP-08, APP-11, DATA-07, UX-07 |
| Launcher (start, free port, single instance, open browser); server bound to 127.0.0.1 with Host-header and same-origin checks on every route | PLAT-02, SEC-03 |
| Threat model and negative runtime/import/migration boundary tests. Executable migrations stay disabled until isolation is demonstrated; declarative migrations may be used first | SEC-01, SEC-05 |

**Exit criteria:**
- The POC's 13 boundary checks are ported to Playwright and pass.
- The 250-operation patch stress test is ported and passes.
- A chat-style patch planned before an in-tool edit to a different record still applies; one that touches the same record is rejected with a plain message.
- A hand-written tool shows an image asset through a `blob:` URL under the strict CSP. The asset survives a restart and an export/import round trip, and is removed only after nothing references it. Replacing it with a cropped copy, running cleanup, restarting and then undoing the crop brings the original back; once that undo entry is discarded, cleanup removes the original.
- Every change survives a server restart (always saved).
- The scripted trash-expiry scenario (P3) runs in CI.
- Delete to trash and restore round-trips, and expiry after 30 days works with a test clock.
- Export, wipe and import restores a workspace exactly.
- Continue targets the saved entry's linked workspace; Use again keeps defaults but drops original-session entries without retargeting Continue.
- Compatible restore preserves current data. Incompatible restore shows losses and requires confirmation; cancellation, failed migration and interrupted commits retain the committed unit. A recovery snapshot restores the pre-conversion unit.
- Lifecycle tests pass, including restoring minimized mode after a reload.
- The launcher starts one copy and finds a free port.
- Requests with a foreign Host header are refused.
- Host accessibility checks pass.

**From the POC:** the sandbox design (opposite-loopback wrapper, opaque child frame, strict CSP, MessageChannel bridge), the validated and atomic action batches with revision checks, the artifact contract with hashing, the default UI and accessibility stylesheets, and the 13 browser boundary checks. Port the behavior and the test cases, not the code style.
