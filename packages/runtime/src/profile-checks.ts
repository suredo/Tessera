import { PROFILES, type ProfileId } from "@tessera/contracts";
import {
  driveTool,
  type CheckContext,
  type CheckOutcome,
  type DriveReport,
  type VerificationCheck,
} from "./checks.ts";
import type { MountedTool } from "./host.ts";
import type { DriveField, DriveResult, DriveStep } from "./protocol.ts";

// The verification profiles' behavior checks (VER-03): each drives a candidate that fits its
// profile through the hooks the profile names, in rehearsals whose saves go to a throwaway copy
// (BRG-06), and checks only the rules the profile states, which its prompt part gave the tool
// (VER-04). A failure says what was expected, what was observed and whose rule it is (VER-07).

const clip = (texts: readonly string[]) =>
  texts.length === 0
    ? "none"
    : texts
        .slice(0, 5)
        .map((text) => `"${text.slice(0, 60)}"`)
        .join(", ") + (texts.length > 5 ? ` and ${texts.length - 5} more` : "");

/** "1 item", "3 items". */
const items = (count: number) => `${count} ${count === 1 ? "item" : "items"}`;

/** A failure of a profile's rule, as repair and the details view read it (VER-07). */
const broke = (profile: ProfileId, rule: string, expected: string, observed: string) =>
  ({
    ok: false,
    reason: `The ${profile} check, a rule of Tessera's (${rule}): expected ${expected}; observed ${observed}.`,
  }) as const;

/** Drives `tool` and gives each step's result, or a failure saying what couldn't be done. */
async function drive(
  profile: ProfileId,
  rule: string,
  tool: MountedTool,
  steps: readonly DriveStep[],
): Promise<{ steps: DriveResult[] } | CheckOutcome> {
  const report: DriveReport | undefined = await driveTool(tool, steps);
  if (!report) return { ok: false, reason: "The tool's answer to the check couldn't be read." };
  const failed = report.steps.find((step) => !step.ok);
  if (failed && !failed.ok) {
    return broke(profile, rule, "the elements its hooks name, as the prompt asked", failed.problem);
  }
  if (report.steps.length < steps.length) {
    return { ok: false, reason: "The tool's answer to the check couldn't be read." };
  }
  if (report.problems.length > 0) {
    return broke(profile, rule, "no errors", report.problems.join(" "));
  }
  return { steps: report.steps };
}

/** How many texts a read reports: a longer list is read a page at a time. */
const PAGE = 100;

type List = { count: number; texts: string[] };

/**
 * Every item `hook` marks, with its text: read a page at a time, each read bounded, so a list of
 * any length the data limit allows is seen whole.
 */
async function readList(
  profile: ProfileId,
  rule: string,
  tool: MountedTool,
  hook: string,
): Promise<List | CheckOutcome> {
  const first = await drive(profile, rule, tool, [{ do: "read", hook }]);
  if (!("steps" in first)) return first;
  const step = first.steps[0];
  const count = step?.ok ? (step.count ?? 0) : 0;
  const texts = step?.ok ? [...(step.texts ?? [])] : [];
  for (let start = PAGE; start < count; start += PAGE) {
    const page = await drive(profile, rule, tool, [{ do: "read", hook, start }]);
    if (!("steps" in page)) return page;
    const read = page.steps[0];
    texts.push(...(read?.ok ? (read.texts ?? []) : []));
  }
  return { count, texts };
}

/** Where items `hook` marks show `text`: the positions of the first 20, from `start`. */
async function findAll(
  profile: ProfileId,
  rule: string,
  tool: MountedTool,
  hook: string,
  text: string,
  start?: number,
): Promise<number[] | CheckOutcome> {
  const found = await drive(profile, rule, tool, [
    { do: "find", hook, value: text, ...(start ? { start } : {}) },
  ]);
  if (!("steps" in found)) return found;
  const step = found.steps[0];
  return step?.ok ? (step.matches ?? []) : [];
}

// An item's text as the check compares it: a leading number such as "1." or "2)" is where the
// item stands, which adding one before it may change, not what it is.
const comparable = (text: string) => text.replace(/^\d+[.)]\s*/, "");

/**
 * What `now` holds that `was` doesn't, and the reverse, each text counted as often as it shows, as
 * `key` reads it: by default as a list item, a leading number aside.
 */
function difference(
  was: readonly string[],
  now: readonly string[],
  key: (text: string) => string = comparable,
) {
  const counts = new Map<string, number>();
  for (const text of was.map(key)) counts.set(text, (counts.get(text) ?? 0) + 1);
  const added: string[] = [];
  for (const text of now.map(key)) {
    const left = counts.get(text) ?? 0;
    if (left > 0) counts.set(text, left - 1);
    else added.push(text);
  }
  const gone = [...counts].flatMap(([text, left]) => Array<string>(left).fill(text));
  return { gone, added };
}

/** The other items' change, in words, or undefined when they are as they were. */
function changed(
  was: readonly string[],
  now: readonly string[],
  key: (text: string) => string = comparable,
): string | undefined {
  const { gone, added } = difference(was, now, key);
  if (gone.length === 0 && added.length === 0) return undefined;
  return `${gone.length > 0 ? `gone: ${clip(gone)}` : "none gone"}; ${added.length > 0 ? `new: ${clip(added)}` : "none new"}`;
}

/** What a list check adds: the item's name, and the steps that type it in. */
type Adding = { name: string; steps: DriveStep[] };

/**
 * The list check the item-list and filtering profiles share: it adds an item, opens the tool
 * again, removes the item and opens it again, through the item list's hooks and by its rules,
 * which come first in both profiles. `whileKept`, when given, checks more on the tool opened again
 * with the item added, given its list as read and where the item is in it.
 */
async function listCheck(
  context: CheckContext,
  profile: "item-list" | "filtering",
  adding: Adding,
  whileKept?: (tool: MountedTool, list: List, at: number) => Promise<CheckOutcome | undefined>,
): Promise<CheckOutcome> {
  const [adds, removes, reopens] = PROFILES[profile].rules;
  const { name } = adding;
  const without = (list: List, at: number) => list.texts.filter((_, i) => i !== at);

  // Adding: one more item, exactly one showing its name, and the others as they were.
  const tool = await context.rehearse();
  const before = await readList(profile, adds, tool, "item");
  if (!("texts" in before)) return before;
  const typed = await drive(profile, adds, tool, [
    ...adding.steps,
    { do: "click", hook: "item-add" },
  ]);
  if (!("steps" in typed)) return typed;
  const after = await readList(profile, adds, tool, "item");
  if (!("texts" in after)) return after;
  if (after.count !== before.count + 1) {
    return broke(
      profile,
      adds,
      `${items(before.count + 1)} after adding "${name}" to ${before.count}`,
      `${after.count}`,
    );
  }
  const found = await findAll(profile, adds, tool, "item", name);
  if (!Array.isArray(found)) return found;
  if (found.length !== 1) {
    return broke(
      profile,
      adds,
      `one item showing "${name}"`,
      `${items(found.length)} showing it, of ${after.count}`,
    );
  }
  const others = changed(before.texts, without(after, found[0]!));
  if (others) {
    return broke(
      profile,
      adds,
      `the other ${items(before.count)} as they were after adding "${name}"`,
      others,
    );
  }

  // Opened again: the list is as it was saved.
  const reopenedTool = await context.rehearse();
  const reopened = await readList(profile, reopens, reopenedTool, "item");
  if (!("texts" in reopened)) return reopened;
  const keptAt = await findAll(profile, reopens, reopenedTool, "item", name);
  if (!Array.isArray(keptAt)) return keptAt;
  const kept = changed(after.texts, reopened.texts);
  if (reopened.count !== after.count || keptAt.length !== 1 || kept) {
    return broke(
      profile,
      reopens,
      `the ${items(after.count)} it showed, one showing "${name}", after opening the tool again`,
      `${items(reopened.count)}${kept ? `; ${kept}` : ""}`,
    );
  }
  const more = await whileKept?.(reopenedTool, reopened, keptAt[0]!);
  if (more) return more;

  // Removing: that item goes, and the others are as they started.
  const removingTool = await context.rehearse();
  const clicked = await drive(profile, removes, removingTool, [
    { do: "click", hook: "item-remove", index: keptAt[0] },
  ]);
  if (!("steps" in clicked)) return clicked;
  const left = await readList(profile, removes, removingTool, "item");
  if (!("texts" in left)) return left;
  const leftAt = await findAll(profile, removes, removingTool, "item", name);
  if (!Array.isArray(leftAt)) return leftAt;
  const stayed = changed(before.texts, left.texts);
  if (left.count !== before.count || leftAt.length > 0 || stayed) {
    return broke(
      profile,
      removes,
      `the ${items(before.count)} it started with, as they were, after removing "${name}"`,
      `${items(left.count)}${stayed ? `; ${stayed}` : ""}`,
    );
  }

  // Opened again: still so.
  const lastTool = await context.rehearse();
  const last = await readList(profile, reopens, lastTool, "item");
  if (!("texts" in last)) return last;
  const lastAt = await findAll(profile, reopens, lastTool, "item", name);
  if (!Array.isArray(lastAt)) return lastAt;
  const end = changed(before.texts, last.texts);
  if (last.count !== before.count || lastAt.length > 0 || end) {
    return broke(
      profile,
      reopens,
      `the ${items(before.count)} it started with, as they were, after removing "${name}" and opening the tool again`,
      `${items(last.count)}${end ? `; ${end}` : ""}`,
    );
  }
  return { ok: true };
}

/** `text` and a random token: a name no starting item shows, so the item found is the check's. */
const unique = (text: string) =>
  `${text} ${Array.from(crypto.getRandomValues(new Uint8Array(3)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;

const itemList = (context: CheckContext) => {
  const name = unique(PROFILES["item-list"].fixture.itemName);
  return listCheck(context, "item-list", {
    name,
    steps: [{ do: "fill", hook: "item-name", value: name }],
  });
};

/**
 * The filtering profile's check (VER-03): the item list's, adding the item in a category of its
 * own, and, with it added and the tool opened again, the item showing that category, then the
 * filter set to it, to one a starting item has, if any has one, and emptied. A category is its
 * text as shown, exactly; each item's is the one inside it, so the items a filter should show are
 * known, and are compared with those it shows, each as often as it shows.
 */
const filtering = (context: CheckContext) => {
  const profile = PROFILES.filtering;
  const [adds, , , narrows] = profile.rules;
  const name = unique(profile.fixture.itemName);
  const category = unique(profile.fixture.category);

  /** The filter set to `chosen`: the items in that category, or, emptied, every item. */
  async function filterTo(tool: MountedTool, all: List, categories: string[], chosen: string) {
    const set = await drive("filtering", narrows, tool, [
      { do: "fill", hook: "filter", value: chosen },
    ]);
    if (!("steps" in set)) return set;
    const shown = await readList("filtering", narrows, tool, "item");
    if (!("texts" in shown)) return shown;
    const expected = chosen ? all.texts.filter((_, i) => categories[i] === chosen) : all.texts;
    const otherwise = changed(expected, shown.texts);
    if (shown.count === expected.length && !otherwise) return undefined;
    return broke(
      "filtering",
      narrows,
      chosen
        ? `the ${items(expected.length)} in "${chosen}", and no other, with filter set to it`
        : `all ${items(all.count)}, as they were, with filter emptied`,
      `${items(shown.count)}${otherwise ? `; ${otherwise}` : ""}`,
    );
  }

  return listCheck(
    context,
    "filtering",
    {
      name,
      steps: [
        { do: "fill", hook: "item-name", value: name },
        { do: "fill", hook: "item-category", value: category },
      ],
    },
    async (tool, all, at) => {
      const read = await readList("filtering", narrows, tool, "category");
      if (!("texts" in read)) return read;
      if (read.count !== all.count) {
        return broke(
          "filtering",
          narrows,
          `a category in each of the ${items(all.count)}`,
          `${read.count} ${read.count === 1 ? "category" : "categories"}`,
        );
      }
      const kept = read.texts[at] ?? "";
      if (kept !== category) {
        return broke(
          "filtering",
          adds,
          `"${name}" in the category "${category}"`,
          `it in ${kept ? `"${kept.slice(0, 60)}"` : "none"}`,
        );
      }
      const theirs = read.texts.find((each, i) => i !== at && each !== "");
      for (const chosen of [category, ...(theirs ? [theirs] : []), ""]) {
        const failed = await filterTo(tool, all, read.texts, chosen);
        if (failed) return failed;
      }
      return undefined;
    },
  );
};

/** Field types whose value the form profile calls text, which an answer shows as typed. */
const TEXT_TYPES = new Set(["text", "search", ""]);

/** Field types a fill can empty, so a required one of them can be left empty. */
const EMPTIABLE = new Set([
  "text",
  "search",
  "",
  "email",
  "url",
  "tel",
  "password",
  "number",
  "date",
  "time",
  "datetime-local",
  "month",
  "week",
]);

const isText = (field: DriveField) =>
  field.kind === "textarea" || (field.kind === "input" && TEXT_TYPES.has(field.type));

/** `wanted`, or the field's min when it states one, kept at or below its max when it states one. */
function within(field: DriveField, wanted: string): string {
  const value = field.min || wanted;
  // Dates and times in their input formats compare as text.
  return field.max !== "" && value > field.max ? field.max : value;
}

/**
 * A value `field` takes, or undefined when none is known. A text field gets the check's `probe`
 * when it fits, or else as much of `short`, a shorter unique text, as fits.
 */
function valueFor(field: DriveField, probe: string, short: string): string | undefined {
  if (field.kind === "select") return field.choices.find((choice) => choice !== "");
  if (isText(field)) {
    if (field.maxLength < 0 || probe.length <= field.maxLength) return probe;
    return short.slice(0, field.maxLength) || undefined;
  }
  switch (field.type) {
    case "email":
      return `check-${short}@example.com`;
    case "url":
      return `https://example.com/${short}`;
    case "tel":
      return "5550100";
    case "password":
      return `Check-${short}`;
    case "number":
    case "range": {
      const fallback = field.step && field.step !== "any" ? field.step : "1";
      const value = field.min || fallback;
      return field.max !== "" && Number(value) > Number(field.max) ? field.max : value;
    }
    case "date":
      return within(field, "2026-01-15");
    case "time":
      return within(field, "12:00");
    case "datetime-local":
      return within(field, "2026-01-15T12:00");
    case "month":
      return within(field, "2026-01");
    case "week":
      return within(field, "2026-W03");
    default:
      return undefined;
  }
}

/** The radios in `field`'s group: those sharing its name, or itself alone when it has none. */
const groupOf = (fields: readonly DriveField[], index: number) =>
  fields
    .map((other, at) => ({ other, at }))
    .filter(({ other, at }) =>
      fields[index]!.name
        ? other.type === "radio" && other.name === fields[index]!.name
        : at === index,
    );

/**
 * Whether the required field at `index` can be left unfilled: a field a fill empties, a box that
 * is unticked or can be, a select with an empty choice or empty now, or a radio group none of
 * whose choices is chosen.
 */
function canLeaveEmpty(fields: readonly DriveField[], index: number): boolean {
  const field = fields[index]!;
  if (!field.required) return false;
  if (field.kind === "textarea" || (field.kind === "input" && EMPTIABLE.has(field.type))) {
    return true;
  }
  if (field.type === "checkbox") return true;
  if (field.kind === "select") return field.value === "" || field.choices.includes("");
  if (field.type === "radio") return groupOf(fields, index).every(({ other }) => !other.checked);
  return false;
}

/**
 * The steps that fill every field, leaving the one at `skip` unfilled, and the texts an answer
 * should show: each text typed, as typed.
 */
function filling(fields: readonly DriveField[], hex: string, probe: string, skip?: number) {
  const steps: DriveStep[] = [];
  const texts: string[] = [];
  const unfillable: string[] = [];
  const skipped = skip === undefined ? [] : groupOf(fields, skip).map(({ at }) => at);
  const answered = new Set<number>();
  fields.forEach((field, index) => {
    if (index === skip || (fields[skip ?? -1]?.type === "radio" && skipped.includes(index))) {
      if (field.type === "checkbox") {
        if (field.checked) steps.push({ do: "click", hook: "form-field", index });
      } else if (field.kind === "select") {
        if (field.value !== "") steps.push({ do: "fill", hook: "form-field", index, value: "" });
      } else if (field.type !== "radio") {
        steps.push({ do: "fill", hook: "form-field", index, value: "" });
      }
      return;
    }
    if (field.type === "checkbox") {
      if (field.required && !field.checked) steps.push({ do: "click", hook: "form-field", index });
      return;
    }
    if (field.type === "radio") {
      // One choice in each group that must be answered, unless one is chosen already.
      const group = groupOf(fields, index);
      const first = group[0]?.at ?? index;
      if (answered.has(first)) return;
      answered.add(first);
      const needed = group.some(({ other }) => other.required);
      if (needed && group.every(({ other }) => !other.checked)) {
        steps.push({ do: "click", hook: "form-field", index });
      }
      return;
    }
    if (field.type === "color" || field.type === "hidden") return;
    const value = valueFor(field, `${probe} ${index + 1}`, `${hex}x${index + 1}`);
    if (value === undefined) {
      if (field.required) unfillable.push(field.type || field.kind);
      return;
    }
    steps.push({ do: "fill", hook: "form-field", index, value });
    if (isText(field)) texts.push(value);
  });
  return { steps, texts, unfillable };
}

/**
 * Whether the answer `now` holds beyond `before` shows every one of `texts` in its whole text,
 * not the part a read reports: undefined when it does, or else the texts it lacks. The new answer
 * is the one whose text, as read, `before` didn't hold; if several show that, any may be it.
 */
async function holding(
  tool: MountedTool,
  rule: string,
  before: List,
  now: List,
  texts: readonly string[],
): Promise<string[] | CheckOutcome | undefined> {
  if (texts.length === 0) return undefined;
  const added = difference(before.texts, now.texts).added[0];
  const previewed = now.texts
    .map((text, at) => ({ text, at }))
    .filter(({ text }) => comparable(text) === added)
    .map(({ at }) => at);
  // Of those, the ones whose whole text shows the longest text typed, found a page of 20 at a
  // time, however many answers share what a read shows.
  const key = [...texts].sort((a, b) => b.length - a.length)[0]!;
  const showing = new Set<number>();
  for (let start = 0; start < now.count;) {
    const page = await findAll("form", rule, tool, "answer", key, start);
    if (!Array.isArray(page)) return page;
    page.forEach((at) => showing.add(at));
    if (page.length < 20) break;
    start = page[page.length - 1]! + 1;
  }
  const candidates = previewed.filter((at) => showing.has(at));
  if (candidates.length === 0) return [...texts];
  let lacking: string[] = [...texts];
  for (const at of candidates) {
    const lacks: string[] = [];
    for (const text of texts) {
      if (text === key) continue;
      const found = await findAll("form", rule, tool, "answer", text, at);
      if (!Array.isArray(found)) return found;
      if (found[0] !== at) lacks.push(text);
    }
    if (lacks.length === 0) return undefined;
    if (at === candidates[0]) lacking = lacks;
  }
  return lacking;
}

/** The fields marked form-field, as the page describes them now. */
async function describe(tool: MountedTool, rule: string): Promise<DriveField[] | CheckOutcome> {
  const described = await drive("form", rule, tool, [{ do: "fields", hook: "form-field" }]);
  if (!("steps" in described)) return described;
  const step = described.steps[0];
  return step?.ok ? (step.fields ?? []) : [];
}

/**
 * The form profile's check (VER-03): it reads what the form's fields are; sends the form with a
 * required field left unfilled, if one can be, and expects nothing saved and form-error to say
 * so; sends it filled in and expects one more answer, showing each text typed, and the others as
 * they were; and opens the tool again and expects the answers as they were shown.
 */
async function form(context: CheckContext): Promise<CheckOutcome> {
  const profile = PROFILES.form;
  const [sends, refuses, reopens] = profile.rules;
  const probe = unique(profile.fixture.text);
  const hex = probe.split(" ").pop() ?? "";
  const answers = (count: number) => `${count} ${count === 1 ? "answer" : "answers"}`;

  const tool = await context.rehearse();
  const fields = await describe(tool, sends);
  if (!Array.isArray(fields)) return fields;
  if (fields.length === 0) {
    return broke("form", sends, "the form's fields, marked form-field", "none");
  }
  const unfillable = filling(fields, hex, probe).unfillable;
  if (unfillable.length > 0) {
    return broke(
      "form",
      sends,
      "fields the check can fill in",
      `a required field of a kind it can't: ${clip(unfillable)}`,
    );
  }
  const before = await readList("form", sends, tool, "answer");
  if (!("texts" in before)) return before;

  // Sent with a required field unfilled: nothing saved, and form-error says what is missing.
  const empty = fields.findIndex((_, index) => canLeaveEmpty(fields, index));
  if (empty >= 0) {
    const partial = filling(fields, hex, probe, empty);
    const sent = await drive("form", refuses, tool, [
      ...partial.steps,
      { do: "click", hook: "form-submit" },
    ]);
    if (!("steps" in sent)) return sent;
    const kept = await readList("form", refuses, tool, "answer");
    if (!("texts" in kept)) return kept;
    const error = await readList("form", refuses, tool, "form-error");
    if (!("texts" in error)) return error;
    const saved = changed(before.texts, kept.texts);
    const said = error.texts.some((text) => text !== "");
    if (kept.count !== before.count || saved || !said) {
      return broke(
        "form",
        refuses,
        `${answers(before.count)} as before, and form-error saying what is missing, after sending the form with required field ${empty + 1} unfilled`,
        `${answers(kept.count)}${saved ? `; ${saved}` : ""}; form-error ${said ? `saying ${clip(error.texts.filter(Boolean))}` : "saying nothing"}`,
      );
    }
  }

  // Sent filled in: one more answer, showing each text typed, and the others as they were. The
  // fields are read again first, since the refused send may have ticked a box this would untick.
  const now = await describe(tool, sends);
  if (!Array.isArray(now)) return now;
  const filled = filling(now, hex, probe);
  const sent = await drive("form", sends, tool, [
    ...filled.steps,
    { do: "click", hook: "form-submit" },
  ]);
  if (!("steps" in sent)) return sent;
  const after = await readList("form", sends, tool, "answer");
  if (!("texts" in after)) return after;
  if (after.count !== before.count + 1) {
    return broke(
      "form",
      sends,
      `${answers(before.count + 1)} after sending the form filled in, with ${before.count} before`,
      `${after.count}`,
    );
  }
  // The other answers as they were, each as often as it showed: so the one more is the new one,
  // even when another answer shows the same.
  const sentOut = difference(before.texts, after.texts);
  if (sentOut.gone.length > 0) {
    return broke(
      "form",
      sends,
      `the other ${answers(before.count)} as they were after sending the form`,
      changed(before.texts, after.texts) ?? `gone: ${clip(sentOut.gone)}`,
    );
  }
  const showing = await holding(tool, sends, before, after, filled.texts);
  if (showing && !Array.isArray(showing)) return showing;
  if (showing) {
    return broke(
      "form",
      sends,
      `one answer showing what was typed: ${clip(filled.texts)}`,
      `it without ${clip(showing)}`,
    );
  }

  // Opened again: the answers as they were shown, the new one still showing what was typed.
  const reopened = await context.rehearse();
  const shown = await readList("form", reopens, reopened, "answer");
  if (!("texts" in shown)) return shown;
  const kept = changed(after.texts, shown.texts);
  const still = kept ? undefined : await holding(reopened, reopens, before, shown, filled.texts);
  if (still && !Array.isArray(still)) return still;
  if (shown.count !== after.count || kept || still) {
    return broke(
      "form",
      reopens,
      `the ${answers(after.count)} it showed, the new one showing what was typed, after opening the tool again`,
      `${answers(shown.count)}${kept ? `; ${kept}` : ""}${still ? `; the new one without ${clip(still)}` : ""}`,
    );
  }
  return { ok: true };
}

/**
 * The numbers `text` shows, each read every way its separators allow: "1,970.5" and "1.970,5"
 * both read as 1970.5, and "1,970" as 1970 or 1.97, since a check can't know the tool's
 * convention, only whether one reading is the number it expects.
 */
function readings(text: string): number[] {
  const tokens = text.match(/-?\d(?:[\d.,'\s]*\d)?/g) ?? [];
  const found = new Set<number>();
  for (const raw of tokens) {
    const token = raw.replace(/['\s]/g, "");
    found.add(Number(token.replace(/,/g, "")));
    found.add(Number(token.replace(/\./g, "").replace(",", ".")));
  }
  return [...found].filter((value) => Number.isFinite(value));
}

/** Whether `text` shows `sum`, to the cent. */
const shows = (text: string, sum: number) =>
  readings(text).some((value) => Math.abs(value - sum) < 0.005);

/** "1200", "37.5": a number as the check writes it in what it says. */
const number = (value: number) => String(Math.round(value * 100) / 100);

/**
 * The chart profile's check (VER-03): it reads what the chart helper drew in the element marked
 * chart, and the total; adds an entry of a name of its own, and expects the chart to show it, in
 * its one series, with the other entries as they were, and the total to be the new sum; and opens
 * the tool again and expects both as they were saved. It reads the helper's record of the chart,
 * not its pixels (CAP-04).
 */
async function chart(context: CheckContext): Promise<CheckOutcome> {
  const profile = PROFILES.chart;
  const [adds, draws, totals, reopens] = profile.rules;
  const name = unique(profile.fixture.entryName);
  const value = Number(profile.fixture.entryValue);
  const entries = (count: number) => `${count} ${count === 1 ? "entry" : "entries"}`;

  /** The entries the chart shows, as "name: number", or a failure; none while it shows no chart. */
  async function shown(
    tool: MountedTool,
    rule: string,
    needed: boolean,
  ): Promise<{ pairs: [string, number][] } | CheckOutcome> {
    const read = await drive("chart", rule, tool, [{ do: "chart", hook: "chart" }]);
    if (!("steps" in read)) return read;
    const step = read.steps[0];
    if (!step?.ok || !step.count) {
      return broke("chart", draws, "the element marked chart", "none");
    }
    const spec = step.charts?.[0] ?? null;
    if (!spec) {
      return needed
        ? broke("chart", draws, "a chart drawn with tessera.chart", "none")
        : { pairs: [] };
    }
    if (spec.series.length !== 1) {
      return broke("chart", draws, "a chart with one series", `${spec.series.length} series`);
    }
    const values = spec.series[0]!.values;
    return { pairs: spec.labels.map((label, i): [string, number] => [label, values[i]!]) };
  }

  /** The total's text, if it shows the sum of `pairs`; a failure saying what it shows if not. */
  async function totalOf(tool: MountedTool, pairs: [string, number][]) {
    const read = await readList("chart", totals, tool, "total");
    if (!("texts" in read)) return read;
    const sum = pairs.reduce((all, [, each]) => all + each, 0);
    const text = read.texts[0] ?? "";
    if (read.count === 0) return broke("chart", totals, "the element marked total", "none");
    if (!shows(text, sum)) {
      return broke(
        "chart",
        totals,
        `a total of ${number(sum)} for the ${entries(pairs.length)} the chart shows`,
        `"${text.slice(0, 60)}"`,
      );
    }
    return undefined;
  }

  const said = (pairs: [string, number][]) =>
    pairs.map(([label, each]) => `${label}: ${number(each)}`);
  // A label is the entry's name, exactly: a leading number in it is part of the name, not a place.
  const exact = (text: string) => text;

  const tool = await context.rehearse();
  const before = await shown(tool, draws, false);
  if (!("pairs" in before)) return before;
  const startTotal = await totalOf(tool, before.pairs);
  if (startTotal) return startTotal;

  // Adding: the chart shows the entry, by its name and number, and the others as they were.
  const typed = await drive("chart", adds, tool, [
    { do: "fill", hook: "entry-name", value: name },
    { do: "fill", hook: "entry-value", value: profile.fixture.entryValue },
    { do: "click", hook: "entry-add" },
  ]);
  if (!("steps" in typed)) return typed;
  const after = await shown(tool, draws, true);
  if (!("pairs" in after)) return after;
  const mine = after.pairs.filter(([label]) => label === name);
  if (mine.length !== 1) {
    return broke(
      "chart",
      adds,
      `the chart showing "${name}" once after adding it`,
      `it ${mine.length === 0 ? "not shown" : `shown ${mine.length} times`}; the labels ${clip(after.pairs.map(([label]) => label))}`,
    );
  }
  if (Math.abs(mine[0]![1] - value) >= 0.005) {
    return broke(
      "chart",
      draws,
      `"${name}" at ${number(value)}, the number typed`,
      `${number(mine[0]![1])}`,
    );
  }
  const others = changed(
    said(before.pairs),
    said(after.pairs.filter(([label]) => label !== name)),
    exact,
  );
  if (others) {
    return broke(
      "chart",
      adds,
      `the other ${entries(before.pairs.length)} as they were after adding "${name}"`,
      others,
    );
  }
  const addedTotal = await totalOf(tool, after.pairs);
  if (addedTotal) return addedTotal;

  // Opened again: the chart and total as they were saved.
  const reopened = await context.rehearse();
  const again = await shown(reopened, reopens, true);
  if (!("pairs" in again)) return again;
  const kept = changed(said(after.pairs), said(again.pairs), exact);
  if (kept) {
    return broke(
      "chart",
      reopens,
      `the ${entries(after.pairs.length)} the chart showed, after opening the tool again`,
      `${entries(again.pairs.length)}; ${kept}`,
    );
  }
  const keptTotal = await totalOf(reopened, again.pairs);
  if (keptTotal) return keptTotal;
  return { ok: true };
}

const CHECKS: Readonly<Record<ProfileId, (context: CheckContext) => Promise<CheckOutcome>>> = {
  "item-list": itemList,
  filtering,
  form,
  chart,
};

/**
 * The behavior check of the profile `id` (VER-03), run in staging after the smoke check. Its name
 * is `behavior`, so a failure is repaired as one (GEN-09).
 */
export const profileCheck = (id: ProfileId): VerificationCheck => ({
  name: "behavior",
  run: (context) => CHECKS[id](context),
});
