import { parse, type Node as JsNode } from "acorn";
import { analyze } from "eslint-scope";
import {
  BRIDGE_ACTIONS,
  BRIDGE_METHODS,
  type BridgeActionName,
  type BridgeMethodName,
} from "@tessera/contracts";

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
/**
 * Forbidden names refused only on the page's objects, and values that may be them: elsewhere they
 * are plain data. Only `history`, which moves through pages already visited and can't reach an
 * address the tool chooses; `location` and `navigation` can, so they stay refused on any object,
 * since the tracking can lose the page's objects (the check's known gaps).
 */
const NAVIGATING_NAMES = new Set(["history"]);
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
/** The identifiers a declaration or assignment pattern binds. */
function boundIdentifiers(pattern: AnyNode | null | undefined): AnyNode[] {
  if (!pattern) return [];
  switch (pattern.type) {
    case "Identifier":
      return [pattern];
    case "ObjectPattern":
      return (pattern["properties"] as AnyNode[]).flatMap((p) =>
        boundIdentifiers((p.type === "RestElement" ? p["argument"] : p["value"]) as AnyNode),
      );
    case "ArrayPattern":
      return (pattern["elements"] as (AnyNode | null)[]).flatMap((e) => boundIdentifiers(e));
    case "RestElement":
      return boundIdentifiers(pattern["argument"] as AnyNode);
    case "AssignmentPattern":
      return boundIdentifiers(pattern["left"] as AnyNode);
    default:
      return [];
  }
}

/** The identifier a member chain starts from (`a` in `a.b.c`), if it starts from one. */
function rootIdentifier(node: AnyNode): AnyNode | undefined {
  let current = node;
  while (current.type === "MemberExpression" || current.type === "ChainExpression") {
    current = (
      current.type === "ChainExpression" ? current["expression"] : current["object"]
    ) as AnyNode;
  }
  return current.type === "Identifier" ? current : undefined;
}

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
 * What a name in the script refers to: the variable it means, as the scope analysis resolves it,
 * or, for a global, its name. When the script uses `with` or `eval`, whose names can't be read
 * from the code, or the analysis can't run, every name is its own key across the whole script, as
 * before: shadowing can then only make the check refuse more, never less.
 */
type Key = object | string;

class Bindings {
  /** True when names can't be resolved, so each name counts as one across the whole script. */
  readonly byName: boolean;
  private readonly keys = new Map<AnyNode, Key>();
  /**
   * Names the script declares as properties of the global object: a top-level `var` or function.
   * Each is the global of its name, so `var location` is the page's location; but its own
   * declaration hides an element of that id, so it is not taken for one. (A script with a function
   * declared in a block follows names instead.)
   */
  readonly globalDeclared = new Set<string>();

  constructor(program: AnyNode) {
    let manager: ReturnType<typeof analyze> | undefined;
    let dynamic = false;
    visitAll(program, (node) => {
      if (node.type === "WithStatement") dynamic = true;
      if (node.type === "Identifier" && node["name"] === "eval") dynamic = true;
    });
    if (!dynamic) {
      try {
        manager = analyze(program as never, { ecmaVersion: 2025, sourceType: "script" });
      } catch {
        manager = undefined;
      }
    }
    // A function declared in a block is also bound in the enclosing function, or at the top level,
    // in sloppy code (Annex B), to a variable the analysis keeps apart from it: names are followed
    // instead, which can only refuse more (Codex's review of #335).
    if (manager?.scopes.some((scope) => scope.variables.some(inBlockFunction))) manager = undefined;
    this.byName = !manager;
    if (!manager) return;
    const globals = new Set<object>();
    for (const scope of manager.scopes) {
      for (const variable of scope.variables) {
        if (bindsGlobal(variable)) {
          this.globalDeclared.add(variable.name);
          globals.add(variable);
        }
      }
    }
    // What each identifier means: its variable, or the global of its name.
    const keyOf = (
      variable: (typeof manager.scopes)[number]["variables"][number] | null,
      name: string,
    ) =>
      // A variable nothing declares, such as `arguments`, counts as the global of its name, as it
      // did when names were followed: the same rules apply to it.
      variable && variable.defs.length > 0 && !globals.has(variable) ? variable : `global:${name}`;
    for (const scope of manager.scopes) {
      for (const variable of scope.variables) {
        for (const identifier of variable.identifiers) {
          this.keys.set(identifier as unknown as AnyNode, keyOf(variable, variable.name));
        }
      }
      for (const reference of scope.references) {
        const identifier = reference.identifier as unknown as AnyNode;
        this.keys.set(identifier, keyOf(reference.resolved, identifier["name"] as string));
      }
    }
  }

  /** What an identifier refers to. */
  key(identifier: AnyNode): Key {
    const name = identifier["name"] as string;
    return this.byName ? name : (this.keys.get(identifier) ?? `global:${name}`);
  }

  /**
   * Whether an identifier means the global of its name, not a variable of the tool's own. When
   * names can't be resolved, every use counts as the global, as before.
   */
  isGlobal(identifier: AnyNode): boolean {
    const name = identifier["name"] as string;
    // The page's own names, and the forbidden globals, are followed by name wherever they are
    // declared, as before: a variable of the tool's that is called so may still be given the real
    // one through a path the tracking doesn't follow (a call's `call`, a `catch`, a callback), so
    // only `history`, `location` and `navigation`, which no path can fetch, are the tool's own when
    // it declares them (Codex's review of #342).
    if (PAGE_NAMES.has(name)) return true;
    return this.byName || typeof this.key(identifier) === "string";
  }
}

/**
 * Names that mean the page's objects or a forbidden global wherever they appear, however the tool
 * declares them: all but `history`, `location` and `navigation`, whose real objects can't be
 * fetched without a name the check refuses everywhere.
 */
const PAGE_NAMES = new Set(
  [...PAGE_GLOBALS, ...FORBIDDEN_GLOBALS].filter(
    (name) => !["history", "location", "navigation"].includes(name),
  ),
);

/**
 * Which variables and functions may hold the page or its elements, each by the variable a name
 * refers to (or, when names can't be resolved, by name across the whole script). Repeated until
 * nothing new is found.
 */
class PageValues {
  readonly names = new Set<Key>();
  /**
   * For each variable in `names`: its name, the line where it was first found to hold the page's
   * objects, and the variable it got them from, when that was one of the tool's own.
   */
  private readonly origins = new Map<Key, { name: string; line: number; from?: Key }>();
  readonly returning = new Set<Key>();
  thisIsPage = false;
  /** Set when the tracking gave up: every value may then be the page's. */
  everything = false;
  /** Every function a key may be, so none is lost when names are merged (Codex's review of #342). */
  private readonly functions = new Map<Key, AnyNode[]>();
  private addFunction(key: Key, fn: AnyNode) {
    const known = this.functions.get(key) ?? [];
    if (!known.includes(fn)) this.functions.set(key, [...known, fn]);
  }

  private readonly program: AnyNode;
  readonly bindings: Bindings;
  /** Every name the script declares, anywhere. */
  readonly declared = new Set<string>();

  constructor(program: AnyNode) {
    this.program = program;
    this.bindings = new Bindings(program);
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
        this.addFunction(this.bindings.key(node["id"] as AnyNode), node);
      }
      if (node.type === "VariableDeclarator" && isFunction(node["init"] as AnyNode)) {
        for (const identifier of boundIdentifiers(node["id"] as AnyNode)) {
          this.addFunction(this.bindings.key(identifier), node["init"] as AnyNode);
        }
      }
      // A named function expression is its own variable inside it, so a recursive call reaches it
      // by that name: the same function, with the same arguments and returns (Codex's review).
      if (node.type === "FunctionExpression" && node["id"]) {
        this.addFunction(this.bindings.key(node["id"] as AnyNode), node);
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

  /** Whether an identifier is a variable of the tool's own, not a global. */
  private isOwn(identifier: AnyNode): boolean {
    const name = identifier["name"] as string;
    return this.bindings.byName
      ? this.declared.has(name) && !PAGE_GLOBALS.has(name)
      : !this.bindings.isGlobal(identifier);
  }

  /** Whether an expression may be the page or one of its elements. */
  isPage(node: AnyNode | null | undefined): boolean {
    if (!node) return false;
    if (this.everything) return true;
    switch (node.type) {
      case "Identifier": {
        const name = node["name"] as string;
        if (this.names.has(this.bindings.key(node))) return true;
        if (this.bindings.byName)
          // Not declared and not built in: it may be an element, by its id.
          return PAGE_GLOBALS.has(name) || (!this.declared.has(name) && !BUILT_INS.has(name));
        // A variable of the tool's own holds the page's objects only when marked; a global may be
        // the page, or an element by its id, unless it is built in.
        return (
          this.bindings.isGlobal(node) &&
          (PAGE_GLOBALS.has(name) ||
            (!BUILT_INS.has(name) && !this.bindings.globalDeclared.has(name)))
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
          // A page constructor's name, however declared: a constructor may return an object
          // other than its own instance, such as an element (Codex's review of #342).
          (callee.type === "Identifier" && PAGE_CONSTRUCTOR.test(callee["name"] as string)) ||
          this.isPage(callee)
        );
      }
      case "CallExpression": {
        const callee = node["callee"] as AnyNode;
        const args = node["arguments"] as AnyNode[];
        // What crosses the bridge is copied as plain data; the page's objects can't cross it.
        if (isBridgeCall(callee)) return false;
        if (callee.type === "Identifier") return this.returning.has(this.bindings.key(callee));
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

  /**
   * The variable of the tool's own an expression gets the page's objects from, when that is the
   * reason it counts as the page's; undefined when the reason is the page itself, a global, or
   * something else.
   */
  private borrowedKey(node: AnyNode | null | undefined): Key | undefined {
    if (!node || this.everything) return undefined;
    switch (node.type) {
      case "Identifier": {
        const key = this.bindings.key(node);
        return this.origins.has(key) && this.isOwn(node) ? key : undefined;
      }
      case "MemberExpression":
        return this.borrowedKey(node["object"] as AnyNode);
      case "ChainExpression":
      case "ParenthesizedExpression":
      case "AwaitExpression":
      case "SpreadElement":
        return this.borrowedKey((node["expression"] ?? node["argument"]) as AnyNode);
      case "ConditionalExpression":
      case "LogicalExpression": {
        const [a, b] =
          node.type === "LogicalExpression"
            ? [node["left"] as AnyNode, node["right"] as AnyNode]
            : [node["consequent"] as AnyNode, node["alternate"] as AnyNode];
        return this.isPage(a) ? this.borrowedKey(a) : this.borrowedKey(b);
      }
      default:
        return undefined;
    }
  }

  /**
   * Why an expression counts as the page's, when the reason is a variable of the tool's own: that
   * variable, the ones it got the page's objects from, in order, and the line where the first of
   * them got them. Only explains a finding; it never decides one (VER-07).
   */
  borrowedName(node: AnyNode | null | undefined): { chain: string[]; line: number } | undefined {
    let key = this.borrowedKey(node);
    if (key === undefined) return undefined;
    const chain: string[] = [];
    const seen = new Set<Key>();
    let line = 0;
    while (key !== undefined && !seen.has(key) && chain.length < 5) {
      seen.add(key);
      const origin: { name: string; line: number; from?: Key } = this.origins.get(key)!;
      chain.push(origin.name);
      line = origin.line;
      key = origin.from;
    }
    return { chain, line };
  }

  /** One pass; true if it found something new. */
  private round(): boolean {
    const before = this.names.size + this.returning.size + (this.thisIsPage ? 1 : 0);
    const mark = (identifiers: AnyNode[], at: AnyNode, value?: AnyNode | null) => {
      const from = value ? this.borrowedKey(value) : undefined;
      for (const identifier of identifiers) {
        const key = this.bindings.key(identifier);
        this.names.add(key);
        if (!this.origins.has(key)) {
          this.origins.set(key, {
            name: identifier["name"] as string,
            line: lineOf(at),
            ...(from !== undefined && from !== key ? { from } : {}),
          });
        }
      }
    };
    const markParams = (fn: AnyNode | undefined) => {
      if (fn && isFunction(fn)) {
        mark(
          (fn["params"] as AnyNode[]).flatMap((p) => boundIdentifiers(p)),
          fn,
        );
      }
    };
    this.visit(this.program, (node) => {
      switch (node.type) {
        // A default, a parameter's or a pattern's, gives its value when none is passed: one that
        // may be the page makes what it gives a value to the page's (Codex's review of #335).
        case "AssignmentPattern": {
          const right = node["right"] as AnyNode;
          if (this.isPage(right)) mark(boundIdentifiers(node["left"] as AnyNode), node, right);
          break;
        }
        case "VariableDeclarator": {
          const init = node["init"] as AnyNode;
          if (this.isPage(init)) mark(boundIdentifiers(node["id"] as AnyNode), node, init);
          break;
        }
        case "AssignmentExpression": {
          const right = node["right"] as AnyNode;
          if (!this.isPage(right)) break;
          const left = node["left"] as AnyNode;
          if (left.type === "MemberExpression") {
            if ((left["object"] as AnyNode).type === "ThisExpression") this.thisIsPage = true;
            const root = rootIdentifier(left);
            if (root) mark([root], node, right);
          } else {
            mark(boundIdentifiers(left), node, right);
          }
          break;
        }
        case "ForOfStatement":
        case "ForInStatement": {
          const right = node["right"] as AnyNode;
          if (!this.isPage(right)) break;
          const left = node["left"] as AnyNode;
          mark(
            left.type === "VariableDeclaration"
              ? (left["declarations"] as AnyNode[]).flatMap((d) =>
                  boundIdentifiers(d["id"] as AnyNode),
                )
              : boundIdentifiers(left),
            node,
            right,
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
              (this.functions.get(this.bindings.key(callee)) ?? []).forEach(markParams);
            // A container given them (list.push(el), map.set(k, el)) holds them.
            // The bridge copies what it is given, so it never holds the page's objects.
            const root = callee.type === "MemberExpression" ? rootIdentifier(callee) : undefined;
            if (root && !isBridgeCall(callee))
              mark(
                [root],
                node,
                args.find((a) => this.isPage(a)),
              );
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
    for (const [key, fns] of this.functions) {
      const returns = fns.some((fn) => {
        const body = fn["body"] as AnyNode;
        return body.type !== "BlockStatement"
          ? this.isPage(body)
          : this.anyReturn(body, (argument) => this.isPage(argument));
      });
      if (returns) this.returning.add(key);
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
 * Whether a variable is a property of the global object in a classic script: declared at the top
 * level with `var` or as a function, or a function declared in a block (Annex B), which sloppy code
 * also binds in the enclosing function or at the top level. A block's function inside a function
 * only binds there, so taking it for a global can only make the check refuse more.
 */
function bindsGlobal(variable: {
  scope: { type: string };
  defs: readonly { type: string; parent?: unknown }[];
}): boolean {
  if (variable.scope.type !== "global") return false;
  return variable.defs.some(
    (def) =>
      def.type === "FunctionName" ||
      (def.type === "Variable" && (def.parent as { kind?: string } | undefined)?.kind === "var"),
  );
}

/**
 * Whether a variable is a function declared in a block, neither a function's own scope nor the top
 * level: sloppy code binds it outside the block too (Annex B).
 */
function inBlockFunction(variable: {
  scope: { type: string };
  defs: readonly { type: string }[];
}): boolean {
  return (
    variable.scope.type !== "global" &&
    variable.scope.type !== "function" &&
    // A function expression's own name has a scope of its own; it is no block's.
    variable.scope.type !== "function-expression-name" &&
    variable.defs.some((def) => def.type === "FunctionName")
  );
}

/** Visits every node of a tree. */
function visitAll(node: AnyNode, see: (node: AnyNode) => void) {
  see(node);
  for (const child of children(node)) visitAll(child, see);
}

/** A node's line, or 0 when the parser gave it none. */
function lineOf(node: AnyNode): number {
  return (node.loc as { start: { line: number } } | undefined)?.start.line ?? 0;
}

/**
 * A call of the bridge itself, `tessera.call`, `tessera.send` or `tessera.assetUrl`, with the
 * name written out: only these copy what they are given and give back plain data. Anything else
 * reached through `tessera` is no different from any other value.
 */
function isBridgeCall(callee: AnyNode): boolean {
  if (callee.type !== "MemberExpression" || callee["computed"]) return false;
  const object = callee["object"] as AnyNode;
  return (
    object.type === "Identifier" &&
    object["name"] === "tessera" &&
    Object.hasOwn(BRIDGE_METHODS, (callee["property"] as AnyNode)["name"] as string) &&
    BRIDGE_METHODS[(callee["property"] as AnyNode)["name"] as BridgeMethodName].copiesData
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
  capabilities: readonly string[] = [],
): JsFinding[] {
  let program: AnyNode;
  try {
    program = parse(js, {
      ecmaVersion: "latest",
      sourceType: "script",
      locations: true,
      ranges: true,
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
  // A variable of the tool's own that holds an element or the page because another one gave it
  // to it: the finding says where it started, so a repair can see the real cause (VER-07).
  const because = (value: AnyNode | null | undefined) => {
    const borrowed = page.borrowedName(value);
    if (!borrowed) return "";
    const [name, ...through] = borrowed.chain;
    const first = through.at(-1);
    const byName = page.bindings.byName
      ? " The check follows each name through the whole JavaScript here, because it uses with or eval."
      : "";
    return first
      ? ` Here \`${name}\` counts as one: line ${borrowed.line} gives \`${first}\` an element or the page, and \`${name}\` gets it from there${through.length > 1 ? ` through \`${through.slice(0, -1).join("`, `")}\`` : ""}.${byName}`
      : ` Here \`${name}\` counts as one because line ${borrowed.line} gives it an element or the page.${byName}`;
  };

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
            "The JavaScript lists the properties of an element or the page with for…in. Name the properties you need." +
              because(node["right"] as AnyNode),
          );
        }
        break;
      case "ObjectExpression":
        for (const property of node["properties"] as AnyNode[]) {
          if (property.type === "SpreadElement" && page.isPage(property["argument"] as AnyNode)) {
            found(
              property,
              "The JavaScript copies an element or the page with `...`. Name the properties you need." +
                because(property["argument"] as AnyNode),
            );
          }
        }
        break;
      case "ObjectPattern": {
        // What the pattern takes properties out of, when it says: a declaration's value or an
        // assignment's right side.
        const source =
          parent?.type === "VariableDeclarator" && parent["id"] === node
            ? (parent["init"] as AnyNode | null)
            : parent?.type === "AssignmentExpression" && parent["left"] === node
              ? (parent["right"] as AnyNode)
              : null;
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
          } else if (
            name !== undefined &&
            FORBIDDEN_NAMES.has(name) &&
            // Out of an unknown value, such as a parameter's, it may be the page's.
            (!NAVIGATING_NAMES.has(name) || !source || page.isPage(source))
          ) {
            found(property, `The JavaScript takes out ${name}, which a tool can't use.`);
          } else if (name === "Chart" && source && page.isPage(source)) {
            // const { Chart: C } = window names Chart.js as window.Chart does (CAP-04).
            found(property, CHART_DIRECT);
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
      }
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

  // Refuse hidden constructor access at its source instead of adding alias analysis.
  const isDate = (node: AnyNode): boolean =>
    (node.type === "Identifier" && node["name"] === "Date") ||
    (node.type === "MemberExpression" &&
      propertyName(node) === "Date" &&
      page.isPage(node["object"] as AnyNode));

  const checkDate = (node: AnyNode, parent: AnyNode | null) => {
    if (parent?.type === "MemberExpression" && parent["object"] === node) {
      if (["parse", "UTC"].includes(propertyName(parent) ?? "")) return;
    } else if (parent?.type === "NewExpression" && parent["callee"] === node) {
      // A spread alone may be empty. A written argument guarantees an explicit input.
      if ((parent["arguments"] as AnyNode[]).some((arg) => arg.type !== "SpreadElement")) return;
    }
    found(
      node,
      `The JavaScript reads the system clock or hides access to Date. Use tessera.call("clock.now") with the "${BRIDGE_ACTIONS["clock.now"].capability}" capability for current time, or new Date(explicitInput) for a supplied date. Don't call Date(), borrow Date, or compute its methods.`,
    );
  };

  // Chart.js is the host's, behind tessera.chart, so it can change without changing tools (CAP-04,
  // ADR 0014): a tool that names it, even its own binding of that name, is refused.
  const CHART_DIRECT =
    'The JavaScript uses Chart directly. Draw charts with tessera.chart(element, spec) and the "chart" capability.';

  const checkIdentifier = (node: AnyNode, parent: AnyNode | null) => {
    const name = node["name"] as string;
    if (parent && isNameNotReference(node, parent)) return;
    if (name === "Chart") found(node, CHART_DIRECT);
    if (name === "Date") checkDate(node, parent);
    // The tool's own variable of that name, declared and used as its own, is not the global.
    const global = page.bindings.isGlobal(node);
    if (FORBIDDEN_GLOBALS.has(name) && global) {
      found(node, `The JavaScript uses ${name}, which a tool can't use.`);
      return;
    }
    if (name === "tessera") {
      if (!(parent?.type === "MemberExpression" && parent["object"] === node)) {
        found(
          node,
          "Call tessera.method(...) directly. Don't store, pass or destructure the host's bridge.",
        );
      }
      return;
    }
    if (!PAGE_GLOBALS.has(name) || !global) return;
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
    if (isDate(node)) checkDate(node, parent);
    if (name === "Chart" && page.isPage(object)) found(node, CHART_DIRECT);
    if (name === "tessera" && page.isPage(object)) {
      found(
        node,
        "Use tessera.method(...) directly, without reaching tessera through the page or another object.",
      );
    }
    if (object.type === "Identifier" && object["name"] === "tessera") {
      checkBridgeMember(node, parent);
    }
    if (name === undefined) {
      const key = node["property"] as AnyNode;
      if (!isNumberKey(key) && page.isPage(object)) {
        found(
          node,
          "The JavaScript reaches a property of an element or the page by a name computed at run time. Write the name out." +
            because(object),
        );
      }
      return;
    }
    // The page's history moves through it; the tool's own data may well have a history of its own.
    if (FORBIDDEN_NAMES.has(name) && (!NAVIGATING_NAMES.has(name) || page.isPage(object))) {
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
        const onPageArg = args.find((a) => page.isPage(a));
        if (onPageArg) {
          found(
            node,
            `The JavaScript uses Object.${name} on an element or the page. Name the properties you need.` +
              because(onPageArg),
          );
        }
      }
    }
  };

  // Do not infer aliases or evaluate action expressions: refusing the source reference closes
  // borrowing, containers, destructuring and callbacks without pretending to resolve all JS.
  const checkBridgeMember = (node: AnyNode, parent: AnyNode | null) => {
    const method = propertyName(node);
    if (node["computed"] || parent?.type !== "CallExpression" || parent["callee"] !== node) {
      found(
        node,
        "Call tessera.method(...) directly, with the method name written out. Don't borrow or compute bridge methods.",
      );
      return;
    }
    if (method === undefined || !Object.hasOwn(BRIDGE_METHODS, method)) {
      found(
        node,
        `The bridge has no method called "${method ?? ""}". Use a method from the bridge manifest.`,
      );
      return;
    }
    const definition = BRIDGE_METHODS[method as BridgeMethodName];
    // A method that works in the page alone, like chart, still needs its capability declared.
    const needs = "capability" in definition ? definition.capability : undefined;
    if (needs && !capabilities.includes(needs)) {
      found(
        node,
        `tessera.${method} needs the "${needs}" capability. Declare it or remove this call.`,
      );
      return;
    }
    if (definition.action === null) return;
    const args = parent["arguments"] as AnyNode[];
    const action = definition.action === "argument" ? fixedText(args[0]) : definition.action;
    if (action === undefined) {
      found(
        node,
        "Write the bridge action name as fixed text in the first argument, so it can be checked before the tool runs.",
      );
      return;
    }
    if (!Object.hasOwn(BRIDGE_ACTIONS, action)) {
      found(
        node,
        `The bridge has no action called "${action}". Use an action from the bridge manifest.`,
      );
      return;
    }
    const capability = BRIDGE_ACTIONS[action as BridgeActionName].capability;
    // A write while the tool starts is no longer refused here (A60): guessing it from the code
    // refused working tools (L-84, L-95). The bridge refuses any write before the person's real
    // interaction and throughout staging (GEN-06), and a behavior check's writes go to a throwaway
    // copy (BRG-06).
    if (capability && !capabilities.includes(capability)) {
      found(
        node,
        `The bridge action "${action}" needs the "${capability}" capability. Declare it or remove this call.`,
      );
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
