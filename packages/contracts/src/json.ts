import { z } from "zod";

// JSON that Tessera stores (CON-01, DATA-08): kept exactly, or refused whole. A JavaScript object
// can't keep an own "__proto__" key through parsing, so zod's own JSON schemas silently drop it;
// these refuse any object that has one, at any depth, before parsing.

/** The one object key JSON allows that JavaScript objects can't keep. */
export const RESERVED_JSON_KEY = "__proto__";

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

// Written into the JSON Schema too, so other readers refuse the same keys.
const jsonKey = z.string().regex(/^(?!__proto__$)/, `"${RESERVED_JSON_KEY}" can't be stored.`);

const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(jsonKey, jsonValue),
  ]),
);

function hasReservedKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasReservedKey);
  if (typeof value !== "object" || value === null) return false;
  return (
    Object.hasOwn(value, RESERVED_JSON_KEY) ||
    Object.values(value as Record<string, unknown>).some(hasReservedKey)
  );
}

const noReservedKey = z
  .unknown()
  .refine((value) => !hasReservedKey(value), `"${RESERVED_JSON_KEY}" can't be stored.`);

/**
 * `schema`, but the whole value is refused first if any object in it, at any depth, has a
 * "__proto__" key. For a contract whose own keys could otherwise hide one, such as a patch batch.
 */
export const refusingReservedKey = <T extends z.ZodType>(schema: T) => noReservedKey.pipe(schema);

/** Any JSON value, refused whole if any object in it has a "__proto__" key. */
export const jsonValueSchema: z.ZodType<JsonValue> = refusingReservedKey(jsonValue);

/** A JSON object, refused whole if any object in it has a "__proto__" key. */
export const jsonObjectSchema = refusingReservedKey(z.record(jsonKey, jsonValue));
