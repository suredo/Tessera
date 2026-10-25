import { z } from "zod";
import { activationReplySchema, activationRequestSchema } from "./activation.ts";
import { assetSchema } from "./asset.ts";
import { archiveManifestSchema } from "./archive.ts";
import { artifactSchema } from "./artifact.ts";
import {
  BRIDGE_ACTIONS,
  BRIDGE_CAPABILITIES,
  BRIDGE_MANIFEST_VERSION,
  BRIDGE_MAX_DEPTH,
  BRIDGE_REQUEST_LIMIT_BYTES,
  bridgeDataRequestSchema,
  bridgeReplySchema,
  bridgeRequestSchema,
} from "./bridge.ts";
import { intentSchema } from "./intent.ts";
import { ledgerEntrySchema, requestLogEntrySchema } from "./ledger.ts";
import { patchBatchSchema } from "./patch.ts";
import { trashEntrySchema, trashSchema } from "./trash.ts";
import { savedToolSchema, workspaceSchema, workspaceVersionSchema } from "./workspace.ts";

// Every contract whose JSON Schema leaves the process: the CLI's --json-schema, evaluations,
// stored records. Add a contract here and run `pnpm contracts:schemas` (CON-01).
export const contracts = {
  activationReply: activationReplySchema,
  activationRequest: activationRequestSchema,
  asset: assetSchema,
  archiveManifest: archiveManifestSchema,
  artifact: artifactSchema,
  bridgeDataRequest: bridgeDataRequestSchema,
  bridgeReply: bridgeReplySchema,
  bridgeRequest: bridgeRequestSchema,
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

/**
 * The bridge manifest as JSON (CON-03): each action with its arguments and result as JSON Schema,
 * its capability, whether it writes, its limit and its examples, and the capabilities a tool may
 * declare. The prompt's API section and the static checks (M2) read this.
 */
export const bridgeManifest = () => ({
  manifestVersion: BRIDGE_MANIFEST_VERSION,
  requestLimitBytes: BRIDGE_REQUEST_LIMIT_BYTES,
  maxDepthCount: BRIDGE_MAX_DEPTH,
  capabilities: Object.entries(BRIDGE_CAPABILITIES).map(([name, description]) => ({
    name,
    description,
  })),
  actions: Object.entries(BRIDGE_ACTIONS).map(([name, action]) => ({
    name,
    description: action.description,
    capability: action.capability,
    writes: action.writes,
    maxArgsBytes: action.maxArgsBytes,
    args: jsonSchemaOf(action.args),
    result: jsonSchemaOf(action.result),
    examples: action.examples,
  })),
});

const asFile = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * The committed files, by file name, exactly as `pnpm contracts:schemas` writes them: each
 * contract's JSON Schema, and the bridge manifest.
 */
export const renderSchemaFiles = (): Record<string, string> => ({
  ...Object.fromEntries(
    (Object.keys(contracts) as ContractName[]).map((name) => [
      `${name}.schema.json`,
      asFile(toJsonSchema(name)),
    ]),
  ),
  "bridge-manifest.json": asFile(bridgeManifest()),
});
