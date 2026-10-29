import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { seedSamples } from "../../../scripts/seed.ts";
import { checkHtml, checkJs, staticCheck } from "../src/checks/index.ts";
import { openDataFolder } from "../src/storage/index.ts";
import { loadVersion } from "../src/versions/index.ts";
import { listWorkspaces } from "../src/workspaces/index.ts";

// The static check (VER-01), its first rules (ADR 0009): no frames, no navigation, no HTML or code
// made at run time, and no names built at run time on the page's objects, with real parsers. Each
// rule is tried directly and hidden (aliases, computed names, decoded text), and real tools pass.

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

const refusedHtml = (html: string) => checkHtml(html).length > 0;
const refusedJs = (js: string) => checkJs(js).length > 0;

describe("the tool's HTML (VER-01, ADR 0009)", () => {
  it("SBX-06: refuses frames, embedded objects and script tags, however they are written", () => {
    for (const html of [
      '<iframe src="https://example.com"></iframe>',
      '<IFRAME SRCDOC="<p>x</p>"></IFRAME>',
      '<object data="x"></object>',
      '<embed src="x">',
      "<script>alert(1)</script>",
      "<svg><script>alert(1)</script></svg>",
      "<template><iframe></iframe></template>",
      '<div><p><iframe src="//leak.example"></iframe></p></div>',
      '<base href="https://example.com/">',
    ]) {
      expect(refusedHtml(html), html).toBe(true);
    }
  });

  it("RUN-01: reads the HTML as the browser does, in the body: what the parser drops there is no element", () => {
    // In a body, the parser ignores <frameset> and <frame>, so neither makes a frame; an <iframe>
    // inside a table's text still does.
    expect(checkHtml("<frameset><frame></frameset>")).toEqual([]);
    expect(refusedHtml("<table><tr><td><iframe></iframe></td></tr></table>")).toBe(true);
  });

  it("SBX-07: refuses navigation: links out, meta refresh and form actions", () => {
    for (const html of [
      '<a href="https://example.com">x</a>',
      '<a href="//example.com">x</a>',
      '<a href="javascript:void(0)">x</a>',
      '<area href="https://example.com">',
      '<meta http-equiv="refresh" content="0;url=https://example.com">',
      '<form action="https://example.com"><button>Go</button></form>',
      '<button formaction="https://example.com">Go</button>',
    ]) {
      expect(refusedHtml(html), html).toBe(true);
    }
    expect(refusedHtml('<a href="#notes">Notes</a> <a href="">Top</a>')).toBe(false);
  });

  it("ADR 0009: refuses inline event handlers, which run code the check can't read", () => {
    for (const html of [
      '<img src="x" onerror="alert(1)">',
      '<button ONCLICK="go()">Go</button>',
      '<svg onload="go()"></svg>',
    ]) {
      expect(refusedHtml(html), html).toBe(true);
    }
  });

  it("VER-01: says where each problem is, in plain words for repair", () => {
    const [finding] = checkHtml('<p>Hi</p>\n<iframe src="x"></iframe>');
    expect(finding).toEqual({
      part: "html",
      line: 2,
      message:
        "The HTML has a <iframe> element. A tool has no frames, embedded objects or script tags: put the code in the JavaScript.",
    });
  });
});

describe("the tool's JavaScript (VER-01, ADR 0009)", () => {
  it("SBX-06, SBX-07: refuses creating frames, scripts and links, and navigating", () => {
    for (const js of [
      'document.createElement("iframe")',
      "document.createElement('SCRIPT')",
      'document.createElementNS("http://www.w3.org/2000/svg", "script")',
      'document.createElement("a")',
      'location.href = "https://example.com"',
      'location.assign("https://example.com")',
      'window.location = "https://example.com"',
      'document.location.replace("x")',
      'window.open("https://example.com")',
      'open("https://example.com")',
      'history.pushState(null, "", "/x")',
      'el.setAttribute("href", "https://example.com")',
      'el.setAttribute("srcdoc", "<p>x</p>")',
    ]) {
      expect(refusedJs(js), js).toBe(true);
    }
  });

  it("ADR 0009: refuses HTML and code made at run time", () => {
    for (const js of [
      // A script element whose text is decoded at run time.
      'const s = document.createElement("script"); s.textContent = String.fromCharCode(97); document.body.append(s);',
      // A string event handler, set from JavaScript.
      'button.setAttribute("onclick", decoded)',
      "button.setAttribute(name, value)",
      // HTML built at run time.
      "list.innerHTML = `<li>${item}</li>`",
      "list.innerHTML = rows.join('')",
      "el.outerHTML = html",
      'el.insertAdjacentHTML("beforeend", html)',
      'document.write("<p>x</p>")',
      "document.createRange().createContextualFragment(html)",
      'new DOMParser().parseFromString(text, "text/html")',
      'eval("1 + 1")',
      'new Function("return 1")',
      'setTimeout("go()", 10)',
      'import("https://example.com/x.js")',
    ]) {
      expect(refusedJs(js), js).toBe(true);
    }
  });

  it("ADR 0009: fixed HTML text is checked like the HTML part, and passes when it is plain", () => {
    expect(refusedJs('list.innerHTML = ""')).toBe(false);
    expect(refusedJs("hint.innerHTML = '<strong>Tip:</strong> press Enter'")).toBe(false);
    expect(refusedJs('el.insertAdjacentHTML("beforeend", "<li>One</li>")')).toBe(false);
    expect(refusedJs('box.innerHTML = "<iframe src=x></iframe>"')).toBe(true);
    expect(refusedJs("box.innerHTML = `<img src=x onerror=go()>`")).toBe(true);
  });

  it("ADR 0009: refuses the ways to hide a call: aliases, computed names and reaching the page's objects", () => {
    for (const js of [
      // Aliases of the page's objects.
      "const w = window; w.location = 'x';",
      "const d = document;",
      "const { body } = document;",
      "send(window);",
      "[window][0].open('x')",
      // Names computed at run time on them.
      'window["loc" + "ation"] = "x"',
      "document[method]('x')",
      "globalThis[key]",
      // Reaching them from an element or a function.
      "el.ownerDocument.write('x')",
      "el.ownerDocument.defaultView.open('x')",
      "frame.contentWindow",
      "function f() { return this; } f().open('x');",
      // Reaching around the names.
      'Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML").set.call(el, html)',
      "Reflect.set(el, 'innerHTML', html)",
      "el.__proto__",
      "with (document) { write('x'); }",
      // An element made from a computed name.
      "document.createElement(tag)",
    ]) {
      expect(refusedJs(js), js).toBe(true);
    }
  });

  it("ADR 0009: follows the page's objects into variables, parameters and containers, and refuses names computed at run time on them", () => {
    for (const js of [
      // Codex's review of #168, F1: a decoded name on an element.
      'const name = atob("aW5uZXJIVE1M"); document.body[name] = "<iframe src=https://leak.example></iframe>";',
      "const box = document.getElementById('box'); box[key] = html;",
      "const box = document.querySelector('#box'); const again = box; again[key] = html;",
      "document.querySelectorAll('li').forEach((li) => { li[key] = html; });",
      "for (const li of document.querySelectorAll('li')) li[key] = html;",
      "const items = Array.from(document.querySelectorAll('li')); items[i][key] = html;",
      "const ui = { box: document.getElementById('box') }; ui.box[key] = html;",
      "const parts = []; parts.push(document.body); parts[0][key] = html;",
      "function paint(target) { target[key] = html; } paint(document.body);",
      "function find() { return document.body; } find()[key] = html;",
      "button.addEventListener('click', (event) => { event.target[key] = html; });",
      "document.addEventListener('click', (event) => { event.view[key] = 'x'; });",
      "const { body } = document;",
      "Object.assign(document.body, { [key]: html });",
      "const copy = { ...document.body };",
      "for (const name in document.body) {}",
      "class Panel { constructor() { this.box = document.body; } paint() { this[key] = html; } }",
      "class Fancy extends HTMLElement {}",
      // An element with an id is a global of that name, so an undeclared name may be one.
      "box[key] = html;",
      "box.addEventListener('click', (event) => { event.target[key] = html; });",
    ]) {
      expect(refusedJs(js), js).toBe(true);
    }
  });

  it("ADR 0009: fails closed when the tracking can't finish (Codex's loop, longer than its round limit)", () => {
    // At run time the loop carries document.body back to p0; each round of the tracking moves it
    // one step, so a chain longer than its limit must make it refuse, never accept.
    const names = Array.from({ length: 80 }, (_, i) => `p${i}`);
    const js = [
      `let ${names.join(",")};`,
      "for (let turn = 0; turn < 80; turn++) {",
      names
        .slice(0, -1)
        .map((name, i) => `${name}=p${i + 1};`)
        .join(""),
      "p79 = document.body;",
      "}",
      'p0[atob("aW5uZXJIVE1M")] = "<iframe src=https://leak.example></iframe>";',
    ].join("\n");
    expect(refusedJs(js)).toBe(true);
  });

  it("ADR 0009: refuses aliases of the page's methods and qualified forbidden APIs (Codex, F2)", () => {
    for (const js of [
      'const d = window.document; const make = d.createElement.bind(d); const frame = make("iframe"); frame.src = "https://leak.example"; document.body.append(frame);',
      "const make = document.createElement; make('iframe');",
      "document.createElement.call(document, 'iframe');",
      "el.setAttribute.apply(el, ['onclick', code]);",
      'const doc = new window.DOMParser().parseFromString(atob("PGlmcmFtZT48L2lmcmFtZT4="), "text/html");',
      "window.eval(code)",
      "new self.Function(code)",
      "window.Reflect.set(el, 'innerHTML', html)",
      "const attr = document.createAttribute('onclick'); el.setAttributeNode(attr);",
      "el.getRootNode().write('x')",
    ]) {
      expect(refusedJs(js), js).toBe(true);
    }
  });

  it("SBX-07: refuses writing an address, directly or in parts (Codex, F3)", () => {
    for (const js of [
      'const a = document.getElementById("go"); a.href = "https://leak.example"; a.click();',
      "link.hostname = 'leak.example';",
      "link.host += '.example';",
      "link.protocol = 'https:';",
      "({ href: link.href } = values);",
      "form.action = 'https://leak.example';",
      "button.formAction = 'https://leak.example';",
    ]) {
      expect(refusedJs(js), js).toBe(true);
    }
    // Together with the accepted HTML: the pair is refused, through its JavaScript.
    const pair = staticCheck(
      {
        html: '<a id="go">Go</a>',
        css: "",
        js: 'const a = document.getElementById("go"); a.href = "https://leak.example"; a.click();',
      },
      [],
    );
    expect(pair.ok).toBe(false);
  });

  it("ADR 0009: knows where `this` is the page, even inside a class (Codex, F4)", () => {
    for (const js of [
      'class C { [this["loc" + "ation"] = "https://leak.example"]() {} }',
      "class C { [this.open]() {} }",
      "class C { m() { return function () { return this; }; } }",
      "const o = { m() { return this; } };",
      "function f() { return this; }",
    ]) {
      expect(refusedJs(js), js).toBe(true);
    }
    expect(
      checkJs(
        "class C { constructor() { this.n = 1; } m() { const f = () => this.n; return f(); } static s = 1; }",
      ),
    ).toEqual([]);
  });

  it("VER-01: ordinary code passes: names written out, events, text, and `this` in a class", () => {
    expect(
      checkJs(`
        const list = document.getElementById("list");
        window.addEventListener("resize", () => draw());
        const item = document.createElement("li");
        item.textContent = \`\${name} (\${count})\`;
        item.setAttribute("aria-label", "Remove " + name);
        list.append(item);
        const totals = {};
        totals[name] = (totals[name] ?? 0) + 1;
        const rows = [];
        rows[index].done = true;
        async function load(i, field, key, save) {
          const records = (await tessera.call("data.read")).data.items;
          const input = document.getElementById("field");
          records[i][field] = input.value;
          const item = document.createElement("li");
          item.dataset[key] = "1";
          const form = document.getElementById("add");
          const text = form.item.value.trim();
          save([{ title: text, count: Number(input.value) }]);
        }
        class Timer { start() { this.at = Date.now(); } }
        setTimeout(() => draw(), 100);
        const url = URL.createObjectURL(blob);
        img.src = url;
      `),
    ).toEqual([]);
  });

  it("VER-01: what comes back from the bridge is plain data, as in a live tool (slice pilot, #173)", () => {
    // From the pilot's shopping list: revisions read through the bridge, indexed by a record's id,
    // with page values passed to the bridge alongside.
    expect(
      checkJs(`
        let items = []; let revs = {};
        const input = document.getElementById("item");
        async function load() {
          const r = await tessera.call("data.read", {});
          items = r.data.items || [];
          revs = (r.revisions && r.revisions.items) || {};
        }
        async function setDone(id, val) {
          await tessera.call("data.patch", { operations: [{ op: "replace", collection: "items", id, revisionCount: revs[id], fields: { done: val } }] });
          input.focus();
        }
        document.getElementById("list").addEventListener("change", (event) => setDone(event.target.id, event.target));
      `),
    ).toEqual([]);
  });

  it("ADR 0009: a tool can't declare its own tessera to pass the page off as bridge data", () => {
    for (const js of [
      "const tessera = document; tessera.body[key] = html;",
      "function f(tessera) { return tessera.call[key]; }",
      "let { tessera } = window;",
      // Only the bridge's own calls give plain data; nothing hung on them does (Codex, #174).
      'tessera.call.pick = document.body.querySelector.bind(document.body); const el = tessera.call.pick("div"); el[atob("aW5uZXJIVE1M")] = "x";',
      "tessera.call.pick = pick;",
      "tessera.extra = document.body;",
    ]) {
      expect(refusedJs(js), js).toBe(true);
    }
  });

  it("VER-01: code that can't be parsed is a finding, not a crash", () => {
    expect(checkJs("function (")).toEqual([
      { part: "js", message: expect.stringMatching(/^The JavaScript can't be read: /) as unknown },
    ]);
  });
});

describe("bridge static checks (VER-01, CAP-01)", () => {
  const fixtures = JSON.parse(
    fs.readFileSync(new URL("./fixtures/static-bridge.json", import.meta.url), "utf8"),
  ) as { passing: string[]; failing: string[] };
  it("VER-01: direct declared API and unrelated local objects pass", () => {
    for (const js of fixtures.passing) expect(checkJs(js, ["clock"]), js).toEqual([]);
  });
  it("VER-01: unknown methods/actions and hidden bridge access fail closed", () => {
    for (const js of fixtures.failing) {
      const findings = checkJs(js, ["clock"]);
      expect(findings.length, js).toBeGreaterThan(0);
      expect(
        findings.every((f) => f.message.length > 30),
        js,
      ).toBe(true);
    }
  });
  it("VER-01, CAP-01: the actual artifact capabilities decide whether an action passes", () => {
    const code = { html: "<p>Clock</p>", css: "", js: "\ntessera.call('clock.now');" };
    expect(staticCheck(code, [])).toMatchObject({
      ok: false,
      findings: [{ part: "js", line: 2, message: expect.stringContaining('"clock" capability') }],
    });
    expect(staticCheck(code, ["clock"])).toEqual({ ok: true });
  });
});

describe("real tools (VER-01)", () => {
  it("VER-01: the prompt fixture's shopping list and every development sample pass", async () => {
    const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "prompts");
    const part = (name: string) =>
      fs.readFileSync(path.join(fixtures, `shopping-list.${name}.txt`), "utf8");
    expect(staticCheck({ html: part("html"), css: part("css"), js: part("js") }, [])).toEqual({
      ok: true,
    });

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-static-check-"));
    temps.push(dir);
    const folder = await openDataFolder(dir);
    try {
      seedSamples(folder);
      const workspaces = listWorkspaces(folder);
      expect(workspaces.length).toBeGreaterThan(0);
      for (const workspace of workspaces) {
        // A sample workspace without a tool has nothing to check.
        if (!workspace.currentVersion) continue;
        const version = loadVersion(folder.db, workspace.currentVersion);
        if (version?.kind !== "ok") throw new Error(`${workspace.title} has no readable version`);
        expect(
          staticCheck(version.artifact.code, version.artifact.capabilities),
          workspace.title,
        ).toEqual({ ok: true });
      }
    } finally {
      folder.close();
    }
  });

  it("VER-01: a tool with problems in both parts gets every finding", () => {
    const result = staticCheck(
      {
        html: '<iframe src="x"></iframe>',
        css: "",
        js: 'location.href = "x"',
      },
      [],
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && [...new Set(result.findings.map((f) => f.part))]).toEqual(["html", "js"]);
  });
});
