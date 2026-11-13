import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { StyleNotes } from "../src/Details.tsx";
import { en } from "../src/i18n/en.ts";

// The details view says where the current version's look differs from Tessera's UI standard
// (VER-06, A63), as notes kept where the person asked for them, and says nothing when there are none.

it("VER-06 A63: the style notes are listed under their heading, and none shows nothing", () => {
  const html = renderToStaticMarkup(<StyleNotes notes={[".btn: its own colour", "2 more"]} />);
  expect(html).toContain(en["details.styleNotes"].replace("'", "&#x27;"));
  expect(html).toContain("<li>.btn: its own colour</li>");
  expect(html).toContain("<li>2 more</li>");
  expect(renderToStaticMarkup(<StyleNotes notes={[]} />)).toBe("");
});
