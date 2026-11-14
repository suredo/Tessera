import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import {
  BRIDGE_ACTIONS,
  type Artifact,
  type BridgeDataRequest,
  type BridgeReply,
} from "@tessera/contracts";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { answerDataCall } from "../src/bridge/index.ts";
import {
  addConnection,
  allowWrites,
  removeConnection,
  takeBackWrites,
  writesAllowed,
} from "../src/connections/index.ts";
import { openDataFolder, type DataFolder } from "../src/storage/index.ts";
import { saveVersion } from "../src/versions/index.ts";
import { addWorkspaceVersion, createWorkspace } from "../src/workspaces/index.ts";

// A tool's request through a connection (CAP-02, ADR 0015, #349 step 2), through the server's side
// of the bridge, against local fake services on loopback: the one the connection reaches, and
// another that nothing may reach. Each check is numbered in the threat model (CNX-01 to CNX-06).
// Every data folder is a new temporary one (ENG-19).

const KEY = "sk-test-0123456789-never-shown";
const SLASHED_KEY = 'sk/test+01\\23"456789=never-shown';
// And one with characters HTML writes with longer names, or with a reference before letters.
const ODD_KEY = "sk_test|01`23&never-shown";

type Seen = { method: string; url: string; headers: http.IncomingHttpHeaders; body: string };
type Fake = { origin: string; seen: Seen[]; close(): Promise<void> };

/** A fake service on loopback that records every request it receives. */
async function fakeService(
  answer: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<Fake> {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
      answer(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    seen,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

let service: Fake;
let elsewhere: Fake;
const timers: NodeJS.Timeout[] = [];

beforeAll(async () => {
  elsewhere = await fakeService((_req, res) => res.end("You should never see this."));
  service = await fakeService((req, res) => {
    const url = new URL(req.url ?? "/", "http://service");
    if (url.pathname === "/search") {
      res.setHeader("content-type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ results: [{ title: "Alien", year: 1979 }] }));
    }
    if (url.pathname === "/redirect") {
      res.statusCode = 302;
      res.setHeader("location", `${elsewhere.origin}/caught`);
      return res.end();
    }
    if (url.pathname === "/big") {
      res.setHeader("content-type", "text/plain");
      return res.end("x".repeat(4096));
    }
    if (url.pathname === "/wide") {
      // A wide page within the answer's limit, with no key in it.
      res.setHeader("content-type", "text/html");
      return res.end(`<div>${"<i></i>".repeat(140_000)}</div>`);
    }
    if (url.pathname === "/big-unannounced") {
      // No length up front: the host counts as it reads.
      res.setHeader("content-type", "text/plain");
      res.write("x".repeat(3000));
      return res.end("x".repeat(3000));
    }
    if (url.pathname === "/slow") {
      timers.push(setTimeout(() => res.end("late"), 2000));
      return;
    }
    // A service that writes the key back, as a request inspector or an error quoting its address
    // would, in each of the ways the host looks for (CNX-04).
    if (url.pathname.startsWith("/echo")) {
      const credential =
        url.searchParams.get("api_key") ?? (req.headers.authorization ?? "").replace("Bearer ", "");
      const echoes: Record<string, () => void> = {
        "/echo": () => res.end(JSON.stringify({ url: req.url, headers: req.headers })),
        "/echo-type": () => (
          res.setHeader("content-type", `text/plain; token=${credential}`),
          res.end("ok")
        ),
        "/echo-bad-type": () => (
          res.setHeader("content-type", `application/x-${credential}`),
          res.end("ok")
        ),
        "/echo-upper": () => res.end(`Unknown key ${credential.toUpperCase()}`),
        "/echo-encoded": () => res.end(`Asked for ${encodeURIComponent(credential)}`),
        "/echo-base64": () => res.end(Buffer.from(credential).toString("base64")),
        // Spellings JSON allows, which a tool's JSON.parse undoes.
        "/echo-json-slash": () => res.end(`{"credential":"${credential.replaceAll("/", "\\/")}"}`),
        "/echo-json-unicode": () =>
          res.end(
            `{"credential":"${[...credential].map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`).join("")}"}`,
          ),
        "/echo-entities": () =>
          res.end(
            `<p>${[...credential].map((c) => `&#x${c.charCodeAt(0).toString(16)};`).join("")}</p>`,
          ),
        // JSON's own escaping of \ and ", mixed with \/ and \u: JSON.parse still gives the key.
        "/echo-json-mixed": () =>
          res.end(JSON.stringify({ credential }).replaceAll("/", "\\/").replace("s", "\\u0073")),
        // References as the HTML standard also reads them.
        "/echo-html-upper": () =>
          res.end([...credential].map((c) => `&#X${c.charCodeAt(0).toString(16)};`).join("")),
        "/echo-html-bare": () =>
          res.end([...credential].map((c) => `&#${c.charCodeAt(0)}`).join("")),
        "/echo-html-padded": () =>
          res.end(
            [...credential]
              .map((c) => `&#x${c.charCodeAt(0).toString(16).padStart(12, "0")};`)
              .join(""),
          ),
        // The standard's other names for _, | and `, and &amp with no semicolon before letters,
        // which HTML reads by the longest valid name.
        "/echo-html-aliases": () =>
          res.end(
            `<p>${credential
              .replaceAll("&", "&amp")
              .replaceAll("_", "&UnderBar;")
              .replaceAll("|", "&VerticalLine;")
              .replaceAll("`", "&DiacriticalGrave;")}</p>`,
          ),
        // The key split across elements, which a page shows whole.
        "/echo-html-split": () =>
          res.end(
            [...credential]
              .map((c) => `<b>${c.replace("&", "&amp;").replace("<", "&lt;")}</b>`)
              .join(""),
          ),
        // In an attribute, as a link or a form would carry it.
        "/echo-html-attribute": () =>
          res.end(
            `<a title="${credential.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}">x</a>`,
          ),
        // References inside markup a page or an XML reader treats differently from plain text.
        "/echo-noscript": () =>
          res.end(
            `<noscript>${[...credential].map((c) => `&#${c.charCodeAt(0)};`).join("")}</noscript>`,
          ),
        "/echo-xml-script": () => {
          res.setHeader("content-type", "application/xml");
          res.end(
            `<r><script>${[...credential].map((c) => `&#${c.charCodeAt(0)};`).join("")}</script></r>`,
          );
        },
        "/echo-html-named": () =>
          res.end(
            credential
              .replaceAll("\\", "&bsol;")
              .replaceAll('"', "&QUOT;")
              .replaceAll("/", "&sol;")
              .replaceAll("+", "&plus;")
              .replaceAll("=", "&equals;"),
          ),
      };
      res.setHeader("content-type", "text/plain");
      return (echoes[url.pathname] ?? (() => res.end("no such echo")))();
    }
    if (url.pathname === "/image") {
      res.setHeader("content-type", "image/png");
      return res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    }
    res.statusCode = 404;
    res.setHeader("content-type", "text/plain");
    res.end("Not found");
  });
});

const temps: string[] = [];
const folders: DataFolder[] = [];
afterEach(() => {
  service.seen.length = 0;
  elsewhere.seen.length = 0;
});
afterAll(async () => {
  timers.forEach(clearTimeout);
  folders.forEach((folder) => folder.close());
  temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
  await Promise.all([service.close(), elsewhere.close()]);
});

/**
 * A workspace running a tool built for the connections `uses`, in a data folder holding three:
 * movies (a key in a header), listings (a key in the query) and bank, which no tool here names.
 */
async function setup(
  uses: string[] = ["movies", "listings", "archive", "odd"],
  capabilities = ["connection"],
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-connection-requests-"));
  temps.push(dir);
  const folder = await openDataFolder(dir);
  folders.push(folder);
  const auth = { kind: "header", name: "Authorization", prefix: "Bearer " } as const;
  addConnection(folder, { name: "movies", origins: [service.origin], auth, key: KEY });
  addConnection(folder, {
    name: "listings",
    origins: [service.origin],
    auth: { kind: "query", name: "api_key" },
    key: KEY,
  });
  addConnection(folder, { name: "bank", origins: [service.origin], auth, key: KEY });
  // A key with characters JSON and URLs may escape.
  addConnection(folder, { name: "archive", origins: [service.origin], auth, key: SLASHED_KEY });
  addConnection(folder, {
    name: "odd",
    origins: [service.origin],
    auth: { kind: "query", name: "api_key" },
    key: ODD_KEY,
  });
  const tool: Artifact = {
    contractVersion: 4,
    connections: Object.fromEntries(uses.map((name) => [name, { samples: {} }])),
    code: { html: "<p>Movies</p>", css: "", js: "" },
    data: { schemaVersion: 1, schema: {}, defaults: {}, migrations: [] },
    capabilities,
    pins: [],
    ui: { standardVersion: 1, mode: "standard" },
  };
  const { id } = createWorkspace(folder, "Movie finder");
  addWorkspaceVersion(folder, id, saveVersion(folder.db, tool));
  let calls = 0;
  const ask = async (
    args: Record<string, unknown>,
    phase: BridgeDataRequest["phase"] = "active",
    options = {},
  ): Promise<BridgeReply> => {
    const reply = await answerDataCall(
      folder,
      {
        workspaceId: id,
        phase,
        call: { requestId: `r${(calls += 1)}`, action: "connection.request", args },
      },
      { connections: options },
    );
    if (!reply) throw new Error("A call with a request ID got no reply.");
    return reply;
  };
  return { folder, ask, id };
}

const get = (connection: string, requestPath: string, extra: Record<string, unknown> = {}) => ({
  connection,
  method: "GET",
  path: requestPath,
  ...extra,
});
const codeOf = (reply: BridgeReply) => (reply.ok ? "ok" : reply.error.code);

describe("requests through a connection (CAP-02, ADR 0015)", () => {
  it("CAP-02: a read reaches the service and comes back with where it came from, while the tool starts too", async () => {
    const { ask } = await setup();
    for (const phase of ["active", "starting"] as const) {
      const reply = await ask(get("movies", "/search?query=alien"), phase);
      expect(reply).toEqual({
        requestId: expect.any(String) as string,
        ok: true,
        result: {
          statusCode: 200,
          contentType: "application/json; charset=utf-8",
          body: '{"results":[{"title":"Alien","year":1979}]}',
          source: {
            connection: "movies",
            url: `${service.origin}/search?query=alien`,
            receivedAt: expect.any(String) as string,
          },
        },
      });
      // The answer is one the manifest describes, as the host page checks it again.
      expect(
        BRIDGE_ACTIONS["connection.request"].result.safeParse(reply.ok && reply.result),
      ).toMatchObject({ success: true });
    }
    const head = await ask({ connection: "movies", method: "HEAD", path: "/search" });
    expect(head).toMatchObject({ ok: true, result: { statusCode: 200, body: "" } });
    // A service's own refusal is an answer, for the tool to read.
    expect(await ask(get("movies", "/nothing-here"))).toMatchObject({
      ok: true,
      result: { statusCode: 404, body: "Not found" },
    });
    expect(service.seen.map((s) => s.method)).toEqual(["GET", "GET", "HEAD", "GET"]);
  });

  it("CNX-01: refuses a connection the tool wasn't built for, or one that isn't there, and sends nothing", async () => {
    const { ask } = await setup();
    const bank = await ask(get("bank", "/accounts"));
    expect(bank).toMatchObject({ ok: false, error: { code: "not-allowed" } });
    expect(!bank.ok && bank.error.message).toMatch(/wasn't built to use the connection bank/);
    // Named by the version, but the person removed it, or never added it.
    const gone = await setup(["weather"]);
    expect(codeOf(await gone.ask(get("weather", "/today")))).toBe("failed");
    // Without the capability, the bridge refuses first.
    const undeclared = await setup(["movies"], []);
    expect(codeOf(await undeclared.ask(get("movies", "/search")))).toBe("undeclared-capability");
    expect(service.seen).toEqual([]);
  });

  it("CNX-02: refuses an address outside the connection: another origin, a whole address, a path that leaves it", async () => {
    const { ask } = await setup();
    const refused: [Record<string, unknown>, string][] = [
      [get("movies", "/search", { origin: elsewhere.origin }), "not-allowed"],
      [get("movies", `//127.0.0.1:${new URL(elsewhere.origin).port}/caught`), "invalid-args"],
      [get("movies", `${elsewhere.origin}/caught`), "invalid-args"],
      [get("movies", "search"), "invalid-args"],
      [get("movies", "/\\elsewhere"), "invalid-args"],
      [get("movies", "/search#part"), "invalid-args"],
      [get("movies", "/a b"), "invalid-args"],
      [get("movies", "/search\u0000"), "invalid-args"],
      [get("movies", "/search", { headers: { authorization: "Bearer other" } }), "invalid-args"],
      [get("movies", "/search", { headers: { host: "elsewhere" } }), "invalid-args"],
      // Within the path's limit, but longer than the address may be once written out.
      [get("movies", `/${"é".repeat(2000)}`), "invalid-args"],
    ];
    for (const [args, code] of refused) {
      expect(codeOf(await ask(args)), JSON.stringify(args)).toBe(code);
    }
    expect(service.seen).toEqual([]);
    // Dot segments stay on the connection's own origin, wherever they lead on it.
    expect(codeOf(await ask(get("movies", "/../../search")))).toBe("ok");
    expect(service.seen.map((s) => s.url)).toEqual(["/search"]);
    expect(elsewhere.seen).toEqual([]);
  });

  it("CNX-03: never follows a redirect, so nothing reaches where it points", async () => {
    const { ask } = await setup();
    const reply = await ask(get("movies", "/redirect"));
    expect(reply).toMatchObject({ ok: false, error: { code: "failed" } });
    expect(!reply.ok && reply.error.message).toMatch(/redirect/);
    expect(service.seen).toHaveLength(1);
    expect(elsewhere.seen).toEqual([]);
  });

  it("CNX-04: the host adds the key, and it reaches no reply, record or log", async () => {
    const logged: unknown[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args) => void logged.push(...args)),
    );
    try {
      const { folder, ask } = await setup();
      const replies = [
        await ask(get("movies", "/search?query=alien")),
        await ask(get("listings", "/search?query=a%20b&page=2")),
        await ask(get("listings", "/search?api_key=mine")),
        await ask(get("movies", "/redirect")),
        await ask(get("movies", "/slow"), "active", { timeoutMs: 50 }),
      ];
      expect(replies.map(codeOf)).toEqual(["ok", "ok", "invalid-args", "failed", "failed"]);
      // The service gets it, in the header or after the tool's query, which stays as written.
      expect(service.seen[0]?.headers.authorization).toBe(`Bearer ${KEY}`);
      expect(service.seen[1]?.url).toBe(`/search?query=a%20b&page=2&api_key=${KEY}`);
      expect(service.seen[1]?.headers.authorization).toBeUndefined();
      // The tool's answer says where it came from, without the key.
      expect(replies[1]).toMatchObject({
        result: { source: { url: `${service.origin}/search?query=a%20b&page=2` } },
      });
      expect(JSON.stringify(replies)).not.toContain(KEY);
      // A service that writes the key back gets none of its answer through, in either place, for
      // a plain key and for one with characters JSON and URLs escape.
      for (const connection of ["movies", "listings", "archive", "odd"]) {
        for (const echo of [
          "/echo",
          "/echo-type",
          "/echo-bad-type",
          "/echo-upper",
          "/echo-encoded",
          "/echo-base64",
          "/echo-json-slash",
          "/echo-json-unicode",
          "/echo-entities",
          "/echo-json-mixed",
          "/echo-html-upper",
          "/echo-html-bare",
          "/echo-html-padded",
          "/echo-html-named",
          "/echo-html-aliases",
          "/echo-html-split",
          "/echo-html-attribute",
          "/echo-noscript",
          "/echo-xml-script",
        ]) {
          const reply = await ask(get(connection, echo));
          expect(reply, `${connection} ${echo}`).toMatchObject({
            ok: false,
            error: { code: "failed" },
          });
          expect(!reply.ok && reply.error.message).toMatch(/repeated the connection's key/);
          replies.push(reply);
        }
      }
      expect(JSON.stringify(replies).toLowerCase()).not.toContain(KEY.toLowerCase());
      expect(JSON.stringify(replies).toLowerCase()).not.toContain(SLASHED_KEY.toLowerCase());
      expect(JSON.stringify(replies).toLowerCase()).not.toContain(ODD_KEY.toLowerCase());
      // An answer that doesn't repeat it still passes.
      expect(codeOf(await ask(get("movies", "/echo-none")))).toBe("ok");
      // Nothing the data folder keeps but the connection itself holds it: no ledger, no log.
      const tables = folder.db
        .all(
          z.object({ name: z.string() }),
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'connections'",
        )
        .map((t) => t.name);
      expect(tables.length).toBeGreaterThan(5);
      for (const table of tables) {
        const rows = folder.db.all(z.unknown(), `SELECT * FROM "${table}"`);
        expect(JSON.stringify(rows), table).not.toContain(KEY);
      }
      expect(JSON.stringify(logged)).not.toContain(KEY);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });

  it("CNX-05: refuses an answer too large, too slow or not text, and passes none of it on", async () => {
    const { ask } = await setup();
    const limits = { answerLimitBytes: 2048, timeoutMs: 200 };
    const big = await ask(get("movies", "/big"), "active", limits);
    expect(big).toMatchObject({ ok: false, error: { code: "too-large" } });
    const unannounced = await ask(get("movies", "/big-unannounced"), "active", limits);
    expect(unannounced).toMatchObject({ ok: false, error: { code: "too-large" } });
    const slow = await ask(get("movies", "/slow"), "active", limits);
    expect(slow).toMatchObject({ ok: false, error: { code: "failed" } });
    expect(!slow.ok && slow.error.message).toMatch(/didn't answer within/);
    const image = await ask(get("movies", "/image"));
    expect(image).toMatchObject({ ok: false, error: { code: "failed" } });
    expect(!image.ok && image.error.message).toMatch(/image\/png/);
    // A wide page within the limit is read whole, however many elements sit side by side.
    expect(codeOf(await ask(get("movies", "/wide")))).toBe("ok");
    // Within the limit, the same answer passes.
    expect(codeOf(await ask(get("movies", "/big"), "active", { answerLimitBytes: 4096 }))).toBe(
      "ok",
    );
  });

  it("CNX-06: a request from a tool being checked that reaches the server, or a read with a body, sends nothing", async () => {
    const { ask } = await setup();
    for (const method of ["GET", "POST"]) {
      const checked = await ask({ connection: "movies", method, path: "/search" }, "staging");
      expect(checked, method).toMatchObject({ ok: false, error: { code: "not-allowed" } });
    }
    expect(codeOf(await ask(get("movies", "/search", { body: "{}" })))).toBe("invalid-args");
    expect(service.seen).toEqual([]);
  });

  it("CNX-07: a change goes out only once the tool is active and the person allowed it, for that workspace and connection", async () => {
    const { folder, ask, id } = await setup();
    const post = {
      connection: "movies",
      method: "POST",
      path: "/search",
      headers: { "content-type": "application/json" },
      body: '{"title":"Alien"}',
    };
    // While the tool starts, a change waits for the person, as a data write does (GEN-06).
    expect(codeOf(await ask(post, "starting"))).toBe("not-active");
    // Active, but not allowed: refused with the code the host page answers by asking (A70).
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const write = await ask({ ...post, method });
      expect(write, method).toMatchObject({ ok: false, error: { code: "needs-permission" } });
      expect(!write.ok && write.error.message).toMatch(/hasn't allowed this tool/);
    }
    expect(service.seen).toEqual([]);

    // Allowed: the change goes out with its body and type, and the key the host adds.
    allowWrites(folder, id, "movies");
    expect(writesAllowed(folder, id, "movies")).toBe(true);
    expect(await ask(post)).toMatchObject({ ok: true, result: { statusCode: 200 } });
    expect(service.seen).toHaveLength(1);
    expect(service.seen[0]).toMatchObject({
      method: "POST",
      url: "/search",
      body: '{"title":"Alien"}',
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    });
    // Only that connection, and only that workspace's tool.
    expect(codeOf(await ask({ ...post, connection: "listings" }))).toBe("needs-permission");
    const other = createWorkspace(folder, "Another tool");
    expect(writesAllowed(folder, other.id, "movies")).toBe(false);

    // Taken back: the next change asks again, and nothing more is sent.
    takeBackWrites(folder, id, "movies");
    expect(codeOf(await ask(post))).toBe("needs-permission");
    // Removing the connection removes its permission; added again, it starts with none.
    allowWrites(folder, id, "movies");
    removeConnection(folder, "movies");
    addConnection(folder, {
      name: "movies",
      origins: [service.origin],
      auth: { kind: "header", name: "Authorization", prefix: "Bearer " },
      key: KEY,
    });
    expect(writesAllowed(folder, id, "movies")).toBe(false);
    expect(service.seen).toHaveLength(1);
    // Allowing needs a workspace and a connection that exist.
    expect(() => allowWrites(folder, id, "weather")).toThrow(/no connection called weather/);
    expect(() => allowWrites(folder, "00000000-0000-4000-8000-000000000009", "movies")).toThrow(
      /gone or in the trash/,
    );
  });
});
