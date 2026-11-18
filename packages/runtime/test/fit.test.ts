import { describe, expect, it } from "vitest";
import {
  allowFit,
  FIT_CHANGES,
  FIT_MAX_PX,
  NEW_FIT,
  nextFit,
  settleFit,
  type Fit,
} from "../src/index.ts";

// How the tool panel fits its page (APP-01, A89): the page's height is only the tool's word, so
// the host bounds it, and follows it a few times on each allowance, which the tool's start and the
// person's use of it give: a page whose height follows its frame's can't keep the panel changing.

/** The fit after each reported height in turn, from `from`. */
const after = (heights: unknown[], from: Fit = NEW_FIT) =>
  heights.reduce<Fit>((fit, height) => nextFit(fit, { height }), from);

describe("fitting the tool panel to its page (A89)", () => {
  it("APP-01, A89: takes the page's height, rounded up, growing and shrinking with it", () => {
    expect(after([812.4]).height).toBe(813);
    expect(after([500, 900]).height).toBe(900);
    expect(after([900, 400]).height).toBe(400);
    // The same height again costs nothing.
    expect(after([500, 500, 500, 500, 500, 600]).height).toBe(600);
  });

  it("A89: drops anything but a positive number, and is the cap at most", () => {
    const fit = after([600]);
    for (const bad of [null, "tall", {}, { height: "900" }, { height: -5 }, { height: 0 }]) {
      expect(nextFit(fit, bad)).toBe(fit);
    }
    expect(nextFit(fit, { height: Number.POSITIVE_INFINITY })).toBe(fit);
    expect(nextFit(fit, { height: 1e9 }).height).toBe(FIT_MAX_PX);
  });

  it("A89: a page that grows with its frame, however slowly, is followed a few times, then settles once", () => {
    const heights = Array.from({ length: 20 }, (_, i) => 352 + 32 * i);
    const held = after(heights);
    expect(held.height).toBe(heights[FIT_CHANGES - 1]);
    expect(held.pending).toBe(heights.at(-1));
    // Quiet, the last held height is applied once; the page's answer to it waits.
    const settled = settleFit(held);
    expect(settled.height).toBe(heights.at(-1));
    const answered = nextFit(settled, { height: heights.at(-1)! + 32 });
    expect(answered).toMatchObject({ height: heights.at(-1), pending: heights.at(-1)! + 32 });
    expect(settleFit(answered)).toBe(answered);
  });

  it("A89: a page flipping between two heights with its frame stops too", () => {
    const flipping = after([332, 532, 332, 532, 332, 532, 332]);
    expect(flipping).toMatchObject({ left: 0, height: 532, pending: 332 });
    // Settled once to the held height, its answer waits: the panel stops changing.
    const settled = settleFit(flipping);
    const answered = after([532, 332, 532], settled);
    expect(answered.height).toBe(settled.height);
    expect(settleFit(answered)).toBe(answered);
  });

  it("A89: the person's use gives a new allowance, applying a held height at once", () => {
    const held = settleFit(after([400, 440, 480, 520, 560, 600]));
    const waiting = nextFit(held, { height: 640 });
    expect(waiting.height).toBe(600);
    const used = allowFit(waiting);
    expect(used.height).toBe(640);
    // Rows the person adds, each after a use, keep fitting; a shrink too.
    let fit = used;
    for (const height of [680, 720, 200]) fit = nextFit(allowFit(fit), { height });
    expect(fit.height).toBe(200);
  });

  it("A89: a tool's start, with its first few changes, fits whole", () => {
    expect(after([320, 900, 1400]).height).toBe(1400);
    expect(after([320, 900, 1400]).pending).toBeUndefined();
  });
});
