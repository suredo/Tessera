import { z } from "zod";
import { UI_MODES } from "./artifact.ts";
import { BRIDGE_CAPABILITIES } from "./bridge.ts";
import { jsonObjectSchema } from "./json.ts";
import { versionHashSchema } from "./workspace.ts";
import { migrationSchema } from "./migration.ts";
import { patchBatchSchema, collectionName, recordIdSchema } from "./patch.ts";

// What the generation stages answer, and how their failures are classed (CON-02, GEN-05, GEN-09).
// Each answer is a discriminated union, so a field exists only where it means something, and no
// null stands for two things.

/** Why a candidate failed; each class has its own repair (GEN-09). A provider failure is never repaired. */
export const FAILURE_CLASSES = ["schema-shape", "static", "smoke", "behavior", "provider"] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

const capabilities = Object.keys(BRIDGE_CAPABILITIES) as [
  keyof typeof BRIDGE_CAPABILITIES,
  ...(keyof typeof BRIDGE_CAPABILITIES)[],
];

const code = z
  .strictObject({ html: z.string(), css: z.string(), js: z.string() })
  .describe("The tool: the HTML inside its page's body, its CSS and its JavaScript.");

export const creationSchema = z
  .discriminatedUnion("outcome", [
    z.strictObject({
      outcome: z.literal("tool"),
      name: z
        .string()
        .min(1)
        .max(80)
        .describe("The tool's name, short, in the person's language and plain words."),
      summary: z
        .string()
        .min(1)
        .max(400)
        .describe("What the tool does, in one or two plain sentences for the person."),
      code,
      data: z.strictObject({
        schema: jsonObjectSchema.describe(
          "The JSON Schema of the tool's data: an object of lists of records, each with a string id.",
        ),
        reusableDefaults: jsonObjectSchema.describe(
          "Data worth keeping when the tool is used again, such as settings or categories; never the person's own entries.",
        ),
        initialState: jsonObjectSchema.describe(
          "The entries this request itself gives, such as the items it lists; {} when it gives none.",
        ),
      }),
      capabilities: z
        .array(z.enum(capabilities))
        .describe("The host capabilities the tool needs, only those it uses (CAP-01)."),
      uiMode: z
        .enum(UI_MODES)
        .describe(
          "custom only when the person asked for their own design or to drop the standard.",
        ),
    }),
    z.strictObject({
      outcome: z.literal("cannot"),
      reason: z
        .string()
        .min(1)
        .max(400)
        .describe("Why no tool here can do this, in plain words for the person."),
    }),
  ])
  .describe("The create stage's answer: a new tool, or why none can be made (CON-02, GEN-05).");
export type Creation = z.infer<typeof creationSchema>;

/** Edits declare changes explicitly; the host owns the name and unchanged declarations (CON-02). */
export const editSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("edit"),
    summary: creationSchema.options[0].shape.summary,
    files: z.discriminatedUnion("mode", [
      z.strictObject({ mode: z.literal("unchanged") }),
      z.strictObject({ mode: z.literal("replace"), code }),
    ]),
    data: z.discriminatedUnion("mode", [
      z.strictObject({ mode: z.literal("unchanged") }),
      z.strictObject({
        mode: z.literal("migrate"),
        schema: jsonObjectSchema,
        defaults: jsonObjectSchema,
        migration: migrationSchema,
      }),
    ]),
  }),
  creationSchema.options[1],
]);
export type Edit = z.infer<typeof editSchema>;

/** Chat plans reuse record patches; the host binds revisions to the planning snapshot (DATA-02). */
export const dataPlanSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("patch"),
    summary: creationSchema.options[0].shape.summary,
    patch: patchBatchSchema,
  }),
  z.strictObject({ outcome: z.literal("unchanged") }),
  z.strictObject({ outcome: z.literal("clarify") }),
  creationSchema.options[1],
]);
export type DataPlan = z.infer<typeof dataPlanSchema>;

/** Host-made before/after facts, shown before an existing entry is changed or removed. */
export const dataChangePreviewSchema = z.strictObject({
  collection: collectionName,
  id: recordIdSchema,
  before: jsonObjectSchema.nullable(),
  after: jsonObjectSchema.nullable(),
});
export type DataChangePreview = z.infer<typeof dataChangePreviewSchema>;

/** The host app asks for a request to be carried out here (GEN-01, GEN-04). */
export const GENERATE_ROUTE = "/api/generate";

export const generateRequestSchema = z
  .strictObject({
    request: z.string().trim().min(1).max(4000).describe("What the person asked, in their words."),
    workspaceId: z
      .uuid()
      .optional()
      .describe("The workspace open when they asked; none when nothing is open."),
  })
  .describe("A request for Tessera to carry out (GEN-01).");
export type GenerateRequest = z.infer<typeof generateRequestSchema>;

/** The browser reports a staged candidate's smoke failure, once (GEN-09). */
export const SMOKE_REPAIR_ROUTE = "/api/generate/repair-smoke";
export const smokeRepairRequestSchema = z.strictObject({
  workspaceId: z.uuid(),
  hash: versionHashSchema,
  findings: z.array(z.string().min(1).max(8000)).min(1).max(20),
});
export type SmokeRepairRequest = z.infer<typeof smokeRepairRequestSchema>;

export const CONFIRM_DATA_ROUTE = "/api/generate/confirm-data";
export const confirmDataRequestSchema = z.strictObject({ token: z.uuid(), approve: z.boolean() });
export type ConfirmDataRequest = z.infer<typeof confirmDataRequestSchema>;

export const FINISH_DATA_ROUTE = "/api/generate/finish-data";
export const finishDataRequestSchema = z.strictObject({
  workspaceId: z.uuid(),
  hash: versionHashSchema,
});
export type FinishDataRequest = z.infer<typeof finishDataRequestSchema>;

const DATA_ANSWERS = [
  "data_unchanged",
  "data_cancelled",
  "data_stale",
  "data_clarify",
  "data_cannot",
] as const;
const generationFailureSchema = z.strictObject({
  kind: z.literal("failed"),
  failure: z.enum(FAILURE_CLASSES),
  message: z.string().min(1).describe("Plain words for the person."),
  findings: z.array(z.string()).describe("For repair and the details view (GEN-10)."),
});

/** Data results also compose with verified interface facts, without duplicating contracts. */
export const dataReplySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("data_changed"),
    workspaceId: z.uuid(),
    name: z.string().min(1),
    count: z.int().positive(),
    summary: creationSchema.options[0].shape.summary,
  }),
  z.strictObject({
    kind: z.literal("data_confirmation"),
    workspaceId: z.uuid(),
    name: z.string().min(1),
    token: z.uuid(),
    summary: creationSchema.options[0].shape.summary,
    changes: z.array(dataChangePreviewSchema).min(1).max(100),
  }),
  z.strictObject({
    kind: z.literal("answer"),
    answer: z.enum(DATA_ANSWERS),
    reason: z.string().optional(),
  }),
  generationFailureSchema,
]);
export type DataReply = z.infer<typeof dataReplySchema>;

/** What the host can say instead of making a tool, for the chat to word (GEN-08). */
export const GENERATE_ANSWERS = [
  "clarify",
  "unsupported",
  "cannot",
  "ask_to_split",
  "not_yet",
  "unchanged",
  "stale",
  ...DATA_ANSWERS,
] as const;

export const generateReplySchema = z
  .discriminatedUnion("kind", [
    dataReplySchema.options[0],
    dataReplySchema.options[1],
    z.strictObject({
      kind: z.literal("mixed_data"),
      workspaceId: z.uuid(),
      name: z.string().min(1),
      interface: z.discriminatedUnion("outcome", [
        z.strictObject({
          outcome: z.literal("updated"),
          summary: creationSchema.options[0].shape.summary,
        }),
        z.strictObject({ outcome: z.literal("unchanged") }),
      ]),
      data: dataReplySchema,
    }),
    z.strictObject({
      kind: z.literal("candidate"),
      operation: z.enum(["create", "edit"]),
      workspaceId: z.uuid(),
      hash: z.string().regex(/^[0-9a-f]{64}$/),
      mountId: z.string().min(1).describe("Where the candidate is served for staging (RUN-03)."),
      capabilities: z.array(z.string()),
      syntheticData: jsonObjectSchema.describe("What staging runs it against: its defaults."),
      expectedDataRevision: z.int().nonnegative(),
      name: z.string().min(1),
      summary: z.string().min(1),
      dataPending: z
        .boolean()
        .optional()
        .describe("The server retains a data-only continuation until this candidate activates."),
    }),
    z.strictObject({
      kind: z.literal("answer"),
      answer: z.enum(GENERATE_ANSWERS),
      reason: z.string().optional().describe("The model's own plain reason, for cannot."),
    }),
    z.strictObject({ kind: z.literal("open_saved"), savedToolId: z.string().min(1) }),
    generationFailureSchema,
  ])
  .describe("What came of a request: a candidate to stage, an answer, a saved tool, or a failure.");
export type GenerateReply = z.infer<typeof generateReplySchema>;
