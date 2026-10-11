---
type: Requirement Area
title: "Runtime and sandbox"
description: "The sandbox, one active runtime, staging before activation, bridge enforcement and the host clock (RUN-01 to RUN-07)."
tags: [spec, runtime, sandbox]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-11T20:21:39Z }
---
# Runtime and sandbox (`RUN`)

Port the POC design; it held up in every boundary test.

| ID | Requirement |
| --- | --- |
| RUN-01 | **Sandbox.** Generated code runs in an opaque-origin `sandbox="allow-scripts"` child frame inside a wrapper on the opposite loopback host (127.0.0.1 versus localhost). A strict CSP blocks network, storage, workers, nested frames and navigation; images and media load only from local `blob:` URLs made from assets the host handed over (`DATA-11`). The bridge is a fresh MessageChannel bound to the expected frame and instance. |
| RUN-02 | **One active runtime.** Exactly one tool executes at a time. Minimized and suspended tools are disposed (frames, channels, timers), and a watchdog recovers from busy loops. |
| RUN-03 | **Staging before activation.** A candidate first mounts in a hidden verification panel against synthetic data. It is activated against real data only after its checks pass. On failure the previous version is restored. |
| RUN-04 | **Bridge enforcement.** Every bridge call is checked against the manifest (`CON-03`), the tool's declared capabilities, the current revision and the instance identity. Calls before activation are rejected (`GEN-06`). |
| RUN-05 | **Host stylesheets.** An accessibility layer (visible focus, reduced motion) always loads. The UI standard layer loads in standard mode (`VER-06`). |
| RUN-06 | **Supported browsers.** Chrome and Edge are tested in CI (`TEST-06`); Firefox is best effort. Embedded browser panes that cannot load nested sandboxed frames are documented as unsupported. (The Claude desktop app's built-in pane could not mount POC tools.) |
| RUN-07 | **Host clock.** The bridge provides the current date and time (`now()`, today's date, time zone). Generated code uses it instead of reading the system clock. Static checks flag direct `Date.now()` or `new Date()` without arguments (`VER-01`). Tests set the clock, so "the next day" is simulated, never waited for. (The POC had past-dated defaults, and date-dependent tools could not be tested.) |
