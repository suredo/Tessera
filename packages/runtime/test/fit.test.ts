import { describe, expect, it } from "vitest";
import {
  FIT_ANSWER_MS,
  FIT_ANSWERS,
  FIT_MAX_PX,
  NEW_FIT,
  nextFit,
  settleFit,
  type Fit,
} from "../src/index.ts";

// How the tool panel fits its page (APP-01, A89): the page's height is only the tool's word, so
// the host bounds it, and holds back the heights of a page that answers each resize with a new one.

/** The fit after each [height, at ms] report in turn, from `from`. */
const after = (reports: [unknown, number][], from: Fit = NEW_FIT) =>
  reports.reduce<Fit>((fit, [height, at]) => nextFit(fit, { height }, at), from);
/** Reports `ms` apart, from 0. */
const every = (ms: number, heights: unknown[]) =>
  heights.map((height, i): [unknown, number] => [height, i * ms]);
const apart = FIT_ANSWER_MS + 100;

describe("fitting the tool panel to its page (A89)", () => {
  it("APP-01, A89: takes the page's height, rounded up, growing and shrinking with it", () => {
    expect(after([[812.4, 0]]).height).toBe(813);
    expect(after(every(apart, [500, 900])).height).toBe(900);
    expect(after(every(apart, [900, 400])).height).toBe(400);
  });

  it("A89: drops anything but a positive number, and is the cap at most", () => {
    const fit = after([[600, 0]]);
    for (const bad of [null, "tall", {}, { height: "900" }, { height: -5 }, { height: 0 }]) {
      expect(nextFit(fit, bad, 5000)).toBe(fit);
    }
    expect(nextFit(fit, { height: Number.POSITIVE_INFINITY }, 5000)).toBe(fit);
    expect(nextFit(fit, { height: 1e9 }, 5000).height).toBe(FIT_MAX_PX);
  });

  it("A89: a page that grows with its frame is held back after a few resizes, then settles once", () => {
    // Each resize answered at once with 32 px more: the frame would grow for ever.
    const heights = Array.from({ length: 10 }, (_, i) => 352 + 32 * i);
    const held = after(every(16, heights));
    expect(held.held).toBe(true);
    expect(held.height).toBe(352 + 32 * (FIT_ANSWERS - 1));
    // Quiet, the last held height is applied once; the page's answer to it stays held.
    const settled = settleFit(held, 1000);
    expect(settled.height).toBe(heights.at(-1));
    const answered = nextFit(settled, { height: heights.at(-1)! + 32 }, 1016);
    expect(answered).toMatchObject({ height: heights.at(-1), held: true });
    expect(settleFit(answered, 2000)).toBe(answered);
  });

  it("A89: a page flipping between two heights with its frame is held back too", () => {
    const flipping = after(every(16, [332, 532, 332, 532, 332, 532, 332, 532]));
    expect(flipping.held).toBe(true);
    expect(flipping.answers).toBeGreaterThanOrEqual(FIT_ANSWERS);
  });

  it("A89: rows in quick steps end at the full height, and later changes still fit", () => {
    // 400, 440, 480 at 100 ms: held back after the third, then settled to the last.
    const quick = after(every(100, [400, 440, 480, 520]));
    expect(settleFit(quick, 1000).height).toBe(520);
    // A change well after the last resize is the tool's own: it applies and ends the holding back.
    const later = nextFit(settleFit(quick, 1000), { height: 200 }, 3000);
    expect(later).toMatchObject({ height: 200, held: false });
    expect(nextFit(later, { height: 800 }, 6000).height).toBe(800);
  });

  it("A89: rows the person adds, far apart, keep growing it", () => {
    expect(after(every(apart, [400, 440, 480, 520, 560]))).toMatchObject({
      height: 560,
      held: false,
    });
  });
});
