import { expect, test, type Page } from "@playwright/test";
import type { Artifact } from "../../contracts/src/index.ts";
import { startSandboxHost, toolFrame, type SandboxHost } from "./support/sandbox-host.ts";

// The bridge end to end (RUN-04, GEN-06, RUN-07), in Chrome and Edge (TEST-06): a hostile tool in
// the sandbox tries each bridge check of the threat model (BRG), and the host page serves it with
// the runtime's own serveBridge, over the real port. BRG-04, a stale change, needs the server's
// saved revisions and comes with the data routes (#46). BRG-05, another instance's call, is the
// port's binding to its instance, which SBX-12 tries in the browser and the bridge's unit tests
// check.

const tools: Record<string, Artifact["code"]> = {
  // Writes as it starts, takes its port as it arrives, and tries every refused call it can.
  bridger: {
    html: '<button id="save">Save</button>',
    css: "button { width: 200px; height: 80px; }",
    js: `let raw;
// Every reply that reaches the page, beside the preamble, which drops those it isn't waiting for.
const replies = [];
addEventListener("message", (e) => {
  if (!e.ports[0]) return;
  raw = e.ports[0];
  raw.addEventListener("message", (r) => { if (r.data && "reply" in r.data) replies.push(r.data.reply); });
}, true);
const attempt = async (label, action, args) => {
  try { return { label, ok: true, result: await tessera.call(action, args) }; }
  catch (e) { return { label, ok: false, code: e.code, message: e.message }; }
};
const add = (title) => ({ operations: [{ op: "add", collection: "tasks", record: { title } }] });
attempt("at start", "data.patch", add("at start")).then((r) => tessera.send(r));
document.getElementById("save").addEventListener("click", async () => {
  tessera.send(await attempt("after a click", "data.patch", add("clicked")));
});
tessera.onMessage(async (m) => {
  if (m === "forge") {
    raw.postMessage({ interacted: true });
    tessera.send(await attempt("forged", "data.patch", add("forged")));
  }
  if (m === "clock") tessera.send(await attempt("clock", "clock.now", {}));
  if (m !== "probe") return;
  const probeStart = replies.length;
  const results = [
    await attempt("not plain data", "data.read", { when: new Date() }),
    await attempt("not an object", "data.read", "everything"),
    await attempt("too large", "data.read", { huge: "x".repeat(300000) }),
    await attempt("unlisted", "fs.read", { path: "C:/Windows/win.ini" }),
    await attempt("an inherited name", "toString", {}),
    await attempt("undeclared", "clock.now", {}),
    await attempt("a path", "data.read", { path: "C:/Users/me/tessera.db" }),
    await attempt("a URL", "data.read", { url: "http://example.com/data" }),
    await attempt("another workspace", "data.patch", { workspaceId: "w-2", ...add("x") }),
    await attempt("outside its data", "data.patch", {
      operations: [{ op: "remove", collection: "../w-2", id: "x", revisionCount: 1 }],
    }),
  ];
  // Calls past the preamble, on the port itself, with no usable ID: no reply, and the host goes on.
  // The read after them is answered after any reply to them would be, so it closes the wait.
  raw.postMessage({ call: 42 });
  raw.postMessage({ call: { requestId: "has spaces", action: "data.read", args: {} } });
  raw.postMessage({ call: { action: "data.read" } });
  results.push(await attempt("still answering", "data.read", {}));
  // The preamble settles the last call before the listener above hears its reply: wait a task.
  await new Promise((done) => setTimeout(done, 0));
  tessera.send({ results, replies: replies.slice(probeStart) });
});`,
  },
};

let host: SandboxHost;
test.beforeAll(async () => {
  host = await startSandboxHost(tools);
});
test.afterAll(() => host.close());

type Reply = { label: string; ok: boolean; code?: string; message?: string; result?: unknown };
type Mounted = { send(message: unknown): void; onMessage(listen: (m: unknown) => void): void };
type TestWindow = {
  mountTool(container: HTMLElement, mountId: string): Promise<Mounted>;
  serveBridge(tool: Mounted, options: unknown): unknown;
  tool: Mounted;
  messages: unknown[];
  writes: unknown[];
};
type Serve = { capabilities?: string[]; staging?: boolean; epochMs?: number; timeZone?: string };

/** Mounts the bridger and serves it the bridge, with data that keeps every write it is asked for. */
async function serve(page: Page, options: Serve = {}) {
  await page.goto(`${host.url}/`);
  await page.waitForFunction(() => "serveBridge" in window);
  await page.evaluate(async ({ capabilities = [], staging = false, epochMs, timeZone = "UTC" }) => {
    const w = window as unknown as TestWindow;
    w.messages = [];
    w.writes = [];
    w.tool = await w.mountTool(document.body, "bridger");
    w.tool.onMessage((message) => w.messages.push(message));
    w.serveBridge(w.tool, {
      capabilities,
      staging,
      clock: epochMs === undefined ? undefined : { now: () => epochMs, timeZone: () => timeZone },
      data: {
        read: () => Promise.resolve({ data: { tasks: [] }, revisions: {} }),
        patch: (batch: { operations: unknown[] }) => {
          w.writes.push(batch);
          return Promise.resolve({ addedIds: batch.operations.map((_, i) => `t-${i + 1}`) });
        },
      },
    });
  }, options);
  // The tool's first call, a write as it starts, has been answered: the bridge is up.
  await expect.poll(() => labelled(page, "at start")).toBeDefined();
}

const messages = (page: Page) =>
  page.evaluate(() => [...(window as unknown as TestWindow).messages]);
const writes = (page: Page) => page.evaluate(() => [...(window as unknown as TestWindow).writes]);
const labelled = async (page: Page, label: string) =>
  // A message can be empty: the tool's forged report reaches the host as one.
  (await messages(page)).find((m) => (m as Reply | undefined)?.label === label) as
    Reply | undefined;
const tell = (page: Page, message: string) =>
  page.evaluate((message) => (window as unknown as TestWindow).tool.send(message), message);

test("BRG-01 to BRG-03, BRG-07: every refused call gets a plain reply, and the host keeps answering", async ({
  page,
}) => {
  await serve(page);
  // The person uses the tool first, so its writes get as far as their arguments.
  await toolFrame(page).locator("#save").click();
  await expect.poll(() => labelled(page, "after a click")).toMatchObject({ ok: true });
  await tell(page, "probe");
  const found = async () =>
    (await messages(page)).find((m) => typeof m === "object" && m !== null && "results" in m) as
      { results: Reply[]; replies: { requestId: unknown }[] } | undefined;
  await expect.poll(found, { timeout: 15_000 }).toBeDefined();
  const { results, replies } = (await found())!;
  expect(Object.fromEntries(results.map((r) => [r.label, r.ok ? "ok" : r.code]))).toEqual({
    "not plain data": "malformed",
    "not an object": "malformed",
    "too large": "too-large",
    unlisted: "unknown-action",
    "an inherited name": "unknown-action",
    undeclared: "undeclared-capability",
    "a path": "invalid-args",
    "a URL": "invalid-args",
    "another workspace": "invalid-args",
    "outside its data": "invalid-args",
    "still answering": "ok",
  });
  // Each refusal says why in words, and no reply names a file.
  for (const r of results.filter((r) => !r.ok)) {
    expect(r.message!.length, r.label).toBeGreaterThan(20);
  }
  // Every reply that reached the page answered one of the tool's own calls, once each: the calls
  // on the raw port got none.
  expect(replies).toHaveLength(results.length);
  for (const reply of replies) expect(reply.requestId).toMatch(/^p[0-9a-f]{8}-c\d+$/);
  expect(new Set(replies.map((r) => r.requestId)).size).toBe(results.length);
  expect(JSON.stringify({ results, replies })).not.toMatch(
    /[A-Za-z]:[\\/]|\/(Users|home)\/|tessera\.db/,
  );
  // Only the person's own write reached the data.
  expect(await writes(page)).toHaveLength(1);
});

test("BRG-06: no write as the tool starts, or on a forged interaction; the person's click lets it write (GEN-06)", async ({
  page,
}) => {
  await serve(page);
  expect(await labelled(page, "at start")).toMatchObject({ ok: false, code: "not-active" });
  expect((await labelled(page, "at start"))?.message).toMatch(/Nothing was saved/);

  await tell(page, "forge");
  await expect
    .poll(() => labelled(page, "forged"))
    .toMatchObject({ ok: false, code: "not-active" });
  expect(await writes(page)).toEqual([]);

  await toolFrame(page).locator("#save").click();
  await expect
    .poll(() => labelled(page, "after a click"))
    .toMatchObject({ ok: true, result: { addedIds: ["t-1"] } });
  expect(await writes(page)).toEqual([
    { operations: [{ op: "add", collection: "tasks", record: { title: "clicked" } }] },
  ]);
});

test("BRG-06: a tool in the staging panel never writes, even after the person's click", async ({
  page,
}) => {
  await serve(page, { staging: true });
  expect(await labelled(page, "at start")).toMatchObject({ code: "not-active" });
  await toolFrame(page).locator("#save").click();
  await expect.poll(() => labelled(page, "after a click")).toMatchObject({ code: "not-active" });
  expect(await writes(page)).toEqual([]);
});

// Quarantined (ENG-20): the host page stopped answering its first poll for 5 s, once in Chrome on
// CI. Find why, fix it or the test, and remove this before M1 closes (#98).
test.fixme("RUN-07: a tool that declares the clock gets the host's, which the test sets", async ({
  page,
}) => {
  const epochMs = Date.parse("2026-10-22T23:30:00Z");
  await serve(page, { capabilities: ["clock"], epochMs, timeZone: "Asia/Kolkata" });
  await tell(page, "clock");
  await expect
    .poll(() => labelled(page, "clock"))
    .toEqual({
      label: "clock",
      ok: true,
      result: { epochMs, date: "2026-10-23", timeZone: "Asia/Kolkata", utcOffsetMinutes: 330 },
    });
});
