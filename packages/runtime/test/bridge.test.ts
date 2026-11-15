import { describe, expect, it } from "vitest";
import type { BridgeReply } from "@tessera/contracts";
import type { MountEvent } from "../src/host.ts";
import {
  BridgeError,
  clockReading,
  daysLater,
  PLACEHOLDER_IMAGE,
  SAMPLE_PICK,
  serveBridge,
  type BridgeOptions,
  type BridgeTool,
  type ChosenFile,
  type SaveOffer,
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

describe("requests through a connection (CAP-02)", () => {
  const read = { connection: "movies", method: "GET", path: "/search?query=alien" };
  const answer = {
    statusCode: 200,
    contentType: "application/json",
    body: "[]",
    source: {
      connection: "movies",
      url: "https://api.example.com/search?query=alien",
      receivedAt: "2026-11-14T10:00:00.000Z",
    },
  };
  // A host page whose server answers every connection request, recording what it was asked.
  const withConnection = (
    options: Omit<Partial<BridgeOptions>, "data"> & { data?: Partial<DataHandlers> } = {},
  ) => {
    const asked: unknown[] = [];
    const fake = served({
      capabilities: ["connection"],
      ...options,
      data: {
        read: () => Promise.resolve({ data: {}, revisions: {} }),
        patch: () => Promise.resolve({ addedIds: [] }),
        connection: (args) => {
          asked.push(args);
          return Promise.resolve(answer);
        },
        ...options.data,
      },
    });
    return { ...fake, asked };
  };

  it("CAP-02: passes a read to the server while the tool starts, and its answer back", async () => {
    const { call, asked } = withConnection();
    expect(await call("connection.request", read)).toMatchObject({ ok: true, result: answer });
    expect(asked).toEqual([read]);
  });

  const samples = {
    movies: {
      samples: {
        "/search": { statusCode: 200, contentType: "application/json", body: '["Alien"]' },
        "/search/movie": { statusCode: 200, contentType: "application/json", body: '["Heat"]' },
      },
    },
  };

  it("CNX-06: a tool being checked gets its sample answers, reads and writes alike, and asks nothing of the server", async () => {
    for (const options of [{ staging: true }, { rehearsal: true }]) {
      const { call, asked, interact } = withConnection({ ...options, samples });
      interact();
      const at = JSON.stringify(options);
      // The longest sample path the request's path starts with, its query aside.
      expect(
        await call("connection.request", { ...read, path: "/search/movie?query=alien" }),
        at,
      ).toMatchObject({
        ok: true,
        result: {
          statusCode: 200,
          body: '["Heat"]',
          source: { connection: "movies", url: "sample:/search/movie?query=alien" },
        },
      });
      expect(await call("connection.request", { ...read, path: "/search?q=x" }), at).toMatchObject({
        ok: true,
        result: { body: '["Alien"]' },
      });
      // A write is answered the same way: nothing goes out, so nothing needs the person's leave.
      expect(
        await call("connection.request", { ...read, method: "POST", path: "/search", body: "{}" }),
        at,
      ).toMatchObject({ ok: true, result: { body: '["Alien"]' } });
      // No sample for the path: a plain 404, for the tool to cope with.
      expect(await call("connection.request", { ...read, path: "/people" }), at).toMatchObject({
        ok: true,
        result: { statusCode: 404, contentType: "text/plain" },
      });
      // A connection the version doesn't name is refused, as outside checks (A66).
      expect(code(await call("connection.request", { ...read, connection: "bank" })), at).toBe(
        "not-allowed",
      );
      expect(asked, at).toEqual([]);
    }
    // Without samples, every connection is one the version doesn't name.
    const bare = withConnection({ staging: true });
    expect(code(await bare.call("connection.request", read))).toBe("not-allowed");
    expect(bare.asked).toEqual([]);
  });

  it("A75 CNX-06: a tool being checked gets the placeholder image for a connection its version names, and nothing is fetched", async () => {
    const fetched: unknown[] = [];
    for (const options of [{ staging: true }, { rehearsal: true }]) {
      const { call } = withConnection({
        ...options,
        samples,
        data: {
          connectionImage: (args) => {
            fetched.push(args);
            return Promise.reject(new Error("never"));
          },
        },
      });
      const at = JSON.stringify(options);
      expect(
        await call("connection.image", { connection: "movies", path: "/p.png" }),
        at,
      ).toMatchObject({
        ok: true,
        result: PLACEHOLDER_IMAGE,
      });
      expect(code(await call("connection.image", { connection: "bank", path: "/p.png" })), at).toBe(
        "not-allowed",
      );
    }
    expect(fetched).toEqual([]);
  });

  it("CNX-09 CNX-06: a tool being checked opens no page, for a connection its version names or any other", async () => {
    const opened: string[] = [];
    for (const options of [{ staging: true }, { rehearsal: true }]) {
      const { call } = withConnection({
        ...options,
        samples,
        openWindow: (url) => opened.push(url),
      });
      const at = JSON.stringify(options);
      expect(await call("link.open", { connection: "movies", path: "/watch" }), at).toMatchObject({
        ok: true,
        result: { url: "sample:/watch" },
      });
      expect(code(await call("link.open", { connection: "bank", path: "/x" })), at).toBe(
        "not-allowed",
      );
    }
    expect(opened).toEqual([]);
  });

  it("CNX-09 A76: outside checks, the server checks the page's address and the host page opens it", async () => {
    const opened: string[] = [];
    const asked: unknown[] = [];
    const { call } = withConnection({
      openWindow: (url) => opened.push(url),
      hasActivation: () => true,
      data: {
        openPage: (args) => {
          asked.push(args);
          return Promise.resolve({ url: "https://videos.example.com/watch?v=abc" });
        },
      },
    });
    const request = { connection: "videos", path: "/watch?v=abc" };
    expect(await call("link.open", request)).toMatchObject({
      ok: true,
      result: { url: "https://videos.example.com/watch?v=abc" },
    });
    expect(asked).toEqual([request]);
    expect(opened).toEqual(["https://videos.example.com/watch?v=abc"]);
    // A refusal opens nothing.
    const refused = withConnection({
      openWindow: (url) => opened.push(url),
      hasActivation: () => true,
      data: { openPage: () => Promise.reject(new BridgeError("not-allowed", "No.")) },
    });
    expect(code(await refused.call("link.open", request))).toBe("not-allowed");
    expect(opened).toHaveLength(1);
  });

  it("CNX-09 A76: without the person's click, or once it lapsed while the server answered, nothing opens and the tool hears why (#371 review)", async () => {
    const opened: string[] = [];
    let asked = 0;
    const page = { url: "https://videos.example.com/watch?v=abc" };
    const request = { connection: "videos", path: "/watch?v=abc" };
    // No click: refused before the server is asked.
    const idle = withConnection({
      openWindow: (url) => opened.push(url),
      hasActivation: () => false,
      data: {
        openPage: () => {
          asked += 1;
          return Promise.resolve(page);
        },
      },
    });
    const none = await idle.call("link.open", request);
    expect(code(none)).toBe("not-allowed");
    expect(JSON.stringify(none)).toMatch(/only right after the person clicks/);
    expect(asked).toBe(0);
    // A click that lapsed while the server answered: refused before opening.
    let active = true;
    const slow = withConnection({
      openWindow: (url) => opened.push(url),
      hasActivation: () => active,
      data: {
        openPage: () => {
          active = false;
          return Promise.resolve(page);
        },
      },
    });
    expect(code(await slow.call("link.open", request))).toBe("not-allowed");
    expect(opened).toEqual([]);
  });

  it("A75: outside checks, an image goes to the server's handler", async () => {
    const image = { ...PLACEHOLDER_IMAGE };
    const asked: unknown[] = [];
    const { call } = withConnection({
      data: {
        connectionImage: (args) => {
          asked.push(args);
          return Promise.resolve(image);
        },
      },
    });
    const request = { connection: "movies", path: "/p.png" };
    expect(await call("connection.image", request)).toMatchObject({ ok: true, result: image });
    expect(asked).toEqual([request]);
  });

  it("CNX-07: outside checks, a change goes to the server, which decides whether the person allowed it", async () => {
    const { call, asked, interact } = withConnection();
    interact();
    const write = { ...read, method: "POST", body: "{}" };
    expect(code(await call("connection.request", write))).toBe("ok");
    expect(asked).toEqual([write]);
  });

  it("refuses plainly where the host reaches no outside service", async () => {
    const { call } = served({ capabilities: ["connection"] });
    const reply = await call("connection.request", read);
    expect(reply).toMatchObject({ ok: false, error: { code: "failed" } });
    expect(reply?.ok === false && reply.error.message).toMatch(/can't reach outside services/);
  });
});

describe("the host's clock moved on by days (RUN-07, #351)", () => {
  const at = (iso: string, timeZone: string) => ({
    now: () => Date.parse(iso),
    timeZone: () => timeZone,
  });
  const dateOf = (clock: { now(): number; timeZone(): string }) =>
    clockReading(clock.now(), clock.timeZone()).date;

  it("RUN-07: each day on is the next calendar date, across daylight-saving changes either way", () => {
    // Lisbon moves to summer time early on 2026-03-29 and back early on 2026-10-25.
    const spring = at("2026-03-28T00:30:00Z", "Europe/Lisbon");
    expect([0, 1, 2, 3].map((days) => dateOf(daysLater(spring, days)))).toEqual([
      "2026-03-28",
      "2026-03-29",
      "2026-03-30",
      "2026-03-31",
    ]);
    const autumn = at("2026-10-24T23:30:00+01:00", "Europe/Lisbon");
    expect([0, 1, 2].map((days) => dateOf(daysLater(autumn, days)))).toEqual([
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
    ]);
    // Near midnight in a zone far from UTC, and across a month's end.
    const late = at("2026-01-31T14:45:00Z", "Pacific/Auckland");
    expect(dateOf(late)).toBe("2026-02-01");
    expect(dateOf(daysLater(late, 1))).toBe("2026-02-02");
    // Zero days is the clock itself.
    expect(daysLater(spring, 0)).toBe(spring);
  });
});

describe("files in, on the host page (CAP-03, A80)", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const chosen = (name: string, bytes: Uint8Array, size = bytes.byteLength): ChosenFile => ({
    name,
    size,
    arrayBuffer: () => Promise.resolve(bytes.slice().buffer),
  });
  const picked = {
    id: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    type: "image/png" as const,
    name: "beach.png",
    sizeBytes: 4,
    widthPx: 4,
    heightPx: 3,
  };
  /** A tool that declares files, with the person's choice and the server stood in for. */
  function picking(choose: () => Promise<ChosenFile | null>, options: Partial<BridgeOptions> = {}) {
    const asked: { accept: readonly string[] }[] = [];
    const sent: { name: string; bytes: number[]; phase: string }[] = [];
    const bridge = served({
      capabilities: ["files"],
      hasActivation: () => true,
      chooseFile: (accept) => {
        asked.push({ accept });
        return choose();
      },
      ...options,
      data: {
        read: () => Promise.resolve({ data: {}, revisions: {} }),
        patch: () => Promise.resolve({ addedIds: [] }),
        pickFile: (file, context) => {
          sent.push({ name: file.name, bytes: [...file.bytes], phase: context.phase });
          return Promise.resolve({ file: picked });
        },
        ...options.data,
      },
    });
    return { ...bridge, asked, sent };
  }

  it("CAP-03: after a click, the host page's picker asks for an image, and the server keeps the bytes", async () => {
    const { call, interact, asked, sent } = picking(() =>
      Promise.resolve(chosen("C:\\fakepath\\beach.png", png)),
    );
    interact();
    expect(await call("file.pick")).toMatchObject({ ok: true, result: { file: picked } });
    expect(asked).toEqual([{ accept: ["image/png", "image/jpeg", "image/webp"] }]);
    // The name only, never where it was; the call goes with the phase the person's click made.
    expect(sent).toEqual([{ name: "beach.png", bytes: [...png], phase: "active" }]);
  });

  it("CAP-03: a pick the person cancels answers null, and the server isn't asked", async () => {
    const { call, sent } = picking(() => Promise.resolve(null));
    expect(await call("file.pick")).toMatchObject({ ok: true, result: { file: null } });
    expect(sent).toEqual([]);
  });

  it("FIL-01 A80: without the person's click no picker opens, and the tool hears why", async () => {
    const { call, asked, sent } = picking(() => Promise.resolve(chosen("a.png", png)), {
      hasActivation: () => false,
    });
    const reply = await call("file.pick");
    expect(code(reply)).toBe("not-allowed");
    expect(reply?.ok ? "" : reply?.error.message).toContain("only right after the person clicks");
    expect(asked).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("FIL-01 A80: one picker at a time; a second ask while one is open is refused", async () => {
    let answer: (file: ChosenFile | null) => void = () => {};
    const { call, asked } = picking(() => new Promise((resolve) => (answer = resolve)));
    const first = call("file.pick", {}, "r-first");
    expect(code(await call("file.pick", {}, "r-second"))).toBe("not-allowed");
    answer(null);
    await first;
    expect(asked).toHaveLength(1);
    // Answered, the next ask opens the picker again.
    const again = call("file.pick", {}, "r-again");
    answer(null);
    await again;
    expect(asked).toHaveLength(2);
  });

  it("DATA-11: a file over 25 MB is refused plainly and never sent", async () => {
    const { call, sent } = picking(() =>
      Promise.resolve(chosen("huge.png", png, 26 * 1024 * 1024)),
    );
    const reply = await call("file.pick");
    expect(code(reply)).toBe("too-large");
    expect(reply?.ok ? "" : reply?.error.message).toContain("Nothing was kept: the file is 26 MB");
    expect(sent).toEqual([]);
  });

  it("FIL-01 CAP-01: a tool that didn't declare files, or a host that keeps no files, picks nothing", async () => {
    const undeclared = picking(() => Promise.resolve(chosen("a.png", png)), { capabilities: [] });
    expect(code(await undeclared.call("file.pick"))).toBe("undeclared-capability");
    expect(undeclared.asked).toEqual([]);
    const nowhere = served({ capabilities: ["files"], hasActivation: () => true });
    expect(code(await nowhere.call("file.pick"))).toBe("failed");
  });

  it("FIL-01 A80 VER-03: a tool being checked gets the sample image, opens no picker, and can show it", async () => {
    for (const options of [{ staging: true }, { rehearsal: true }]) {
      const at = JSON.stringify(options);
      const { call, asked, sent } = picking(() => Promise.resolve(chosen("a.png", png)), options);
      expect(await call("file.pick"), at).toMatchObject({
        ok: true,
        result: { file: SAMPLE_PICK.file },
      });
      expect(await call("asset.read", { id: SAMPLE_PICK.file.id }), at).toMatchObject({
        ok: true,
        result: { type: "image/png", bytesBase64: SAMPLE_PICK.bytesBase64 },
      });
      // Another image isn't the sample's to show.
      expect(code(await call("asset.read", { id: picked.id })), at).toBe("failed");
      expect(asked, at).toEqual([]);
      expect(sent, at).toEqual([]);
    }
  });

  it("A80: the sample's ID is the SHA-256 of its bytes, and it is the PNG it says", async () => {
    const bytes = Uint8Array.from(atob(SAMPLE_PICK.bytesBase64), (c) => c.charCodeAt(0));
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    expect([...digest].map((b) => b.toString(16).padStart(2, "0")).join("")).toBe(
      SAMPLE_PICK.file.id,
    );
    expect(bytes.byteLength).toBe(SAMPLE_PICK.file.sizeBytes);
    const view = new DataView(bytes.buffer);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([
      SAMPLE_PICK.file.widthPx,
      SAMPLE_PICK.file.heightPx,
    ]);
  });
});

describe("files out, on the host page (CAP-03, A81)", () => {
  const csv = { name: "notes.html", type: "text/csv", text: "item,quantity\nmilk,2\n" };
  /** A tool that declares files, with the person's answer and the browser's save stood in for. */
  function offering(answer: () => Promise<boolean>, options: Partial<BridgeOptions> = {}) {
    const asked: SaveOffer[] = [];
    const saved: { name: string; type: string; text: string }[] = [];
    const bridge = served({
      capabilities: ["files"],
      hasActivation: () => true,
      askToSave: (offer) => {
        asked.push(offer);
        return answer();
      },
      saveFile: (file) =>
        saved.push({
          name: file.name,
          type: file.type,
          text: new TextDecoder().decode(file.bytes),
        }),
      ...options,
    });
    return { ...bridge, asked, saved };
  }

  it("CAP-03: after a click the person is asked, with the file's safe name, kind and size, and Save saves it", async () => {
    const { call, asked, saved } = offering(() => Promise.resolve(true));
    expect(await call("file.save", csv)).toMatchObject({ ok: true, result: { saved: true } });
    // Never under the name the tool gave: its extension is the kind's.
    expect(asked).toEqual([{ name: "notes.csv", type: "text/csv", sizeBytes: 21 }]);
    expect(saved).toEqual([{ name: "notes.csv", type: "text/csv", text: csv.text }]);
  });

  it("A81: Don't save saves nothing, and the tool hears it", async () => {
    const { call, saved } = offering(() => Promise.resolve(false));
    expect(await call("file.save", csv)).toMatchObject({ ok: true, result: { saved: false } });
    expect(saved).toEqual([]);
  });

  it("FIL-04 A81: a file that isn't what it says is refused before the person is asked", async () => {
    const { call, asked } = offering(() => Promise.resolve(true));
    const reply = await call("file.save", {
      name: "a.png",
      type: "image/png",
      bytesBase64: btoa("<svg/>"),
    });
    expect(code(reply)).toBe("invalid-args");
    expect(reply?.ok ? "" : reply?.error.message).toContain("Nothing was saved: the bytes aren't");
    expect(code(await call("file.save", { name: "a", type: "text/html", text: "<p>" }))).toBe(
      "invalid-args",
    );
    expect(asked).toEqual([]);
  });

  it("FIL-04 A81: without the person's click nothing is asked, and the tool hears why", async () => {
    const { call, asked, saved } = offering(() => Promise.resolve(true), {
      hasActivation: () => false,
    });
    const reply = await call("file.save", csv);
    expect(code(reply)).toBe("not-allowed");
    expect(reply?.ok ? "" : reply?.error.message).toContain("only right after the person clicks");
    expect(asked).toEqual([]);
    expect(saved).toEqual([]);
  });

  it("FIL-04 A81: one question at a time; a second offer while one is asked is refused", async () => {
    let answer: (save: boolean) => void = () => {};
    const { call, asked } = offering(() => new Promise((resolve) => (answer = resolve)));
    const first = call("file.save", csv, "r-first");
    expect(code(await call("file.save", csv, "r-second"))).toBe("not-allowed");
    answer(false);
    await first;
    expect(asked).toHaveLength(1);
  });

  it("FIL-04 CAP-01: a tool that didn't declare files, or a host that asks no one, saves nothing", async () => {
    const undeclared = offering(() => Promise.resolve(true), { capabilities: [] });
    expect(code(await undeclared.call("file.save", csv))).toBe("undeclared-capability");
    expect(undeclared.asked).toEqual([]);
    const nowhere = served({ capabilities: ["files"], hasActivation: () => true });
    expect(code(await nowhere.call("file.save", csv))).toBe("failed");
  });

  it("FIL-04 A81 VER-03: a tool being checked is answered saved, and nothing is asked or saved; a broken file is still refused", async () => {
    for (const options of [{ staging: true }, { rehearsal: true }]) {
      const at = JSON.stringify(options);
      const { call, asked, saved } = offering(() => Promise.resolve(true), options);
      expect(await call("file.save", csv), at).toMatchObject({ ok: true, result: { saved: true } });
      expect(code(await call("file.save", { ...csv, type: "application/json" })), at).toBe(
        "invalid-args",
      );
      expect(asked, at).toEqual([]);
      expect(saved, at).toEqual([]);
    }
  });
});
