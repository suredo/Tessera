import { describe, expect, it } from "vitest";
import { PROFILE_IDS, PROFILES } from "../src/index.ts";

// The verification-profile registry (VER-03): one definition per profile (P3), whose hooks and
// rules the prompt states and the check uses, so no rule is hidden from the prompt (VER-04).

describe("verification profiles", () => {
  it("VER-03: every profile is listed by its ID, and every ID has a profile", () => {
    expect([...PROFILE_IDS].sort()).toEqual(Object.keys(PROFILES).sort());
    for (const id of PROFILE_IDS) expect(PROFILES[id].id).toBe(id);
  });

  it("VER-04: each profile's hook names are ones a check can find, and each hook its rules name is one it declares", () => {
    for (const profile of Object.values(PROFILES)) {
      const names = profile.hooks.map((hook) => hook.name);
      expect(new Set(names).size).toBe(names.length);
      // The names the staging panel's driver accepts.
      for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9-]{0,40}$/);
      for (const rule of profile.rules) {
        for (const named of rule.match(/\b[a-z]+(?:-[a-z]+)+\b/g) ?? []) {
          expect(names, `${profile.id}: "${rule}" names ${named}`).toContain(named);
        }
      }
    }
  });

  it("VER-03: the filtering profile is an item list too, so the item list's check holds for it", () => {
    const names = PROFILES.filtering.hooks.map((hook) => hook.name);
    for (const hook of PROFILES["item-list"].hooks) expect(names).toContain(hook.name);
    expect(PROFILES.filtering.rules.slice(1, 3)).toEqual(PROFILES["item-list"].rules.slice(1));
    expect(PROFILES.filtering.fixture.itemName).toBe(PROFILES["item-list"].fixture.itemName);
  });
});
