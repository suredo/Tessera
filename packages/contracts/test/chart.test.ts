import { describe, expect, it } from "vitest";
import {
  CHART_LIMITS,
  chartSpecRelations,
  chartSpecSchema,
  chartSpecShape,
  jsonSchemaOf,
  schemaProblem,
} from "../src/index.ts";

// The chart helper's spec (CAP-04, ADR 0014) has one definition (P3): its zod shape, whose JSON
// Schema the tool's page applies with schemaProblem, and chartSpecRelations, which the schema and
// the page both apply. The page's check and the contract must agree on every spec, those
// JavaScript can make and JSON can't, such as lists with holes and inherited keys, included.

const SCHEMA = jsonSchemaOf(chartSpecShape);
/** The page's check, as the helper makes it. */
const pageCheck = (
  spec: unknown,
  shape: typeof schemaProblem = schemaProblem,
  relations: typeof chartSpecRelations = chartSpecRelations,
) => shape(spec, SCHEMA) ?? relations(spec as Parameters<typeof chartSpecRelations>[0]);

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
  ["an inherited extra key", Object.assign(Object.create({ colors: ["red"] }) as object, good)],
  [
    "an inherited title",
    Object.assign(Object.create({ title: "Spending" }) as object, { ...good, title: undefined }),
  ],
  ["a missing title", { type: good.type, labels: good.labels, series: good.series }],
  // A character beyond Unicode's first plane takes two UTF-16 units, and counts as one.
  ["a title of the most emoji", { ...good, title: "\u{1F4B0}".repeat(CHART_LIMITS.title) }],
  ["a title of too many emoji", { ...good, title: "\u{1F4B0}".repeat(CHART_LIMITS.title + 1) }],
  [
    "a label of the most emoji",
    { ...good, labels: ["\u{1F355}".repeat(CHART_LIMITS.text), "Food"] },
  ],
];

describe("the chart spec (CAP-04)", () => {
  it.each(cases)("CAP-04: the page's rules and the contract agree on %s", (_, spec) => {
    expect(chartSpecSchema.safeParse(spec).success).toBe(pageCheck(spec) === null);
  });

  it("CAP-04: says in plain words what is wrong", () => {
    expect(pageCheck({ ...good, labels: ["Rent", "Food", "Fun"], series: series(holed) })).toBe(
      "item 2 of its series 1's values must be a number.",
    );
    expect(pageCheck({ ...good, series: series([1]) })).toBe(
      'series "Spent" needs one number for each of its 2 labels.',
    );
    expect(pageCheck({ ...good, type: "pie", series: [...good.series, ...good.series] })).toBe(
      "a pie chart has exactly one series.",
    );
    expect(pageCheck({ ...good, colors: ["red"] })).toBe(
      `the spec has "colors", which it doesn't take.`,
    );
  });

  it("CAP-04: its functions stand alone, so their source runs in the tool's page as it is", () => {
    // The page's way of getting them, tried here: their source alone, evaluated where nothing
    // else is.
    const alone = <T>(fn: T): T =>
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call -- that is the point
      new Function(`return (${String(fn)});`)() as T;
    const [shape, relations] = [alone(schemaProblem), alone(chartSpecRelations)];
    for (const [, spec] of cases) expect(pageCheck(spec, shape, relations)).toBe(pageCheck(spec));
  });
});
