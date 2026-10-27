import type { Artifact } from "@tessera/contracts";
import { checkJs as checkScript } from "./js-check.ts";
import { parse as parseDocument, parseFragment, type DefaultTreeAdapterMap } from "parse5";

// The static check (VER-01): every candidate's code, and every imported tool's, is read with real
// parsers before it can run. This first part keeps a tool from leaving its sandbox the one way the
// sandbox can't stop (ADR 0009): no frames, no navigation, no HTML or code made at run time, and
// no names built at run time on the objects that lead there. The tool's policy forbids eval and
// allows inline scripts, so a script or handler built from text is the way around a check that
// only reads the source; refusing them is what makes reading the source enough.

export type StaticFinding = {
  /** Where it is: the tool's HTML or its JavaScript. */
  part: "html" | "js";
  /** The line it is on, when known. */
  line?: number;
  /** What is wrong and what to do instead, for repair (GEN-09). */
  message: string;
};

export type StaticCheckResult = { ok: true } | { ok: false; findings: StaticFinding[] };

/** Elements that load other content or run code; a tool has no use for any of them. */
const FORBIDDEN_ELEMENTS = new Set([
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "script",
  "base",
  "portal",
  "fencedframe",
]);
/** Elements that navigate when given an address. */
const LINK_ELEMENTS = new Set(["a", "area"]);
/** Attributes that navigate, load or run something, whatever the element. */
const FORBIDDEN_ATTRIBUTES = new Set([
  "srcdoc",
  "action",
  "formaction",
  "http-equiv",
  "ping",
  "xlink:href",
]);

/** Checks a tool's code; findings say what to change, for repair (GEN-09). */
export function staticCheck(code: Artifact["code"]): StaticCheckResult {
  const findings = [...checkHtml(code.html), ...checkJs(code.js)];
  return findings.length === 0 ? { ok: true } : { ok: false, findings };
}

type HtmlNode = {
  nodeName: string;
  tagName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: HtmlNode[];
  content?: HtmlNode;
  sourceCodeLocation?: { startLine: number } | null;
};

/** HTML findings, parsed as the browser parses the body (parse5 follows the HTML standard). */
export function checkHtml(html: string): StaticFinding[] {
  const findings: StaticFinding[] = [];
  const found = (node: HtmlNode, message: string) =>
    findings.push({ part: "html", line: node.sourceCodeLocation?.startLine, message });
  const visit = (node: HtmlNode) => {
    const tag = node.tagName?.toLowerCase();
    if (tag !== undefined) {
      if (FORBIDDEN_ELEMENTS.has(tag)) {
        found(
          node,
          `The HTML has a <${tag}> element. A tool has no frames, embedded objects or script tags: put the code in the JavaScript.`,
        );
      }
      for (const { name, value } of node.attrs ?? []) {
        const attribute = name.toLowerCase();
        if (attribute.startsWith("on")) {
          found(
            node,
            `The <${tag}> element has an ${attribute} attribute. Listen with addEventListener in the JavaScript instead.`,
          );
        } else if (FORBIDDEN_ATTRIBUTES.has(attribute)) {
          found(node, `The <${tag}> element has a ${attribute} attribute, which a tool can't use.`);
        } else if (attribute === "href" && LINK_ELEMENTS.has(tag) && !isLocalLink(value)) {
          found(
            node,
            `The <${tag}> element links to "${value}". A tool can't open other pages; links may only point inside the tool (#…).`,
          );
        }
      }
      if (tag === "meta") found(node, "The HTML has a <meta> element, which a tool can't use.");
    }
    for (const child of node.childNodes ?? []) visit(child);
    if (node.content) visit(node.content);
  };
  // Parsed in a body, where the tool's HTML goes: what the parser drops there makes no element.
  visit(parseFragment(bodyContext(), html, { sourceCodeLocationInfo: true }));
  return findings;
}

/** A <body> element: the context the browser parses the tool's HTML in. */
function bodyContext() {
  const [html] = parseDocument("").childNodes as { childNodes: unknown[] }[];
  return html!.childNodes[1] as DefaultTreeAdapterMap["element"];
}

const isLocalLink = (href: string) => href.trim() === "" || href.trim().startsWith("#");

/** JavaScript findings: see js-check.ts. Fixed HTML the script writes is checked as HTML is. */
export function checkJs(js: string): StaticFinding[] {
  return checkScript(js, checkHtml).map((finding) => ({ part: "js", ...finding }));
}
