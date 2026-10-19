// Docs: docs/code/runtime/package.md
// @tessera/runtime: the sandboxed runtime that runs generated tools, framework-free (RUN-01).
export const packageName = "@tessera/runtime";
export { TOOL_CSP, TOOL_SANDBOX, wrapperCsp } from "./csp.ts";
export { mountTool, type MountedTool } from "./host.ts";
export {
  APP_HOST,
  MOUNT_MESSAGE,
  PORT_MESSAGE,
  RUNTIME_HOST,
  runtimeOriginFor,
} from "./protocol.ts";
