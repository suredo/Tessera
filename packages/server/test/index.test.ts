import { describe, expect, it } from "vitest";
import { packageName as contracts } from "@tessera/contracts";
import { packageName } from "../src/index.ts";

describe("@tessera/server", () => {
  it("runs under the workspace test runner (TEST-01)", () => {
    expect(packageName).toBe("@tessera/server");
  });

  it("imports @tessera/contracts through the workspace (A14)", () => {
    expect(contracts).toBe("@tessera/contracts");
  });
});
