import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Artifact } from "../../../contracts/src/index.ts";
import { WATCHDOG_DEFAULTS } from "../../../runtime/src/host.ts";
import { launch, type LaunchOptions } from "../../../server/src/launcher/index.ts";
import type { Provider } from "../../../server/src/providers/index.ts";
import type { DataFolder } from "../../../server/src/storage/index.ts";
import { saveVersion } from "../../../server/src/versions/index.ts";
import { activateVersion, createWorkspace } from "../../../server/src/workspaces/index.ts";

// A real Tessera for the host app's browser tests (TEST-06): the launcher starts it on a free port,
// serving the built app (packages/web/dist, which Playwright's web server builds first), the host
// API and the tools, on a temporary data folder, never the real one (ENG-19).

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "dist");

export type AppHost = {
  url: string;
  folder: DataFolder;
  /** The temporary data folder's path. */
  dataDir: string;
  close(): Promise<void>;
};

/**
 * Claude Code as the setup check sees it, unless a test passes its own: ready, without starting a
 * program, so no browser test reaches the real CLI (ENG-11). The probe has nothing to call.
 */
const READY_SETUP: NonNullable<LaunchOptions["setup"]> = {
  findClaude: () =>
    Promise.resolve({ ok: true, executable: "C:\\Tools\\claude.exe", version: "2.1.310" }),
  probeProvider: () => {
    throw new Error("This test has no probe.");
  },
};

/**
 * A Tessera on a temporary data folder. `provider` carries out its requests: a scripted one, for
 * tests through the real pipeline (TEST-03, ENG-11); none means requests reach Claude Code.
 */
export async function startApp(setup = READY_SETUP, provider?: Provider): Promise<AppHost> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-app-"));
  const launched = await launch({
    dataDir,
    port: 0,
    webRoot,
    openBrowser: () => Promise.resolve(),
    setup,
    provider,
  });
  if (launched.status !== "started") throw new Error("Tessera didn't start.");
  return {
    url: launched.url,
    folder: launched.dataFolder,
    dataDir,
    close: async () => {
      await launched.stop();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/**
 * How long a test waits for a tool it starts to show: the runtime gives a starting tool this long to
 * answer before it stops it, and on a busy machine a start takes more than the 5 s default (#211,
 * #214).
 */
export const TOOL_START = { timeout: WATCHDOG_DEFAULTS.startupMs };

/** A hand-written test tool, in standard mode, that shows `text` and saves nothing. */
export const testTool = (text: string): Artifact => ({
  contractVersion: 2,
  code: { html: `<p id="text">${text}</p>`, css: "", js: "" },
  data: { schemaVersion: 1, schema: {}, defaults: {}, migrations: [] },
  capabilities: [],
  pins: [],
  ui: { standardVersion: 1, mode: "standard" },
});

/** A workspace named `title` running `tool`; returns its ID. */
export function workspaceWith(folder: DataFolder, title: string, tool: Artifact): string {
  const { id } = createWorkspace(folder, title);
  const result = activateVersion(folder, id, saveVersion(folder.db, tool), 0);
  if (!result.ok) throw new Error(result.message);
  return id;
}
