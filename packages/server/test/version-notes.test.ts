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
  it("APP-05, GEN-12: a request's version keeps its summary and the checks it passed, through activation", async () => {
    const store = await folder();
    const provider = createScriptedProvider({
      name: "notes",
      replies: [
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
    const reply = generateReplySchema.parse(await post(GENERATE_ROUTE, { request: "A list" }));
    if (reply.kind !== "candidate") throw new Error("Expected a candidate");
    const activated = activationReplySchema.parse(
      await post(ACTIVATION_ROUTE, {
        token: reply.activation.token,
        workspaceId: reply.workspaceId,
        hash: reply.hash,
        expectedDataRevision: reply.expectedDataRevision,
      }),
    );
    expect(activated.ok).toBe(true);
    expect(workspaceVersions(store, reply.workspaceId)).toMatchObject([
      { index: 1, summary: editFixture.summary, checks: ["code", "start"] },
    ]);
  });

  it("APP-05: the same code elsewhere keeps its note, and a version written by hand has none", async () => {
    const store = await folder();
    const built = candidateFrom(editFixture);
    if (built.kind !== "candidate") throw new Error("Bad fixture");
    const hash = saveVersion(store.db, built.artifact);
    const first = createWorkspace(store, "First");
    expect(
      activateVersion(store, first.id, hash, first.dataRevision, {
        note: { summary: "Made a shopping list.", checks: ["code", "start"] },
      }).ok,
    ).toBe(true);
    // Use again starts another workspace with the same version: the same code, the same note.
    const again = createWorkspace(store, "Again");
    expect(activateVersion(store, again.id, hash, again.dataRevision).ok).toBe(true);
    expect(workspaceVersions(store, again.id)).toMatchObject([
      { summary: "Made a shopping list.", checks: ["code", "start"] },
    ]);
    // Code nobody generated or checked, as a hand-written tool, has no note.
    const other = saveVersion(store.db, {
      ...built.artifact,
      code: { ...built.artifact.code, html: "<p>By hand</p>" },
    });
    const hand = createWorkspace(store, "By hand");
    expect(addWorkspaceVersion(store, hand.id, other)).toMatchObject({ summary: null, checks: [] });
  });
});
