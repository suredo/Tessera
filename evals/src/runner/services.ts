// Docs: docs/code/evals/runner.md
import http from "node:http";
import type { AddressInfo } from "node:net";
import { addConnection } from "@tessera/server";
import type { Scenario } from "../scenarios/index.ts";

// The outside services a scenario's tools reach (CAP-02, ADR 0015, #349 step 5): fakes the runner
// serves on loopback, each added to the run's own Tessera as the connection its scenario names,
// so a rehearsal, a replay and a live run alike reach no real service. Each answers by the
// longest path its request's path starts with, the query aside, or a plain 404.

/** A real PNG, 1 by 1 pixel: what a fake service's image answer sends. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

export type Services = {
  /** Each request a service got, in order: the connection, method and path with its query. */
  seen: { connection: string; method: string; url: string }[];
  close(): Promise<void>;
};

/** Starts the scenario's services and adds their connections to `store`; none when it has none. */
export async function startServices(
  store: Parameters<typeof addConnection>[0],
  services: Scenario["services"],
): Promise<Services> {
  const seen: Services["seen"] = [];
  const servers: http.Server[] = [];
  for (const service of services) {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://service");
      seen.push({ connection: service.connection, method: req.method ?? "", url: req.url ?? "" });
      const answer = service.answers
        .filter((each) => url.pathname.startsWith(each.path))
        .sort((a, b) => b.path.length - a.path.length)[0];
      req.resume();
      if (!answer) {
        res.statusCode = 404;
        res.setHeader("content-type", "text/plain");
        return res.end("Nothing here.");
      }
      res.statusCode = answer.status;
      if (answer.image) {
        res.setHeader("content-type", "image/png");
        return res.end(PNG);
      }
      res.setHeader("content-type", answer.type);
      res.end(answer.body ?? "");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    addConnection(store, {
      name: service.connection,
      origins: [origin],
      ...(service.key
        ? {
            auth: { kind: "header" as const, name: "Authorization", prefix: "Bearer " },
            key: service.key,
          }
        : { auth: { kind: "none" as const }, key: null }),
    });
  }
  return {
    seen,
    close: async () => {
      for (const server of servers) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    },
  };
}
