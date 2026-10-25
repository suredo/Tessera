import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { App, EmptyState, en } from "../src/index.ts";

const shownText = (html: string) => [...html.matchAll(/>([^<]+)</g)].map((m) => m[1]);

it("APP-02: the first-run screen shows exactly the English host text, from the translation layer (UX-05)", () => {
  expect(shownText(renderToStaticMarkup(<EmptyState />))).toEqual([
    en["home.heading"],
    en["home.intro"],
    en["home.status"],
  ]);
});

it("UX-05: while it opens, the app says so in the host's words", () => {
  expect(shownText(renderToStaticMarkup(<App />))).toEqual([en["app.loading"]]);
});
