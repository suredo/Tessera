import { Ajv, type ValidateFunction } from "ajv";

// The Codex adapter's view of a contract's schema (CLI-01, #266). Codex sends `--output-schema`
// to the model as a strict structured output, and the probe found strict mode refuses what the
// contracts use: `oneOf` (the first refusal it gave), and by OpenAI's rules also open maps,
// optional properties and most validation keywords. So the adapter projects the contract's
// draft-07 schema onto what strict mode takes, and turns the answer back before the host checks
// it against the contract itself, which stays the one definition (P3). Nothing is weakened: what
// the projection drops, the host's zod check still enforces (CLI-03).
//
// The projection, node by node:
// - `oneOf` becomes `anyOf`; a one-element `allOf` becomes its element; `const` becomes `enum`.
// - An object with properties gets every property required and no others; an optional property
//   may also be null, and a null the contract doesn't allow is removed when turned back.
// - An open map (`additionalProperties` a schema, so keys the schema can't list) becomes a string
//   holding the map as JSON, parsed when turned back. This covers the data schema, defaults and
//   entries, which are free-form JSON.
// - A tuple (`items` a list) becomes a list whose items may be any of its parts.
// - Only these keywords are kept: type, properties, required, additionalProperties, items, anyOf,
//   enum, description, $ref and definitions. Lengths, patterns, ranges and counts are dropped.

type Node = Record<string, unknown>;

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** An object whose keys the schema can't list: a map, which strict mode can't express. */
const isOpenMap = (node: Node): boolean =>
  node.type === "object" && node.properties === undefined && node.additionalProperties !== false;

const OPEN_MAP_NOTE = "A JSON text of an object:";

/** Whether a node lets null through as it stands. */
function allowsNull(node: unknown, root: Node): boolean {
  if (!isNode(node)) return false;
  if (typeof node.$ref === "string") return allowsNull(resolve(node.$ref, root), root);
  if (node.type === "null") return true;
  if (Array.isArray(node.type) && node.type.includes("null")) return true;
  if (Array.isArray(node.enum) && node.enum.includes(null)) return true;
  for (const key of ["anyOf", "oneOf"] as const) {
    const list = node[key];
    if (Array.isArray(list) && list.some((branch) => allowsNull(branch, root))) return true;
  }
  return false;
}

function resolve(ref: string, root: Node): unknown {
  const match = /^#\/(definitions|\$defs)\/(.+)$/.exec(ref);
  if (!match) throw new Error(`Unsupported schema reference: ${ref}`);
  const defs = root[match[1]!];
  return isNode(defs) ? defs[match[2]!] : undefined;
}

function project(node: unknown, root: Node): unknown {
  if (!isNode(node)) return node;
  if (typeof node.$ref === "string") {
    const target = resolve(node.$ref, root);
    // A reference to an open map is projected where it is used, as a string.
    if (isNode(target) && isOpenMap(target)) return project(target, root);
    return { $ref: node.$ref };
  }
  if (Array.isArray(node.allOf)) {
    if (node.allOf.length !== 1) throw new Error("Only a one-element allOf can be projected.");
    return project(node.allOf[0], root);
  }
  const out: Node = {};
  if (typeof node.description === "string") out.description = node.description;
  if (isOpenMap(node)) {
    return {
      type: "string",
      description: [OPEN_MAP_NOTE, node.description].filter(Boolean).join(" "),
    };
  }
  const branches = node.oneOf ?? node.anyOf;
  if (Array.isArray(branches)) {
    out.anyOf = branches.map((branch) => project(branch, root));
    return out;
  }
  if (node.const !== undefined) {
    out.enum = [node.const];
    return out;
  }
  if (node.type !== undefined) out.type = node.type;
  if (Array.isArray(node.enum)) out.enum = node.enum;
  if (isNode(node.properties)) {
    const required = new Set(Array.isArray(node.required) ? node.required : []);
    const properties: Node = {};
    for (const [key, value] of Object.entries(node.properties)) {
      const projected = project(value, root);
      properties[key] =
        required.has(key) || allowsNull(value, root)
          ? projected
          : { anyOf: [projected, { type: "null" }] };
    }
    out.properties = properties;
    out.required = Object.keys(properties);
    out.additionalProperties = false;
  }
  if (Array.isArray(node.items)) {
    out.items = { anyOf: node.items.map((item) => project(item, root)) };
  } else if (node.items !== undefined) {
    out.items = project(node.items, root);
  }
  return out;
}

/** References still used once open maps became strings, so unused definitions can be left out. */
function referenced(node: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(node)) node.forEach((item) => referenced(item, found));
  else if (isNode(node)) {
    if (typeof node.$ref === "string") found.add(node.$ref);
    Object.values(node).forEach((value) => referenced(value, found));
  }
  return found;
}

/** The contract's draft-07 schema as strict structured output takes it (see the top). */
export function toStrictSchema(schema: Node): Node {
  const body = project(schema, schema) as Node;
  const out: Node = { ...body };
  if (typeof schema.$schema === "string") out.$schema = schema.$schema;
  for (const key of ["definitions", "$defs"] as const) {
    const defs = schema[key];
    if (!isNode(defs)) continue;
    // Projected definitions, then only those the projection still points to (to a fixed point,
    // as a definition can point to another).
    const projected: Node = {};
    for (const [name, value] of Object.entries(defs)) {
      if (!(isNode(value) && isOpenMap(value))) projected[name] = project(value, schema);
    }
    let kept: Node;
    let refs = referenced(body);
    for (;;) {
      kept = Object.fromEntries(
        Object.entries(projected).filter(([name]) => refs.has(`#/${key}/${name}`)),
      );
      const more = referenced(kept, new Set(refs));
      if (more.size === refs.size) break;
      refs = more;
    }
    if (Object.keys(kept).length > 0) out[key] = kept;
  }
  return out;
}

const ajv = new Ajv({ strict: false, allErrors: false });
const validators = new WeakMap<object, ValidateFunction>();

/** Whether a value fits a node of the original schema, with the root's definitions in reach. */
function fits(value: unknown, node: Node, root: Node): boolean {
  let validate = validators.get(node);
  if (validate === undefined) {
    validate = ajv.compile({
      ...node,
      definitions: root.definitions,
      $defs: root.$defs,
      $schema: undefined,
    });
    validators.set(node, validate);
  }
  return validate(value);
}

function restore(value: unknown, node: unknown, root: Node): unknown {
  if (!isNode(node)) return value;
  if (typeof node.$ref === "string") return restore(value, resolve(node.$ref, root), root);
  if (Array.isArray(node.allOf) && node.allOf.length === 1) {
    return restore(value, node.allOf[0], root);
  }
  if (isOpenMap(node)) {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      // Left as it came: the host's check refuses it, and the ledger keeps it.
      return value;
    }
  }
  const branches = node.oneOf ?? node.anyOf;
  if (Array.isArray(branches)) {
    const candidates = branches.filter(isNode).map((branch) => ({
      branch,
      value: restore(value, branch, root),
    }));
    return (
      candidates.find((candidate) => fits(candidate.value, candidate.branch, root))?.value ?? value
    );
  }
  if (isNode(node.properties) && isNode(value)) {
    const required = new Set(Array.isArray(node.required) ? node.required : []);
    const out: Node = {};
    for (const [key, item] of Object.entries(value)) {
      const property = node.properties[key];
      if (property === undefined) {
        out[key] = item;
      } else if (item === null && !required.has(key) && !allowsNull(property, root)) {
        // A null the projection allowed for an optional property: absent, as the contract says.
        continue;
      } else {
        out[key] = restore(item, property, root);
      }
    }
    return out;
  }
  if (Array.isArray(value)) {
    if (Array.isArray(node.items))
      return value.map((item, i) => restore(item, (node.items as unknown[])[i], root));
    if (node.items !== undefined) return value.map((item) => restore(item, node.items, root));
  }
  return value;
}

/** An answer to the projected schema, turned back into the contract's shape for the host's check. */
export const restoreAnswer = (value: unknown, schema: Node): unknown =>
  restore(value, schema, schema);
