import fs from "node:fs";
import path from "node:path";
import {
  PROBE_ROUTE,
  probeResultSchema,
  SETUP_ROUTE,
  setupReportSchema,
  type ClaudeCheck,
  type NodeCheck,
  type ProbeResult,
  type SetupReport,
} from "@tessera/contracts";
import { z } from "zod";
import { json, text } from "../http/body.ts";
import type { Handler } from "../http/server.ts";
import {
  atLeast,
  createClaudeProvider,
  findClaude,
  loadRoutes,
  ProviderError,
  ROUTES_FILE,
  RoutesError,
  runStage,
  type Provider,
} from "../providers/index.ts";

// The setup check (PLAT-03) and the probe (CLI-02), for the status screen (APP-07): Node's version,
// Claude Code installed, recent enough and signed in, none of which spends a model call, and the
// data folder's size. The probe is the one check that does call a model, so it runs only when
// asked, only once the rest has passed, and only one at a time.

/** The oldest Node.js Tessera runs on: the lower bound of the root package.json's engines. */
export const MINIMUM_NODE = "22.12.0";
/** How long the probe may take. */
export const PROBE_TIME_LIMIT_MS = 60_000;

export type SetupOptions = {
  /** The data folder; tests and development pass their own (ENG-19). */
  dataDir: string;
  /** Checks Claude Code; findClaude unless a test passes its own. */
  findClaude?: () => Promise<ClaudeCheck>;
  /** The provider the probe calls, for the program found; the live adapter unless a test passes its own. */
  probeProvider?: (executable: string) => Provider;
  /** Node's version; this process's unless a test passes its own. */
  nodeVersion?: string;
};

/** Whether this Node.js is recent enough, and if not, how to fix it. */
export function checkNode(version: string = process.versions.node): NodeCheck {
  if (atLeast(version, MINIMUM_NODE)) return { ok: true, version, minimum: MINIMUM_NODE };
  return {
    ok: false,
    version,
    minimum: MINIMUM_NODE,
    message: `Tessera needs Node.js ${MINIMUM_NODE} or later, and this computer has ${version}. Install Node.js 22 from nodejs.org, then start Tessera again.`,
  };
}

/** How many bytes the files in `dir` and its folders hold; links aren't followed. */
export function folderBytes(dir: string): number {
  let bytes = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) bytes += folderBytes(full);
    else if (entry.isFile()) {
      try {
        bytes += fs.statSync(full).size;
      } catch {
        // Removed while it was counted.
      }
    }
  }
  return bytes;
}

/** The setup check: ready only when Node.js and Claude Code both pass (PLAT-03). */
export async function checkSetup(options: SetupOptions): Promise<SetupReport> {
  const node = checkNode(options.nodeVersion);
  const claude = await (options.findClaude ?? (() => findClaude()))();
  return {
    ready: node.ok && claude.ok,
    node,
    claude,
    dataFolder: { path: options.dataDir, bytes: folderBytes(options.dataDir) },
  };
}

const probeAnswer = z.strictObject({ connected: z.literal(true) });

/**
 * The probe (CLI-02): one small structured answer, on the intent stage's route, the cheapest. A
 * failure is the adapter's plain message.
 */
export async function runProbe(provider: Provider, dataDir: string): Promise<ProbeResult> {
  try {
    const routes = loadRoutes(path.join(dataDir, ROUTES_FILE));
    const result = await runStage(provider, routes, {
      stage: "intent",
      system: "You are checking that Tessera can reach you. Answer that you are connected.",
      prompt: "Are you connected?",
      schema: probeAnswer,
      timeLimitMs: PROBE_TIME_LIMIT_MS,
    });
    return { ok: true, model: routes.intent.model, durationMs: result.usage.durationMs };
  } catch (error) {
    if (error instanceof ProviderError || error instanceof RoutesError) {
      return { ok: false, message: error.message };
    }
    return { ok: false, message: "The probe didn't work, for a reason Tessera doesn't recognize." };
  }
}

const NOT_READY =
  "The probe would fail until the setup check passes. Fix what the status screen shows first.";

/**
 * The setup routes for the local server: the check on GET, and the probe on POST, which runs
 * only when the check passes, and shares one call between requests that arrive while it runs.
 */
export function setupRoutes(options: SetupOptions): Record<string, Handler> {
  const live = (executable: string) => createClaudeProvider({ executable, live: true });
  let probing: Promise<ProbeResult> | undefined;
  const probe = async (): Promise<ProbeResult> => {
    const report = await checkSetup(options);
    if (!report.ready || !report.claude.ok) return { ok: false, message: NOT_READY };
    const provider = (options.probeProvider ?? live)(report.claude.executable);
    return runProbe(provider, options.dataDir);
  };
  return {
    [SETUP_ROUTE]: async (req, res) => {
      if (req.method !== "GET") return text(res, 405, "Ask for the setup check with GET.");
      json(res, setupReportSchema.parse(await checkSetup(options)));
    },
    [PROBE_ROUTE]: async (req, res) => {
      if (req.method !== "POST") return text(res, 405, "Run the probe with POST.");
      probing ??= probe().finally(() => (probing = undefined));
      json(res, probeResultSchema.parse(await probing));
    },
  };
}
