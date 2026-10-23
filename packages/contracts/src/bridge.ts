import { z } from "zod";
import { jsonObjectSchema, refusingReservedKey } from "./json.ts";
import { patchBatchSchema, recordIdSchema, TOOL_DATA_LIMIT_BYTES } from "./patch.ts";

// The bridge (CON-03, RUN-04): everything a tool may ask of the host, listed once. The checks on
// each call, the manifest file and, from M2, the prompt's API section and static checks (VER-01)
// all come from BRIDGE_ACTIONS and BRIDGE_CAPABILITIES; nothing describes an action beside them.

/** The manifest's version. Raise it when an action changes in a way old tools would notice. */
export const BRIDGE_MANIFEST_VERSION = 1;

/** What a tool may declare (CAP-01). Every action that needs one names it. */
export const BRIDGE_CAPABILITIES = {
  clock: "The current date, time and time zone, from the host's clock (RUN-07).",
} as const;
export type BridgeCapability = keyof typeof BRIDGE_CAPABILITIES;

/**
 * Where a mount stands. A tool is `starting` until the host has given it its data, and `staging`
 * while it runs hidden against synthetic data (RUN-03); only an `active` tool may write (GEN-06).
 */
export const BRIDGE_PHASES = ["starting", "staging", "active"] as const;
export type BridgePhase = (typeof BRIDGE_PHASES)[number];

const noArgs = z.strictObject({}).describe("No arguments.");
const revisionsSchema = z
  .record(z.string(), z.record(recordIdSchema, z.int().min(1)))
  .describe(
    "Each record's revision count, by collection and ID; a change carries the count it was planned against (DATA-02).",
  );

type ActionDefinition = {
  description: string;
  /** The capability a tool must declare to call it; null if every tool may. */
  capability: BridgeCapability | null;
  /** A write changes the person's data, so it is refused until the tool is active (GEN-06). */
  writes: boolean;
  args: z.ZodType;
  result: z.ZodType;
  /** The largest arguments the action takes, as UTF-8 JSON. */
  maxArgsBytes: number;
  examples: { args: unknown; result: unknown }[];
};

// No action takes a file path, a URL or a workspace: a tool reaches only its own data, so there is
// nothing to name another's with (BRG-07). Arguments are strict objects, so extra fields are refused.
export const BRIDGE_ACTIONS = {
  "data.read": {
    description: "Reads the tool's data, with the revision count of each record.",
    capability: null,
    writes: false,
    args: noArgs,
    result: z.strictObject({ data: jsonObjectSchema, revisions: revisionsSchema }),
    maxArgsBytes: 1024,
    examples: [
      {
        args: {},
        result: {
          data: { tasks: [{ id: "t-1", title: "Buy milk", done: false }] },
          revisions: { tasks: { "t-1": 1 } },
        },
      },
    ],
  },
  "data.patch": {
    description:
      "Changes the tool's data: adds, replaces fields of, or removes records, all or nothing (DATA-02). Refused until the tool is active.",
    capability: null,
    writes: true,
    args: patchBatchSchema,
    result: z.strictObject({
      addedIds: z.array(recordIdSchema).describe("The IDs the host gave added records, in order."),
    }),
    maxArgsBytes: TOOL_DATA_LIMIT_BYTES,
    examples: [
      {
        args: {
          operations: [
            { op: "add", collection: "tasks", record: { title: "Call the bank", done: false } },
            {
              op: "replace",
              collection: "tasks",
              id: "t-1",
              revisionCount: 1,
              fields: { done: true },
            },
          ],
        },
        result: { addedIds: ["t-2"] },
      },
    ],
  },
  "clock.now": {
    description:
      "The current date and time from the host's clock. Use it instead of Date.now() or new Date() (RUN-07).",
    capability: "clock",
    writes: false,
    args: noArgs,
    result: z.strictObject({
      epochMs: z.int().describe("Milliseconds since 1970-01-01 UTC."),
      date: z.iso.date().describe("Today's date where the person is, YYYY-MM-DD."),
      timeZone: z.string().min(1).describe("The person's IANA time zone, such as Europe/Lisbon."),
      utcOffsetMinutes: z.int().describe("The time zone's offset from UTC now, in minutes."),
    }),
    maxArgsBytes: 1024,
    examples: [
      {
        args: {},
        result: {
          epochMs: 1792659600000,
          date: "2026-10-22",
          timeZone: "Europe/Lisbon",
          utcOffsetMinutes: 60,
        },
      },
    ],
  },
} as const satisfies Record<string, ActionDefinition>;
export type BridgeActionName = keyof typeof BRIDGE_ACTIONS;

/** The largest request the bridge reads: the largest arguments, with room for the envelope. */
export const BRIDGE_REQUEST_LIMIT_BYTES =
  Math.max(...Object.values(BRIDGE_ACTIONS).map((a) => a.maxArgsBytes)) + 1024;

const requestIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/)
  .describe("Chosen by the tool; the reply carries it back.");

/** A call from a tool, as its preamble sends it. Its arguments are checked by its action. */
export const bridgeRequestSchema = refusingReservedKey(
  z.strictObject({
    requestId: requestIdSchema,
    action: z.string().min(1).max(64),
    args: jsonObjectSchema.describe("The action's arguments; every action takes an object."),
  }),
).describe("A call from a tool to the host (CON-03).");
export type BridgeRequest = z.infer<typeof bridgeRequestSchema>;

/** Why the bridge refused a call. */
export const BRIDGE_ERROR_CODES = [
  "malformed",
  "too-large",
  "unknown-action",
  "undeclared-capability",
  "not-active",
  "invalid-args",
  "stale",
  "failed",
] as const;
export type BridgeErrorCode = (typeof BRIDGE_ERROR_CODES)[number];

/** The host's answer to a call: a result, or a plain reason why nothing happened. */
export const bridgeReplySchema = z
  .discriminatedUnion("ok", [
    z.strictObject({
      requestId: requestIdSchema,
      ok: z.literal(true),
      result: jsonObjectSchema.describe("The action's result; every result is an object."),
    }),
    z.strictObject({
      requestId: requestIdSchema.nullable().describe("Null when the request carried no usable ID."),
      ok: z.literal(false),
      error: z.strictObject({ code: z.enum(BRIDGE_ERROR_CODES), message: z.string().min(1) }),
    }),
  ])
  .describe("The host's reply to a tool's call (CON-03).");
export type BridgeReply = z.infer<typeof bridgeReplySchema>;

/** What the host knows of the mount a call came through. */
export type BridgeContext = {
  instanceId: string;
  phase: BridgePhase;
  /** The capabilities the tool's version declares (CAP-01). */
  capabilities: readonly string[];
};

/** A call that may go ahead, with its arguments parsed by its action's schema. */
export type AcceptedCall = { ok: true; requestId: string; action: BridgeActionName; args: unknown };
/**
 * A refused call. `reply` is what to send back; null when nothing may be sent, because the call
 * came from another instance, whose port this isn't (BRG-05).
 */
export type RefusedCall = { ok: false; reply: Extract<BridgeReply, { ok: false }> | null };

const utf8Bytes = (text: string) => new TextEncoder().encode(text).byteLength;
const kb = (bytes: number) => Math.ceil(bytes / 1024);

/** How deeply a call's lists and objects may nest. */
export const BRIDGE_MAX_DEPTH = 64;

/**
 * Walks a call once, with bounded work, before anything reads it whole (CON-01, BRG-01). A port
 * carries any cloneable value, but only JSON is kept exactly, so a Date, a Map, NaN, an undefined
 * field, or a list with holes or named properties is `malformed`. A port also keeps shared
 * references, which JSON writes out once per use: the walk counts a lower bound of that written
 * size, every use included, and stops as soon as it passes `limitBytes`, so a small graph that
 * would expand without end is `too-large` after bounded work. Each step adds at least a byte. The
 * depth limit stops a cycle and keeps every later step on the stack.
 */
function walkCall(message: unknown, limitBytes: number): "ok" | "malformed" | "too-large" {
  let bytes = 0;
  // UTF-8 never takes fewer bytes than UTF-16 code units, so a string's length is a lower bound.
  const visit = (value: unknown, depth: number): "ok" | "malformed" | "too-large" => {
    if (value === null || typeof value === "boolean") bytes += 4;
    else if (typeof value === "string") bytes += value.length + 2;
    else if (typeof value === "number") {
      if (!Number.isFinite(value)) return "malformed";
      bytes += 1;
    } else if (typeof value !== "object" || depth >= BRIDGE_MAX_DEPTH) {
      return "malformed";
    } else {
      bytes += 2;
      const isArray = Array.isArray(value);
      const proto = Object.getPrototypeOf(value) as unknown;
      if (isArray ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) {
        return "malformed";
      }
      const keys = Object.keys(value);
      if (isArray && keys.length !== value.length) return "malformed";
      // A comma between entries, and an object's key with its quotes and colon: never more than
      // JSON writes, so the count stays a lower bound and a call under the limit always passes.
      for (const [index, key] of keys.entries()) {
        bytes += (index > 0 ? 1 : 0) + (isArray ? 0 : key.length + 3);
        if (bytes > limitBytes) return "too-large";
        const result = visit((value as Record<string, unknown>)[key], depth + 1);
        if (result !== "ok") return result;
      }
    }
    return bytes > limitBytes ? "too-large" : "ok";
  };
  return visit(message, 0);
}

// The call's request ID, if it has a usable one, read without walking the rest of it.
function usableRequestId(message: unknown): string | null {
  if (typeof message !== "object" || message === null || !Object.hasOwn(message, "requestId")) {
    return null;
  }
  const id = (message as { requestId?: unknown }).requestId;
  return requestIdSchema.safeParse(id).success ? (id as string) : null;
}

const refuse = (requestId: string | null, code: BridgeErrorCode, message: string): RefusedCall => ({
  ok: false,
  reply: { requestId, ok: false, error: { code, message } },
});

/**
 * Checks one call against the manifest and the mount it came through (RUN-04): its instance, its
 * size and shape, that the action exists, that the tool declared what it needs, that a write
 * waits until the tool is active, and its arguments. Nothing is changed; data revisions are the
 * patch engine's to check (DATA-02). `instanceId` is the one the call arrived with.
 */
export function checkBridgeCall(
  instanceId: unknown,
  message: unknown,
  context: BridgeContext,
): AcceptedCall | RefusedCall {
  if (instanceId !== context.instanceId) return { ok: false, reply: null };
  // Every refusal from here on carries the request ID, if the call has a usable one.
  const id = usableRequestId(message);

  const walked = walkCall(message, BRIDGE_REQUEST_LIMIT_BYTES);
  const tooLarge = `The call is larger than the bridge takes (${kb(BRIDGE_REQUEST_LIMIT_BYTES)} KB).`;
  if (walked === "malformed") {
    return refuse(
      id,
      "malformed",
      `The call isn't plain data (objects, lists, text, numbers), at most ${BRIDGE_MAX_DEPTH} levels deep.`,
    );
  }
  if (walked === "too-large" || utf8Bytes(JSON.stringify(message)) > BRIDGE_REQUEST_LIMIT_BYTES) {
    return refuse(id, "too-large", tooLarge);
  }
  const request = bridgeRequestSchema.safeParse(message);
  if (!request.success) {
    return refuse(
      id,
      "malformed",
      "A call needs a requestId, an action and args, and nothing else.",
    );
  }
  const { requestId, action: name, args } = request.data;

  if (!Object.hasOwn(BRIDGE_ACTIONS, name)) {
    return refuse(requestId, "unknown-action", `The host has no action called "${name}".`);
  }
  const action: ActionDefinition = BRIDGE_ACTIONS[name as BridgeActionName];
  if (action.capability && !context.capabilities.includes(action.capability)) {
    return refuse(
      requestId,
      "undeclared-capability",
      `"${name}" needs the "${action.capability}" capability, which this tool doesn't declare.`,
    );
  }
  if (action.writes && context.phase !== "active") {
    return refuse(
      requestId,
      "not-active",
      `"${name}" changes the person's data, so it waits until the tool is active. Nothing was saved. Write only in answer to what the person does, never while the tool starts.`,
    );
  }
  const argsBytes = utf8Bytes(JSON.stringify(args));
  if (argsBytes > action.maxArgsBytes) {
    return refuse(
      requestId,
      "too-large",
      `The arguments of "${name}" are ${kb(argsBytes)} KB; the limit is ${kb(action.maxArgsBytes)} KB.`,
    );
  }
  const parsed = action.args.safeParse(args);
  if (!parsed.success) {
    const where = parsed.error.issues[0]?.path.join(".") || "args";
    return refuse(requestId, "invalid-args", `The arguments of "${name}" don't fit (at ${where}).`);
  }
  return { ok: true, requestId, action: name as BridgeActionName, args: parsed.data };
}
