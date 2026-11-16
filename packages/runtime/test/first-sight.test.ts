import type { JsonValue } from "@tessera/contracts";
import { describe, expect, it } from "vitest";
import { entryTexts, pastDates, statedEntries } from "../src/index.ts";
import type { DriveField } from "../src/protocol.ts";

// The first-sight check's reading of a new tool's starting data and date fields (UX-01, GEN-05,
// A85). The check itself runs in Chrome, in the browser tests.

describe("what a new tool should show at first sight (UX-01, A85)", () => {
  it("GEN-05: the request's entries are the starting data's records beyond the defaults', examples apart", () => {
    const defaults = { items: [{ id: "d-1", title: "Dairy" }], settings: { sort: "name" } };
    const starting: Record<string, JsonValue> = {
      items: [
        { id: "d-1", title: "Dairy" },
        { id: "i-1", title: "Milk" },
        { id: "e-1", title: "Bread", example: true },
      ],
      settings: { sort: "name" },
      guests: [{ id: "g-1", name: "Ana" }],
    };
    expect(statedEntries(defaults, starting)).toEqual({
      entries: [
        { id: "i-1", title: "Milk" },
        { id: "g-1", name: "Ana" },
      ],
      examples: [{ id: "e-1", title: "Bread", example: true }],
    });
    expect(statedEntries(defaults, defaults)).toEqual({ entries: [], examples: [] });
  });

  it("UX-01: an entry shows as its texts other than its ID, folded and cut as a page may show them", () => {
    expect(
      entryTexts({
        id: "Some ID",
        title: "  Grande  Sertão:\nVeredas ",
        note: "x".repeat(100),
        count: 3,
        code: "42",
        done: false,
      }),
    ).toEqual(["grande sertão: veredas", "x".repeat(60)]);
  });

  it("RUN-07, L-63: a date field that starts before today is found, by day or by month; an empty one isn't", () => {
    const field = (type: string, value: string): DriveField => ({
      kind: "input",
      type,
      name: "",
      required: false,
      checked: false,
      min: "",
      max: "",
      step: "",
      maxLength: -1,
      choices: [],
      value,
    });
    const today = "2026-11-15";
    expect(
      pastDates(
        [
          field("date", "2026-11-14"),
          field("date", "2026-11-15"),
          field("date", ""),
          field("datetime-local", "2024-01-01T09:00"),
          field("datetime-local", "2026-11-20T09:00"),
          field("month", "2026-10"),
          field("month", "2026-11"),
          field("week", "2020-W01"),
        ],
        today,
      ),
    ).toEqual(["2026-11-14", "2024-01-01T09:00", "2026-10"]);
  });
});
