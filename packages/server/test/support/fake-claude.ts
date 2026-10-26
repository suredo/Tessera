// A stand-in for the claude program, for the adapter's contract tests (TEST-02) and the dry runs. Run as
// `node fake-claude.ts <replies.json> <calls folder> ...the CLI's arguments`. It writes the
// arguments it got to the calls folder and prints the next canned result envelope, chosen by call
// order, never by the prompt (ENG-11). It never reaches a model.
import fs from "node:fs";
import path from "node:path";
import { Ajv } from "ajv";

const [repliesFile, callsFolder, ...args] = process.argv.slice(2);
if (!repliesFile || !callsFolder) {
  process.stderr.write("usage: fake-claude <replies.json> <calls folder> ...args\n");
  process.exit(2);
}
fs.mkdirSync(callsFolder, { recursive: true });
const callIndex = fs.readdirSync(callsFolder).length;
// Like the real one in --print mode: the request arrives on standard input, and the system prompt
// in the file --system-prompt-file names, read from the working folder.
const readOr = (read: () => string, otherwise: string) => {
  try {
    return read();
  } catch {
    return otherwise;
  }
};
const stdin = readOr(() => fs.readFileSync(0, "utf8"), "");
const systemFileAt = args.indexOf("--system-prompt-file") + 1;
const system =
  systemFileAt > 0 ? readOr(() => fs.readFileSync(args[systemFileAt] ?? "", "utf8"), "") : "";
fs.writeFileSync(
  path.join(callsFolder, `call-${callIndex}.json`),
  JSON.stringify({
    args,
    cwd: process.cwd(),
    envNames: Object.keys(process.env).sort(),
    stdin,
    system,
  }),
);
// Like Claude Code 2.1.296, which checks --json-schema with a default (draft-07) ajv before it
// calls a model: the live run found it refuses draft 2020-12 (#19).
const schemaAt = args.indexOf("--json-schema") + 1;
if (schemaAt > 0) {
  const schema = JSON.parse(args[schemaAt] ?? "") as { type?: unknown };
  try {
    new Ajv().compile(schema);
  } catch (error) {
    process.stderr.write(
      `Error: --json-schema is not a valid JSON Schema: ${(error as Error).message}\n`,
    );
    process.exit(1);
  }
  // The API then takes it as a tool's input schema, which must be an object at the top level: the
  // third live run got this answer for a union (#19).
  if (schema.type !== "object") {
    process.stdout.write(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: true,
        result: "API Error: 400 tools.1.custom.input_schema.type: Field required",
      }),
    );
    process.exit(1);
  }
}
// A reply is the result envelope to print. For tests of what can go wrong, it may also say how
// long to take first (`_delayMs`), what to print instead (`_stdout`), and the exit code (`_exitCode`).
type Reply = Record<string, unknown> & { _delayMs?: number; _stdout?: string; _exitCode?: number };
const replies = JSON.parse(fs.readFileSync(repliesFile, "utf8")) as Reply[];
const reply = replies[callIndex];
if (reply === undefined) {
  process.stderr.write(`fake-claude: no reply for call ${callIndex}\n`);
  process.exit(1);
}
const { _delayMs = 0, _stdout, _exitCode = 0, ...envelope } = reply;
setTimeout(() => {
  process.stdout.write(_stdout ?? JSON.stringify(envelope));
  process.exitCode = _exitCode;
}, _delayMs);
