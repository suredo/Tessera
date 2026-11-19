import { expect, test, type Page } from "@playwright/test";
import type { Artifact } from "@tessera/contracts";
import { en } from "../src/i18n/en.ts";
import { startApp, testTool, TOOL_START, workspaceWith, type AppHost } from "./support/app-host.ts";
import { ready } from "./support/ready.ts";
import { startSandboxHost, type SandboxHost } from "./support/sandbox-host.ts";

// What a tool may do in its own window when the person acts (A92): ask with confirm, alert or
// prompt, copy to the clipboard, and show a chart's values on hover. The sandbox limits what a tool
// reaches, not this. A tool mounted for a check shows the person nothing: its page answers a
// confirm yes and a prompt its default. Against a real Tessera on a temporary data folder (ENG-19)
// and the sandbox host.

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

let app: AppHost;
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(() => app.close());

const toolWith = (html: string, js: string, capabilities: string[] = []): Artifact => ({
  ...testTool(""),
  code: { html, css: "", js },
  capabilities,
});
const inTool = (page: Page) =>
  page.frameLocator(".tool-frame iframe").frameLocator("iframe").frameLocator("iframe");

async function open(page: Page, title: string, tool: Artifact) {
  const name = `${title} ${Math.random().toString(36).slice(2, 7)}`;
  workspaceWith(app.folder, name, tool);
  await page.goto(app.url);
  await page
    .getByRole("region", { name: en["workspaces.heading"] })
    .getByRole("button", { name: new RegExp(`^(Open ${name}|${name}, open)$`) })
    .click();
  await expect(inTool(page).locator("#text")).toBeVisible(TOOL_START);
}

test("A92: a tool's confirm and prompt reach the person, and their answers reach the tool", async ({
  page,
}) => {
  const js = `document.getElementById("ask").addEventListener("click", () => {
  const sure = confirm("Delete the list?");
  const name = prompt("Your name?", "Ana");
  document.getElementById("text").textContent = (sure ? "deleted" : "kept") + " by " + name;
});`;
  await open(page, "Asks", toolWith(`<p id="text">Ready</p><button id="ask">Ask</button>`, js));
  const asked: string[] = [];
  page.on("dialog", (dialog) => {
    asked.push(dialog.message());
    void (dialog.type() === "prompt" ? dialog.accept("Leo") : dialog.accept());
  });
  await inTool(page).getByRole("button", { name: "Ask" }).click();
  await expect(inTool(page).locator("#text")).toHaveText("deleted by Leo");
  expect(asked).toEqual(["Delete the list?", "Your name?"]);
});

test("A92: a tool copies to the clipboard when the person asks", async ({ page }) => {
  const js = `document.getElementById("copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText("Milk, eggs, bread");
  document.getElementById("text").textContent = "Copied";
});`;
  await open(page, "Copies", toolWith(`<p id="text">Ready</p><button id="copy">Copy</button>`, js));
  await inTool(page).getByRole("button", { name: "Copy" }).click();
  await expect(inTool(page).locator("#text")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Milk, eggs, bread");
});

test("A92, CAP-04: hovering a chart's bar shows its value", async ({ page }) => {
  const js = `tessera.chart(document.getElementById("chart"), {
  type: "bar", title: "Sales", labels: ["Monday"], series: [{ name: "Sales", values: [10] }],
});`;
  await open(
    page,
    "Chart",
    toolWith(`<p id="text">Sales</p><div id="chart" data-hook="chart"></div>`, js, ["chart"]),
  );
  const canvas = inTool(page).locator("#chart canvas");
  await expect(canvas).toBeVisible(TOOL_START);
  const before = await canvas.screenshot();
  const box = (await canvas.boundingBox())!;
  // The one bar stands in the middle; its value's box is drawn over the chart while it is hovered.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.6);
  await expect.poll(async () => (await canvas.screenshot()).equals(before)).toBe(false);
});

test.describe("a tool mounted for a check (A92)", () => {
  let host: SandboxHost;
  test.beforeAll(async () => {
    host = await startSandboxHost({
      asks: {
        html: "<p>Asks</p>",
        css: "",
        js: `tessera.onMessage(() => {
  const sure = confirm("Delete the list?");
  alert("Done");
  tessera.send({ sure, name: prompt("Your name?", "Ana"), printed: (print(), true) });
});`,
      },
    });
  });
  test.afterAll(() => host.close());

  test("A92, VER-03: shows the person no dialog, and its page answers as the person would", async ({
    page,
  }) => {
    await page.goto(`${host.url}/`);
    await ready(page, "mountTool");
    const shown: string[] = [];
    page.on("dialog", (dialog) => {
      shown.push(dialog.message());
      void dialog.dismiss();
    });
    const answer = await page.evaluate(async () => {
      type Handle = { send(m: unknown): void; onMessage(listen: (m: unknown) => void): void };
      const w = window as unknown as {
        mountTool(...args: unknown[]): Promise<Handle>;
      };
      const tool = await w.mountTool(document.body, "asks", location, undefined, {}, true);
      return new Promise((resolve) => {
        tool.onMessage(resolve);
        // The page takes its port, and with it the check's answers, before it is asked.
        const ask = () => tool.send({ ask: true });
        setTimeout(ask, 500);
      });
    });
    expect(answer).toEqual({ sure: true, name: "Ana", printed: true });
    expect(shown).toEqual([]);
  });
});
