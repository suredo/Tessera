// Docs: docs/code/server/patches.md
// The patch engine: atomic batches of changes on stable IDs, with per-record revisions (DATA-02).
export {
  applyPatch,
  createDataState,
  revisionOf,
  type DataState,
  type PatchOptions,
  type PatchRefusal,
  type PatchResult,
  type ToolData,
} from "./patches.ts";
