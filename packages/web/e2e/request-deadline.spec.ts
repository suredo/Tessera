import { expect, test } from "@playwright/test";
import { createScriptedProvider } from "../../server/src/providers/index.ts";
import { listWorkspaces } from "../../server/src/workspaces/index.ts";
import { editFixture } from "../../server/test/fixtures/edit-tool.ts";
import { en } from "../src/i18n/en.ts";
import { startApp } from "./support/app-host.ts";

test("GEN-11 GEN-08: staging stops at the original request deadline and never activates or repairs", async ({
  page,
}) => {
  const provider = createScriptedProvider({
    name: "deadline",
    replies: [
      {
        kind: "value",
        stage: "intent",
        value: {
          kind: "create",
          interfacePart: null,
          dataPart: null,
          behaviorChange: false,
          lookOnly: false,
          targetsCurrentTool: false,
          language: "en",
          features: [],
        },
      },
      { kind: "value", stage: "create", value: editFixture },
    ],
  });
  const host = await startApp(undefined, provider);
  try {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(new URL(request.url()).pathname));
    // The real candidate cannot finish mounting. The host must cancel its staging wait.
    await page.route("**/runtime/wrapper", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Waiting</title>",
      }),
    );
    await page.clock.install();
    await page.goto(host.url);
    await page.getByRole("textbox", { name: en["request.label"] }).fill("A shopping list");
    await page.getByRole("button", { name: en["request.send"] }).click();
    await expect(page.locator("[data-tessera=staging]")).toHaveCount(1);
    await page.clock.fastForward(420_001);
    await expect(page.getByText(en["request.timedOut"], { exact: true })).toBeVisible();
    await expect(page.locator("[data-tessera=staging]")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: en["request.label"] })).toBeEnabled();
    expect(requests).not.toContain("/api/activate");
    expect(requests).not.toContain("/api/generate/repair-smoke");
    expect(
      listWorkspaces(host.folder).every((workspace) => workspace.currentVersion === null),
    ).toBe(true);
  } finally {
    await host.close();
  }
});
