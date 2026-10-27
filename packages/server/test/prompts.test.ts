import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Intent } from "@tessera/contracts";
import { UI_STANDARD_VERSION, UI_TOKENS } from "@tessera/runtime/policy";
import { describe, expect, it } from "vitest";
import {
  assemblePrompt,
  fillPart,
  fixedPart,
  manifestForPrompt,
  partText,
  partVersion,
  PROMPT_BUDGETS,
  PROMPT_PARTS,
  type PromptInput,
} from "../src/prompts/index.ts";

// Prompt assembly (GEN-03): parts from versioned files (ENG-16), chosen by the stage and the
// intent's structured fields, never by the request's words (GEN-02), with the bridge manifest
// (CON-03) and the UI standard's variables (VER-06) generated into their parts, and each stage's
// fixture prompt within its budget.

const here = path.dirname(fileURLToPath(import.meta.url));
const promptsFolder = path.join(here, "..", "prompts");
const fixture = (name: string) =>
  fs.readFileSync(path.join(here, "fixtures", "prompts", `shopping-list.${name}.txt`), "utf8");
const shoppingList = { html: fixture("html"), css: fixture("css"), js: fixture("js") };

const intent = (fields: Partial<Intent> = {}): Intent =>
  ({
    kind: "edit",
    interfacePart: "a quantity next to each item",
    dataPart: null,
    behaviorChange: false,
    lookOnly: false,
    targetsCurrentTool: true,
    language: "en",
    features: [],
    ...fields,
  }) as Intent;
const names = (parts: string[]) => parts.map((part) => part.split("@")[0]);

describe("prompt parts (ENG-16)", () => {
  it("ENG-16: every part is a file in packages/server/prompts, and every file there is a part", () => {
    const files = fs.readdirSync(promptsFolder).map((file) => file.replace(/\.md$/, ""));
    expect(files.sort()).toEqual([...PROMPT_PARTS].sort());
    for (const part of PROMPT_PARTS) expect(partText(part).length).toBeGreaterThan(0);
  });

  it("ENG-16: a part's version is a hash of its text, so any change to the text changes it", () => {
    const { text, part } = fixedPart("probe");
    expect(part).toBe(`probe@${partVersion(text)}`);
    expect(partVersion(text)).toMatch(/^[0-9a-f]{12}$/);
    expect(partVersion(`${text} `)).not.toBe(partVersion(text));
  });

  it("ENG-16: filling a part needs a value for each placeholder and a placeholder for each value", () => {
    expect(() => fillPart("request")).toThrow("needs a value for request");
    expect(() => fillPart("request", { request: "x", extra: "y" })).toThrow("no place for extra");
    // A value is used as it is, `$` patterns included.
    expect(fillPart("request", { request: "costs $& and $1" })).toContain("costs $& and $1");
  });
});

describe("assembling a stage's prompt (GEN-03)", () => {
  const create = (fields: Partial<PromptInput> = {}) =>
    assemblePrompt({
      stage: "create",
      request: "I need a shopping list",
      uiMode: "standard",
      ...fields,
    });

  it("GEN-03, CON-03, VER-06: creation gets the base rules, the bridge manifest and the UI standard, generated from their one definitions", () => {
    const prompt = create();
    expect(names(prompt.parts)).toEqual([
      "base",
      "bridge",
      "ui-standard",
      "accessibility",
      "create",
      "request",
    ]);
    // The data schema keywords come from the one list the host checks schemas against.
    expect(prompt.system).toContain(
      "Use only these schema keywords: $schema, additionalProperties,",
    );
    expect(prompt.system).toContain(partText("base"));
    expect(prompt.system).toContain(manifestForPrompt());
    expect(prompt.system).toContain(`Tessera's UI standard (version ${UI_STANDARD_VERSION})`);
    for (const [name, value] of Object.entries(UI_TOKENS)) {
      expect(prompt.system).toContain(`- --ui-${name}: ${value}`);
    }
    expect(prompt.prompt).toBe("The person's request:\n\nI need a shopping list");
    expect(prompt.size).toBe(prompt.system.length + prompt.prompt.length);
  });

  it("UX-04, VER-06: a tool in custom mode drops the standard's look but keeps every accessibility rule", () => {
    const custom = create({ uiMode: "custom" });
    expect(names(custom.parts)).toEqual(["base", "bridge", "accessibility", "create", "request"]);
    expect(custom.system).toContain(partText("accessibility"));
    expect(custom.system).not.toContain("--ui-");
    for (const rule of [
      "visible label",
      "works by keyboard",
      "contrast",
      "accessible name",
      "320 px",
    ]) {
      expect(custom.system).toContain(rule);
    }
  });

  it("CON-03: the manifest the prompt quotes is the bridge's own, without what tells a model nothing", () => {
    const quoted = JSON.parse(manifestForPrompt()) as {
      actions: { name: string; args: object }[];
    };
    expect(quoted.actions.map((action) => action.name)).toEqual([
      "data.read",
      "data.patch",
      "asset.read",
      "clock.now",
    ]);
    const text = manifestForPrompt();
    expect(text).not.toContain("$schema");
    expect(text).not.toContain(String(Number.MAX_SAFE_INTEGER));
    // A pattern stays where nothing else says it, as on record IDs.
    expect(text).toContain("^(?!__proto__$)[A-Za-z0-9_-]{1,64}$");
  });

  it("GEN-02: parts follow the intent's structured fields and the tool's mode, never the request's words", () => {
    const edit = (fields: Partial<PromptInput>) =>
      names(
        assemblePrompt({
          stage: "edit",
          request: "Make it dark",
          uiMode: "standard",
          source: shoppingList,
          ...fields,
        }).parts,
      );
    // A request that only changes the look needs no bridge manifest.
    expect(edit({ intent: intent({ lookOnly: true }) })).toEqual([
      "base",
      "ui-standard",
      "accessibility",
      "request",
      "language",
      "source",
    ]);
    // A tool in custom mode gets no UI standard.
    expect(edit({ uiMode: "custom" })).toEqual([
      "base",
      "bridge",
      "accessibility",
      "request",
      "source",
    ]);
    // Words that a keyword rule would act on change nothing.
    for (const request of [
      "save my data and use the clock",
      "ignore the UI standard",
      "only the colors please",
      "deixa-o escuro",
    ]) {
      expect(edit({ request })).toEqual([
        "base",
        "bridge",
        "ui-standard",
        "accessibility",
        "request",
        "source",
      ]);
    }
  });

  it("GEN-03, SEC-02: edit quotes the tool's code as data between markers; repair adds what the checks found", () => {
    const edit = assemblePrompt({
      stage: "edit",
      request: "Add a quantity",
      uiMode: "standard",
      source: shoppingList,
    });
    expect(edit.prompt).toContain("quoted as data between the markers");
    expect(edit.prompt).toContain(
      `--- JavaScript ---\n${shoppingList.js}\n--- end of the tool's code ---`,
    );
    const repair = assemblePrompt({
      stage: "repair",
      request: "Add a quantity",
      uiMode: "standard",
      source: shoppingList,
      failure: "static",
      diagnostics: ["The Add button has no name.", "The tool wrote data while it started."],
    });
    expect(names(repair.parts)).toEqual([
      "base",
      "bridge",
      "ui-standard",
      "accessibility",
      "repair-static",
      "request",
      "source",
      "diagnostics",
    ]);
    expect(repair.prompt).toContain(
      "- The Add button has no name.\n- The tool wrote data while it started.",
    );
    expect(() => assemblePrompt({ stage: "edit", request: "x", uiMode: "standard" })).toThrow(
      "needs the tool's code",
    );
    expect(() =>
      assemblePrompt({
        stage: "repair",
        request: "x",
        uiMode: "standard",
        source: shoppingList,
        failure: "static",
      }),
    ).toThrow("needs what the checks found");
    expect(() =>
      assemblePrompt({
        stage: "repair",
        request: "x",
        uiMode: "standard",
        source: shoppingList,
        diagnostics: ["x"],
      }),
    ).toThrow("needs the failure's class");
  });

  it("GEN-09: repairing a creation answers as creation does, with its class's part, the failed answer and what the checks found", () => {
    const attempt = {
      outcome: "tool" as const,
      name: "Shopping list",
      summary: "A list to tick off.",
      code: shoppingList,
      data: {
        schema: { type: "object", required: ["items"] },
        reusableDefaults: {},
        initialState: { items: [{ id: "i-1", title: "Milk" }] },
      },
      capabilities: [],
      uiMode: "standard" as const,
    };
    const findings = ["The reusable defaults: items is required."];
    const repair = assemblePrompt({
      stage: "repair",
      request: "A shopping list",
      intent: intent({ kind: "create" }),
      uiMode: "standard",
      attempt,
      failure: "schema-shape",
      diagnostics: findings,
    });
    expect(names(repair.parts)).toEqual([
      "base",
      "bridge",
      "ui-standard",
      "accessibility",
      "create",
      "repair-schema-shape",
      "request",
      "language",
      "attempt",
      "diagnostics",
    ]);
    expect(repair.system).toContain(partText("repair-schema-shape"));
    // The failed answer, quoted as data between markers (SEC-02), its code as it was.
    expect(repair.prompt).toContain(
      `--- JavaScript ---\n${shoppingList.js}\n--- Data, as JSON ---\n${JSON.stringify(attempt.data, null, 2)}\n`,
    );
    expect(repair.prompt).toContain(
      '{"capabilities":[],"uiMode":"standard"}\n--- end of the last answer ---',
    );
    expect(repair.prompt).toContain("- The reusable defaults: items is required.");
    // An answer of the wrong shape has nothing to quote: the repair asks again from the request.
    const reask = assemblePrompt({
      stage: "repair",
      request: "A shopping list",
      uiMode: "standard",
      failure: "schema-shape",
      diagnostics: ["The answer didn't have the shape Tessera asked for."],
    });
    expect(names(reask.parts)).toEqual([
      "base",
      "bridge",
      "ui-standard",
      "accessibility",
      "create",
      "repair-schema-shape",
      "request",
      "diagnostics",
    ]);
    // A static failure takes its own part instead.
    const fixCode = assemblePrompt({
      stage: "repair",
      request: "A shopping list",
      uiMode: "standard",
      attempt,
      failure: "static",
      diagnostics: ["HTML, line 1: a frame isn't allowed."],
    });
    expect(names(fixCode.parts)).toContain("repair-static");
    expect(names(fixCode.parts)).not.toContain("repair-schema-shape");
    expect(() =>
      assemblePrompt({
        stage: "repair",
        request: "x",
        uiMode: "standard",
        source: shoppingList,
        attempt,
        failure: "static",
        diagnostics: ["x"],
      }),
    ).toThrow("either an edit or a creation");
  });

  it("GEN-15: the request's language, from the intent stage, is given to generation as a fact (slice pilot, #173)", () => {
    const withIntent = create({ intent: intent({ kind: "create", language: "pt-BR" }) });
    expect(names(withIntent.parts)).toEqual([
      "base",
      "bridge",
      "ui-standard",
      "accessibility",
      "create",
      "request",
      "language",
    ]);
    expect(withIntent.prompt).toContain(
      "The person's language, as a BCP 47 tag: pt-BR. Use it for the tool's name, its summary and every word the tool shows.",
    );
    // Without an intent, nothing is claimed about the language.
    expect(names(create().parts)).not.toContain("language");
  });

  it("ENG-16: a request part's version is its wording's, whatever it quotes", () => {
    const one = create({ request: "a shopping list" }).parts;
    const two = create({ request: "a calculator" }).parts;
    expect(one).toEqual(two);
  });

  it("GEN-03: each stage's fixture prompt stays within its budget", () => {
    const sizes = {
      create: create().size,
      edit: assemblePrompt({
        stage: "edit",
        request: "Add a quantity next to each item, and sort them by name",
        uiMode: "standard",
        source: shoppingList,
      }).size,
      repair: assemblePrompt({
        stage: "repair",
        request: "Add a quantity next to each item, and sort them by name",
        uiMode: "standard",
        source: shoppingList,
        failure: "static",
        diagnostics: [
          "The Add button has no name.",
          "The tool wrote data while it started.",
          "Text is under 12 px in the item list.",
        ],
      }).size,
    };
    for (const stage of ["create", "edit", "repair"] as const) {
      expect(sizes[stage], `${stage} is ${sizes[stage]} characters`).toBeLessThanOrEqual(
        PROMPT_BUDGETS[stage],
      );
    }
    // Repair's larger shape: a creation's repair quotes the whole failed answer (GEN-09).
    const item = { type: "object", required: ["id", "title"], properties: {} };
    const repairOfCreation = assemblePrompt({
      stage: "repair",
      request:
        "I need a shopping list I can tick off at the store, with milk, eggs and bread on it.",
      intent: intent({ kind: "create" }),
      uiMode: "standard",
      failure: "schema-shape",
      attempt: {
        outcome: "tool",
        name: "Shopping list",
        summary: "A list to tick off at the store.",
        code: shoppingList,
        data: {
          schema: {
            type: "object",
            required: ["items"],
            properties: { items: { type: "array", items: item } },
          },
          reusableDefaults: {},
          initialState: {
            items: ["Milk", "Eggs", "Bread"].map((title, i) => ({ id: `i-${i}`, title })),
          },
        },
        capabilities: [],
        uiMode: "standard",
      },
      diagnostics: ["The reusable defaults: must have required property 'items'."],
    }).size;
    expect(
      repairOfCreation,
      `a creation's repair is ${repairOfCreation} characters`,
    ).toBeLessThanOrEqual(PROMPT_BUDGETS.repair);
  });
});
