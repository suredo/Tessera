import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_ROUTES, STAGES, type Stage } from "@tessera/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  loadRoutes,
  ProviderError,
  RoutesError,
  runStage,
  type Provider,
  type StageSpec,
} from "../src/providers/index.ts";

// Each stage runs on its route (CLI-09): the cheapest model that fits its task, from one routing
// table, configurable per stage, and never switched to a pricier model when a call fails (A18,
// confirmed by the owner on 2026-10-26).

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
/** A routes file holding `content`, in a folder of its own. */
const routesFile = (content: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-routes-"));
  temps.push(dir);
  const file = path.join(dir, "routes.json");
  fs.writeFileSync(file, content);
  return file;
};

/** A provider that records every call and answers, or fails, as told. */
function recording(fail?: ProviderError) {
  const calls: StageSpec<unknown>[] = [];
  const provider: Provider = {
    name: "recording",
    live: false,
    run: <T>(spec: StageSpec<T>) => {
      calls.push(spec);
      if (fail) return Promise.reject(fail);
      return Promise.resolve({
        value: { ok: true } as T,
        usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, durationMs: 0 },
        raw: "",
      });
    },
  };
  return { provider, calls };
}
const call = (stage: Stage) => ({
  stage,
  system: "Do the stage's task.",
  prompt: "A request",
  schema: z.strictObject({ ok: z.literal(true) }),
  timeLimitMs: 1000,
});

describe("the routing table (CLI-09)", () => {
  it("CLI-09: starts from A18: Haiku low for intent and data, Sonnet medium for creation and repairs, Sonnet low for edits", () => {
    expect(DEFAULT_ROUTES).toMatchObject({
      intent: { model: "claude-haiku-5-5", effort: "low" },
      data: { model: "claude-haiku-5-5", effort: "low" },
      acceptance: { model: "claude-haiku-5-5", effort: "low" },
      create: { model: "claude-sonnet-5-5", effort: "medium" },
      repair: { model: "claude-sonnet-5-5", effort: "medium" },
      edit: { model: "claude-sonnet-5-5", effort: "low" },
      research: { model: "claude-sonnet-5-5", effort: "medium" },
    });
    // Opus only by explicit configuration: no stage starts on it.
    expect(STAGES.filter((stage) => DEFAULT_ROUTES[stage].model === "claude-opus-5-5")).toEqual([]);
  });

  it("CLI-09: a routes file replaces only the stages it names, and Opus only when named", () => {
    const routes = loadRoutes(
      routesFile(JSON.stringify({ create: { model: "claude-opus-5-5", effort: "high" } })),
    );
    expect(routes.create).toEqual({ model: "claude-opus-5-5", effort: "high" });
    expect(routes.intent).toEqual(DEFAULT_ROUTES.intent);
    expect(routes.edit).toEqual(DEFAULT_ROUTES.edit);
  });

  it("CLI-09: no routes file means the defaults", () => {
    expect(loadRoutes(path.join(os.tmpdir(), "no-such-folder-tessera", "routes.json"))).toEqual(
      DEFAULT_ROUTES,
    );
  });

  it("CLI-09, GEN-12: refuses a routes file it can't use, saying in plain words what to change", () => {
    const tail = ". Correct it, or delete the file to use the standard settings.";
    const cases: [string, string][] = [
      ["not json", "its text isn't written in the settings format"],
      ["[]", "it should list steps, each with a model and an effort"],
      [
        JSON.stringify({ painting: { model: "claude-sonnet-5-5", effort: "low" } }),
        'it names a step Tessera doesn\'t have, "painting"; the steps are intent, create, edit, repair, data, research, review or acceptance',
      ],
      [
        JSON.stringify({ create: { model: "claude-sonnet-5-5" } }),
        "the create step needs both a model and an effort",
      ],
      [
        JSON.stringify({ create: { model: "claude-sonnet-5-5", effort: "low", temperature: 1 } }),
        'the create step has "temperature", but a step has only a model and an effort',
      ],
      [
        JSON.stringify({ create: { model: "gpt-5", effort: "low" } }),
        'the create step names a model Tessera doesn\'t know, "gpt-5"; the models are claude-haiku-5-5, claude-sonnet-5-5 or claude-opus-5-5',
      ],
      [
        JSON.stringify({ create: { model: "claude-sonnet-5-5", effort: "extreme" } }),
        'the create step\'s effort should be low, medium or high, not "extreme"',
      ],
    ];
    for (const [content, why] of cases) {
      const file = routesFile(content);
      const error = (() => {
        try {
          loadRoutes(file);
        } catch (caught) {
          return caught;
        }
        return undefined;
      })();
      expect(error).toBeInstanceOf(RoutesError);
      expect((error as Error).message).toBe(
        `Tessera can't use the model settings in ${file}: ${why}${tail}`,
      );
      // Plain words (GEN-12): none of the internal terms a person shouldn't meet.
      expect((error as Error).message.replace(file, "")).not.toMatch(
        /json|schema|invalid|expected|option|enum/i,
      );
    }
  });
});

describe("running a stage on its route (CLI-09, CLI-03)", () => {
  it("CLI-09: calls the stage's model and effort, and gives web tools to research only", async () => {
    for (const stage of STAGES) {
      const { provider, calls } = recording();
      await runStage(provider, DEFAULT_ROUTES, call(stage));
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        stage,
        model: DEFAULT_ROUTES[stage].model,
        effort: DEFAULT_ROUTES[stage].effort,
        tools: stage === "research" ? "web" : "none",
      });
    }
  });

  it("CLI-09: a failed call is never retried on another, pricier model", async () => {
    for (const kind of ["schema", "time_limit", "unavailable_model", "usage_limit"] as const) {
      const { provider, calls } = recording(new ProviderError(kind, "It failed."));
      await expect(runStage(provider, DEFAULT_ROUTES, call("intent"))).rejects.toMatchObject({
        kind,
      });
      // One call, on the stage's own route: no escalation.
      expect(calls.map((c) => c.model)).toEqual(["claude-haiku-5-5"]);
    }
  });
});
