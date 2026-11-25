import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Chat } from "../src/Chat.tsx";

it("APP-01: a blank line between paragraphs shows as a gap and stays in the text; one line break doesn't", () => {
  const html = renderToStaticMarkup(
    <Chat messages={[{ from: "tessera", text: "First\nline.\n\nSecond." }]} />,
  );
  expect(html).toContain('First\nline.<span class="chat-gap">\n\n</span>Second.');
});
