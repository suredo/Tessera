// Numeric fields name their unit (CON-05): `waitSeconds`, never `wait`. The check reads the
// generated JSON Schema, so it sees exactly what a model or a stored record sees.

/** Name endings that state a unit. Extend it when a contract needs a new unit. */
export const UNIT_SUFFIXES = [
  "Ms",
  "Seconds",
  "Minutes",
  "Hours",
  "Days",
  "Bytes",
  "Px",
  "Percent",
  "Tokens",
  "Usd",
] as const;

/** Numbers that have no unit: counts, positions and versions. Keep this list short. */
export const UNITLESS_SUFFIXES = ["Count", "Index", "Version"] as const;
export const UNITLESS_NAMES = ["count", "index", "version"] as const;

type JsonSchema = { [key: string]: unknown };
const COMPOSED = ["anyOf", "oneOf", "allOf"] as const;

const asSchema = (value: unknown): JsonSchema | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonSchema)
    : undefined;

// Follows a local reference such as "#/$defs/Delay" to the schema it names.
const resolve = (node: JsonSchema, root: JsonSchema): JsonSchema | undefined => {
  const ref = node["$ref"];
  if (typeof ref !== "string") return node;
  if (!ref.startsWith("#/")) return undefined;
  let target: unknown = root;
  for (const part of ref.slice(2).split("/")) {
    target = asSchema(target)?.[part.replaceAll("~1", "/").replaceAll("~0", "~")];
  }
  return asSchema(target);
};

// A field is numeric if its type is, or any part of a union or intersection is: a nullable number
// is a union with null, and z.intersection writes allOf.
const isNumeric = (value: unknown, root: JsonSchema, seen = new Set<JsonSchema>()): boolean => {
  const schema = asSchema(value);
  const node = schema && resolve(schema, root);
  if (!node || seen.has(node)) return false;
  seen.add(node);
  const types = ([] as unknown[]).concat(node["type"]);
  if (types.includes("number") || types.includes("integer")) return true;
  return COMPOSED.some((key) =>
    ([] as unknown[]).concat(node[key] ?? []).some((part) => isNumeric(part, root, seen)),
  );
};

const namesUnit = (name: string): boolean =>
  (UNITLESS_NAMES as readonly string[]).includes(name) ||
  [...UNIT_SUFFIXES, ...UNITLESS_SUFFIXES].some((suffix) => name.endsWith(suffix));

/** The paths of numeric properties whose names state no unit, anywhere in a JSON Schema. */
export function numericFieldsWithoutUnit(schema: unknown): string[] {
  const root = asSchema(schema) ?? {};
  const found = new Set<string>();
  const walk = (value: unknown, at: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, at));
      return;
    }
    const node = asSchema(value);
    if (!node) return;
    for (const [name, property] of Object.entries(asSchema(node["properties"]) ?? {})) {
      if (isNumeric(property, root) && !namesUnit(name)) found.add(`${at}${name}`);
      walk(property, `${at}${name}.`);
    }
    for (const key of ["items", ...COMPOSED]) walk(node[key], at);
    // Shared definitions are checked where they are defined, not followed through each $ref.
    for (const [name, definition] of Object.entries(asSchema(node["$defs"]) ?? {})) {
      walk(definition, `$defs.${name}.`);
    }
  };
  walk(root, "");
  return [...found];
}
