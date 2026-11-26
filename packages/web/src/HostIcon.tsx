// Small host controls; their buttons supply the translated accessible names (APP-11, UX-05).
const paths = {
  workspaces: "M6 4h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3ZM9 4v16",
  undo: "m8 5-5 5 5 5M4 10h10a6 6 0 0 1 6 6v2",
  history: "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM12 7v5l3 2",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  expand: "M9 4H4v5m11-5h5v5M4 15v5h5m6 0h5v-5",
  chat: "M5 18 3 21v-6a8 8 0 1 1 4 4ZM8 9h8M8 13h5",
  send: "m5 12 14-7-5 14-3-6-6-1Zm6 1 8-8",
  grip: "M8 8h.01M16 8h.01M8 12h.01M16 12h.01M8 16h.01M16 16h.01",
  panel: "M6 4h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3ZM14 4v16",
  close: "m6 6 12 12M6 18 18 6",
  leaf: "M5 19C2 8 10 3 20 4c0 11-7 17-15 15Zm0 0L16 8",
  plus: "M12 5v14M5 12h14",
  search: "M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Zm-1 5 5 5",
  import: "M12 4v11m-4-4 4 4 4-4M5 19h14",
  link: "M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1",
  trash: "M5 7h14M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3",
  alert: "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM12 8v5M12 16h.01",
  status: "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM8.5 12l2.5 2.5 4.5-5",
} as const;

export function HostIcon({ name }: { name: keyof typeof paths }) {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d={paths[name]}
        stroke="currentColor"
        strokeWidth={name === "more" ? 3.7 : name === "grip" ? 3 : 1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
