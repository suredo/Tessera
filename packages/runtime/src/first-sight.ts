// Docs: docs/code/runtime/package.md
import type { JsonValue } from "@tessera/contracts";
import { clockReading, systemClock } from "./bridge.ts";
import { driveTool, type CheckOutcome, type VerificationCheck } from "./checks.ts";
import type { DriveField } from "./protocol.ts";

// The first-sight check (UX-01, GEN-05, A85): a new tool, opened on its starting data as the
// person will first see it, shows at least one of the entries the request gave, or says its
// examples are examples, and no date field starts before today by the host's clock (RUN-07, L-63).
// Whether the request held entries the model missed is the AI review's (EVAL-03), not this check's.

type Entry = Record<string, JsonValue>;

/** A record's ID as text, whatever it holds. */
const idOf = (record: Entry): string =>
  typeof record["id"] === "string" ? record["id"] : JSON.stringify(record["id"] ?? null);

const isRecord = (value: JsonValue | undefined): value is Entry =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The request's own entries: the records the starting data has in each list beyond the defaults'
 * own, by ID; those marked "example": true apart (A84).
 */
export function statedEntries(
  defaults: Record<string, JsonValue>,
  starting: Record<string, JsonValue>,
): { entries: Entry[]; examples: Entry[] } {
  const entries: Entry[] = [];
  const examples: Entry[] = [];
  for (const [list, records] of Object.entries(starting)) {
    if (!Array.isArray(records)) continue;
    const own = defaults[list];
    const kept = new Set(Array.isArray(own) ? own.filter(isRecord).map(idOf) : []);
    for (const record of records) {
      if (!isRecord(record) || kept.has(idOf(record))) continue;
      (record["example"] === true ? examples : entries).push(record);
    }
  }
  return { entries, examples };
}

/** A text as a person reads it on a page: capitals and repeated spaces aside. */
export const fold = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * What an entry shows a person, as the check looks for it: each of its texts other than its ID
 * with at least two letters, folded, the first 60 characters, as a page may cut a long one.
 */
export function entryTexts(entry: Entry): string[] {
  return Object.entries(entry)
    .filter(([field, value]) => field !== "id" && typeof value === "string")
    .map(([, value]) => fold(value as string).slice(0, 60))
    .filter((text) => /\p{L}.*\p{L}/u.test(text));
}

/**
 * The date fields that start before `today` (YYYY-MM-DD), by their own values: a date or a date
 * and time by its day, a month by its month. A week, or an empty field, is left alone.
 */
export function pastDates(fields: readonly DriveField[], today: string): string[] {
  return fields
    .filter(({ type, value }) => {
      if (value === "") return false;
      if (type === "date" || type === "datetime-local") return value.slice(0, 10) < today;
      if (type === "month") return value.slice(0, 7) < today.slice(0, 7);
      return false;
    })
    .map(({ value }) => value);
}

/** How a page says something is an example, in the languages Tessera speaks and its neighbours'. */
const EXAMPLE = /\b(examples?|exemplos?|ejemplos?|exemples?|beispiele?|esempi|esempio)\b/u;

/**
 * The first-sight check for a new tool, from its candidate's defaults and starting data. It opens
 * the tool on a throwaway copy of its starting data and reads the page as the person sees it.
 */
export const firstSightCheck = (
  defaults: Record<string, JsonValue>,
  starting: Record<string, JsonValue>,
): VerificationCheck => ({
  name: "first-sight",
  async run(context): Promise<CheckOutcome> {
    const tool = await context.opening();
    const report = await driveTool(tool, [{ do: "page" }]);
    const step = report?.steps[0];
    if (!step) return { ok: false, reason: "The tool's page couldn't be read." };
    if (!step.ok) return { ok: false, reason: step.problem };
    const page = fold(step.texts?.[0] ?? "");
    const found: string[] = [];
    let proved = false;

    const { entries, examples } = statedEntries(defaults, starting);
    const texts = entries.flatMap(entryTexts);
    if (texts.length > 0) {
      proved = true;
      if (!texts.some((text) => page.includes(text))) {
        found.push(
          `The request gave entries, such as "${texts[0]}", but the tool shows none of them when it opens. Show the person's entries from data.read at once.`,
        );
      }
    } else if (examples.length > 0) {
      proved = true;
      if (!EXAMPLE.test(page)) {
        found.push(
          "The tool starts with examples but doesn't say they are examples. Label each one as an example.",
        );
      }
    }

    const fields = step.fields ?? [];
    if (fields.length > 0) proved = true;
    const today = clockReading(systemClock.now(), systemClock.timeZone()).date;
    const past = pastDates(fields, today);
    if (past.length > 0) {
      found.push(
        `A date field starts on ${past[0]}, before today, ${today}. Start dates from tessera.call("clock.now"), or leave the field empty.`,
      );
    }
    if (found.length > 0) return { ok: false, reason: found.join(" ") };
    return proved ? { ok: true } : { ok: true, provedNothing: true };
  },
});
