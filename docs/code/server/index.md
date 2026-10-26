# Server

* [Launcher](launcher.md) - Starting Tessera with one double-click: one copy per data folder, a free port, the browser opened, and a clean stop when its window closes.
* [Local server](local-server.md) - The HTTP server on 127.0.0.1 only, with a free port when the default is taken, and the guard every request passes: the Host header, same-origin API requests and framed runtime documents.
* [Patch engine](patches.md) - Applies a batch of changes to a tool's data in memory: add, replace and remove on stable IDs, resolved one at a time, all or nothing, refused if a record it touches changed after it was planned, and within the data limit.
* [Job control](jobs.md) - AI jobs run one at a time by default, the rest waiting in order: a job cancelled while it waits never starts, one cancelled while it runs is stopped, and a newer request can replace the ones before it, which stay recorded as cancelled.
* [Setup check and probe](setup.md) - What Tessera needs to reach a model, checked without spending a call: Node.js, Claude Code installed, recent enough and signed in, and the data folder's size; and the opt-in probe, one small model call, run only once the check passes.
* [Platform helpers](platform.md) - Paths and starting other programs, the same on Windows, macOS and Linux: absolute paths, no shell, and no Windows batch files.
* [Provider adapters](providers.md) - The one interface every model connection implements: the Claude Code adapter, with locked flags, a clean environment, normalized usage and plain errors, and the scripted provider that answers from a script chosen by test configuration.
* [Storage](storage.md) - The user data folder and Tessera's SQLite database in it, through Node's built-in node:sqlite: rows checked by their contracts, transactions, numbered migrations and the backup before migrating.
* [Tool versions](versions.md) - Immutable tool versions stored once under the SHA-256 of their canonical JSON, checked against the artifact contract on the way in and read back as current, upgraded or plainly incompatible.
* [Runtime routes](runtime-routes.md) - The local server's runtime documents on the opposite loopback name: the wrapper with a nonce-bound script, and a tool's document sandboxed under the strict CSP.
* [Workspaces and saved tools](workspaces.md) - Workspaces, their version history and data, and the saved-tools library, each change committed to the data folder's database before the call returns.
* [Trash](trash.md) - Deleted workspaces and saved tools wait in the trash, restorable for 30 days, then are removed for good; emptying it early names what it removes and is confirmed against that list.
* [Export and import archives](archives.md) - A workspace or saved tool exported to one archive file and imported back exactly, with the archive checked whole before anything is written and existing work never changed.
* [Bridge route](bridge.md) - The server's side of the bridge: a tool's data calls, passed on by the host page, checked again with the stored version's capabilities and answered from the saved data and revisions.
* [Data shape](data-shape.md) - A tool's data shape: its declared JSON Schema checked for safety before it is compiled, and declarative migrations run on a copy, checked against both schemas.
* [Asset store](assets.md) - Images stored once by the SHA-256 of their bytes, checked by content and size, swept of interrupted writes at start, and removed only when nothing stored refers to them any more.
* [Host API](host-api.md) - The host app's one route to the server: every action its screens ask for (workspaces, the library, versions and restore, undo and the trash), checked against the contracts at both ends, and the tools its mounts show.
