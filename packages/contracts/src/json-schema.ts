import { z } from "zod";
import { intentSchema } from "./intent.ts";

// Every contract whose JSON Schema leaves the process: the CLI's --json-schema, evaluations,
// stored records. Add a contract here and run `pnpm contracts:schemas` (CON-01).
export const contracts = {
  intent: intentSchema,
} as const;

export type ContractName = keyof typeof contracts;

export const toJsonSchema = (name: ContractName): Record<string, unknown> =>
  z.toJSONSchema(contracts[name], { target: "draft-2020-12" });

/** The committed schema files, by file name, exactly as `pnpm contracts:schemas` writes them. */
export const renderSchemaFiles = (): Record<string, string> =>
  Object.fromEntries(
    (Object.keys(contracts) as ContractName[]).map((name) => [
      `${name}.schema.json`,
      `${JSON.stringify(toJsonSchema(name), null, 2)}\n`,
    ]),
  );
