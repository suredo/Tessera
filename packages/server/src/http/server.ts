import fs from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { isInsideFolder } from "../platform/index.ts";
import { APP_HOST, appOrigin, checkRequest, routeKind } from "./guard.ts";

// The local server (A2): bound to 127.0.0.1 only, so nothing else on the network can reach it,
// with every request checked by the guard before any route runs (SEC-03).

/** The port tried first; when it's taken, the system picks a free one (PLAT-02). */
export const DEFAULT_PORT = 4317;

export type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

export type ServerOptions = {
  /** The port to try first; 0 lets the system pick one. */
  port?: number;
  /** The built host app (packages/web/dist), served at every path outside /api and /runtime. */
  webRoot?: string;
  /** API and runtime routes, by exact path. Each must start with /api/ or /runtime/. */
  routes?: Record<string, Handler>;
};

export type LocalServer = {
  port: number;
  /** The host app's address, http://127.0.0.1:<port>. */
  url: string;
  /** Stops listening and ends open connections, so the port is free when it resolves. */
  close(): Promise<void>;
};

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function send(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" }).end(message);
}

// A file of the built host app. Paths without an extension get index.html, for the app's own routes.
function serveFile(webRoot: string | undefined, pathname: string, res: ServerResponse) {
  if (webRoot === undefined || !fs.existsSync(path.join(webRoot, "index.html"))) {
    return send(res, 404, "Tessera's host app isn't built yet: run pnpm build.");
  }
  let file: string;
  try {
    file = path.join(webRoot, decodeURIComponent(pathname));
  } catch {
    return send(res, 400, "That address isn't valid.");
  }
  if (path.extname(file) === "") file = path.join(webRoot, "index.html");
  if (!isInsideFolder(webRoot, file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return send(res, 404, "Nothing here.");
  }
  const type = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, { "content-type": type });
  fs.createReadStream(file).pipe(res);
}

function listen(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve((server.address() as AddressInfo).port);
    };
    server.once("error", onError).once("listening", onListening);
    server.listen(port, APP_HOST);
  });
}

/** Starts the server on 127.0.0.1, on the given port or, if that's taken, on a free one. */
export async function startLocalServer(options: ServerOptions = {}): Promise<LocalServer> {
  const routes = options.routes ?? {};
  for (const route of Object.keys(routes)) {
    if (routeKind(route) === "app")
      throw new Error(`Route ${route} must start with /api/ or /runtime/.`);
  }
  let port = 0;
  const server = http.createServer((req, res) => {
    // Only the path is used: a full address in the request line can't choose another host.
    const { pathname } = new URL(req.url ?? "/", "http://tessera.invalid");
    const verdict = checkRequest(pathname, req.headers, port);
    if (!verdict.ok) return send(res, verdict.status, verdict.message);
    for (const [name, value] of Object.entries(verdict.headers)) res.setHeader(name, value);
    const route = routes[pathname];
    if (route !== undefined) {
      Promise.resolve()
        .then(() => route(req, res))
        .catch(() => {
          if (!res.headersSent) send(res, 500, "Something went wrong in Tessera's server.");
          else res.destroy();
        });
    } else if (verdict.kind === "app" && (req.method === "GET" || req.method === "HEAD")) {
      serveFile(options.webRoot, pathname, res);
    } else {
      send(res, 404, "Nothing here.");
    }
  });
  const preferred = options.port ?? DEFAULT_PORT;
  try {
    port = await listen(server, preferred);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE" || preferred === 0) throw error;
    port = await listen(server, 0);
  }
  let closing: Promise<void> | undefined;
  return {
    port,
    url: appOrigin(port),
    close: () =>
      (closing ??= new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      })),
  };
}
