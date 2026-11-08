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
  fits: "a list of items the person adds to and removes from, such as a shopping list, a reading list or a to-do list",
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
  fits: "a list of items, each in a category, that the person adds to, removes from and narrows to one category, such as a reading list filtered by genre",
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
  fits: "a form people fill in and send, whose answers it keeps and shows, such as an RSVP, a sign-up sheet or a survey",
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

/** Every profile, by ID. */
export const PROFILES = {
  "item-list": ITEM_LIST_PROFILE,
  filtering: FILTERING_PROFILE,
  form: FORM_PROFILE,
} as const satisfies Record<string, VerificationProfile>;

export const PROFILE_IDS = [
  "item-list",
  "filtering",
  "form",
] as const satisfies readonly (keyof typeof PROFILES)[];
export type ProfileId = (typeof PROFILE_IDS)[number];

export const profileIdSchema = z
  .enum(PROFILE_IDS)
  .describe("A verification profile: a behavior pattern the host checks (VER-03).");
