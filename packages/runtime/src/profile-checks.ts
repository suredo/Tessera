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

/** Where items `hook` marks show `text`: the positions of the first 20. */
async function findAll(
  profile: ProfileId,
  rule: string,
  tool: MountedTool,
  hook: string,
  text: string,
): Promise<number[] | CheckOutcome> {
  const found = await drive(profile, rule, tool, [{ do: "find", hook, value: text }]);
  if (!("steps" in found)) return found;
  const step = found.steps[0];
  return step?.ok ? (step.matches ?? []) : [];
}

// An item's text as the check compares it: a leading number such as "1." or "2)" is where the
// item stands, which adding one before it may change, not what it is.
const comparable = (text: string) => text.replace(/^\d+[.)]\s*/, "");

/** What `now` holds that `was` doesn't, and the reverse, each text counted as often as it shows. */
function difference(was: readonly string[], now: readonly string[]) {
  const counts = new Map<string, number>();
  for (const text of was.map(comparable)) counts.set(text, (counts.get(text) ?? 0) + 1);
  const added: string[] = [];
  for (const text of now.map(comparable)) {
    const left = counts.get(text) ?? 0;
    if (left > 0) counts.set(text, left - 1);
    else added.push(text);
  }
  const gone = [...counts].flatMap(([text, left]) => Array<string>(left).fill(text));
  return { gone, added };
}

/** The other items' change, in words, or undefined when they are as they were. */
function changed(was: readonly string[], now: readonly string[]): string | undefined {
  const { gone, added } = difference(was, now);
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

/** A value `field` takes, from the check's `text` for a text field, or undefined when none is known. */
function valueFor(field: DriveField, text: string): string | undefined {
  if (field.kind === "select") return field.choices.find((choice) => choice !== "");
  if (field.kind === "textarea" || (field.kind === "input" && TEXT_TYPES.has(field.type))) {
    return field.maxLength >= 0 ? text.slice(0, field.maxLength) : text;
  }
  const word = text.split(" ").pop() ?? "x";
  switch (field.type) {
    case "email":
      return `check-${word}@example.com`;
    case "url":
      return `https://example.com/${word}`;
    case "tel":
      return "5550100";
    case "password":
      return `Check-${word}`;
    case "number":
    case "range": {
      const fallback = field.step && field.step !== "any" ? field.step : "1";
      const value = field.min || fallback;
      return field.max !== "" && Number(value) > Number(field.max) ? field.max : value;
    }
    case "date":
      return field.min || "2026-01-15";
    case "time":
      return field.min || "12:00";
    case "datetime-local":
      return field.min || "2026-01-15T12:00";
    case "month":
      return field.min || "2026-01";
    case "week":
      return field.min || "2026-W03";
    default:
      return undefined;
  }
}

/** The steps that fill every field but `skip`, and the texts an answer should show. */
function filling(fields: readonly DriveField[], token: string, skip?: number) {
  const steps: DriveStep[] = [];
  const texts: string[] = [];
  const unfillable: string[] = [];
  const groups = new Set<string>();
  fields.forEach((field, index) => {
    if (index === skip) {
      steps.push({ do: "fill", hook: "form-field", index, value: "" });
      return;
    }
    if (field.type === "checkbox") {
      if (field.required && !field.checked) steps.push({ do: "click", hook: "form-field", index });
      return;
    }
    if (field.type === "radio") {
      // One choice in each group that must be answered, unless one is chosen already.
      const group = field.name || `#${index}`;
      const answered = fields.some(
        (other) => other.type === "radio" && (other.name || "") === field.name && other.checked,
      );
      const needed = fields.some(
        (other) => other.type === "radio" && (other.name || "") === field.name && other.required,
      );
      if (needed && !answered && !groups.has(group)) {
        groups.add(group);
        steps.push({ do: "click", hook: "form-field", index });
      }
      return;
    }
    if (field.type === "color" || field.type === "hidden") return;
    const value = valueFor(field, `${token} ${index + 1}`);
    if (value === undefined) {
      if (field.required) unfillable.push(field.type || field.kind);
      return;
    }
    steps.push({ do: "fill", hook: "form-field", index, value });
    const text =
      field.kind === "textarea" || (field.kind === "input" && TEXT_TYPES.has(field.type));
    if (text && value === `${token} ${index + 1}`) texts.push(value);
  });
  return { steps, texts, unfillable };
}

/**
 * The form profile's check (VER-03): it reads what the form's fields are; sends the form with a
 * required field left empty, if one can be, and expects nothing saved and form-error to say so;
 * sends it filled in and expects one more answer, showing each text typed, and the others as they
 * were; and opens the tool again and expects the answers as they were shown.
 */
async function form(context: CheckContext): Promise<CheckOutcome> {
  const profile = PROFILES.form;
  const [sends, refuses, reopens] = profile.rules;
  const token = unique(profile.fixture.text);
  const answers = (count: number) => `${count} ${count === 1 ? "answer" : "answers"}`;

  const tool = await context.rehearse();
  const described = await drive("form", sends, tool, [{ do: "fields", hook: "form-field" }]);
  if (!("steps" in described)) return described;
  const first = described.steps[0];
  const fields = first?.ok ? (first.fields ?? []) : [];
  if (fields.length === 0) {
    return broke("form", sends, "the form's fields, marked form-field", "none");
  }
  const whole = filling(fields, token);
  if (whole.unfillable.length > 0) {
    return broke(
      "form",
      sends,
      "fields the check can fill in",
      `a required field of a kind it can't: ${clip(whole.unfillable)}`,
    );
  }
  const before = await readList("form", sends, tool, "answer");
  if (!("texts" in before)) return before;

  // Sent with a required field empty: nothing saved, and form-error says what is missing.
  const empty = fields.findIndex(
    (field) => field.required && (field.kind === "textarea" || EMPTIABLE.has(field.type)),
  );
  if (empty >= 0) {
    const partial = filling(fields, token, empty);
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
        `${answers(before.count)} as before, and form-error saying what is missing, after sending the form with required field ${empty + 1} empty`,
        `${answers(kept.count)}${saved ? `; ${saved}` : ""}; form-error ${said ? `saying ${clip(error.texts.filter(Boolean))}` : "saying nothing"}`,
      );
    }
  }

  // Sent filled in: one more answer, showing each text typed, and the others as they were. The
  // fields are read again first, since the refused send may have ticked a box this would untick.
  const again = await drive("form", sends, tool, [{ do: "fields", hook: "form-field" }]);
  if (!("steps" in again)) return again;
  const now = again.steps[0];
  const filled = filling(now?.ok ? (now.fields ?? []) : [], token);
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
  let at: number | undefined;
  if (filled.texts.length > 0) {
    const found = await findAll("form", sends, tool, "answer", filled.texts[0]!);
    if (!Array.isArray(found)) return found;
    const shows = found.length === 1 ? (after.texts[found[0]!] ?? "") : "";
    const missing = filled.texts.filter((text) => !shows.includes(text));
    if (found.length !== 1 || missing.length > 0) {
      return broke(
        "form",
        sends,
        `one answer showing what was typed: ${clip(filled.texts)}`,
        found.length === 1
          ? `it without ${clip(missing)}`
          : `${answers(found.length)} showing "${filled.texts[0]}"`,
      );
    }
    at = found[0];
  }
  // Without a text to find the new answer by, the others are those the answers held before.
  const gone = difference(before.texts, after.texts).gone;
  const others =
    at === undefined
      ? gone.length > 0
        ? `gone: ${clip(gone)}`
        : undefined
      : changed(
          before.texts,
          after.texts.filter((_, i) => i !== at),
        );
  if (others) {
    return broke(
      "form",
      sends,
      `the other ${answers(before.count)} as they were after sending the form`,
      others,
    );
  }

  // Opened again: the answers as they were shown.
  const reopened = await context.rehearse();
  const shown = await readList("form", reopens, reopened, "answer");
  if (!("texts" in shown)) return shown;
  const kept = changed(after.texts, shown.texts);
  if (shown.count !== after.count || kept) {
    return broke(
      "form",
      reopens,
      `the ${answers(after.count)} it showed, after opening the tool again`,
      `${answers(shown.count)}${kept ? `; ${kept}` : ""}`,
    );
  }
  return { ok: true };
}

const CHECKS: Readonly<Record<ProfileId, (context: CheckContext) => Promise<CheckOutcome>>> = {
  "item-list": itemList,
  filtering,
  form,
};

/**
 * The behavior check of the profile `id` (VER-03), run in staging after the smoke check. Its name
 * is `behavior`, so a failure is repaired as one (GEN-09).
 */
export const profileCheck = (id: ProfileId): VerificationCheck => ({
  name: "behavior",
  run: (context) => CHECKS[id](context),
});
