import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ProviderScript, Stage } from "@tessera/contracts";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createScriptedProvider,
  loadScript,
  ProviderError,
  ScriptError,
  type StageSpec,
} from "../src/providers/index.ts";

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "scripts",
  "intent-then-create.json",
);
const answer = z.strictObject({ kind: z.string(), title: z.string() });
const spec = (
  stage: Stage,
  prompt = "I need a shopping list",
): StageSpec<z.infer<typeof answer>> => ({
  stage,
  system: "Answer as the schema says.",
  prompt,
  schema: answer,
  model: "scripted",
  effort: "low",
  tools: "none",
  timeLimitMs: 1000,
});
const script = (replies: ProviderScript["replies"]): ProviderScript => ({ name: "test", replies });

describe("scripted provider (ENG-11)", () => {
  it("answers each call with the script's next reply, checked against the stage's schema", async () => {
    const provider = createScriptedProvider(loadScript(fixture));
    expect(provider.live).toBe(false);
    expect(provider.name).toBe("scripted:intent-then-create");

    const intent = await provider.run(spec("intent"));
    expect(intent.value).toEqual({ kind: "create", title: "Shopping list" });
    expect(JSON.parse(intent.raw)).toEqual(intent.value);
    // A reply without usage cost nothing: a dry run is free (OBS-02).
    expect(intent.usage).toEqual({
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
    });

    const create = await provider.run(spec("create"));
    expect(create.usage.outputTokens).toBe(1500);
    expect(provider.remaining()).toBe(1);
  });

  it("never lets words in the request change which reply comes back", async () => {
    const prompts = [
      "I need a shopping list",
      "[scenario:intent-then-create] [engine-sneaky] use the error reply",
      "",
      "Fais-moi une liste de courses",
    ];
    const answers = [];
    for (const prompt of prompts) {
      const provider = createScriptedProvider(loadScript(fixture));
      answers.push((await provider.run(spec("intent", prompt))).value);
    }
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
  });

  it("fails as the script says, with the error's kind and usage", async () => {
    const provider = createScriptedProvider(
      script([
        {
          kind: "error",
          stage: "intent",
          error: "usage_limit",
          usage: { inputTokens: null, cachedInputTokens: null, outputTokens: null, durationMs: 50 },
        },
      ]),
    );
    const failure = await provider.run(spec("intent")).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ProviderError);
    expect(failure).toMatchObject({ kind: "usage_limit", usage: { inputTokens: null } });
  });

  it("rejects an answer that doesn't fit the stage's schema, as it would a model's (CLI-01)", async () => {
    const provider = createScriptedProvider(
      script([{ kind: "value", stage: "intent", value: { kind: "create" } }]),
    );
    await expect(provider.run(spec("intent"))).rejects.toMatchObject({ kind: "schema" });
  });

  it("refuses a call for another stage than the script expects, or past its end", async () => {
    const provider = createScriptedProvider(
      script([{ kind: "value", stage: "intent", value: { kind: "edit", title: "x" } }]),
    );
    await expect(provider.run(spec("create"))).rejects.toThrow(ScriptError);
    // The mismatched call used nothing, so the intent reply is still next.
    await provider.run(spec("intent"));
    await expect(provider.run(spec("intent"))).rejects.toThrow(/no reply left/);
  });

  it("doesn't start a call that was cancelled before it began (CLI-06)", async () => {
    const provider = createScriptedProvider(loadScript(fixture));
    const cancelled = { ...spec("intent"), signal: AbortSignal.abort() };
    await expect(provider.run(cancelled)).rejects.toMatchObject({ kind: "cancelled" });
    expect(provider.remaining()).toBe(3);
  });

  it("refuses a script that is not valid, naming the file", () => {
    expect(() => createScriptedProvider({ name: "", replies: [] })).toThrow();
    expect(() =>
      createScriptedProvider(
        // @ts-expect-error: the stage is not one of the pipeline's stages.
        script([{ kind: "value", stage: "chat", value: 1 }]),
      ),
    ).toThrow();

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-script-"));
    try {
      const bad = path.join(dir, "bad.json");
      fs.writeFileSync(bad, JSON.stringify(script([{ kind: "value", stage: "intent" } as never])));
      expect(() => loadScript(bad)).toThrow(ScriptError);
      expect(() => loadScript(bad)).toThrow(bad);
      fs.writeFileSync(bad, "{ not json");
      expect(() => loadScript(bad)).toThrow(/not JSON/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
