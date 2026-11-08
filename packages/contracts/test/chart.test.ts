import { describe, expect, it } from "vitest";
import { CHART_LIMITS, chartSpecSchema, checkChartSpec } from "../src/index.ts";

// The chart helper's spec (CAP-04, ADR 0014): one set of rules, checkChartSpec, which the schema
// applies and the server writes into the tool's page (P3). The two must agree on every spec, those
// JavaScript can make that JSON can't, such as arrays with holes, included.

const good = {
  type: "bar",
  title: "Spending this month",
  labels: ["Rent", "Food"],
  series: [{ name: "Spent", values: [1200, 450] }],
};
const series = (values: unknown) => [{ name: "Spent", values }];
// eslint-disable-next-line no-sparse-arrays -- a hole is the point
const holed = [1200, , 450];
const word = (length: number) => "x".repeat(length);

const cases: [string, unknown][] = [
  ["a bar chart", good],
  [
    "a line chart with two series",
    { ...good, type: "line", series: [...good.series, { name: "Planned", values: [1000, 500] }] },
  ],
  ["a pie chart", { ...good, type: "pie" }],
  [
    "the most of everything",
    {
      ...good,
      title: word(CHART_LIMITS.title),
      labels: Array.from({ length: CHART_LIMITS.labels }, (_, i) => `L${i}`),
      series: Array.from({ length: CHART_LIMITS.series }, (_, i) => ({
        name: word(CHART_LIMITS.text),
        values: Array.from({ length: CHART_LIMITS.labels }, () => i),
      })),
    },
  ],
  ["null", null],
  ["an array", [good]],
  ["an extra key", { ...good, colors: ["red"] }],
  ["an unknown type", { ...good, type: "radar" }],
  ["an empty title", { ...good, title: "" }],
  ["a title too long", { ...good, title: word(CHART_LIMITS.title + 1) }],
  ["no labels", { ...good, labels: [], series: series([]) }],
  [
    "too many labels",
    {
      ...good,
      labels: Array.from({ length: CHART_LIMITS.labels + 1 }, () => "a"),
      series: series(Array.from({ length: CHART_LIMITS.labels + 1 }, () => 1)),
    },
  ],
  ["an empty label", { ...good, labels: ["", "Food"] }],
  ["a label too long", { ...good, labels: [word(CHART_LIMITS.text + 1), "Food"] }],
  // eslint-disable-next-line no-sparse-arrays -- a hole is the point
  ["a hole in the labels", { ...good, labels: [, "Food"] }],
  ["no series", { ...good, series: [] }],
  [
    "too many series",
    { ...good, series: Array.from({ length: CHART_LIMITS.series + 1 }, () => good.series[0]) },
  ],
  [
    "a pie with two series",
    { ...good, type: "doughnut", series: [...good.series, ...good.series] },
  ],
  ["a series that isn't an object", { ...good, series: ["Spent"] }],
  // eslint-disable-next-line no-sparse-arrays -- a hole is the point
  ["a hole in the series", { ...good, series: [, ...good.series] }],
  ["a series with an extra key", { ...good, series: [{ ...good.series[0], color: "red" }] }],
  ["a series without a name", { ...good, series: [{ name: "", values: [1, 2] }] }],
  ["too few values", { ...good, series: series([1]) }],
  ["text for a value", { ...good, series: series([1, "2"]) }],
  ["not a number", { ...good, series: series([1, Number.NaN]) }],
  ["infinity", { ...good, series: series([1, Number.POSITIVE_INFINITY]) }],
  ["a hole in the values", { ...good, labels: ["Rent", "Food", "Fun"], series: series(holed) }],
];

describe("the chart spec (CAP-04)", () => {
  it.each(cases)("CAP-04: the page's rules and the contract agree on %s", (_, spec) => {
    const problem = checkChartSpec(spec);
    expect(chartSpecSchema.safeParse(spec).success).toBe(problem === null);
  });

  it("CAP-04: says in plain words what is wrong", () => {
    expect(
      checkChartSpec({ ...good, labels: ["Rent", "Food", "Fun"], series: series(holed) }),
    ).toBe('series "Spent" needs one number for each of its 3 labels.');
    expect(checkChartSpec({ ...good, type: "pie", series: [...good.series, ...good.series] })).toBe(
      "a pie chart has exactly one series.",
    );
  });

  it("CAP-04: stands alone, so its source runs in the tool's page as it is", () => {
    const source = checkChartSpec.toString();
    // The page's way of getting it, tried here: its source alone, evaluated where nothing else is.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call -- that is the point
    const copy = new Function(`return (${source});`)() as typeof checkChartSpec;
    for (const [, spec] of cases) {
      expect(copy(spec, CHART_LIMITS, ["bar", "line", "pie", "doughnut"])).toBe(
        checkChartSpec(spec),
      );
    }
  });
});
