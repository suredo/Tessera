import type { IncomingMessage, ServerResponse } from "node:http";

// What every JSON route needs: its request body read within a limit, and plain-text refusals.

/** The request's body as JSON, read up to a limit: "too-large" past it, "invalid" if not JSON. */
export async function readJson(req: IncomingMessage, limitBytes: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.byteLength;
    if (size > limitBytes) return "too-large" as const;
    chunks.push(chunk);
  }
  try {
    return { json: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown };
  } catch {
    return "invalid" as const;
  }
}

/** A plain-text answer, for a request the route refuses before it does anything. */
export const text = (res: ServerResponse, status: number, message: string): void => {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" }).end(message);
};

/** A JSON answer. */
export const json = (res: ServerResponse, body: unknown): void => {
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
};
