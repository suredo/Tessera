# Server

* [Launcher](launcher.md) - Starting Tessera with one double-click: one copy per data folder, a free port, the browser opened, and a clean stop when its window closes.
* [Local server](local-server.md) - The HTTP server on 127.0.0.1 only, with a free port when the default is taken, and the guard every request passes: the Host header, same-origin API requests and framed runtime documents.
* [Platform helpers](platform.md) - Paths and starting other programs, the same on Windows, macOS and Linux: absolute paths, no shell, and no Windows batch files.
* [Provider adapters](providers.md) - The one interface every model connection implements, and the scripted provider that answers from a script chosen by test configuration, never by the request's words.
* [Storage](storage.md) - The user data folder and Tessera's SQLite database in it, through Node's built-in node:sqlite: rows checked by their contracts, transactions, numbered migrations and the backup before migrating.
* [Tool versions](versions.md) - Immutable tool versions stored once under the SHA-256 of their canonical JSON, checked against the artifact contract on the way in and read back as current, upgraded or plainly incompatible.
* [Workspaces and saved tools](workspaces.md) - Workspaces, their version history and data, and the saved-tools library, each change committed to the data folder's database before the call returns.
* [Trash](trash.md) - Deleted workspaces and saved tools wait in the trash, restorable for 30 days, then are removed for good; emptying it early names what it removes and is confirmed against that list.
* [Export and import archives](archives.md) - A workspace or saved tool exported to one archive file and imported back exactly, with the archive checked whole before anything is written and existing work never changed.
