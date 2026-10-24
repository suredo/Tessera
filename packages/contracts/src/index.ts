// Docs: docs/code/contracts/package.md
// @tessera/contracts: every shape that crosses a boundary, defined once with zod (CON-01).
export {
  ARCHIVE_FORMAT,
  ARCHIVE_FORMAT_VERSION,
  archivedWorkspaceSchema,
  archiveManifestSchema,
  type ArchivedWorkspace,
  type ArchiveManifest,
} from "./archive.ts";
export {
  ARTIFACT_CONTRACT_VERSION,
  ARTIFACT_UPGRADES,
  artifactSchema,
  canonicalJson,
  readArtifact,
  UI_MODES,
  type Artifact,
  type ArtifactReading,
  type ArtifactUpgrades,
} from "./artifact.ts";
export {
  BRIDGE_ACTIONS,
  BRIDGE_CAPABILITIES,
  BRIDGE_ERROR_CODES,
  BRIDGE_MANIFEST_VERSION,
  BRIDGE_MAX_DEPTH,
  BRIDGE_PHASES,
  BRIDGE_REQUEST_LIMIT_BYTES,
  BRIDGE_ROUTE,
  bridgeDataRequestSchema,
  bridgeReplySchema,
  bridgeRequestSchema,
  checkBridgeCall,
  type AcceptedCall,
  type BridgeActionName,
  type BridgeArgs,
  type BridgeResult,
  type BridgeCapability,
  type BridgeContext,
  type BridgeDataRequest,
  type BridgeErrorCode,
  type BridgePhase,
  type BridgeReply,
  type BridgeRequest,
  type RefusedCall,
} from "./bridge.ts";
export {
  jsonObjectSchema,
  jsonValueSchema,
  refusingReservedKey,
  RESERVED_JSON_KEY,
  type JsonValue,
} from "./json.ts";
export { INTENT_KINDS, intentSchema, type Intent } from "./intent.ts";
export {
  MIGRATION_MAX_MAPPINGS,
  MIGRATION_MAX_OPERATIONS,
  migrationSchema,
  type Migration,
  type MigrationOperation,
} from "./migration.ts";
export {
  bridgeManifest,
  contracts,
  JSON_SCHEMA_TARGET,
  jsonSchemaOf,
  renderSchemaFiles,
  toJsonSchema,
  type ContractName,
} from "./json-schema.ts";
export {
  ledgerEntrySchema,
  requestLogEntrySchema,
  RUN_MODES,
  type LedgerEntry,
  type RequestLogEntry,
} from "./ledger.ts";
export {
  collectionName,
  fieldName,
  patchBatchSchema,
  recordIdSchema,
  TOOL_DATA_LIMIT_BYTES,
  type PatchBatch,
  type PatchOperation,
} from "./patch.ts";
export {
  EFFORTS,
  effortSchema,
  PROVIDER_ERROR_KINDS,
  providerErrorKindSchema,
  providerScriptSchema,
  scriptedReplySchema,
  STAGES,
  stageSchema,
  usageSchema,
  type Effort,
  type ProviderErrorKind,
  type ProviderScript,
  type ScriptedReply,
  type Stage,
  type Usage,
} from "./provider.ts";
export {
  numericFieldsWithoutUnit,
  UNIT_SUFFIXES,
  UNITLESS_NAMES,
  UNITLESS_SUFFIXES,
} from "./units.ts";
export {
  TRASH_RETENTION_DAYS,
  trashEntrySchema,
  trashSchema,
  type Trash,
  type TrashEntry,
} from "./trash.ts";
export {
  savedToolSchema,
  workspaceSchema,
  workspaceVersionSchema,
  type SavedTool,
  type Workspace,
  type WorkspaceVersion,
} from "./workspace.ts";
