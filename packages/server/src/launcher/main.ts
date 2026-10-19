// Docs: docs/code/server/launcher.md
// Starts Tessera from Tessera.cmd or `node packages/server/src/launcher/main.ts` (PLAT-02), and
// stops it cleanly on Ctrl+C or when its window closes.
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, openInBrowser } from "./launcher.ts";

// Where the data folder is until the storage work settles it (PLAT-04). TESSERA_DATA_DIR chooses
// another one, as development and tests must (ENG-19).
function dataFolder(): string {
  const chosen = process.env["TESSERA_DATA_DIR"];
  if (chosen) return path.resolve(chosen);
  if (process.platform === "win32") {
    return path.join(
      process.env["LOCALAPPDATA"] ?? path.join(os.homedir(), "AppData", "Local"),
      "Tessera",
    );
  }
  if (process.platform === "darwin")
    return path.join(os.homedir(), "Library", "Application Support", "Tessera");
  return path.join(
    process.env["XDG_DATA_HOME"] ?? path.join(os.homedir(), ".local", "share"),
    "tessera",
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
  dataDir: dataFolder(),
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
}
