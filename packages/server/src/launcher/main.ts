// Docs: docs/code/server/launcher.md
// Starts Tessera from Tessera.cmd or `node packages/server/src/launcher/main.ts` (PLAT-02), and
// stops it cleanly on Ctrl+C or when its window closes.
import { fileURLToPath } from "node:url";
import { checkSetup } from "../setup/index.ts";
import { chooseDataFolder, syncedFolderOf } from "../storage/index.ts";
import { launch, openInBrowser } from "./launcher.ts";

// The data folder (PLAT-04); TESSERA_DATA_DIR chooses another one, as development and tests must
// (ENG-19).
const dataDir = chooseDataFolder();
const syncedBy = syncedFolderOf(dataDir);
if (syncedBy !== undefined) {
  console.warn(
    `Your data folder, ${dataDir}, is synced by ${syncedBy}. Syncing can damage Tessera's data while it is being saved; choose a folder that isn't synced.`,
  );
}

// The stop handlers come first, before anything can say Tessera is running: a stop that arrived
// in between would end the process without removing its address or closing its server. A stop
// during the launch just exits; the system releases the lock, and the next copy that takes it
// removes the address left behind.
let stop: (() => Promise<void>) | undefined;
// SIGHUP is how Windows reports a closed console window; SIGBREAK is Ctrl+Break.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) {
  process.on(signal, () => void (stop?.() ?? Promise.resolve()).finally(() => process.exit(0)));
}

const launched = await launch({
  dataDir,
  webRoot: fileURLToPath(new URL("../../../web/dist", import.meta.url)),
  // Tests start the launcher without a browser.
  openBrowser: process.env["TESSERA_OPEN_BROWSER"] === "0" ? async () => {} : openInBrowser,
}).catch((error: unknown) => {
  // A plain sentence, not a stack trace; Tessera.cmd keeps the window open to read it.
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
const opened = launched.browserOpened ? "" : ` Open ${launched.url} in your browser.`;
if (launched.status === "already-running") {
  console.log(`Tessera is already running at ${launched.url}.${opened}`);
} else {
  stop = () => launched.stop();
  console.log(`Tessera is running at ${launched.url}.${opened} Close this window to stop it.`);
  // The setup check on start (PLAT-03); the status screen shows the same, with the fixes.
  const report = await checkSetup({ dataDir });
  for (const check of [report.node, report.claude]) {
    if (!check.ok) console.warn(check.message);
  }
}
