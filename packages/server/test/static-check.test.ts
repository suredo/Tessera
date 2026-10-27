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
        rows[index].done = true;
        class Timer { start() { this.at = Date.now(); } }
        setTimeout(() => draw(), 100);
        const url = URL.createObjectURL(blob);
        img.src = url;
      `),
    ).toEqual([]);
  });

  it("VER-01: code that can't be parsed is a finding, not a crash", () => {
    expect(checkJs("function (")).toEqual([
      { part: "js", message: expect.stringMatching(/^The JavaScript can't be read: /) as unknown },
    ]);
  });
});

describe("real tools (VER-01)", () => {
  it("VER-01: the prompt fixture's shopping list and every development sample pass", async () => {
    const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "prompts");
    const part = (name: string) =>
      fs.readFileSync(path.join(fixtures, `shopping-list.${name}.txt`), "utf8");
    expect(staticCheck({ html: part("html"), css: part("css"), js: part("js") })).toEqual({
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
        expect(staticCheck(version.artifact.code), workspace.title).toEqual({ ok: true });
      }
    } finally {
      folder.close();
    }
  });

  it("VER-01: a tool with problems in both parts gets every finding", () => {
    const result = staticCheck({
      html: '<iframe src="x"></iframe>',
      css: "",
      js: 'location.href = "x"',
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.findings.map((f) => f.part)).toEqual(["html", "js"]);
  });
});
