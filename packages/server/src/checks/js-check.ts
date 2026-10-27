import { parse, type Node as JsNode } from "acorn";

// The static check's JavaScript rules (VER-01, ADR 0009). A tool may not navigate, make frames or
// scripts, or write HTML or code at run time; and since JavaScript can reach a property by a name
// made at run time, the check follows which values may be the page or one of its elements, and
// refuses a name made at run time on any of them. Plain data (a record, a list, a map of totals)
// keeps its ordinary indexing. Over-approximating is the safe direction: a value that might be
// the page is treated as the page.

export type JsFinding = { line?: number; message: string };

type AnyNode = JsNode & Record<string, unknown>;

/** The page's own objects, which lead to navigation and to writing HTML. */
const PAGE_GLOBALS = new Set([
  "window",
  "self",
  "globalThis",
  "document",
  "top",
  "parent",
  "frames",
  "opener",
]);
/** Globals a tool may not use at all. */
const FORBIDDEN_GLOBALS = new Set([
  "eval",
  "Function",
  "DOMParser",
  "XMLSerializer",
  "Reflect",
  "location",
  "history",
  "navigation",
  "open",
  "importScripts",
  "customElements",
]);
/** Names a tool may not use on any object: they navigate, reach the page, or reach around these rules. */
const FORBIDDEN_NAMES = new Set([
  "location",
  "history",
  "navigation",
  "ownerDocument",
  "defaultView",
  "contentWindow",
  "contentDocument",
  "implementation",
  "getRootNode",
  "prototype",
  "__proto__",
  "__defineSetter__",
  "__defineGetter__",
  "__lookupSetter__",
  "__lookupGetter__",
  "eval",
  "Function",
  "DOMParser",
  "XMLSerializer",
  "Reflect",
  "createAttribute",
  "createAttributeNS",
  "setAttributeNode",
  "setAttributeNodeNS",
  "write",
  "writeln",
  "srcdoc",
  "setHTMLUnsafe",
  "parseHTMLUnsafe",
  "createContextualFragment",
]);
/** Names that navigate when written: an address or a part of one. */
const ADDRESS_NAMES = new Set([
  "href",
  "host",
  "hostname",
  "protocol",
  "port",
  "pathname",
  "search",
  "username",
  "password",
  "action",
  "formAction",
]);
/** Methods that take an element or attribute name: only called directly, with the name written out. */
const NAMED_METHODS = new Set([
  "createElement",
  "createElementNS",
  "setAttribute",
  "setAttributeNS",
  "toggleAttribute",
]);
/** HTML writers that may take fixed text the check can read. */
const FIXED_HTML_WRITERS = new Set(["innerHTML", "outerHTML", "insertAdjacentHTML"]);
/** Object's methods that read or copy what any object holds, the page's objects included. */
const REFLECTING = new Set([
  "assign",
  "keys",
  "values",
  "entries",
  "getOwnPropertyNames",
  "fromEntries",
]);
const FORBIDDEN_OBJECT_METHODS = new Set([
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "defineProperty",
  "defineProperties",
  "getPrototypeOf",
  "setPrototypeOf",
]);
/** Elements that load content or run code, and links: never created from JavaScript. */
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
  "meta",
  "a",
  "area",
]);
const FORBIDDEN_ATTRIBUTES = new Set([
  "href",
  "srcdoc",
  "action",
  "formaction",
  "http-equiv",
  "ping",
  "xlink:href",
]);
/**
 * Properties of the page's objects that only ever hold text, numbers, flags or plain values, never
 * an element or the page: reading one leaves the page behind. (dataset holds only strings.)
 */
const PLAIN_PROPERTIES = new Set([
  "value",
  "checked",
  "textContent",
  "innerText",
  "nodeValue",
  "id",
  "className",
  "tagName",
  "nodeName",
  "length",
  "valueAsNumber",
  "valueAsDate",
  "selectedIndex",
  "disabled",
  "hidden",
  "title",
  "name",
  "type",
  "placeholder",
  "scrollTop",
  "scrollLeft",
  "scrollWidth",
  "scrollHeight",
  "clientWidth",
  "clientHeight",
  "offsetWidth",
  "offsetHeight",
  "offsetTop",
  "offsetLeft",
  "width",
  "height",
  "key",
  "code",
  "clientX",
  "clientY",
  "offsetX",
  "offsetY",
  "pageX",
  "pageY",
  "deltaX",
  "deltaY",
  "button",
  "buttons",
  "shiftKey",
  "ctrlKey",
  "altKey",
  "metaKey",
  "repeat",
  "dataset",
  "selectionStart",
  "selectionEnd",
  "min",
  "max",
  "step",
  "innerWidth",
  "innerHeight",
  "devicePixelRatio",
  "timeStamp",
  "isComposing",
  "inputType",
  "data",
  "files",
]);
/** Methods of the page's objects that give back only plain values. */
const PLAIN_METHODS = new Set([
  "getAttribute",
  "hasAttribute",
  "getBoundingClientRect",
  "contains",
  "matches",
  "checkValidity",
  "reportValidity",
  "toString",
  "preventDefault",
  "stopPropagation",
  "addEventListener",
  "removeEventListener",
  "focus",
  "blur",
  "click",
  "remove",
  "append",
  "prepend",
  "replaceChildren",
  "appendChild",
  "removeChild",
  "setAttribute",
  "removeAttribute",
  "toggleAttribute",
  "scrollIntoView",
  "select",
  "reset",
  "requestSubmit",
  "showModal",
  "close",
]);

/**
 * The language's and the browser's own names that aren't the page: any other name the script uses
 * without declaring it may be an element, since an element with an id is a global of that name.
 */
const BUILT_INS = new Set([
  "Array",
  "ArrayBuffer",
  "BigInt",
  "Boolean",
  "DataView",
  "Date",
  "Error",
  "EvalError",
  "Float32Array",
  "Float64Array",
  "Infinity",
  "Int8Array",
  "Int16Array",
  "Int32Array",
  "Intl",
  "JSON",
  "Map",
  "Math",
  "NaN",
  "Number",
  "Object",
  "Promise",
  "Proxy",
  "RangeError",
  "ReferenceError",
  "RegExp",
  "Set",
  "String",
  "Symbol",
  "SyntaxError",
  "TypeError",
  "URIError",
  "Uint8Array",
  "Uint8ClampedArray",
  "Uint16Array",
  "Uint32Array",
  "WeakMap",
  "WeakSet",
  "WeakRef",
  "AggregateError",
  "undefined",
  "isFinite",
  "isNaN",
  "parseFloat",
  "parseInt",
  "decodeURI",
  "decodeURIComponent",
  "encodeURI",
  "encodeURIComponent",
  "console",
  "tessera",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "queueMicrotask",
  "structuredClone",
  "atob",
  "btoa",
  "URL",
  "URLSearchParams",
  "Blob",
  "File",
  "FileReader",
  "TextEncoder",
  "TextDecoder",
  "crypto",
  "performance",
  "AbortController",
  "AbortSignal",
  "CSS",
  "matchMedia",
  "getComputedStyle",
  "alert",
  "confirm",
  "prompt",
  "arguments",
]);

/** Constructors of the page's objects, whose instances are treated as the page's. */
const PAGE_CONSTRUCTOR =
  /(Element|Event|Observer|Node|Fragment|Range|Document|Window|Image|Audio|Option|Text|Comment|Attr)$/;

const isNode = (value: unknown): value is AnyNode =>
  value !== null &&
  typeof value === "object" &&
  typeof (value as { type?: unknown }).type === "string";

function children(node: AnyNode): AnyNode[] {
  const found: AnyNode[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "start" || key === "end") continue;
    if (Array.isArray(value)) found.push(...value.filter(isNode));
    else if (isNode(value)) found.push(value);
  }
  return found;
}

/** A member's property name when it is written out (a name, or fixed text), else undefined. */
function propertyName(member: AnyNode): string | undefined {
  const property = member["property"] as AnyNode;
  if (!member["computed"]) return property["name"] as string;
  return fixedText(property);
}

/** The text of a string literal, or of a template with nothing interpolated. */
function fixedText(node: AnyNode | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "Literal" && typeof node["value"] === "string") return node["value"];
  if (node.type === "TemplateLiteral" && (node["expressions"] as unknown[]).length === 0) {
    return ((node["quasis"] as AnyNode[])[0]!["value"] as { cooked: string }).cooked;
  }
  return undefined;
}

/** A computed key that can't name a property such as innerHTML: a number. */
const isNumberKey = (node: AnyNode) => node.type === "Literal" && typeof node["value"] === "number";

/** The identifiers a declaration or pattern binds. */
function boundNames(pattern: AnyNode | null | undefined): string[] {
  if (!pattern) return [];
  switch (pattern.type) {
    case "Identifier":
      return [pattern["name"] as string];
    case "ObjectPattern":
      return (pattern["properties"] as AnyNode[]).flatMap((p) =>
        boundNames((p.type === "RestElement" ? p["argument"] : p["value"]) as AnyNode),
      );
    case "ArrayPattern":
      return (pattern["elements"] as (AnyNode | null)[]).flatMap((e) => boundNames(e));
    case "RestElement":
      return boundNames(pattern["argument"] as AnyNode);
    case "AssignmentPattern":
      return boundNames(pattern["left"] as AnyNode);
    default:
      return [];
  }
}

/** The identifier at the root of a member chain (`a` in `a.b[c].d`), if any. */
function rootName(node: AnyNode): string | undefined {
  let current = node;
  while (current.type === "MemberExpression" || current.type === "ChainExpression") {
    current = (
      current.type === "ChainExpression" ? current["expression"] : current["object"]
    ) as AnyNode;
  }
  return current.type === "Identifier" ? (current["name"] as string) : undefined;
}

/**
 * Which names and functions may hold the page or its elements, by name across the whole script:
 * shadowing can only make it refuse more, never less. Repeated until nothing new is found.
 */
class PageValues {
  readonly names = new Set<string>();
  readonly returning = new Set<string>();
  thisIsPage = false;
  /** Set when the tracking gave up: every value may then be the page's. */
  everything = false;
  private readonly functions = new Map<string, AnyNode>();

  private readonly program: AnyNode;
  /** Every name the script declares, anywhere. */
  readonly declared = new Set<string>();

  constructor(program: AnyNode) {
    this.program = program;
    this.visit(program, (node) => {
      const declare = (names: string[]) => names.forEach((name) => this.declared.add(name));
      switch (node.type) {
        case "VariableDeclarator":
          declare(boundNames(node["id"] as AnyNode));
          break;
        case "FunctionDeclaration":
        case "FunctionExpression":
        case "ArrowFunctionExpression":
          if (node["id"]) declare(boundNames(node["id"] as AnyNode));
          declare((node["params"] as AnyNode[]).flatMap((p) => boundNames(p)));
          break;
        case "ClassDeclaration":
        case "ClassExpression":
          if (node["id"]) declare(boundNames(node["id"] as AnyNode));
          break;
        case "CatchClause":
          declare(boundNames(node["param"] as AnyNode));
          break;
      }
      if (node.type === "FunctionDeclaration" && node["id"]) {
        this.functions.set((node["id"] as AnyNode)["name"] as string, node);
      }
      if (node.type === "VariableDeclarator" && isFunction(node["init"] as AnyNode)) {
        for (const name of boundNames(node["id"] as AnyNode)) {
          this.functions.set(name, node["init"] as AnyNode);
        }
      }
    });
    let rounds = 0;
    while (this.round()) {
      // Still finding more after many rounds: fail closed, treating every value as the page's.
      if (++rounds >= 50) {
        this.everything = true;
        break;
      }
    }
  }

  /** Whether an expression may be the page or one of its elements. */
  isPage(node: AnyNode | null | undefined): boolean {
    if (!node) return false;
    if (this.everything) return true;
    switch (node.type) {
      case "Identifier": {
        const name = node["name"] as string;
        return (
          PAGE_GLOBALS.has(name) ||
          this.names.has(name) ||
          // Not declared and not built in: it may be an element, by its id.
          (!this.declared.has(name) && !BUILT_INS.has(name))
        );
      }
      case "ThisExpression":
        return this.thisIsPage;
      case "MemberExpression": {
        const name = propertyName(node);
        if (name !== undefined && !node["computed"] && PLAIN_PROPERTIES.has(name)) return false;
        return this.isPage(node["object"] as AnyNode);
      }
      case "ChainExpression":
      case "ParenthesizedExpression":
      case "AwaitExpression":
      case "SpreadElement":
        return this.isPage((node["expression"] ?? node["argument"]) as AnyNode);
      case "ConditionalExpression":
        return (
          this.isPage(node["consequent"] as AnyNode) || this.isPage(node["alternate"] as AnyNode)
        );
      case "LogicalExpression":
        return this.isPage(node["left"] as AnyNode) || this.isPage(node["right"] as AnyNode);
      case "SequenceExpression":
        return this.isPage((node["expressions"] as AnyNode[]).at(-1));
      case "AssignmentExpression":
        return this.isPage(node["right"] as AnyNode);
      case "ArrayExpression":
        return (node["elements"] as (AnyNode | null)[]).some((e) => this.isPage(e));
      case "ObjectExpression":
        return (node["properties"] as AnyNode[]).some((p) =>
          this.isPage((p.type === "SpreadElement" ? p["argument"] : p["value"]) as AnyNode),
        );
      case "NewExpression": {
        const callee = node["callee"] as AnyNode;
        return (
          (callee.type === "Identifier" && PAGE_CONSTRUCTOR.test(callee["name"] as string)) ||
          this.isPage(callee)
        );
      }
      case "CallExpression": {
        const callee = node["callee"] as AnyNode;
        const args = node["arguments"] as AnyNode[];
        // What crosses the bridge is copied as plain data; the page's objects can't cross it.
        if (isBridgeCall(callee)) return false;
        if (callee.type === "Identifier") return this.returning.has(callee["name"] as string);
        if (callee.type === "MemberExpression") {
          const method = propertyName(callee);
          if (method !== undefined && PLAIN_METHODS.has(method)) return false;
          // A method of the page's objects, or a helper such as Array.from given them.
          return this.isPage(callee["object"] as AnyNode) || args.some((a) => this.isPage(a));
        }
        return args.some((a) => this.isPage(a));
      }
      default:
        return false;
    }
  }

  /** One pass; true if it found something new. */
  private round(): boolean {
    const before = this.names.size + this.returning.size + (this.thisIsPage ? 1 : 0);
    const mark = (names: string[]) => names.forEach((name) => this.names.add(name));
    const markParams = (fn: AnyNode | undefined) => {
      if (fn && isFunction(fn)) mark((fn["params"] as AnyNode[]).flatMap((p) => boundNames(p)));
    };
    this.visit(this.program, (node) => {
      switch (node.type) {
        case "VariableDeclarator":
          if (this.isPage(node["init"] as AnyNode)) mark(boundNames(node["id"] as AnyNode));
          break;
        case "AssignmentExpression": {
          if (!this.isPage(node["right"] as AnyNode)) break;
          const left = node["left"] as AnyNode;
          if (left.type === "MemberExpression") {
            if ((left["object"] as AnyNode).type === "ThisExpression") this.thisIsPage = true;
            const root = rootName(left);
            if (root) this.names.add(root);
          } else {
            mark(boundNames(left));
          }
          break;
        }
        case "ForOfStatement":
        case "ForInStatement": {
          if (!this.isPage(node["right"] as AnyNode)) break;
          const left = node["left"] as AnyNode;
          mark(
            left.type === "VariableDeclaration"
              ? (left["declarations"] as AnyNode[]).flatMap((d) => boundNames(d["id"] as AnyNode))
              : boundNames(left),
          );
          break;
        }
        case "CallExpression":
        case "NewExpression": {
          const callee = node["callee"] as AnyNode;
          const args = node["arguments"] as AnyNode[];
          // Callbacks given to the page's objects (events, observers, forEach over elements)
          // get the page's objects.
          if (
            this.isPage(callee) ||
            (callee.type === "MemberExpression" && this.isPage(callee["object"] as AnyNode)) ||
            (node.type === "NewExpression" &&
              callee.type === "Identifier" &&
              PAGE_CONSTRUCTOR.test(callee["name"] as string))
          ) {
            args.forEach(markParams);
          }
          if (args.some((a) => this.isPage(a))) {
            // A function called with the page's objects receives them.
            if (callee.type === "Identifier")
              markParams(this.functions.get(callee["name"] as string));
            // A container given them (list.push(el), map.set(k, el)) holds them.
            // The bridge copies what it is given, so it never holds the page's objects.
            const root = callee.type === "MemberExpression" ? rootName(callee) : undefined;
            if (root && !isBridgeCall(callee)) this.names.add(root);
          }
          break;
        }
        case "ClassDeclaration":
        case "ClassExpression": {
          const superClass = node["superClass"] as AnyNode | null;
          if (superClass && this.isPage(superClass)) this.thisIsPage = true;
          break;
        }
      }
    });
    // A function that returns the page's objects makes its calls the page's.
    for (const [name, fn] of this.functions) {
      const body = fn["body"] as AnyNode;
      const returns =
        body.type !== "BlockStatement"
          ? this.isPage(body)
          : this.anyReturn(body, (argument) => this.isPage(argument));
      if (returns) this.returning.add(name);
    }
    return this.names.size + this.returning.size + (this.thisIsPage ? 1 : 0) !== before;
  }

  private anyReturn(body: AnyNode, test: (argument: AnyNode) => boolean): boolean {
    let found = false;
    this.visit(
      body,
      (node) => {
        if (node.type === "ReturnStatement" && test(node["argument"] as AnyNode)) found = true;
      },
      true,
    );
    return found;
  }

  /** Visits every node; `ownBody` stops at nested functions, whose returns are their own. */
  private visit(node: AnyNode, see: (node: AnyNode) => void, ownBody = false) {
    see(node);
    for (const child of children(node)) {
      if (ownBody && isFunction(child)) continue;
      this.visit(child, see, ownBody);
    }
  }
}

/**
 * A call of the bridge itself, `tessera.call`, `tessera.send` or `tessera.assetUrl`, with the
 * name written out: only these copy what they are given and give back plain data. Anything else
 * reached through `tessera` is no different from any other value.
 */
const BRIDGE_METHODS = new Set(["call", "send", "assetUrl"]);
function isBridgeCall(callee: AnyNode): boolean {
  if (callee.type !== "MemberExpression" || callee["computed"]) return false;
  const object = callee["object"] as AnyNode;
  return (
    object.type === "Identifier" &&
    object["name"] === "tessera" &&
    BRIDGE_METHODS.has((callee["property"] as AnyNode)["name"] as string)
  );
}

function isFunction(node: AnyNode | null | undefined): boolean {
  return (
    !!node &&
    (node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression" ||
      node.type === "FunctionDeclaration")
  );
}

/** Whether `node` is written to: an assignment's target, updated, or a pattern's target. */
function isWritten(node: AnyNode, parent: AnyNode | null): boolean {
  if (!parent) return false;
  switch (parent.type) {
    case "AssignmentExpression":
      return parent["left"] === node;
    case "UpdateExpression":
      return true;
    case "AssignmentPattern":
      return parent["left"] === node;
    case "ArrayPattern":
    case "RestElement":
      return true;
    case "ForOfStatement":
    case "ForInStatement":
      return parent["left"] === node;
    default:
      return false;
  }
}

/** JavaScript findings, from acorn's syntax tree of the tool's script. */
export function checkJs(
  js: string,
  checkHtml: (html: string) => { message: string }[],
): JsFinding[] {
  let program: AnyNode;
  try {
    program = parse(js, {
      ecmaVersion: "latest",
      sourceType: "script",
      locations: true,
    }) as unknown as AnyNode;
  } catch (error) {
    return [{ message: `The JavaScript can't be read: ${(error as Error).message}.` }];
  }
  const page = new PageValues(program);
  const findings: JsFinding[] = [];
  // The bridge's values count as plain data only because `tessera` is the host's: a tool may not
  // declare a name of its own that hides it.
  if (page.declared.has("tessera")) {
    findings.push({
      message:
        "The JavaScript declares its own tessera, which hides the host's. Choose another name.",
    });
  }
  const found = (node: AnyNode, message: string) =>
    findings.push({
      line: (node.loc as { start: { line: number } } | undefined)?.start.line,
      message,
    });

  /**
   * `thisIs`: what `this` is where the node runs: "instance" inside a class's methods and fields,
   * where it is the object; "page" elsewhere, where it can be the page itself.
   */
  const walk = (node: AnyNode, parent: AnyNode | null, thisIs: "instance" | "page") => {
    check(node, parent, thisIs);
    for (const child of children(node)) {
      walk(child, node, thisInside(node, child, thisIs));
    }
  };

  const thisInside = (node: AnyNode, child: AnyNode, thisIs: "instance" | "page") => {
    // A class's computed keys and its superclass run where the class is defined.
    if (
      (node.type === "MethodDefinition" || node.type === "PropertyDefinition") &&
      node["key"] === child
    ) {
      return thisIs;
    }
    if (
      (node.type === "MethodDefinition" ||
        node.type === "PropertyDefinition" ||
        node.type === "StaticBlock") &&
      node["key"] !== child
    ) {
      return "instance";
    }
    // Any other function that isn't an arrow has a `this` of its own, which can be the page.
    if (child.type === "FunctionExpression" || child.type === "FunctionDeclaration") {
      return node.type === "MethodDefinition" ? "instance" : "page";
    }
    return thisIs;
  };

  const check = (node: AnyNode, parent: AnyNode | null, thisIs: "instance" | "page") => {
    switch (node.type) {
      case "Identifier":
        checkIdentifier(node, parent);
        break;
      case "ThisExpression":
        if (thisIs === "page") {
          found(
            node,
            "The JavaScript uses `this` outside a class's methods, where it can be the page itself. Name what you mean instead.",
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
        checkMember(node, parent);
        break;
      case "CallExpression":
      case "NewExpression":
        checkCall(node);
        break;
      case "ForInStatement":
        if (page.isPage(node["right"] as AnyNode)) {
          found(
            node,
            "The JavaScript lists the properties of an element or the page with for…in. Name the properties you need.",
          );
        }
        break;
      case "ObjectExpression":
        for (const property of node["properties"] as AnyNode[]) {
          if (property.type === "SpreadElement" && page.isPage(property["argument"] as AnyNode)) {
            found(
              property,
              "The JavaScript copies an element or the page with `...`. Name the properties you need.",
            );
          }
        }
        break;
      case "ObjectPattern":
        for (const property of node["properties"] as AnyNode[]) {
          const key = property["key"] as AnyNode | undefined;
          const name =
            key && !property["computed"] ? ((key["name"] ?? key["value"]) as string) : undefined;
          const target = property["value"] as AnyNode | undefined;
          if (property["computed"]) {
            found(
              property,
              "The JavaScript takes a property out by a name computed at run time. Write the name out.",
            );
          } else if (name !== undefined && FORBIDDEN_NAMES.has(name)) {
            found(property, `The JavaScript takes out ${name}, which a tool can't use.`);
          } else if (
            target?.type === "MemberExpression" &&
            ADDRESS_NAMES.has(propertyName(target) ?? "")
          ) {
            // ({ href: link.href } = values) writes link.href.
            found(
              property,
              `The JavaScript sets .${propertyName(target)!}, which could send the tool to another page. A tool can't navigate.`,
            );
          }
        }
        break;
      case "ClassDeclaration":
      case "ClassExpression": {
        const superClass = node["superClass"] as AnyNode | null;
        if (
          superClass &&
          (page.isPage(superClass) ||
            (superClass.type === "Identifier" &&
              PAGE_CONSTRUCTOR.test(superClass["name"] as string)))
        ) {
          found(
            node,
            "The JavaScript defines a class that extends one of the page's own. A tool's classes hold its own logic.",
          );
        }
        break;
      }
    }
  };

  const checkIdentifier = (node: AnyNode, parent: AnyNode | null) => {
    const name = node["name"] as string;
    if (parent && isNameNotReference(node, parent)) return;
    if (FORBIDDEN_GLOBALS.has(name)) {
      found(node, `The JavaScript uses ${name}, which a tool can't use.`);
      return;
    }
    if (!PAGE_GLOBALS.has(name)) return;
    const usedAsObject =
      parent?.type === "MemberExpression" && parent["object"] === node && !parent["computed"];
    if (!usedAsObject) {
      found(
        node,
        `The JavaScript uses ${name} other than to reach one of its properties by name. Write ${name}.something directly; don't store or pass ${name}.`,
      );
    }
  };

  const checkMember = (node: AnyNode, parent: AnyNode | null) => {
    const name = propertyName(node);
    const object = node["object"] as AnyNode;
    if (name === undefined) {
      const key = node["property"] as AnyNode;
      if (!isNumberKey(key) && page.isPage(object)) {
        found(
          node,
          "The JavaScript reaches a property of an element or the page by a name computed at run time. Write the name out.",
        );
      }
      return;
    }
    if (FORBIDDEN_NAMES.has(name)) {
      found(node, `The JavaScript uses .${name}, which a tool can't use.`);
      return;
    }
    if (rootName(node) === "tessera" && isWritten(node, parent)) {
      found(node, "The JavaScript changes tessera, the host's bridge. Leave it as it is.");
      return;
    }
    if (ADDRESS_NAMES.has(name) && isWritten(node, parent)) {
      found(
        node,
        `The JavaScript sets .${name}, which could send the tool to another page. A tool can't navigate.`,
      );
      return;
    }
    if (
      NAMED_METHODS.has(name) &&
      !(
        parent &&
        (parent.type === "CallExpression" || parent.type === "NewExpression") &&
        parent["callee"] === node
      )
    ) {
      found(
        node,
        `The JavaScript uses ${name} other than by calling it. Call ${name} directly, with the name written out.`,
      );
      return;
    }
    if (FIXED_HTML_WRITERS.has(name)) {
      checkHtmlWriter(node, parent, name);
      return;
    }
    const onPage = object.type === "Identifier" && PAGE_GLOBALS.has(object["name"] as string);
    if (name === "open" && onPage) {
      found(
        node,
        `The JavaScript calls ${object["name"] as string}.open. A tool can't open other pages or windows.`,
      );
    } else if (object.type === "Identifier" && object["name"] === "Object") {
      if (FORBIDDEN_OBJECT_METHODS.has(name)) {
        found(node, `The JavaScript uses Object.${name}, which a tool can't use.`);
      } else if (REFLECTING.has(name) && parent?.type === "CallExpression") {
        const args = parent["arguments"] as AnyNode[];
        if (args.some((a) => page.isPage(a))) {
          found(
            node,
            `The JavaScript uses Object.${name} on an element or the page. Name the properties you need.`,
          );
        }
      }
    }
  };

  const checkHtmlWriter = (node: AnyNode, parent: AnyNode | null, name: string) => {
    let text: string | undefined;
    if (
      parent?.type === "AssignmentExpression" &&
      parent["left"] === node &&
      parent["operator"] === "="
    ) {
      text = fixedText(parent["right"] as AnyNode);
    } else if (parent?.type === "CallExpression" && parent["callee"] === node) {
      const args = parent["arguments"] as AnyNode[];
      text = fixedText(name === "insertAdjacentHTML" ? args[1] : args[0]);
    }
    if (text === undefined) {
      found(
        node,
        `The JavaScript writes HTML with ${name} from something built at run time. Build elements with createElement and set their text with textContent.`,
      );
      return;
    }
    for (const finding of checkHtml(text)) {
      found(node, `The HTML written with ${name}: ${finding.message}`);
    }
  };

  const checkCall = (node: AnyNode) => {
    const callee = node["callee"] as AnyNode;
    const args = node["arguments"] as AnyNode[];
    if (callee.type === "Identifier") {
      if (
        ["setTimeout", "setInterval"].includes(callee["name"] as string) &&
        args[0] &&
        !isFunction(args[0]) &&
        args[0].type !== "Identifier"
      ) {
        found(
          node,
          `The JavaScript passes something other than a function to ${callee["name"] as string}. Pass a function.`,
        );
      }
      return;
    }
    if (callee.type !== "MemberExpression") return;
    const method = propertyName(callee);
    if (method === "createElement" || method === "createElementNS") {
      const name = fixedText(method === "createElementNS" ? args[1] : args[0]);
      if (name === undefined) {
        found(
          node,
          "The JavaScript creates an element whose name is computed at run time. Write the element's name out.",
        );
      } else if (FORBIDDEN_ELEMENTS.has(name.toLowerCase())) {
        found(
          node,
          `The JavaScript creates a <${name}> element. A tool has no frames, embedded objects, script tags or links to other pages; use a button for an action.`,
        );
      }
    } else if (
      method === "setAttribute" ||
      method === "setAttributeNS" ||
      method === "toggleAttribute"
    ) {
      const name = fixedText(method === "setAttributeNS" ? args[1] : args[0])?.toLowerCase();
      if (name === undefined) {
        found(
          node,
          "The JavaScript sets an attribute whose name is computed at run time. Write the attribute's name out.",
        );
      } else if (name.startsWith("on")) {
        found(
          node,
          `The JavaScript sets an ${name} attribute. Listen with addEventListener instead.`,
        );
      } else if (FORBIDDEN_ATTRIBUTES.has(name)) {
        found(node, `The JavaScript sets a ${name} attribute, which a tool can't use.`);
      }
    }
  };

  walk(program, null, "page");
  return findings;
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
