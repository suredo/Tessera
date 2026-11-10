import { expect, test, type Page } from "@playwright/test";
import type { Artifact } from "../../contracts/src/index.ts";
import { startSandboxHost, type SandboxHost } from "./support/sandbox-host.ts";
import { ready } from "./support/ready.ts";

// The form profile's behavior check (VER-03), in Chrome (TEST-06): in staging, after the
// smoke check, it reads what the form's fields are, sends the form with a required field empty and
// expects nothing saved and the form saying what is missing, sends it filled in and expects one
// more answer showing what was typed, and opens the tool again, its saves going to a throwaway
// copy (BRG-06). A good form passes; each deliberately broken one fails, saying what was expected,
// what was observed and whose rule it is (VER-07).

type Flaw =
  | "none"
  | "numbersOnly"
  | "silent"
  | "savesEmpty"
  | "notSaved"
  | "dropsAllergies"
  | "browserOnly"
  | "consentOnly"
  | "shortName"
  | "pastDate"
  | "verbose"
  | "oneChar"
  | "forgetsLong";

/** An RSVP form that fits the form profile, with `flaw` built in. */
const rsvp = (flaw: Flaw): Artifact["code"] => ({
  html: `<form>
${flaw === "consentOnly" ? '<label for="note">Note</label> <input id="note" name="note" data-hook="form-field">' : ""}
${flaw === "numbersOnly" || flaw === "consentOnly" ? "" : `<label for="name">Name</label> <input id="name" name="name" data-hook="form-field" required${flaw === "shortName" ? ' maxlength="8"' : flaw === "oneChar" ? ' maxlength="1"' : ""}>`}
${flaw === "pastDate" ? '<label for="day">Day</label> <input id="day" name="day" type="date" max="2025-12-31" data-hook="form-field" required>' : ""}
${flaw === "consentOnly" ? "" : '<label for="people">How many people</label> <input id="people" name="people" type="number" min="1" max="20" data-hook="form-field" required>'}
<label for="meal">Meal</label> <select id="meal" name="meal" data-hook="form-field"><option value="">Any</option><option value="fish">Fish</option><option value="veg">Vegetarian</option></select>
${flaw === "numbersOnly" || flaw === "consentOnly" || flaw === "oneChar" ? "" : '<label for="allergies">Food allergies</label> <textarea id="allergies" name="allergies" data-hook="form-field"></textarea>'}
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
  // One flaw shows a set phrase in place of the name; one starts each answer with a long thank-you.
  const name = flaw === "shortName" ? "Answer saved" : answer.name;
  const parts = [name, answer.note, answer.day, answer.people ? answer.people + " people" : "", answer.meal, flaw === "dropsAllergies" ? "" : answer.allergies];
  const thanks = flaw === "verbose" || flaw === "forgetsLong" ? "Thank you for answering. ".repeat(10) : "";
  item.textContent = thanks + parts.filter(Boolean).join(", ");
  return item;
}));
const load = () => tessera.call("data.read").then((read) => { state = read; render(); });
load();
// A form never submits in Tessera, so the button's click sends it; one flaw waits for a submit.
const send = (event) => {
  event.preventDefault();
  const answer = Object.fromEntries(new FormData(form));
  const missing = [...form.elements].filter((field) => field.required && (field.type === "checkbox" ? !field.checked : !field.value.trim()));
  // One flaw saves without the box ticked, and says nothing.
  if (missing.length > 0 && flaw !== "savesEmpty" && flaw !== "consentOnly") {
    if (flaw !== "silent") error.textContent = "Please fill in: " + missing.map((field) => field.labels[0].textContent.trim()).join(", ");
    return;
  }
  if (flaw === "pastDate" && answer.day > "2025-12-31") {
    error.textContent = "Pick a day by the end of 2025.";
    return;
  }
  error.textContent = "";
  const record = { name: answer.name ?? "", note: answer.note ?? "", day: answer.day ?? "", people: Number(answer.people ?? 0), meal: answer.meal ?? "", allergies: answer.allergies ?? "" };
  if (flaw === "notSaved") {
    state.data.answers.push({ id: "local", ...record });
    return render();
  }
  // One flaw saves the answer without what was typed, though it shows it until opened again.
  const saved = flaw === "forgetsLong" ? { ...record, name: "", allergies: "" } : record;
  tessera.call("data.patch", { operations: [{ op: "add", collection: "answers", record: saved }] }).then(load).then(() => {
    if (flaw !== "forgetsLong") return;
    state.data.answers[state.data.answers.length - 1] = { id: "shown", ...record };
    render();
  });
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
  "consentOnly",
  "shortName",
  "pastDate",
  "verbose",
  "oneChar",
  "forgetsLong",
];
let host: SandboxHost;

test.beforeAll(async () => {
  host = await startSandboxHost(Object.fromEntries(flaws.map((flaw) => [flaw, rsvp(flaw)])));
});
test.afterAll(() => host.close());

type Result = { outcome: string; check?: string; reason?: string };

/** Stages a form behind the smoke check and the form check; activation is refused. */
const ANA = [{ id: "a-1", name: "Ana", people: 2, meal: "fish", allergies: "nuts" }];

async function check(page: Page, flaw: Flaw, answers: object[] = ANA): Promise<Result> {
  await page.goto(host.url);
  await ready(page, "stageCandidate");
  return page.evaluate(
    async ({ mountId, answers }) => {
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
            answers,
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
    },
    { mountId: flaw, answers },
  );
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
    `The form check, a rule of Tessera's ${REFUSES}: expected 1 answer as before, and form-error saying what is missing, after sending the form with required field 1 unfilled; observed 1 answer; form-error saying nothing.`,
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

test("VER-03: a form whose only required field is a box to tick is sent with it unticked, and fails if it saves anyway", async ({
  page,
}) => {
  const result = await check(page, "consentOnly");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toContain(
    "after sending the form with required field 3 unfilled; observed 2 answers; none gone; new: ",
  );
  expect(result.reason).toContain("form-error saying nothing.");
});

test("VER-03: a form whose answer doesn't show a text typed in a short field fails", async ({
  page,
}) => {
  const result = await check(page, "shortName");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toMatch(/observed it without "[0-9a-f]{6}x1"\.$/);
});

test("VER-03: a form takes a date within its stated limits, and a long answer is checked whole", async ({
  page,
}) => {
  expect(await check(page, "pastDate")).toEqual(PASSED);
  expect(await check(page, "verbose")).toEqual(PASSED);
});

test("VER-03: a one-character field's answer passes though other answers show the same, even all of them", async ({
  page,
}) => {
  // Every character the field could take, each in an answer like the one the check sends.
  const answers = [..."0123456789abcdef"].map((name, i) => ({
    id: `a-${i + 1}`,
    name,
    people: 1,
    meal: "fish",
    allergies: "",
  }));
  expect(await check(page, "oneChar", answers)).toEqual(PASSED);
});

test("VER-03: a long answer that loses what was typed once saved fails when the tool is opened again", async ({
  page,
}) => {
  const result = await check(page, "forgetsLong");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toContain("(Opened again, the tool shows every answer saved.)");
  expect(result.reason).toMatch(
    /observed 2 answers; the new one without "Tessera check answer [0-9a-f]{6} 1", "Tessera check answer [0-9a-f]{6} 4"\.$/,
  );
});

test("VER-03: a long answer is found among many that read the same, however many there are", async ({
  page,
}) => {
  const answers = Array.from({ length: 25 }, (_, i) => ({
    id: `a-${i + 1}`,
    name: `Guest ${i + 1}`,
    people: 2,
    meal: "fish",
    allergies: "",
  }));
  expect(await check(page, "verbose", answers)).toEqual(PASSED);
});
