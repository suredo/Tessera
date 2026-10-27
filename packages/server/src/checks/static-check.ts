import type { Artifact } from "@tessera/contracts";
import { parse, type Node as JsNode } from "acorn";
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

/** The page's own objects, which lead to navigation and to writing HTML. */
const GLOBALS = new Set([
  "window",
  "self",
  "globalThis",
  "document",
  "top",
  "parent",
  "frames",
  "opener",
]);
/** Names that navigate, or reach the page's objects from an element, on any object. */
const FORBIDDEN_NAMES = new Set([
  "location",
  "history",
  "navigation",
  "ownerDocument",
  "defaultView",
  "contentWindow",
  "contentDocument",
  "implementation",
  "prototype",
  "__proto__",
  "__defineSetter__",
  "__defineGetter__",
  "__lookupSetter__",
  "__lookupGetter__",
]);
/** Ways to write HTML, which could carry anything this check refuses. */
const HTML_WRITERS = new Set([
  "innerHTML",
  "outerHTML",
  "insertAdjacentHTML",
  "write",
  "writeln",
  "createContextualFragment",
  "setHTMLUnsafe",
  "parseHTMLUnsafe",
  "srcdoc",
]);
/** Globals that build code or pages from text, or reach around the names above. */
const FORBIDDEN_GLOBALS = new Set([
  "eval",
  "Function",
  "DOMParser",
  "Reflect",
  "location",
  "history",
  "navigation",
  "open",
  "importScripts",
]);
/** Object methods that read or change what a property does, past the names above. */
const FORBIDDEN_OBJECT_METHODS = new Set([
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "defineProperty",
  "defineProperties",
  "getPrototypeOf",
  "setPrototypeOf",
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

type AnyNode = JsNode & Record<string, unknown>;

/** JavaScript findings, from acorn's syntax tree of the tool's script. */
export function checkJs(js: string): StaticFinding[] {
  let program: AnyNode;
  try {
    program = parse(js, {
      ecmaVersion: "latest",
      sourceType: "script",
      locations: true,
    }) as unknown as AnyNode;
  } catch (error) {
    return [
      {
        part: "js",
        message: `The JavaScript can't be read: ${(error as Error).message}.`,
      },
    ];
  }
  const findings: StaticFinding[] = [];
  const found = (node: AnyNode, message: string) =>
    findings.push({
      part: "js",
      line: (node.loc as { start: { line: number } } | undefined)?.start.line,
      message,
    });

  const walk = (node: AnyNode, parent: AnyNode | null, inClass: boolean) => {
    switch (node.type) {
      case "Identifier":
        checkIdentifier(node, parent, found);
        break;
      case "ThisExpression":
        if (!inClass) {
          found(
            node,
            "The JavaScript uses `this` outside a class, where it can be the page itself. Name what you mean instead.",
          );
        }
        break;
      case "WithStatement":
        found(node, "The JavaScript uses `with`, which hides what a name refers to.");
        break;
      case "ImportExpression":
        found(
          node,
          "The JavaScript loads code with import(). A tool's code is all in its own JavaScript.",
        );
        break;
      case "MemberExpression":
        checkMember(node, parent, found);
        break;
      case "CallExpression":
      case "NewExpression":
        checkCall(node, found);
        break;
    }
    const nowInClass = inClass || node.type === "ClassBody";
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (isNode(item)) walk(item, node, nowInClass);
        }
      } else if (isNode(value)) {
        walk(value, node, nowInClass);
      }
    }
  };
  walk(program, null, false);
  return findings;
}

const isNode = (value: unknown): value is AnyNode =>
  value !== null &&
  typeof value === "object" &&
  typeof (value as { type?: unknown }).type === "string";

type Found = (node: AnyNode, message: string) => void;

/** The property name of a member expression when it is written out, or undefined if computed. */
function propertyName(member: AnyNode): string | undefined {
  const property = member["property"] as AnyNode;
  if (!member["computed"]) return property["name"] as string;
  if (property.type === "Literal" && typeof property["value"] === "string") {
    return property["value"];
  }
  if (property.type === "TemplateLiteral" && (property["expressions"] as unknown[]).length === 0) {
    return ((property["quasis"] as AnyNode[])[0]!["value"] as { cooked: string }).cooked;
  }
  return undefined;
}

/**
 * A global name is used only as `window.something` with the name written out: never stored,
 * passed or reached with a computed name, so no alias can carry it past the other rules.
 */
function checkIdentifier(node: AnyNode, parent: AnyNode | null, found: Found) {
  const name = node["name"] as string;
  // A name declared or written as a property or key isn't a reference to the global.
  if (parent && isNameNotReference(node, parent)) return;
  if (FORBIDDEN_GLOBALS.has(name)) {
    found(node, `The JavaScript uses ${name}, which a tool can't use.`);
    return;
  }
  if (!GLOBALS.has(name)) return;
  const usedAsObject =
    parent?.type === "MemberExpression" && parent["object"] === node && !parent["computed"];
  if (!usedAsObject) {
    found(
      node,
      `The JavaScript uses ${name} other than to reach one of its properties by name. Write ${name}.something directly; don't store or pass ${name}.`,
    );
  }
}

function isNameNotReference(node: AnyNode, parent: AnyNode): boolean {
  switch (parent.type) {
    case "MemberExpression":
      return parent["property"] === node && !parent["computed"];
    case "Property":
    case "MethodDefinition":
    case "PropertyDefinition":
      return parent["key"] === node && !parent["computed"] && parent["value"] !== node;
    case "LabeledStatement":
    case "BreakStatement":
    case "ContinueStatement":
      return true;
    default:
      return false;
  }
}

function checkMember(node: AnyNode, parent: AnyNode | null, found: Found) {
  const name = propertyName(node);
  const object = node["object"] as AnyNode;
  const onGlobal = object.type === "Identifier" && GLOBALS.has(object["name"] as string);
  if (name === undefined) {
    if (onGlobal) {
      found(
        node,
        `The JavaScript reaches a property of ${object["name"] as string} by a name computed at run time. Write the name out.`,
      );
    }
    return;
  }
  if (FORBIDDEN_NAMES.has(name)) {
    found(
      node,
      `The JavaScript uses .${name}, which a tool can't use: a tool doesn't navigate or reach the page's objects.`,
    );
  } else if (HTML_WRITERS.has(name)) {
    checkHtmlWriter(node, parent, name, found);
  } else if (name === "open" && onGlobal) {
    found(
      node,
      `The JavaScript calls ${object["name"] as string}.open. A tool can't open other pages or windows.`,
    );
  } else if (
    FORBIDDEN_OBJECT_METHODS.has(name) &&
    object.type === "Identifier" &&
    object["name"] === "Object"
  ) {
    found(node, `The JavaScript uses Object.${name}, which a tool can't use.`);
  }
}

/**
 * Writing HTML is allowed only as fixed text that passes the HTML rules: the content of an
 * `innerHTML = "<li>…</li>"` the check can read. Anything built at run time could hold what the
 * HTML rules refuse; build elements with createElement and set their text with textContent.
 */
function checkHtmlWriter(node: AnyNode, parent: AnyNode | null, name: string, found: Found) {
  const fixed = (value: AnyNode | undefined): string | undefined => {
    if (!value) return undefined;
    if (value.type === "Literal" && typeof value["value"] === "string") return value["value"];
    if (value.type === "TemplateLiteral" && (value["expressions"] as unknown[]).length === 0) {
      return ((value["quasis"] as AnyNode[])[0]!["value"] as { cooked: string }).cooked;
    }
    return undefined;
  };
  let text: string | undefined;
  if (parent?.type === "AssignmentExpression" && parent["left"] === node) {
    text = fixed(parent["right"] as AnyNode);
  } else if (parent?.type === "CallExpression" && parent["callee"] === node) {
    const args = parent["arguments"] as AnyNode[];
    text = fixed(name === "insertAdjacentHTML" ? args[1] : args[0]);
  }
  if (text === undefined || name === "srcdoc" || name === "write" || name === "writeln") {
    found(
      node,
      `The JavaScript writes HTML with ${name} from something built at run time. Build elements with createElement and set their text with textContent.`,
    );
    return;
  }
  for (const finding of checkHtml(text)) {
    found(node, `The HTML written with ${name}: ${finding.message}`);
  }
}

/** createElement and setAttribute: no forbidden element or attribute, and names written out. */
function checkCall(node: AnyNode, found: Found) {
  const callee = node["callee"] as AnyNode;
  if (callee.type !== "MemberExpression") {
    if (
      callee.type === "Identifier" &&
      ["setTimeout", "setInterval"].includes(callee["name"] as string)
    ) {
      const first = (node["arguments"] as AnyNode[])[0];
      if (first && (first.type === "Literal" || first.type === "TemplateLiteral")) {
        found(
          node,
          `The JavaScript passes code as text to ${callee["name"] as string}. Pass a function.`,
        );
      }
    }
    return;
  }
  const method = propertyName(callee);
  const first = (node["arguments"] as AnyNode[])[0];
  if (method === "createElement" || method === "createElementNS") {
    const tag = method === "createElementNS" ? (node["arguments"] as AnyNode[])[1] : first;
    const name =
      tag?.type === "Literal" && typeof tag["value"] === "string" ? tag["value"] : undefined;
    if (name === undefined) {
      found(
        node,
        `The JavaScript creates an element whose name is computed at run time. Write the element's name out.`,
      );
    } else if (FORBIDDEN_ELEMENTS.has(name.toLowerCase()) || name.toLowerCase() === "meta") {
      found(
        node,
        `The JavaScript creates a <${name}> element. A tool has no frames, embedded objects or script tags.`,
      );
    } else if (LINK_ELEMENTS.has(name.toLowerCase())) {
      found(
        node,
        `The JavaScript creates a <${name}> link. A tool can't open other pages; use a button.`,
      );
    }
  } else if (
    method === "setAttribute" ||
    method === "setAttributeNS" ||
    method === "toggleAttribute"
  ) {
    const attribute = method === "setAttributeNS" ? (node["arguments"] as AnyNode[])[1] : first;
    const name =
      attribute?.type === "Literal" && typeof attribute["value"] === "string"
        ? attribute["value"].toLowerCase()
        : undefined;
    if (name === undefined) {
      found(
        node,
        `The JavaScript sets an attribute whose name is computed at run time. Write the attribute's name out.`,
      );
    } else if (name.startsWith("on")) {
      found(
        node,
        `The JavaScript sets an ${name} attribute. Listen with addEventListener instead.`,
      );
    } else if (FORBIDDEN_ATTRIBUTES.has(name) || name === "href") {
      found(node, `The JavaScript sets a ${name} attribute, which a tool can't use.`);
    }
  }
}
