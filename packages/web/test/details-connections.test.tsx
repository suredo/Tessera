import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ToolConnections } from "../src/Details.tsx";
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
