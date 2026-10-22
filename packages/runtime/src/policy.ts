// What the server needs from the runtime, with no browser code: the documents' policies and the
// loopback names. Imported as @tessera/runtime/policy.
export { TOOL_CSP, TOOL_SANDBOX, wrapperCsp } from "./csp.ts";
export { APP_HOST, isToolHost, RUNTIME_HOST } from "./protocol.ts";
