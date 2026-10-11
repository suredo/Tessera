# User experience (`UX`)

| ID | Requirement |
| --- | --- |
| UX-01 | **Useful immediately.** A new tool shows something meaningful at once: the person's stated data (`GEN-05`), sensible defaults, or clearly labelled examples. It is never an empty form that needs several inputs before anything appears. It never invents the person's real data. (Every POC party planner opened empty and needed room size, stations and placement before Run did anything.) |
| UX-02 | **Progress and cancel** during generation (`GEN-16`, `APP-10`). |
| UX-03 | **Honest labels.** Estimates are labelled as estimates. Unverified behavior is labelled. Partial success is reported as partial. |
| UX-04 | **UI standard and accessibility floor** in every generated tool (`VER-06`, `RUN-05`); the host app meets WCAG 2.2 AA (`APP-11`). |
| UX-05 | **English first, translatable** (decided, A10). All host text goes through a translation layer from day one, so adding languages needs no code changes. Only English ships at first. No host text is hard-coded in components. |
| UX-06 | **Details view.** Source, versions, checks, ledger and diagnostics are behind a "details" control, not in the person's way (`APP-09`). |
| UX-07 | **Lifecycle.** Minimize, restore, reload and reopen keep data and the tool's place. The POC lost minimized mode on reload. |
