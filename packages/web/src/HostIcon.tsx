// Small host controls; their buttons supply the translated accessible names (APP-11, UX-05).
const paths = {
  workspaces: "M3 5h18M3 12h18M3 19h18",
  undo: "M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12",
  history: "M12 8v5l3 2M3 12a9 9 0 1 0 3-7M3 3v5h5",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  expand: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
} as const;

export function HostIcon({ name }: { name: keyof typeof paths }) {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d={paths[name]}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
