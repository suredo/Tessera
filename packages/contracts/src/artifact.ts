import { z } from "zod";
import { jsonObjectSchema } from "./json.ts";

// A tool version, the artifact (CON-04, DATA-04): everything that has to change together when a
// tool changes. It is immutable and named by the hash of its canonical JSON. Data, workspaces and
// the library refer to it; they are not part of it.

/** The artifact contract's current version. Raise it with an upgrade in ARTIFACT_UPGRADES. */
export const ARTIFACT_CONTRACT_VERSION = 1;

export const UI_MODES = ["standard", "custom"] as const;

export const artifactSchema = z
  .strictObject({
    contractVersion: z.literal(ARTIFACT_CONTRACT_VERSION),
    code: z
      .strictObject({ html: z.string(), css: z.string(), js: z.string() })
      .describe("The tool itself: what runs in the sandbox (RUN-01)."),
    data: z
      .strictObject({
        schemaVersion: z.int().min(1),
        schema: jsonObjectSchema.describe("The JSON Schema of the tool's data (DATA-03)."),
        defaults: jsonObjectSchema.describe(
          "Reusable defaults, never session entries or examples (DATA-03, DATA-07).",
        ),
      })
      .describe("The tool's declared data shape and reusable defaults (DATA-03)."),
    capabilities: z
      .array(z.string().regex(/^[a-z][a-z0-9.-]*$/))
      .describe("The host capabilities the tool declares (CAP-01)."),
    pins: z
      .array(z.strictObject({ id: z.string().min(1), version: z.int().min(1) }))
      .describe("The exact dependency versions it was built against, such as engines (DATA-04)."),
    ui: z
      .strictObject({ standardVersion: z.int().min(1), mode: z.enum(UI_MODES) })
      .describe("Which UI standard it follows, and whether in standard or custom mode (VER-06)."),
  })
  .describe("An immutable tool version: code, data shape, defaults and pins (CON-04, DATA-04).");
export type Artifact = z.infer<typeof artifactSchema>;

/**
 * JSON with object keys sorted at every level and no spaces, so the same content always gives
 * the same text, and so the same hash.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

type RawArtifact = Record<string, unknown>;
/** Upgrades an artifact from contract version N (the key) to N + 1. */
export type ArtifactUpgrades = Readonly<Record<number, (artifact: RawArtifact) => RawArtifact>>;

/** None yet: version 1 is the first. */
export const ARTIFACT_UPGRADES: ArtifactUpgrades = {};

/** A stored artifact, read back: current, upgraded to current, or plainly incompatible. */
export type ArtifactReading =
  | { kind: "ok"; artifact: Artifact; upgradedFromVersion: number | null }
  | { kind: "incompatible"; reason: string };

/**
 * Reads a stored artifact of any contract version (CON-04): an older one is upgraded step by step
 * and checked again; a newer or unreadable one is incompatible, with the reason. Never silent.
 */
export function readArtifact(
  stored: unknown,
  options: { current?: number; upgrades?: ArtifactUpgrades; schema?: z.ZodType<Artifact> } = {},
): ArtifactReading {
  const current = options.current ?? ARTIFACT_CONTRACT_VERSION;
  const upgrades = options.upgrades ?? ARTIFACT_UPGRADES;
  const schema = options.schema ?? artifactSchema;
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) {
    return { kind: "incompatible", reason: "It isn't a tool version." };
  }
  let raw = stored as RawArtifact;
  const version = raw["contractVersion"];
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { kind: "incompatible", reason: "It has no contract version." };
  }
  if (version > current) {
    return {
      kind: "incompatible",
      reason: `It was made by a newer version of Tessera (contract ${version}; this one knows up to ${current}).`,
    };
  }
  for (let v = version; v < current; v++) {
    const upgrade = upgrades[v];
    if (!upgrade) {
      return { kind: "incompatible", reason: `There is no way to upgrade it from contract ${v}.` };
    }
    raw = upgrade(raw);
  }
  const checked = schema.safeParse(raw);
  if (!checked.success) {
    const where = checked.error.issues[0]?.path.join(".") || "the tool version";
    return { kind: "incompatible", reason: `It doesn't fit the contract (at ${where}).` };
  }
  return {
    kind: "ok",
    artifact: checked.data,
    upgradedFromVersion: version < current ? version : null,
  };
}
