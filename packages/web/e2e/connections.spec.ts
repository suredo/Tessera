import { openAppSection, openWorkspaces, closeWorkspaces } from "./support/workspace-actions.ts";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "@playwright/test";
import { listConnections, requestThroughConnection } from "../../server/src/connections/index.ts";
import { en } from "../src/i18n/en.ts";
import { startApp, testTool, workspaceWith, type AppHost } from "./support/app-host.ts";

// The connections section (CAP-02, ADR 0015 point 1, A71), end to end in Chrome (TEST-06): the
// person adds a connection with its key, sees it listed without the key, and removes it once they
// confirm. A fake service on loopback records what the host sends it, so the key is seen to reach
// the service and nothing else. A real Tessera on a temporary data folder (ENG-19). The tests run
// in order: the first needs a Tessera with no workspaces.

let app: AppHost;
let service: http.Server;
let origin = "";
const seen: { url: string; authorization: string }[] = [];
const KEY = "secret-key-7f3a";

test.beforeAll(async () => {
  service = http.createServer((req, res) => {
    seen.push({ url: req.url ?? "", authorization: req.headers.authorization ?? "" });
    res.setHeader("content-type", "application/json");
    res.end('{"results":[]}');
  });
  await new Promise<void>((resolve) => service.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(service.address() as AddressInfo).port}`;
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
  service.closeAllConnections();
  await new Promise((resolve) => service.close(resolve));
});

const section = (page: Page) => page.getByRole("region", { name: en["connections.heading"] });
const form = (page: Page) => page.getByRole("form", { name: en["connections.addHeading"] });
const entry = (page: Page, name: string) =>
  section(page)
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });

test("CAP-02: connections can be added from the first screen, before any tool", async ({
  page,
}) => {
  await page.goto(app.url);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(en["home.heading"]);
  await openAppSection(page, en["nav.connections"]);
  await expect(section(page).getByText(en["connections.none"])).toBeVisible();
});

test("CAP-02 A71: the person adds a connection with a key, which reaches the service and is never shown", async ({
  page,
}) => {
  await page.goto(app.url);
  await openAppSection(page, en["nav.connections"]);
  await page.getByRole("button", { name: en["connections.addOne"] }).click();

  // A header key is chosen at first, as Authorization: Bearer.
  await expect(form(page).getByLabel(en["connections.wayHeader"])).toBeChecked();
  await expect(form(page).getByLabel(en["connections.headerName"], { exact: true })).toHaveValue(
    "Authorization",
  );

  // What the form can check, it says in plain words, and nothing is added.
  await form(page).getByLabel(en["connections.name"], { exact: true }).fill("My Movies");
  await form(page).getByRole("button", { name: en["connections.add"], exact: true }).click();
  await expect(form(page).getByRole("alert")).toHaveText(en["connections.badName"]);
  await form(page).getByLabel(en["connections.name"], { exact: true }).fill("movies");
  await form(page).getByLabel("Address 1").fill(`${origin}/v3`);
  await form(page).getByRole("button", { name: en["connections.add"], exact: true }).click();
  await expect(form(page).getByRole("alert")).toContainText(`${origin}/v3`);
  // The form's words, never the browser's, even for what isn't an address at all (GEN-12).
  await form(page).getByLabel("Address 1").fill("api.example.com");
  await form(page).getByRole("button", { name: en["connections.add"], exact: true }).click();
  await expect(form(page).getByRole("alert")).toContainText("api.example.com isn't an address");
  expect(listConnections(app.folder)).toEqual([]);

  await form(page).getByLabel("Address 1").fill(`${origin}/`);
  await form(page).getByLabel(en["connections.key"], { exact: true }).fill(KEY);
  await form(page).getByRole("button", { name: en["connections.add"], exact: true }).click();

  await expect(page.getByText("movies is added.")).toBeVisible();
  await expect(form(page)).toHaveCount(0);
  await expect(entry(page, "movies")).toContainText(origin);
  await expect(entry(page, "movies")).toContainText("Key kept, sent in the Authorization header");
  expect(listConnections(app.folder)).toMatchObject([
    { name: "movies", origins: [origin], hasKey: true },
  ]);
  // The key is on no screen, and in nothing the page holds.
  expect(await page.content()).not.toContain(KEY);

  // A tool's read through it reaches the service with the key the person gave (ADR 0015 point 2).
  const workspaceId = workspaceWith(app.folder, "Movie finder", testTool("Movies"));
  const tool = { ...testTool("Movies"), connections: { movies: { samples: {} } } };
  await requestThroughConnection(app.folder, workspaceId, tool, "active", {
    connection: "movies",
    method: "GET",
    path: "/search",
  });
  expect(seen).toEqual([{ url: "/search", authorization: `Bearer ${KEY}` }]);

  // A name already taken is refused by the host, in its own words.
  await page.getByRole("button", { name: en["connections.addOne"] }).click();
  await form(page).getByLabel(en["connections.name"], { exact: true }).fill("movies");
  await form(page).getByLabel("Address 1").fill(origin);
  await form(page).getByLabel(en["connections.wayNone"], { exact: true }).check();
  await expect(form(page).getByLabel(en["connections.key"], { exact: true })).toHaveCount(0);
  await form(page).getByRole("button", { name: en["connections.add"], exact: true }).click();
  await expect(page.getByText("There is already a connection called movies.")).toBeVisible();
  await expect(form(page)).toBeVisible();
});
test("CAP-02: removing a connection is confirmed first, and its key goes with it", async ({
  page,
}) => {
  await page.goto(app.url);
  await openAppSection(page, en["nav.connections"]);
  await openWorkspaces(page);
  await expect(page.getByRole("button", { name: en["nav.settings"], exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await closeWorkspaces(page);
  await entry(page, "movies").getByRole("button", { name: "Remove movies" }).click();
  const confirm = entry(page, "movies").getByRole("group");
  await expect(confirm).toContainText("Its key goes with it");
  // Cancel keeps it.
  await confirm.getByRole("button", { name: en["connections.cancel"] }).click();
  expect(listConnections(app.folder)).toHaveLength(1);
  await entry(page, "movies").getByRole("button", { name: "Remove movies" }).click();
  await entry(page, "movies")
    .getByRole("group")
    .getByRole("button", { name: en["connections.remove"], exact: true })
    .click();
  await expect(page.getByText("movies is removed.")).toBeVisible();
  await expect(entry(page, "movies")).toHaveCount(0);
  await expect(section(page).getByText(en["connections.none"])).toBeVisible();
  expect(listConnections(app.folder)).toEqual([]);
});
