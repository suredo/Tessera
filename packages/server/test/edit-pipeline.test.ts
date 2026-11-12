import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_ROUTES, type Intent } from "@tessera/contracts";
import { candidateFrom, generate, PLAIN_CANNOT_REASON } from "../src/generation/index.ts";
import { repairSmoke, type SmokeRepairContext } from "../src/generation/smoke.ts";
import { createScriptedProvider, type Provider } from "../src/providers/index.ts";
import { openDataFolder } from "../src/storage/index.ts";
import { loadVersion, saveVersion } from "../src/versions/index.ts";
import {
  activateVersion,
  createWorkspace,
  getWorkspace,
  listWorkspaces,
  replaceData,
  workspaceVersions,
} from "../src/workspaces/index.ts";
import { editFixture, noEdit, quantityEdit, styleEdit } from "./fixtures/edit-tool.ts";

const folders: { path: string; close(): void }[] = [];
afterAll(() =>
  folders.forEach((f) => {
    f.close();
    fs.rmSync(f.path, { recursive: true, force: true });
  }),
);
async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-edit-pipeline-"));
  const store = await openDataFolder(dir);
  folders.push({ path: dir, close: () => store.close() });
  const built = candidateFrom(editFixture);
  if (built.kind !== "candidate") throw new Error("Expected fixture candidate");
  const workspace = createWorkspace(store, editFixture.name, { data: built.startingData });
  const hash = saveVersion(store.db, built.artifact);
  const active = activateVersion(store, workspace.id, hash, workspace.dataRevision);
  if (!active.ok) throw new Error("Expected fixture activation");
  return { store, workspace: active.workspace, hash, artifact: built.artifact };
}
const intent = (overrides: Partial<Intent> = {}): Intent =>
  ({
    kind: "edit",
    interfacePart: null,
    dataPart: null,
    language: "en",
    lookOnly: false,
    behaviorChange: true,
    targetsCurrentTool: true,
    features: [],
    ...overrides,
  }) as Intent;
const reply = (value: unknown, stage: "intent" | "edit" | "repair") => ({
  kind: "value",
  value,
  stage,
});
const provider = (...replies: unknown[]) =>
  createScriptedProvider({ name: "edit-pipeline", replies: replies as never });

describe("a data change an edit needs is kept, not repaired away (L-97)", () => {
  it("L-97, GEN-13: an edit that migrates the data while the intent expected no behavior change is the candidate, with no repair", async () => {
    const { store, workspace } = await setup();
    const stages: string[] = [];
    const scripted = provider(
      reply(intent({ behaviorChange: false }), "intent"),
      reply(quantityEdit, "edit"),
    );
    const result = await generate(
      store,
      {
        ...scripted,
        run: (spec) => {
          stages.push(spec.stage);
          return scripted.run(spec);
        },
      },
      DEFAULT_ROUTES,
      { request: "Create a new category, in review", workspaceId: workspace.id },
    );
    expect(result).toMatchObject({ kind: "candidate", operation: "edit" });
    expect(stages).toEqual(["intent", "edit"]);
    if (result.kind !== "candidate") throw new Error("Expected edit candidate");
    // The migration is in the candidate, so its code and its data agree.
    expect(loadVersion(store.db, result.hash)).toMatchObject({
      kind: "ok",
      artifact: { data: { schemaVersion: 2 } },
    });
  });
});

describe("a look CSS alone can't make is tried as a code edit (L-96)", () => {
  /** A look-only edit whose replies are `replies`, with the prompt parts each edit call got. */
  async function lookEdit(...replies: unknown[]) {
    const { store, workspace } = await setup();
    const calls: { stage: string; parts: string[] }[] = [];
    const scripted = provider(
      reply(intent({ lookOnly: true, behaviorChange: false }), "intent"),
      ...replies,
    );
    const result = await generate(
      store,
      {
        ...scripted,
        run: (spec) => {
          calls.push({
            stage: spec.stage,
            parts: (spec.promptParts ?? []).map((part) => part.split("@")[0]!),
          });
          return scripted.run(spec);
        },
      },
      DEFAULT_ROUTES,
      { request: "Make the cards dangle as they follow the mouse", workspaceId: workspace.id },
    );
    return { result, edits: calls.filter((call) => call.stage === "edit") };
  }
  const cannot = reply({ outcome: "cannot", reason: "This needs the tool's code." }, "edit");

  it("L-96, GEN-14: a look-only edit that says CSS can't do it is asked once more with the tool's code, and its edit is the candidate", async () => {
    const { result, edits } = await lookEdit(cannot, reply(styleEdit, "edit"));
    expect(result).toMatchObject({ kind: "candidate", operation: "edit" });
    expect(edits).toHaveLength(2);
    expect(edits[0]!.parts).toContain("source-style");
    expect(edits[1]!.parts).toContain("source");
    expect(edits[1]!.parts).not.toContain("source-style");
  });

  it("L-96, GEN-08: when the code edit can't do it either, the person is told so, after one retry only", async () => {
    const { result, edits } = await lookEdit(cannot, cannot);
    expect(result).toMatchObject({ kind: "answer", answer: "cannot" });
    expect(edits).toHaveLength(2);
  });

  it("GEN-14: a look-only edit that works is made with CSS alone, in one call", async () => {
    const { result, edits } = await lookEdit(reply(styleEdit, "edit"));
    expect(result).toMatchObject({ kind: "candidate", operation: "edit" });
    expect(edits).toHaveLength(1);
  });
});

describe("an edit keeps the tool's own profile (VER-03, L-94)", () => {
  /** Edits the fixture, made with `made` as its checked profile, while the intent names `named`. */
  async function editWith(made: "item-list" | null, named: Intent["profile"]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-edit-profile-"));
    const store = await openDataFolder(dir);
    folders.push({ path: dir, close: () => store.close() });
    const built = candidateFrom(editFixture);
    if (built.kind !== "candidate") throw new Error("Expected fixture candidate");
    const workspace = createWorkspace(store, editFixture.name, { data: built.startingData });
    const hash = saveVersion(store.db, built.artifact);
    const active = activateVersion(store, workspace.id, hash, workspace.dataRevision, {
      note: made
        ? { summary: "A list.", checks: ["code", "start", "behavior"], profile: made }
        : { summary: "A calendar.", checks: ["code", "start", "acceptance"], profile: null },
    });
    if (!active.ok) throw new Error("Expected fixture activation");
    const specs: { stage: string; parts: string[] }[] = [];
    const scripted = provider(
      reply(intent({ profile: named }), "intent"),
      reply(quantityEdit, "edit"),
    );
    const result = await generate(
      store,
      {
        ...scripted,
        run: (spec) => {
          specs.push({
            stage: spec.stage,
            parts: (spec.promptParts ?? []).map((part) => part.split("@")[0]!),
          });
          return scripted.run(spec);
        },
      },
      DEFAULT_ROUTES,
      { request: "Click a day to add an event", workspaceId: active.workspace.id },
    );
    return { result, editParts: specs.find((spec) => spec.stage === "edit")!.parts };
  }

  it("VER-03, L-94: a tool made with no profile gets none when its edit's intent names one, so no new check is imposed", async () => {
    const { result, editParts } = await editWith(null, "scheduling");
    expect(result).toMatchObject({ kind: "candidate", operation: "edit", profile: null });
    expect(editParts).not.toContain("profile");
  });

  it("VER-03, L-94: a tool checked by a profile keeps it when its edit's intent names another or none", async () => {
    for (const named of ["scheduling", null] as const) {
      const { result, editParts } = await editWith("item-list", named);
      expect(result).toMatchObject({ kind: "candidate", operation: "edit", profile: "item-list" });
      expect(editParts).toContain("profile");
    }
  });
});

describe("edits through the pipeline (GEN-07, GEN-09)", () => {
  it("GEN-07, GEN-13, DATA-10: an edit candidate leaves the current version and entries intact until activation, and keeps the name and declarations", async () => {
    const { store, workspace, artifact } = await setup();
    const result = await generate(
      store,
      provider(reply(intent(), "intent"), reply(quantityEdit, "edit")),
      DEFAULT_ROUTES,
      { request: "Add quantities", workspaceId: workspace.id },
    );
    expect(result).toMatchObject({
      kind: "candidate",
      operation: "edit",
      workspaceId: workspace.id,
      expectedDataRevision: workspace.dataRevision,
      name: workspace.title,
    });
    expect(getWorkspace(store, workspace.id)).toEqual(workspace);
    expect(listWorkspaces(store)).toHaveLength(1);
    if (result.kind !== "candidate") throw new Error("Expected edit candidate");
    expect(loadVersion(store.db, result.hash)).toMatchObject({
      kind: "ok",
      // The host keeps what the edit contract can't change: declarations and UI settings (GEN-13).
      artifact: {
        data: { schemaVersion: 2 },
        ui: artifact.ui,
        capabilities: artifact.capabilities,
        pins: artifact.pins,
      },
    });
    expect(
      activateVersion(store, workspace.id, result.hash, result.expectedDataRevision),
    ).toMatchObject({
      ok: true,
      workspace: {
        data: {
          items: [
            { id: "i-1", title: "Milk", quantity: 1 },
            { id: "i-2", title: "Eggs", quantity: 1 },
          ],
        },
      },
    });
    expect(workspaceVersions(store, workspace.id)).toHaveLength(2);
    // And its name: an edit never renames the tool (GEN-13, L-36).
    expect(getWorkspace(store, workspace.id)?.title).toBe(workspace.title);
  });

  it("GEN-07: identical output never stores or activates a new history entry", async () => {
    const { store, workspace } = await setup();
    expect(
      await generate(
        store,
        provider(reply(intent(), "intent"), reply(noEdit, "edit")),
        DEFAULT_ROUTES,
        { request: "Keep it as it is", workspaceId: workspace.id },
      ),
    ).toEqual({ kind: "answer", answer: "unchanged", reason: "Kept the tool as it is." });
    expect(getWorkspace(store, workspace.id)).toEqual(workspace);
    expect(workspaceVersions(store, workspace.id)).toHaveLength(1);
  });

  it("GEN-08, GEN-07: an unchanged edit still says what no tool here can do, and stores nothing", async () => {
    const { store, workspace } = await setup();
    const leftOut = ["Finding videos on the internet"];
    expect(
      await generate(
        store,
        provider(reply(intent(), "intent"), reply({ ...noEdit, leftOut }, "edit")),
        DEFAULT_ROUTES,
        { request: "Find videos for it", workspaceId: workspace.id },
      ),
    ).toEqual({ kind: "answer", answer: "unchanged", reason: "Kept the tool as it is.", leftOut });
    expect(workspaceVersions(store, workspace.id)).toHaveLength(1);
  });

  it("GEN-13: a data revision changed during intent or editing is refused without overwriting it", async () => {
    for (const when of ["intent", "edit"] as const) {
      const { store, workspace } = await setup();
      const scripted = provider(reply(intent(), "intent"), reply(styleEdit, "edit"));
      const actual: Provider = {
        ...scripted,
        async run(spec) {
          const value = await scripted.run(spec);
          if (spec.stage === when)
            replaceData(store, getWorkspace(store, workspace.id)!, {
              items: [{ id: "new", title: "Newer entry" }],
            });
          return value;
        },
      };
      expect(
        await generate(store, actual, DEFAULT_ROUTES, {
          request: "Make it darker",
          workspaceId: workspace.id,
        }),
      ).toEqual({ kind: "answer", answer: "stale" });
      expect(getWorkspace(store, workspace.id)).toMatchObject({
        currentVersion: workspace.currentVersion,
        data: { items: [{ id: "new", title: "Newer entry" }] },
      });
      expect(workspaceVersions(store, workspace.id)).toHaveLength(1);
      expect(scripted.remaining()).toBe(when === "intent" ? 1 : 0);
    }
  });

  it("GEN-09: failed edits, even after repair, keep the active tool and entries", async () => {
    const { store, workspace, artifact } = await setup();
    const unsafe = {
      ...noEdit,
      files: { mode: "replace", code: { ...artifact.code, html: '<iframe src="x"></iframe>' } },
    };
    expect(
      await generate(
        store,
        provider(reply(intent(), "intent"), reply(unsafe, "edit"), reply(unsafe, "repair")),
        DEFAULT_ROUTES,
        { request: "Add a frame", workspaceId: workspace.id },
      ),
    ).toMatchObject({ kind: "failed", failure: "static" });
    expect(getWorkspace(store, workspace.id)).toEqual(workspace);
    expect(workspaceVersions(store, workspace.id)).toHaveLength(1);
  });

  it("GEN-12, GEN-10: a smoke repair that refuses in Tessera's own words says so plainly, and keeps its words for the details", async () => {
    const { store, workspace } = await setup();
    let context: SmokeRepairContext | undefined;
    const candidate = await generate(
      store,
      provider(reply(intent(), "intent"), reply(quantityEdit, "edit")),
      DEFAULT_ROUTES,
      { request: "Add quantities", workspaceId: workspace.id },
      undefined,
      (c) => {
        context = c;
      },
    );
    if (candidate.kind !== "candidate" || !context) throw new Error("Expected continuation");
    const repaired = await repairSmoke(
      store,
      provider(
        reply({ outcome: "cannot", reason: "The runtime cannot read this JSON schema." }, "repair"),
      ),
      DEFAULT_ROUTES,
      { workspaceId: workspace.id, hash: candidate.hash, findings: ["1 field has no label."] },
      context,
    );
    expect(repaired).toEqual({
      kind: "answer",
      answer: "cannot",
      reason: PLAIN_CANNOT_REASON,
      findings: ["The runtime cannot read this JSON schema."],
    });
    // Nothing changed: the working tool and its entries stay.
    expect(getWorkspace(store, workspace.id)).toEqual(workspace);
  });

  it("GEN-14, GEN-09: a look-only edit's smoke repair is shown only the page and its style, and its failed answer as a style answer", async () => {
    const { store, workspace, artifact } = await setup();
    let context: SmokeRepairContext | undefined;
    const look = intent({ lookOnly: true, behaviorChange: false });
    const style = {
      ...noEdit,
      summary: "Made it darker.",
      files: { mode: "style", css: "body{background:#111;color:#eee}" },
    };
    const candidate = await generate(
      store,
      provider(reply(look, "intent"), reply(style, "edit")),
      DEFAULT_ROUTES,
      { request: "Make it darker", workspaceId: workspace.id },
      undefined,
      (c) => {
        context = c;
      },
    );
    if (candidate.kind !== "candidate" || !context) throw new Error("Expected continuation");
    const prompts: string[] = [];
    const scripted = provider(
      reply(
        { ...style, files: { mode: "style", css: "body{background:#222;color:#eee}" } },
        "repair",
      ),
    );
    const watched: Provider = {
      ...scripted,
      run: (spec) => {
        prompts.push(spec.prompt);
        return scripted.run(spec);
      },
    };
    const repaired = await repairSmoke(
      store,
      watched,
      DEFAULT_ROUTES,
      { workspaceId: workspace.id, hash: candidate.hash, findings: ["The text is hard to read."] },
      context,
    );
    expect(repaired).toMatchObject({ kind: "candidate", operation: "edit" });
    // The repair never sees the behavior it must keep, nor gets it back to rewrite.
    expect(prompts[0]).not.toContain(artifact.code.js.trim());
    expect(prompts[0]).toContain('"mode":"style"');
    if (repaired.kind !== "candidate") throw new Error("Expected repaired candidate");
    const version = loadVersion(store.db, repaired.hash);
    expect(version?.kind === "ok" && version.artifact.code).toEqual({
      ...artifact.code,
      css: "body{background:#222;color:#eee}",
    });
  });

  it("GEN-09: smoke repair continues an edit against the still-active original version and preserves its migration", async () => {
    const { store, workspace } = await setup();
    let context: SmokeRepairContext | undefined;
    const candidate = await generate(
      store,
      provider(reply(intent(), "intent"), reply(quantityEdit, "edit")),
      DEFAULT_ROUTES,
      { request: "Add quantities", workspaceId: workspace.id },
      undefined,
      (c) => {
        context = c;
      },
    );
    if (candidate.kind !== "candidate" || !context) throw new Error("Expected continuation");
    expect(context.baseVersion).toBe(workspace.currentVersion);
    if (quantityEdit.files.mode !== "replace") throw new Error("Expected file fixture");
    const fixed = {
      ...quantityEdit,
      files: {
        mode: "replace",
        code: {
          ...quantityEdit.files.code,
          html: '<h1>Shopping list</h1><ul id="items"></ul><label for="x">Note</label><input id="x">',
        },
      },
    };
    const repaired = await repairSmoke(
      store,
      provider(reply(fixed, "repair")),
      DEFAULT_ROUTES,
      { workspaceId: workspace.id, hash: candidate.hash, findings: ["1 field has no label."] },
      context,
    );
    expect(repaired).toMatchObject({
      kind: "candidate",
      operation: "edit",
      expectedDataRevision: workspace.dataRevision,
    });
    expect(getWorkspace(store, workspace.id)).toEqual(workspace);
    if (repaired.kind !== "candidate") throw new Error("Expected repaired candidate");
    expect(
      activateVersion(store, workspace.id, repaired.hash, repaired.expectedDataRevision),
    ).toMatchObject({
      ok: true,
      workspace: {
        data: {
          items: [
            { id: "i-1", title: "Milk", quantity: 1 },
            { id: "i-2", title: "Eggs", quantity: 1 },
          ],
        },
      },
    });
    expect(context.repairUsage).toEqual({ smoke: 1 });
  });

  it("GEN-09: smoke repair cannot change the failed candidate's data declaration or overwrite a concurrent update", async () => {
    for (const scenario of ["declaration", "stale"] as const) {
      const { store, workspace } = await setup();
      let context: SmokeRepairContext | undefined;
      const candidate = await generate(
        store,
        provider(reply(intent(), "intent"), reply(styleEdit, "edit")),
        DEFAULT_ROUTES,
        { request: "Make it darker", workspaceId: workspace.id },
        undefined,
        (c) => {
          context = c;
        },
      );
      if (candidate.kind !== "candidate" || !context) throw new Error("Expected continuation");
      if (scenario === "stale")
        replaceData(store, getWorkspace(store, workspace.id)!, { items: [] });
      const before = getWorkspace(store, workspace.id);
      const result = await repairSmoke(
        store,
        provider(reply(quantityEdit, "repair")),
        DEFAULT_ROUTES,
        { workspaceId: workspace.id, hash: candidate.hash, findings: ["Nothing shown"] },
        context,
      );
      expect(result).toMatchObject({ kind: "failed", failure: "smoke" });
      expect(getWorkspace(store, workspace.id)).toEqual(before);
      expect(workspaceVersions(store, workspace.id)).toHaveLength(1);
    }
  });
});

describe("an edit that follows a discussion is told its answer (GEN-19)", () => {
  const ANSWER = "A quantity beside each item would work, with a small number field.";
  const told = (prompt: string) =>
    /--- earlier answer ---\n(.*)\n--- end of the earlier answer ---/.exec(prompt)?.[1];
  const followed = async (request: string, decided: Intent) => {
    const { store, workspace } = await setup();
    const calls: { stage: string; prompt: string }[] = [];
    const scripted = provider(reply(decided, "intent"), reply(quantityEdit, "edit"));
    const result = await generate(
      store,
      {
        ...scripted,
        run: (spec) => {
          calls.push({ stage: spec.stage, prompt: spec.prompt });
          return scripted.run(spec);
        },
      },
      DEFAULT_ROUTES,
      {
        request,
        workspaceId: workspace.id,
        discussion: "00000000-0000-4000-8000-0000000000dd",
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      ANSWER,
    );
    return { result, calls };
  };

  it("GEN-19: 'do that' as an edit tells the intent and the edit the answer, quoted", async () => {
    const { result, calls } = await followed("Do that", intent());
    expect(result).toMatchObject({ kind: "candidate", operation: "edit" });
    expect(calls.map((call) => call.stage)).toEqual(["intent", "edit"]);
    for (const call of calls) expect(JSON.parse(told(call.prompt)!)).toBe(ANSWER);
  });

  it("GEN-19: a mixed request's edit half is told it too; its entries wait for the new version", async () => {
    const { result, calls } = await followed(
      "Do that and add bread",
      intent({ kind: "mixed", interfacePart: "Do that", dataPart: "add bread" }),
    );
    expect(result).toMatchObject({ kind: "candidate", operation: "edit", dataPending: true });
    expect(calls.map((call) => call.stage)).toEqual(["intent", "edit"]);
    expect(JSON.parse(told(calls[1]!.prompt)!)).toBe(ANSWER);
  });
});

describe("an entry change that follows a discussion is told its answer (GEN-19)", () => {
  const ANSWER = "Brazil's GDP was about US$2.2 trillion in 2024, from memory, not looked up.";
  const told = (prompt: string) =>
    /--- earlier answer ---\n(.*)\n--- end of the earlier answer ---/.exec(prompt)?.[1];

  it("GEN-19: 'add it' as an entry change tells the intent and the entry plan the answer, quoted", async () => {
    const { store, workspace } = await setup();
    const calls: { stage: string; prompt: string }[] = [];
    const scripted = provider(reply(intent({ kind: "data", behaviorChange: false }), "intent"), {
      kind: "value",
      stage: "data",
      value: {
        outcome: "patch",
        summary: "Adds Brazil's GDP.",
        patch: { operations: [{ op: "add", collection: "items", record: { title: "Brazil" } }] },
      },
    });
    const result = await generate(
      store,
      {
        ...scripted,
        run: (spec) => {
          calls.push({ stage: spec.stage, prompt: spec.prompt });
          return scripted.run(spec);
        },
      },
      DEFAULT_ROUTES,
      {
        request: "Add it to the list",
        workspaceId: workspace.id,
        discussion: "00000000-0000-4000-8000-0000000000de",
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      ANSWER,
    );
    expect(result).toMatchObject({ kind: "data_changed", count: 1 });
    expect(calls.map((call) => call.stage)).toEqual(["intent", "data"]);
    for (const call of calls) expect(JSON.parse(told(call.prompt)!)).toBe(ANSWER);
  });

  it("GEN-19: a mixed request keeps the answer for its entry part, planned once its version is active", async () => {
    const { store, workspace } = await setup();
    const kept: SmokeRepairContext[] = [];
    await generate(
      store,
      provider(
        reply(
          intent({ kind: "mixed", interfacePart: "Show the GDP", dataPart: "add Brazil" }),
          "intent",
        ),
        reply(quantityEdit, "edit"),
      ),
      DEFAULT_ROUTES,
      {
        request: "Show the GDP and add Brazil",
        workspaceId: workspace.id,
        discussion: "00000000-0000-4000-8000-0000000000df",
      },
      undefined,
      (context) => kept.push(context),
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      ANSWER,
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ dataPart: "add Brazil", discussed: ANSWER });
  });
});
