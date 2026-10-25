import { randomBytes } from "node:crypto";
import fs from "node:fs";
import type { ServerResponse } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Artifact } from "@tessera/contracts";
import { hostStyles, TOOL_CSP, TOOL_SANDBOX, wrapperCsp } from "@tessera/runtime/policy";
import type { Handler } from "../http/index.ts";

// The runtime's documents (RUN-01), served on the runtime's origin (localhost) by the local server,
// whose guard has already checked the Host header and that they load only as frames (SEC-03).

/** The tool a mount shows, its code and its UI mode, or undefined if there is no such mount. */
export type ToolFor = (mountId: string) => Pick<Artifact, "code" | "ui"> | undefined;

// The browser scripts are TypeScript in @tessera/runtime; their types are stripped once, here.
const runtimeSource = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "runtime",
  "src",
);
let scripts: { wrapper: string; preamble: string } | undefined;
const loadScripts = () =>
  (scripts ??= {
    wrapper: stripTypeScriptTypes(fs.readFileSync(path.join(runtimeSource, "wrapper.ts"), "utf8")),
    preamble: stripTypeScriptTypes(
      fs.readFileSync(path.join(runtimeSource, "tool-preamble.ts"), "utf8"),
    ),
  });

// The guard's policy (frame-ancestors) stays: the browser enforces every policy it is sent.
function addPolicies(res: ServerResponse, ...policies: string[]) {
  const current = res.getHeader("content-security-policy");
  const kept = current === undefined ? [] : ([] as string[]).concat(current.toString());
  res.setHeader("content-security-policy", [...kept, ...policies]);
}

const html = (res: ServerResponse, body: string) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(body);
};

/**
 * The tool's own document: the preamble first, then the host's styles (RUN-05: the accessibility
 * floor always, the UI standard in standard mode), then the tool's styles, markup and script.
 */
export function toolDocument(
  tool: Pick<Artifact, "code" | "ui">,
  preamble: string,
  // A new mark for every document, so a tool's styles can't name the host's layers.
  mark: string = randomBytes(8).toString("hex"),
): string {
  const { code } = tool;
  // A closing tag inside the tool's script or styles would end it early; keep it inside.
  const js = code.js.replace(/<\/(script)/gi, "<\\/$1");
  const css = code.css.replace(/<\/(style)/gi, "<\\/$1");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><script>${preamble}</script><style>${hostStyles(tool.ui.mode, mark)}</style><style>${css}</style></head><body>${code.html}<script>${js}</script></body></html>`;
}

/** The runtime's routes for the local server: the wrapper and the tool's document. */
export function runtimeRoutes(toolFor: ToolFor): Record<string, Handler> {
  return {
    "/runtime/wrapper": (req, res) => {
      const nonce = randomBytes(16).toString("base64");
      addPolicies(res, wrapperCsp(`http://${req.headers.host}`, nonce));
      html(
        res,
        `<!doctype html><html><head><meta charset="utf-8"><style nonce="${nonce}">html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%;display:block}</style></head><body><script nonce="${nonce}">${loadScripts().wrapper}</script></body></html>`,
      );
    },
    "/runtime/tool": (req, res) => {
      const mountId = new URL(req.url ?? "/", "http://localhost").searchParams.get("mount") ?? "";
      const tool = toolFor(mountId);
      if (!tool) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("No such tool.");
        return;
      }
      addPolicies(res, TOOL_CSP, TOOL_SANDBOX);
      html(res, toolDocument(tool, loadScripts().preamble));
    },
  };
}
