import { describe, expect, it } from "vitest";
import { packageName } from "../src/index.ts";

describe("@tessera/contracts", () => {
  it("runs under the workspace test runner (TEST-01)", () => {
    expect(packageName).toBe("@tessera/contracts");
  });
});
