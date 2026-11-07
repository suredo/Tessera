import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { LedgerCall } from "@tessera/contracts";
import { Call } from "../src/Details.tsx";
import { en } from "../src/i18n/en.ts";

// The details view shows the code a call answered with, also when the checks refused it (GEN-10,
// APP-09), so a refusal can be read rather than guessed.

const call: LedgerCall = {
  index: 1,
  stage: "repair",
  provider: "scripted",
  model: "claude-sonnet-5-5",
  effort: "medium",
  promptChars: 10,
  systemChars: 10,
  promptParts: [],
  diagnostics: ['JavaScript, line 3: The bridge action "data.patch" writes data during startup.'],
  startedAt: "2026-11-07T12:00:00.000Z",
  durationMs: 1000,
  inputTokens: null,
  cachedInputTokens: null,
  outputTokens: null,
  outcome: "ok",
  error: null,
  message: null,
  detail: null,
  code: { html: '<p id="day"></p>', js: "const first = new Date(parts[0], 0, 1);" },
};

const row = (value: LedgerCall) =>
  renderToStaticMarkup(
    <table>
      <tbody>
        <Call call={value} />
      </tbody>
    </table>,
  );

it("GEN-10 APP-09: a call's code is behind its own control, each part named, and a call without code shows none", () => {
  const html = row(call);
  expect(html).toContain(`<summary>${en["details.callCode"]}</summary>`);
  expect(html).toContain(en["details.source.html"]);
  expect(html).toContain(en["details.source.js"]);
  expect(html).not.toContain(en["details.source.css"]);
  expect(html).toContain("const first = new Date(parts[0], 0, 1);");
  expect(row({ ...call, code: null })).not.toContain(en["details.callCode"]);
});
