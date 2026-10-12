// Git pre-commit hook: refuses likely secrets (ENG-19), video files and images over 1 MB (ENG-10)
// in what is being committed. It checks the staged content, not the working copy.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const VIDEO = new Set([".mp4", ".mov", ".webm", ".avi", ".mkv", ".m4v", ".wmv", ".flv", ".mpg"]);
const IMAGE = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".avif"]);
const MAX_IMAGE_BYTES = 1024 * 1024;
const SECRETLINT = path.join("node_modules", "secretlint", "bin", "secretlint.js");

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
const staged = git("diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR")
  .split("\0")
  .filter(Boolean);

const problems = [];
const textFiles = [];
for (const file of staged) {
  const ext = path.extname(file).toLowerCase();
  if (VIDEO.has(ext)) {
    problems.push(`${file}: videos never go in the repository; attach them to a release (ENG-10)`);
  } else if (IMAGE.has(ext)) {
    const size = Number(git("cat-file", "-s", `:${file}`));
    if (size > MAX_IMAGE_BYTES) {
      const mb = (size / MAX_IMAGE_BYTES).toFixed(1);
      problems.push(
        `${file}: a ${mb} MB image; images over 1 MB stay out of the repository (ENG-10)`,
      );
    }
  } else {
    textFiles.push(file);
  }
}

// secretlint reads files, so the staged versions are written to a temporary folder first.
if (textFiles.length > 0) {
  if (!fs.existsSync(SECRETLINT)) {
    problems.push("the secret scan needs the dependencies: run pnpm install, then commit again");
  } else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-pre-commit-"));
    try {
      const copies = [];
      for (const file of textFiles) {
        const content = execFileSync("git", ["show", `:${file}`]);
        if (content.subarray(0, 8000).includes(0)) continue; // binary, not text
        const copy = path.join(dir, file);
        fs.mkdirSync(path.dirname(copy), { recursive: true });
        fs.writeFileSync(copy, content);
        copies.push(copy);
      }
      // Batches keep the command line short enough for Windows.
      for (let i = 0; i < copies.length; i += 50) {
        const scan = spawnSync(
          process.execPath,
          [SECRETLINT, "--secretlintrc", ".secretlintrc.json", ...copies.slice(i, i + 50)],
          { encoding: "utf8" },
        );
        if (scan.status !== 0) {
          // Show repository paths: drop the temporary folder, however secretlint spells it.
          const report = `${scan.stdout}${scan.stderr}`
            .replaceAll(dir + path.sep, "")
            .replaceAll(`${dir.replaceAll("\\", "/")}/`, "")
            .trim();
          problems.push(`likely secrets in the staged changes (ENG-19):\n${report}`);
        }
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

if (problems.length > 0) {
  console.error(`Commit refused:\n${problems.map((p) => `- ${p}`).join("\n")}`);
  console.error(
    "Fix the files and commit again. Skip this check only deliberately, with --no-verify, and say why in the pull request.",
  );
  process.exit(1);
}
