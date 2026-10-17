// A stand-in for the claude program, for the spike's dry run and tests. Run as
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
fs.writeFileSync(
  path.join(callsFolder, `call-${callIndex}.json`),
  JSON.stringify({ args, cwd: process.cwd(), envNames: Object.keys(process.env).sort() }),
);
// Like Claude Code 2.1.296, which checks --json-schema with a default (draft-07) ajv before it
// calls a model: the live run found it refuses draft 2020-12 (#19).
const schemaAt = args.indexOf("--json-schema") + 1;
if (schemaAt > 0) {
  try {
    new Ajv().compile(JSON.parse(args[schemaAt] ?? "") as object);
  } catch (error) {
    process.stderr.write(
      `Error: --json-schema is not a valid JSON Schema: ${(error as Error).message}\n`,
    );
    process.exit(1);
  }
}
const replies = JSON.parse(fs.readFileSync(repliesFile, "utf8")) as unknown[];
const reply = replies[callIndex];
if (reply === undefined) {
  process.stderr.write(`fake-claude: no reply for call ${callIndex}\n`);
  process.exit(1);
}
process.stdout.write(JSON.stringify(reply));
