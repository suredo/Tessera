// Docs: docs/code/server/checks.md
import type { Artifact } from "@tessera/contracts";
import postcss, { type Declaration } from "postcss";

// Where a tool's look differs from Tessera's UI standard (VER-06, A63): notes, never refusals. The
// standard is the look for whatever the person didn't specify; what they asked for wins, and a
// tool applies a change they asked for by overriding a `--ui-*` variable in `:root`, which is never
// noted. A note says where the look differs, in a few words, so the next edit can bring that part
// back to the standard where the person said nothing, and the details view can show it. A tool in
// custom mode, whose person asked for their own design, gets none.

/** How many notes a tool's look gets at most; one for the rest says how many more there are. */
export const STYLE_NOTES_LIMIT = 3;
const SELECTOR_LIMIT = 30;

// Colour words a literal colour may be written as; `transparent`, `currentColor` and `inherit`
// aren't colours of their own, so they're never noted.
const KEEPS = /^(inherit|initial|unset|revert)$/i;
const NAMES_FAMILY = /["',]|\b(serif|sans-serif|monospace|cursive|fantasy|system-ui)\s*$/i;
const COLOUR_WORDS =
  /\b(white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|brown|navy|teal|silver|gold|maroon|olive|lime|aqua|fuchsia|cyan|magenta|beige|ivory|coral|salmon|tomato|crimson|indigo|violet|turquoise|tan|khaki|lavender|plum|orchid|chocolate|tomato)\b/i;
const LITERAL_COLOUR = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i;
const COLOUR_PROPERTIES =
  /^(color|background|background-color|border(-(top|right|bottom|left|block|inline)(-start|-end)?)?(-color)?|outline(-color)?|fill|stroke|caret-color|accent-color|text-decoration-color)$/i;

type Kind = "shadow" | "gradient" | "glass" | "position" | "font" | "colour";
// A few words each: the details view's heading and the edit prompt say what a note is.
const SAYS: Record<Kind, string> = {
  shadow: "a shadow",
  gradient: "a gradient",
  glass: "a glass effect",
  position: "fixed or sticky",
  font: "its own font",
  colour: "its own colour",
};

/** What a declaration differs from the standard in, if anything. */
function kindOf(declaration: Declaration): Kind | undefined {
  const property = declaration.prop.toLowerCase();
  const value = declaration.value.trim();
  // Custom properties, such as a `--ui-*` override in `:root`, are how a tool applies a change the
  // person asked for: never noted.
  if (property.startsWith("--")) return undefined;
  if ((property === "box-shadow" || property === "text-shadow") && !/^none$/i.test(value))
    return "shadow";
  if (/gradient\(/i.test(value)) return "gradient";
  if (property === "backdrop-filter" || property === "-webkit-backdrop-filter") return "glass";
  if (property === "position" && /^(fixed|sticky)$/i.test(value)) return "position";
  if (property === "font-family" && !/var\(--ui-font\)/i.test(value) && !KEEPS.test(value))
    return "font";
  // The `font` shorthand names a family of its own when it quotes one, lists them, or ends with a
  // generic one.
  if (
    property === "font" &&
    !/var\(--ui-font\)/i.test(value) &&
    !KEEPS.test(value) &&
    NAMES_FAMILY.test(value)
  )
    return "font";
  if (
    COLOUR_PROPERTIES.test(property) &&
    !/var\(--/i.test(value) &&
    (LITERAL_COLOUR.test(value) || COLOUR_WORDS.test(value))
  )
    return "colour";
  return undefined;
}

/** The selector a declaration is in, shortened, or "the style" for one outside any rule. */
function where(declaration: Declaration): string {
  const rule = declaration.parent?.type === "rule" ? declaration.parent : undefined;
  const selector = rule?.selector.replace(/\s+/g, " ").trim() ?? "the style";
  return selector.length > SELECTOR_LIMIT ? `${selector.slice(0, SELECTOR_LIMIT - 1)}…` : selector;
}

/**
 * Where a tool's look differs from the UI standard (VER-06, A63): at most `STYLE_NOTES_LIMIT`
 * notes, each "selector: what", in the order the CSS has them, one for each kind of difference in
 * each place; then one saying how many more there are. None in custom mode, and none for CSS that
 * can't be read: this reads the look, it doesn't judge the CSS.
 */
export function styleNotes(code: Artifact["code"], mode: Artifact["ui"]["mode"]): string[] {
  if (mode !== "standard") return [];
  let root: postcss.Root;
  try {
    root = postcss.parse(code.css);
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const notes: string[] = [];
  root.walkDecls((declaration) => {
    const kind = kindOf(declaration);
    if (!kind) return;
    const place = where(declaration);
    const key = `${place}\u0000${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    notes.push(`${place}: ${SAYS[kind]}`);
  });
  if (notes.length <= STYLE_NOTES_LIMIT) return notes;
  const more = notes.length - STYLE_NOTES_LIMIT;
  return [...notes.slice(0, STYLE_NOTES_LIMIT), `${more} more`];
}
