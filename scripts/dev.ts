// Docs: docs/code/scripts/dev-data.md
// `pnpm dev [folder]`: starts Tessera on the development data folder, never the real one (ENG-19),
// after `pnpm build` has built the app. `pnpm seed` fills that folder first.

import { DATA_FOLDER_VARIABLE } from "../packages/server/src/storage/index.ts";
import { devFolder } from "./dev-data.ts";

try {
  process.env[DATA_FOLDER_VARIABLE] = devFolder(process.argv[2]);
  await import("../packages/server/src/launcher/main.ts");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
