import http from "node:http";

// Sending a route a same-origin request, as the host page would; a test overrides any header.

export type Reply = { status: number; body: string };

/** POSTs `body` to `route` on the local server at `port` (or sends `x-method`, if given). */
export function post(
  port: number,
  route: string,
  body: string,
  headers: Record<string, string> = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: route,
        method: headers["x-method"] ?? "POST",
        headers: {
          origin: `http://127.0.0.1:${port}`,
          "content-type": "application/json",
          ...headers,
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8").on("data", (chunk: string) => (text += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
