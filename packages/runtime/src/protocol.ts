// The names the host, the wrapper and the tool use to set up the bridge (RUN-01). The wrapper's and
// the tool's scripts are inlined into their documents and can't import this, so they repeat these
// strings; a test checks they match.

/** Host to wrapper: mount a tool, with the port the host will talk on. */
export const MOUNT_MESSAGE = "tessera:mount";
/** Tool to wrapper, as the tool's page finishes loading: it is here and wants its port. */
export const HELLO_MESSAGE = "tessera:hello";
/** Wrapper to tool, in answer: the one port the tool may talk on. */
export const PORT_MESSAGE = "tessera:port";

/**
 * Wrapper to host, beside the tool's own messages: the tool left its page and was started again
 * with a fresh port, or kept leaving it and was stopped (SBX-07).
 */
export const TOOL_EVENTS = ["restarted", "stopped"] as const;
export type ToolEvent = (typeof TOOL_EVENTS)[number];
/** How many times the wrapper starts a tool again after it leaves its page, before it stops it. */
export const MAX_RESTARTS = 3;

/** The opposite loopback names (RUN-01): the host app on one, the runtime on the other. */
export const APP_HOST = "127.0.0.1";
export const RUNTIME_HOST = "localhost";

/**
 * Each start of a tool loads its document from a host of its own under the runtime's name,
 * `t<16 hex digits>.localhost`. Chrome and Edge give each such host its own process, so a tool
 * stuck in a busy loop can't hold up the next one, and its process ends once its frame is gone
 * (RUN-02). The server answers the tool's document, and only it, at a host like this.
 */
export const isToolHost = (host: string, port: number | string): boolean =>
  new RegExp(`^t[0-9a-f]{16}\\.${RUNTIME_HOST}:${port}$`).test(host);

/** The runtime's origin for a host app page: the same port on the other loopback name. */
export const runtimeOriginFor = (appLocation: { protocol: string; port: string }): string =>
  `${appLocation.protocol}//${RUNTIME_HOST}:${appLocation.port}`;
