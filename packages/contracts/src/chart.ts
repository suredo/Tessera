import { z } from "zod";

// The chart helper's spec (CAP-04, ADR 0014): what a tool asks `tessera.chart(element, spec)` to
// draw. It is declarative, with no colors or fonts, which come from the tool's styles (VER-06);
// one definition for the page's check of a spec, the prompt and the behavior check's reading.

export const CHART_TYPES = ["bar", "line", "pie", "doughnut"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

/** How much a spec may hold: labels, series, and the length of a title and of other text. */
export const CHART_LIMITS = { labels: 200, series: 6, title: 120, text: 80 } as const;

const text = z.string().min(1).max(CHART_LIMITS.text);

/**
 * A spec's shape: the one definition of its fields and bounds. The server gives the tool's page
 * its JSON Schema, which `schemaProblem` applies there, so the page restates none of it (P3).
 */
export const chartSpecShape = z
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
  .describe("A chart for tessera.chart to draw (CAP-04).");

/**
 * What ties a spec's fields together, which a shape can't say: the first rule a spec of the right
 * shape breaks, in plain words, or null. The schema applies it, and the server writes its source
 * into the tool's page, so it stands alone and its types are only ones that erase (P3).
 */
export function chartSpecRelations(spec: {
  type: string;
  labels: readonly unknown[];
  series: readonly { name: string; values: readonly unknown[] }[];
}): string | null {
  if ((spec.type === "pie" || spec.type === "doughnut") && spec.series.length !== 1) {
    return `a ${spec.type} chart has exactly one series.`;
  }
  for (const one of spec.series) {
    if (one.values.length !== spec.labels.length) {
      return `series "${one.name}" needs one number for each of its ${spec.labels.length} labels.`;
    }
  }
  return null;
}

export const chartSpecSchema = chartSpecShape.superRefine((spec, context) => {
  const problem = chartSpecRelations(spec);
  if (problem) context.addIssue({ code: "custom", message: problem });
});
export type ChartSpec = z.infer<typeof chartSpecSchema>;

/**
 * The first way `value` falls outside `schema`, in plain words, or null: the JSON Schema a zod
 * contract gives, for the kinds it uses (an object with fixed keys, an array, text, a finite number
 * and a fixed choice). It knows no contract, only JSON Schema, and runs in the tool's page, where
 * the server writes its source, so it stands alone and its types are only ones that erase. `where`
 * names the value in what it says.
 */
export function schemaProblem(value: unknown, schema: unknown, where = "the spec"): string | null {
  const rule = (typeof schema === "object" && schema !== null ? schema : {}) as Record<
    string,
    unknown
  >;
  const within = (key: string) => (where === "the spec" ? `its ${key}` : `${where}'s ${key}`);
  if (Array.isArray(rule["enum"])) {
    const choices = rule["enum"] as unknown[];
    return choices.includes(value) ? null : `${where} must be one of ${choices.join(", ")}.`;
  }
  switch (rule["type"]) {
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return `${where} must be an object.`;
      }
      const record = value as Record<string, unknown>;
      const fields = (rule["properties"] ?? {}) as Record<string, unknown>;
      if (rule["additionalProperties"] === false) {
        // Every key it has, its own or inherited, as a zod contract reads them.
        for (const key in record) {
          if (!Object.hasOwn(fields, key)) {
            return `${where} has "${key.slice(0, 40)}", which it doesn't take.`;
          }
        }
      }
      for (const key of (rule["required"] ?? []) as string[]) {
        if (record[key] === undefined) return `${where} needs a ${key}.`;
      }
      for (const key of Object.keys(fields)) {
        if (record[key] === undefined) continue;
        const problem = schemaProblem(record[key], fields[key], within(key));
        if (problem) return problem;
      }
      return null;
    }
    case "array": {
      if (!Array.isArray(value)) return `${where} must be a list.`;
      const least = typeof rule["minItems"] === "number" ? rule["minItems"] : 0;
      const most = typeof rule["maxItems"] === "number" ? rule["maxItems"] : Infinity;
      if (value.length < least || value.length > most) {
        return `${where} must have ${least} to ${most} items.`;
      }
      // Index by index, so a hole in a list counts as the nothing it is. An item that is an object
      // is named by its number, as in "series 2"; another, as in "item 2 of its labels".
      const items = (rule["items"] ?? {}) as Record<string, unknown>;
      for (let i = 0; i < value.length; i += 1) {
        const name = items["type"] === "object" ? `${where} ${i + 1}` : `item ${i + 1} of ${where}`;
        const problem = schemaProblem(value[i], items, name);
        if (problem) return problem;
      }
      return null;
    }
    case "string": {
      const least = typeof rule["minLength"] === "number" ? rule["minLength"] : 0;
      const most = typeof rule["maxLength"] === "number" ? rule["maxLength"] : Infinity;
      return typeof value === "string" && value.length >= least && value.length <= most
        ? null
        : `${where} must be text of ${least} to ${most} characters.`;
    }
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? null
        : `${where} must be a number.`;
    default:
      return null;
  }
}
