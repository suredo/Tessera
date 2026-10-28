import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_ROUTES, creationSchema } from "@tessera/contracts";
import { candidateFrom, ProviderError, type Provider } from "@tessera/server";
import { startHarness, readLedger } from "../src/index.ts";
import { cancellableProvider } from "../spikes/smoke-repair/run.ts";

describe("smoke evaluation cleanup (ENG-07)", () => {
  it("GEN-09: the recorded live smoke repair still passes the server checks with unchanged defaults", () => {
    const replay = JSON.parse(
      fs.readFileSync(
        fileURLToPath(
          new URL("../spikes/smoke-repair/replays/smoke-repair-2026-10-28.json", import.meta.url),
        ),
        "utf8",
      ),
    ) as { replays: { answer: unknown }[] };
    const creation = creationSchema.parse(replay.replays[0]!.answer);
    expect(creation.outcome).toBe("tool");
    if (creation.outcome !== "tool") throw new Error("Expected a repaired tool");
    expect(candidateFrom(creation)).toMatchObject({ kind: "candidate", name: "Shopping list" });
    expect(creation.data.reusableDefaults).toEqual({ items: [] });
    expect(creation.data.initialState).toEqual({});
  });

  it("ENG-07: aborts and settles a delayed call before its final cost is recorded", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-smoke-cleanup-"));
    let began!: () => void;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    const delayed: Provider = {
      name: "delayed-fake",
      live: false,
      run: (spec) =>
        new Promise<never>((_, reject) => {
          spec.signal?.addEventListener(
            "abort",
            () => reject(new ProviderError("cancelled", "Stopped by evaluation.")),
            { once: true },
          );
          began();
        }),
    };
    const harness = startHarness({
      provider: delayed,
      mode: "dry-run",
      callCap: 3,
      dataFolder: folder,
    });
    const calls = cancellableProvider(harness.provider);
    try {
      const result = calls.provider
        .run({
          stage: "repair",
          ...DEFAULT_ROUTES.repair,
          tools: "none",
          system: "",
          prompt: "",
          schema: z.string(),
          timeLimitMs: 180_000,
        })
        .catch((error: unknown) => error);
      await started;
      expect(readLedger(folder)).toHaveLength(0);
      await calls.stop();
      expect(await result).toBeInstanceOf(ProviderError);
      expect(harness.finish()).toMatchObject({ callCount: 1, failedCount: 1 });
      expect(readLedger(folder)).toMatchObject([
        { outcome: { kind: "failed", error: "cancelled" } },
      ]);
    } finally {
      await calls.stop();
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});
