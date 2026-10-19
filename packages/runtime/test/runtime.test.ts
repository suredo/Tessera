import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  HELLO_MESSAGE,
  MAX_RESTARTS,
  MOUNT_MESSAGE,
  PORT_MESSAGE,
  runtimeOriginFor,
  TOOL_CSP,
  TOOL_EVENTS,
  TOOL_SANDBOX,
  wrapperCsp,
} from "../src/index.ts";

const source = (file: string) =>
  fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", file),
    "utf8",
  );
const directives = (policy: string): Record<string, string[]> =>
  Object.fromEntries(
    policy.split("; ").map((directive): [string, string[]] => {
      const [name = "", ...values] = directive.split(" ");
      return [name, values];
    }),
  );

describe("the runtime's documents (RUN-01)", () => {
  it("lets the tool run its own code and load nothing else, only images and media from blob: URLs", () => {
    const tool = directives(TOOL_CSP);
    expect(tool["default-src"]).toEqual(["'none'"]);
    expect(tool["script-src"]).toEqual(["'unsafe-inline'"]);
    expect(tool["img-src"]).toEqual(["blob:"]);
    expect(tool["media-src"]).toEqual(["blob:"]);
    for (const blocked of [
      "connect-src",
      "font-src",
      "frame-src",
      "child-src",
      "worker-src",
      "object-src",
      "form-action",
      "base-uri",
    ]) {
      expect(tool[blocked], blocked).toEqual(["'none'"]);
    }
    // Sandboxed with scripts only: never the same origin, so the tool's origin is null.
    expect(TOOL_SANDBOX).toBe("sandbox allow-scripts");
  });

  it("lets the wrapper run only its own script and frame only the tool's document", () => {
    const wrapper = directives(wrapperCsp("http://localhost:4317", "abc"));
    expect(wrapper["default-src"]).toEqual(["'none'"]);
    expect(wrapper["script-src"]).toEqual(["'nonce-abc'"]);
    expect(wrapper["frame-src"]).toEqual(["http://localhost:4317/runtime/tool"]);
  });

  it("puts the runtime on the opposite loopback name, on the same port", () => {
    expect(runtimeOriginFor({ protocol: "http:", port: "4317" })).toBe("http://localhost:4317");
  });

  it("uses the same protocol names in the wrapper and the tool as in the host", () => {
    // The wrapper's and the tool's scripts are inlined into their documents, so they repeat them.
    expect(source("wrapper.ts")).toContain(`const MOUNT_MESSAGE = "${MOUNT_MESSAGE}"`);
    expect(source("wrapper.ts")).toContain(`const PORT_MESSAGE = "${PORT_MESSAGE}"`);
    expect(source("tool-preamble.ts")).toContain(`const PORT_MESSAGE = "${PORT_MESSAGE}"`);
    for (const file of ["wrapper.ts", "tool-preamble.ts"]) {
      expect(source(file)).toContain(`const HELLO_MESSAGE = "${HELLO_MESSAGE}"`);
    }
    expect(source("wrapper.ts")).toContain(`const MAX_RESTARTS = ${MAX_RESTARTS};`);
    for (const event of TOOL_EVENTS) expect(source("wrapper.ts")).toContain(`event: "${event}"`);
    // And the wrapper only trusts the host app on the other loopback name.
    expect(source("wrapper.ts")).toContain("//127.0.0.1:${location.port}");
  });
});
