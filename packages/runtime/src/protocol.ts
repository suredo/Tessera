// The names the host, the wrapper and the tool use to set up the bridge (RUN-01). The wrapper's and
// the tool's scripts are inlined into their documents and can't import this, so they repeat these
// strings; a test checks they match.

/** Host to wrapper: mount a tool, with the port the host will talk on. */
export const MOUNT_MESSAGE = "tessera:mount";
/** Wrapper to tool: the one port the tool may talk on. */
export const PORT_MESSAGE = "tessera:port";

/** The opposite loopback names (RUN-01): the host app on one, the runtime on the other. */
export const APP_HOST = "127.0.0.1";
export const RUNTIME_HOST = "localhost";

/** The runtime's origin for a host app page: the same port on the other loopback name. */
export const runtimeOriginFor = (appLocation: { protocol: string; port: string }): string =>
  `${appLocation.protocol}//${RUNTIME_HOST}:${appLocation.port}`;
