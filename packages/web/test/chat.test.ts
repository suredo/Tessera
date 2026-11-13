import { CHAT_TEXT_LIMIT, type ChatMessage } from "@tessera/contracts";
import { describe, expect, it } from "vitest";
import { fitted, mergeKept, shown } from "../src/chat.ts";

// The chat's state in the host app (APP-01, APP-03): kept messages merged once each, in order;
// a reply fitted to what the chat keeps; and each screen showing its own messages.

const kept = (number: number, text: string): ChatMessage => ({
  number,
  from: number % 2 ? "person" : "tessera",
  text,
  at: "2026-11-06T12:00:00.000Z",
});

describe("the chat in the host app (APP-01)", () => {
  it("APP-03: merges kept messages once each, by number, in order", () => {
    const list = [kept(1, "A list"), kept(2, "Ready.")];
    expect(mergeKept(list, [kept(2, "Ready."), kept(4, "Updated."), kept(3, "Add bread")])).toEqual(
      [kept(1, "A list"), kept(2, "Ready."), kept(3, "Add bread"), kept(4, "Updated.")],
    );
  });

  it("CON-01: fits a reply to the longest message the chat keeps, and leaves a shorter one", () => {
    expect(fitted("Ready.")).toBe("Ready.");
    const long = fitted("x".repeat(CHAT_TEXT_LIMIT + 50));
    expect(long).toHaveLength(CHAT_TEXT_LIMIT);
    expect(long.endsWith("…")).toBe(true);
  });

  it("APP-03: shows a workspace's kept messages, then what isn't kept yet; the empty screen its own", () => {
    const asking = { from: "person" as const, text: "Make it blue" };
    const state = {
      kept: { a: [kept(1, "A list"), kept(2, "Ready.")] },
      local: { a: [asking], "": [{ from: "person" as const, text: "Do the thing" }] },
    };
    expect(shown(state, "a").map((m) => m.text)).toEqual(["A list", "Ready.", "Make it blue"]);
    expect(shown(state, null).map((m) => m.text)).toEqual(["Do the thing"]);
    expect(shown(state, "b")).toEqual([]);
  });

  it("A62, APP-03: the empty screen shows its kept messages too, then what isn't kept yet", () => {
    const state = {
      kept: { "": [kept(1, "milk, eggs, bread"), kept(2, "Not sure what to make.")] },
      local: { "": [{ from: "person" as const, text: "Remove what I just listed" }] },
    };
    expect(shown(state, null).map((m) => m.text)).toEqual([
      "milk, eggs, bread",
      "Not sure what to make.",
      "Remove what I just listed",
    ]);
  });
});
