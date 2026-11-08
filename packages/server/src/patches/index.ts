// Docs: docs/code/server/patches.md
// The patch engine: atomic batches of changes on stable IDs, with per-record revisions (DATA-02).
// It lives in the contracts package, so the staging panel applies changes as the server does (P3).
export {
  applyPatch,
  createDataState,
  recordKey,
  recordOfKey,
  revisionOf,
  type DataState,
  type PatchOptions,
  type PatchRefusal,
  type PatchResult,
  type ToolData,
} from "@tessera/contracts";
