import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ACTIVATION_ROUTE,
  DEFAULT_ROUTES,
  GENERATE_ROUTE,
  activationReplySchema,
  generateReplySchema,
  type Intent,
} from "@tessera/contracts";
import { candidateFrom, generationRoutes } from "../src/generation/index.ts";
import { startLocalServer } from "../src/http/index.ts";
import { JobQueue } from "../src/jobs/index.ts";
import { createScriptedProvider } from "../src/providers/index.ts";
import { openDataFolder } from "../src/storage/index.ts";
import { saveVersion } from "../src/versions/index.ts";
import {
  activateVersion,
  addWorkspaceVersion,
  createWorkspace,
  getWorkspace,
  restoreVersion,
  saveTool,
  useAgain,
  workspaceVersions,
} from "../src/workspaces/index.ts";
import { editFixture } from "./fixtures/edit-tool.ts";

// A version keeps what it was made for and the host's checks it passed (APP-05, #121): a request's
// candidate carries its summary and checks to its activation; a restore or Use again of the same
// code keeps that note, as it is the same code; a version written by hand has none.

const intent: Intent = {
  kind: "create",
  interfacePart: null,
  dataPart: null,
  language: "en",
  features: [],
  targetsCurrentTool: false,
  behaviorChange: false,
  lookOnly: false,
};

const clean: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const close of clean.splice(0).reverse()) await close();
});
async function folder() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-notes-"));
  const store = await openDataFolder(dir);
  clean.push(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return store;
}

describe("a version's note (APP-05)", () => {
  it("APP-05, GEN-12: a request's version keeps its summary and the code check, and the start check only when staging reports it", async () => {
    const store = await folder();
    const provider = createScriptedProvider({
      name: "notes",
      replies: [
        { kind: "value", stage: "intent", value: intent },
        { kind: "value", stage: "create", value: editFixture as never },
        { kind: "value", stage: "intent", value: intent },
        { kind: "value", stage: "create", value: editFixture as never },
      ],
    });
    const server = await startLocalServer({
      port: 0,
      routes: generationRoutes({
        store,
        jobs: new JobQueue(),
        provider: () => Promise.resolve(provider),
        routes: () => DEFAULT_ROUTES,
      }),
    });
    clean.push(() => server.close());
    const post = async (route: string, value: unknown) => {
      const response = await fetch(new URL(route, server.url), {
        method: "POST",
        headers: { origin: server.url.replace(/\/$/, ""), "content-type": "application/json" },
        body: JSON.stringify(value),
      });
      return await response.json();
    };
    const make = async (startChecked: boolean) => {
      const reply = generateReplySchema.parse(await post(GENERATE_ROUTE, { request: "A list" }));
      if (reply.kind !== "candidate") throw new Error("Expected a candidate");
      const activated = activationReplySchema.parse(
        await post(ACTIVATION_ROUTE, {
          token: reply.activation.token,
          workspaceId: reply.workspaceId,
          hash: reply.hash,
          expectedDataRevision: reply.expectedDataRevision,
          ...(startChecked ? { startChecked: true } : {}),
        }),
      );
      expect(activated.ok).toBe(true);
      return workspaceVersions(store, reply.workspaceId);
    };
    // Activated without staging saying its start check passed: only the host's own code check.
    expect(await make(false)).toMatchObject([
      { index: 1, summary: editFixture.summary, checks: ["code"] },
    ]);
    // Staged, as the app does, and reported: both.
    expect(await make(true)).toMatchObject([
      { index: 1, summary: editFixture.summary, checks: ["code", "start"] },
    ]);
  });

  it("VER-08: a version keeps the behavior check and its profile only when the server named the profile and staging reports the start and behavior checks passed", async () => {
    const store = await folder();
    const listIntent: Intent = { ...intent, profile: "item-list" };
    const provider = createScriptedProvider({
      name: "behavior",
      replies: [
        ...[listIntent, listIntent, listIntent, intent].flatMap((value) => [
          { kind: "value" as const, stage: "intent" as const, value },
          { kind: "value" as const, stage: "create" as const, value: editFixture as never },
        ]),
      ],
    });
    const server = await startLocalServer({
      port: 0,
      routes: generationRoutes({
        store,
        jobs: new JobQueue(),
        provider: () => Promise.resolve(provider),
        routes: () => DEFAULT_ROUTES,
      }),
    });
    clean.push(() => server.close());
    const post = async (route: string, value: unknown) => {
      const response = await fetch(new URL(route, server.url), {
        method: "POST",
        headers: { origin: server.url.replace(/\/$/, ""), "content-type": "application/json" },
        body: JSON.stringify(value),
      });
      return await response.json();
    };
    const make = async (reported: { startChecked?: true; behaviorChecked?: true }) => {
      const reply = generateReplySchema.parse(await post(GENERATE_ROUTE, { request: "A list" }));
      if (reply.kind !== "candidate") throw new Error("Expected a candidate");
      const activated = activationReplySchema.parse(
        await post(ACTIVATION_ROUTE, {
          token: reply.activation.token,
          workspaceId: reply.workspaceId,
          hash: reply.hash,
          expectedDataRevision: reply.expectedDataRevision,
          ...reported,
        }),
      );
      expect(activated.ok).toBe(true);
      return workspaceVersions(store, reply.workspaceId)[0];
    };
    // The profile the server named, and both checks reported: the behavior check and its profile.
    expect(await make({ startChecked: true, behaviorChecked: true })).toMatchObject({
      checks: ["code", "start", "behavior"],
      profile: "item-list",
    });
    // Only the start check reported: no behavior check.
    expect(await make({ startChecked: true })).toMatchObject({
      checks: ["code", "start"],
      profile: null,
    });
    // A behavior check reported without the start check it follows: neither is recorded.
    expect(await make({ behaviorChecked: true })).toMatchObject({
      checks: ["code"],
      profile: null,
    });
    // No profile named by the server: the browser's word alone records none.
    expect(await make({ startChecked: true, behaviorChecked: true })).toMatchObject({
      checks: ["code", "start"],
      profile: null,
    });
  });

  it("VER-08: a note's profile is kept only with the behavior check it names, and Use again keeps both", async () => {
    const store = await folder();
    const built = candidateFrom(editFixture);
    if (built.kind !== "candidate") throw new Error("Bad fixture");
    const hash = saveVersion(store.db, built.artifact);
    const checked = createWorkspace(store, "Checked");
    activateVersion(store, checked.id, hash, checked.dataRevision, {
      note: { summary: "A list.", checks: ["code", "start", "behavior"], profile: "item-list" },
    });
    const again = useAgain(store, saveTool(store, checked.id, "List").id);
    if (!again.ok) throw new Error(again.message);
    expect(workspaceVersions(store, again.workspace.id)).toMatchObject([
      { checks: ["code", "start", "behavior"], profile: "item-list" },
    ]);
    const other = saveVersion(store.db, {
      ...built.artifact,
      code: { ...built.artifact.code, css: "body{color:#333}" },
    });
    const unchecked = createWorkspace(store, "Unchecked");
    activateVersion(store, unchecked.id, other, unchecked.dataRevision, {
      note: { summary: "A list.", checks: ["code", "start"], profile: "item-list" },
    });
    expect(workspaceVersions(store, unchecked.id)).toMatchObject([
      { checks: ["code", "start"], profile: null },
    ]);
  });

  it("APP-05: Use again keeps the saved tool's note, another workspace's same code doesn't take it, and a hand-written version has none", async () => {
    const store = await folder();
    const built = candidateFrom(editFixture);
    if (built.kind !== "candidate") throw new Error("Bad fixture");
    const hash = saveVersion(store.db, built.artifact);
    const first = createWorkspace(store, "First");
    expect(
      activateVersion(store, first.id, hash, first.dataRevision, {
        note: { summary: "Made a shopping list.", checks: ["code", "start"], profile: null },
      }).ok,
    ).toBe(true);
    // Use again starts another workspace from the saved tool's own version, with its note.
    const saved = saveTool(store, first.id, "Weekly shop");
    const again = useAgain(store, saved.id);
    if (!again.ok) throw new Error(again.message);
    expect(workspaceVersions(store, again.workspace.id)).toMatchObject([
      { summary: "Made a shopping list.", checks: ["code", "start"] },
    ]);
    // Another workspace activating the same code by itself doesn't take that note.
    const elsewhere = createWorkspace(store, "Elsewhere");
    expect(activateVersion(store, elsewhere.id, hash, elsewhere.dataRevision).ok).toBe(true);
    expect(workspaceVersions(store, elsewhere.id)).toMatchObject([{ summary: null, checks: [] }]);
    // Code nobody generated or checked, as a hand-written tool, has no note.
    const other = saveVersion(store.db, {
      ...built.artifact,
      code: { ...built.artifact.code, html: "<p>By hand</p>" },
    });
    const hand = createWorkspace(store, "By hand");
    expect(addWorkspaceVersion(store, hand.id, other)).toMatchObject({ summary: null, checks: [] });
  });

  it("APP-05: a restore keeps this workspace's own note for that code, never another workspace's", async () => {
    const store = await folder();
    const built = candidateFrom(editFixture);
    if (built.kind !== "candidate") throw new Error("Bad fixture");
    const same = saveVersion(store.db, built.artifact);
    const next = saveVersion(store.db, {
      ...built.artifact,
      code: { ...built.artifact.code, css: "body{color:#333}" },
    });
    const a = createWorkspace(store, "A");
    activateVersion(store, a.id, same, a.dataRevision, {
      note: { summary: "First context.", checks: ["code", "start"], profile: null },
    });
    const b = createWorkspace(store, "B");
    activateVersion(store, b.id, same, b.dataRevision, {
      note: { summary: "Second context.", checks: ["code"], profile: null },
    });
    activateVersion(store, b.id, next, getWorkspace(store, b.id)!.dataRevision, {
      note: { summary: "Darker text.", checks: ["code", "start"], profile: null },
    });
    expect(
      restoreVersion(store, b.id, same, getWorkspace(store, b.id)!.dataRevision),
    ).toMatchObject({
      ok: true,
    });
    expect(workspaceVersions(store, b.id).at(-1)).toMatchObject({
      index: 3,
      summary: "Second context.",
      checks: ["code"],
    });
  });
});
