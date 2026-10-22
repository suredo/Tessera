// The Content Security Policies of the runtime's two documents (RUN-01). The server sends them as
// headers; the browser enforces them on top of the frames' sandbox.

/**
 * The tool's document: its own inline code runs, and nothing else loads. No network of any kind,
 * no storage-backed loads, no workers, no nested frames from a URL, no forms, no navigation of
 * its frame elsewhere. Images and media come only from blob: URLs, made from assets the host
 * handed over (DATA-11).
 */
export const TOOL_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src blob:",
  "media-src blob:",
  "font-src 'none'",
  "connect-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "manifest-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/**
 * Sent with the tool's document as well: the browser sandboxes it even if something framed it
 * without the sandbox attribute. Only scripts are allowed: no same origin, so its origin is null.
 */
export const TOOL_SANDBOX = "sandbox allow-scripts";

/**
 * The wrapper's document: its own script, and one frame, the tool's document, from a host of its
 * own under the runtime's name (`isToolHost`), never from the wrapper's own host.
 */
export const wrapperCsp = (runtimeOrigin: string, nonce: string): string =>
  [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    `frame-src ${runtimeOrigin.replace("://", "://*.")}/runtime/tool`,
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
