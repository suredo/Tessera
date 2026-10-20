import { z } from "zod";
import { archiveManifestSchema } from "./archive.ts";
import { artifactSchema } from "./artifact.ts";
import { intentSchema } from "./intent.ts";
import { ledgerEntrySchema, requestLogEntrySchema } from "./ledger.ts";
import { patchBatchSchema } from "./patch.ts";
import { trashEntrySchema, trashSchema } from "./trash.ts";
import { savedToolSchema, workspaceSchema, workspaceVersionSchema } from "./workspace.ts";

// Every contract whose JSON Schema leaves the process: the CLI's --json-schema, evaluations,
// stored records. Add a contract here and run `pnpm contracts:schemas` (CON-01).
export const contracts = {
  archiveManifest: archiveManifestSchema,
  artifact: artifactSchema,
  intent: intentSchema,
  ledgerEntry: ledgerEntrySchema,
  patchBatch: patchBatchSchema,
  requestLogEntry: requestLogEntrySchema,
  savedTool: savedToolSchema,
  trash: trashSchema,
  trashEntry: trashEntrySchema,
  workspace: workspaceSchema,
  workspaceVersion: workspaceVersionSchema,
} as const;

export type ContractName = keyof typeof contracts;

/**
 * Claude Code checks --json-schema with a draft-07 validator and refuses draft 2020-12 (CLI
 * contract spike, #19, on 2.1.296), so every schema that leaves the process is draft-07.
 */
export const JSON_SCHEMA_TARGET = "draft-7";

/** The JSON Schema of any zod schema, in the draft the CLI accepts. */
export const jsonSchemaOf = (schema: z.ZodType): Record<string, unknown> =>
  z.toJSONSchema(schema, { target: JSON_SCHEMA_TARGET });

export const toJsonSchema = (name: ContractName): Record<string, unknown> =>
  jsonSchemaOf(contracts[name]);

/** The committed schema files, by file name, exactly as `pnpm contracts:schemas` writes them. */
export const renderSchemaFiles = (): Record<string, string> =>
  Object.fromEntries(
    (Object.keys(contracts) as ContractName[]).map((name) => [
      `${name}.schema.json`,
      `${JSON.stringify(toJsonSchema(name), null, 2)}\n`,
    ]),
  );
