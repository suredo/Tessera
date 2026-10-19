import type { IncomingHttpHeaders } from "node:http";
import { APP_HOST, RUNTIME_HOST } from "@tessera/runtime/policy";

// The checks every request passes before any route runs (SEC-03). The host app and its API live
// on 127.0.0.1; runtime documents live on the opposite loopback name, localhost (RUN-01), so the
// sandbox never shares the host app's origin. The two names are defined once, by the runtime.

export { APP_HOST, RUNTIME_HOST };

/** Which rules a path follows: the host app's pages, its API, or a runtime document. */
export type RouteKind = "app" | "api" | "runtime";

export type GuardResult =
  | { ok: true; kind: RouteKind; headers: Record<string, string> }
  | { ok: false; status: number; message: string };

export const routeKind = (pathname: string): RouteKind =>
  pathname === "/api" || pathname.startsWith("/api/")
    ? "api"
    : pathname === "/runtime" || pathname.startsWith("/runtime/")
      ? "runtime"
      : "app";

export const appOrigin = (port: number) => `http://${APP_HOST}:${port}`;
export const runtimeOrigin = (port: number) => `http://${RUNTIME_HOST}:${port}`;

const one = (value: string | string[] | undefined) =>
  Array.isArray(value) ? undefined : value?.toLowerCase();

function originOf(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

const refuse = (message: string): GuardResult => ({ ok: false, status: 403, message });

/**
 * Checks a request against SEC-03. The Host header must name this server by one of its loopback
 * names and port, which stops DNS rebinding: a page that rebinds its own name to 127.0.0.1 still
 * sends its own name. API requests must come from the host app's own pages, and runtime documents
 * load only as frames of the host app or of the runtime itself.
 */
export function checkRequest(
  pathname: string,
  headers: IncomingHttpHeaders,
  port: number,
): GuardResult {
  const kind = routeKind(pathname);
  const app = appOrigin(port);
  const runtime = runtimeOrigin(port);
  const expectedHost = kind === "runtime" ? `${RUNTIME_HOST}:${port}` : `${APP_HOST}:${port}`;
  if (one(headers.host) !== expectedHost) {
    return refuse(`Tessera answers only at ${kind === "runtime" ? runtime : app}.`);
  }
  // Sent by every current browser, and not something a page can set or leave out.
  const site = one(headers["sec-fetch-site"]);
  const origin = one(headers.origin);
  const common = { "x-content-type-options": "nosniff" };
  if (kind === "api") {
    // Same-origin: the browser says so, or a client that isn't a browser names the app's origin.
    const sameOrigin = site === undefined ? origin === app : site === "same-origin";
    if (!sameOrigin || (origin !== undefined && origin !== app)) {
      return refuse("Only Tessera's own pages can use its API.");
    }
    return { ok: true, kind, headers: { ...common, "cache-control": "no-store" } };
  }
  if (kind === "runtime") {
    // A runtime document loads only as a frame, asked for by the host app or the runtime itself.
    const from = originOf(headers.referer);
    if (one(headers["sec-fetch-dest"]) !== "iframe" || (from !== app && from !== runtime)) {
      return refuse("Runtime documents open only inside Tessera.");
    }
    // The browser enforces it too: no other page may frame the document.
    const csp = `frame-ancestors ${app} ${runtime}`;
    return { ok: true, kind, headers: { ...common, "content-security-policy": csp } };
  }
  // The host app's pages open from anywhere (the launcher, a bookmark) but no other page may frame them.
  return {
    ok: true,
    kind,
    headers: { ...common, "content-security-policy": "frame-ancestors 'none'" },
  };
}
