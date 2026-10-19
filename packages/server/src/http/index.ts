// Docs: docs/code/server/local-server.md
// The local server on 127.0.0.1 and the checks every request passes (SEC-03).
export {
  APP_HOST,
  RUNTIME_HOST,
  appOrigin,
  checkRequest,
  routeKind,
  runtimeOrigin,
  type GuardResult,
  type RouteKind,
} from "./guard.ts";
export {
  DEFAULT_PORT,
  startLocalServer,
  type Handler,
  type LocalServer,
  type ServerOptions,
} from "./server.ts";
