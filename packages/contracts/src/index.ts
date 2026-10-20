// Docs: docs/code/contracts/package.md
// @tessera/contracts: every shape that crosses a boundary, defined once with zod (CON-01).
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
export { jsonObjectSchema, jsonValueSchema, RESERVED_JSON_KEY, type JsonValue } from "./json.ts";
export { INTENT_KINDS, intentSchema, type Intent } from "./intent.ts";
export {
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
