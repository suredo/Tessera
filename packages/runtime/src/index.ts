// Docs: docs/code/runtime/package.md
// @tessera/runtime: the sandboxed runtime that runs generated tools, framework-free (RUN-01).
export const packageName = "@tessera/runtime";
export { TOOL_CSP, TOOL_SANDBOX, wrapperCsp } from "./csp.ts";
export { mountTool, type MountedTool } from "./host.ts";
export { createRuntime, type RuntimeState, type ToolRuntime } from "./runtime.ts";
export {
  APP_HOST,
  HELLO_MESSAGE,
  MAX_RESTARTS,
  MOUNT_MESSAGE,
  PORT_MESSAGE,
  RUNTIME_HOST,
  runtimeOriginFor,
  TOOL_EVENTS,
  type ToolEvent,
} from "./protocol.ts";
