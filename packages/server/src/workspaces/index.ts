// Docs: docs/code/server/workspaces.md
// Workspaces, their version history and the saved-tools library, always saved (DATA-08).
export {
  addWorkspaceVersion,
  createWorkspace,
  getSavedTool,
  getWorkspace,
  listSavedTools,
  listWorkspaces,
  patchWorkspaceData,
  readWorkspaceData,
  renameSavedTool,
  renameWorkspace,
  saveTool,
  saveWorkspaceData,
  workspaceVersions,
  type Store,
  type WorkspaceData,
  type WorkspacePatchResult,
} from "./workspaces.ts";
