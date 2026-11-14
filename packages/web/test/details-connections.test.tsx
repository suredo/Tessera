import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { requestText, ToolConnections } from "../src/Details.tsx";
import { en } from "../src/i18n/en.ts";

// The details view's connections (ADR 0015 point 7, A72): each the tool was made to use, by name,
// with what it may do through it in plain words, and Take back only where its changes are allowed.

const render = (connections: Parameters<typeof ToolConnections>[0]["connections"]) =>
  renderToStaticMarkup(
    <ToolConnections connections={connections} onTakeBack={() => Promise.resolve()} />,
  );

it("CNX-07 A72: each connection says what the tool may do through it, and only an allowed one can be taken back", () => {
  const html = render([
    { name: "gone", added: false, writesAllowed: false },
    { name: "lists", added: true, writesAllowed: true },
    { name: "movies", added: true, writesAllowed: false },
  ]);
  expect(html).toContain(en["details.connectionsHeading"]);
  expect(html).toContain(`<strong>gone</strong>: ${en["details.connection.missing"]}`);
  expect(html).toContain(`<strong>lists</strong>: ${en["details.connection.allowed"]}`);
  expect(html).toContain(`<strong>movies</strong>: ${en["details.connection.asks"]}`);
  expect(html.match(/<button/g)).toHaveLength(1);
  expect(html).toContain('aria-label="Take back its permission to change things through lists"');
});

it("A72: a tool with no connections says so", () => {
  expect(render([])).toContain(en["details.connection.none"]);
});

it("OBS-01 GEN-08 A73: each recent request says when, what was asked and where, through which connection, and how it ended, in plain words", () => {
  const html = renderToStaticMarkup(
    <ToolConnections
      connections={[{ name: "lists", added: true, writesAllowed: true }]}
      requests={[
        {
          connection: "lists",
          method: "POST",
          address: "https://api.example.com/items",
          at: "2026-11-14T10:00:00.000Z",
          outcome: { kind: "answered", statusCode: 201 },
        },
        {
          connection: "lists",
          method: "DELETE",
          address: "https://api.example.com/items/1",
          at: "2026-11-14T09:00:00.000Z",
          outcome: { kind: "refused", code: "needs-permission" },
        },
      ]}
      onTakeBack={() => Promise.resolve()}
    />,
  );
  expect(html).toContain(en["details.connectionRequestsHeading"]);
  expect(html).toContain(
    "Asked to send something to https://api.example.com/items through lists. It answered 201.",
  );
  expect(html).toContain(
    "Asked to delete something at https://api.example.com/items/1 through lists. It waited for your permission; nothing was sent.",
  );
  expect(
    requestText({
      connection: "movies",
      method: "GET",
      address: "https://api.example.com/search",
      at: "2026-11-14T08:00:00.000Z",
      outcome: { kind: "refused", code: "stale" },
    }),
  ).toContain(
    "Asked to read https://api.example.com/search through movies. Refused; nothing was sent.",
  );
  // An error answer never reads as done (GEN-08).
  expect(
    requestText({
      connection: "lists",
      method: "DELETE",
      address: "https://api.example.com/items/1",
      at: "2026-11-14T08:00:00.000Z",
      outcome: { kind: "answered", statusCode: 403 },
    }),
  ).toContain(
    "Asked to delete something at https://api.example.com/items/1 through lists. It answered 403, an error, so it may not have done it.",
  );
});

it("A73: with no requests yet, no requests part is shown", () => {
  expect(render([])).not.toContain(en["details.connectionRequestsHeading"]);
});
