import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_ROUTES, type Intent } from "@tessera/contracts";
import { candidateFrom, generate } from "../src/generation/index.ts";
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

describe("edits through the pipeline (GEN-07, GEN-09)", () => {
  it("GEN-07, DATA-10: an edit candidate leaves the current version and entries intact until activation", async () => {
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
      artifact: { data: { schemaVersion: 2 }, ui: artifact.ui },
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
    ).toEqual({ kind: "answer", answer: "unchanged" });
    expect(getWorkspace(store, workspace.id)).toEqual(workspace);
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
