import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { editSchema, intentSchema, creationSchema, DEFAULT_ROUTES } from "@tessera/contracts";
import {
  candidateFrom,
  editedCandidate,
  migrateData,
  ProviderError,
  type Provider,
  type StageSpec,
} from "@tessera/server";
import { editFixture } from "../../packages/server/test/fixtures/edit-tool.ts";
import { PLAN, REPLY, editOnlyProvider } from "../spikes/bridge-edit-check/run.ts";
import { startHarness } from "../src/index.ts";

const folders: string[] = [];
afterEach(() =>
  folders.splice(0).forEach((folder) => fs.rmSync(folder, { recursive: true, force: true })),
);
const spec = (stage: "edit" | "repair" = "edit"): StageSpec<unknown> => ({
  stage,
  schema: editSchema,
  system: "system",
  prompt: "request",
  promptParts: ["bridge@1"],
  ...DEFAULT_ROUTES[stage],
  tools: "none",
  timeLimitMs: PLAN.requestLimitMs,
});
function setup(failure?: ProviderError) {
  let calls = 0;
  const underlying: Provider = {
    name: "offline",
    live: false,
    run(call) {
      calls++;
      if (failure && calls === 1) return Promise.reject(failure);
      return Promise.resolve({
        value: call.schema.parse(REPLY),
        raw: JSON.stringify(REPLY),
        usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, durationMs: 0 },
      });
    },
  };
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-bridge-eval-"));
  folders.push(folder);
  const harness = startHarness({
    provider: underlying,
    mode: "dry-run",
    callCap: PLAN.callCap,
    dataFolder: folder,
  });
  const provider = editOnlyProvider(harness.provider);
  const intent = () => provider.run({ ...spec(), stage: "intent", schema: intentSchema });
  return { provider, intent, calls: () => calls, harness };
}

describe("frozen bridge edit evaluation", () => {
  it("ENG-07: freezes one behavioral intent and refuses unplanned stage/contracts before delegation", async () => {
    expect(PLAN.cases).toHaveLength(1);
    expect([PLAN.callCap, PLAN.expectedCalls, PLAN.repairReserve, PLAN.reviewerCalls]).toEqual([
      2, 1, 1, 0,
    ]);
    const run = setup();
    expect((await run.intent()).value).toMatchObject({
      kind: "edit",
      targetsCurrentTool: true,
      behaviorChange: true,
      lookOnly: false,
    });
    const duplicate = setup();
    await duplicate.intent();
    await expect(duplicate.intent()).rejects.toThrow("frozen intent");
    await expect(
      run.provider.run({ ...spec(), stage: "create", schema: creationSchema }),
    ).rejects.toThrow("edit contract");
    await expect(run.provider.run({ ...spec(), stage: "data" })).rejects.toThrow("Unplanned stage");
    await expect(run.provider.run(spec("repair"))).rejects.toThrow("Repair requires");
    expect(run.calls()).toBe(0);
  });
  it("ENG-16: requires actual edit StageSpec bridge provenance before any provider call", async () => {
    const run = setup();
    await run.intent();
    await expect(run.provider.run({ ...spec(), promptParts: ["edit@1"] })).rejects.toThrow(
      "bridge@",
    );
    expect(run.calls()).toBe(0);
  });
  it("ENG-07: shares one repair reserve across repair causes and refuses any third provider call", async () => {
    const run = setup(new ProviderError("schema", "Malformed first answer"));
    await run.intent();
    await expect(run.provider.run(spec())).rejects.toThrow("Malformed");
    await run.provider.run(spec("repair"));
    await expect(run.provider.run(spec("repair"))).rejects.toThrow("reserve");
    await expect(run.provider.run(spec())).rejects.toThrow("one edit");
    expect(run.calls()).toBe(2);
    expect(run.harness.callsUsed()).toBe(2);
  });
  it("ENG-07: provider failure stops all later delegation without using a reserve", async () => {
    const run = setup(new ProviderError("unavailable_model", "Unavailable"));
    await run.intent();
    await expect(run.provider.run(spec())).rejects.toThrow("Unavailable");
    await expect(run.provider.run(spec("repair"))).rejects.toThrow("stopped");
    expect(run.calls()).toBe(1);
  });
  it("ENG-16 GEN-07 DATA-03: replays the live bridge edit through host validation and lossless migration", () => {
    const replay = JSON.parse(
      fs.readFileSync(
        new URL(
          "../spikes/bridge-edit-check/replays/bridge-edit-check-2026-10-30.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as {
      sourceRun: string;
      head: string;
      replays: { name: string; request: string; callIndex: number; answer: unknown }[];
    };
    expect(replay.sourceRun).toBe("bridge-edit-check-live-2026-10-30T02-59-59-384Z");
    expect(replay.head).toBe("d900a427ddf4bbd7fb234b2ab69b0645dc765b09");
    expect(replay.replays).toHaveLength(1);
    const step = replay.replays[0];
    if (!step) throw new Error("Missing recorded case");
    expect([step.name, step.callIndex, step.request]).toEqual([
      "quantities",
      0,
      PLAN.cases[0].request,
    ]);
    const original = candidateFrom(editFixture);
    if (original.kind !== "candidate") throw new Error("Invalid fixture");
    const snapshot = structuredClone(original);
    const answer = editSchema.parse(step.answer);
    if (answer.outcome !== "edit") throw new Error("Expected recorded edit");
    const changed = editedCandidate(
      {
        request: step.request,
        artifact: original.artifact,
        data: original.startingData,
        intent: {
          kind: "edit",
          language: "en",
          features: [],
          targetsCurrentTool: true,
          behaviorChange: true,
          lookOnly: false,
          interfacePart: null,
          dataPart: null,
        },
      },
      answer,
    );
    expect(changed.kind).toBe("candidate");
    if (changed.kind !== "candidate") throw new Error("Recorded edit refused by host checks");
    // editedCandidate runs the actual static guard with the artifact's capabilities.
    expect(changed.artifact.code.js).toContain('tessera.call("data.read")');
    expect(changed.artifact.code.js).toContain("\u2014 Quantity: ");
    expect(changed.artifact.code.html).toBe(original.artifact.code.html);
    expect(changed.artifact.code.css).toBe(original.artifact.code.css);
    expect(changed.artifact.capabilities).toEqual(original.artifact.capabilities);
    expect(changed.artifact.data.schemaVersion).toBe(2);
    expect(changed.artifact.data.migrations).toEqual([
      ...original.artifact.data.migrations,
      {
        fromVersion: 1,
        toVersion: 2,
        operations: [{ op: "addField", collection: "items", fields: { quantity: 1 } }],
      },
    ]);
    expect(
      migrateData(original.startingData, original.artifact.data, changed.artifact.data, {
        trackLosses: true,
      }),
    ).toMatchObject({
      ok: true,
      losses: [],
      data: {
        items: [
          { id: "i-1", title: "Milk", quantity: 1 },
          { id: "i-2", title: "Eggs", quantity: 1 },
        ],
      },
    });
    expect(
      migrateData(original.artifact.data.defaults, original.artifact.data, changed.artifact.data, {
        trackLosses: true,
      }),
    ).toMatchObject({
      ok: true,
      losses: [],
      data: changed.artifact.data.defaults,
    });
    expect(original).toEqual(snapshot);
  });
  it("GEN-07 DATA-03: white free answer adds only quantity while retaining IDs, titles and list layout", () => {
    const original = candidateFrom(editFixture);
    if (original.kind !== "candidate") throw new Error("Invalid original fixture");
    const answer = editSchema.parse(REPLY);
    if (answer.outcome !== "edit") throw new Error("Expected edit");
    const changed = editedCandidate(
      {
        request: PLAN.cases[0].request,
        artifact: original.artifact,
        data: original.startingData,
        intent: {
          kind: "edit",
          language: "en",
          features: [],
          targetsCurrentTool: true,
          behaviorChange: true,
          lookOnly: false,
          interfacePart: null,
          dataPart: null,
        },
      },
      answer,
    );
    if (changed.kind !== "candidate") throw new Error("Invalid edit");
    const migrated = migrateData(
      original.startingData,
      original.artifact.data,
      changed.artifact.data,
      { trackLosses: true },
    );
    expect(migrated).toMatchObject({
      ok: true,
      losses: [],
      data: {
        items: [
          { id: "i-1", title: "Milk", quantity: 1 },
          { id: "i-2", title: "Eggs", quantity: 1 },
        ],
      },
    });
    expect(changed.artifact.code.html).toBe(original.artifact.code.html);
    expect(changed.artifact.code.css).toBe(original.artifact.code.css);
    expect(original.startingData).toEqual(editFixture.data.initialState);
  });
});
