import { randomBytes } from "node:crypto";
import fs from "node:fs";
import type { ServerResponse } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  chartSpecRelations,
  chartSpecShape,
  jsonSchemaOf,
  schemaProblem,
  type Artifact,
} from "@tessera/contracts";
import {
  hostStyles,
  TOOL_CSP,
  TOOL_SANDBOX,
  UI_CHART_TOKENS,
  UI_TOKENS,
  wrapperCsp,
} from "@tessera/runtime/policy";
import type { Handler } from "../http/index.ts";

// The runtime's documents (RUN-01), served on the runtime's origin (localhost) by the local server,
// whose guard has already checked the Host header and that they load only as frames (SEC-03).

/**
 * The tool a mount shows, its code, its UI mode and the capabilities it declares (none when it
 * doesn't say), or undefined if there is no such mount.
 */
export type ToolFor = (
  mountId: string,
) => (Pick<Artifact, "code" | "ui"> & Partial<Pick<Artifact, "capabilities">>) | undefined;

// The browser scripts are TypeScript in @tessera/runtime; their types are stripped once, here.
const runtimeSource = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "runtime",
  "src",
);
// The chart helper's values (CAP-04): the spec's shape as JSON Schema, and the standard's chart
// styles, which the helper uses where a tool sets none, each from its one definition (P3).
const CHART_STYLES = ["font", "size-secondary", "text", "divider", "surface"] as const;
const chartValues = JSON.stringify({
  schema: jsonSchemaOf(chartSpecShape),
  styles: {
    ...Object.fromEntries(
      Object.entries(UI_TOKENS).filter(([name]) =>
        (CHART_STYLES as readonly string[]).includes(name),
      ),
    ),
    ...UI_CHART_TOKENS,
  },
});

let scripts: { wrapper: string; preamble: string; chart: string } | undefined;
const loadScripts = () =>
  (scripts ??= {
    wrapper: stripTypeScriptTypes(fs.readFileSync(path.join(runtimeSource, "wrapper.ts"), "utf8")),
    preamble: stripTypeScriptTypes(
      fs.readFileSync(path.join(runtimeSource, "tool-preamble.ts"), "utf8"),
    )
      .replace('"__TESSERA_CHART__"', () => JSON.stringify(chartValues))
      .replace("/*__TESSERA_SCHEMA_PROBLEM__*/ undefined", () => `(${schemaProblem.toString()})`)
      .replace(
        "/*__TESSERA_CHART_RELATIONS__*/ undefined",
        () => `(${chartSpecRelations.toString()})`,
      ),
    // The pinned Chart.js (ADR 0014), only for a tool that declares chart.
    chart: fs.readFileSync(
      path.join(runtimeSource, "..", "node_modules", "chart.js", "dist", "chart.umd.min.js"),
      "utf8",
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
 * The tool's own document: Chart.js for a tool that declares chart (CAP-04), the preamble, then
 * the host's styles (RUN-05: the accessibility floor always, the UI standard in standard mode),
 * then the tool's styles, markup and script.
 */
export function toolDocument(
  tool: Pick<Artifact, "code" | "ui"> & Partial<Pick<Artifact, "capabilities">>,
  preamble: string,
  // A new mark for every document, so a tool's styles can't name the host's layers.
  mark: string = randomBytes(8).toString("hex"),
  chartLibrary: string = tool.capabilities?.includes("chart") ? loadScripts().chart : "",
): string {
  const { code } = tool;
  // A closing tag inside the tool's script or styles would end it early; keep it inside.
  const js = code.js.replace(/<\/(script)/gi, "<\\/$1");
  const css = code.css.replace(/<\/(style)/gi, "<\\/$1");
  const library = chartLibrary.replace(/<\/(script)/gi, "<\\/$1");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${library ? `<script>${library}</script>` : ""}<script>${preamble}</script><style>${hostStyles(tool.ui.mode, mark)}</style><style>${css}</style></head><body>${code.html}<script>${js}</script></body></html>`;
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
