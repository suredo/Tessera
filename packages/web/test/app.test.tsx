import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { App, en } from "../src/index.ts";

it("the first screen shows exactly the English host text, from the translation layer (UX-05)", () => {
  const html = renderToStaticMarkup(<App />);
  const shown = [...html.matchAll(/>([^<]+)</g)].map((m) => m[1]);
  expect(shown).toEqual([en["home.heading"], en["home.intro"], en["home.status"]]);
});
