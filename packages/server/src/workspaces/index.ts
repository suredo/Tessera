// Docs: docs/code/server/workspaces.md
// Workspaces, their version history and the saved-tools library, always saved (DATA-08).
export {
  activateVersion,
  type ActivationOptions,
  type ActivationRefusal,
  type ActivationResult,
} from "./activation.ts";
export { activationRoutes } from "./routes.ts";
export {
  listUndo,
  undoDataChange,
  type UndoEntry,
  type UndoRefusal,
  type UndoResult,
} from "./undo.ts";
export {
  continueSavedTool,
  useAgain,
  type ContinueTarget,
  type UseAgainOptions,
  type UseAgainRefusal,
  type UseAgainResult,
} from "./reuse.ts";
export {
  listRecoverySnapshots,
  planRestore,
  restoreRecoverySnapshot,
  restoreVersion,
  type RecoverySnapshot,
  type RestorePlan,
  type RestoreRefusal,
  type RestoreResult,
} from "./restore.ts";
export {
  addWorkspaceVersion,
  createWorkspace,
  getSavedTool,
  getWorkspace,
  lastUsed,
  recordUse,
  listSavedTools,
  listWorkspaces,
  patchWorkspaceData,
  readWorkspaceData,
  renameSavedTool,
  renameWorkspace,
  saveTool,
  saveWorkspaceData,
  UNDO_LIMIT,
  workspaceVersions,
  type Store,
  type WorkspaceData,
  type WorkspacePatchResult,
} from "./workspaces.ts";
