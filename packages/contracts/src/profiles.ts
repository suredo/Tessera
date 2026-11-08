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

/** Every profile, by ID. */
export const PROFILES = { "item-list": ITEM_LIST_PROFILE } as const satisfies Record<
  string,
  VerificationProfile
>;

export const PROFILE_IDS = ["item-list"] as const satisfies readonly (keyof typeof PROFILES)[];
export type ProfileId = (typeof PROFILE_IDS)[number];

export const profileIdSchema = z
  .enum(PROFILE_IDS)
  .describe("A verification profile: a behavior pattern the host checks (VER-03).");
