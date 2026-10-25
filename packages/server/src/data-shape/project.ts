import type { JsonValue, Loss } from "@tessera/contracts";

// Bringing data back to an older shape (DATA-10): migrations only go forward, so restoring a tool
// version whose schema is older keeps everything that schema allows and drops the rest, listing
// each thing dropped. It works on the keywords a tool's schema may use (data-shape/schema.ts):
// a field the schema closes off (additionalProperties: false, or a property schema of false) is
// dropped, at any depth reached through properties, additionalProperties and items. Whether the
// result then fits the schema is the caller's to check: what projection can't fix is refused.

/** One thing a projection drops, where it was and what it held: the contract's (P3). */
export type { Loss };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// The way a list item is named in a loss's path.
const stepFor = (item: unknown, index: number): string =>
  isPlainObject(item) && typeof item["id"] === "string" ? item["id"] : String(index);

const DROPPED = Symbol("dropped");

function project(
  value: JsonValue,
  schema: unknown,
  path: string[],
  losses: Loss[],
): JsonValue | typeof DROPPED {
  if (schema === false) {
    losses.push({ path, value });
    return DROPPED;
  }
  if (!isPlainObject(schema)) return value;
  if (isPlainObject(value)) {
    const properties = isPlainObject(schema["properties"]) ? schema["properties"] : {};
    const others = schema["additionalProperties"];
    const kept: Record<string, JsonValue> = {};
    for (const [name, field] of Object.entries(value)) {
      const fieldSchema = Object.hasOwn(properties, name) ? properties[name] : (others ?? true);
      const result = project(field, fieldSchema, [...path, name], losses);
      if (result !== DROPPED)
        Object.defineProperty(kept, name, {
          value: result,
          enumerable: true,
          writable: true,
          configurable: true,
        });
    }
    return kept;
  }
  if (Array.isArray(value) && schema["items"] !== undefined) {
    const kept: JsonValue[] = [];
    value.forEach((item, index) => {
      const result = project(item, schema["items"], [...path, stepFor(item, index)], losses);
      if (result !== DROPPED) kept.push(result);
    });
    return kept;
  }
  return value;
}

/**
 * Keeps what `schema` allows of `data` and drops the rest, without changing `data`. Returns the
 * kept data and every loss, in the order met.
 */
export function projectData(
  data: Record<string, JsonValue>,
  schema: object,
): { data: Record<string, JsonValue>; losses: Loss[] } {
  const losses: Loss[] = [];
  const result = project(data, schema, [], losses);
  return { data: (result === DROPPED ? {} : result) as Record<string, JsonValue>, losses };
}
