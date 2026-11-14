import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { Connection } from "@tessera/contracts";
import { Connections, emptyFields, keyText, readFields } from "../src/Connections.tsx";
import { en } from "../src/i18n/en.ts";

// The connections section (CAP-02, A71): what the add form accepts and refuses, in plain words,
// and how the list shows each connection, never its key.

const fields = (change: Partial<ReturnType<typeof emptyFields>>) => ({
  ...emptyFields(),
  name: "movies",
  addresses: ["https://api.example.com"],
  key: "secret-1",
  ...change,
});

it("CAP-02 A71: a header key is the default, as Authorization: Bearer", () => {
  expect(readFields(fields({}))).toEqual({
    ok: true,
    input: {
      name: "movies",
      origins: ["https://api.example.com"],
      auth: { kind: "header", name: "Authorization", prefix: "Bearer " },
      key: "secret-1",
    },
  });
});

it("CAP-02: no key and a key in the address are the other two choices", () => {
  expect(readFields(fields({ keyWay: "none", key: "ignored" }))).toEqual({
    ok: true,
    input: {
      name: "movies",
      origins: ["https://api.example.com"],
      auth: { kind: "none" },
      key: null,
    },
  });
  const query = readFields(fields({ keyWay: "query", queryName: " apikey " }));
  expect(query.ok && query.input.auth).toEqual({ kind: "query", name: "apikey" });
});

it("CAP-02: addresses are kept as origins, each once, and empty rows are left out", () => {
  const read = readFields(
    fields({
      addresses: [
        " HTTPS://API.Example.com/ ",
        "",
        "https://api.example.com",
        "http://127.0.0.1:8080",
      ],
    }),
  );
  expect(read.ok && read.input.origins).toEqual([
    "https://api.example.com",
    "http://127.0.0.1:8080",
  ]);
});

it("CAP-02 GEN-12: each refusal says what to fix, in plain words", () => {
  const problem = (change: Partial<ReturnType<typeof emptyFields>>) => {
    const read = readFields(fields(change));
    return read.ok ? "" : read.problem;
  };
  expect(problem({ name: "My Movies" })).toBe(en["connections.badName"]);
  expect(problem({ addresses: ["", " "] })).toBe(en["connections.noAddress"]);
  for (const address of [
    "api.example.com",
    "https://api.example.com/v3",
    "https://api.example.com?x=1",
    "ftp://files.example.com",
    "https://someone@api.example.com",
    // Paths the URL parser would remove before anyone saw them (#363 review).
    "https://api.example.com/v3/..",
    "https://api.example.com/%2e",
    "https://api.example.com/.",
    "https://api.example.com//",
    "https://api.example.com\\v3",
    "https://api.example.com/#",
  ]) {
    expect(problem({ addresses: [address] })).toContain(address);
  }
  expect(problem({ key: "  " })).toBe(en["connections.badKey"]);
  expect(problem({ headerName: "Bad header" })).toBe(en["connections.badHeader"]);
  expect(problem({ headerPrefix: "x".repeat(41) })).toBe(en["connections.badPrefix"]);
  expect(problem({ keyWay: "query", queryName: "" })).toBe(en["connections.badParameter"]);
});

const listed: Connection[] = [
  {
    name: "movies",
    origins: ["https://api.example.com", "https://images.example.com"],
    auth: { kind: "header", name: "Authorization", prefix: "Bearer " },
    hasKey: true,
    addedAt: "2026-11-14T10:00:00.000Z",
  },
  {
    name: "lights",
    origins: ["http://192.168.1.20"],
    auth: { kind: "none" },
    hasKey: false,
    addedAt: "2026-11-14T11:00:00.000Z",
  },
];

it("CAP-02 OBS-01: the list shows each connection's addresses and how its key is sent, never a key", () => {
  const html = renderToStaticMarkup(
    <Connections
      connections={listed}
      onAdd={() => Promise.resolve(true)}
      onRemove={() => Promise.resolve()}
    />,
  );
  expect(html).toContain("https://images.example.com");
  expect(html).toContain("Key kept, sent in the Authorization header");
  expect(html).toContain(en["connections.noKey"]);
  expect(html).toContain('aria-label="Remove lights"');
  expect(keyText({ ...listed[0]!, auth: { kind: "query", name: "api_key" } })).toBe(
    "Key kept, sent in the address as api_key",
  );
  expect(keyText({ ...listed[0]!, hasKey: false })).toBe(en["connections.keyMissing"]);
});

it("CAP-02 A71: the add form offers the three choices, header chosen, and asks for the key hidden", () => {
  const html = renderToStaticMarkup(
    <Connections
      connections={[]}
      adding
      onAdd={() => Promise.resolve(true)}
      onRemove={() => Promise.resolve()}
    />,
  );
  expect(html).toContain(en["connections.none"]);
  expect(html.match(/type="radio"/g)).toHaveLength(3);
  expect(html).toMatch(/type="radio"[^>]*checked=""[^>]*\/>\s*Yes, in a header/);
  expect(html).toContain('value="Authorization"');
  expect(html).toContain('type="password"');
});
