---
type: Requirement Area
title: "Host capabilities"
description: "What tools can ask the host for: data providers, files in and out, vetted libraries (CAP-01 to CAP-05)."
tags: [spec, capabilities]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-14T04:00:00Z }
---
# Host capabilities (`CAP`)

Generated tools run in a sandbox with no network, files or storage (`RUN-01`). Anything more they need is a **host capability**: provided by the host, declared in the bridge manifest (`CON-03`), requested by the tool, and enforced at runtime. The clock (`RUN-07`) is the first one.

| ID | Requirement |
| --- | --- |
| CAP-01 | **Declared, minimal, visible.** Each capability is listed in the manifest with its arguments, limits and a plain description. A tool's declared capabilities are shown in the details view, and undeclared use is rejected (`RUN-04`, `VER-01`). |
| CAP-02 | **Connections to outside services** ([ADR 0015](../decisions/adr/0015-person-connections.md), A65). The person adds a connection to any service they choose: its addresses and, if needed, a key, which the host keeps and never gives a tool or a model. A tool uses a connection by name through a bridge action and its capability; the host makes the request, sending only what the tool's request says, to the connection's addresses, and returns the answer with where it came from. Unrelated records, files and chat history are never forwarded, but what a tool sends may itself be personal, so do not promise that no user data ever leaves the machine. Reads run freely; a tool's first write through a connection is confirmed by the person, in plain words, and can be taken back. Checks never reach the real service: in staging, connections give recorded or made-up answers. Generated code never fetches anything. Images an answer brings are fetched by the host, kept as assets (`DATA-11`) and handed to the tool. Third-party video players are not embedded in the first release, because they need a nested frame (`RUN-01`): a page or video opens in a new browser tab through the host, after the person clicks. |
| CAP-03 | **Files in and out.** A tool can ask the person to pick a file (an image to edit). The host shows the picker, stores the file as an asset (`DATA-11`) and passes it to the tool. A tool can offer a file to save (an exported image, CSV or document), which the host saves after the person confirms. Tools never see the file system. |
| CAP-04 | **Vetted libraries** (decided, A25). The host injects a small set of pinned, reviewed libraries into the sandbox: a chart library first, three.js for 3D later. They are declared like other capabilities, so generated code doesn't reinvent them. Each library is added by an ADR, covered by the UI standard where it draws, and updated deliberately. Generated code may not load any other library. |
| CAP-05 | **AI inside tools: later.** Tools calling a model themselves (for example summarizing a saved article) is out of scope for the first release. It would be a capability with its own budget and consent. |
