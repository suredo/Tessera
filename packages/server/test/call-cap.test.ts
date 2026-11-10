import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_ROUTES,
  GENERATE_ROUTE,
  generateReplySchema,
  type Creation,
  type Intent,
} from "@tessera/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { launch } from "../src/launcher/index.ts";
import {
  callCapFrom,
  callCounter,
  createScriptedProvider,
  ProviderError,
  type Provider,
  type StageSpec,
} from "../src/providers/index.ts";

// A hard cap on model calls for an evaluation run outside the harness (ENG-07), such as the
// clean-setup scenario P1 in Windows Sandbox: one count across every provider, and a call past it
// refused before it reaches the program.

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

const spec: StageSpec<unknown> = {
  stage: "intent",
  system: "s",
  prompt: "p",
  schema: {} as never,
  model: DEFAULT_ROUTES.intent.model,
  effort: DEFAULT_ROUTES.intent.effort,
  tools: "none",
  timeLimitMs: 1000,
};
/** A provider that only counts the calls that reach it. */
const counting = (name: string) => {
  const reached: string[] = [];
  const provider: Provider = {
    name,
    live: false,
    acceptsImages: false,
    run: () => {
      reached.push(name);
      return Promise.resolve({ value: {}, raw: "{}", usage: {} } as never);
    },
  };
  return { provider, reached };
};

describe("the call cap (ENG-07)", () => {
  it("ENG-07: counts every provider it wraps together, and refuses a call past the cap before it reaches one", async () => {
    const counter = callCounter(2);
    const claude = counting("claude");
    const codex = counting("codex");
    await counter.wrap(claude.provider).run(spec);
    await counter.wrap(codex.provider).run(spec);
    const refused = await counter
      .wrap(claude.provider)
      .run(spec)
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ProviderError);
    expect(refused).toMatchObject({ kind: "usage_limit" });
    expect((refused as Error).message).toBe(
      "This Tessera has used all 2 of the model calls its evaluation allows, so it makes no more.",
    );
    expect([...claude.reached, ...codex.reached]).toEqual(["claude", "codex"]);
    expect(counter.used()).toBe(2);
  });

  it("ENG-07: takes its cap from TESSERA_CALL_CAP, and refuses one that isn't a whole number of at least 1", () => {
    expect(callCapFrom({})).toBeUndefined();
    expect(callCapFrom({ TESSERA_CALL_CAP: "" })).toBeUndefined();
    expect(callCapFrom({ TESSERA_CALL_CAP: "14" })).toBe(14);
    for (const value of ["0", "-1", "1.5", "ten", "1e2"]) {
      expect(() => callCapFrom({ TESSERA_CALL_CAP: value })).toThrow(/whole number of at least 1/);
    }
    expect(() => callCounter(0)).toThrow(/whole number of at least 1/);
  });

  it("ENG-07: a Tessera started with a cap ends the request whose call would pass it, in plain words", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-call-cap-"));
    temps.push(dataDir);
    const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "prompts");
    const part = (name: string) =>
      fs.readFileSync(path.join(fixtures, `shopping-list.${name}.txt`), "utf8");
    const intent: Intent = {
      kind: "create",
      interfacePart: null,
      dataPart: null,
      behaviorChange: false,
      lookOnly: false,
      targetsCurrentTool: false,
      language: "en",
      features: [{ name: "Packing list", request: "a packing list" }],
      profile: null,
    };
    const tool: Creation = {
      outcome: "tool",
      name: "Packing list",
      summary: "Things to pack.",
      code: { html: part("html"), css: part("css"), js: part("js") },
      data: {
        schema: { type: "object", properties: { items: { type: "array" } } },
        reusableDefaults: { items: [] },
        initialState: {},
      },
      capabilities: [],
      uiMode: "standard",
    };
    const stages: string[] = [];
    const scripted = createScriptedProvider({
      name: "capped",
      replies: [
        { kind: "value", stage: "intent", value: intent },
        { kind: "value", stage: "create", value: tool as never },
        { kind: "value", stage: "intent", value: intent },
      ],
    });
    const launched = await launch({
      dataDir,
      port: 0,
      openBrowser: () => Promise.resolve(),
      acceptanceChecks: false,
      callCap: 2,
      provider: {
        ...scripted,
        run: (s) => {
          stages.push(s.stage);
          return scripted.run(s);
        },
      },
    });
    if (launched.status !== "started") throw new Error("Tessera didn't start.");
    try {
      const ask = async () =>
        generateReplySchema.parse(
          await (
            await fetch(new URL(GENERATE_ROUTE, launched.url), {
              method: "POST",
              headers: { origin: launched.url, "content-type": "application/json" },
              body: JSON.stringify({ request: "A packing list" }),
            })
          ).json(),
        );
      expect((await ask()).kind).toBe("candidate");
      const second = await ask();
      expect(second).toMatchObject({ kind: "failed" });
      expect(JSON.stringify(second)).toContain("used all 2 of the model calls");
      // The refused intent call never reached the program.
      expect(stages).toEqual(["intent", "create"]);
    } finally {
      await launched.stop();
    }
  });
});
