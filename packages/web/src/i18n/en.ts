// The host's English text (UX-05). Each string the host shows lives in a message file like this
// one, by key; another language is another file with the same keys, and no component changes.
export const en = {
  "app.title": "Tessera",
  "app.loading": "Opening your workspaces…",
  "app.problem": "Something went wrong: {message}",
  "app.unreadable": "Tessera's answer couldn't be read.",
  "home.heading": "Describe the tool you need",
  "home.intro": "Tessera writes a small tool for you and keeps its data on this computer.",
  "home.status": "Nothing to show yet: making tools comes in a later version.",
  "workspaces.heading": "Workspaces",
  "workspaces.lastUsed": "Last used {when}",
  "workspaces.saved": "Saved",
  "workspaces.open": "Open {name}",
  "workspaces.opened": "{name}, open",
  "workspaces.rename": "Rename {name}",
  "workspaces.renameShort": "Rename",
  "workspaces.renameLabel": "New name for {name}",
  "workspaces.renameSave": "Save name",
  "workspaces.renameCancel": "Cancel",
  "workspaces.delete": "Move {name} to the trash",
  "workspaces.deleteShort": "Move to trash",
  "workspaces.deleted": "{name} is in the trash. You can restore it for 30 days.",
  "tool.label": "Tool: {name}",
  "tool.noTool": "{name} has no tool yet.",
  "tool.minimize": "Minimize",
  "tool.restore": "Show the tool again",
  "tool.minimized": "{name} is minimized.",
  "tool.fullScreen": "Full screen",
  "tool.leaveFullScreen": "Leave full screen",
  "tool.stopped": "{name} stopped because it stopped answering.",
} as const;

export type MessageKey = keyof typeof en;
