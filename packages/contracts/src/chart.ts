import { z } from "zod";

// The chart helper's spec (CAP-04, ADR 0014): what a tool asks `tessera.chart(element, spec)` to
// draw. It is declarative, with no colors or fonts, which come from the tool's styles (VER-06);
// one definition for the page's check of a spec, the prompt and the behavior check's reading.

export const CHART_TYPES = ["bar", "line", "pie", "doughnut"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

/** How much a spec may hold: labels, series, and the length of a title and of other text. */
export const CHART_LIMITS = { labels: 200, series: 6, title: 120, text: 80 } as const;

const text = z.string().min(1).max(CHART_LIMITS.text);

export const chartSpecSchema = z
  .strictObject({
    type: z.enum(CHART_TYPES).describe("bar, line, pie or doughnut."),
    title: z.string().min(1).max(CHART_LIMITS.title).describe("What the chart shows."),
    labels: z
      .array(text)
      .min(1)
      .max(CHART_LIMITS.labels)
      .describe("One per bar, point or slice, in order."),
    series: z
      .array(
        z.strictObject({
          name: text.describe("What these numbers are."),
          values: z.array(z.number().finite()).describe("One number per label, in order."),
        }),
      )
      .min(1)
      .max(CHART_LIMITS.series)
      .describe("A pie or doughnut has exactly one."),
  })
  .superRefine((spec, context) => {
    spec.series.forEach((series, index) => {
      if (series.values.length !== spec.labels.length) {
        context.addIssue({
          code: "custom",
          path: ["series", index, "values"],
          message: `Series "${series.name}" has ${series.values.length} values for ${spec.labels.length} labels.`,
        });
      }
    });
    if ((spec.type === "pie" || spec.type === "doughnut") && spec.series.length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["series"],
        message: `A ${spec.type} chart has exactly one series.`,
      });
    }
  })
  .describe("A chart for tessera.chart to draw (CAP-04).");
export type ChartSpec = z.infer<typeof chartSpecSchema>;
