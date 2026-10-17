// Docs: docs/code/scripts/git-hooks.md
// Git pre-push hook: refuses any push to main, which changes only through pull requests (ENG-15).
// Git passes one line per ref on stdin: <local ref> <local sha> <remote ref> <remote sha>.
import { readFileSync } from "node:fs";

const lines = readFileSync(0, "utf8").split("\n").filter(Boolean);
const toMain = lines.some((line) => line.split(" ")[2] === "refs/heads/main");

if (toMain) {
  console.error(
    "Push refused: main changes only through pull requests (ENG-15). Push a branch and open a pull request.",
  );
  process.exit(1);
}
