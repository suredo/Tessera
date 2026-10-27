import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_ROUTES, type Intent } from "@tessera/contracts";
import { describe, expect, it } from "vitest";
import {
  decideIntent,
  recordLists,
  wordsNotInRequest,
  type IntentInput,
} from "../src/intent/index.ts";
import {
  assembleIntentPrompt,
  INTENT_PROMPT_BUDGET,
  partText,
  type OpenTool,
} from "../src/prompts/index.ts";
import { createScriptedProvider, type Provider, type StageSpec } from "../src/providers/index.ts";

// The intent stage (GEN-01) and the host's decisions on its answers: guardrails no answer can get
// past, the whole request where nothing is split, and the word check, second ask and hand-back for
// a mixed split (ADR 0008, L-75). Answers come from scripts and from the spike's live replays,
// replayed offline (TEST-04); they never reach a model (ENG-11).

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "intent");
type Fixture = {
  id: string;
  family: string;
  context: string;
  language: string;
  request: string;
  expected: string;
  savedToolId?: string;
  source: string;
};
const { contexts, requests } = JSON.parse(
  fs.readFileSync(path.join(fixtures, "requests.json"), "utf8"),
) as {
  contexts: Record<string, { open: OpenTool; savedToolIds: string[] }>;
  requests: Fixture[];
};
const { replays } = JSON.parse(fs.readFileSync(path.join(fixtures, "replays.json"), "utf8")) as {
  replays: { id: string; answer: Intent; expected: string }[];
};
const fixture = (id: string) => requests.find((r) => r.id === id)!;
const inputOf = (f: Fixture): IntentInput => ({
  request: f.request,
  open: contexts[f.context]!.open,
  savedToolIds: contexts[f.context]!.savedToolIds,
});

const SHOPPING: OpenTool = {
  name: "Shopping list",
  lists: [{ name: "items", fields: ["title", "quantity", "done"] }],
};
const answer = (fields: Partial<Intent> & { kind: Intent["kind"] }): Intent =>
  ({
    interfacePart: null,
    dataPart: null,
    behaviorChange: false,
    lookOnly: false,
    targetsCurrentTool: true,
    language: "en",
    features: [],
    ...fields,
  }) as Intent;

/** A scripted provider for these intent answers, and every call it got. */
function answering(...answers: Intent[]) {
  const scripted = createScriptedProvider({
    name: "intent",
    replies: answers.map((value) => ({ kind: "value", stage: "intent", value })),
  });
  const calls: StageSpec<unknown>[] = [];
  const provider: Provider = {
    ...scripted,
    run: (spec) => {
      calls.push(spec);
      return scripted.run(spec);
    },
  };
  return { provider, calls, remaining: () => scripted.remaining() };
}
const decide = (input: IntentInput, ...answers: Intent[]) => {
  const scripted = answering(...answers);
  return decideIntent(scripted.provider, DEFAULT_ROUTES, input).then((decision) => ({
    decision,
    ...scripted,
  }));
};

describe("what the intent stage is told (GEN-01, GEN-02)", () => {
  it("DATA-03: the open tool's lists and fields come from its declared data shape", () => {
    expect(
      recordLists({
        type: "object",
        properties: {
          items: {
            type: "array",
            items: { type: "object", properties: { id: {}, title: {}, done: {} } },
          },
          note: { type: "string" },
        },
      }),
    ).toEqual([{ name: "items", fields: ["title", "done"] }]);
    expect(recordLists({})).toEqual([]);
  });

  it("GEN-01, ADR 0008: the prompt gives the open tool and the lists it keeps, or says none is open", () => {
    const open = assembleIntentPrompt({ request: "Add cheese", open: SHOPPING });
    expect(open.system).toBe(partText("intent"));
    expect(open.prompt).toBe(
      "The tool open now: Shopping list. The lists of records it keeps, with their fields:\n- items: title, quantity, done\n\nThe request:\nAdd cheese",
    );
    expect(assembleIntentPrompt({ request: "x", open: null }).prompt).toContain(
      partText("intent-none"),
    );
    expect(
      assembleIntentPrompt({ request: "x", open: { name: "Clock", lists: [] } }).prompt,
    ).toContain(partText("intent-no-records"));
    expect(assembleIntentPrompt({ request: "x", open: null, retry: true }).prompt).toMatch(
      new RegExp(`${partText("intent-retry").replace(/[.?*+^$()[\]{}|\\]/g, "\\$&")}$`),
    );
  });

  it("GEN-02: the parts used never depend on the request's words", () => {
    const parts = (request: string) => assembleIntentPrompt({ request, open: SHOPPING }).parts;
    expect(parts("Make it calmer.")).toEqual(parts("Coloca 2 litros de leite e 1 pão."));
    expect(parts("Book me a table")).toEqual(parts("open my saved tools"));
  });

  it("GEN-03: the intent prompt's fixture, a second ask in a tool with two lists, stays within its budget", () => {
    const f = fixture("r22");
    const { size } = assembleIntentPrompt({ ...inputOf(f), retry: true });
    expect(size).toBeLessThanOrEqual(INTENT_PROMPT_BUDGET);
  });

  it("CLI-09: the stage runs once on the intent route, without tools, recording its parts", async () => {
    const { calls } = await decide(
      { request: "Make it calmer.", open: SHOPPING },
      answer({ kind: "edit", lookOnly: true }),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      stage: "intent",
      model: DEFAULT_ROUTES.intent.model,
      effort: DEFAULT_ROUTES.intent.effort,
      tools: "none",
    });
    expect(calls[0]!.promptParts?.map((part) => part.split("@")[0])).toEqual([
      "intent",
      "intent-open",
      "intent-request",
    ]);
  });
});

describe("the host's guardrails (GEN-01)", () => {
  it("GEN-01, A12: with no tool open, a request opens a listed saved tool or creates one", async () => {
    const none = { request: "Track my plants", open: null, savedToolIds: ["t-shop"] };
    for (const kind of ["edit", "data", "mixed", "new_tool", "create"] as const) {
      const { decision } = await decide(none, answer({ kind }));
      expect(decision).toMatchObject({ action: "create", interfacePart: "Track my plants" });
    }
    const saved = await decide(none, answer({ kind: "open_saved", savedToolId: "t-shop" }));
    expect(saved.decision).toMatchObject({ action: "open_saved", savedToolId: "t-shop" });
    const unknown = await decide(none, answer({ kind: "open_saved", savedToolId: "t-other" }));
    expect(unknown.decision).toMatchObject({ action: "create" });
  });

  it("GEN-01: a request that isn't about the open tool never changes it", async () => {
    const input = { request: "I need a workout timer.", open: SHOPPING };
    for (const kind of ["edit", "data", "mixed"] as const) {
      const { decision } = await decide(input, answer({ kind, targetsCurrentTool: false }));
      expect(decision).toMatchObject({ action: "new_tool", interfacePart: input.request });
    }
    // Building a tool while one is open is a new tool: the open one stays as it is.
    expect((await decide(input, answer({ kind: "create" }))).decision.action).toBe("new_tool");
    const unlisted = await decide(input, answer({ kind: "open_saved", savedToolId: "t-x" }));
    expect(unlisted.decision.action).toBe("new_tool");
  });

  it("GEN-01: clarify and unsupported reach the person as they are", async () => {
    for (const kind of ["clarify", "unsupported"] as const) {
      for (const open of [SHOPPING, null]) {
        const { decision } = await decide({ request: "x", open }, answer({ kind }));
        expect(decision.action).toBe(kind);
      }
    }
  });
});

describe("keeping the request's own words (ADR 0008, L-75)", () => {
  it("ADR 0008: where nothing is split, the part is the whole request, whatever the model wrote", async () => {
    const request = "Add cheese and take the apples off.";
    const data = await decide(
      { request, open: SHOPPING },
      answer({ kind: "data", dataPart: "Add cheese to the shopping list; remove the apples." }),
    );
    expect(data.decision).toMatchObject({ action: "data", dataPart: request });
    const edit = await decide(
      { request: "Make it calmer.", open: SHOPPING },
      answer({ kind: "edit", interfacePart: "Use calmer colors." }),
    );
    expect(edit.decision).toMatchObject({ action: "edit", interfacePart: "Make it calmer." });
  });

  it("L-75: the word check flags added, changed and translated words, in any script, and ignores case and punctuation", () => {
    const request = "Coloca 2 litros de leite e 1 pão.";
    expect(
      wordsNotInRequest(request, "Add 2 litros de leite and 1 pão to the shopping list."),
    ).toEqual(["add", "and", "to", "the", "shopping", "list"]);
    expect(wordsNotInRequest(request, "coloca 2 litros de leite")).toEqual([]);
    expect(wordsNotInRequest(request, "1 PÃO!")).toEqual([]);
    expect(wordsNotInRequest("Добавь хлеб", "добавь хлеб")).toEqual([]);
  });

  it("ADR 0008: a mixed split in the request's words is used as it is", async () => {
    const { decision, calls } = await decide(
      { request: "Group them by aisle and add cheese.", open: SHOPPING },
      answer({ kind: "mixed", interfacePart: "Group them by aisle", dataPart: "add cheese" }),
    );
    expect(decision).toMatchObject({
      action: "mixed",
      interfacePart: "Group them by aisle",
      dataPart: "add cheese",
    });
    expect(calls).toHaveLength(1);
  });

  it("ADR 0008: a mixed split that rewords a part is asked once more, reminded to quote the request", async () => {
    const request = "Group them by aisle and add cheese.";
    const reworded = answer({
      kind: "mixed",
      interfacePart: "Group the items by aisle",
      dataPart: "add cheese",
    });
    const quoted = answer({
      kind: "mixed",
      interfacePart: "Group them by aisle",
      dataPart: "add cheese",
    });
    const { decision, calls, remaining } = await decide(
      { request, open: SHOPPING },
      reworded,
      quoted,
    );
    expect(decision.action).toBe("mixed");
    expect(calls).toHaveLength(2);
    expect(calls[0]!.prompt).not.toContain(partText("intent-retry"));
    expect(calls[1]!.prompt).toContain(partText("intent-retry"));
    expect(calls[1]!.model).toBe(calls[0]!.model);
    expect(remaining()).toBe(0);
  });

  it("ADR 0008: a split that fails twice, or misses a part, is left to the person, and nothing is done", async () => {
    const request = "Group them by aisle and add cheese.";
    const missing = answer({ kind: "mixed", interfacePart: "Group them by aisle", dataPart: null });
    const translated = answer({
      kind: "mixed",
      interfacePart: "Agrupa por corredor",
      dataPart: "add cheese",
    });
    const { decision, calls } = await decide({ request, open: SHOPPING }, missing, translated);
    expect(decision.action).toBe("ask_to_split");
    expect(decision).not.toHaveProperty("interfacePart");
    expect(decision).not.toHaveProperty("dataPart");
    expect(calls).toHaveLength(2);
  });

  it("ADR 0008: a second answer that isn't mixed is decided like any other", async () => {
    const request = "Group them by aisle and add cheese.";
    const { decision } = await decide(
      { request, open: SHOPPING },
      answer({ kind: "mixed", interfacePart: "Sort by aisle", dataPart: "add cheese" }),
      answer({ kind: "edit" }),
    );
    expect(decision).toMatchObject({ action: "edit", interfacePart: request });
  });
});

describe("the fixtures from the POC's routing failures (GEN-01, TEST-04)", () => {
  it("GEN-01, GEN-15: every failure family is there, in more than one language", () => {
    const families = new Set(requests.map((r) => r.family));
    for (const family of [
      "style",
      "behavior",
      "unrelated",
      "mixed",
      "data",
      "create",
      "clarify",
      "unsupported",
      "open-saved",
    ]) {
      expect(families, family).toContain(family);
    }
    expect(new Set(requests.map((r) => r.language)).size).toBeGreaterThanOrEqual(5);
    for (const r of requests) expect(contexts[r.context], r.id).toBeDefined();
    // ADR 0008: adding what the tool keeps as records is data; its pair in the same tools is mixed.
    expect(fixture("r22").expected).toBe("data");
    expect(requests.filter((r) => r.source === "ADR 0008").map((r) => r.expected)).toEqual([
      "data",
      "data",
      "mixed",
      "mixed",
    ]);
  });

  it("TEST-04, L-75: the spike's live answers, replayed, lead to the expected actions in the request's own words", async () => {
    for (const replay of replays) {
      const f = fixture(replay.id);
      const { decision, calls } = await decide(inputOf(f), replay.answer);
      expect(decision.action, replay.id).toBe(replay.expected);
      expect(calls, replay.id).toHaveLength(1);
      if (decision.action === "data") expect(decision.dataPart).toBe(f.request);
      if (decision.action === "mixed") {
        expect(wordsNotInRequest(f.request, decision.interfacePart)).toEqual([]);
        expect(wordsNotInRequest(f.request, decision.dataPart)).toEqual([]);
      }
    }
  });
});
