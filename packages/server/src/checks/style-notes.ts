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

// A value that keeps or resets what's there, or turns an effect off, is never a difference.
const KEEPS = /^(none|inherit|initial|unset|revert|revert-layer)$/i;
// The `font` shorthand: what follows its size, and line height if any, is the family.
const FONT_SIZE =
  /(?:^|\s)(?:[\d.]+(?:px|em|rem|%|pt|pc|ex|ch|lh|rlh|vw|vh|vmin|vmax|cm|mm|in|q)|xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger|(?:calc|min|max|clamp)\([^)]*\))(?:\s*\/\s*\S+)?\s+(\S.*)$/i;
// A `var()`, its fallback too, is the standard's or a variable's value, never a colour of the
// tool's own; what's left of the value is looked at. Nested parentheses one level deep, as in a
// fallback of `rgb(…)`, are removed with it.
const VARIABLE = /var\((?:[^()]|\([^()]*\))*\)/gi;
const LITERAL_COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
// The CSS named colours (CSS Color 4); `transparent` and `currentColor` aren't colours of a tool's
// own, so they aren't here.
const NAMED_COLOURS = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet " +
    "brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan " +
    "darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta " +
    "darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue " +
    "darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey " +
    "dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray " +
    "green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush " +
    "lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray " +
    "lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray " +
    "lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon " +
    "mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue " +
    "mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin " +
    "navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen " +
    "paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple " +
    "rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna " +
    "silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle " +
    "tomato turquoise violet wheat white whitesmoke yellow yellowgreen"
  ).split(" "),
);
const namesColour = (value: string) =>
  LITERAL_COLOUR.test(value) ||
  (value.match(/[a-z]+/gi) ?? []).some((word) => NAMED_COLOURS.has(word.toLowerCase()));
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
  if (property.startsWith("--") || KEEPS.test(value)) return undefined;
  if (property === "box-shadow" || property === "text-shadow") return "shadow";
  if (/gradient\(/i.test(value)) return "gradient";
  if (property === "backdrop-filter" || property === "-webkit-backdrop-filter") return "glass";
  if (property === "position" && /^(fixed|sticky)$/i.test(value)) return "position";
  // A family of its own: `font-family`'s value, or what follows the `font` shorthand's size; a
  // shorthand with no size, such as a system font's keyword, names none.
  const family =
    property === "font-family"
      ? value
      : property === "font"
        ? FONT_SIZE.exec(value)?.[1]
        : undefined;
  if (family !== undefined && !/var\(--ui-font\)/i.test(family)) return "font";
  if (COLOUR_PROPERTIES.test(property) && namesColour(value.replace(VARIABLE, " ")))
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
