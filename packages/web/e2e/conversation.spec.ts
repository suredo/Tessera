import { expect, test } from "@playwright/test";
import type { Intent } from "@tessera/contracts";
import { UNKNOWN_USAGE, type Provider } from "../../server/src/providers/index.ts";
import { en } from "../src/i18n/en.ts";
import { startApp, type AppHost, newestReply } from "./support/app-host.ts";

// The conversation before a request (A62, L-101, TEST-03): with no tool open, a list Tessera isn't
// sure about, then "remove what I just listed", which is told the list it means, from the chat the
// app keeps, even right after the reply; and the details view shows what it was told. The model's answers are scripted; nothing reaches a
// model (ENG-11).

test.describe.configure({ mode: "serial" });

const clarify: Intent = {
  kind: "clarify",
  interfacePart: null,
  dataPart: null,
  language: "en",
  features: [],
  targetsCurrentTool: false,
  behaviorChange: false,
  lookOnly: false,
};
const steps = [
  { stage: "intent", value: clarify },
  { stage: "intent", value: clarify },
];
const prompts: string[] = [];
const provider: Provider = {
  name: "scripted:conversation",
  live: false,
  run(spec) {
    const step = steps.shift();
    if (step?.stage !== spec.stage) throw new Error(`Unexpected ${spec.stage}`);
    prompts.push(spec.prompt);
    return Promise.resolve({
      value: spec.schema.parse(step.value),
      raw: JSON.stringify(step.value),
      usage: UNKNOWN_USAGE,
    });
  },
};
let app: AppHost;
test.beforeAll(async () => {
  app = await startApp(undefined, provider);
});
test.afterAll(() => app.close());

const told = (prompt: string) => {
  const quoted = /--- conversation ---\n(.*)\n--- end of the conversation ---/.exec(prompt)?.[1];
  return quoted === undefined ? undefined : (JSON.parse(quoted) as { last: unknown[] });
};

test("L-101, A62: 'remove what I just listed' is told the list it means, right after the reply", async ({
  page,
}) => {
  await page.goto(app.url);
  const box = page.getByRole("textbox", { name: en["request.label"] });
  const send = async (text: string) => {
    await box.fill(text);
    await page.getByRole("button", { name: en["request.send"] }).click();
    await expect(box).toBeEnabled({ timeout: 30_000 });
  };
  await send("milk, eggs, bread, coffee");
  await expect(newestReply(page)).toHaveText(en["request.clarify"]);
  // The first request had nothing before it.
  expect(told(prompts[0]!)).toBeUndefined();
  // Sent at once: the app keeps the turn before the request goes.
  await send("remove what I just listed");
  expect(told(prompts[1]!)?.last).toEqual([
    { from: "person", text: "milk, eggs, bread, coffee" },
    { from: "tessera", text: en["request.clarify"] },
  ]);
  expect(steps).toHaveLength(0);

  // The details view shows what that request was told, read from the chat (A62, ENG-16).
  await page.getByRole("button", { name: en["details.show"] }).click();
  const shownTold = page
    .locator(".details-requests > li")
    .filter({ hasText: en["details.told"].replace("{count}", "2") });
  await expect(shownTold).toHaveCount(1);
  await shownTold.getByText(en["details.told"].replace("{count}", "2")).click();
  await expect(shownTold.getByRole("listitem")).toHaveText([
    `${en["details.toldYou"]}: milk, eggs, bread, coffee`,
    `${en["details.toldTessera"]}: ${en["request.clarify"]}`,
  ]);
});
