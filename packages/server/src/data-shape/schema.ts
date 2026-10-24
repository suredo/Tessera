import { createRequire } from "node:module";
import { Ajv, type ValidateFunction } from "ajv";
import { canonicalJson } from "@tessera/contracts";

// A tool's data checked against the JSON Schema the tool declares (DATA-03). Ajv compiles each
// schema into a check; a tool's schema will come from a model (M2), so before it is compiled it
// must be small, use only the keywords Ajv knows (strict mode), and pass Ajv's security
// meta-schema, which refuses the shapes that make checking slow, such as a pattern on a text with
// no length limit. Nothing is fetched: a reference that isn't inside the schema fails.

/** The largest tool schema accepted, as canonical JSON. */
export const TOOL_SCHEMA_LIMIT_BYTES = 64 * 1024;

// Each tool schema compiles in an Ajv of its own, so two tools' schemas never meet, even with the
// same $id. Unknown keywords and odd numbers are refused; the stricter style checks, such as every
// required property also being listed, would refuse valid schemas, so they stay off.
const newAjv = () =>
  new Ajv({
    strictSchema: true,
    strictNumbers: true,
    strictTypes: false,
    strictTuples: false,
    strictRequired: false,
    allErrors: false,
  });
// Ajv's own security meta-schema doesn't pass its strict mode, so it compiles without it.
const isSecure = new Ajv({ strict: false }).compile(
  createRequire(import.meta.url)("ajv/lib/refs/json-schema-secure.json") as object,
);

// Compiled checks, by the schema's canonical JSON: the same schema is compiled once.
const compiled = new Map<string, ValidateFunction>();
const COMPILED_LIMIT = 200;

export type SchemaCheck = { ok: true; validate: ValidateFunction } | { ok: false; reason: string };

/** Checks a tool's declared schema and compiles it, or says plainly why it can't be used. */
export function compileToolSchema(schema: object): SchemaCheck {
  const text = canonicalJson(schema);
  const known = compiled.get(text);
  if (known) return { ok: true, validate: known };
  if (Buffer.byteLength(text, "utf8") > TOOL_SCHEMA_LIMIT_BYTES) {
    return { ok: false, reason: "The tool's data schema is larger than Tessera accepts." };
  }
  if (!isSecure(schema)) {
    const where = isSecure.errors?.[0]?.instancePath || "its top level";
    return {
      ok: false,
      reason: `The tool's data schema could make checking slow (at ${where}): a pattern or format needs a maxLength.`,
    };
  }
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
