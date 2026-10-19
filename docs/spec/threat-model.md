---
type: Requirement Area
title: "Threat model and boundary checks"
description: "Tessera's trust boundaries, what M1 tests and what it leaves open, and the numbered negative checks for the sandbox, bridge, imports, assets and migrations (SBX, BRG, IMP, AST, MIG)."
tags: [spec, security, threat-model, sandbox]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-19T00:35:35Z }
---
# Threat model and boundary checks

This is the threat model `SEC-05` asks for. It names what Tessera protects, where untrusted input crosses into trusted code, which milestone tests each crossing, and the negative checks that test it. Each check has an ID, so a test can name it and the [coverage report](../code/scripts/coverage-report.md) can follow it (`ENG-17`).

A check that passes shows that the attempt it describes failed, in the browsers and on the date it ran. It is not proof that the boundary is safe in general. Reports and pull requests say which checks ran and what is still open, never "secure" or "safe" on their own.

## What is protected

- **The person's data:** workspaces, versions, tool data, assets and the trash in the user data folder (`PLAT-04`), and their integrity: nothing changes except through the host's checked paths (`DATA-02`, `DATA-10`).
- **The machine:** files outside the data folder, other processes, the network, and the CLI sign-ins (`CLI-08`).
- **What leaves the machine:** nothing a tool holds reaches the network, and nothing reaches a model except what a stage sends on purpose (`SEC-02`, `DATA-11`).
- **The host itself:** one tool can't read or change another tool's data, the host's interface, or its versions.

## Who is untrusted

| Source | Why it is untrusted |
| --- | --- |
| Generated code: tool HTML, CSS and JavaScript, and later migrations and engines | A model wrote it, possibly steered by text it read (`SEC-02`); it may be wrong or hostile. |
| Imported archives | They may come from someone else, or be edited by hand. Their tool code is generated code. |
| Web pages the person visits | They can send requests to loopback addresses and rebind DNS names (`SEC-03`). |
| Research sources and outside data (M5, `CAP-02`) | Their text may try to instruct a model (`SEC-02`). |

**Trusted, and out of scope:** the person, their Windows account and anything running under it, the browser (Chrome or Edge, `RUN-06`) and its sandbox, Node, the signed-in CLIs and the model providers behind them, and the pinned dependencies (supply chain review is M6's audit). Malware on the machine, a hostile browser extension and physical access are not defended against. Data at rest is not encrypted.

## Trust boundaries

| Boundary | Untrusted side | What it must stop | Requirements | Checks | Tested in |
| --- | --- | --- | --- | --- | --- |
| Generated UI: the sandbox | Tool code in the opaque child frame | Network, storage, workers, nested frames, navigation, popups, reaching the host page, talking outside the bridge | `RUN-01`, `RUN-02`, `RUN-06` | SBX-01 to SBX-13 | M1, the sandbox ([#45](https://github.com/suredo/Tessera/issues/45)) |
| The bridge | Messages from tool code | Calls that are malformed, undeclared, stale, from the wrong instance, before activation, or that ask for paths or other workspaces | `RUN-04`, `CON-03`, `CAP-01`, `GEN-06`, `DATA-02` | BRG-01 to BRG-07 | M1, the bridge ([#46](https://github.com/suredo/Tessera/issues/46)); revisions with the patch engine ([#47](https://github.com/suredo/Tessera/issues/47)) |
| Data and migrations | A tool's declared schema, defaults and migrations | Code running in the server, migrations reaching beyond the tool's own data, partial or stale activation | `DATA-03`, `DATA-10`, `SEC-01` | MIG-01 to MIG-06 | M1, schema and migrations ([#50](https://github.com/suredo/Tessera/issues/50)) |
| Assets | Bytes a tool, a person or an archive hands over | Files that aren't the image types they claim, oversize files, reads outside the asset store, paths reaching a tool, cross-workspace reads | `DATA-11`, `DATA-09` | AST-01 to AST-06 | M1, the asset store ([#49](https://github.com/suredo/Tessera/issues/49)) |
| Imports | An archive file | Writing outside the import's own folder, oversize or bomb archives, malformed or newer formats, hash mismatches, executable content, overwriting existing work | `DATA-05`, `SEC-01` | IMP-01 to IMP-07 | M1, export and import ([#48](https://github.com/suredo/Tessera/issues/48)); assets in archives with [#49](https://github.com/suredo/Tessera/issues/49) |
| The local server | Web pages and other local processes | Requests from foreign `Host` headers and other origins | `SEC-03`, `PLAT-02` | Its own tests | M1, the launcher and server ([#54](https://github.com/suredo/Tessera/issues/54)) |
| The trusted CLIs | Prompts that carry untrusted text | File tools, web tools outside research, a leaked environment, a stage with more tools than it needs | `CLI-03`, `CLI-08`, `SEC-02`, `SEC-04` | Not yet numbered | M2 for Claude Code; M3 for the Codex tool policy |
| Research and engines | Web pages read during research; engine code | Instructions taken from sources; engine checks reaching files, network or processes | `SEC-01`, `SEC-02`, `SIM-02`, `SIM-04` | Not yet numbered | M5 |

## What M1 covers, and its limits

M1 tests the sandbox, the bridge, imports, assets and migrations, each in the issue that builds it, plus the server's `Host` and origin checks. It makes no model calls, so every tool in its tests is hand-written, including hostile ones written to attempt each check.

Its limits, which stay open after M1:

- **The browser is trusted.** The checks show that the listed attempts fail in Chrome and Edge as tested. A browser bug that escapes the iframe sandbox or ignores the CSP is outside them. Firefox is best effort and not tested; embedded panes that can't mount sandboxed frames are unsupported (`RUN-06`).
- **Inside its frame, a tool can still mislead.** It can show false or alarming content, or ask the person to type something. The sandbox limits what the tool can reach, not what it says.
- **Resource use is limited, not prevented.** The watchdog recovers from a busy loop (`RUN-02`), and size limits apply (`DATA-06`, `DATA-11`), but a tool can still make its own frame slow.
- **Data a tool may write is still its data.** A tool can store what the person types in its own data, through declared bridge calls. That stays on the machine, but it can reach a model later as tool data, where `SEC-02` treats it as quoted data.
- **Executable migrations are disabled.** M1 accepts declarative migrations only. `SEC-01` requires a separate, negatively tested execution boundary before any generated migration code runs; none is chosen in M1. Enabling them needs an ADR from the owner naming the mechanism, with its own negative checks, first.
- **Imports check structure, not intent.** An imported tool is generated code from an unknown author: it is stored and runs only in the sandbox, with the same checks, never in the server. Its data is checked against its schema and limits, not judged.
- **Not covered in M1:** the CLIs' tool policy (M2, M3), outside data providers (`CAP-02`), files offered to save (`CAP-03`), vetted libraries injected into the sandbox (`CAP-04`, M3), engines and research (M5), and the broader audit, including dependencies (M6).

## How the checks run

- **Browser checks** (SBX, and BRG through a test tool): Playwright in Chrome and Edge, with a probe server that records every request it receives. The sandbox issue ([#45](https://github.com/suredo/Tessera/issues/45)) builds the probe server with the runtime.
- **Server checks** (BRG, IMP, AST, MIG): Node tests in a test data folder (`ENG-19`), with a canary file outside it and tripwires that fail the test on any network connection, process or worker started, or file touched outside the folders the test allows. The tripwires and the canary are a shared test helper, `packages/server/test/support/tripwires.ts` ([#55](https://github.com/suredo/Tessera/issues/55)). They detect an attempt in code that should never make one; they are not an isolation mechanism (`SEC-01`), and they see only calls made through Node's public modules.
- **Each check is a test whose name starts with its ID,** in the pull request that builds its path, so the coverage report shows which checks pass and which are still missing.

## Sandbox checks: the POC's 13

The POC passed "13/13 boundary checks" every time they ran ([what worked](../lessons/what-worked.md)), but its list of checks did not come across into this repository. **The list below is reconstructed** from `RUN-01` and the POC's sandbox design: an opaque-origin `sandbox="allow-scripts"` child inside a wrapper on the opposite loopback host, a strict CSP and a MessageChannel bridge. It may group or split the POC's checks differently. It is Tessera's list from now on; if the POC's original list turns up and has a check this one misses, add it with a new ID, never renumber.

Each check is a hand-written tool that attempts the forbidden thing from inside the sandbox, run with Playwright in Chrome and Edge (`TEST-06`). A probe server on its own port records every request it receives. A network check passes only if the attempt fails inside the tool **and** the probe server, the host server and the opposite loopback host received nothing from it ("network probes never reached the server").

| ID | The tool attempts | Expected result |
| --- | --- | --- |
| SBX-01 | `fetch` and `XMLHttpRequest` to the probe server, the host server on both loopback names and an outside address, also after adding its own `<meta>` CSP | Every request fails and none arrives. A request sent straight to the server with the tool's origin (`null`) is refused there too (`SEC-03`). |
| SBX-02 | `WebSocket`, `EventSource` and `navigator.sendBeacon` to the probe server | All fail and nothing arrives. |
| SBX-03 | Loading resources by URL: `<img>`, `<audio>`, `<video>`, `<script src>`, a stylesheet, CSS `url()` and `@import`, a web font | Nothing loads and nothing arrives. As a control, an image from a `blob:` URL the host handed over loads (`DATA-11`). |
| SBX-04 | Storage: `localStorage`, `sessionStorage`, IndexedDB, `document.cookie`, the Cache API | Each throws or is unavailable, and nothing persists to the next mount. |
| SBX-05 | Workers: `Worker`, `SharedWorker` and a service worker, from a script URL and from a `blob:` URL | None starts. |
| SBX-06 | Nested content: `<iframe>` (with a URL, `srcdoc`, `data:` and `blob:`), `<frame>`, `<object>`, `<embed>` | No nested document loads. |
| SBX-07 | Navigating its own frame: assigning `location`, clicking a link, a `<meta http-equiv="refresh">` | The frame still shows the tool, and nothing arrives at the probe server. |
| SBX-08 | Submitting a form, to the probe server and to the host | No submission is sent and the frame does not navigate. |
| SBX-09 | Navigating the host page: `top.location` and `parent.location` | The host page stays where it is. |
| SBX-10 | Popups, dialogs and downloads: `window.open`, a `target="_blank"` link, `alert`, `confirm`, `prompt`, `print`, a link with `download` | No window opens, no dialog blocks the host, and no file is downloaded. |
| SBX-11 | Reaching the host: `parent.document`, `top.document`, the wrapper's and host's storage and functions, `window.opener`; reading its own origin | Each access throws or gives nothing; the tool's origin is `null`. The wrapper, on the opposite loopback host, cannot read the host page either. |
| SBX-12 | Talking outside the bridge: `postMessage` with a bridge-shaped request to `parent` and `top`; reusing a port from an earlier mount; a bridge message from another frame | No reply, and nothing changes in the host. Only the fresh MessageChannel port of the current instance is answered (`RUN-01`). |
| SBX-13 | Device and powerful features: geolocation, camera and microphone, reading the clipboard, fullscreen, pointer lock | Each is refused without a permission prompt reaching the person. |

## Bridge checks

Run against the bridge's message handling, and through a hostile test tool in the sandbox ([#46](https://github.com/suredo/Tessera/issues/46)). Each refused call gets a plain error reply where a reply is due, and leaves host state unchanged.

| ID | The tool sends | Expected result |
| --- | --- | --- |
| BRG-01 | Malformed requests: not an object, missing or wrongly typed fields, extra fields, an unknown request ID, a payload over the manifest's limit | Refused; the host stays responsive. |
| BRG-02 | An action the manifest doesn't list, or one the tool didn't declare | Refused (`CON-03`, `CAP-01`). |
| BRG-03 | A capability the tool didn't declare | Refused (`CAP-01`). |
| BRG-04 | A change planned against a record revision that has since changed | Refused for that record with a plain message; other records apply (`DATA-02`). |
| BRG-05 | A call carrying an earlier instance's or another tool's identity | Refused or ignored (`RUN-04`). |
| BRG-06 | A data write before the tool is active, from the staging panel | Refused with an explanatory error (`GEN-06`). |
| BRG-07 | Arguments naming a file path, a URL, or another workspace's record or asset | Refused; no reply ever contains a file path. |

## Import checks

Run against the archive import ([#48](https://github.com/suredo/Tessera/issues/48)) with hand-made hostile archives, in a test data folder (`ENG-19`) with a canary file beside it. A refused import changes nothing: no workspace, saved tool, asset or file is left behind.

| ID | The archive contains | Expected result |
| --- | --- | --- |
| IMP-01 | Entry names that escape: `../`, absolute paths, drive letters, UNC paths, backslashes, links | Refused; nothing is written outside the import's own folder, and the canary is unchanged. |
| IMP-02 | Too much: the archive over its limit, an entry larger than it declares, a high compression ratio, too many entries | Refused before it is fully unpacked, with a plain message (`DATA-06`). |
| IMP-03 | Something malformed: not an archive, no manifest, data that breaks its contracts, a format newer than this build | Refused, with a plain message; nothing is imported (`CON-04`). |
| IMP-04 | A version or asset whose content doesn't match its hash | Refused (`DATA-05`). |
| IMP-05 | Executable content outside tool code: a migration with code, a script, an engine | Refused (`SEC-01`). Tool code is stored and only ever runs in the sandbox. |
| IMP-06 | IDs that match existing workspaces, saved tools or records | Existing work is never overwritten or changed. |
| IMP-07 | Anything at all, imported with network and process tripwires on | The import opens no network connection and starts no process. |

## Asset checks

Run against the asset store and its bridge delivery ([#49](https://github.com/suredo/Tessera/issues/49)).

| ID | Attempt | Expected result |
| --- | --- | --- |
| AST-01 | Storing a file whose content isn't PNG, JPEG or WebP: HTML or script named `.png`, SVG, a file whose header lies | Refused, whatever its name (`DATA-11`). |
| AST-02 | Storing an asset over the per-asset limit, or one that takes a workspace over its limit | Refused with a plain message; nothing is written. |
| AST-03 | Asking for an asset by an ID that isn't a SHA-256 hash: `../`, an absolute path, other separators | Refused; no file outside the asset store is read. |
| AST-04 | A tool asking for an asset its workspace doesn't reference | Refused. |
| AST-05 | Looking for a path: inspecting every bridge reply and host route that carries an asset | Tools get bytes and a type, shown through a `blob:` URL, never a file path. A host route that serves asset bytes sends the checked type, never HTML. |
| AST-06 | Cleanup after an interrupted write, with an asset still referenced by an undo entry or the trash | The startup sweep removes only files without a row, inside the asset store; a referenced asset is never removed (`DATA-09`). |

## Migration checks

Run against migration validation and activation ([#50](https://github.com/suredo/Tessera/issues/50)), with network and process tripwires on.

| ID | Attempt | Expected result |
| --- | --- | --- |
| MIG-01 | A migration carrying code: a function, JavaScript text, an unknown operation type | Refused when it is validated; nothing evaluates migration text (`SEC-01`). |
| MIG-02 | Declarative operations out of bounds: too many, paths too deep, fields outside the tool's own data | Refused. |
| MIG-03 | A migration whose result breaks the target schema, or that fails half way | Nothing changes: it ran on a copy, and the committed unit is kept (`DATA-10`). |
| MIG-04 | A migration whose result exceeds the data limit, or that differs between two runs on the same input | Refused (`DATA-03`, `DATA-06`). |
| MIG-05 | Any migration, run with network and process tripwires on | It opens no network connection, starts no process, and reads or writes no file. |
| MIG-06 | Activating a migration planned against a data revision that has since changed | Refused; the committed unit is kept (`DATA-10`). |
