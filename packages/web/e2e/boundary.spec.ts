import http from "node:http";
import { expect, test, type Page } from "@playwright/test";
import {
  collect,
  mount,
  send,
  startSandboxHost,
  type SandboxHost,
} from "./support/sandbox-host.ts";

// The sandbox's boundary checks (SEC-05, docs/spec/threat-model.md), in Chrome and Edge (TEST-06).
// A hand-written hostile tool attempts each forbidden thing and reports what happened. A check
// passes only if every attempt failed inside the tool and nothing reached the probe server, not
// even a connection, nor the local server on either loopback name.

// What the prober can try. Plain JavaScript in a string: it runs inside the sandboxed tool.
const PROBER = `
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const within = (promise, ms = 2000) => Promise.race([promise, wait(ms).then(() => "no answer")]);
const attempt = async (work) => { try { return await work(); } catch { return "refused"; } };
const loads = (element, ok = "load") => new Promise((done) => {
  element.addEventListener(ok, () => done("loaded"));
  element.addEventListener("error", () => done("refused"));
});
const add = (element) => { document.body.append(element); return element; };
// Every refusal the tool's policies report, so a check can tell a refusal by policy from a request
// that left and failed for another reason, such as the destination's CORS rules.
const violations = [];
addEventListener("securitypolicyviolation", (event) => violations.push(event));
const byPolicy = async (url, directive, run) => {
  const before = violations.length;
  const result = await run();
  await wait(100);
  const origin = new URL(url).origin;
  const reported = violations.slice(before).some((event) =>
    event.effectiveDirective === directive && event.blockedURI.startsWith(origin));
  return result === "refused" && reported ? "refused by policy" : result + (reported ? "" : ", no policy report");
};

const checks = {
  // SBX-01: fetch and XMLHttpRequest, also after the tool adds a looser policy of its own.
  async requests({ targets }) {
    const found = {};
    const tryAll = async (suffix) => {
      for (const [name, url] of Object.entries(targets)) {
        found["fetch " + name + suffix] = await byPolicy(url, "connect-src", () =>
          within(fetch(url).then(() => "loaded", () => "refused")));
        found["XMLHttpRequest " + name + suffix] = await byPolicy(url, "connect-src", () =>
          within(new Promise((done) => {
            const request = new XMLHttpRequest();
            request.onload = () => done("loaded");
            request.onerror = () => done("refused");
            try { request.open("GET", url); request.send(); } catch { done("refused"); }
          })));
      }
    };
    await tryAll("");
    const meta = document.createElement("meta");
    meta.httpEquiv = "Content-Security-Policy";
    meta.content = "default-src *; connect-src *";
    document.head.append(meta);
    await tryAll(" after its own policy");
    return found;
  },
  // SBX-02: other ways to open a connection.
  async connections({ probe }) {
    const host = new URL(probe).host;
    return {
      WebSocket: await attempt(() => within(new Promise((done) => {
        const socket = new WebSocket("ws://" + host + "/socket");
        socket.onopen = () => done("loaded");
        socket.onerror = () => done("refused");
      }))),
      EventSource: await attempt(() => within(new Promise((done) => {
        const source = new EventSource(probe + "events");
        source.onopen = () => done("loaded");
        source.onerror = () => { source.close(); done("refused"); };
      }))),
      // It only says whether the browser queued it; the probe server says whether it arrived.
      sendBeacon: await attempt(() => (navigator.sendBeacon(probe + "beacon", "x") ? "queued" : "refused")),
    };
  },
  // SBX-03: loading by URL. The control: an image from bytes the host handed over loads.
  async resources({ probe, png }) {
    const element = (tag, props) => Object.assign(document.createElement(tag), props);
    const found = {
      img: await within(loads(add(element("img", { src: probe + "img" })))),
      audio: await within(loads(add(element("audio", { src: probe + "audio", preload: "auto" })), "loadeddata")),
      video: await within(loads(add(element("video", { src: probe + "video", preload: "auto" })), "loadeddata")),
      "script src": await within(loads(add(element("script", { src: probe + "script.js" })))),
      stylesheet: await within(loads(add(element("link", { rel: "stylesheet", href: probe + "style.css" })))),
      "web font": await within(new FontFace("Probe", "url(" + probe + "font.woff2)").load().then(() => "loaded", () => "refused")),
    };
    // CSS url() and @import raise no event in the tool; only the probe server can tell.
    add(element("div", { textContent: "x" })).style.backgroundImage = "url(" + probe + "background.png)";
    add(element("style", { textContent: "@import url(" + probe + "import.css);" }));
    await wait(1000);
    const blob = URL.createObjectURL(new Blob([new Uint8Array(png)], { type: "image/png" }));
    found["control: blob: image"] = await within(loads(add(element("img", { src: blob }))));
    return found;
  },
  // SBX-04: storage. With read, it only looks for what an earlier mount tried to keep.
  async storage({ read }) {
    const value = read ? undefined : "kept";
    const idb = () => new Promise((done) => {
      const request = indexedDB.open("tessera-probe");
      request.onupgradeneeded = () => request.result.createObjectStore("s");
      request.onsuccess = () => { request.result.close(); done(read ? "opened" : "stored"); };
      request.onerror = () => done("refused");
    });
    return {
      localStorage: await attempt(() => (read ? (localStorage.getItem("k") ? "found" : "empty") : (localStorage.setItem("k", value), "stored"))),
      sessionStorage: await attempt(() => (read ? (sessionStorage.getItem("k") ? "found" : "empty") : (sessionStorage.setItem("k", value), "stored"))),
      IndexedDB: await attempt(() => within(idb())),
      cookie: await attempt(() => {
        if (!read) document.cookie = "k=kept";
        return document.cookie.includes("k=kept") ? "found" : "empty";
      }),
      "Cache API": await attempt(async () => {
        if (typeof caches === "undefined") return "unavailable";
        const cache = await caches.open("tessera-probe");
        if (!read) await cache.put("/k", new Response("kept"));
        return (await cache.match("/k")) ? "found" : "empty";
      }),
    };
  },
  // SBX-05: workers, from a script URL and from a blob: URL.
  async workers({ probe, runtime }) {
    const blob = (code) => URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    const starts = (make) => attempt(() => within(new Promise((done) => {
      const worker = make();
      const port = worker.port ?? worker;
      port.onmessage = () => done("started");
      worker.onerror = () => done("refused");
      if (worker.port) worker.port.start();
    })));
    const dedicated = "postMessage('up')";
    const shared = "onconnect = (e) => e.ports[0].postMessage('up')";
    return {
      "Worker, URL": await starts(() => new Worker(probe + "worker.js")),
      "Worker, same-origin URL": await starts(() => new Worker(runtime + "/runtime/worker.js")),
      "Worker, blob:": await starts(() => new Worker(blob(dedicated))),
      "SharedWorker, URL": await starts(() => new SharedWorker(probe + "shared.js")),
      "SharedWorker, blob:": await starts(() => new SharedWorker(blob(shared))),
      "service worker": await attempt(() => {
        if (!("serviceWorker" in navigator)) return "unavailable";
        return within(navigator.serviceWorker.register(probe + "sw.js").then(() => "started", () => "refused"));
      }),
    };
  },
};

tessera.send({ ready: true });
tessera.onMessage(async (message) => {
  tessera.send({ found: await checks[message.check](message) });
});
`;

// A 1x1 PNG, standing in for an asset the host hands over (DATA-11).
const PNG = [
  ...Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
];

// What counts as the attempt failing, in the tool's own words.
const FAILED = ["refused", "no answer", "unavailable", "empty"];

let host: SandboxHost;
test.beforeAll(async () => {
  host = await startSandboxHost({ prober: { html: "<p>Prober</p>", css: "", js: PROBER } });
});
test.afterAll(() => host.close());

/** Mounts the prober, then runs one check with nothing else in flight, and returns its findings. */
async function probe(page: Page, check: string, payload: object = {}) {
  await mount(page, host, "prober");
  await collect(page, 1, 0);
  host.reset();
  await send(page, { check, probe: host.probeUrl, ...payload });
  const { messages, events } = await collect(page, 2, 1000);
  const found = (messages[1] as { found?: Record<string, string> } | undefined)?.found;
  expect(found, "the prober answered").toBeDefined();
  expect(events, "the tool stayed on its page").toEqual([]);
  return found ?? {};
}

// Nothing the tool did reached either server: no request, and no connection either.
function nothingArrived() {
  expect(host.probeRequests).toEqual([]);
  expect(host.probeConnections()).toBe(0);
  expect(host.hostRequests).toEqual([]);
  expect(host.hostConnections()).toBe(0);
}

const runtimeOrigin = () => `http://localhost:${host.port}`;

test("SBX-01: fetch and XMLHttpRequest fail and send nothing, even after the tool's own policy", async ({
  page,
}) => {
  const found = await probe(page, "requests", {
    targets: {
      probe: `${host.probeUrl}fetch`,
      "host app": `${host.url}/api/instance`,
      runtime: `${runtimeOrigin()}/runtime/wrapper`,
      outside: "https://example.com/",
    },
  });
  expect(Object.keys(found)).toHaveLength(16);
  // Refused by the policy itself: a request that left and failed the destination's CORS rules
  // would also fail in the tool, but with no policy report.
  for (const [attempt, result] of Object.entries(found)) {
    expect(result, attempt).toBe("refused by policy");
  }
  nothingArrived();

  // Sent straight to the server with the tool's origin, the API refuses it too (SEC-03).
  const status = await new Promise<number>((resolve, reject) => {
    const request = http.get(
      {
        host: "127.0.0.1",
        port: host.port,
        path: "/api/instance",
        headers: { host: `127.0.0.1:${host.port}`, origin: "null", "sec-fetch-site": "cross-site" },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    request.on("error", reject);
  });
  expect(status).toBe(403);
  // The counters see what arrives: that request was one connection and one request.
  expect(host.hostConnections()).toBe(1);
  expect(host.hostRequests).toHaveLength(1);
});

test("SBX-02: WebSocket, EventSource and sendBeacon reach nothing", async ({ page }) => {
  const found = await probe(page, "connections");
  expect(found["WebSocket"]).toMatch(/refused|no answer/);
  expect(found["EventSource"]).toMatch(/refused|no answer/);
  nothingArrived();
});

test("SBX-03: nothing loads by URL, and an image from a blob: URL does", async ({ page }) => {
  const found = await probe(page, "resources", { png: PNG });
  const { ["control: blob: image"]: control, ...attempts } = found;
  expect(control).toBe("loaded");
  expect(Object.keys(attempts)).toHaveLength(6);
  for (const [attempt, result] of Object.entries(attempts))
    expect(FAILED, attempt).toContain(result);
  nothingArrived();
});

test("SBX-04: storage is refused, and nothing is kept for the next mount", async ({ page }) => {
  const written = await probe(page, "storage", { read: false });
  for (const [store, result] of Object.entries(written)) expect(FAILED, store).toContain(result);
  const read = await probe(page, "storage", { read: true });
  for (const [store, result] of Object.entries(read)) expect(FAILED, store).toContain(result);
  nothingArrived();
});

test("SBX-05: no worker starts, from a URL or a blob: URL", async ({ page }) => {
  const found = await probe(page, "workers", { runtime: runtimeOrigin() });
  expect(Object.keys(found)).toHaveLength(6);
  for (const [worker, result] of Object.entries(found)) expect(FAILED, worker).toContain(result);
  nothingArrived();
});
