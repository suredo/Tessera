import { expect, type Page } from "@playwright/test";
import type { Artifact } from "../../../contracts/src/index.ts";
import { collect, mount, send, type SandboxHost } from "./sandbox-host.ts";

// The prober: a hand-written hostile tool for the sandbox's boundary checks (SEC-05). Each spec
// gives it the checks it can run, as plain JavaScript that runs inside the sandboxed tool; the
// prober says it's ready, then answers each message by running one check and reporting what it
// found.

const HELPERS = `
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const within = (promise, ms = 2000) => Promise.race([promise, wait(ms).then(() => "no answer")]);
const attempt = async (work) => { try { return await work(); } catch { return "refused"; } };
const loads = (element, ok = "load") => new Promise((done) => {
  element.addEventListener(ok, () => done("loaded"));
  element.addEventListener("error", () => done("refused"));
});
const add = (element) => { document.body.append(element); return element; };
// Every refusal the tool's policies report, so a check can tell a refusal by policy from a request
// that left and failed for another reason, such as the destination's CORS rules.
const violations = [];
addEventListener("securitypolicyviolation", (event) => violations.push(event));
const byPolicy = async (url, directive, run) => {
  const before = violations.length;
  const result = await run();
  await wait(100);
  const origin = new URL(url).origin;
  const reported = violations.slice(before).some((event) =>
    event.effectiveDirective === directive && event.blockedURI.startsWith(origin));
  return result === "refused" && reported ? "refused by policy" : result + (reported ? "" : ", no policy report");
};

`;

/** A prober tool that can run the given checks: the body of an object of async functions. */
export const proberTool = (checks: string): Artifact["code"] => ({
  html: "<p>Prober</p>",
  css: "",
  js: `${HELPERS}
const checks = {
${checks}};

tessera.send({ ready: true });
tessera.onMessage(async (message) => {
  tessera.send({ found: await checks[message.check](message) });
});
`,
});

/** What counts as an attempt failing, in the prober's own words. */
export const FAILED = ["refused", "no answer", "unavailable", "empty"];

/**
 * Mounts the prober, then runs one check with nothing else in flight, and returns its findings.
 * The host's records start once the tool is ready, so whatever arrives after came from the check.
 */
export async function probe(
  page: Page,
  host: SandboxHost,
  check: string,
  payload: object = {},
): Promise<Record<string, string>> {
  await mount(page, host, "prober");
  await collect(page, 1, 0);
  host.reset();
  await send(page, { check, probe: host.probeUrl, ...payload });
  const { messages, events } = await collect(page, 2, 1000);
  const found = (messages[1] as { found?: Record<string, string> } | undefined)?.found;
  expect(found, "the prober answered").toBeDefined();
  expect(events, "the tool stayed on its page").toEqual([]);
  return found ?? {};
}

/** Nothing the tool did reached either server: no request, and no connection either. */
export function nothingArrived(host: SandboxHost): void {
  expect(host.probeRequests).toEqual([]);
  expect(host.probeConnections()).toBe(0);
  expect(host.hostRequests).toEqual([]);
  expect(host.hostConnections()).toBe(0);
}
