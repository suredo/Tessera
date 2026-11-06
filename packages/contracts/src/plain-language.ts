// Plain language (GEN-12): the words for Tessera's own parts, which the person never needs to read.
// Host messages never use them, and a generated tool's name and summary use one only when the
// person's own request did ("a JSON formatter"). The one list, for the host's checks and tests.

/** Words for Tessera's insides, from the POC's leaks ("viewState", "harness", a "Capability declaration fix" tool, L-36), matched as words. */
export const INTERNAL_TERMS = [
  "state",
  "schema",
  "viewState",
  "capability",
  "capabilities",
  "harness",
  "JSON",
  "payload",
  "candidate",
  "repair",
  "fixture",
  "artifact",
  "manifest",
  "declaration",
  "runtime",
  "iframe",
  "null",
  "undefined",
] as const;

const asWord = (term: string) => new RegExp(`(?<![\\p{L}\\p{N}_])${term}(?![\\p{L}\\p{N}_])`, "iu");
// The person's words allow a term in any form they wrote it: "repairs" allows "repair".
const startingAWord = (term: string) => new RegExp(`(?<![\\p{L}\\p{N}_])${term}`, "iu");

/**
 * The internal terms `text` uses, each once, in the list's order, leaving out any that `allowed`
 * (such as the person's request) uses too. None means the text is plain.
 */
export function internalTerms(text: string, allowed = ""): string[] {
  return INTERNAL_TERMS.filter(
    (term) => asWord(term).test(text) && !startingAWord(term).test(allowed),
  );
}
