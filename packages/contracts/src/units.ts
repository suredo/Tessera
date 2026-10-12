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

const isNumeric = (schema: JsonSchema): boolean => {
  const type = schema["type"];
  const types = Array.isArray(type) ? type : [type];
  return types.includes("number") || types.includes("integer");
};

const namesUnit = (name: string): boolean =>
  (UNITLESS_NAMES as readonly string[]).includes(name) ||
  [...UNIT_SUFFIXES, ...UNITLESS_SUFFIXES].some((suffix) => name.endsWith(suffix));

/** The paths of numeric properties whose names state no unit, anywhere in a JSON Schema. */
export function numericFieldsWithoutUnit(schema: unknown, at = ""): string[] {
  if (Array.isArray(schema)) return schema.flatMap((item) => numericFieldsWithoutUnit(item, at));
  if (typeof schema !== "object" || schema === null) return [];
  const node = schema as JsonSchema;
  const found: string[] = [];
  const properties = node["properties"];
  if (typeof properties === "object" && properties !== null) {
    for (const [name, property] of Object.entries(properties as JsonSchema)) {
      // A nullable number is a union of a number and null.
      const variants = (property as JsonSchema)["anyOf"] ??
        (property as JsonSchema)["oneOf"] ?? [property];
      const numeric = (variants as JsonSchema[]).some(isNumeric);
      if (numeric && !namesUnit(name)) found.push(`${at}${name}`);
      found.push(...numericFieldsWithoutUnit(property, `${at}${name}.`));
    }
  }
  for (const key of ["items", "anyOf", "oneOf", "allOf"]) {
    if (key in node) found.push(...numericFieldsWithoutUnit(node[key], at));
  }
  return [...new Set(found)];
}
