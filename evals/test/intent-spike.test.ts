import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { intentSchema, type Intent } from "@tessera/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { readLedger } from "../src/index.ts";
import {
  contexts,
  expectedReplies,
  fakeProvider,
  PLAN,
  renderPrompt,
  renderReport,
  requests,
  runIntentSpike,
  score,
  wordsNotInRequest,
  type IntentReport,
} from "../spikes/intent/run.ts";

// The spike's own runs use the system's temporary folder, never a real data folder (ENG-19).
const root = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-intent-spike-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
let runs = 0;
const newFolder = () => path.join(root, `run-${++runs}`);
const spikeFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "spikes",
  "intent",
);
const systemPrompt = fs.readFileSync(path.join(spikeFolder, "prompts", "system.md"), "utf8");
const answer = (overrides: Partial<Intent>): Intent =>
  ({
    kind: "edit",
    interfacePart: null,
    dataPart: null,
    behaviorChange: false,
    lookOnly: true,
    targetsCurrentTool: true,
    language: "en",
    features: [],
    ...overrides,
  }) as Intent;
const request = (id: string) => {
  const found = requests().find((r) => r.id === id);
  if (!found) throw new Error(`no request ${id}`);
  return found;
};

// The dry run starts one process per request (ENG-20: a bounded, generous limit).
const PER_START_MS = 8_000;
describe("intent spike (GEN-01, GEN-02, GEN-15, #20)", { timeout: 60_000 }, () => {
  it("has one well-formed request per planned call, with every category and its context", () => {
    const all = requests();
    expect(all).toHaveLength(PLAN.callCap);
    expect(new Set(all.map((r) => r.id)).size).toBe(all.length);
    expect(new Set(all.map((r) => r.category)).size).toBe(9);
    expect(all.filter((r) => r.language !== "en").length).toBeGreaterThanOrEqual(10);
    for (const r of all.filter((r) => r.expected.kind === "open_saved")) {
      const saved = contexts()[r.context]?.saved.map((t) => t.id);
      expect(saved).toContain(r.expected.savedToolId);
    }
  });

  it("keeps the test requests out of the prompt's examples, so the run measures the prompt", () => {
    for (const r of requests()) expect(systemPrompt).not.toContain(r.request);
  });

  it("gives the model the open tool, the saved tools and the request, as written", () => {
    const prompt = renderPrompt({ ...request("r04"), request: "Costs $& and $1 in €" });
    expect(prompt).toContain("Tool open now: none");
    expect(prompt).toContain("- t-shop: Weekly shopping.");
    expect(prompt).toContain("Costs $& and $1 in €");
  });

  it("counts a wrong kind or a wrong saved tool as a misroute, and lists other differences", () => {
    expect(score(request("r09"), answer({ kind: "unsupported" })).misrouted).toBe(true);
    expect(score(request("r09"), answer({}))).toEqual({ misrouted: false, mismatches: [] });
    expect(
      score(request("r04"), answer({ kind: "open_saved", savedToolId: "t-budget" })).misrouted,
    ).toBe(true);
    expect(score(request("r11"), answer({ behaviorChange: true, language: "en-GB" }))).toEqual({
      misrouted: false,
      mismatches: ["behaviorChange true"],
    });
    // The language is checked by its primary subtag: pt-BR and pt both pass for pt.
    expect(score(request("r12"), answer({ language: "pt-BR" })).mismatches).toEqual([]);
    expect(score(request("r12"), answer({ language: "es" })).mismatches).toEqual(["language es"]);
  });

  // The dry run starts the fake provider as its own Node process for each of its calls, one after
  // another: 12 to 14 s in all on an idle Windows machine, but a start can take seconds on a busy
  // one, such as when the browser tests run alongside. It asserts what the run records, never how
  // fast Node starts, so its limit grows with the starts: 8 s each, about 20 times an idle one
  // (ENG-20, #81).
  it(
    "rehearses the whole run at no cost, with the same prompt for every request (ENG-07, GEN-02)",
    {
      timeout: PLAN.callCap * PER_START_MS,
    },
    async () => {
      const dataFolder = newFolder();
      const report = await runIntentSpike({
        mode: "dry-run",
        provider: fakeProvider(dataFolder),
        dataFolder,
      });
      expect(report.results.filter((r) => r.misrouted || r.error)).toEqual([]);
      expect(report.summary).toMatchObject({ callCount: 31, inputTokens: 0, outputTokens: 0 });
      expect(readLedger(dataFolder).every((e) => e.mode === "dry-run")).toBe(true);

      // Nothing is switched on or off by the request's words: every call gets the same system prompt.
      const calls = fs.readdirSync(path.join(dataFolder, "fake-calls")).map(
        (f) =>
          JSON.parse(fs.readFileSync(path.join(dataFolder, "fake-calls", f), "utf8")) as {
            args: string[];
          },
      );
      const systems = new Set(calls.map((c) => c.args[c.args.indexOf("--system-prompt") + 1]));
      expect([...systems]).toEqual([systemPrompt]);
      expect(fs.existsSync(path.join(dataFolder, "report.md"))).toBe(true);
    },
  );

  it("stops after two failed calls in a row (ENG-07)", async () => {
    const dataFolder = newFolder();
    const [first] = expectedReplies();
    const failed = {
      type: "result",
      subtype: "success",
      is_error: true,
      result: "boom",
      usage: {},
    };
    const report = await runIntentSpike({
      mode: "dry-run",
      provider: fakeProvider(dataFolder, [first, failed, failed, first]),
      dataFolder,
    });
    expect(report.results.map((r) => r.error === null)).toEqual([true, false, false]);
    expect(readLedger(dataFolder)).toHaveLength(3);
  });

  // Codex's review of #38: a run that stops early must not shrink the denominator.
  it("keeps every planned request in the rate when the run stops early (ENG-07)", async () => {
    const dataFolder = newFolder();
    const [first] = expectedReplies() as { structured_output: { answer: object } }[];
    const misrouted = {
      ...first,
      structured_output: { answer: { ...first?.structured_output.answer, kind: "clarify" } },
    };
    const failed = { type: "result", subtype: "success", is_error: true, result: "boom" };
    const report = await runIntentSpike({
      mode: "dry-run",
      provider: fakeProvider(dataFolder, [misrouted, failed, failed]),
      dataFolder,
    });
    expect(report.categories.find((c) => c.category === "create")).toEqual({
      category: "create",
      requestCount: 5,
      correctCount: 0,
      misroutedCount: 1,
      blockedCount: 4,
      misroutePercent: 20,
    });
    expect(report.categories.find((c) => c.category === "style")).toMatchObject({
      blockedCount: 6,
      misroutePercent: 0,
    });
  });

  // L-75, from the live run: the stage reworded a data part, and once half translated it. The
  // scorer flags both; r23 kept its words and is not flagged (ENG-13).
  it("flags a split part that isn't in the request's words, as in the live run (L-75, ENG-13)", () => {
    const fixture = JSON.parse(
      fs.readFileSync(path.join(spikeFolder, "replays", "l-75.json"), "utf8"),
    ) as { replays: { id: string; answer: unknown }[] };
    const flagged = fixture.replays.map(({ id, answer }) => [
      id,
      score(request(id), intentSchema.parse(answer)).mismatches.filter((m) =>
        m.startsWith("dataPart reworded"),
      ).length > 0,
    ]);
    expect(flagged).toEqual([
      ["r19", true],
      ["r20", true],
      ["r23", false],
    ]);
    expect(
      wordsNotInRequest("Coloca 2 litros de leite e 1 pão.", "2 litros de leite e 1 pão"),
    ).toEqual([]);
    expect(
      wordsNotInRequest(
        "Coloca 2 litros de leite e 1 pão.",
        "Add 2 litros de leite and 1 pão to the shopping list.",
      ),
    ).toEqual(["add", "and", "to", "the", "shopping", "list"]);
  });

  it("reports the misroute rate per category and lists every misroute", () => {
    const report: IntentReport = {
      mode: "dry-run",
      cliVersion: null,
      categories: [
        {
          category: "style",
          requestCount: 6,
          correctCount: 4,
          misroutedCount: 1,
          blockedCount: 1,
          misroutePercent: 17,
        },
      ],
      results: [
        {
          id: "r09",
          category: "style",
          language: "en",
          request: "Make it calmer.",
          expected: "edit",
          got: "unsupported",
          misrouted: true,
          mismatches: ["lookOnly false"],
          error: null,
        },
      ],
      summary: {
        callCount: 6,
        failedCount: 0,
        refusedCount: 0,
        unknownUsageCount: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        durationMs: 0,
      },
    };
    const text = renderReport(report);
    expect(text).toContain("| style | 6 | 4 | 1 | 1 | 17% |");
    expect(text).toContain("| r09 | style | en | Make it calmer. | edit | unsupported |");
    expect(text).toContain("- r09 (style): lookOnly false");
  });
});
