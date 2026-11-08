import fs from "node:fs";
import path from "node:path";
import { providerChoiceSchema, type ProviderName } from "@tessera/contracts";
import { loadRoutes, ROUTES_FILE, type Routes } from "./routing.ts";

// Which program Tessera reaches a model through (CLI-01): Claude Code, or Codex from M3, chosen on
// the status screen and kept in the data folder, so each data folder (development, evaluations,
// use) keeps its own choice (ENG-19). Each program has its own routes file, since their models
// differ (CLI-09).

/** The file in the data folder that keeps the choice. */
export const PROVIDER_FILE = "provider.json";

/** The program used until one is chosen. */
export const DEFAULT_PROVIDER: ProviderName = "claude-code";

/** Each program's optional routes file in the data folder. */
export const ROUTES_FILES: Readonly<Record<ProviderName, string>> = {
  "claude-code": ROUTES_FILE,
  codex: "codex-routes.json",
};

/**
 * The program chosen for this data folder. No file means the default. A file Tessera didn't write
 * as it does also means the default: it is a preference, not a safeguard, and the status screen
 * always shows which program is in use, so the person can choose again.
 */
export function readProviderChoice(dataDir: string): ProviderName {
  try {
    const parsed = providerChoiceSchema.safeParse(
      JSON.parse(fs.readFileSync(path.join(dataDir, PROVIDER_FILE), "utf8")),
    );
    return parsed.success ? parsed.data.provider : DEFAULT_PROVIDER;
  } catch {
    return DEFAULT_PROVIDER;
  }
}

/** Keeps the choice, whole or not at all: written beside, then moved into place. */
export function writeProviderChoice(dataDir: string, provider: ProviderName): void {
  const file = path.join(dataDir, PROVIDER_FILE);
  const next = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(next, `${JSON.stringify(providerChoiceSchema.parse({ provider }))}\n`, "utf8");
  fs.renameSync(next, file);
}

/** The routes in use for a program: its defaults, with what its routes file in `dataDir` names. */
export const loadProviderRoutes = (dataDir: string, provider: ProviderName): Routes =>
  loadRoutes(path.join(dataDir, ROUTES_FILES[provider]), provider);
