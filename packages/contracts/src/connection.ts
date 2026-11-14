import { z } from "zod";

// Connections to outside services that the person adds (CAP-02, ADR 0015): one definition for the
// host API, the server's storage and, from #349's next steps, the bridge and the prompt (P3). A
// connection names a service, the origins it may reach and how its key is sent; the key itself is
// the host's alone, so nothing here that leaves the server carries it, only whether one is set.

/** How many connections a person may add, and origins one connection may reach. */
export const CONNECTIONS_LIMIT = 50;
export const CONNECTION_ORIGINS_LIMIT = 5;
/** The longest key a connection keeps, in characters. */
export const CONNECTION_KEY_LIMIT = 4096;

export const connectionNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,39}$/)
  .describe(
    "The connection's name, how a tool asks for it: lowercase letters, digits and hyphens, starting with a letter, at most 40 characters, such as movies or home-lights.",
  );

/**
 * An origin and nothing else: http or https, a host, and a port if it isn't the scheme's own,
 * written as the URL standard writes it (lowercase, no path, query, fragment or credentials).
 */
function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.username === "" &&
      url.password === "" &&
      url.origin === value
    );
  } catch {
    return false;
  }
}

export const connectionOriginSchema = z
  .string()
  .max(300)
  .refine(isOrigin, "An address is a scheme and a host, such as https://api.example.com.")
  .describe(
    "An origin the connection may reach: http or https, the host, and a port if needed, with no path, as https://api.example.com.",
  );

/** A header or query parameter name: a token, as HTTP defines one. */
const fieldName = z
  .string()
  .regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/)
  .describe("A header or query parameter name.");

export const connectionAuthSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("none") }).describe("The service needs no key."),
    z
      .strictObject({
        kind: z.literal("header"),
        name: fieldName,
        prefix: z
          .string()
          .max(40)
          .regex(/^[^\r\n]*$/)
          .describe("Put before the key, such as 'Bearer '; empty for the key alone."),
      })
      .describe("The key goes in a request header, as Authorization: Bearer <key>."),
    z
      .strictObject({ kind: z.literal("query"), name: fieldName })
      .describe("The key goes in a query parameter, as ?api_key=<key>."),
  ])
  .describe("How the host sends the connection's key with each request.");
export type ConnectionAuth = z.infer<typeof connectionAuthSchema>;

const origins = z
  .array(connectionOriginSchema)
  .min(1)
  .max(CONNECTION_ORIGINS_LIMIT)
  .refine((list) => new Set(list).size === list.length, "Each address is listed once.")
  // The same rule for the JSON Schema, which a refine doesn't reach (CON-01).
  .meta({ uniqueItems: true })
  .describe("The origins the connection may reach, each once.");

/** A connection as the host shows it: never its key, only whether it has one. */
export const connectionSchema = z
  .strictObject({
    name: connectionNameSchema,
    origins,
    auth: connectionAuthSchema,
    hasKey: z
      .boolean()
      .describe("Whether a key is kept for it; the key itself never leaves the host."),
    addedAt: z.iso.datetime(),
  })
  .describe("A connection the person added (CAP-02, ADR 0015).");
export type Connection = z.infer<typeof connectionSchema>;

/** What the person gives to add a connection, or to change one: its key only when it needs one. */
export const connectionInputSchema = z
  .strictObject({
    name: connectionNameSchema,
    origins,
    auth: connectionAuthSchema,
    key: z
      .string()
      .min(1)
      .max(CONNECTION_KEY_LIMIT)
      .regex(/^[^\r\n]*$/)
      .nullable()
      .describe("The key or token, kept by the host; null for a service that needs none."),
  })
  .refine((input) => (input.auth.kind === "none") === (input.key === null), {
    message: "A key is given exactly when the connection sends one.",
  })
  .describe("A connection to add (CAP-02, ADR 0015).");
export type ConnectionInput = z.infer<typeof connectionInputSchema>;
