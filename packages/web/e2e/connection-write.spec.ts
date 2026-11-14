import http from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "@playwright/test";
import type { Artifact } from "../../contracts/src/index.ts";
import { addConnection, writesAllowed } from "../../server/src/connections/index.ts";
import { en } from "../src/i18n/en.ts";
import { startApp, TOOL_START, workspaceWith, type AppHost } from "./support/app-host.ts";

// A tool's first change through a connection asks the person (ADR 0015 point 4, A70, CNX-07), end
// to end in Chrome (TEST-06): the tool's click goes to the server, which refuses it until the person
// allows it; the host page asks where it goes and what it sends; on Allow the permission is kept
// and the change sent, on Don't allow nothing is. A fake service on loopback stands in for the
// real one, and records what reaches it. A real Tessera on a temporary data folder (ENG-19).

let app: AppHost;
let service: http.Server;
let origin = "";
const seen: { method: string; url: string; body: string }[] = [];

test.beforeAll(async () => {
  service = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      seen.push({
        method: req.method ?? "",
        url: req.url ?? "",
        body: Buffer.concat(chunks).toString("utf8"),
      });
      res.statusCode = 201;
      res.setHeader("content-type", "application/json");
      res.end('{"id":"i-1"}');
    });
  });
  await new Promise<void>((resolve) => service.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(service.address() as AddressInfo).port}`;
  app = await startApp();
  addConnection(app.folder, {
    name: "lists",
    origins: [origin],
    auth: { kind: "none" },
    key: null,
  });
});
test.afterAll(async () => {
  await app.close();
  service.closeAllConnections();
  await new Promise((resolve) => service.close(resolve));
});

/** A tool that, on a click, adds a movie to a list through the connection, and says what happened. */
const listTool: Artifact = {
  contractVersion: 4,
  connections: { lists: { samples: {} } },
  code: {
    html: '<p id="text">Ready</p><button id="add" type="button">Add Alien</button>',
    css: "",
    js: `document.getElementById("add").addEventListener("click", () => {
  tessera.call("connection.request", {
    connection: "lists",
    method: "POST",
    path: "/items",
    headers: { "content-type": "application/json" },
    body: '{"title":"Alien"}',
  }).then(
    (answer) => { document.getElementById("text").textContent = "Sent " + answer.statusCode; },
    (error) => { document.getElementById("text").textContent = "Refused " + error.code; },
  );
});`,
  },
  data: { schemaVersion: 1, schema: {}, defaults: {}, migrations: [] },
  capabilities: ["connection"],
  pins: [],
  ui: { standardVersion: 1, mode: "standard" },
};

const tool = (page: Page) =>
  page.frameLocator(".tool-frame iframe").frameLocator("iframe").frameLocator("iframe");
const question = (page: Page) => page.getByRole("alertdialog", { name: en["write.label"] });

/** Opens a new workspace running the list tool, and clicks its button. */
async function clickAdd(page: Page) {
  const title = `Movie list ${Math.random().toString(36).slice(2, 7)}`;
  const id = workspaceWith(app.folder, title, listTool);
  await page.goto(app.url);
  // The app may already have it open, as the newest workspace.
  await page.getByRole("button", { name: new RegExp(`^(Open ${title}|${title}, open)$`) }).click();
  await expect(tool(page).locator("#text")).toHaveText("Ready", TOOL_START);
  await tool(page).getByRole("button", { name: "Add Alien" }).click();
  return { id, title };
}

test("CNX-07 A72 A73: on Allow, the permission is kept and the change is sent, the next one doesn't ask, taken back in the details it asks again, and the details list each request", async ({
  page,
}) => {
  seen.length = 0;
  const { id, title } = await clickAdd(page);
  const asked = question(page);
  await expect(asked).toBeVisible();
  await expect(asked).toContainText(`${title} wants to send something through lists`);
  await expect(asked).toContainText(`It goes to ${origin}/items`);
  await expect(asked).toContainText('{"title":"Alien"}');
  expect(seen).toEqual([]);

  // The details, open while it asks, say the tool asks first (A72).
  await page.getByRole("button", { name: en["details.show"] }).click();
  const details = page.getByRole("region", { name: en["details.heading"] });
  const entry = details.getByRole("listitem").filter({ hasText: "lists:" });
  const takeBack = entry.getByRole("button", {
    name: "Take back its permission to change things through lists",
  });
  await expect(entry).toContainText(en["details.connection.asks"]);
  await expect(takeBack).toHaveCount(0);

  await asked.getByRole("button", { name: en["write.allow"], exact: true }).click();
  await expect(tool(page).locator("#text")).toHaveText("Sent 201");
  await expect(asked).toBeHidden();
  expect(seen).toEqual([{ method: "POST", url: "/items", body: '{"title":"Alien"}' }]);
  expect(writesAllowed(app.folder, id, "lists")).toBe(true);
  // The open details show the permission at once, with its Take back (#364 review).
  await expect(entry).toContainText(en["details.connection.allowed"]);
  await expect(takeBack).toBeVisible();

  // Allowed: the next change goes straight through.
  await tool(page).getByRole("button", { name: "Add Alien" }).click();
  await expect.poll(() => seen.length).toBe(2);
  await expect(question(page)).toBeHidden();

  // Taken back, the next change asks again.
  await takeBack.click();
  const takenBack = details.getByText("Its next change through lists will ask you first.");
  await expect(takenBack).toBeVisible();
  await expect(entry).toContainText(en["details.connection.asks"]);
  expect(writesAllowed(app.folder, id, "lists")).toBe(false);
  await tool(page).getByRole("button", { name: "Add Alien" }).click();
  await expect(question(page)).toBeVisible();
  expect(seen).toHaveLength(2);

  // Allowed again: the details say so, and no longer that it will ask.
  await question(page).getByRole("button", { name: en["write.allow"], exact: true }).click();
  await expect.poll(() => seen.length).toBe(3);
  await expect(entry).toContainText(en["details.connection.allowed"]);
  await expect(takenBack).toBeHidden();

  // The open details list each request as it settles, newest first, with no key (A73): two
  // waits for the person, and three changes sent.
  const requests = details.locator(".details-connection-requests");
  await expect(
    details.getByRole("heading", { name: en["details.connectionRequestsHeading"] }),
  ).toBeVisible();
  const lines = requests.getByRole("listitem");
  await expect(lines).toHaveCount(5);
  const sent = `Sent something to ${origin}/items through lists. It answered 201.`;
  const waited = `Sent something to ${origin}/items through lists. ${en["details.request.waited"]}`;
  await expect(lines.nth(0)).toContainText(sent);
  await expect(lines.nth(1)).toContainText(waited);
  await expect(lines.nth(4)).toContainText(waited);
  expect(await requests.textContent()).not.toContain("Bearer");
});

test("CNX-07: on Don't allow, nothing is sent or kept, and the tool hears it wasn't allowed", async ({
  page,
}) => {
  seen.length = 0;
  const { id } = await clickAdd(page);
  const asked = question(page);
  await expect(asked).toBeVisible();
  await asked.getByRole("button", { name: en["write.dontAllow"] }).click();
  await expect(tool(page).locator("#text")).toHaveText("Refused not-allowed");
  await expect(asked).toBeHidden();
  expect(seen).toEqual([]);
  expect(writesAllowed(app.folder, id, "lists")).toBe(false);
});
