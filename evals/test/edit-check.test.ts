import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { editSchema, type Artifact } from "@tessera/contracts";
import { candidateFrom, editedCandidate, migrateData } from "@tessera/server";
import { editFixture } from "../../packages/server/test/fixtures/edit-tool.ts";

describe("recorded live edits", () => {
  it("GEN-07 DATA-03: replays both edits sequentially, preserving entries and applying quantities", () => {
    const replay = JSON.parse(
      fs.readFileSync(
        new URL("../spikes/edit-check/replays/edit-check-2026-10-29.json", import.meta.url),
        "utf8",
      ),
    ) as { replays: { request: string; lookOnly: boolean; answer: unknown }[] };
    expect(replay.replays).toHaveLength(2);
    const original = candidateFrom(editFixture);
    if (original.kind !== "candidate") throw new Error("Invalid fixture");
    let artifact: Artifact = original.artifact;
    let data = original.startingData;
    for (const [index, step] of replay.replays.entries()) {
      const answer = editSchema.parse(step.answer);
      if (answer.outcome !== "edit") throw new Error("Expected edit");
      const result = editedCandidate(
        {
          request: step.request,
          artifact,
          data,
          intent: {
            kind: "edit",
            language: "en",
            interfacePart: null,
            dataPart: null,
            features: [],
            targetsCurrentTool: true,
            lookOnly: step.lookOnly,
            behaviorChange: !step.lookOnly,
          },
        },
        answer,
      );
      expect(result.kind).toBe("candidate");
      if (result.kind !== "candidate") throw new Error("Recorded edit refused");
      const migrated = migrateData(data, artifact.data, result.artifact.data, {
        trackLosses: true,
      });
      if (!migrated.ok) throw new Error("Recorded migration refused");
      expect(migrated.losses).toEqual([]);
      if (index === 0) {
        expect(result.artifact.code.html).toBe(artifact.code.html);
        expect(result.artifact.code.js).toBe(artifact.code.js);
        expect(result.artifact.data).toEqual(artifact.data);
        expect(migrated.data).toEqual(original.startingData);
      }
      expect(result.artifact.code.css).toBe("body{background:#111111;color:#eeeeee}");
      artifact = result.artifact;
      data = migrated.data;
    }
    expect(data).toEqual({
      items: [
        { id: "i-1", title: "Milk", quantity: 1 },
        { id: "i-2", title: "Eggs", quantity: 1 },
      ],
    });
    expect(artifact.data.schemaVersion).toBe(2);
    expect(original.startingData).toEqual({
      items: [
        { id: "i-1", title: "Milk" },
        { id: "i-2", title: "Eggs" },
      ],
    });
  });
});
