import {
  BRIDGE_ACTIONS,
  checkBridgeCall,
  type Artifact,
  type BridgeActionName,
  type BridgeArgs,
  type BridgeErrorCode,
  type BridgePhase,
  type BridgeReply,
  type BridgeResult,
} from "@tessera/contracts";
import type { MountedTool } from "./host.ts";

// The host's side of the bridge (RUN-04): it checks every call from a mounted tool against the
// manifest (CON-03) with the one shared check, runs the action, and replies. It keeps the mount's
// phase: a tool may write only once the person has interacted with its page (GEN-06), and a tool
// in the staging panel never may, except to a behavior check's throwaway copy of its synthetic
// data (BRG-06). It answers the host clock itself (RUN-07). A request through a connection goes to
// the server, which makes it (CAP-02); in the staging panel, none goes anywhere (CNX-06).

/** Where the host's date and time come from; tests pass their own, so "the next day" is set. */
export type HostClock = {
  /** Milliseconds since 1970-01-01 UTC. */
  now(): number;
  /** The person's IANA time zone, such as Europe/Lisbon. */
  timeZone(): string;
};

export const systemClock: HostClock = {
  now: () => Date.now(),
  timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
};

/** The clock's answer for a moment in a time zone: the date there, and its offset from UTC. */
export function clockReading(epochMs: number, timeZone: string): BridgeResult<"clock.now"> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZoneName: "longOffset",
  }).formatToParts(epochMs);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  // "GMT" at UTC, otherwise "GMT+05:30" or "GMT-03:00".
  const offset = /GMT([+-])(\d{2}):(\d{2})/.exec(part("timeZoneName"));
  const utcOffsetMinutes = offset
    ? (offset[1] === "-" ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3]))
    : 0;
  return {
    epochMs,
    date: `${part("year")}-${part("month")}-${part("day")}`,
    timeZone,
    utcOffsetMinutes,
  };
}

/** Thrown by a data handler to refuse a call with a code of the bridge's, such as `stale`. */
export class BridgeError extends Error {
  readonly code: BridgeErrorCode;
  constructor(code: BridgeErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * What a candidate's request through a connection gets while it is checked (A69, CNX-06): the
 * sample its version carries whose path is the longest one the request's path starts with, or a
 * plain 404 when none does. Only a connection the version names answers (A66), as outside checks.
 */
export function sampleAnswer(
  samples: Artifact["connections"],
  request: BridgeArgs<"connection.request">,
  now: number,
): BridgeResult<"connection.request"> {
  const name = request.connection;
  if (!Object.hasOwn(samples, name)) {
    throw new BridgeError(
      "not-allowed",
      `This tool wasn't built to use the connection ${name}. Using it takes an edit. Nothing was sent.`,
    );
  }
  const path = request.path.split("?")[0]!;
  const best = Object.keys(samples[name]!.samples)
    .filter((prefix) => path.startsWith(prefix))
    .sort((a, b) => b.length - a.length)[0];
  const sample = best === undefined ? undefined : samples[name]!.samples[best];
  const source = {
    connection: name,
    url: `sample:${request.path}`,
    receivedAt: new Date(now).toISOString(),
  };
  return sample
    ? { ...sample, source }
    : {
        statusCode: 404,
        contentType: "text/plain",
        body: "This tool has no sample answer for that path, so a check gets none.",
        source,
      };
}

/**
 * What a data handler is told beside the arguments: where the mount stood when the call was
 * checked, and the call exactly as the tool made it, so the server can check it again (RUN-04).
 */
export type DataCallContext = { phase: BridgePhase; call: unknown };

/** What the host does for the tool's data actions: `serverData`'s, or a test's. */
export type DataHandlers = {
  read(context: DataCallContext): Promise<BridgeResult<"data.read">>;
  patch(
    batch: BridgeArgs<"data.patch">,
    context: DataCallContext,
  ): Promise<BridgeResult<"data.patch">>;
  /** An image the tool's data names (DATA-11); without it, the host shows no images. */
  asset?(
    args: BridgeArgs<"asset.read">,
    context: DataCallContext,
  ): Promise<BridgeResult<"asset.read">>;
  /** A request through a connection (CAP-02); without it, the host reaches no outside service. */
  connection?(
    args: BridgeArgs<"connection.request">,
    context: DataCallContext,
  ): Promise<BridgeResult<"connection.request">>;
};

export type BridgeOptions = {
  /** The capabilities the tool's version declares (CAP-01). */
  capabilities: readonly string[];
  data: DataHandlers;
  clock?: HostClock;
  /** A tool in the staging panel runs against synthetic data and never writes (RUN-03). */
  staging?: boolean;
  /**
   * A tool a behavior check drives in the staging panel (VER-03): it may write from the start,
   * since its data handlers are a throwaway copy of its synthetic data, never the person's data
   * (BRG-06). Whoever passes it passes those handlers.
   */
  rehearsal?: boolean;
  /**
   * The connections the candidate's version uses, with their sample answers: what its requests
   * get in the staging panel and its rehearsals, in place of the service's (A69).
   */
  samples?: Artifact["connections"];
};

export type ServedBridge = {
  /** Where the mount stands now. */
  phase(): BridgePhase;
  /** Stops answering: calls after this get no reply. */
  stop(): void;
};

/** The parts of a mounted tool the bridge uses. */
export type BridgeTool = Pick<
  MountedTool,
  "instanceId" | "onCall" | "reply" | "onInteraction" | "onEvent"
>;

const FAILED = "The host couldn't do that.";

/**
 * Serves the bridge to a mounted tool until stopped. Every call is checked first (RUN-04), and
 * every result is checked against the manifest before it is sent, so nothing reaches the tool that
 * the manifest doesn't describe.
 */
export function serveBridge(tool: BridgeTool, options: BridgeOptions): ServedBridge {
  const clock = options.clock ?? systemClock;
  let phase: BridgePhase = options.rehearsal ? "active" : options.staging ? "staging" : "starting";
  let serving = true;

  // One handler per action in the manifest: TypeScript refuses this object if one is missing.
  const run: {
    [A in BridgeActionName]: (
      args: BridgeArgs<A>,
      context: DataCallContext,
    ) => Promise<BridgeResult<A>>;
  } = {
    "data.read": (_args, context) => options.data.read(context),
    "data.patch": (batch, context) => options.data.patch(batch, context),
    "asset.read": (args, context) =>
      options.data.asset
        ? options.data.asset(args, context)
        : Promise.reject(new BridgeError("failed", "The host can't show images here.")),
    "clock.now": () => Promise.resolve(clockReading(clock.now(), clock.timeZone())),
    "connection.request": (args, context) => {
      // A check never reaches the real service (ADR 0015, point 5): a candidate's request, read or
      // write, gets the sample answer its version carries (A69), and nothing is sent (CNX-06).
      if (options.staging || options.rehearsal) {
        return Promise.resolve(sampleAnswer(options.samples ?? {}, args, clock.now()));
      }
      return options.data.connection
        ? options.data.connection(args, context)
        : Promise.reject(new BridgeError("failed", "The host can't reach outside services here."));
    },
  };

  const reply = (message: BridgeReply) => {
    if (serving) tool.reply(message);
  };
  const answer = async (call: unknown) => {
    // The phase the call was checked in: the handler passes on that one, not a later one.
    const checkedIn = phase;
    const checked = checkBridgeCall(tool.instanceId, call, {
      instanceId: tool.instanceId,
      phase: checkedIn,
      capabilities: options.capabilities,
    });
    if (!checked.ok) {
      if (checked.reply) reply(checked.reply);
      return;
    }
    const { requestId, action } = checked;
    try {
      const handler = run[action] as (args: unknown, context: DataCallContext) => Promise<unknown>;
      const result = BRIDGE_ACTIONS[action].result.safeParse(
        await handler(checked.args, { phase: checkedIn, call }),
      );
      if (!result.success) throw new Error(`The host's answer to "${action}" doesn't fit.`);
      reply({ requestId, ok: true, result: result.data });
    } catch (error) {
      const refused = error instanceof BridgeError;
      reply({
        requestId,
        ok: false,
        error: { code: refused ? error.code : "failed", message: refused ? error.message : FAILED },
      });
    }
  };

  const stops = [
    tool.onCall((call) => {
      if (serving) void answer(call);
    }),
    tool.onInteraction(() => {
      if (phase === "starting") phase = "active";
    }),
    // A page started again runs its start-up code again, so it waits for the person once more.
    tool.onEvent((event) => {
      if (event === "restarted" && phase === "active" && !options.rehearsal) phase = "starting";
    }),
  ];

  return {
    phase: () => phase,
    stop: () => {
      serving = false;
      stops.forEach((stop) => stop());
    },
  };
}
