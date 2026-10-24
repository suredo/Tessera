import { Ajv, type ValidateFunction } from "ajv";
import { canonicalJson } from "@tessera/contracts";

// A tool's data checked against the JSON Schema the tool declares (DATA-03). A tool's schema will
// come from a model (M2), and checking runs in the server, so a schema may use only keywords whose
// checking costs no more than reading the data once: no patterns or formats (a regular expression
// can take exponential time, even on a short text), no references (one can refer to itself without
// end), no combinators (nesting them multiplies the work on the same value), and no uniqueness
// (it compares every pair). Ajv compiles what passes, with own-property semantics, so a name that
// objects inherit, such as `constructor`, is never taken for a field the data has.

/** The largest tool schema accepted, as canonical JSON. */
export const TOOL_SCHEMA_LIMIT_BYTES = 64 * 1024;
/** How deeply a tool schema may nest. */
export const TOOL_SCHEMA_MAX_DEPTH = 32;
/** The most values an `enum` may list. */
export const TOOL_SCHEMA_MAX_ENUM = 1000;
/** The most parts (objects, lists and values) a tool schema may hold, annotations included. */
export const TOOL_SCHEMA_MAX_PARTS = 20_000;
// How deeply the schema's JSON may nest: a schema level takes about two (`properties`, then a name).
const JSON_MAX_DEPTH = 2 * TOOL_SCHEMA_MAX_DEPTH + 16;

// Counts the schema's parts and depth without recursing, before anything recursive (canonical
// JSON, the subset check, Ajv) touches it, so a schema nested thousands deep is refused, not a
// crash. Values inside `const`, `enum` and `default` count too.
function tooBig(schema: unknown): string | undefined {
  const stack: [unknown, number][] = [[schema, 0]];
  let parts = 0;
  while (stack.length > 0) {
    const [value, depth] = stack.pop()!;
    parts += 1;
    if (parts > TOOL_SCHEMA_MAX_PARTS)
      return "The tool's data schema is larger than Tessera accepts.";
    if (depth > JSON_MAX_DEPTH) return "The tool's data schema is nested too deeply.";
    if (value !== null && typeof value === "object") {
      for (const child of Object.values(value)) stack.push([child, depth + 1]);
    }
  }
  return undefined;
}

/** The keywords a tool's data schema may use; each checks a value in time that grows with its size. */
export const TOOL_SCHEMA_KEYWORDS: ReadonlySet<string> = new Set([
  "$schema",
  "title",
  "description",
  "default",
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "minProperties",
  "maxProperties",
]);
const DRAFT_07 = "http://json-schema.org/draft-07/schema#";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// Where a schema leaves the accepted subset, as a short sentence, or undefined if it doesn't.
function outsideSubset(schema: unknown, depth: number, at: string): string | undefined {
  if (typeof schema === "boolean") return undefined;
  if (!isPlainObject(schema)) return `${at} isn't a schema.`;
  if (depth > TOOL_SCHEMA_MAX_DEPTH) {
    return `${at} is nested more than ${TOOL_SCHEMA_MAX_DEPTH} levels deep.`;
  }
  for (const [keyword, value] of Object.entries(schema)) {
    if (!TOOL_SCHEMA_KEYWORDS.has(keyword)) {
      return `${at} uses "${keyword}", which a tool's data schema can't use.`;
    }
    if (keyword === "$schema" && value !== DRAFT_07)
      return `${at} names a draft other than draft-07.`;
    if (keyword === "enum" && (!Array.isArray(value) || value.length > TOOL_SCHEMA_MAX_ENUM)) {
      return `${at} has an enum that isn't a list of at most ${TOOL_SCHEMA_MAX_ENUM} values.`;
    }
    if (keyword === "items" && Array.isArray(value)) return `${at} lists items by position.`;
    if (keyword === "items" || keyword === "additionalProperties") {
      const found = outsideSubset(value, depth + 1, `${at}/${keyword}`);
      if (found) return found;
    }
    if (keyword === "properties") {
      if (!isPlainObject(value)) return `${at}/properties isn't a map of schemas.`;
      for (const [name, property] of Object.entries(value)) {
        const found = outsideSubset(property, depth + 1, `${at}/properties/${name}`);
        if (found) return found;
      }
    }
  }
  return undefined;
}

// Each tool schema compiles in an Ajv of its own, so two tools' schemas never meet. Unknown
// keywords and odd numbers are refused; Ajv's stricter style checks, such as every required
// property also being listed, would refuse valid schemas, so they stay off.
const newAjv = () =>
  new Ajv({
    ownProperties: true,
    strictSchema: true,
    strictNumbers: true,
    strictTypes: false,
    strictTuples: false,
    strictRequired: false,
    allErrors: false,
  });

// Compiled checks, by the schema's canonical JSON: the same schema is compiled once.
const compiled = new Map<string, ValidateFunction>();
const COMPILED_LIMIT = 200;

export type SchemaCheck = { ok: true; validate: ValidateFunction } | { ok: false; reason: string };

/** Checks a tool's declared schema and compiles it, or says plainly why it can't be used. */
export function compileToolSchema(schema: object): SchemaCheck {
  const shape = tooBig(schema);
  if (shape) return { ok: false, reason: shape };
  const text = canonicalJson(schema);
  const known = compiled.get(text);
  if (known) return { ok: true, validate: known };
  if (Buffer.byteLength(text, "utf8") > TOOL_SCHEMA_LIMIT_BYTES) {
    return { ok: false, reason: "The tool's data schema is larger than Tessera accepts." };
  }
  const outside = outsideSubset(schema, 0, "The tool's data schema");
  if (outside) return { ok: false, reason: outside };
  try {
    const validate = newAjv().compile(schema);
    if (compiled.size >= COMPILED_LIMIT) compiled.clear();
    compiled.set(text, validate);
    return { ok: true, validate };
  } catch {
    return { ok: false, reason: "The tool's data schema isn't a JSON Schema Tessera can use." };
  }
}

/** Whether `data` fits `schema`; if not, where and why, in a short sentence. */
export function checkToolData(
  schema: object,
  data: unknown,
): { ok: true } | { ok: false; reason: string } {
  const check = compileToolSchema(schema);
  if (!check.ok) return check;
  if (check.validate(data)) return { ok: true };
  const error = check.validate.errors?.[0];
  const where = error?.instancePath ? `at ${error.instancePath}` : "at its top level";
  return {
    ok: false,
    reason: `The data doesn't fit the tool's shape ${where}: ${error?.message ?? "it is invalid"}.`,
  };
}
