// A stand-in for the codex program, for the adapter's contract tests (TEST-02). Run as
// `node fake-codex.ts <replies.json> <calls folder> ...the CLI's arguments`. It writes the
// arguments it got to the calls folder and prints the next canned reply as JSON lines, chosen by
// call order, never by the prompt (ENG-11). It never reaches a model.
import fs from "node:fs";
import path from "node:path";
import { Ajv } from "ajv";

const [repliesFile, callsFolder, ...args] = process.argv.slice(2);
if (!repliesFile || !callsFolder) {
  process.stderr.write("usage: fake-codex <replies.json> <calls folder> ...args\n");
  process.exit(2);
}
fs.mkdirSync(callsFolder, { recursive: true });
const callIndex = fs.readdirSync(callsFolder).length;
const readOr = (read: () => string, otherwise: string) => {
  try {
    return read();
  } catch {
    return otherwise;
  }
};
// Like `codex exec -`: the text arrives on standard input; the schema is in the file --output-schema names.
const stdin = readOr(() => fs.readFileSync(0, "utf8"), "");
const schemaAt = args.indexOf("--output-schema") + 1;
const schemaText =
  schemaAt > 0 ? readOr(() => fs.readFileSync(args[schemaAt] ?? "", "utf8"), "") : "";
// The instructions are in the file a `-c model_instructions_file="…"` setting names.
const instructionsSetting = args.find((arg) => arg.startsWith("model_instructions_file="));
const instructions = instructionsSetting
  ? readOr(
      () =>
        fs.readFileSync(
          JSON.parse(instructionsSetting.slice("model_instructions_file=".length)) as string,
          "utf8",
        ),
      "",
    )
  : "";
fs.writeFileSync(
  path.join(callsFolder, `call-${callIndex}.json`),
  JSON.stringify({
    args,
    cwd: process.cwd(),
    envNames: Object.keys(process.env).sort(),
    codexHome: process.env.CODEX_HOME,
    stdin,
    schema: schemaText,
    instructions,
  }),
);
// The schema file must be a valid draft-07 schema with an object at the root.
if (schemaAt > 0) {
  try {
    const schema = JSON.parse(schemaText) as { type?: unknown };
    new Ajv().compile(schema);
    if (schema.type !== "object") throw new Error("the root of the schema must be an object");
  } catch (error) {
    process.stderr.write(`Error: --output-schema is not usable: ${(error as Error).message}\n`);
    process.exit(1);
  }
}
// A reply gives an `answer` to print as the CLI's events, with the `usage` of its turn.completed
// (replacing the default, so a test can leave a part out). For tests of what can go wrong, it may
// also give the exact `_events` to print, what to print instead (`_stdout`), how long to take
// first (`_delayMs`) and the exit code (`_exitCode`).
type Reply = {
  answer?: unknown;
  usage?: Record<string, number>;
  _events?: unknown[];
  _stdout?: string;
  _delayMs?: number;
  _exitCode?: number;
};
const replies = JSON.parse(fs.readFileSync(repliesFile, "utf8")) as Reply[];
const reply = replies[callIndex];
if (reply === undefined) {
  process.stderr.write(`fake-codex: no reply for call ${callIndex}\n`);
  process.exit(1);
}
const defaultUsage = {
  input_tokens: 1110,
  cached_input_tokens: 1000,
  cache_write_input_tokens: 0,
  output_tokens: 50,
  reasoning_output_tokens: 10,
};
const events = reply._events ?? [
  { type: "thread.started", thread_id: "thread-0" },
  { type: "turn.started" },
  {
    type: "item.completed",
    item: { id: "item_0", type: "agent_message", text: JSON.stringify({ answer: reply.answer }) },
  },
  { type: "turn.completed", usage: reply.usage ?? defaultUsage },
];
setTimeout(() => {
  process.stdout.write(
    reply._stdout ?? events.map((event) => `${JSON.stringify(event)}\n`).join(""),
  );
  process.exitCode = reply._exitCode ?? 0;
}, reply._delayMs ?? 0);
