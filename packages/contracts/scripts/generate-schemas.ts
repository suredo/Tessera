// Writes the JSON Schema of every contract to packages/contracts/schemas/ (CON-01).
// Run it with `pnpm contracts:schemas` after changing a contract; a test fails while they differ.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderSchemaFiles } from "../src/json-schema.ts";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "schemas");
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir);
for (const [file, text] of Object.entries(renderSchemaFiles())) {
  fs.writeFileSync(path.join(dir, file), text);
  console.log(`contracts: wrote schemas/${file}`);
}
