import { expect, test, type Page } from "@playwright/test";
import { nothingArrived, probe, proberTool } from "./support/prober.ts";
import { collect, mount, startSandboxHost, type SandboxHost } from "./support/sandbox-host.ts";

// The sandbox's boundary checks that face the host page and the person (SEC-05,
// docs/spec/threat-model.md), in Chrome and Edge (TEST-06): forms, moving the host page, popups,
// dialogs and downloads, reaching into the host, talking outside the bridge, and device features.

// The checks the prober can run here, inside the sandboxed tool.
const HOST_CHECKS = `
  // SBX-08: forms, to the probe server and to the host app, submitted two ways. The sandbox
  // refuses them first (no allow-forms), so the policy's form-action usually has nothing to report;
  // a form that went would take the tool off its page, and the host would see it.
  async forms({ probe, app }) {
    const found = {};
    for (const [name, url] of Object.entries({ probe: probe + "form", "host app": app + "/api/instance" })) {
      for (const way of ["submit", "requestSubmit"]) {
        const before = violations.length;
        const form = add(Object.assign(document.createElement("form"), { action: url, method: "post" }));
        form.append(Object.assign(document.createElement("input"), { name: "secret", value: "x" }));
        try { form[way](); } catch {}
        await wait(300);
        const reported = violations.slice(before).some((event) => event.effectiveDirective === "form-action");
        found[way + " to " + name] = location.href.includes("/runtime/tool") ? (reported ? "stayed, policy reported" : "stayed") : "left";
      }
    }
    return found;
  },
  // SBX-09: moving the host page. Whether the browser throws or only refuses quietly, the host
  // page must stay where it is.
  async hostPage({ probe }) {
    const tryTo = (move) => attempt(() => { move(); return "no error"; });
    return {
      "top.location": await tryTo(() => { top.location.href = probe + "top"; }),
      "top.location.replace": await tryTo(() => top.location.replace(probe + "replace")),
      "parent.location": await tryTo(() => { parent.location.href = probe + "parent"; }),
    };
  },
  // SBX-10: popups, dialogs and downloads.
  async popups({ probe }) {
    const click = (props) => add(Object.assign(document.createElement("a"), { textContent: "go" }, props)).click();
    const file = URL.createObjectURL(new Blob(["x"], { type: "text/plain" }));
    return {
      "window.open": await attempt(() => (open(probe + "open") ? "opened" : "refused")),
      "target=_blank link": await attempt(() => { click({ href: probe + "blank", target: "_blank" }); return "clicked"; }),
      alert: await attempt(() => { alert("x"); return "returned"; }),
      confirm: await attempt(() => (confirm("x") ? "confirmed" : "returned")),
      prompt: await attempt(() => (prompt("x") === null ? "returned" : "answered")),
      print: await attempt(() => { print(); return "returned"; }),
      "download link": await attempt(() => { click({ href: file, download: "x.txt" }); return "clicked"; }),
    };
  },
  // SBX-11: reaching into the host, and the tool's own origin.
  async reach() {
    const read = (get) => attempt(() => { const value = get(); return value == null ? "nothing" : "read"; });
    return {
      origin: self.origin,
      "parent.document": await read(() => parent.document),
      "top.document": await read(() => top.document),
      "parent.localStorage": await read(() => parent.localStorage),
      "top.mountTool": await read(() => top.mountTool),
      "parent.location.href": await read(() => parent.location.href),
      "window.opener": await read(() => window.opener),
      "window.frameElement": await read(() => window.frameElement),
    };
  },
  // SBX-12: bridge-shaped messages to the wrapper and the host page, each with a port of its own.
  // (A hello from the tool's own frame counts as leaving its page, by design: SBX-07.)
  async outside() {
    let answers = 0;
    const shapes = [
      { type: "tessera:mount", mountId: "prober", instanceId: "forged" },
      { type: "tessera:port", instanceId: "forged" },
      { instanceId: "forged", message: { found: { forged: "yes" } } },
    ];
    for (const shape of shapes) {
      for (const target of [parent, top]) {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => (answers += 1);
        try { target.postMessage(shape, "*", [channel.port2]); } catch {}
      }
    }
    await wait(1500);
    return { answers: answers ? "answered" : "no answer" };
  },
  // SBX-13: device and powerful features. A refusal must come back: "no answer" could mean a
  // permission prompt is waiting for the person. Asking for devices can take seconds to be refused
  // on a busy machine, so each gets ten.
  async devices() {
    const slow = (promise) => within(promise, 10000);
    const geolocation = () => new Promise((done) =>
      navigator.geolocation.getCurrentPosition(() => done("granted"), () => done("refused")));
    const pointerLock = () => new Promise((done) => {
      document.addEventListener("pointerlockchange", () => done("granted"));
      document.addEventListener("pointerlockerror", () => done("refused"));
      try { document.body.requestPointerLock()?.catch?.(() => done("refused")); } catch { done("refused"); }
    });
    const settled = (promise) => promise.then(() => "granted", () => "refused");
    return {
      geolocation: await attempt(() => slow(geolocation())),
      "camera and microphone": await attempt(() =>
        slow(settled(navigator.mediaDevices.getUserMedia({ video: true, audio: true })))),
      "clipboard read": await attempt(() => slow(settled(navigator.clipboard.readText()))),
      fullscreen: await attempt(() => slow(settled(document.documentElement.requestFullscreen()))),
      "pointer lock": await attempt(() => slow(pointerLock())),
    };
  },
  // Puts a button in the tool that tries the action when the person really clicks it: moving the
  // host page and going fullscreen are allowed only after a click, so an attempt without one would
  // be refused whatever the sandbox allowed (SBX-09, SBX-13).
  async armed({ probe, action }) {
    const button = add(Object.assign(document.createElement("button"), { id: "go", textContent: "Go" }));
    button.addEventListener("click", async () => {
      const actions = {
        top: () => attempt(() => { top.location.href = probe + "top-clicked"; return "no error"; }),
        parent: () => attempt(() => { parent.location.href = probe + "parent-clicked"; return "no error"; }),
        fullscreen: () => attempt(() => within(document.documentElement.requestFullscreen()
          .then(() => (document.fullscreenElement ? "granted" : "refused"), () => "refused"), 10000)),
      };
      const result = await actions[action]();
      await wait(1000);
      tessera.send({ clicked: action, result });
    }, { once: true });
    return { armed: action };
  },
  // Answers anything that reaches it, for SBX-12's port from an earlier mount.
  async echo() {
    return { heard: "yes" };
  },
`;

let host: SandboxHost;
test.beforeAll(async () => {
  host = await startSandboxHost({ prober: proberTool(HOST_CHECKS) });
});
test.afterAll(() => host.close());

/**
 * Mounts the prober with a button that tries `action`, clicks it for real, and returns what the
 * tool found. The click is Playwright's, inside the tool's frame: a click the tool makes itself
 * gives no permission.
 */
async function clickToTry(page: Page, action: string): Promise<string | undefined> {
  const armed = await probe(page, host, "armed", { action });
  expect(armed).toEqual({ armed: action });
  await page.frameLocator("iframe").frameLocator("iframe").locator("#go").click();
  const { messages, events } = await collect(page, 3, 500, 20_000);
  expect(events, "the tool stayed on its page").toEqual([]);
  const answer = messages[2] as { clicked?: string; result?: string } | undefined;
  expect(answer?.clicked, "the tool answered after the click").toBe(action);
  return answer?.result;
}

// The host page is where it was, with one wrapper and one tool frame inside it.
async function hostUnmoved(page: Page) {
  expect(page.url()).toBe(`${host.url}/`);
  expect(page.context().pages()).toHaveLength(1);
  const wrapper = page.frames().find((frame) => frame.url().includes("/runtime/wrapper"));
  expect(wrapper, "the wrapper is still there").toBeDefined();
  await expect(wrapper!.locator("iframe")).toHaveCount(1);
  // The tool's document, from a tool host of its own under the runtime's name (RUN-02).
  expect(await wrapper!.locator("iframe").getAttribute("src")).toMatch(
    /^http:\/\/t[0-9a-f]{16}\.localhost:\d+\/runtime\/tool\?mount=prober$/,
  );
}

test("SBX-08: forms are refused and send nothing, to the probe or the host", async ({ page }) => {
  const found = await probe(page, host, "forms", { app: host.url });
  expect(Object.keys(found)).toHaveLength(4);
  // Still on its page after each one, and nothing sent: the tool answered, without a restart.
  for (const [form, result] of Object.entries(found)) expect(result, form).toMatch(/^stayed/);
  await hostUnmoved(page);
  nothingArrived(host);
});

test("SBX-09: the tool can't move the host page or the wrapper", async ({ page }) => {
  const found = await probe(page, host, "hostPage");
  expect(Object.keys(found)).toHaveLength(3);
  await hostUnmoved(page);
  nothingArrived(host);
});

test("SBX-09: not even right after the person clicks inside the tool", async ({ page }) => {
  for (const action of ["top", "parent"]) {
    const result = await clickToTry(page, action);
    expect(["refused", "no error"], action).toContain(result);
    await hostUnmoved(page);
    nothingArrived(host);
  }
});

test("SBX-10: no window opens, no dialog shows and no file downloads", async ({ page }) => {
  const seen: string[] = [];
  page.on("popup", () => seen.push("popup"));
  page.on("download", () => seen.push("download"));
  page.on("dialog", (dialog) => {
    seen.push(`dialog ${dialog.type()}`);
    void dialog.dismiss();
  });
  page.context().on("page", () => seen.push("page"));
  const found = await probe(page, host, "popups");
  expect(found["window.open"]).toBe("refused");
  // Without permission for modals, the browser skips each dialog and returns at once.
  expect(found["confirm"]).toBe("returned");
  expect(found["prompt"]).toBe("returned");
  expect(seen).toEqual([]);
  await hostUnmoved(page);
  nothingArrived(host);
});

test("SBX-11: the tool reaches nothing of the host, and its origin is null", async ({ page }) => {
  const { origin, ...reads } = await probe(page, host, "reach");
  expect(origin).toBe("null");
  expect(Object.keys(reads)).toHaveLength(7);
  for (const [what, result] of Object.entries(reads))
    expect(["refused", "nothing"], what).toContain(result);
  // The wrapper, on the opposite loopback name, can't read the host page either.
  const wrapper = page.frames().find((frame) => frame.url().includes("/runtime/wrapper"));
  const fromWrapper = await wrapper!.evaluate(() => {
    try {
      return parent.document.title === undefined ? "nothing" : "read";
    } catch {
      return "refused";
    }
  });
  expect(fromWrapper).toBe("refused");
  nothingArrived(host);
});

test("SBX-12: messages outside the bridge get no answer and change nothing", async ({ page }) => {
  const found = await probe(page, host, "outside");
  expect(found["answers"]).toBe("no answer");
  await hostUnmoved(page);
  // The host heard nothing but the prober's own two messages over the bridge.
  const { messages } = await collect(page, 2, 0);
  expect(messages).toEqual([{ ready: true }, { found }]);
  nothingArrived(host);
});

test("SBX-12: a handle from an earlier mount reaches nothing", async ({ page }) => {
  await mount(page, host, "prober");
  await collect(page, 1, 0);
  // Keep the first mount's handle, unmount it, and mount the tool again.
  await page.evaluate(async () => {
    type Handle = { send(message: unknown): void; unmount(): void };
    const w = window as unknown as {
      tool: Handle & { onMessage(listen: (message: unknown) => void): void };
      earlier: Handle;
      messages: unknown[];
      mountTool(container: HTMLElement, mountId: string): Promise<Handle>;
    };
    w.earlier = w.tool;
    w.earlier.unmount();
    w.messages = [];
    w.tool = (await w.mountTool(document.body, "prober")) as typeof w.tool;
    w.tool.onMessage((message) => w.messages.push(message));
  });
  await collect(page, 1, 0);
  await page.evaluate(() =>
    (window as unknown as { earlier: { send(message: unknown): void } }).earlier.send({
      check: "echo",
    }),
  );
  // Silence is the expected answer, so don't wait long for a reply.
  const { messages } = await collect(page, 2, 1000, 3000);
  expect(messages).toEqual([{ ready: true }]);
});

test("SBX-13: device features are refused, even after the person allowed them for Tessera", async ({
  page,
}) => {
  test.setTimeout(90_000);
  // As if the person had granted Tessera's own page each feature: the tool still gets none.
  await page.context().grantPermissions(["geolocation", "camera", "microphone", "clipboard-read"], {
    origin: host.url,
  });
  const found = await probe(page, host, "devices");
  expect(Object.keys(found)).toHaveLength(5);
  for (const [feature, result] of Object.entries(found)) expect(result, feature).toBe("refused");
  nothingArrived(host);
  // Fullscreen needs a click, so try it from one as well.
  expect(await clickToTry(page, "fullscreen")).toBe("refused");
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
});
