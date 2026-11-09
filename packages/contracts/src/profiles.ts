import { z } from "zod";

// Verification profiles (VER-03): behavior patterns the host knows how to check before a tool is
// activated. They are internal, never tools, and never shown to the person. Each is one definition
// (P3, VER-04): what it fits, for the intent stage; the hooks a tool exposes and the rules it
// follows, for the generation prompt; and the values its behavior check types, for the check. A
// check enforces only what its rules state, so nothing it checks is hidden from the prompt.

/** An element a matching tool marks with `data-hook="<name>"`, so a check can find it. */
export type ProfileHook = { name: string; says: string };

export type VerificationProfile = {
  id: string;
  /** Which tools it fits, completing "The tool is …", for the intent stage. */
  fits: string;
  /** The elements a matching tool marks, each named for the check that finds it. */
  hooks: readonly ProfileHook[];
  /** What the tool must do with them, as the prompt states it and as the check checks it. */
  rules: readonly string[];
  /** The values the check types into the tool. */
  fixture: Readonly<Record<string, string>>;
};

/** Something with a list of items: T1, T2, T12 (the M3 scenario sets). */
export const ITEM_LIST_PROFILE = {
  id: "item-list",
  fits: "a list the person adds items to and removes them from, as a to-do list",
  hooks: [
    { name: "item-name", says: "the field for a new item's name" },
    { name: "item-add", says: "the button that adds the item named there" },
    {
      name: "item",
      says: "each item in the list, one element per item, its text holding the item's name",
    },
    { name: "item-remove", says: "inside each item, the button that removes it" },
  ],
  rules: [
    "Typing a name in item-name and pressing item-add adds one item with that name to the list, and saves it.",
    "Pressing an item's item-remove removes that item from the list, and saves that.",
    "Opened again, the tool shows the list as it was saved.",
  ],
  fixture: { itemName: "Tessera check item" },
} as const satisfies VerificationProfile;

/**
 * A list whose items each have a category, narrowed to one at a time: T2 (the M3 scenario sets).
 * It is an item list too, with the same hooks and rules, so its check is the item list's and more.
 */
export const FILTERING_PROFILE = {
  id: "filtering",
  fits: "an item list in categories, narrowed to one at a time, as books by genre",
  hooks: [
    ...ITEM_LIST_PROFILE.hooks,
    {
      name: "item-category",
      says: "the field where a new item's category is typed, taking any text",
    },
    {
      name: "category",
      says: "inside each item, the element whose text is the item's category, exactly as typed, and nothing else",
    },
    {
      name: "filter",
      says: "the field or select that narrows the list to one category; a select offers every category the list holds, and an empty-valued choice for all",
    },
  ],
  rules: [
    "Typing a name in item-name and a category in item-category, then pressing item-add, adds one item with that name and category to the list, and saves it.",
    ITEM_LIST_PROFILE.rules[1],
    ITEM_LIST_PROFILE.rules[2],
    "Setting filter to a category shows every item whose category is exactly that, spaces at either end aside and repeated spaces counting as one, and hides the rest; emptying it shows every item again.",
  ],
  fixture: { itemName: ITEM_LIST_PROFILE.fixture.itemName, category: "Tessera check category" },
} as const satisfies VerificationProfile;

/** A form people fill in and send, whose answers it keeps and shows: T5 (the M3 scenario sets). */
export const FORM_PROFILE = {
  id: "form",
  fits: "a form people send, whose answers it keeps and shows, as an RSVP",
  hooks: [
    {
      name: "form-field",
      says: "each field of the form, an input, select or textarea with a label; one that must be filled has the required attribute",
    },
    { name: "form-submit", says: "the button that sends the form" },
    {
      name: "form-error",
      says: "where the tool itself says in words what is missing when the form can't be sent",
    },
    {
      name: "answer",
      says: "each answer sent, one element per answer, its text holding what was typed in each text field",
    },
  ],
  rules: [
    "Filling in every form-field and pressing form-submit saves one answer, and shows it as an answer.",
    "Pressing form-submit with a required form-field empty saves nothing, and shows form-error saying what is missing.",
    "Opened again, the tool shows every answer saved.",
  ],
  fixture: { text: "Tessera check answer" },
} as const satisfies VerificationProfile;

/**
 * A chart of numbers the person enters, with their total: T3 (the M3 scenario sets). It draws with
 * the chart helper (CAP-04), whose record of what it drew is what its check reads.
 */
export const CHART_PROFILE = {
  id: "chart",
  fits: "a chart of numbers the person enters and their total, as spending",
  hooks: [
    { name: "entry-name", says: "the field for a new entry's name" },
    { name: "entry-value", says: "the field for its number" },
    { name: "entry-add", says: "the button that adds the entry" },
    { name: "chart", says: "the element tessera.chart draws the chart in" },
    { name: "total", says: "the element whose text is the entries' total, as a number" },
  ],
  rules: [
    "Typing a name in entry-name and a number in entry-value, then pressing entry-add, adds that entry, and saves it.",
    "The chart in chart has one series, with a label and a value for each entry: its name and its number.",
    "total shows the sum of the entries' numbers.",
    "Opened again, the tool shows the entries as they were saved.",
  ],
  fixture: { entryName: "Tessera check entry", entryValue: "37.5" },
} as const satisfies VerificationProfile;

/**
 * Flashcards made from notes the person pastes: T10 (the M3 scenario sets). A tool can't ask a
 * model, so its notes follow one plain format, a card a line, which its check knows.
 */
export const CARDS_PROFILE = {
  id: "cards",
  fits: "flashcards made from pasted notes",
  hooks: [
    { name: "notes", says: "the textarea where notes are pasted" },
    { name: "cards-make", says: "the button that makes cards from them" },
    { name: "card", says: "each card, one element per card" },
    { name: "card-front", says: "inside each card, the element whose text is its front" },
    { name: "card-back", says: "inside each card, the element whose text is its back, shown too" },
  ],
  rules: [
    "Pressing cards-make makes one card for each line of notes with text on both sides of a colon: its front the text before the first colon, its back the text after it, spaces at either end aside; other lines make none. It adds them to the cards already made, and saves them.",
    "Opened again, the tool shows the cards as they were saved.",
  ],
  fixture: {
    front: "Tessera check term",
    back: "Tessera check meaning",
    heading: "Tessera check heading",
  },
} as const satisfies VerificationProfile;

/**
 * Tasks a tool schedules into sessions on days, kept off the weekdays its rules rule out: T10 (the
 * M3 scenario sets). Its check adds a rule of its own and removes it again; it reads each
 * session's date from a time element, so dates may be shown in any language.
 */
export const SCHEDULING_PROFILE = {
  id: "scheduling",
  fits: "a planner putting tasks on days, kept off weekdays its rules rule out",
  hooks: [
    { name: "task-name", says: "the field for a new task's name" },
    { name: "task-add", says: "the button that adds the task" },
    {
      name: "session",
      says: "each session scheduled, one element per session, with a time element inside whose datetime attribute is its date as YYYY-MM-DD",
    },
    {
      name: "session-task",
      says: "inside each session, the element whose text is its task's name, exactly as typed",
    },
    {
      name: "rule-day",
      says: "the select of a new rule's weekday, each choice's value the weekday's number, 0 for Sunday to 6 for Saturday",
    },
    { name: "rule-add", says: "the button that adds the rule" },
    { name: "rule", says: "each rule, one element per rule" },
    { name: "rule-remove", says: "inside each rule, the button that removes it" },
  ],
  rules: [
    "Typing a name in task-name and pressing task-add schedules that task in one or more sessions, today or later, and saves it.",
    "Choosing a weekday in rule-day and pressing rule-add adds a rule, shown as a rule, that no session falls on that weekday: the sessions on it move to other days, and every task keeps at least one session. It saves the rule.",
    "Pressing a rule's rule-remove removes that rule, and saves that.",
    "Opened again, the tool shows the sessions and rules as they were saved.",
  ],
  fixture: { taskName: "Tessera check task" },
} as const satisfies VerificationProfile;

/** Every profile, by ID. */
export const PROFILES = {
  "item-list": ITEM_LIST_PROFILE,
  filtering: FILTERING_PROFILE,
  form: FORM_PROFILE,
  chart: CHART_PROFILE,
  cards: CARDS_PROFILE,
  scheduling: SCHEDULING_PROFILE,
} as const satisfies Record<string, VerificationProfile>;

export const PROFILE_IDS = [
  "item-list",
  "filtering",
  "form",
  "chart",
  "cards",
  "scheduling",
] as const satisfies readonly (keyof typeof PROFILES)[];
export type ProfileId = (typeof PROFILE_IDS)[number];

export const profileIdSchema = z
  .enum(PROFILE_IDS)
  .describe("A verification profile: a behavior pattern the host checks (VER-03).");
