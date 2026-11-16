import { expect, test, type Page } from "@playwright/test";
import type { Artifact } from "../../contracts/src/index.ts";
import { startSandboxHost, type SandboxHost } from "./support/sandbox-host.ts";
import { ready } from "./support/ready.ts";

// The editing-with-files profile's behavior check (VER-03, A83, #351), in Chrome (TEST-06): in
// staging, after the smoke check, it opens an image, which a checked tool gets as the host's sample
// (A80), saves it untouched, edits it and saves it again; nothing is saved, the host records what
// was offered (A81). A good editor passes, saving PNG or JPEG; each deliberately broken one fails,
// saying what was expected, what was observed and whose rule it is (VER-07).

type Flaw =
  "none" | "jpeg" | "noPick" | "unsized" | "blank" | "editDoesNothing" | "savesText" | "noSave";

/** An image editor that fits the editing-with-files profile, with `flaw` built in. */
const editor = (flaw: Flaw): Artifact["code"] => ({
  html: `<button type="button" data-hook="image-open">Open a photo</button>
<button type="button" data-hook="image-edit">Rotate</button>
<button type="button" data-hook="image-save">Save</button>
<p id="status" role="status"></p>
<canvas data-hook="image-view"></canvas>`,
  css: "canvas { max-width: 100%; }",
  js: `const flaw = ${JSON.stringify(flaw)};
const canvas = document.querySelector("[data-hook=image-view]");
const pen = canvas.getContext("2d");
const status = document.getElementById("status");
const load = (url) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = reject;
  image.src = url;
});
document.querySelector("[data-hook=image-open]").addEventListener("click", async () => {
  // One flaw never asks for a file: it draws a picture of its own.
  if (flaw === "noPick") { canvas.width = 16; canvas.height = 12; pen.fillRect(0, 0, 16, 12); return; }
  const file = await tessera.pickFile();
  if (!file) return;
  // One flaw draws nothing, leaving the canvas blank at its default size; one sizes it to the
  // image but still draws nothing (#381 review).
  if (flaw === "unsized") return;
  if (flaw === "blank") { canvas.width = file.widthPx; canvas.height = file.heightPx; return; }
  const image = await load(await tessera.assetUrl(file.id));
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  pen.drawImage(image, 0, 0);
  status.textContent = "Opened " + file.name;
});
// Rotating a quarter turn; one flaw changes nothing.
document.querySelector("[data-hook=image-edit]").addEventListener("click", () => {
  if (flaw === "editDoesNothing") return;
  const copy = document.createElement("canvas");
  copy.width = canvas.width;
  copy.height = canvas.height;
  copy.getContext("2d").drawImage(canvas, 0, 0);
  canvas.width = copy.height;
  canvas.height = copy.width;
  pen.translate(canvas.width, 0);
  pen.rotate(Math.PI / 2);
  pen.drawImage(copy, 0, 0);
  pen.setTransform(1, 0, 0, 1, 0, 0);
});
document.querySelector("[data-hook=image-save]").addEventListener("click", async () => {
  if (flaw === "noSave") { status.textContent = "Saved"; return; }
  const type = flaw === "jpeg" ? "image/jpeg" : "image/png";
  const file = flaw === "savesText"
    ? { name: "photo.txt", type: "text/plain", text: canvas.width + " by " + canvas.height }
    : { name: "photo", type, bytesBase64: canvas.toDataURL(type).split(",")[1] };
  const saved = await tessera.saveFile(file);
  status.textContent = saved ? "Saved" : "Not saved";
});`,
});

const flaws: Flaw[] = [
  "none",
  "jpeg",
  "noPick",
  "unsized",
  "blank",
  "editDoesNothing",
  "savesText",
  "noSave",
];
let host: SandboxHost;

test.beforeAll(async () => {
  host = await startSandboxHost(Object.fromEntries(flaws.map((flaw) => [flaw, editor(flaw)])));
});
test.afterAll(() => host.close());

type Result = { outcome: string; check?: string; reason?: string };

/** Stages an editor behind the smoke check and the editing-with-files check; activation is refused. */
async function check(page: Page, flaw: Flaw): Promise<Result> {
  await page.goto(host.url);
  await ready(page, "stageCandidate");
  return page.evaluate(
    async ({ mountId }) => {
      const w = window as unknown as {
        stageCandidate(options: unknown): Promise<Result>;
        smokeCheck(): unknown;
        profileCheck(id: string): unknown;
      };
      return w.stageCandidate({
        candidate: {
          mountId,
          hash: "a".repeat(64),
          capabilities: ["files"],
          syntheticData: {},
        },
        workspaceId: "00000000-0000-4000-8000-000000000000",
        expectedDataRevision: 0,
        activationToken: "00000000-0000-4000-8000-000000000001",
        checks: [w.smokeCheck(), w.profileCheck("editing-with-files")],
        // Reached only when every check passed; refusing keeps the test off the server.
        activate: () =>
          Promise.resolve({ ok: false, reason: "stale", message: "Passed the checks." }),
      });
    },
    { mountId: flaw },
  );
}

const PASSED = { outcome: "refused", reason: "stale", message: "Passed the checks." };

test("VER-03, CAP-03: an editor that opens the picked image, saves it, and changes it with an edit passes the editing-with-files check", async ({
  page,
}) => {
  expect(await check(page, "none")).toEqual(PASSED);
});

test("VER-03: so does one that saves JPEG", async ({ page }) => {
  expect(await check(page, "jpeg")).toEqual(PASSED);
});

for (const [flaw, title, rule, words] of [
  [
    "noPick",
    "never asks for the person's image",
    "Pressing image-open asks Tessera",
    /an image asked for with tessera\.pickFile\(\); observed none asked for/,
  ],
  [
    "unsized",
    "never shows the image it opened",
    "before any edit, it is the picked image",
    /the picked image, 16 by 12 pixels, before any edit; observed 300 by 150 pixels/,
  ],
  [
    "blank",
    "sizes its canvas to the image but never draws it",
    "before any edit, it is the picked image",
    /the picked image, 16 by 12 pixels, before any edit; observed a 16 by 12 image that isn't the picked one/,
  ],
  [
    "editDoesNothing",
    "has an edit that changes nothing",
    "Pressing image-edit changes the image",
    /an image that differs from the one before the edit; observed the same image/,
  ],
  [
    "savesText",
    "saves something that isn't an image",
    "as a PNG, JPEG or WebP image",
    /a PNG, JPEG or WebP image before any edit; observed text\/plain/,
  ],
  [
    "noSave",
    "never offers the image to save",
    "Pressing image-save offers the image",
    /an image offered with tessera\.saveFile\(file\) before any edit; observed none offered/,
  ],
] as const) {
  test(`VER-03, VER-07: an editor that ${title} fails, saying what was expected and observed, by whose rule`, async ({
    page,
  }) => {
    const result = await check(page, flaw);
    expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
    expect(result.reason).toContain("The editing-with-files check, a rule of Tessera's");
    expect(result.reason).toContain(rule);
    expect(result.reason).toMatch(words);
  });
}
