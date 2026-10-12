import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { renderSchemaFiles } from "../src/index.ts";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "schemas");

it("the committed JSON Schemas match the zod definitions; if not, run pnpm contracts:schemas (CON-01)", () => {
  const committed = Object.fromEntries(
    fs
      .readdirSync(dir)
      .map((file) => [file, fs.readFileSync(path.join(dir, file), "utf8").replace(/\r\n/g, "\n")]),
  );
  expect(committed).toEqual(renderSchemaFiles());
});
