import { expect, test, type Page } from "@playwright/test";
import type { Artifact } from "../../contracts/src/index.ts";
import { startSandboxHost, type SandboxHost } from "./support/sandbox-host.ts";

// The bridge's two ends of the port (CON-03, RUN-04, GEN-06), in Chrome and Edge (TEST-06): a
// tool's calls reach the host in their own envelope, each reply settles the call it names, and the
// host hears the person's first real interaction, which the tool's code can't fake. What the host
// answers is checked by whoever serves the bridge (#46); here the test page answers by hand.

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
  // Fakes every kind of interaction it can as it starts, then says so.
  presser: {
    html: '<button id="press">Press</button>',
    css: "button { width: 200px; height: 80px; }",
    js: `const button = document.getElementById("press");
button.click();
button.focus();
dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
tessera.send("faked");`,
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
};
type TestWindow = {
  mountTool(container: HTMLElement, mountId: string): Promise<Mounted>;
  tool: Mounted;
  messages: unknown[];
  calls: { requestId: string; action: string; args: unknown }[];
  interactions: number;
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
    w.tool = await w.mountTool(document.body, mountId);
    w.tool.onMessage((message) => w.messages.push(message));
    w.tool.onCall((call) => w.calls.push(call as TestWindow["calls"][number]));
    w.tool.onInteraction(() => (w.interactions += 1));
  }, mountId);
}

const recorded = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as TestWindow;
    return { messages: [...w.messages], calls: [...w.calls], interactions: w.interactions };
  });

test("a call reaches the host in its own envelope, and its reply settles it (CON-03)", async ({
  page,
}) => {
  await mountRecording(page, "caller");
  // The call made before the port existed waited for it, and arrived whole.
  await expect
    .poll(async () => (await recorded(page)).calls)
    .toEqual([{ requestId: "c1", action: "data.read", args: {} }]);
  expect((await recorded(page)).messages).toEqual([]);

  await page.evaluate(() => {
    const tool = (window as unknown as TestWindow).tool;
    // A reply to a call the tool never made, then the real one: only the real one counts.
    tool.reply({ requestId: "c99", ok: true, result: { stray: true } });
    tool.reply({ requestId: "c1", ok: true, result: { data: {}, revisions: {} } });
    tool.reply({ requestId: "c1", ok: true, result: { again: true } });
  });
  await expect
    .poll(async () => (await recorded(page)).messages)
    .toEqual([{ label: "first", result: { data: {}, revisions: {} } }]);

  // A refusal rejects the call with its code.
  await page.evaluate(() => (window as unknown as TestWindow).tool.send("again"));
  await expect.poll(async () => (await recorded(page)).calls.length).toBe(2);
  const [, again] = (await recorded(page)).calls;
  expect(again).toEqual({ requestId: "c2", action: "clock.now", args: {} });
  await page.evaluate(() =>
    (window as unknown as TestWindow).tool.reply({
      requestId: "c2",
      ok: false,
      error: { code: "undeclared-capability", message: "Declare the clock first." },
    }),
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

test("the host hears the person's first interaction, and none the tool fakes (GEN-06)", async ({
  page,
}) => {
  await mountRecording(page, "presser");
  await expect.poll(async () => (await recorded(page)).messages).toEqual(["faked"]);
  // Clicks, focus and events made by the tool's code aren't the person's.
  await page.waitForTimeout(500);
  expect((await recorded(page)).interactions).toBe(0);

  const button = page.frameLocator("iframe").frameLocator("iframe").locator("#press");
  await button.click();
  await expect.poll(async () => (await recorded(page)).interactions).toBe(1);
  // Only the first counts.
  await button.click();
  await page.keyboard.press("a");
  await page.waitForTimeout(500);
  expect((await recorded(page)).interactions).toBe(1);
});
