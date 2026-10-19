import { createHash } from "node:crypto";
import {
  artifactSchema,
  canonicalJson,
  readArtifact,
  type Artifact,
  type ArtifactReading,
} from "@tessera/contracts";
import { z } from "zod";
import type { Database } from "../storage/index.ts";

// Tool versions (DATA-04, CON-04): each artifact is stored once, as canonical JSON, under the
// SHA-256 of that JSON. The table refuses updates, so a stored version can't change.

/** The SHA-256 of an artifact's canonical JSON, in lowercase hex: its name. */
export const hashArtifact = (artifact: Artifact): string =>
  createHash("sha256").update(canonicalJson(artifact)).digest("hex");

/**
 * Stores a tool version and returns its hash. It is checked against the contract first, so an
 * invalid one is never stored; storing the same content again keeps the one copy.
 */
export function saveVersion(db: Database, artifact: Artifact): string {
  const checked = artifactSchema.parse(artifact);
  const body = canonicalJson(checked);
  const hash = createHash("sha256").update(body).digest("hex");
  db.run(
    "INSERT OR IGNORE INTO tool_versions (hash, contract_version, body, created_at) VALUES (?, ?, ?, ?)",
    hash,
    checked.contractVersion,
    body,
    new Date().toISOString(),
  );
  return hash;
}

const row = z.object({ body: z.string() });

/** A stored version, read back (CON-04); undefined when there is none with that hash. */
export function loadVersion(db: Database, hash: string): ArtifactReading | undefined {
  const found = db.get(row, "SELECT body FROM tool_versions WHERE hash = ?", hash);
  if (!found) return undefined;
  // A body that no longer matches its name was changed outside Tessera: never use it.
  if (createHash("sha256").update(found.body).digest("hex") !== hash) {
    return { kind: "incompatible", reason: "It was changed after it was saved." };
  }
  let stored: unknown;
  try {
    stored = JSON.parse(found.body);
  } catch {
    return { kind: "incompatible", reason: "It isn't readable." };
  }
  return readArtifact(stored);
}
