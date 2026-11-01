import { expect, test } from "@playwright/test";
import { HOST_ROUTE } from "@tessera/contracts";
import {
  createScriptedProvider,
  ProviderError,
  type Provider,
} from "../../server/src/providers/index.ts";
import { listWorkspaces } from "../../server/src/workspaces/index.ts";
import { editFixture } from "../../server/test/fixtures/edit-tool.ts";
import { en } from "../src/i18n/en.ts";
import { startApp } from "./support/app-host.ts";

const intent = {
  kind: "create",
  interfacePart: null,
  dataPart: null,
  behaviorChange: false,
  lookOnly: false,
  targetsCurrentTool: false,
  language: "en",
  features: [],
};
for (const phase of ["create", "repair"] as const) {
  test(`CLI-06 GEN-08 APP-11: keyboard cancel during ${phase} survives navigation and prevents activation`, async ({
    page,
  }) => {
    const calls: string[] = [];
    const scripted = createScriptedProvider({
      name: "cancel",
      replies: [
        { kind: "value", stage: "intent", value: intent },
        {
          kind: "value",
          stage: "create",
          value: { ...editFixture, code: { ...editFixture.code, html: "<h1>List</h1><input>" } },
        },
      ],
    });
    const provider: Provider = {
      name: "cancel",
      live: false,
      run: async (spec) => {
        calls.push(spec.stage);
        if (spec.stage === phase)
          await new Promise<never>((_, reject) =>
            spec.signal!.addEventListener(
              "abort",
              () => reject(new ProviderError("cancelled", "Stopped")),
              { once: true },
            ),
          );
        return scripted.run(spec);
      },
    };
    const host = await startApp(undefined, provider);
    try {
      await page.goto(host.url);
      await page.getByRole("textbox", { name: en["request.label"] }).fill("A shopping list");
      await page.getByRole("button", { name: en["request.send"] }).click();
      // Reaching repair needs a first staging and smoke check, slower under parallel browsers.
      await expect.poll(() => calls.includes(phase), { timeout: 30_000 }).toBe(true);
      await page.getByRole("button", { name: en["setup.openStatus"] }).click();
      const cancel = page.getByRole("button", { name: en["request.cancel"] });
      await expect(cancel).toBeVisible();
      await cancel.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByText(/The request was stopped\./)).toBeVisible();
      await expect(cancel).toHaveCount(0);
      expect(listWorkspaces(host.folder).every((w) => w.currentVersion === null)).toBe(true);
      expect(calls.filter((stage) => stage === "repair")).toHaveLength(phase === "repair" ? 1 : 0);
    } finally {
      await host.close();
    }
  });
}
test("CLI-06 RUN-03: Cancel removes a stalled staging frame without activation or repair", async ({
  page,
}) => {
  const provider = createScriptedProvider({
    name: "cancel-stage",
    replies: [
      { kind: "value", stage: "intent", value: intent },
      { kind: "value", stage: "create", value: editFixture },
    ],
  });
  const host = await startApp(undefined, provider);
  const paths: string[] = [];
  try {
    page.on("request", (request) => paths.push(new URL(request.url()).pathname));
    await page.route("**/runtime/wrapper", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Waiting</title>",
      }),
    );
    await page.goto(host.url);
    await page.getByRole("textbox", { name: en["request.label"] }).fill("A list");
    await page.getByRole("button", { name: en["request.send"] }).click();
    await expect(page.locator("[data-tessera=staging]")).toHaveCount(1);
    await page.getByRole("button", { name: en["request.cancel"] }).click();
    await expect(page.getByText(en["request.stopped"], { exact: true })).toBeVisible();
    await expect(page.locator("[data-tessera=staging]")).toHaveCount(0);
    expect(paths).not.toContain("/api/activate");
    expect(paths).not.toContain("/api/generate/repair-smoke");
    expect(listWorkspaces(host.folder).every((w) => w.currentVersion === null)).toBe(true);
  } finally {
    await host.close();
  }
});
// Quarantined (ENG-20): under load its page stops responding for most of a minute, with no network
// traffic in between, and the test runs past its limit. Find why and remove this (#206).
test.fixme("CLI-06: a queued browser request can be cancelled without another provider call", async ({
  page,
  context,
}) => {
  let calls = 0;
  const provider: Provider = {
    name: "queue-cancel",
    live: false,
    run: (spec) => {
      calls++;
      return new Promise((_, reject) =>
        spec.signal!.addEventListener(
          "abort",
          () => reject(new ProviderError("cancelled", "Stopped")),
          { once: true },
        ),
      );
    },
  };
  const host = await startApp(undefined, provider);
  const other = await context.newPage();
  try {
    await page.goto(host.url);
    await page.getByRole("textbox", { name: en["request.label"] }).fill("First list");
    await page.getByRole("button", { name: en["request.send"] }).click();
    await expect.poll(() => calls).toBe(1);
    let generated = false;
    other.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/generate") generated = true;
    });
    await other.goto(host.url);
    await other.getByRole("textbox", { name: en["request.label"] }).fill("Second list");
    await other.getByRole("button", { name: en["request.send"] }).click();
    await expect.poll(() => generated).toBe(true);
    await other.getByRole("button", { name: en["request.cancel"] }).click();
    await expect(other.getByText(/The request was stopped\./)).toBeVisible();
    expect(calls).toBe(1);
    await page.getByRole("button", { name: en["request.cancel"] }).click();
    await expect(page.getByText(/The request was stopped\./)).toBeVisible();
    expect(calls).toBe(1);
  } finally {
    await other.close();
    await host.close();
  }
});
test("CLI-06 GEN-08: the stop is said at once, while the lists still refresh", async ({ page }) => {
  let calls = 0;
  const provider: Provider = {
    name: "slow-refresh",
    live: false,
    run: (spec) => {
      calls++;
      return new Promise((_, reject) =>
        spec.signal!.addEventListener(
          "abort",
          () => reject(new ProviderError("cancelled", "Stopped")),
          { once: true },
        ),
      );
    },
  };
  const host = await startApp(undefined, provider);
  try {
    await page.goto(host.url);
    const box = page.getByRole("textbox", { name: en["request.label"] });
    await box.fill("A list");
    await page.getByRole("button", { name: en["request.send"] }).click();
    await expect.poll(() => calls, { timeout: 30_000 }).toBe(1);
    // Hold the refresh that follows the stop, well past the notice's expectation.
    let release = () => {};
    const held = new Promise<void>((done) => {
      release = done;
    });
    await page.route(`**${HOST_ROUTE}`, async (route) => {
      await held;
      await route.continue();
    });
    await page.getByRole("button", { name: en["request.cancel"] }).click();
    await expect(page.getByText(/The request was stopped\./)).toBeVisible();
    await expect(page.getByRole("button", { name: en["request.cancel"] })).toHaveCount(0);
    await expect(page.getByText(en["request.stopping"])).toHaveCount(0);
    // A new request still waits for the refresh to finish.
    await expect(box).toBeDisabled();
    release();
    await expect(box).toBeEnabled({ timeout: 30_000 });
    expect(calls).toBe(1);
  } finally {
    await host.close();
  }
});
