import { openToolDetails } from "./support/tool-actions.ts";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "@playwright/test";
import type { Artifact } from "../../contracts/src/index.ts";
import { addConnection, writesAllowed } from "../../server/src/connections/index.ts";
import { PLACEHOLDER_IMAGE } from "../../runtime/src/index.ts";
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
      // A poster a tool shows (A75): a real PNG, 1 by 1 pixel.
      if (req.url === "/poster.png") {
        res.setHeader("content-type", "image/png");
        return res.end(Buffer.from(PLACEHOLDER_IMAGE.bytesBase64, "base64"));
      }
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
  contractVersion: 5,
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
  ui: { standardVersion: 1, mode: "standard", width: "comfortable" },
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
  await openToolDetails(page);
  const details = page.getByRole("region", { name: en["details.heading"] });
  const entry = details.getByRole("listitem").filter({ hasText: "lists:" });
  const takeBack = entry.getByRole("button", {
    name: "Take back its permission to change things through lists",
  });
  await expect(entry).toContainText(en["details.connection.asks"]);
  await expect(takeBack).toHaveCount(0);

  await asked.getByRole("button", { name: en["write.allow"], exact: true }).click();
  await openToolDetails(page);
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
  await openToolDetails(page);
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
  await openToolDetails(page);
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
  const sent = `Asked to send something to ${origin}/items through lists. It answered 201.`;
  const waited = `Asked to send something to ${origin}/items through lists. ${en["details.request.waited"]}`;
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

test("A75: a tool shows an image through its connection, fetched by the host, as a blob: URL", async ({
  page,
}) => {
  seen.length = 0;
  const poster: Artifact = {
    ...listTool,
    code: {
      html: '<img id="poster" alt="Poster"><p id="text">Loading</p>',
      css: "",
      js: `tessera.connectionImageUrl({ connection: "lists", path: "/poster.png" }).then(
  (url) => {
    const img = document.getElementById("poster");
    img.onload = () => { document.getElementById("text").textContent = "Shown " + img.naturalWidth + " " + url.slice(0, 5); };
    img.src = url;
  },
  (error) => { document.getElementById("text").textContent = "Refused " + error.code; },
);`,
    },
  };
  const title = `Poster ${Math.random().toString(36).slice(2, 7)}`;
  workspaceWith(app.folder, title, poster);
  await page.goto(app.url);
  await page.getByRole("button", { name: new RegExp(`^(Open ${title}|${title}, open)$`) }).click();
  await expect(tool(page).locator("#text")).toHaveText("Shown 1 blob:", TOOL_START);
  expect(seen).toEqual([{ method: "GET", url: "/poster.png", body: "" }]);
  await expect(question(page)).toBeHidden();
});

test("CNX-09 A76: a click in a tool opens a page under its connection in a new tab, with no way back to Tessera", async ({
  page,
}) => {
  seen.length = 0;
  const opener: Artifact = {
    ...listTool,
    code: {
      html: '<button id="watch" type="button">Watch the trailer</button><p id="text">Ready</p>',
      css: "",
      js: `document.getElementById("watch").addEventListener("click", () => {
  tessera.openPage({ connection: "lists", path: "/watch?v=abc" }).then(
    (opened) => { document.getElementById("text").textContent = "Opened " + opened.url; },
    (error) => { document.getElementById("text").textContent = "Refused " + error.code; },
  );
});`,
    },
  };
  const title = `Trailer ${Math.random().toString(36).slice(2, 7)}`;
  workspaceWith(app.folder, title, opener);
  await page.goto(app.url);
  await page.getByRole("button", { name: new RegExp(`^(Open ${title}|${title}, open)$`) }).click();
  await expect(tool(page).locator("#text")).toHaveText("Ready", TOOL_START);
  const popup = page.context().waitForEvent("page");
  await tool(page).getByRole("button", { name: "Watch the trailer" }).click();
  const opened = await popup;
  await opened.waitForLoadState();
  expect(opened.url()).toBe(`${origin}/watch?v=abc`);
  expect(await opened.evaluate(() => window.opener === null)).toBe(true);
  await expect(tool(page).locator("#text")).toHaveText(`Opened ${origin}/watch?v=abc`);
  await opened.close();
});

test("CNX-09 A76: a page asked for when the click has lapsed opens nothing, and the tool hears why (#371 review)", async ({
  page,
}) => {
  // Playwright turns Chrome's popup blocker off, so this checks the host's own rule: the click's
  // activation, which lasts about five seconds, must still be there (navigator.userActivation).
  const late: Artifact = {
    ...listTool,
    code: {
      html: '<button id="later" type="button">Open it later</button><p id="text">Ready</p>',
      css: "",
      js: `document.getElementById("later").addEventListener("click", () => {
  document.getElementById("text").textContent = "Waiting";
  setTimeout(() => {
    tessera.openPage({ connection: "lists", path: "/watch?v=late" }).then(
      () => { document.getElementById("text").textContent = "Opened"; },
      (error) => { document.getElementById("text").textContent = "Refused " + error.code; },
    );
  }, 6000);
});`,
    },
  };
  const title = `Late ${Math.random().toString(36).slice(2, 7)}`;
  workspaceWith(app.folder, title, late);
  await page.goto(app.url);
  await page.getByRole("button", { name: new RegExp(`^(Open ${title}|${title}, open)$`) }).click();
  await expect(tool(page).locator("#text")).toHaveText("Ready", TOOL_START);
  const opened: string[] = [];
  page.context().on("page", (p) => opened.push(p.url()));
  await tool(page).getByRole("button", { name: "Open it later" }).click();
  // Nothing touches the page while the click lapses: Playwright's own reads of a page count as
  // the person acting, and would keep it active. The tool asks at 6 s; the click lasts about 5.
  await page.waitForTimeout(8_000);
  await expect(tool(page).locator("#text")).toHaveText("Refused not-allowed");
  expect(opened).toEqual([]);
});
