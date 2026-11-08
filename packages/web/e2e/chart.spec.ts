import { expect, test, type Frame, type Page } from "@playwright/test";
import type { Artifact } from "../../contracts/src/index.ts";
import type { DriveReport } from "../../runtime/src/index.ts";
import { startSandboxHost, toolFrame, type SandboxHost } from "./support/sandbox-host.ts";
import { ready } from "./support/ready.ts";

// The chart helper (CAP-04, ADR 0014), in Chrome and Edge (TEST-06): a tool that declares chart
// draws through tessera.chart, with the pinned Chart.js the host puts in its page and takes back
// from it; the chart is styled by the tool's mode, has a table of its numbers for screen readers,
// and is recorded, so a behavior check can read what was drawn. A tool that doesn't declare chart
// gets neither the library nor a working helper.

const SPENDING = {
  type: "bar",
  title: "Spending this month",
  labels: ["Rent", "Food", "Transport", "Fun"],
  series: [{ name: "Spent", values: [1200, 450, 120, 200] }],
};

/** A tool that draws `spec` in #chart and says in #out whether it could, and if not, why. */
const drawing = (spec: unknown, css = ""): Artifact["code"] => ({
  html: '<div id="chart" data-hook="chart"></div><p id="out"></p>',
  css,
  js: `const out = document.querySelector("#out");
try {
  tessera.chart(document.querySelector("#chart"), ${JSON.stringify(spec)});
  out.textContent = "drawn; Chart is " + typeof Chart;
} catch (error) {
  out.textContent = error.message;
}`,
});

const ui = (mode: "standard" | "custom") => ({ standardVersion: 1, mode }) as const;

/** A tool that draws the spending chart, then takes it away, as a render that starts over does. */
const cleared: Artifact["code"] = {
  ...drawing(SPENDING),
  js: `${drawing(SPENDING).js}
document.querySelector("#chart").replaceChildren();`,
};
/** A tool whose spec has a hole among its values, which JavaScript allows and JSON can't carry. */
const holed: Artifact["code"] = {
  ...drawing(SPENDING),
  js: drawing(SPENDING).js.replace("[1200,450,120,200]", "[1200, , 120, 200]"),
};
const tools = {
  standard: { code: drawing(SPENDING), ui: ui("standard"), capabilities: ["chart"] },
  custom: {
    code: drawing(SPENDING, ":root { --ui-chart-1: #c00000; }"),
    ui: ui("custom"),
    capabilities: ["chart"],
  },
  plainCustom: { code: drawing(SPENDING), ui: ui("custom"), capabilities: ["chart"] },
  undeclared: { code: drawing(SPENDING), ui: ui("standard"), capabilities: [] },
  cleared: { code: cleared, ui: ui("standard"), capabilities: ["chart"] },
  holed: { code: holed, ui: ui("standard"), capabilities: ["chart"] },
  mismatched: {
    code: drawing({ ...SPENDING, series: [{ name: "Spent", values: [1, 2] }] }),
    ui: ui("standard"),
    capabilities: ["chart"],
  },
  twoPies: {
    code: drawing({
      ...SPENDING,
      type: "pie",
      series: [SPENDING.series[0], { name: "Planned", values: [1, 2, 3, 4] }],
    }),
    ui: ui("standard"),
    capabilities: ["chart"],
  },
} satisfies Record<string, Pick<Artifact, "code" | "ui" | "capabilities">>;

let host: SandboxHost;
test.beforeAll(async () => {
  host = await startSandboxHost(tools);
});
test.afterAll(() => host.close());

type TestWindow = {
  mountTool(container: HTMLElement, mountId: string): Promise<unknown>;
};

/** Opens `mountId` and waits for its #out to say something; gives the tool's frame. */
async function open(page: Page, mountId: string): Promise<Frame> {
  await page.goto(`${host.url}/`);
  await ready(page, "mountTool");
  await page.evaluate(
    (id) => (window as unknown as TestWindow).mountTool(document.body, id),
    mountId,
  );
  await expect(toolFrame(page).locator("#out")).not.toBeEmpty();
  const frame = page.frames().find((each) => each.url().includes("/runtime/tool"));
  if (!frame) throw new Error("The tool's frame isn't there.");
  return frame;
}

/** How many of the chart's pixels are exactly `rgb`. */
const pixels = (frame: Frame, rgb: [number, number, number]) =>
  frame.evaluate(([r, g, b]) => {
    const canvas = document.querySelector("canvas");
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return -1;
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] === r && data[i + 1] === g && data[i + 2] === b) count += 1;
    }
    return count;
  }, rgb);

test("CAP-04: a tool that declares chart draws through tessera.chart, and the library itself is out of its reach", async ({
  page,
}) => {
  const frame = await open(page, "standard");
  await expect(frame.locator("#out")).toHaveText("drawn; Chart is undefined");
  await expect(frame.getByRole("img", { name: "Spending this month" })).toBeVisible();
});

test("CAP-04: a chart has a table of its numbers that only a screen reader reaches", async ({
  page,
}) => {
  const frame = await open(page, "standard");
  const table = frame.getByRole("table", { name: "Spending this month" });
  await expect(table).toHaveCount(1);
  await expect(table.getByRole("row")).toHaveText([
    "Spent",
    "Rent1200",
    "Food450",
    "Transport120",
    "Fun200",
  ]);
  const box = await table.locator("..").boundingBox();
  expect(box && box.width <= 1 && box.height <= 1).toBe(true);
});

test("CAP-04, VER-06: a chart takes the standard's colors in standard mode, and the tool's own in custom mode, the standard's where it sets none", async ({
  page,
}) => {
  const ACCENT: [number, number, number] = [82, 105, 71];
  expect(await pixels(await open(page, "standard"), ACCENT)).toBeGreaterThan(100);
  const custom = await open(page, "custom");
  expect(await pixels(custom, [192, 0, 0])).toBeGreaterThan(100);
  expect(await pixels(custom, ACCENT)).toBe(0);
  expect(await pixels(await open(page, "plainCustom"), ACCENT)).toBeGreaterThan(100);
});

test("CAP-04: a tool that doesn't declare chart gets neither the library nor a working helper", async ({
  page,
}) => {
  const frame = await open(page, "undeclared");
  await expect(frame.locator("#out")).toHaveText(
    "tessera.chart needs the chart capability, which this tool doesn't declare.",
  );
  await expect(frame.locator("canvas")).toHaveCount(0);
});

test("CAP-04: a spec the helper can't draw is refused, saying what is wrong", async ({ page }) => {
  await expect((await open(page, "mismatched")).locator("#out")).toHaveText(
    'tessera.chart can\'t draw this chart: series "Spent" needs one number for each of its 4 labels.',
  );
  await expect((await open(page, "twoPies")).locator("#out")).toHaveText(
    "tessera.chart can't draw this chart: a pie chart has exactly one series.",
  );
  await expect((await open(page, "holed")).locator("#out")).toHaveText(
    `tessera.chart can't draw this chart: series "Spent" needs one number for each of its 4 labels.`,
  );
});

test("CAP-04, VER-03: a behavior check reads what each hooked element's chart shows", async ({
  page,
}) => {
  await page.goto(host.url);
  await ready(page, "stageCandidate");
  const report = await page.evaluate(async () => {
    const w = window as unknown as {
      stageCandidate(options: unknown): Promise<unknown>;
      driveTool(tool: unknown, steps: unknown): Promise<unknown>;
    };
    let answer: unknown;
    await w.stageCandidate({
      candidate: {
        mountId: "standard",
        hash: "a".repeat(64),
        capabilities: ["chart"],
        syntheticData: {},
      },
      workspaceId: "00000000-0000-4000-8000-000000000000",
      expectedDataRevision: 0,
      activationToken: "00000000-0000-4000-8000-000000000001",
      checks: [
        {
          name: "drive",
          run: async ({ tool }: { tool: unknown }) => {
            answer = await w.driveTool(tool, [
              { do: "chart", hook: "chart" },
              { do: "chart", hook: "missing" },
            ]);
            return { ok: true };
          },
        },
      ],
      activate: () => Promise.resolve({ ok: false, reason: "stale", message: "Not stored." }),
    });
    return answer as DriveReport;
  });
  expect(report).toEqual({
    problems: [],
    steps: [
      { ok: true, count: 1, charts: [SPENDING] },
      { ok: true, count: 0, charts: [] },
    ],
  });
});

test("CAP-04, VER-02: a tool that draws a chart passes the smoke check at the panel's width", async ({
  page,
}) => {
  await page.goto(host.url);
  await ready(page, "stageCandidate");
  const result = await page.evaluate(async () => {
    const w = window as unknown as {
      stageCandidate(options: unknown): Promise<unknown>;
      smokeCheck(): unknown;
    };
    return w.stageCandidate({
      candidate: {
        mountId: "standard",
        hash: "a".repeat(64),
        capabilities: ["chart"],
        syntheticData: {},
      },
      workspaceId: "00000000-0000-4000-8000-000000000000",
      expectedDataRevision: 0,
      activationToken: "00000000-0000-4000-8000-000000000001",
      checks: [w.smokeCheck()],
      activate: () =>
        Promise.resolve({ ok: false, reason: "stale", message: "Passed the checks." }),
    });
  });
  expect(result).toEqual({ outcome: "refused", reason: "stale", message: "Passed the checks." });
});

test("CAP-04, VER-03: a chart the tool has taken away isn't reported as shown", async ({
  page,
}) => {
  await page.goto(host.url);
  await ready(page, "stageCandidate");
  const report = await page.evaluate(async () => {
    const w = window as unknown as {
      stageCandidate(options: unknown): Promise<unknown>;
      driveTool(tool: unknown, steps: unknown): Promise<unknown>;
    };
    let answer: unknown;
    await w.stageCandidate({
      candidate: {
        mountId: "cleared",
        hash: "a".repeat(64),
        capabilities: ["chart"],
        syntheticData: {},
      },
      workspaceId: "00000000-0000-4000-8000-000000000000",
      expectedDataRevision: 0,
      activationToken: "00000000-0000-4000-8000-000000000001",
      checks: [
        {
          name: "drive",
          run: async ({ tool }: { tool: unknown }) => {
            answer = await w.driveTool(tool, [{ do: "chart", hook: "chart" }]);
            return { ok: true };
          },
        },
      ],
      activate: () => Promise.resolve({ ok: false, reason: "stale", message: "Not stored." }),
    });
    return answer as DriveReport;
  });
  expect(report).toEqual({ problems: [], steps: [{ ok: true, count: 1, charts: [null] }] });
});
