import { expect, it } from "vitest";
import { PROFILE_IDS, PROFILES, STAGES } from "@tessera/contracts";
import { outcomeText, ruleTexts, stageText } from "../src/Details.tsx";
import { en } from "../src/i18n/en.ts";

// The details view says the ledger's steps and outcomes in plain words (APP-09, GEN-12, UX-05).

it("APP-09 GEN-12: every stage the ledger can hold has plain words", () => {
  for (const stage of STAGES) {
    expect(stageText(stage)).not.toBe(stage);
    expect(stageText(stage)).toBe(en[`details.stage.${stage}`]);
  }
});

it("APP-09 GEN-12: each way a request ends is said plainly, a mixed one with its entry part", () => {
  expect(outcomeText(null)).toBe(en["details.running"]);
  expect(outcomeText("candidate")).toBe(en["details.ended.candidate"]);
  expect(outcomeText("failed")).toBe(en["details.ended.failed"]);
  expect(outcomeText("open_saved")).toBe(en["details.ended.open_saved"]);
  expect(outcomeText("mixed_data:failed")).toBe(
    en["details.ended.mixed"].replace("{entries}", en["details.ended.failed"]),
  );
  // A name with no words yet is shown as it is, never hidden.
  expect(outcomeText("something_new")).toBe("something_new");
});

it("VER-08 GEN-12 UX-05: each profile's rules have a plain line each, through the translation layer, and no more", () => {
  for (const profile of PROFILE_IDS) {
    const lines = ruleTexts(profile);
    expect(lines).toHaveLength(PROFILES[profile].rules.length);
    lines.forEach((line, i) => {
      expect(line).toBe(en[`details.rule.${profile}.${i + 1}` as keyof typeof en]);
      // Never a hook's code-like name from the prompt's rules, such as item-remove (VER-03); a
      // hook named by a plain word, such as item, may be said.
      for (const hook of PROFILES[profile].hooks) {
        if (hook.name.includes("-")) expect(line).not.toContain(hook.name);
      }
    });
  }
  const extra = Object.keys(en).filter((key) => {
    const match = /^details\.rule\.(.+)\.(\d+)$/.exec(key);
    if (!match) return false;
    const rules = PROFILES[match[1] as keyof typeof PROFILES]?.rules;
    return !rules || Number(match[2]) > rules.length;
  });
  expect(extra).toEqual([]);
});
