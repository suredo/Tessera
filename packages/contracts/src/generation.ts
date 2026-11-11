import { z } from "zod";
import { acceptanceChecksSchema } from "./acceptance.ts";
import { STAGES } from "./provider.ts";
import { UI_MODES } from "./artifact.ts";
import { BRIDGE_CAPABILITIES } from "./bridge.ts";
import { jsonObjectSchema } from "./json.ts";
import { versionHashSchema } from "./workspace.ts";
import { profileIdSchema } from "./profiles.ts";
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

/** What a tool doesn't do because no tool here can, said to the person by the host (GEN-08). */
const leftOut = z
  .array(z.string().min(1).max(200))
  .max(5)
  .describe(
    "The parts of the request this tool doesn't do because no tool here can, such as reaching the internet or playing videos, each in plain words for the person. Never a part another tool here could do, or one the person says comes later. Left out when the tool does all of it.",
  );

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
      leftOut: leftOut.optional(),
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
    leftOut: creationSchema.options[0].shape.leftOut,
    files: z.discriminatedUnion("mode", [
      z.strictObject({ mode: z.literal("unchanged") }),
      z
        .strictObject({
          mode: z.literal("style"),
          css: z.string().describe("The complete new CSS."),
        })
        .describe(
          "A change to the look only: the HTML and JavaScript stay exactly as they are (GEN-14).",
        ),
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

/** Register before sending a cancellable request; the opaque capability survives setup/queueing. */
export const REGISTER_REQUEST_ROUTE = "/api/generate/register";
export const CANCEL_REQUEST_ROUTE = "/api/generate/cancel";
export const requestControlSchema = z.strictObject({ token: z.uuid() });
export const cancelRequestReplySchema = z.strictObject({ cancelled: z.boolean() });

/**
 * Where a registered request stands (GEN-16, CLI-07, ADR 0010): waiting in the queue, or the
 * model stage running, with the seconds since the request was sent; `null` before it is sent,
 * between its parts and after it ends. Stage names and elapsed time only, no streamed output.
 */
export const PROGRESS_REQUEST_ROUTE = "/api/generate/progress";
export const requestProgressSchema = z.strictObject({
  stage: z.enum(["waiting", ...STAGES]).nullable(),
  seconds: z.int().nonnegative(),
});
export type RequestProgress = z.infer<typeof requestProgressSchema>;

export const generateRequestSchema = z
  .strictObject({
    controlToken: z.uuid().optional(),
    request: z.string().trim().min(1).max(4000).describe("What the person asked, in their words."),
    workspaceId: z
      .uuid()
      .optional()
      .describe("The workspace open when they asked; none when nothing is open."),
    proposal: z
      .uuid()
      .optional()
      .describe(
        "The token of entry changes waiting for review in that workspace, so the request can approve or decline them in words.",
      ),
  })
  .describe("A request for Tessera to carry out (GEN-01).");
export type GenerateRequest = z.infer<typeof generateRequestSchema>;

/** The browser reports a staged candidate's smoke or behavior failure, once each (GEN-09). */
export const SMOKE_REPAIR_ROUTE = "/api/generate/repair-smoke";
export const smokeRepairRequestSchema = z.strictObject({
  token: z.uuid(),
  workspaceId: z.uuid(),
  hash: versionHashSchema,
  findings: z.array(z.string().min(1).max(8000)).min(1).max(20),
  failure: z
    .enum(["smoke", "behavior"])
    .default("smoke")
    .describe("Which check failed: the smoke check, or the profile's behavior check (VER-03)."),
});
/** As the browser sends it: failure may be left out, meaning the smoke check. */
export type SmokeRepairRequest = z.input<typeof smokeRepairRequestSchema>;

export const CONFIRM_DATA_ROUTE = "/api/generate/confirm-data";
export const confirmDataRequestSchema = z.strictObject({ token: z.uuid(), approve: z.boolean() });
export type ConfirmDataRequest = z.infer<typeof confirmDataRequestSchema>;

export const FINISH_DATA_ROUTE = "/api/generate/finish-data";
export const finishDataRequestSchema = z.strictObject({
  token: z.uuid(),
  workspaceId: z.uuid(),
  hash: versionHashSchema,
});
export type FinishDataRequest = z.infer<typeof finishDataRequestSchema>;

/**
 * The next feature of a big tool made in two passes (GEN-17), asked for once the version before
 * it is active: the activated candidate's token, workspace and hash. The server keeps what is
 * still to come; the browser only names the version it follows.
 */
export const FOLLOW_UP_ROUTE = "/api/generate/follow-up";
export const followUpRequestSchema = finishDataRequestSchema;
export type FollowUpRequest = z.infer<typeof followUpRequestSchema>;

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
    findings: z
      .array(z.string())
      .optional()
      .describe(
        "For the details view: the model's own words when the reason replaced them (GEN-10).",
      ),
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
          leftOut: creationSchema.options[0].shape.leftOut,
        }),
        z.strictObject({
          outcome: z.literal("unchanged"),
          leftOut: creationSchema.options[0].shape.leftOut,
        }),
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
      profile: profileIdSchema
        .nullable()
        .default(null)
        .describe(
          "The verification profile whose behavior check staging runs after the smoke check, from the server's intent (VER-03).",
        ),
      acceptance: acceptanceChecksSchema
        .nullable()
        .default(null)
        .describe(
          "The checks written from the request that staging runs after the smoke check, for a new tool that fits no profile, when the experiment is on (VER-09).",
        ),
      expectedDataRevision: z.int().nonnegative(),
      activation: z.strictObject({ token: z.uuid(), expiresAt: z.int().nonnegative() }),
      name: z.string().min(1),
      summary: z.string().min(1),
      leftOut: creationSchema.options[0].shape.leftOut,
      dataPending: z
        .boolean()
        .optional()
        .describe("The server retains a data-only continuation until this candidate activates."),
      followUps: z
        .array(z.string().min(1))
        .optional()
        .describe(
          "A big new tool's core (GEN-17): the features still to come as edits, by name, in order.",
        ),
    }),
    z.strictObject({
      kind: z.literal("answer"),
      answer: z.enum(GENERATE_ANSWERS),
      reason: z
        .string()
        .optional()
        .describe("The model's own plain reason, for cannot, and for unchanged when it gave one."),
      leftOut: creationSchema.options[0].shape.leftOut.describe(
        "For unchanged: what the request asked that no tool here can do (GEN-08).",
      ),
      findings: z
        .array(z.string())
        .optional()
        .describe(
          "For the details view: the model's own words when the reason above had to replace them (GEN-10, GEN-12).",
        ),
    }),
    z.strictObject({ kind: z.literal("open_saved"), savedToolId: z.string().min(1) }),
    z
      .strictObject({ kind: z.literal("proposal_answer"), token: z.uuid(), approve: z.boolean() })
      .describe(
        "The request answered the entry changes waiting for review: the app confirms or cancels them as its own buttons do.",
      ),
    generationFailureSchema,
  ])
  .describe("What came of a request: a candidate to stage, an answer, a saved tool, or a failure.");
export type GenerateReply = z.infer<typeof generateReplySchema>;
