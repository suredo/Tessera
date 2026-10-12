#!/usr/bin/env node
// Turns on the repository's git hooks in .githooks/ (ENG-01, ENG-15, ENG-19). It runs on every
// `pnpm install` through the "prepare" script, and running it again changes nothing.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

let inCheckout = false;
try {
  inCheckout = git("rev-parse", "--is-inside-work-tree") === "true";
} catch {
  // No git, or not a git checkout (an exported copy): there is nothing to set up.
}

if (!inCheckout) {
  console.log("setup: not a git checkout, so no git hooks were installed");
} else {
  git("config", "core.hooksPath", ".githooks");
  console.log("setup: git hooks are on (.githooks/); skip one only deliberately, with --no-verify");
}
