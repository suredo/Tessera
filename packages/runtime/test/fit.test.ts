import { describe, expect, it } from "vitest";
import { FIT_MAX_PX, FIT_RUNAWAY_MS, nextFit, type Fit } from "../src/index.ts";

// How the tool panel fits its page (APP-01, A89): the page's height is only the tool's word, so
// the host bounds it, and stops a page that grows with its frame.

const start: Fit = { frozen: false };
/** The fit after each report in turn, `ms` apart. */
const after = (reports: unknown[], ms = 16, from = start) =>
  reports.reduce<Fit>((fit, report, i) => nextFit(fit, report, i * ms), from);

describe("fitting the tool panel to its page (A89)", () => {
  it("APP-01, A89: takes the page's height, rounded up, growing and shrinking with it", () => {
    expect(after([{ height: 812.4 }]).height).toBe(813);
    expect(after([{ height: 500 }, { height: 900 }]).height).toBe(900);
    expect(after([{ height: 900 }, { height: 400 }]).height).toBe(400);
  });

  it("A89: drops anything but a positive number, and grows to the cap at most", () => {
    const fit = after([{ height: 600 }]);
    for (const bad of [null, "tall", {}, { height: "900" }, { height: -5 }, { height: 0 }]) {
      expect(nextFit(fit, bad, 1000)).toBe(fit);
    }
    expect(nextFit(fit, { height: Number.POSITIVE_INFINITY }, 1000)).toBe(fit);
    expect(nextFit(fit, { height: 1e9 }, 1000).height).toBe(FIT_MAX_PX);
  });

  it("A89: two equal growths in a moment stop the growing; shrinking still applies", () => {
    // A page as tall as its frame plus 32 px of padding, each growth asking for the next.
    const frozen = after([{ height: 352 }, { height: 384 }, { height: 416 }]);
    expect(frozen).toMatchObject({ height: 384, frozen: true });
    expect(nextFit(frozen, { height: 2000 }, 100).height).toBe(384);
    expect(nextFit(frozen, { height: 300 }, 100).height).toBe(300);
  });

  it("A89: equal growths far apart, as rows the person adds, keep growing", () => {
    const fit = after(
      [{ height: 400 }, { height: 440 }, { height: 480 }, { height: 520 }],
      FIT_RUNAWAY_MS + 1,
    );
    expect(fit).toMatchObject({ height: 520, frozen: false });
    // Unequal growths close together, as a page still laying out, keep growing too.
    expect(after([{ height: 400 }, { height: 700 }, { height: 1100 }])).toMatchObject({
      height: 1100,
      frozen: false,
    });
  });
});
