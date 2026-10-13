// The host's English text (UX-05). Each string the host shows lives in a message file like this
// one, by key; another language is another file with the same keys, and no component changes.
export const en = {
  "app.title": "Tessera",
  "home.heading": "Describe the tool you need",
  "home.intro": "Tessera writes a small tool for you and keeps its data on this computer.",
  "home.status": "Nothing to show yet: making tools comes in a later version.",
} as const;

export type MessageKey = keyof typeof en;
