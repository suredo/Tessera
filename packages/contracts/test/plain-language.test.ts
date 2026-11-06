import { describe, expect, it } from "vitest";
import { INTERNAL_TERMS, internalTerms } from "../src/index.ts";

// The plain-language list (GEN-12): words for Tessera's own parts, matched as whole words.

describe("plain language (GEN-12)", () => {
  it("GEN-12: finds internal terms as whole words, in any case, each once", () => {
    expect(internalTerms("Capability declaration fix")).toEqual(["capability", "declaration"]);
    expect(internalTerms("The viewState and the HARNESS, and the harness")).toEqual([
      "viewState",
      "harness",
    ]);
    expect(internalTerms("Your JSON payload")).toEqual(["JSON", "payload"]);
    // Parts of other words aren't the term: states, statement, repairs, nullable.
    expect(internalTerms("US states quiz: a statement of repairs, nullable")).toEqual([]);
    expect(internalTerms("A shopping list to tick off at the store.")).toEqual([]);
  });

  it("GEN-12: a term the person used themselves is theirs to read", () => {
    expect(internalTerms("JSON formatter", "I need a JSON formatter")).toEqual([]);
    expect(internalTerms("Bike repair log", "A log of my bike repairs")).toEqual([]);
    expect(internalTerms("States of matter", "A quiz on the states of matter")).toEqual([]);
    expect(internalTerms("Bike repair log", "Help me keep track of each bike repair")).toEqual([]);
  });

  it("GEN-12: the list holds the spec's examples and L-36's leaks", () => {
    for (const term of ["state", "schema", "viewState", "capability", "harness", "JSON"]) {
      expect(INTERNAL_TERMS).toContain(term);
    }
  });
});
