import { expect, test, type Page } from "@playwright/test";
import type { Artifact, Migration } from "../../contracts/src/index.ts";
import { saveVersion } from "../../server/src/versions/index.ts";
import {
  activateVersion,
  createWorkspace,
  getWorkspace,
  readWorkspaceData,
  workspaceVersions,
} from "../../server/src/workspaces/index.ts";
import { startSandboxHost, type SandboxHost } from "./support/sandbox-host.ts";

// Staging before activation (RUN-03), end to end in Chrome and Edge (TEST-06): a candidate runs in
// a hidden panel against synthetic data, its checks judge it, and only then does the server
// activate it (DATA-10). A failed check never asks the server, and the person's data stays as it
// was. The server's activation route answers from a temporary data folder (ENG-19).

const tools: Record<string, Artifact["code"]> = {
  // The candidate: reports the data it reads, and tries to save as it starts.
  candidate: {
    html: "<p>Errands, improved</p>",
    css: "",
    // Its first real width: in another process, a frame learns its size from its parent a little
    // after its script starts, and reads 0 until then (#106).
    js: `const width = () => tessera.send({ width: innerWidth });
if (innerWidth > 0) width(); else addEventListener("resize", width, { once: true });
tessera.call("data.read").then((read) => tessera.send({ read }));
tessera.call("data.patch", { operations: [{ op: "add", collection: "tasks", record: { title: "x" } }] })
  .then(() => tessera.send({ wrote: true }), (e) => tessera.send({ wrote: false, code: e.code }));`,
  },
};

const taskSchema = (field: string) =>
  ({
    type: "object",
    properties: {
      tasks: {
        type: "array",
        items: {
          type: "object",
          required: ["id", field],
          properties: { id: { type: "string" }, [field]: { type: "string" } },
          additionalProperties: false,
        },
      },
    },
  }) as Artifact["data"]["schema"];
const toV2: Migration = {
  fromVersion: 1,
  toVersion: 2,
  operations: [{ op: "renameField", collection: "tasks", from: "name", to: "title" }],
};
const artifact = (code: Artifact["code"], data: Artifact["data"]): Artifact => ({
  contractVersion: 2,
  code,
  data,
  capabilities: [],
  pins: [],
  ui: { standardVersion: 1, mode: "standard" },
});
// The candidate's reusable defaults: what it runs against in the panel.
const synthetic = { tasks: [{ id: "d-1", title: "A starting task" }] };

let host: SandboxHost;
test.beforeAll(async () => {
  host = await startSandboxHost(tools, { data: true });
});
test.afterAll(() => host.close());

/** A workspace running version 1 with the person's task, and the candidate, version 2, saved. */
function newWorkspace() {
  const folder = host.folder!;
  const { id } = createWorkspace(folder, "Errands");
  const first = saveVersion(
    folder.db,
    artifact(
      { html: "<p>Errands</p>", css: "", js: "" },
      {
        schemaVersion: 1,
        schema: taskSchema("name"),
        defaults: { tasks: [{ id: "t-1", name: "Buy milk" }] },
        migrations: [],
      },
    ),
  );
  expect(activateVersion(folder, id, first, 0).ok).toBe(true);
  const candidate = saveVersion(
    folder.db,
    artifact(tools["candidate"]!, {
      schemaVersion: 2,
      schema: taskSchema("title"),
      defaults: synthetic,
      migrations: [toV2],
    }),
  );
  return { id, first, candidate };
}

/** Everything activation may change. */
const unit = (id: string) => ({
  workspace: getWorkspace(host.folder!, id),
  history: workspaceVersions(host.folder!, id).map((v) => v.hash),
  data: readWorkspaceData(host.folder!, id),
});

type Seen = { width?: number; read?: unknown; wrote?: boolean; code?: string };
type TestWindow = {
  stageCandidate(options: unknown): Promise<unknown>;
  stubCheck(outcome?: unknown): unknown;
};

/**
 * Stages the candidate with `stub` as its last check, after one that records what the candidate
 * reads and whether it could save. Resolves with staging's result and what the candidate showed.
 */
async function stage(
  page: Page,
  workspaceId: string,
  hash: string,
  expectedDataRevision: number,
  stub: { ok: true } | { ok: false; reason: string },
) {
  await page.goto(`${host.url}/`);
  await page.waitForFunction(() => "stageCandidate" in window);
  host.reset();
  return page.evaluate(
    async ({ workspaceId, hash, expectedDataRevision, stub, synthetic }) => {
      const w = window as unknown as TestWindow;
      const seen: Seen = {};
      const sees = {
        name: "records what the candidate reads and saves",
        run: ({ tool }: { tool: { onMessage(listen: (m: Seen) => void): () => void } }) =>
          new Promise((resolve) => {
            tool.onMessage((m) => {
              Object.assign(seen, m);
              if ("width" in seen && "read" in seen && "wrote" in seen) resolve({ ok: true });
            });
          }),
      };
      const result = await w.stageCandidate({
        candidate: { mountId: "candidate", hash, capabilities: [], syntheticData: synthetic },
        workspaceId,
        expectedDataRevision,
        checks: [sees, w.stubCheck(stub)],
      });
      return {
        result,
        seen,
        panelGone: document.querySelector("[data-tessera=staging]") === null,
        frames: document.querySelectorAll("iframe").length,
      };
    },
    { workspaceId, hash, expectedDataRevision, stub, synthetic },
  );
}

const activations = () => host.hostRequests.filter((r) => r.includes("/api/activate"));

test("RUN-03: a candidate that passes its checks is activated, and the person's data migrated", async ({
  page,
}) => {
  const { id, first, candidate } = newWorkspace();
  const staged = await stage(page, id, candidate, 1, { ok: true });
  expect(staged.result).toMatchObject({
    outcome: "activated",
    migrationCount: 1,
    workspace: { id, currentVersion: candidate },
  });
  expect(unit(id)).toMatchObject({
    history: [first, candidate],
    data: { data: { tasks: [{ id: "t-1", title: "Buy milk" }] } },
  });
  expect(activations()).toHaveLength(1);
  // The panel and the candidate's frames are gone.
  expect(staged).toMatchObject({ panelGone: true, frames: 0 });
});

test("RUN-03: in the panel, the candidate sees only synthetic data and can't save", async ({
  page,
}) => {
  const { id, candidate } = newWorkspace();
  const staged = await stage(page, id, candidate, 1, { ok: true });
  expect(staged.seen).toEqual({
    // It runs at the panel's width, the UI standard's narrow one, not a frame's default 300 px.
    width: 320,
    read: { data: synthetic, revisions: { tasks: { "d-1": 1 } } },
    wrote: false,
    code: "not-active",
  });
});

test("RUN-03: a failed check activates nothing; the previous version and the person's data stay", async ({
  page,
}) => {
  const { id, candidate } = newWorkspace();
  const before = unit(id);
  const staged = await stage(page, id, candidate, 1, { ok: false, reason: "It doesn't start." });
  expect(staged.result).toEqual({
    outcome: "check-failed",
    check: "stub",
    reason: "It doesn't start.",
  });
  // The server was never asked.
  expect(activations()).toEqual([]);
  expect(unit(id)).toEqual(before);
  expect(staged).toMatchObject({ panelGone: true, frames: 0 });
});

test("MIG-06: a candidate checked against data that changed since is refused, and nothing changes", async ({
  page,
}) => {
  const { id, candidate } = newWorkspace();
  const before = unit(id);
  // Planned at revision 0; the data is at revision 1.
  const staged = await stage(page, id, candidate, 0, { ok: true });
  expect(staged.result).toMatchObject({ outcome: "refused", reason: "stale" });
  expect(unit(id)).toEqual(before);
});

/**
 * Stages the candidate with one check made for the case: one that throws at once, one that never
 * answers while staging is cancelled, or any check with staging cancelled before it starts.
 */
async function stageBroken(
  page: Page,
  workspaceId: string,
  hash: string,
  kind: "throws" | "cancelled-before" | "cancelled-during",
) {
  await page.goto(`${host.url}/`);
  await page.waitForFunction(() => "stageCandidate" in window);
  host.reset();
  return page.evaluate(
    async ({ workspaceId, hash, kind, synthetic }) => {
      const w = window as unknown as TestWindow;
      const controller = new AbortController();
      let ran = false;
      const check =
        kind === "throws"
          ? {
              name: "throws at once",
              // Not async: it throws before it returns a promise.
              run: () => {
                ran = true;
                throw new Error("The check broke at once.");
              },
            }
          : {
              name: "never answers",
              run: () => {
                ran = true;
                // It ignores its signal; cancelling must still end staging.
                setTimeout(() => controller.abort(), 200);
                return new Promise(() => {});
              },
            };
      if (kind === "cancelled-before") controller.abort();
      const result = await w.stageCandidate({
        candidate: { mountId: "candidate", hash, capabilities: [], syntheticData: synthetic },
        workspaceId,
        expectedDataRevision: 1,
        checks: [check],
        signal: controller.signal,
      });
      return {
        result,
        ran,
        panelGone: document.querySelector("[data-tessera=staging]") === null,
        frames: document.querySelectorAll("iframe").length,
      };
    },
    { workspaceId, hash, kind, synthetic },
  );
}

test("RUN-03: a check that throws at once is a failed check, and activates nothing", async ({
  page,
}) => {
  const { id, candidate } = newWorkspace();
  const before = unit(id);
  const staged = await stageBroken(page, id, candidate, "throws");
  expect(staged).toEqual({
    result: {
      outcome: "check-failed",
      check: "throws at once",
      reason: "The check broke at once.",
    },
    ran: true,
    panelGone: true,
    frames: 0,
  });
  expect(activations()).toEqual([]);
  expect(unit(id)).toEqual(before);
});

test("RUN-03: staging cancelled before it starts mounts nothing and activates nothing", async ({
  page,
}) => {
  const { id, candidate } = newWorkspace();
  const before = unit(id);
  const staged = await stageBroken(page, id, candidate, "cancelled-before");
  expect(staged).toEqual({
    result: { outcome: "check-failed", check: "cancelled", reason: "Staging was cancelled." },
    ran: false,
    panelGone: true,
    frames: 0,
  });
  // Not even the wrapper was asked for.
  expect(host.hostRequests.filter((r) => r.includes("/runtime/"))).toEqual([]);
  expect(activations()).toEqual([]);
  expect(unit(id)).toEqual(before);
});

test("RUN-03: cancelling ends staging even while a check ignores it, and activates nothing", async ({
  page,
}) => {
  const { id, candidate } = newWorkspace();
  const before = unit(id);
  const staged = await stageBroken(page, id, candidate, "cancelled-during");
  expect(staged).toEqual({
    result: { outcome: "check-failed", check: "cancelled", reason: "Staging was cancelled." },
    ran: true,
    panelGone: true,
    frames: 0,
  });
  expect(activations()).toEqual([]);
  expect(unit(id)).toEqual(before);
});
