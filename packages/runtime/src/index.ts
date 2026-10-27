// Docs: docs/code/runtime/package.md
// @tessera/runtime: the sandboxed runtime that runs generated tools, framework-free (RUN-01).
export const packageName = "@tessera/runtime";
export {
  BridgeError,
  clockReading,
  serveBridge,
  systemClock,
  type BridgeOptions,
  type BridgeTool,
  type DataCallContext,
  type DataHandlers,
  type HostClock,
  type ServedBridge,
} from "./bridge.ts";
export {
  smokeCheck,
  stubCheck,
  type SmokeReport,
  type CheckContext,
  type CheckOutcome,
  type VerificationCheck,
} from "./checks.ts";
export { TOOL_CSP, TOOL_SANDBOX, wrapperCsp } from "./csp.ts";
export { serverData, type Send } from "./server-data.ts";
export { serverActivation, type Activate } from "./server-activation.ts";
export {
  stageCandidate,
  type Candidate,
  type StagingOptions,
  type StagingResult,
} from "./staging.ts";
export {
  mountTool,
  WATCHDOG_DEFAULTS,
  type MountedTool,
  type MountEvent,
  type WatchdogOptions,
} from "./host.ts";
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
