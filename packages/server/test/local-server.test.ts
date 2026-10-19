import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkRequest, startLocalServer, type LocalServer } from "../src/http/index.ts";

// Runs on Linux and on Windows in CI. The guard is checked case by case, then through real sockets.
const PORT = 4400;
const app = `http://127.0.0.1:${PORT}`;
const runtime = `http://localhost:${PORT}`;
const verdict = (pathname: string, headers: http.IncomingHttpHeaders) =>
  checkRequest(pathname, headers, PORT);

describe("the request guard (SEC-03)", () => {
  it("refuses a foreign Host header on every route, which stops DNS rebinding", () => {
    for (const host of ["attacker.example:4400", "127.0.0.1:4401", "127.0.0.1", "[::1]:4400"]) {
      expect(verdict("/", { host })).toMatchObject({ ok: false, status: 403 });
      expect(verdict("/api/x", { host, "sec-fetch-site": "same-origin" }).ok).toBe(false);
    }
    expect(verdict("/", {}).ok).toBe(false);
    // Each name serves only its own side, so the sandbox never shares the host app's origin.
    expect(verdict("/", { host: `localhost:${PORT}` }).ok).toBe(false);
    expect(
      verdict("/runtime/w", { host: `127.0.0.1:${PORT}`, "sec-fetch-dest": "iframe" }).ok,
    ).toBe(false);
  });

  it("serves the host app's pages from 127.0.0.1, which no other page may frame", () => {
    expect(verdict("/", { host: `127.0.0.1:${PORT}`, "sec-fetch-site": "none" })).toMatchObject({
      ok: true,
      kind: "app",
      headers: { "content-security-policy": "frame-ancestors 'none'" },
    });
  });

  it("lets only same-origin requests use the API", () => {
    const host = `127.0.0.1:${PORT}`;
    expect(verdict("/api/x", { host, "sec-fetch-site": "same-origin" }).ok).toBe(true);
    expect(verdict("/api/x", { host, "sec-fetch-site": "same-origin", origin: app }).ok).toBe(true);
    // A client that isn't a browser, such as the launcher, names the app's origin.
    expect(verdict("/api/x", { host, origin: app }).ok).toBe(true);
    for (const site of ["cross-site", "same-site", "none"]) {
      expect(verdict("/api/x", { host, "sec-fetch-site": site, origin: app }).ok).toBe(false);
    }
    expect(verdict("/api/x", { host, "sec-fetch-site": "same-origin", origin: runtime }).ok).toBe(
      false,
    );
    expect(verdict("/api/x", { host, origin: "null" }).ok).toBe(false);
    expect(verdict("/api/x", { host }).ok).toBe(false);
  });

  it("serves runtime documents only as frames of the host app or the runtime", () => {
    const host = `localhost:${PORT}`;
    const frame = { host, "sec-fetch-dest": "iframe" };
    expect(verdict("/runtime/w", { ...frame, referer: `${app}/` })).toMatchObject({
      ok: true,
      headers: { "content-security-policy": `frame-ancestors ${app} ${runtime}` },
    });
    expect(verdict("/runtime/w", { ...frame, referer: `${runtime}/runtime/w` }).ok).toBe(true);
    expect(verdict("/runtime/w", { ...frame, referer: "https://attacker.example/" }).ok).toBe(
      false,
    );
    expect(verdict("/runtime/w", frame).ok).toBe(false);
    expect(
      verdict("/runtime/w", { host, "sec-fetch-dest": "document", referer: `${app}/` }).ok,
    ).toBe(false);
  });
});

type Reply = { status: number; headers: http.IncomingHttpHeaders; body: string };
function request(port: number, pathname: string, headers: Record<string, string>): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: pathname, headers }, (res) => {
      let body = "";
      res.setEncoding("utf8").on("data", (chunk: string) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
  });
}
const connects = (host: string, port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = net.connect({ host, port });
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });

const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-web-"));
fs.mkdirSync(path.join(webRoot, "dist"));
fs.writeFileSync(path.join(webRoot, "dist", "index.html"), "<p>Tessera</p>");
fs.writeFileSync(path.join(webRoot, "secret.txt"), "outside");
const servers: LocalServer[] = [];
afterAll(async () => {
  await Promise.all(servers.map((s) => s.close()));
  fs.rmSync(webRoot, { recursive: true, force: true });
});
const start = async (options: Parameters<typeof startLocalServer>[0]) => {
  const server = await startLocalServer(options);
  servers.push(server);
  return server;
};

describe("the local server (SEC-03, PLAT-02)", () => {
  it("binds to 127.0.0.1 only", async () => {
    const server = await start({ port: 0 });
    expect(server.url).toBe(`http://127.0.0.1:${server.port}`);
    expect(await connects("127.0.0.1", server.port)).toBe(true);
    expect(await connects("::1", server.port)).toBe(false);
    const outside = Object.values(os.networkInterfaces())
      .flat()
      .find((a) => a?.family === "IPv4" && !a.internal);
    if (outside) expect(await connects(outside.address, server.port)).toBe(false);
  });

  it("refuses a foreign Host header and lets only same-origin requests reach the API", async () => {
    const routes = { "/api/echo": (_: unknown, res: http.ServerResponse) => void res.end("ok") };
    const server = await start({ port: 0, routes });
    const host = `127.0.0.1:${server.port}`;
    const rebound = await request(server.port, "/api/echo", {
      host: `attacker.example:${server.port}`,
      "sec-fetch-site": "same-origin",
    });
    expect(rebound).toMatchObject({ status: 403, body: `Tessera answers only at ${server.url}.` });
    const crossSite = await request(server.port, "/api/echo", {
      host,
      "sec-fetch-site": "cross-site",
    });
    expect(crossSite.status).toBe(403);
    const own = await request(server.port, "/api/echo", { host, "sec-fetch-site": "same-origin" });
    expect(own).toMatchObject({ status: 200, body: "ok" });
    expect(own.headers["cache-control"]).toBe("no-store");
  });

  it("answers a malformed request target with a refusal and keeps running", async () => {
    const server = await start({ port: 0, webRoot: path.join(webRoot, "dist") });
    const host = `127.0.0.1:${server.port}`;
    for (const target of ["//[", "//[/", "http://attacker.example/", "*"]) {
      for (const h of [host, `attacker.example:${server.port}`]) {
        const reply = await request(server.port, target, { host: h });
        expect(reply).toMatchObject({ status: 400, body: "That address isn't valid." });
      }
    }
    expect(await request(server.port, "/", { host })).toMatchObject({ status: 200 });
  });

  it("serves the built host app and nothing outside it", async () => {
    const server = await start({ port: 0, webRoot: path.join(webRoot, "dist") });
    const host = `127.0.0.1:${server.port}`;
    const page = await request(server.port, "/workspaces/1", { host });
    expect(page).toMatchObject({ status: 200, body: "<p>Tessera</p>" });
    expect(page.headers["content-security-policy"]).toBe("frame-ancestors 'none'");
    expect((await request(server.port, "/..%2fsecret.txt", { host })).status).toBe(404);
    const unbuilt = await start({ port: 0, webRoot: path.join(webRoot, "missing") });
    expect(await request(unbuilt.port, "/", { host: `127.0.0.1:${unbuilt.port}` })).toMatchObject({
      status: 404,
      body: "Tessera's host app isn't built yet: run pnpm build.",
    });
  });

  it("picks a free port when the one asked for is taken, and frees its port on close", async () => {
    const first = await start({ port: 0 });
    const second = await start({ port: first.port });
    expect(second.port).not.toBe(first.port);
    // An open keep-alive connection doesn't hold the port.
    const agent = new http.Agent({ keepAlive: true });
    await new Promise((resolve) =>
      http.get({ port: first.port, host: "127.0.0.1", agent }, resolve),
    );
    await first.close();
    const again = await start({ port: first.port });
    expect(again.port).toBe(first.port);
    agent.destroy();
  });
});
