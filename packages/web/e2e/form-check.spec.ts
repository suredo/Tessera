import { expect, test, type Page } from "@playwright/test";
import type { Artifact } from "../../contracts/src/index.ts";
import { startSandboxHost, type SandboxHost } from "./support/sandbox-host.ts";
import { ready } from "./support/ready.ts";

// The form profile's behavior check (VER-03), in Chrome and Edge (TEST-06): in staging, after the
// smoke check, it reads what the form's fields are, sends the form with a required field empty and
// expects nothing saved and the form saying what is missing, sends it filled in and expects one
// more answer showing what was typed, and opens the tool again, its saves going to a throwaway
// copy (BRG-06). A good form passes; each deliberately broken one fails, saying what was expected,
// what was observed and whose rule it is (VER-07).

type Flaw =
  "none" | "numbersOnly" | "silent" | "savesEmpty" | "notSaved" | "dropsAllergies" | "browserOnly";

/** An RSVP form that fits the form profile, with `flaw` built in. */
const rsvp = (flaw: Flaw): Artifact["code"] => ({
  html: `<form>
${flaw === "numbersOnly" ? "" : '<label for="name">Name</label> <input id="name" name="name" data-hook="form-field" required>'}
<label for="people">How many people</label> <input id="people" name="people" type="number" min="1" max="20" data-hook="form-field" required>
<label for="meal">Meal</label> <select id="meal" name="meal" data-hook="form-field"><option value="">Any</option><option value="fish">Fish</option><option value="veg">Vegetarian</option></select>
${flaw === "numbersOnly" ? "" : '<label for="allergies">Food allergies</label> <textarea id="allergies" name="allergies" data-hook="form-field"></textarea>'}
<label><input type="checkbox" name="coming" data-hook="form-field" required> I'm coming</label>
<button ${flaw === "browserOnly" ? "" : 'type="button"'} data-hook="form-submit">Send</button>
<p data-hook="form-error"></p>
</form>
<ul></ul>`,
  css: "",
  js: `const flaw = ${JSON.stringify(flaw)};
let state;
const list = document.querySelector("ul");
const form = document.querySelector("form");
const error = document.querySelector("[data-hook=form-error]");
const render = () => list.replaceChildren(...state.data.answers.map((answer) => {
  const item = document.createElement("li");
  item.dataset.hook = "answer";
  const parts = [answer.name, answer.people + " people", answer.meal, flaw === "dropsAllergies" ? "" : answer.allergies];
  item.textContent = parts.filter(Boolean).join(", ");
  return item;
}));
const load = () => tessera.call("data.read").then((read) => { state = read; render(); });
load();
// A form never submits in Tessera, so the button's click sends it; one flaw waits for a submit.
const send = (event) => {
  event.preventDefault();
  const answer = Object.fromEntries(new FormData(form));
  const missing = [...form.elements].filter((field) => field.required && (field.type === "checkbox" ? !field.checked : !field.value.trim()));
  if (missing.length > 0 && flaw !== "savesEmpty") {
    if (flaw !== "silent") error.textContent = "Please fill in: " + missing.map((field) => field.labels[0].textContent.trim()).join(", ");
    return;
  }
  error.textContent = "";
  const record = { name: answer.name ?? "", people: Number(answer.people), meal: answer.meal ?? "", allergies: answer.allergies ?? "" };
  if (flaw === "notSaved") {
    state.data.answers.push({ id: "local", ...record });
    return render();
  }
  tessera.call("data.patch", { operations: [{ op: "add", collection: "answers", record }] }).then(load);
};
if (flaw === "browserOnly") form.addEventListener("submit", send);
else document.querySelector("[data-hook=form-submit]").addEventListener("click", send);`,
});

const flaws: Flaw[] = [
  "none",
  "numbersOnly",
  "silent",
  "savesEmpty",
  "notSaved",
  "dropsAllergies",
  "browserOnly",
];
let host: SandboxHost;

test.beforeAll(async () => {
  host = await startSandboxHost(Object.fromEntries(flaws.map((flaw) => [flaw, rsvp(flaw)])));
});
test.afterAll(() => host.close());

type Result = { outcome: string; check?: string; reason?: string };

/** Stages a form behind the smoke check and the form check; activation is refused. */
async function check(page: Page, flaw: Flaw): Promise<Result> {
  await page.goto(host.url);
  await ready(page, "stageCandidate");
  return page.evaluate(async (mountId) => {
    const w = window as unknown as {
      stageCandidate(options: unknown): Promise<Result>;
      smokeCheck(): unknown;
      profileCheck(id: string): unknown;
    };
    return w.stageCandidate({
      candidate: {
        mountId,
        hash: "a".repeat(64),
        capabilities: [],
        syntheticData: {
          answers: [{ id: "a-1", name: "Ana", people: 2, meal: "fish", allergies: "nuts" }],
        },
      },
      workspaceId: "00000000-0000-4000-8000-000000000000",
      expectedDataRevision: 0,
      activationToken: "00000000-0000-4000-8000-000000000001",
      checks: [w.smokeCheck(), w.profileCheck("form")],
      // Reached only when every check passed; refusing keeps the test off the server.
      activate: () =>
        Promise.resolve({ ok: false, reason: "stale", message: "Passed the checks." }),
    });
  }, flaw);
}

const PASSED = { outcome: "refused", reason: "stale", message: "Passed the checks." };
const REFUSES =
  "(Pressing form-submit with a required form-field empty saves nothing, and shows form-error saying what is missing.)";

test("VER-03: a form that refuses an empty required field, saying so, and keeps what it's sent passes the form check", async ({
  page,
}) => {
  expect(await check(page, "none")).toEqual(PASSED);
});

test("VER-03: so does one with no text fields, whose new answer the check can't find by its text", async ({
  page,
}) => {
  expect(await check(page, "numbersOnly")).toEqual(PASSED);
});

test("VER-03, VER-07: a form that refuses without saying what is missing fails, saying what was expected and observed, by whose rule", async ({
  page,
}) => {
  const result = await check(page, "silent");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toBe(
    `The form check, a rule of Tessera's ${REFUSES}: expected 1 answer as before, and form-error saying what is missing, after sending the form with required field 1 empty; observed 1 answer; form-error saying nothing.`,
  );
});

test("VER-03: a form that saves an answer with a required field empty fails", async ({ page }) => {
  const result = await check(page, "savesEmpty");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toContain(REFUSES);
  expect(result.reason).toContain("observed 2 answers; none gone; new: ");
});

test("VER-03: a form that waits for a submit, which never comes in Tessera, fails", async ({
  page,
}) => {
  const result = await check(page, "browserOnly");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toContain("observed 1 answer; form-error saying nothing.");
});

test("VER-03: a form whose answer doesn't show a text typed fails", async ({ page }) => {
  const result = await check(page, "dropsAllergies");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toMatch(
    /expected one answer showing what was typed: "Tessera check answer [0-9a-f]{6} 1", "Tessera check answer [0-9a-f]{6} 4"; observed it without "Tessera check answer [0-9a-f]{6} 4"\.$/,
  );
});

test("VER-03: a form that shows an answer without saving it fails once opened again", async ({
  page,
}) => {
  const result = await check(page, "notSaved");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toContain("(Opened again, the tool shows every answer saved.)");
  expect(result.reason).toMatch(/observed 1 answer; gone: "Tessera check answer [0-9a-f]{6} 1, /);
});
