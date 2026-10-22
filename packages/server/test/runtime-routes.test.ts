import http from "node:http";
import vm from "node:vm";
import type { Artifact } from "@tessera/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startLocalServer, type LocalServer } from "../src/http/index.ts";
import { runtimeRoutes, toolDocument } from "../src/runtime/index.ts";

// The runtime's documents through the real local server and its guard (RUN-01, SEC-03).
const tools: Record<string, Artifact["code"]> = {
  "mount-1": { html: "<p id='hi'>Hi</p>", css: "p{color:red}", js: "console.log('</script>')" },
};
let server: LocalServer;
beforeAll(async () => {
  server = await startLocalServer({ port: 0, routes: runtimeRoutes((id) => tools[id]) });
});
afterAll(() => server.close());

type Answer = { status: number; headers: http.IncomingHttpHeaders; body: string };
const get = (pathAndQuery: string, headers: http.OutgoingHttpHeaders) =>
  new Promise<Answer>((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: server.port, path: pathAndQuery, headers },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
// A frame of the host app, as a browser asks for it.
const asFrame = () => ({
  host: `localhost:${server.port}`,
  "sec-fetch-dest": "iframe",
  referer: `http://127.0.0.1:${server.port}/`,
});
// Node joins repeated headers with commas, as browsers read them: one policy per item.
const policies = (answer: Answer) =>
  ([] as string[])
    .concat(answer.headers["content-security-policy"] ?? [])
    .flatMap((value) => value.split(/,\s*/));

describe("the runtime's routes (RUN-01)", () => {
  it("serves the wrapper with its own nonce-bound script, framing only the tool's document", async () => {
    const answer = await get("/runtime/wrapper", asFrame());
    expect(answer.status).toBe(200);
    const nonce = /script nonce="([^"]+)"/.exec(answer.body)?.[1];
    expect(nonce).toBeTruthy();
    const all = policies(answer);
    // The guard's frame-ancestors stays, beside the wrapper's own policy.
    expect(all.some((p) => p.startsWith("frame-ancestors"))).toBe(true);
    expect(all).toContainEqual(expect.stringContaining(`script-src 'nonce-${nonce}'`) as string);
    expect(all.join(" ")).toContain(`frame-src http://*.localhost:${server.port}/runtime/tool`);
    // A new nonce every time.
    const again = await get("/runtime/wrapper", asFrame());
    expect(/script nonce="([^"]+)"/.exec(again.body)?.[1]).not.toBe(nonce);
  });

  it("serves a tool's document sandboxed, under the strict policy, with the preamble first", async () => {
    const answer = await get("/runtime/tool?mount=mount-1", asFrame());
    expect(answer.status).toBe(200);
    const all = policies(answer);
    expect(all).toContain("sandbox allow-scripts");
    expect(all.some((p) => p.startsWith("default-src 'none'"))).toBe(true);
    expect(all.some((p) => p.startsWith("frame-ancestors"))).toBe(true);
    expect(answer.headers["cache-control"]).toBe("no-store");
    const preambleAt = answer.body.indexOf("tessera:port");
    expect(preambleAt).toBeGreaterThan(0);
    expect(preambleAt).toBeLessThan(answer.body.indexOf("<p id='hi'>"));
  });

  it("answers an unknown mount with 404, and keeps the guard's refusals", async () => {
    expect((await get("/runtime/tool?mount=nope", asFrame())).status).toBe(404);
    expect((await get("/runtime/tool", asFrame())).status).toBe(404);
    // Not as a frame, or on the host app's name: the guard refuses before the route runs.
    expect((await get("/runtime/wrapper", { host: `localhost:${server.port}` })).status).toBe(403);
    const onAppName = { ...asFrame(), host: `127.0.0.1:${server.port}` };
    expect((await get("/runtime/tool?mount=mount-1", onAppName)).status).toBe(403);
  });

  it("answers a tool that navigates its own frame with no content, so it keeps its page (SBX-07)", async () => {
    // The tool's origin is opaque: its own navigations are cross-site and carry no referrer.
    const fromTool = {
      host: `localhost:${server.port}`,
      "sec-fetch-dest": "iframe",
      "sec-fetch-site": "cross-site",
    };
    const answer = await get("/runtime/tool?mount=mount-1&leak=private", fromTool);
    expect(answer.status).toBe(204);
    expect(answer.body).toBe("");
  });

  it("serves scripts a browser can run, with their types stripped", async () => {
    const wrapper = await get("/runtime/wrapper", asFrame());
    const tool = await get("/runtime/tool?mount=mount-1", asFrame());
    const scripts = [...wrapper.body.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)]
      .concat([...tool.body.matchAll(/<script>([\s\S]*?)<\/script>/g)])
      .map((m) => m[1] ?? "");
    expect(scripts.length).toBeGreaterThanOrEqual(3);
    for (const script of scripts) expect(() => new vm.Script(script)).not.toThrow();
  });

  it("keeps a closing tag inside the tool's script or styles from ending it early", () => {
    const doc = toolDocument({ html: "", css: "a{}</style>x", js: "'</script>'" }, "");
    expect(doc).toContain("'<\\/script>'");
    expect(doc).toContain("a{}<\\/style>x");
  });
});
