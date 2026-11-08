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

/**
 * One step a behavior check takes on a candidate (VER-03), on the elements it marks with `hook` in
 * their `data-hook` attribute: fill in the `index`th one (the first by default) with `value`, click
 * it, read what they show, or find which of them show `value`. The tool's page takes the steps
 * (src/tool-preamble.ts, which repeats these names).
 */
export type DriveStep =
  | { do: "fill"; hook: string; value: string; index?: number }
  | { do: "click"; hook: string; index?: number }
  | { do: "read"; hook: string; start?: number }
  | { do: "find"; hook: string; value: string }
  | { do: "fields"; hook: string };

/**
 * A field a fields step describes, so a check can fill it with a value it takes: its element and
 * type, its name, whether it must be filled and is checked, its limits as the page states them
 * (empty when it states none; a max length of -1 when none), and a select's choices' values, the
 * first 50 that can be chosen, and its value now, the first 200 characters.
 */
export type DriveField = {
  kind: "input" | "select" | "textarea" | "other";
  type: string;
  name: string;
  required: boolean;
  checked: boolean;
  min: string;
  max: string;
  step: string;
  maxLength: number;
  choices: string[];
  value: string;
};

/**
 * What a step did: a read gives how many elements have the hook and the text of 100 of them, from
 * its `start` (the first by default); a find gives how many, and the positions of the first 20
 * whose text holds its value; a fields step describes the first 100 fields with the hook.
 */
export type DriveResult =
  | { ok: true; count?: number; texts?: string[]; matches?: number[]; fields?: DriveField[] }
  | { ok: false; problem: string };
