import { z } from "zod";

// The chart helper's spec (CAP-04, ADR 0014): what a tool asks `tessera.chart(element, spec)` to
// draw. It is declarative, with no colors or fonts, which come from the tool's styles (VER-06);
// one definition for the page's check of a spec, the prompt and the behavior check's reading.

export const CHART_TYPES = ["bar", "line", "pie", "doughnut"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

/** How much a spec may hold: labels, series, and the length of a title and of other text. */
export const CHART_LIMITS = { labels: 200, series: 6, title: 120, text: 80 } as const;

/**
 * The first thing wrong with `spec`, in plain words, or null when the helper can draw it. It is the
 * spec's rules in one place: the schema below applies it, and the server writes its source into
 * the tool's page, where the helper applies it before drawing (P3). So it stands alone, using only
 * its arguments and the language, and its types are only ones that erase.
 */
export function checkChartSpec(
  spec: unknown,
  limits: { labels: number; series: number; title: number; text: number } = CHART_LIMITS,
  types: readonly string[] = CHART_TYPES,
): string | null {
  const isText = (value: unknown, most: number) =>
    typeof value === "string" && value.length > 0 && value.length <= most;
  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  if (!isObject(spec)) return "the spec must be an object.";
  const extra = Object.keys(spec).find(
    (key) => !["type", "title", "labels", "series"].includes(key),
  );
  if (extra !== undefined) return `it has "${extra.slice(0, 40)}", which a spec doesn't take.`;
  const type = spec["type"];
  if (typeof type !== "string" || !types.includes(type)) {
    return `its type must be one of ${types.join(", ")}.`;
  }
  if (!isText(spec["title"], limits.title)) {
    return `its title must be text of 1 to ${limits.title} characters.`;
  }
  const labels = spec["labels"];
  if (!Array.isArray(labels) || labels.length < 1 || labels.length > limits.labels) {
    return `it needs 1 to ${limits.labels} labels.`;
  }
  // Index by index, so a hole in an array counts as the nothing it is.
  for (let i = 0; i < labels.length; i += 1) {
    if (!isText(labels[i], limits.text)) {
      return `each label must be text of 1 to ${limits.text} characters.`;
    }
  }
  const series = spec["series"];
  if (!Array.isArray(series) || series.length < 1 || series.length > limits.series) {
    return `it needs 1 to ${limits.series} series.`;
  }
  if ((type === "pie" || type === "doughnut") && series.length !== 1) {
    return `a ${type} chart has exactly one series.`;
  }
  for (let i = 0; i < series.length; i += 1) {
    const one: unknown = series[i];
    if (!isObject(one)) return "each series must be an object.";
    const odd = Object.keys(one).find((key) => key !== "name" && key !== "values");
    if (odd !== undefined)
      return `a series has "${odd.slice(0, 40)}", which a series doesn't take.`;
    const name = one["name"];
    if (!isText(name, limits.text)) {
      return `each series' name must be text of 1 to ${limits.text} characters.`;
    }
    const values = one["values"];
    const lacking = `series "${name as string}" needs one number for each of its ${labels.length} labels.`;
    if (!Array.isArray(values) || values.length !== labels.length) return lacking;
    for (let j = 0; j < values.length; j += 1) {
      const value: unknown = values[j];
      if (typeof value !== "number" || !Number.isFinite(value)) return lacking;
    }
  }
  return null;
}

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
  // The rules that tie fields together, and every other, as the page applies them.
  .superRefine((spec, context) => {
    const problem = checkChartSpec(spec);
    if (problem) context.addIssue({ code: "custom", message: problem });
  })
  .describe("A chart for tessera.chart to draw (CAP-04).");
export type ChartSpec = z.infer<typeof chartSpecSchema>;
