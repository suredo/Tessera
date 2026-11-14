// Docs: docs/code/server/connections.md
import {
  CONNECTION_ANSWER_LIMIT_BYTES,
  CONNECTION_READ_METHODS,
  CONNECTION_TIMEOUT_MS,
  CONNECTION_URL_LIMIT,
  connectionAnswerSchema,
  connectionAuthSchema,
  connectionOriginSchema,
  type Artifact,
  type BridgeErrorCode,
  type BridgePhase,
  type ConnectionAnswer,
  type ConnectionRequest,
} from "@tessera/contracts";
import { z } from "zod";
import type { Store } from "../workspaces/index.ts";

// A tool's request through a connection, made by the host (CAP-02, ADR 0015). The tool names the
// connection and a path; the host checks that the tool's version names that connection (CNX-01),
// builds the address on one of its origins and nothing else (CNX-02), adds the key (CNX-04),
// refuses a redirect (CNX-03), limits the answer's size and time (CNX-05), and hands it back with
// where it came from. This is the only reader of a connection's key: it goes to the service and
// nowhere else, so no refusal, answer or error message carries it. Until #349 step 3, a request
// from a tool being checked and any write are refused before anything is sent (CNX-06).

/** Limits a test may lower, so a slow or large answer doesn't take the real limit to show. */
export type ConnectionRequestOptions = { timeoutMs?: number; answerLimitBytes?: number };

/** A request the host refused or couldn't complete: the bridge's code and a plain message. */
export class ConnectionRefusal extends Error {
  readonly code: BridgeErrorCode;
  constructor(code: BridgeErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const NOTHING_SENT = "Nothing was sent.";
const refuse = (code: BridgeErrorCode, message: string): never => {
  throw new ConnectionRefusal(code, message);
};

const row = z.object({ origins: z.string(), auth: z.string(), key: z.string().nullable() });

// Text a tool can read: an answer in another type, such as an image, waits for #349 step 4.
const isText = (type: string) =>
  /^text\//.test(type) ||
  /^application\/(json|xml|javascript|x-www-form-urlencoded)$/.test(type) ||
  /\+(json|xml)$/.test(type);

/**
 * The ways a service is likely to write a key back, such as an echo of the request or an error
 * that quotes its address: as sent, URL- and form-encoded, escaped in JSON, and in base64. Compared
 * without regard to case, since a header's or a type's case may change on the way. A service that
 * transforms the key otherwise isn't caught: the person chose to trust it with the key.
 */
function keyForms(key: string): string[] {
  const forms = [
    key,
    encodeURIComponent(key),
    new URLSearchParams({ k: key }).toString().slice(2),
    JSON.stringify(key).slice(1, -1),
    Buffer.from(key).toString("base64"),
    Buffer.from(key).toString("base64url"),
  ];
  return [...new Set(forms.map((form) => form.toLowerCase()))];
}

/**
 * The text with the escapes a reader undoes for free decoded once: JSON's `\uXXXX` and `\/`, and
 * HTML's and XML's numeric character references. Linear in the text, which is already bounded.
 */
function unescaped(text: string): string {
  const char = (code: number) =>
    Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  return text
    .replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex: string) => char(parseInt(hex, 16)))
    .replace(/\\\//g, "/")
    .replace(/&#x([0-9a-fA-F]{1,6});/g, (_m, hex: string) => char(parseInt(hex, 16)))
    .replace(/&#([0-9]{1,7});/g, (_m, dec: string) => char(parseInt(dec, 10)));
}

/** Reads a body up to `limit` bytes, or refuses the whole answer. */
async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel();
    refuse("too-large", `The service's answer is larger than Tessera takes (${limit / 1024} KB).`);
  }
  if (!response.body) return new Uint8Array();
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      refuse(
        "too-large",
        `The service's answer is larger than Tessera takes (${limit / 1024} KB).`,
      );
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

/**
 * Makes a tool's request through a connection, for the tool version `artifact`, in `phase`, and
 * returns the service's answer with where it came from. Refuses with a `ConnectionRefusal`, before
 * anything is sent, a connection the version doesn't name, an origin or address outside the
 * connection, a write, and any request from a tool being checked; and refuses a redirect or an
 * answer too large, too slow or not text.
 */
export async function requestThroughConnection(
  store: Store,
  artifact: Artifact,
  phase: BridgePhase,
  request: ConnectionRequest,
  options: ConnectionRequestOptions = {},
): Promise<ConnectionAnswer> {
  const name = request.connection;
  if (phase === "staging") {
    refuse("not-allowed", `A tool being checked doesn't reach outside services. ${NOTHING_SENT}`);
  }
  if (!artifact.connections.includes(name)) {
    refuse(
      "not-allowed",
      `This tool wasn't built to use the connection ${name}. Using it takes an edit. ${NOTHING_SENT}`,
    );
  }
  if (!CONNECTION_READ_METHODS.includes(request.method)) {
    refuse(
      "not-allowed",
      `Tessera doesn't send changes through a connection yet, only reads (GET, HEAD). ${NOTHING_SENT}`,
    );
  }
  if (request.body !== undefined) {
    refuse("invalid-args", `A read (GET, HEAD) sends no body. ${NOTHING_SENT}`);
  }
  const found = store.db.get(
    row,
    "SELECT origins, auth, key FROM connections WHERE name = ?",
    name,
  );
  if (!found) {
    return refuse(
      "failed",
      `There is no connection called ${name}. The person can add it in Tessera's settings.`,
    );
  }
  const origins = z.array(connectionOriginSchema).parse(JSON.parse(found.origins));
  const auth = connectionAuthSchema.parse(JSON.parse(found.auth));
  const origin = request.origin ?? origins[0]!;
  if (!origins.includes(origin)) {
    refuse("not-allowed", `The connection ${name} doesn't reach ${origin}. ${NOTHING_SENT}`);
  }
  // The path is the tool's; the origin is the connection's. Whatever the path holds, the address
  // must still be on that origin, with no credentials of its own (CNX-02).
  const url = new URL(request.path, origin);
  if (url.origin !== origin || url.username !== "" || url.password !== "") {
    refuse("not-allowed", `That path leaves the connection's address. ${NOTHING_SENT}`);
  }
  if (auth.kind === "query" && url.searchParams.has(auth.name)) {
    refuse("invalid-args", `The host adds ${auth.name} itself; leave it out. ${NOTHING_SENT}`);
  }
  // Where the answer came from, as the tool may see it: before the key is added.
  const source = url.href;
  if (source.length > CONNECTION_URL_LIMIT) {
    refuse(
      "invalid-args",
      `The address is longer than Tessera sends (${CONNECTION_URL_LIMIT} characters, once written out). ${NOTHING_SENT}`,
    );
  }
  const headers: Record<string, string> = { "user-agent": "Tessera" };
  for (const [header, value] of Object.entries(request.headers ?? {})) {
    if (value !== undefined) headers[header] = value;
  }
  const key = found.key;
  // Added after the tool's query, which stays exactly as written.
  if (auth.kind === "query" && key !== null) {
    const param = `${encodeURIComponent(auth.name)}=${encodeURIComponent(key)}`;
    url.search = url.search ? `${url.search}&${param}` : `?${param}`;
  }
  if (auth.kind === "header" && key !== null) {
    headers[auth.name.toLowerCase()] = `${auth.prefix}${key}`;
  }

  const timeoutMs = options.timeoutMs ?? CONNECTION_TIMEOUT_MS;
  const limit = options.answerLimitBytes ?? CONNECTION_ANSWER_LIMIT_BYTES;
  const signal = AbortSignal.timeout(timeoutMs);
  const tooSlow = `The service didn't answer within ${Math.round(timeoutMs / 1000)} seconds.`;
  let response: Response;
  try {
    response = await fetch(url, { method: request.method, headers, redirect: "manual", signal });
  } catch {
    // The error's own words may name the address, and the key with it: never passed on.
    return refuse("failed", signal.aborted ? tooSlow : "Tessera couldn't reach the service.");
  }
  // A redirect is never followed, so a service can't send the request, or its key, anywhere else
  // (CNX-03). Not Modified isn't a redirect.
  if (response.status >= 300 && response.status < 400 && response.status !== 304) {
    await response.body?.cancel();
    refuse(
      "failed",
      "The service answered with a redirect, which Tessera doesn't follow. Nothing more was sent.",
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = await readLimited(response, limit);
  } catch (error) {
    if (error instanceof ConnectionRefusal) throw error;
    return refuse("failed", signal.aborted ? tooSlow : "The service's answer broke off.");
  }
  // Nothing the service wrote reaches the tool if it repeats the key (CNX-04): checked before
  // any message names what the service sent, so a refusal can't carry it either.
  const forms = key === null ? [] : keyForms(key);
  const repeatsKey = (text: string) =>
    [text, unescaped(text)].some((each) => {
      const lower = each.toLowerCase();
      return forms.some((form) => lower.includes(form));
    });
  const repeated =
    "The service's answer repeated the connection's key, so Tessera passed none of it on.";
  const contentType = response.headers.get("content-type")?.slice(0, 200) ?? null;
  if (contentType !== null && repeatsKey(contentType)) return refuse("failed", repeated);
  const type = (contentType ?? "text/plain").split(";")[0]!.trim().toLowerCase();
  if (bytes.byteLength > 0 && !isText(type)) {
    refuse("failed", `The service answered with ${type}, which tools can't read yet.`);
  }
  const body = new TextDecoder().decode(bytes);
  if (repeatsKey(body)) return refuse("failed", repeated);
  const answer = connectionAnswerSchema.safeParse({
    statusCode: response.status,
    contentType,
    body,
    source: { connection: name, url: source, receivedAt: store.now().toISOString() },
  });
  if (!answer.success) return refuse("failed", "The service's answer couldn't be passed on.");
  return answer.data;
}
