import { describe, expect, it } from "vitest";
import type { BridgeReply } from "@tessera/contracts";
import type { MountEvent } from "../src/host.ts";
import {
  BridgeError,
  clockReading,
  serveBridge,
  type BridgeOptions,
  type BridgeTool,
  type DataHandlers,
  type HostClock,
} from "../src/index.ts";

// The host's side of the bridge (RUN-04, GEN-06, RUN-07, CAP-01), against a stand-in for a mounted
// tool: calls go in as the port would deliver them, and replies are kept. The browser tests run
// the same bridge with a hostile tool in the sandbox.

function fakeTool() {
  const calls = new Set<(call: unknown) => void>();
  const interactions = new Set<() => void>();
  const events = new Set<(event: MountEvent) => void>();
  const replies: BridgeReply[] = [];
  const tool: BridgeTool = {
    instanceId: "i-1",
    onCall: (listen) => (calls.add(listen), () => calls.delete(listen)),
    reply: (reply) => replies.push(reply as BridgeReply),
    onInteraction: (listen) => (interactions.add(listen), () => interactions.delete(listen)),
    onEvent: (listen) => (events.add(listen), () => events.delete(listen)),
  };
  return {
    tool,
    replies,
    /** Sends a call and waits until the bridge has answered whatever it will. */
    call: async (action: string, args: unknown = {}, requestId = `r${replies.length + 1}`) => {
      calls.forEach((listen) => listen({ requestId, action, args }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      return replies.at(-1);
    },
    interact: () => interactions.forEach((listen) => listen()),
    event: (event: MountEvent) => events.forEach((listen) => listen(event)),
  };
}

const batch = { operations: [{ op: "add", collection: "tasks", record: { title: "Tea" } }] };

function served(options: Partial<BridgeOptions> = {}) {
  const fake = fakeTool();
  const handled: string[] = [];
  const data: DataHandlers = {
    read: () => {
      handled.push("read");
      return Promise.resolve({ data: { tasks: [] }, revisions: {} });
    },
    patch: () => {
      handled.push("patch");
      return Promise.resolve({ addedIds: ["t-1"] });
    },
  };
  const bridge = serveBridge(fake.tool, { capabilities: [], data, ...options });
  return { ...fake, bridge, handled };
}

const code = (reply: BridgeReply | undefined) => (reply?.ok ? "ok" : reply?.error.code);

describe("serving the bridge (RUN-04)", () => {
  it("runs an accepted call and replies with its result", async () => {
    const { call } = served();
    expect(await call("data.read", {}, "r-7")).toEqual({
      requestId: "r-7",
      ok: true,
      result: { data: { tasks: [] }, revisions: {} },
    });
  });

  it("refuses with the shared check, before any handler runs", async () => {
    const { call, handled, replies } = served();
    expect(code(await call("data.delete"))).toBe("unknown-action");
    expect(code(await call("data.read", { workspaceId: "w-2" }))).toBe("invalid-args");
    expect(code(await call("clock.now"))).toBe("undeclared-capability");
    expect(handled).toEqual([]);
    // Every reply fits its contract, and keeps the call's request ID.
    expect(replies.map((r) => r.requestId)).toEqual(["r1", "r2", "r3"]);
  });

  it("GEN-06: refuses writes until the person interacts with the page, and again after a restart", async () => {
    const { call, interact, event, bridge, handled } = served();
    expect(bridge.phase()).toBe("starting");
    const early = await call("data.patch", batch);
    expect(code(early)).toBe("not-active");
    expect(handled).toEqual([]);

    interact();
    expect(bridge.phase()).toBe("active");
    expect(await call("data.patch", batch)).toMatchObject({
      ok: true,
      result: { addedIds: ["t-1"] },
    });

    // The page started again: its start-up code runs again, so it waits for the person again.
    event("restarted");
    expect(bridge.phase()).toBe("starting");
    expect(code(await call("data.patch", batch))).toBe("not-active");
    interact();
    expect(code(await call("data.patch", batch))).toBe("ok");
    expect(handled).toEqual(["patch", "patch"]);
  });

  it("GEN-06: never lets a tool in the staging panel write, even after input; reads still work", async () => {
    const { call, interact, bridge, handled } = served({ staging: true });
    interact();
    expect(bridge.phase()).toBe("staging");
    expect(code(await call("data.patch", batch))).toBe("not-active");
    expect(code(await call("data.read"))).toBe("ok");
    expect(handled).toEqual(["read"]);
  });

  it("passes on a handler's own refusal, and hides any other error behind a plain message", async () => {
    const stale = new BridgeError("stale", "Someone changed this task first. Nothing was saved.");
    const fail = (error: Error): DataHandlers => ({
      read: () => Promise.reject(error),
      patch: () => Promise.reject(error),
    });
    const refused = served({ data: fail(stale) });
    expect(await refused.call("data.read")).toEqual({
      requestId: "r1",
      ok: false,
      error: { code: "stale", message: "Someone changed this task first. Nothing was saved." },
    });
    const broken = served({ data: fail(new Error("SQLITE_BUSY at C:/Users/me/tessera.db")) });
    expect(await broken.call("data.read")).toEqual({
      requestId: "r1",
      ok: false,
      error: { code: "failed", message: "The host couldn't do that." },
    });
  });

  it("never sends a result the manifest doesn't describe", async () => {
    const wrong = {
      read: () => Promise.resolve({ data: { tasks: [] }, revisions: {}, path: "C:/data" }),
      patch: () => Promise.resolve({ addedIds: ["t-1"] }),
    } as unknown as DataHandlers;
    expect(code(await served({ data: wrong }).call("data.read"))).toBe("failed");
  });

  it("answers nothing once stopped", async () => {
    const { call, bridge, handled, replies } = served();
    bridge.stop();
    await call("data.read");
    expect(replies).toEqual([]);
    expect(handled).toEqual([]);
  });
});

describe("the host clock (RUN-07)", () => {
  const at = (iso: string, timeZone: string): HostClock => ({
    now: () => Date.parse(iso),
    timeZone: () => timeZone,
  });

  it("answers a tool that declares the clock from the host's clock, which a test sets", async () => {
    const clock = { ...at("2026-10-22T23:30:00Z", "Europe/Lisbon") };
    const { call } = served({ capabilities: ["clock"], clock });
    expect(await call("clock.now")).toEqual({
      requestId: "r1",
      ok: true,
      result: {
        epochMs: Date.parse("2026-10-22T23:30:00Z"),
        date: "2026-10-23",
        timeZone: "Europe/Lisbon",
        utcOffsetMinutes: 60,
      },
    });
    // The next day is set, never waited for.
    clock.now = () => Date.parse("2026-10-23T23:30:00Z");
    expect(await call("clock.now")).toMatchObject({ result: { date: "2026-10-24" } });
  });

  it("gives the date and offset where the person is, on both sides of UTC and across DST", () => {
    const moment = Date.parse("2026-10-22T23:30:00Z");
    expect(clockReading(moment, "UTC")).toMatchObject({ date: "2026-10-22", utcOffsetMinutes: 0 });
    expect(clockReading(moment, "America/Sao_Paulo")).toMatchObject({
      date: "2026-10-22",
      utcOffsetMinutes: -180,
    });
    expect(clockReading(moment, "Asia/Kolkata")).toMatchObject({
      date: "2026-10-23",
      utcOffsetMinutes: 330,
    });
    // Lisbon leaves summer time on the last Sunday of October.
    const winter = Date.parse("2026-11-02T12:00:00Z");
    expect(clockReading(winter, "Europe/Lisbon")).toMatchObject({ utcOffsetMinutes: 0 });
  });
});
