// Docs: docs/code/evals/runner.md
import fs from "node:fs";
import { scriptedReplySchema, type ScriptedReply } from "@tessera/contracts";
import { createScriptedProvider, ProviderError, ScriptError, type Provider } from "@tessera/server";
import { z } from "zod";

// The answers a rehearsal or a replay gives, in the order the stages ask for them (TEST-04,
// EVAL-07). A replay is a live run's recorded answers; a rehearsal is written by hand to try the
// runner at no cost. Either way the scripted provider checks each answer is for the stage being
// called, so a pipeline that now asks for something else fails with "needs a new live run"
// instead of guessing (docs/testing/scenarios.md).

/**
 * One answer, and how long it takes: a cancel step needs a request still running. A saved tool's
 * ID is new on every run, so an answer names one as `{{saved:<name>}}`, filled in when it is used.
 */
const answerSchema = z.strictObject({
  reply: scriptedReplySchema,
  delayMs: z.int().min(0).max(120_000).optional(),
  parts: z
    .array(z.string().min(1))
    .optional()
    .describe("The prompt parts the call was recorded with, as name@version (ENG-16)."),
});

export const answersSchema = z
  .strictObject({
    about: z.string().min(1).describe("What the answers are: a rehearsal, or which live run."),
    scenario: z.string().min(1),
    recorded: z
      .strictObject({
        head: z.string().regex(/^[0-9a-f]{40}$/),
        at: z.iso.datetime(),
        cliVersion: z.string().min(1),
      })
      .optional()
      .describe("For a replay: the commit, time and Claude Code version it was recorded with."),
    answers: z.array(answerSchema),
  })
  .describe("A rehearsal's or a replay's answers, in the order the stages ask for them.");
export type Answers = z.infer<typeof answersSchema>;

/** Reads and checks an answers file. */
export function loadAnswers(file: string): Answers {
  return answersSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}

/**
 * A JSON value with each of its strings changed by `change`, keys and structure untouched. Saved
 * tools are named in an answer's strings, never its JSON text, so a name with quotes or
 * backslashes stays whole both ways.
 */
export function mapStrings(value: unknown, change: (text: string) => string): unknown {
  if (typeof value === "string") return change(value);
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, change));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, mapStrings(item, change)]),
    );
  }
  return value;
}

/** A saved tool named in an answer; the name runs to the first `}}`. */
const SAVED = /\{\{saved:(.+?)\}\}/g;

/** The answer with each saved tool it names by name given its ID now; unknown names stay. */
function fill(value: unknown, savedToolId: (name: string) => string | undefined): unknown {
  return mapStrings(value, (text) =>
    text.replace(SAVED, (whole, name: string) => savedToolId(name) ?? whole),
  );
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (!ms) return resolve();
    const done = () => {
      clearTimeout(timer);
      reject(new ProviderError("cancelled", "The request was cancelled."));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", done);
      resolve();
    }, ms);
    signal?.addEventListener("abort", done, { once: true });
  });

/** An answers provider, with what it couldn't answer: the run fails on these, whatever the host showed. */
export type AnswersProvider = Provider & {
  remaining(): number;
  /** Each call the answers didn't fit, in plain words, oldest first. */
  misfits(): readonly string[];
  /** Each call recorded with other prompt parts than it was asked with: a stale replay. */
  stale(): readonly string[];
};

/** A provider that answers from the file's answers, one per call, and can't reach a model. */
export function answersProvider(
  answers: Answers,
  savedToolId: (name: string) => string | undefined,
): AnswersProvider {
  let next = 0;
  const misfits: string[] = [];
  const stale: string[] = [];
  return {
    name: `answers:${answers.scenario}`,
    live: false,
    async run(spec) {
      const index = next++;
      const current = answers.answers[index];
      // A replay recorded with other prompt parts still runs, flagged as stale (ENG-16).
      const asked = spec.promptParts ?? [];
      const recorded = current?.parts;
      if (recorded && asked.length > 0 && recorded.join() !== asked.join()) {
        const now = asked.filter((part) => !recorded.includes(part));
        stale.push(
          `Call ${index + 1} (${spec.stage}) was recorded with other prompt parts; now ${now.join(", ")}.`,
        );
      }
      if (current) await wait(current.delayMs ?? 0, spec.signal);
      const replies: ScriptedReply[] = current
        ? [fill(current.reply, savedToolId) as ScriptedReply]
        : [];
      // One reply at a time, through the scripted provider, so its stage and shape checks apply.
      try {
        return await createScriptedProvider({ name: answers.scenario, replies }).run(spec);
      } catch (error) {
        // The host turns any failed call into an ordinary failed request, which a step that
        // expects nothing to change would pass, so a misfit is kept here for the runner to fail
        // the run on: the answers need a new live run (docs/testing/scenarios.md).
        if (error instanceof ScriptError) {
          misfits.push(
            `The answers don't fit this run, so it needs a new live run: ${error.message}`,
          );
        }
        throw error;
      }
    },
    remaining: () => Math.max(0, answers.answers.length - next),
    misfits: () => misfits,
    stale: () => stale,
  };
}
