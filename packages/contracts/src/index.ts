// Docs: docs/code/contracts/package.md
// @tessera/contracts: every shape that crosses a boundary, defined once with zod (CON-01).
export { INTENT_KINDS, intentSchema, type Intent } from "./intent.ts";
export { contracts, renderSchemaFiles, toJsonSchema, type ContractName } from "./json-schema.ts";
export {
  numericFieldsWithoutUnit,
  UNIT_SUFFIXES,
  UNITLESS_NAMES,
  UNITLESS_SUFFIXES,
} from "./units.ts";
