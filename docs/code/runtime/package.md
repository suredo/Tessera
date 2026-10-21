---
type: Code Package
title: "Runtime package"
description: "@tessera/runtime: the sandbox a tool runs in. The wrapper on the opposite loopback name, the tool's sandboxed frame under a strict CSP, and the one MessageChannel port between them and the host."
resource: ../../../packages/runtime/
implements: [RUN-01, SEC-05, SBX-01, SBX-02, SBX-03, SBX-04, SBX-05, SBX-06, SBX-07]
tests: [../../../packages/runtime/test/runtime.test.ts, ../../../packages/server/test/runtime-routes.test.ts, ../../../packages/web/e2e/sandbox.spec.ts, ../../../packages/web/e2e/boundary.spec.ts]
tags: [code, runtime, sandbox]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-21T21:53:48Z }
---

# Purpose

Runs a tool's code where it can't reach anything but the host's bridge (`RUN-01`). The host app (127.0.0.1) frames a wrapper on the opposite loopback name (localhost); the wrapper frames the tool in a `sandbox="allow-scripts"` frame whose document is served with a strict CSP, so its origin is opaque and it can load nothing but blob: images and media. The tool talks to the host only through one fresh MessageChannel port, bound to its frame and its mount's instance. Framework-free: tools are plain HTML, CSS and JS. The server serves the documents ([runtime routes](../server/runtime-routes.md)).

# Entry points

- `src/host.ts`: `mountTool`, the host app's side: it frames the wrapper and returns a `MountedTool` to send to and hear from the tool, and to hear when it was started again or stopped.
- `src/wrapper.ts`: the wrapper document's script. `src/tool-preamble.ts`: the first script in the tool's document, which says hello as the page loads, takes the port and gives the tool its one way to talk to the host, a global named tessera. Both are inlined by the server as plain scripts.
- `src/csp.ts`: `TOOL_CSP`, `TOOL_SANDBOX` and `wrapperCsp`, the documents' policies. `src/protocol.ts`: the message names (`HELLO_MESSAGE` among them), the tool's events (`TOOL_EVENTS`), `MAX_RESTARTS`, the two loopback names and `runtimeOriginFor`.
- `src/policy.ts`, imported as `@tessera/runtime/policy`: what the server needs, without browser code.

# Invariants

- **Two origins and a sandbox.** The host app is on 127.0.0.1, the wrapper on localhost (the same port), and the tool's document is sandboxed with scripts only, so its origin is `null`. The tool's document carries the sandbox in a header too, so it is sandboxed even if something framed it without the attribute.
- **The tool loads nothing.** Its CSP allows its own inline code and blob: images and media; network, fonts, frames from URLs, workers, objects, forms and base changes are refused. The boundary checks prove it in Chrome and Edge (`SBX-01` to `SBX-05`): a hostile test tool tries every kind of request, connection, resource, storage and worker, and neither the probe server nor the local server receives anything, not even a connection. One gap is the browser's: a frame navigation to a blocked address still makes Chrome and Edge resolve its name and connect, with no request sent ([#72](https://github.com/suredo/Tessera/issues/72)).
- **Nested frames are as confined as the tool (`SBX-06`, [ADR 0004](../../decisions/adr/0004-nested-frames-in-the-sandbox.md)).** Frames from a URL, `data:` or `blob:`, objects and embeds don't load. A `srcdoc` or `javascript:` frame inside the tool runs, since CSP doesn't govern it, but it inherits the tool's sandbox and CSP and has an opaque origin of its own, no bridge, no network, storage or popups. The tool can't write into a nested blank frame.
- **One port per page of the tool.** The wrapper accepts a mount only from the host app's origin, through its own parent window, with a port. The tool's page says hello from its own frame as it loads, and the wrapper answers with one fresh port; it drops messages of any other instance. The host's messages sent before that port exists wait for it, as the tool's do. A frame nested in the tool can't say hello for it.
- **The tool stays on its page (`SBX-07`).** When the tool navigates its own frame to a runtime document, by assigning `location`, a link, a reload or a refresh, the server answers "No Content", so the browser keeps the tool's page, its memory and its port. Any other page it leaves for (a blank one, or one the wrapper's policy blocks) loads without saying hello: the wrapper starts the tool again in a fresh frame with a fresh port, and the host hears `restarted`. After `MAX_RESTARTS` it stops the tool, and the host hears `stopped`. A second hello from the same frame counts as leaving too.
- **The protocol names are defined once** in `src/protocol.ts`; the inlined scripts repeat them, and a test keeps them equal. The server's guard takes the loopback names from here.

# Depends on / used by

Nothing at run time. The server's runtime routes serve its documents, and the host app (#53) mounts tools with `mountTool`. The bridge manifest and its enforcement (#46) build on the port.

# Pitfalls

- **The browser tests share one host:** `packages/web/e2e/support/sandbox-host.ts` starts the local server and the probe server, records every request both receive and every connection the probe accepts, and mounts tools on a small test page. A check resets it once the tool is ready, so whatever arrives after came from the tool.
- **A restarted tool forgets what it held in memory, and misses what was sent while it left.** A message the host sends after the tool leaves its page but before the host hears `restarted` goes to the page that left and is lost, so the host should send what the tool needs again when it hears `restarted`; the lifecycle (#45's next pull request, `RUN-02`) builds on this. Tests wait for `restarted` and the new page's hello before sending to it: a fixed pause raced the wrapper's one-second hello grace on CI's Windows runner.
- **A slow page may be taken for one that left.** The wrapper waits a second after the frame loads for its hello; a page that takes longer is started again.
- **The inlined scripts can't import.** Change a protocol name in `src/protocol.ts` and in both scripts, or the test fails.
- **Node prints an experimental warning** the first time the server strips the scripts' types (`stripTypeScriptTypes`), as it does for `node:sqlite`.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `src/csp.ts`: `TOOL_CSP`, `TOOL_SANDBOX`, `wrapperCsp`
- `src/host.ts`: `MountedTool` (type), `mountTool`
- `src/index.ts`: `packageName`, `TOOL_CSP`, `TOOL_SANDBOX`, `wrapperCsp`, `mountTool`, `MountedTool` (type), `APP_HOST`, `HELLO_MESSAGE`, `MAX_RESTARTS`, `MOUNT_MESSAGE`, `PORT_MESSAGE`, `RUNTIME_HOST`, `runtimeOriginFor`, `TOOL_EVENTS`, `ToolEvent` (type)
- `src/policy.ts`: `TOOL_CSP`, `TOOL_SANDBOX`, `wrapperCsp`, `APP_HOST`, `RUNTIME_HOST`
- `src/protocol.ts`: `MOUNT_MESSAGE`, `HELLO_MESSAGE`, `PORT_MESSAGE`, `TOOL_EVENTS`, `ToolEvent` (type), `MAX_RESTARTS`, `APP_HOST`, `RUNTIME_HOST`, `runtimeOriginFor`
