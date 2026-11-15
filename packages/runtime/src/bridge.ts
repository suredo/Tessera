import {
  ASSET_LIMIT_BYTES,
  ASSET_TYPES,
  BRIDGE_ACTIONS,
  checkBridgeCall,
  checkSaveFile,
  pickName,
  type SaveFile,
  type SaveType,
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

/** `date` (YYYY-MM-DD) and `days` more, by the calendar. */
const addDays = (date: string, days: number): string => {
  const at = new Date(`${date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
};

/**
 * `clock` moved `days` calendar days on, in its own time zone (RUN-07): the same time of day where
 * it can be, and always the later date, whatever a daylight-saving change does to the day's length.
 * For a behavior check that comes back to a tool another day (#351).
 */
export function daysLater(clock: HostClock, days: number): HostClock {
  if (days === 0) return clock;
  const zone = clock.timeZone();
  const shift = (now: number) => {
    const wanted = addDays(clockReading(now, zone).date, days);
    let at = now + days * 86_400_000;
    // A day of 23 or 25 hours on the way: an hour at a time toward the wanted date.
    for (let tries = 0; tries < 4 && clockReading(at, zone).date !== wanted; tries += 1) {
      at += clockReading(at, zone).date < wanted ? 3_600_000 : -3_600_000;
    }
    return at;
  };
  return { now: () => shift(clock.now()), timeZone: () => zone };
}

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

/** A plain grey square, 1 by 1 pixel, as PNG: what a checked tool's image gets (A75, CNX-06). */
export const PLACEHOLDER_IMAGE = {
  type: "image/png",
  bytesBase64:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
} as const;

/**
 * What a checked tool's pick gets (A80): a PNG of 16 by 12 pixels in four coloured quarters, with
 * its asset ID, the SHA-256 of its bytes. No picker opens, and `asset.read` shows it by that ID
 * while the tool is checked.
 */
export const SAMPLE_PICK = {
  file: {
    id: "3d1a5ef87bb6164cfbd0bd52ee1fc2db74a1d78b1051088e33ce59ad4d4a3d33",
    type: "image/png",
    name: "sample.png",
    sizeBytes: 92,
    widthPx: 16,
    heightPx: 12,
  },
  bytesBase64:
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAIAAADkharWAAAAI0lEQVR42mPQz7bCih4s1MaKGEakBu2YFVjRCTs7rGhEagAAWPztkV9j768AAAAASUVORK5CYII=",
} as const;

/**
 * What a candidate's image through a connection gets while it is checked (A75, CNX-06): the
 * placeholder, for a connection its version names, and nothing is fetched.
 */
export function placeholderImage(
  samples: Artifact["connections"],
  request: BridgeArgs<"connection.image">,
): BridgeResult<"connection.image"> {
  if (!Object.hasOwn(samples, request.connection)) {
    throw new BridgeError(
      "not-allowed",
      `This tool wasn't built to use the connection ${request.connection}. Using it takes an edit. Nothing was sent.`,
    );
  }
  return { ...PLACEHOLDER_IMAGE };
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
  /** A page under a connection's address, checked by the server for the host page to open (A76). */
  openPage?(
    args: BridgeArgs<"link.open">,
    context: DataCallContext,
  ): Promise<BridgeResult<"link.open">>;
  /** An image through a connection (A75), fetched by the host and kept nowhere. */
  connectionImage?(
    args: BridgeArgs<"connection.image">,
    context: DataCallContext,
  ): Promise<BridgeResult<"connection.image">>;
  /** An image the person picked, kept by the server as an asset (A80); without it, none is. */
  pickFile?(file: PickedBytes, context: DataCallContext): Promise<BridgeResult<"file.pick">>;
};

/** What the person is told of a file a tool offers to save (A81): never its bytes. */
export type SaveOffer = { name: string; type: SaveType; sizeBytes: number };

/**
 * Hands a file to the browser to save, from the host page, never the tool's frame (A81): a
 * download of its bytes under its name, which the browser saves where it saves downloads.
 */
export const saveInPage = (file: SaveFile): void => {
  const url = URL.createObjectURL(new Blob([file.bytes], { type: file.type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  // Long enough for the browser to have read it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

/** A picked file's name, made one a pick may carry, and its bytes, as the host page sends them. */
export type PickedBytes = { name: string; bytes: Uint8Array<ArrayBuffer> };

/** The file the person chose in the browser's picker, as much of it as the host reads. */
export type ChosenFile = { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> };

/**
 * Shows the browser's own file picker in the host page, never the tool's frame (A80), for the
 * types in `accept`: resolves with the file the person chose, or null if they chose none. The
 * browser shows it only right after a click, by its own rule.
 */
export const chooseFileInPage = (accept: readonly string[]): Promise<ChosenFile | null> =>
  new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept.join(",");
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });

/**
 * Opens a page in a new tab, in the host page, never the tool's frame (A76): `noopener` and
 * `noreferrer`, so the page can't reach Tessera or learn where it came from. The browser opens
 * it only right after a click, by its own rule, and blocks it otherwise.
 */
export const openInNewTab = (url: string): void => {
  window.open(url, "_blank", "noopener,noreferrer");
};

/**
 * Whether the host page has the person's activation now (A76, #371 review): a click in the tool's
 * frame gives its ancestors, this page included, a few seconds of it. With `noopener`, a page
 * that opened and one the browser blocked both return null, so the host asks first instead.
 */
export const pageHasActivation = (): boolean =>
  typeof navigator !== "undefined" && navigator.userActivation !== undefined
    ? navigator.userActivation.isActive
    : false;

const NO_CLICK =
  "A page opens only right after the person clicks for it. Nothing was opened. Open pages only from a click handler.";
const NO_CLICK_SAVE =
  "A file is offered only right after the person clicks for it. Nothing was saved. Offer files only from a click handler.";
const NO_CLICK_PICK =
  "A file is picked only right after the person clicks for it. Nothing was opened. Ask for files only from a click handler.";
const MB = 1024 * 1024;

export type BridgeOptions = {
  /** How a page opens; `openInNewTab` unless a test gives its own (A76). */
  openWindow?: (url: string) => void;
  /** How the person chooses a file; `chooseFileInPage` unless a test gives its own (A80). */
  chooseFile?: (accept: readonly string[]) => Promise<ChosenFile | null>;
  /**
   * Asks the person whether to save a file the tool offers (A81), in the host's own words;
   * resolves true if they say Save. Without it, no file is saved.
   */
  askToSave?: (offer: SaveOffer) => Promise<boolean>;
  /** How a file is saved once the person says so; `saveInPage` unless a test gives its own. */
  saveFile?: (file: SaveFile) => void;
  /** Whether the person just clicked; `pageHasActivation` unless a test gives its own (A76). */
  hasActivation?: () => boolean;
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
  // One picker at a time: the browser shows one, and a second would never be answered.
  let picking = false;
  // One question about saving at a time, so a tool can't stack them in front of the person.
  let offering = false;

  // One handler per action in the manifest: TypeScript refuses this object if one is missing.
  const run: {
    [A in BridgeActionName]: (
      args: BridgeArgs<A>,
      context: DataCallContext,
    ) => Promise<BridgeResult<A>>;
  } = {
    "data.read": (_args, context) => options.data.read(context),
    "data.patch": (batch, context) => options.data.patch(batch, context),
    "asset.read": (args, context) => {
      // A checked tool shows the sample its pick got (A80).
      if ((options.staging || options.rehearsal) && args.id === SAMPLE_PICK.file.id) {
        return Promise.resolve({
          type: SAMPLE_PICK.file.type,
          bytesBase64: SAMPLE_PICK.bytesBase64,
        });
      }
      return options.data.asset
        ? options.data.asset(args, context)
        : Promise.reject(new BridgeError("failed", "The host can't show images here."));
    },
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
    "link.open": async (args, context) => {
      // A check opens nothing (CNX-06): a page of a connection its version names is answered,
      // and no window opens (A76).
      if (options.staging || options.rehearsal) {
        if (!Object.hasOwn(options.samples ?? {}, args.connection)) {
          throw new BridgeError(
            "not-allowed",
            `This tool wasn't built to use the connection ${args.connection}. Using it takes an edit. Nothing was opened.`,
          );
        }
        return { url: `sample:${args.path}` };
      }
      if (!options.data.openPage) {
        throw new BridgeError("failed", "The host can't open pages here.");
      }
      // Only right after a click, before asking the server and again before opening, as the
      // server's answer takes time: otherwise the browser would block it unseen (CNX-09).
      const clicked = options.hasActivation ?? pageHasActivation;
      if (!clicked()) throw new BridgeError("not-allowed", NO_CLICK);
      // The server checks the address as a read's; the host page opens it.
      const page = await options.data.openPage(args, context);
      if (!clicked()) throw new BridgeError("not-allowed", NO_CLICK);
      (options.openWindow ?? openInNewTab)(page.url);
      return page;
    },
    "connection.image": (args, context) => {
      // A check fetches nothing either: a named connection's image is the placeholder (A75).
      if (options.staging || options.rehearsal) {
        return Promise.resolve(placeholderImage(options.samples ?? {}, args));
      }
      return options.data.connectionImage
        ? options.data.connectionImage(args, context)
        : Promise.reject(new BridgeError("failed", "The host can't show images from here."));
    },
    "file.pick": async (_args, context) => {
      // A check opens no picker (A80): its pick is the sample image, kept nowhere.
      if (options.staging || options.rehearsal) return { file: { ...SAMPLE_PICK.file } };
      if (!options.data.pickFile) {
        throw new BridgeError("failed", "The host can't open files here.");
      }
      // Only right after a click, so a tool can't put a picker in front of the person unasked;
      // the browser would refuse it anyway, unseen.
      const clicked = options.hasActivation ?? pageHasActivation;
      if (!clicked()) throw new BridgeError("not-allowed", NO_CLICK_PICK);
      if (picking) {
        throw new BridgeError(
          "not-allowed",
          "The person is already picking a file. Nothing more was opened. Ask again once that pick is answered.",
        );
      }
      picking = true;
      let chosen: ChosenFile | null;
      try {
        chosen = await (options.chooseFile ?? chooseFileInPage)(ASSET_TYPES);
      } finally {
        picking = false;
      }
      if (!chosen) return { file: null };
      // Over the limit, it isn't sent at all; the server checks again, by its own lights.
      if (chosen.size > ASSET_LIMIT_BYTES) {
        throw new BridgeError(
          "too-large",
          `Nothing was kept: the file is ${Math.ceil(chosen.size / MB)} MB, over the limit of ${ASSET_LIMIT_BYTES / MB} MB for one image.`,
        );
      }
      const bytes = new Uint8Array(await chosen.arrayBuffer());
      return options.data.pickFile({ name: pickName(chosen.name), bytes }, context);
    },
    "file.save": async (args) => {
      // Checked first, in a check too, so a tool that offers a broken file is told why.
      const checked = checkSaveFile(args);
      if (!checked.ok) throw new BridgeError("invalid-args", checked.message);
      // A check asks nothing and saves nothing (A81): the offer is answered as saved.
      if (options.staging || options.rehearsal) return { saved: true };
      if (!options.askToSave) throw new BridgeError("failed", "The host can't save files here.");
      const clicked = options.hasActivation ?? pageHasActivation;
      if (!clicked()) throw new BridgeError("not-allowed", NO_CLICK_SAVE);
      if (offering) {
        throw new BridgeError(
          "not-allowed",
          "The person is already being asked about a file. Nothing was saved. Offer it again once that is answered.",
        );
      }
      offering = true;
      let allowed: boolean;
      try {
        const { file } = checked;
        allowed = await options.askToSave({
          name: file.name,
          type: file.type,
          sizeBytes: file.bytes.byteLength,
        });
      } finally {
        offering = false;
      }
      if (!allowed) return { saved: false };
      (options.saveFile ?? saveInPage)(checked.file);
      return { saved: true };
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
