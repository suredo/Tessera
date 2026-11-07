import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_ROUTES, type Creation, type Intent } from "@tessera/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { generate } from "../src/generation/index.ts";
import type { SmokeRepairContext } from "../src/generation/smoke.ts";
import {
  checkTwoPassOptions,
  TWO_PASS_STARTING_POINT,
  twoPassPlan,
} from "../src/generation/two-pass.ts";
import { PROMPT_BUDGETS } from "../src/prompts/index.ts";
import { createScriptedProvider, type Provider, type StageSpec } from "../src/providers/index.ts";
import { openDataFolder } from "../src/storage/index.ts";

// Two passes for big tools (GEN-17): the host decides from the intent's features with a fixed
// threshold, never a model's own flag (L-37); the core pass is told what to build now and what
// comes later, as quoted data; and the candidate says what is still to come. Off by default.

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const newFolder = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-two-pass-"));
  temps.push(dir);
  return openDataFolder(dir);
};

const features = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    name: `Feature ${i + 1}`,
    request: `do thing ${i + 1}`,
  }));
const intent = (kind: Intent["kind"], count: number): Intent =>
  ({
    kind,
    interfacePart: null,
    dataPart: null,
    behaviorChange: false,
    lookOnly: false,
    targetsCurrentTool: false,
    language: "en",
    features: features(count),
  }) as Intent;

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "prompts");
const part = (name: string) =>
  fs.readFileSync(path.join(fixtures, `shopping-list.${name}.txt`), "utf8");
const tool: Creation = {
  outcome: "tool",
  name: "Shopping list",
  summary: "A list to tick off at the store.",
  code: { html: part("html"), css: part("css"), js: part("js") },
  data: {
    schema: { type: "object", properties: { items: { type: "array" } } },
    reusableDefaults: { items: [] },
    initialState: {},
  },
  capabilities: [],
  uiMode: "standard",
};

describe("deciding on two passes (GEN-17)", () => {
  it("GEN-17, L-37: only a new tool with enough features is made in two passes, its first features the core", () => {
    const options = { minFeatures: 4, coreFeatures: 2 };
    expect(twoPassPlan(intent("create", 6))).toBeUndefined();
    expect(twoPassPlan(intent("create", 3), options)).toBeUndefined();
    expect(twoPassPlan(intent("edit", 6), options)).toBeUndefined();
    expect(twoPassPlan(intent("mixed", 6), options)).toBeUndefined();
    expect(twoPassPlan(intent("create", 4), options)).toEqual({
      core: features(4).slice(0, 2),
      later: features(4).slice(2),
    });
    expect(twoPassPlan(intent("new_tool", 5), options)?.later.map((f) => f.name)).toEqual([
      "Feature 3",
      "Feature 4",
      "Feature 5",
    ]);
  });

  it("GEN-17: refuses options with no core, or nothing left for later", () => {
    expect(checkTwoPassOptions(TWO_PASS_STARTING_POINT)).toEqual({
      minFeatures: 4,
      coreFeatures: 2,
    });
    for (const bad of [
      { minFeatures: 4, coreFeatures: 0 },
      { minFeatures: 2, coreFeatures: 2 },
      { minFeatures: 4.5, coreFeatures: 2 },
    ]) {
      expect(() => checkTwoPassOptions(bad)).toThrow(RangeError);
    }
  });
});

describe("the core pass (GEN-17)", () => {
  const run = async (twoPass?: typeof TWO_PASS_STARTING_POINT) => {
    const folder = await newFolder();
    const specs: StageSpec<unknown>[] = [];
    const scripted = createScriptedProvider({
      name: "two-pass",
      replies: [
        { kind: "value", stage: "intent", value: intent("create", 5) },
        { kind: "value", stage: "create", value: tool },
      ] as never,
    });
    const provider: Provider = {
      ...scripted,
      run: (spec) => {
        specs.push(spec);
        return scripted.run(spec);
      },
    };
    let context: SmokeRepairContext | undefined;
    const reply = await generate(
      folder,
      provider,
      DEFAULT_ROUTES,
      { request: "A shopping list with five things" },
      undefined,
      (c) => {
        context = c;
      },
      undefined,
      undefined,
      twoPass,
    );
    folder.close();
    return { reply, create: specs[1]!, context };
  };

  it("GEN-17, SEC-02: tells creation what to build now and what comes later, as quoted data, and says what is still to come", async () => {
    const { reply, create, context } = await run(TWO_PASS_STARTING_POINT);
    expect(create.promptParts?.some((p) => p.startsWith("core@"))).toBe(true);
    expect(create.prompt).toContain(`Build now: ${JSON.stringify(features(5).slice(0, 2))}`);
    expect(create.prompt).toContain(`Later, not now: ${JSON.stringify(features(5).slice(2))}`);
    expect(create.system.length + create.prompt.length).toBeLessThanOrEqual(PROMPT_BUDGETS.create);
    expect(reply).toMatchObject({
      kind: "candidate",
      followUps: ["Feature 3", "Feature 4", "Feature 5"],
    });
    // A smoke repair of the core keeps to the core, and the rest is kept for later.
    expect(context?.plan?.later).toEqual(features(5).slice(2));
  });

  it("GEN-17: is one pass when the server isn't told to make two", async () => {
    const { reply, create, context } = await run();
    expect(create.promptParts?.some((p) => p.startsWith("core@"))).toBe(false);
    expect(reply).not.toHaveProperty("followUps");
    expect(context).not.toHaveProperty("plan");
  });
});
