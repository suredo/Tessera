---
type: Code Module
title: "Local server"
description: "The HTTP server on 127.0.0.1 only, with a free port when the default is taken, and the guard every request passes: the Host header, same-origin API requests and framed runtime documents."
resource: ../../../packages/server/src/http/
implements: [SEC-03]
tests: [../../../packages/server/test/local-server.test.ts]
tags: [code, server, security, http]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-19T02:40:09Z }
---

# Purpose

Serves the host app, its API and the runtime's documents to the browser on this computer only (A2), and refuses every request a web page elsewhere could send (`SEC-03`). The launcher (`PLAT-02`) will start it.

# Entry points

- `src/http/server.ts`: `startLocalServer` listens on 127.0.0.1, on port 4317 (`DEFAULT_PORT`) or, if that's taken, a port the system picks. It serves the built host app (`packages/web/dist`) at every path outside `/api` and `/runtime`, and the routes it's given at `/api/…` and `/runtime/…`. Closing it ends open connections too, so the port is free when it resolves.
- `src/http/guard.ts`: `checkRequest` decides whether a request may reach a route, and which headers its answer gets; `routeKind`, `appOrigin` and `runtimeOrigin` name the three kinds of route and the two origins.

# Invariants

- **Bound to 127.0.0.1 only.** Nothing on the network, and not `::1`, reaches it.
- **Nothing a request sends stops the server.** Only an origin-form target (`/path?query`) is read, and only its path; anything else, such as `//[` or `http://other/`, gets 400 whatever its Host. Any other failure while answering gets 500, or ends that one connection, and the server keeps running.
- **Every route checks the Host header**, before any route runs. The host app and its API answer only to `127.0.0.1:<port>`, runtime documents only to `localhost:<port>`: the opposite loopback name, so the sandbox never shares the host app's origin (`RUN-01`). Any other Host, a missing one included, gets 403. This stops DNS rebinding: a page that points its own name at 127.0.0.1 still sends its own name.
- **API routes take same-origin requests only.** A browser's `Sec-Fetch-Site` must say `same-origin`; a client that isn't a browser, such as the launcher, must send the app's origin as `Origin`, and an `Origin` that is sent must be the app's. A page can neither set nor leave out `Sec-Fetch-Site` in current browsers. API answers are never cached.
- **Runtime documents load only as frames of the host app or the runtime.** `Sec-Fetch-Dest` must be `iframe` and the `Referer` must come from one of the two origins. The answer carries `frame-ancestors` naming them, so the browser itself refuses any other page that frames it.
- **No other page may frame the host app** (`frame-ancestors 'none'`). Its pages open from anywhere, such as the launcher or a bookmark.
- **Files come only from inside the built app.** A path that decodes to outside it, such as `/..%2fsecret`, is not found. A path without an extension gets `index.html`, for the app's own routes.

# Depends on / used by

Node's `http` and `fs`, and `isInsideFolder` from the [platform helpers](platform.md). The launcher (`PLAT-02`) will start it. The API (M1 onwards) and the runtime's wrapper and documents (`RUN-01`) add their routes here.

# Pitfalls

- **The port can change between starts** when 4317 is taken, and the browser keeps storage per origin. That's fine while the browser holds no source of truth (A9); don't make it hold one.
- **A route is matched by its exact path,** with no parameters yet; the first routes that need them should add them here, behind the same guard.
- **The runtime check relies on the `Referer`.** The host app must not frame runtime documents with `referrerpolicy="no-referrer"`, or they are refused.
- **The guard doesn't stop programs on this computer**, which can send any header. `SEC-03` is about web pages; the threat model (`SEC-05`) covers the rest.
- **Files are found by path, without following links,** as `isInsideFolder` says; the built app has none.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `guard.ts`: `APP_HOST`, `RUNTIME_HOST`, `RouteKind` (type), `GuardResult` (type), `routeKind`, `appOrigin`, `runtimeOrigin`, `checkRequest`
- `index.ts`: `APP_HOST`, `RUNTIME_HOST`, `appOrigin`, `checkRequest`, `routeKind`, `runtimeOrigin`, `GuardResult` (type), `RouteKind` (type), `DEFAULT_PORT`, `startLocalServer`, `Handler` (type), `LocalServer` (type), `ServerOptions` (type)
- `server.ts`: `DEFAULT_PORT`, `Handler` (type), `ServerOptions` (type), `LocalServer` (type), `startLocalServer`
