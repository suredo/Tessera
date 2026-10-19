# Server

* [Launcher](launcher.md) - Starting Tessera with one double-click: one copy per data folder, a free port, the browser opened, and a clean stop when its window closes.
* [Local server](local-server.md) - The HTTP server on 127.0.0.1 only, with a free port when the default is taken, and the guard every request passes: the Host header, same-origin API requests and framed runtime documents.
* [Platform helpers](platform.md) - Paths and starting other programs, the same on Windows, macOS and Linux: absolute paths, no shell, and no Windows batch files.
* [Provider adapters](providers.md) - The one interface every model connection implements, and the scripted provider that answers from a script chosen by test configuration, never by the request's words.
* [Storage](storage.md) - Tessera's SQLite database through Node's built-in node:sqlite: opening it, rows checked by their contracts, transactions, and numbered migrations.
