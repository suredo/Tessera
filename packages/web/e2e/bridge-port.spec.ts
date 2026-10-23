import { expect, test, type Page } from "@playwright/test";
import type { Artifact } from "../../contracts/src/index.ts";
import { startSandboxHost, toolFrame, type SandboxHost } from "./support/sandbox-host.ts";

// The bridge's two ends of the port (CON-03, RUN-04, GEN-06), in Chrome and Edge (TEST-06): a
// tool's calls reach the host in their own envelope, each reply settles only the call it names, on
// the page that made it, and the host hears the person's first real interaction, which the wrapper
// sees and the tool's code can't fake. What the host answers is checked by whoever serves the
// bridge (#46); here the test page answers by hand.

const tools: Record<string, Artifact["code"]> = {
  // Calls as it starts, before its port exists, then when asked; says how each call settled.
  caller: {
    html: "<p>Caller</p>",
    css: "",
    js: `const report = (label, call) => call.then(
  (result) => tessera.send({ label, result }),
  (error) => tessera.send({ label, code: typeof error.code === "string" ? error.code : null, name: error.name }),
);
report("first", tessera.call("data.read"));
tessera.onMessage((m) => {
  if (m === "again") report("again", tessera.call("clock.now", {}));
  if (m === "uncloneable") report("uncloneable", tessera.call("data.read", { f() {} }));
});`,
  },
  // Fakes every kind of interaction it can as it starts, then says so. It takes the port as it
  // arrives and sends a fake report on it, and makes every later send carry one too.
  presser: {
    html: '<button id="press">Press</button>',
    css: "button { width: 200px; height: 80px; }",
    js: `addEventListener("message", (e) => {
  const port = e.ports[0];
  if (!port) return;
  port.postMessage({ interacted: true });
  port.postMessage({ message: "took the port" });
}, true);
const post = MessagePort.prototype.postMessage;
MessagePort.prototype.postMessage = function (data, ...rest) {
  post.call(this, { interacted: true });
  return post.call(this, data, ...rest);
};
const button = document.getElementById("press");
button.click();
button.focus();
dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
tessera.send("faked");`,
  },
  // Calls as it starts, and leaves its page when asked, so it starts again and calls again.
  restarter: {
    html: "<p>Restarter</p>",
    css: "",
    js: `const run = Math.random().toString(36).slice(2);
tessera.call("data.read").then((result) => tessera.send({ run, result }));
tessera.send({ run, started: true });
tessera.onMessage((m) => { if (m === "leave") location.href = "about:blank"; });`,
  },
  // On the person's click, calls the host; told to, it then leaves its page at once, so the click's
  // activation is still live when the page that replaces it starts.
  leaver: {
    html: '<button id="press">Press</button>',
    css: "button { width: 200px; height: 80px; }",
    js: `const run = Math.random().toString(36).slice(2);
let leaveOnClick = false;
tessera.onMessage((m) => { if (m === "leave on click") leaveOnClick = true; });
document.getElementById("press").addEventListener("click", () => {
  tessera.call("data.read");
  tessera.send({ run, clicked: true });
  if (leaveOnClick) location.href = "about:blank";
});
tessera.send({ run, ready: true });`,
  },
};

let host: SandboxHost;
test.beforeAll(async () => {
  host = await startSandboxHost(tools);
});
test.afterAll(() => host.close());

type Mounted = {
  send(message: unknown): void;
  onMessage(listen: (message: unknown) => void): () => void;
  onCall(listen: (call: unknown) => void): () => void;
  reply(reply: unknown): void;
  onInteraction(listen: () => void): () => void;
  onEvent(listen: (event: string) => void): () => void;
};
type TestWindow = {
  mountTool(container: HTMLElement, mountId: string): Promise<Mounted>;
  tool: Mounted;
  messages: unknown[];
  calls: { requestId: string; action: string; args: unknown }[];
  interactions: number;
  events: string[];
  order: string[];
};

/** Mounts a tool and records its messages, calls and interactions from the start. */
async function mountRecording(page: Page, mountId: string) {
  await page.goto(`${host.url}/`);
  await page.waitForFunction(() => "mountTool" in window);
  await page.evaluate(async (mountId) => {
    const w = window as unknown as TestWindow;
    w.messages = [];
    w.calls = [];
    w.interactions = 0;
    w.events = [];
    w.order = [];
    w.tool = await w.mountTool(document.body, mountId);
    w.tool.onMessage((message) => w.messages.push(message));
    w.tool.onCall((call) => {
      w.calls.push(call as TestWindow["calls"][number]);
      w.order.push("call");
    });
    w.tool.onInteraction(() => {
      w.interactions += 1;
      w.order.push("interaction");
    });
    w.tool.onEvent((event) => w.events.push(event));
  }, mountId);
}

const recorded = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as TestWindow;
    return {
      messages: [...w.messages],
      calls: [...w.calls],
      interactions: w.interactions,
      events: [...w.events],
      order: [...w.order],
    };
  });

test("a call reaches the host in its own envelope, and its reply settles it (CON-03)", async ({
  page,
}) => {
  await mountRecording(page, "caller");
  // The call made before the port existed waited for it, and arrived whole.
  await expect.poll(async () => (await recorded(page)).calls.length).toBe(1);
  const [first] = (await recorded(page)).calls;
  expect(first).toEqual({
    requestId: expect.stringMatching(/^p[0-9a-f]{8}-c1$/),
    action: "data.read",
    args: {},
  });
  expect((await recorded(page)).messages).toEqual([]);

  await page.evaluate((id) => {
    const tool = (window as unknown as TestWindow).tool;
    // A reply to a call the tool never made, then the real one: only the real one counts.
    tool.reply({ requestId: id.replace(/c1$/, "c99"), ok: true, result: { stray: true } });
    tool.reply({ requestId: id, ok: true, result: { data: {}, revisions: {} } });
    tool.reply({ requestId: id, ok: true, result: { again: true } });
  }, first!.requestId);
  await expect
    .poll(async () => (await recorded(page)).messages)
    .toEqual([{ label: "first", result: { data: {}, revisions: {} } }]);

  // A refusal rejects the call with its code.
  await page.evaluate(() => (window as unknown as TestWindow).tool.send("again"));
  await expect.poll(async () => (await recorded(page)).calls.length).toBe(2);
  const [, again] = (await recorded(page)).calls;
  expect(again).toEqual({
    requestId: first!.requestId.replace(/c1$/, "c2"),
    action: "clock.now",
    args: {},
  });
  await page.evaluate(
    (id) =>
      (window as unknown as TestWindow).tool.reply({
        requestId: id,
        ok: false,
        error: { code: "undeclared-capability", message: "Declare the clock first." },
      }),
    again!.requestId,
  );
  await expect
    .poll(async () => (await recorded(page)).messages.at(-1))
    .toEqual({ label: "again", code: "undeclared-capability", name: "Error" });

  // A call the port can't carry fails at once, in the tool, and never reaches the host.
  await page.evaluate(() => (window as unknown as TestWindow).tool.send("uncloneable"));
  await expect
    .poll(async () => (await recorded(page)).messages.at(-1))
    .toEqual({ label: "uncloneable", code: null, name: "DataCloneError" });
  expect((await recorded(page)).calls).toHaveLength(2);
});

test("a late reply for a page the tool left settles nothing on the page that replaced it (SBX-07)", async ({
  page,
}) => {
  await mountRecording(page, "restarter");
  await expect.poll(async () => (await recorded(page)).calls.length).toBe(1);
  await page.evaluate(() => (window as unknown as TestWindow).tool.send("leave"));
  await expect
    .poll(async () => (await recorded(page)).events, { timeout: 15_000 })
    .toEqual(["restarted"]);
  await expect.poll(async () => (await recorded(page)).calls.length, { timeout: 15_000 }).toBe(2);
  const [old, current] = (await recorded(page)).calls;
  expect(current!.requestId).not.toBe(old!.requestId);

  // The first page's call is answered only now, after the tool started again: nothing settles.
  const answer = (id: string, result: object) =>
    page.evaluate(
      ({ id, result }) =>
        (window as unknown as TestWindow).tool.reply({ requestId: id, ok: true, result }),
      { id, result },
    );
  const settled = async () =>
    (await recorded(page)).messages.filter((m) => "result" in (m as object));
  await answer(old!.requestId, { old: 1 });
  await page.waitForTimeout(500);
  expect(await settled()).toEqual([]);

  await answer(current!.requestId, { now: 1 });
  await expect.poll(settled).toEqual([{ run: expect.any(String), result: { now: 1 } }]);
  // The reply reached the second page, the one that made the call it answered.
  const runs = (await recorded(page)).messages.map((m) => (m as { run: string }).run);
  expect(runs.at(-1)).toBe(runs.at(-2));
  expect(runs[0]).not.toBe(runs.at(-1));
});

test("the host hears the person's first interaction, and none the tool fakes (GEN-06)", async ({
  page,
}) => {
  await mountRecording(page, "presser");
  await expect
    .poll(async () => (await recorded(page)).messages.sort())
    .toEqual(["faked", "took the port"]);
  // Clicks, focus and events made by the tool's code, and reports it sends on the port it took or
  // through a changed postMessage, aren't the person's. Nor is a click on the host page.
  await page.mouse.click(10, 600);
  await page.waitForTimeout(500);
  expect((await recorded(page)).interactions).toBe(0);

  const button = toolFrame(page).locator("#press");
  await button.click();
  await expect.poll(async () => (await recorded(page)).interactions).toBe(1);
  // Only the first counts.
  await button.click();
  await page.keyboard.press("a");
  await page.waitForTimeout(500);
  expect((await recorded(page)).interactions).toBe(1);
});

test("a page started again just after a click waits for its own, and counts it at once (GEN-06)", async ({
  page,
}) => {
  await mountRecording(page, "leaver");
  const ready = async () =>
    (await recorded(page)).messages.filter((m) => (m as { ready?: boolean }).ready).length;
  await expect.poll(ready).toBe(1);
  await page.evaluate(() => (window as unknown as TestWindow).tool.send("leave on click"));
  await toolFrame(page).locator("#press").click();
  await expect
    .poll(async () => (await recorded(page)).events, { timeout: 15_000 })
    .toEqual(["restarted"]);
  await expect.poll(ready, { timeout: 15_000 }).toBe(2);
  // The first page's click counted once. The new page didn't inherit it, although the click's
  // activation is still live in the wrapper: it lasts a few seconds.
  await page.waitForTimeout(300);
  expect((await recorded(page)).order).toEqual(["interaction", "call"]);
  const wrapper = page.frames().find((frame) => frame.url().includes("/runtime/wrapper"));
  expect(await wrapper!.evaluate(() => navigator.userActivation.isActive)).toBe(true);

  // The person clicks the new page: that counts at once, before the call the click made.
  await toolFrame(page).locator("#press").click();
  await expect
    .poll(async () => (await recorded(page)).order)
    .toEqual(["interaction", "call", "interaction", "call"]);
});
