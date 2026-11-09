import { describe, expect, it } from "vitest";
import { driveTool, type MountedTool } from "../src/index.ts";

// How the host reads a page's answer to a behavior check's steps (VER-03), without a browser: the
// answer is the page's word, so what it says is checked before a check relies on it. The browser
// tests drive real pages.

/** A stand-in tool whose page answers every drive with `report`. */
const answering = (report: unknown) =>
  ({ drive: () => Promise.resolve(report) }) as unknown as MountedTool;

describe("driveTool", () => {
  it("keeps a dates step's real dates and reads anything else as no date", async () => {
    const report = await driveTool(
      answering({
        problems: [],
        steps: [
          {
            ok: true,
            count: 9,
            dates: [
              "2026-11-12",
              "2024-02-29",
              "2026-02-30",
              "2025-02-29",
              "2026-13-01",
              "0000-01-01",
              "2026-11-12T18:00",
              7,
              null,
            ],
          },
        ],
      }),
      [{ do: "dates", hook: "session" }],
    );
    expect(report?.steps).toEqual([
      {
        ok: true,
        count: 9,
        dates: ["2026-11-12", "2024-02-29", null, null, null, null, null, null, null],
      },
    ]);
  });
});
