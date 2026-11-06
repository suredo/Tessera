import { expect, it } from "vitest";
import { STAGES } from "@tessera/contracts";
import { outcomeText, stageText } from "../src/Details.tsx";
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
