import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_ROUTES } from "@tessera/contracts";
import { ProviderError, type Provider } from "@tessera/server";
import { startHarness, readLedger } from "../src/index.ts";
import { cancellableProvider } from "../spikes/smoke-repair/run.ts";

describe("smoke evaluation cleanup (ENG-07)", () => {
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
