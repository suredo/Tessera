import http from "node:http";
import vm from "node:vm";
import type { Artifact } from "@tessera/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startLocalServer, type LocalServer } from "../src/http/index.ts";
import { accessibilityCss, standardCss, UI_TOKENS } from "@tessera/runtime/policy";
import { runtimeRoutes, toolDocument } from "../src/runtime/index.ts";

// The runtime's documents through the real local server and its guard (RUN-01, SEC-03).
type Tool = Pick<Artifact, "code" | "ui">;
const standard = { standardVersion: 1, mode: "standard" } as const;
const custom = { standardVersion: 1, mode: "custom" } as const;
const tools: Record<string, Tool> = {
  "mount-1": {
    code: { html: "<p id='hi'>Hi</p>", css: "p{color:red}", js: "console.log('</script>')" },
    ui: standard,
  },
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
    const doc = toolDocument(
      { code: { html: "", css: "a{}</style>x", js: "'</script>'" }, ui: custom },
      "",
    );
    expect(doc).toContain("'<\\/script>'");
    expect(doc).toContain("a{}<\\/style>x");
  });
});

describe("the host stylesheets in a tool's document (RUN-05, VER-06)", () => {
  const code = { html: "<button>Go</button>", css: "button{outline:none!important}", js: "" };
  const styles = (doc: string) =>
    [...doc.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1] ?? "");
  const markOf = (css: string) => /^@layer tessera-accessibility-([0-9a-f]+),/.exec(css)?.[1];

  it("RUN-05: puts the accessibility floor first in every tool, standard or custom", () => {
    for (const ui of [standard, custom]) {
      const found = styles(toolDocument({ code, ui }, "preamble();", "m1"));
      expect(found[0]!.startsWith(accessibilityCss("m1"))).toBe(true);
      // The layers are declared before any of the tool's own styles.
      expect(found[0]!.startsWith("@layer tessera-accessibility-m1, tessera-standard-m1;")).toBe(
        true,
      );
      expect(found.at(-1)).toBe(code.css);
    }
  });

  it("VER-06: adds the UI standard's tokens in standard mode, and not in custom mode", () => {
    const inStandard = styles(toolDocument({ code, ui: standard }, "", "m1"))[0]!;
    expect(inStandard).toContain(standardCss("m1"));
    expect(inStandard).toContain(`--ui-accent: ${UI_TOKENS.accent};`);
    const inCustom = styles(toolDocument({ code, ui: custom }, "", "m1"))[0]!;
    expect(inCustom).not.toContain("--ui-");
    expect(inCustom).not.toContain("@layer tessera-standard-m1 {");
  });

  it("RUN-05: names the layers with a new random mark for every document it serves", async () => {
    const marks = await Promise.all(
      [1, 2, 3].map(async () => {
        const answer = await get("/runtime/tool?mount=mount-1", asFrame());
        return markOf(styles(answer.body)[0]!);
      }),
    );
    for (const mark of marks) expect(mark).toMatch(/^[0-9a-f]{16}$/);
    expect(new Set(marks).size).toBe(3);
  });
});
