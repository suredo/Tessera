// Docs: docs/code/evals/runner.md
import fs from "node:fs";
import { scriptedReplySchema, type ScriptedReply } from "@tessera/contracts";
import { createScriptedProvider, ProviderError, type Provider } from "@tessera/server";
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
});

export const answersSchema = z
  .strictObject({
    about: z.string().min(1).describe("What the answers are: a rehearsal, or which live run."),
    scenario: z.string().min(1),
    answers: z.array(answerSchema),
  })
  .describe("A rehearsal's or a replay's answers, in the order the stages ask for them.");
export type Answers = z.infer<typeof answersSchema>;

/** Reads and checks an answers file. */
export function loadAnswers(file: string): Answers {
  return answersSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}

const SAVED = /\{\{saved:([^}]+)\}\}/g;

/** The answer with each saved tool it names by name given its ID now; unknown names stay. */
function fill(value: unknown, savedToolId: (name: string) => string | undefined): unknown {
  const text = JSON.stringify(value).replace(
    SAVED,
    (whole, name: string) => savedToolId(name) ?? whole,
  );
  return JSON.parse(text) as unknown;
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

/** A provider that answers from the file's answers, one per call, and can't reach a model. */
export function answersProvider(
  answers: Answers,
  savedToolId: (name: string) => string | undefined,
): Provider & { remaining(): number } {
  let next = 0;
  return {
    name: `answers:${answers.scenario}`,
    live: false,
    async run(spec) {
      const current = answers.answers[next++];
      if (current) await wait(current.delayMs ?? 0, spec.signal);
      const replies: ScriptedReply[] = current
        ? [fill(current.reply, savedToolId) as ScriptedReply]
        : [];
      // One reply at a time, through the scripted provider, so its stage and shape checks apply.
      return createScriptedProvider({ name: answers.scenario, replies }).run(spec);
    },
    remaining: () => Math.max(0, answers.answers.length - next),
  };
}
