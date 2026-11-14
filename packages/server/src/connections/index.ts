// Docs: docs/code/server/connections.md
// Connections to outside services that the person adds; their keys stay here (CAP-02, ADR 0015).
export {
  addConnection,
  allowWrites,
  listConnections,
  removeConnection,
  takeBackWrites,
  writesAllowed,
} from "./connections.ts";
export {
  ConnectionRefusal,
  requestThroughConnection,
  type ConnectionRequestOptions,
} from "./requests.ts";
export type { Connection, ConnectionInput } from "@tessera/contracts";
