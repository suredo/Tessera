// Docs: docs/code/evals/review.md
// Reviews a finished run: node evals/src/review/cli.ts <run folder> [--live --cap <n>]. The default
// is a rehearsal, which answers from a canned review at no cost. The review is written to the run's
// review.json and added to its report.md, with a line for the owner's verdict (EVAL-04).
// --live is LIVE: it calls Claude Code, so it needs the owner's approved cap first (ENG-07,
// docs/practices/live-evaluation.md).
import fs from "node:fs";
import path from "node:path";
import { liveClaudeProvider } from "../../spikes/cli-contract/claude-cli.ts";
import { reviewMarkdown, reviewRun } from "./review.ts";

const [folderArg, flag, capFlag, capValue, ...rest] = process.argv.slice(2);
const live = flag === "--live" && capFlag === "--cap" && capValue !== undefined;
if (!folderArg || rest.length > 0 || (flag !== undefined && !live)) {
  console.error("Usage: node evals/src/review/cli.ts <run folder> [--live --cap <n>]");
  process.exit(2);
}
const folder = path.resolve(folderArg);
if (!fs.existsSync(path.join(folder, "report.json"))) {
  console.error(`${folder} holds no run: its report.json is missing.`);
  process.exit(2);
}

let record;
if (live) {
  const cap = Number(capValue);
  // Claude Code's free checks first: found, recent enough and signed in (L-71).
  const found = await liveClaudeProvider();
  console.log(
    `LIVE: review of ${path.basename(folder)}, hard cap ${cap}, Claude Code ${found.cliVersion}.`,
  );
  record = await reviewRun(folder, { mode: "live", provider: found.provider, callCap: cap });
} else {
  record = await reviewRun(folder, { mode: "rehearsal" });
}
const markdown = reviewMarkdown(record);
fs.appendFileSync(path.join(folder, "report.md"), `\n${markdown}`);
console.log(markdown);
