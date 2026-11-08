import fs from "node:fs";
import path from "node:path";
import {
  PROBE_ROUTE,
  probeResultSchema,
  PROVIDER_ROUTE,
  providerChoiceSchema,
  SETUP_ROUTE,
  setupReportSchema,
  type ClaudeCheck,
  type CodexCheck,
  type NodeCheck,
  type ProbeResult,
  type ProviderName,
  type SetupReport,
} from "@tessera/contracts";
import { z } from "zod";
import { json, readJson, text } from "../http/body.ts";
import type { Handler } from "../http/server.ts";
import { fixedPart } from "../prompts/index.ts";
import {
  atLeast,
  codexHome,
  createClaudeProvider,
  findClaude,
  findCodex,
  liveCodexProvider,
  loadProviderRoutes,
  ProviderError,
  readProviderChoice,
  RoutesError,
  runStage,
  writeProviderChoice,
  type Provider,
} from "../providers/index.ts";

// The setup check (PLAT-03) and the probe (CLI-02), for the status screen (APP-07): Node's version,
// Claude Code and Codex each installed, recent enough and signed in, none of which spends a model
// call, which program is chosen (CLI-01), and the data folder's size. Tessera is ready when Node
// and the chosen program pass. The probe is the one check that does call a model, through the
// chosen program, so it runs only when asked, only once the rest has passed, and one at a time.

/** The oldest Node.js Tessera runs on: the lower bound of the root package.json's engines. */
export const MINIMUM_NODE = "22.12.0";
/** How long the probe may take. */
export const PROBE_TIME_LIMIT_MS = 60_000;

export type SetupOptions = {
  /** The data folder; tests and development pass their own (ENG-19). */
  dataDir: string;
  /** Checks Claude Code; findClaude unless a test passes its own. */
  findClaude?: () => Promise<ClaudeCheck>;
  /** Checks Codex; findCodex with Tessera's Codex home folder unless a test passes its own. */
  findCodex?: () => Promise<CodexCheck>;
  /**
   * The provider for the program found, which the probe and every request call; the live adapter
   * unless a test passes its own.
   */
  probeProvider?: (executable: string, provider: ProviderName) => Provider;
  /** Node's version; this process's unless a test passes its own. */
  nodeVersion?: string;
};

const NAMES: Readonly<Record<ProviderName, string>> = {
  "claude-code": "Claude Code",
  codex: "Codex",
};

const couldntCheck = (provider: ProviderName): ClaudeCheck => ({
  ok: false,
  problem: "broken",
  message: `Tessera couldn't check ${NAMES[provider]}. Reinstall ${NAMES[provider]}, then try again.`,
});

/** One program's check, as the options give it. It explains what it finds; it never fails itself. */
function check(options: SetupOptions, provider: ProviderName): Promise<ClaudeCheck> {
  const find =
    provider === "codex"
      ? (options.findCodex ?? (() => findCodex(codexHome())))
      : (options.findClaude ?? (() => findClaude()));
  return find().catch(() => couldntCheck(provider));
}

/** The live adapter for a program found. */
export const liveProvider = (executable: string, provider: ProviderName): Provider =>
  provider === "codex"
    ? liveCodexProvider(executable)
    : createClaudeProvider({ executable, live: true });

/**
 * The provider every model call goes through: the chosen program's, found when asked, so a fix or
 * a new choice made on the status screen counts at once; or what is wrong with it, in plain words.
 */
export async function chosenProvider(
  options: SetupOptions,
): Promise<{ provider: Provider; name: ProviderName } | { problem: string }> {
  const name = readProviderChoice(options.dataDir);
  const found = await check(options, name);
  if (!found.ok) return { problem: found.message };
  return { provider: (options.probeProvider ?? liveProvider)(found.executable, name), name };
}

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

/**
 * The setup check: both programs are checked, so the status screen can show which can be chosen,
 * and Tessera is ready when Node.js and the chosen one pass (PLAT-03).
 */
export async function checkSetup(options: SetupOptions): Promise<SetupReport> {
  const node = checkNode(options.nodeVersion);
  const provider = readProviderChoice(options.dataDir);
  const [claude, codex] = await Promise.all([
    check(options, "claude-code"),
    check(options, "codex"),
  ]);
  const chosen = provider === "codex" ? codex : claude;
  return {
    ready: node.ok && chosen.ok,
    provider,
    node,
    claude,
    codex,
    dataFolder: { path: options.dataDir, bytes: folderBytes(options.dataDir) },
  };
}

const probeAnswer = z.strictObject({ connected: z.literal(true) });

/**
 * The probe (CLI-02): one small structured answer, on the intent stage's route of the program
 * given, the cheapest. A failure is the adapter's plain message.
 */
export async function runProbe(
  provider: Provider,
  dataDir: string,
  name: ProviderName = "claude-code",
): Promise<ProbeResult> {
  try {
    const routes = loadProviderRoutes(dataDir, name);
    const system = fixedPart("probe");
    const prompt = fixedPart("probe-request");
    const result = await runStage(provider, routes, {
      stage: "intent",
      system: system.text,
      prompt: prompt.text,
      promptParts: [system.part, prompt.part],
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
 * The setup routes for the local server: the check on GET; the probe on POST, which runs only
 * when the check passes, and shares one call between requests that arrive while it runs; and the
 * choice of program on POST, answered with the check as it now stands.
 */
export function setupRoutes(options: SetupOptions): Record<string, Handler> {
  let probing: Promise<ProbeResult> | undefined;
  const probe = async (): Promise<ProbeResult> => {
    if (!checkNode(options.nodeVersion).ok) return { ok: false, message: NOT_READY };
    const chosen = await chosenProvider(options);
    if ("problem" in chosen) return { ok: false, message: NOT_READY };
    return runProbe(chosen.provider, options.dataDir, chosen.name);
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
    [PROVIDER_ROUTE]: async (req, res) => {
      if (req.method !== "POST") return text(res, 405, "Choose the program with POST.");
      const body = await readJson(req, 1024);
      const choice =
        typeof body === "object" ? providerChoiceSchema.safeParse(body.json) : undefined;
      if (!choice?.success) return text(res, 400, "Choose Claude Code or Codex.");
      writeProviderChoice(options.dataDir, choice.data.provider);
      json(res, setupReportSchema.parse(await checkSetup(options)));
    },
  };
}
