import type { Artifact } from "@tessera/contracts";

// The host stylesheets every tool gets (RUN-05, VER-06), from one definition of the UI standard's
// tokens (P3): the M2 prompt part and static checks will be generated from the same table. The
// server puts them first in the tool's document, inline, which its CSP allows (RUN-01).

/** The UI standard's version these styles implement; an artifact names it (`ui.standardVersion`). */
export const UI_STANDARD_VERSION = 1;

/**
 * The UI standard's tokens, each a `--ui-*` variable in standard mode. A tool uses `var(--ui-*)`
 * and overrides one in `:root` for a change the person asked for.
 */
export const UI_TOKENS = {
  font: '"Segoe UI", Arial, sans-serif',
  background: "#f9faf8",
  surface: "#ffffff",
  text: "#28312b",
  "text-secondary": "#586153",
  divider: "#e4e7e1",
  "control-border": "#81867e",
  accent: "#526947",
  "accent-soft": "#ddebcc",
  error: "#a12622",
  success: "#35613d",
  "size-body": "16px",
  "size-secondary": "14px",
  "size-section": "18px",
  "size-title": "22px",
  "line-height": "1.5",
  "space-1": "4px",
  "space-2": "8px",
  "space-3": "12px",
  "space-4": "16px",
  "space-5": "24px",
  "space-6": "32px",
  "radius-panel": "12px",
  "radius-control": "8px",
  padding: "16px",
  target: "40px",
} as const;

// The layers are declared first in the document, so this order holds whatever a tool declares. A
// normal declaration in a later layer wins, and a tool's unlayered styles beat both, so the
// standard stays easy to customize. An important one in an earlier layer wins over later layers
// and over unlayered styles, so the floor's important rules beat a tool's own. Their names end in
// a mark the server draws for each document, so a tool's styles can't add rules to them.
const layers = (mark: string) => ({
  floor: `tessera-accessibility-${mark}`,
  standard: `tessera-standard-${mark}`,
});

/**
 * The accessibility floor (RUN-05), in every tool, standard or custom: a visible focus outline on
 * whatever has keyboard focus, and next to no motion when the person asks for reduced motion.
 */
export function accessibilityCss(mark: string): string {
  const { floor, standard } = layers(mark);
  return `@layer ${floor}, ${standard};
@layer ${floor} {
  :focus-visible {
    outline: 3px solid ${UI_TOKENS.accent} !important;
    outline-offset: 2px !important;
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      animation-delay: 0s !important;
      transition-duration: 0.01ms !important;
      transition-delay: 0s !important;
      scroll-behavior: auto !important;
    }
  }
}`;
}

const variables = Object.entries(UI_TOKENS)
  .map(([name, value]) => `    --ui-${name}: ${value};`)
  .join("\n");

/** The UI standard's look (VER-06), only in standard mode: its tokens and quiet element defaults. */
export function standardCss(mark: string): string {
  return `@layer ${layers(mark).standard} {
  :root {
${variables}
  }
  html {
    font-family: var(--ui-font);
    font-size: var(--ui-size-body);
    line-height: var(--ui-line-height);
    color: var(--ui-text);
    background: var(--ui-background);
  }
  body { margin: 0; padding: var(--ui-padding); }
  h1 { font-size: var(--ui-size-title); font-weight: 600; }
  h2, h3 { font-size: var(--ui-size-section); font-weight: 600; }
  button, input, select, textarea { font: inherit; color: inherit; }
  button, input, select {
    min-height: var(--ui-target);
    border: 1px solid var(--ui-control-border);
    border-radius: var(--ui-radius-control);
    padding: 0 var(--ui-space-3);
    background: var(--ui-surface);
  }
  textarea {
    border: 1px solid var(--ui-control-border);
    border-radius: var(--ui-radius-control);
    padding: var(--ui-space-2) var(--ui-space-3);
    background: var(--ui-surface);
  }
  input[type="checkbox"], input[type="radio"] { min-height: auto; accent-color: var(--ui-accent); }
}`;
}

/**
 * What the server puts first in a tool's document: the floor always, the standard in its mode.
 * `mark` names the layers for this document; draw a new random one for each.
 */
export const hostStyles = (mode: Artifact["ui"]["mode"], mark: string): string =>
  mode === "standard" ? `${accessibilityCss(mark)}\n${standardCss(mark)}` : accessibilityCss(mark);
