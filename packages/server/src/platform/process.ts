import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Starting other programs, the same way on every platform (PLAT-01). Programs start by absolute
// path and without a shell, so arguments with spaces or quotes arrive exactly as given.

/** How long the output may keep arriving after the program has exited. */
const OUTPUT_GRACE_MS = 250;

/** How long a program may take to stop when asked, at the time limit, before it is ended outright. */
const STOP_GRACE_MS = 1000;

export type ProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** True when the time limit ended the process. */
  timedOut: boolean;
};

export type RunOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** The process is asked to stop after this long, and ended outright if it hasn't a second later. */
  timeoutMs?: number;
};

// A file a shell would start: on macOS and Linux it also needs permission to run, or the shell
// skips it and keeps searching the PATH.
function isRunnable(file: string, platform: NodeJS.Platform): boolean {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  if (platform === "win32") return true;
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// The file's name as stored on disk: Windows matches names regardless of case. Links are kept as
// found, as a shell runs them: some programs choose what to do from the name they were started by.
function asStored(file: string, platform: NodeJS.Platform): string {
  if (platform !== "win32") return file;
  const lower = path.basename(file).toLowerCase();
  const stored = fs.readdirSync(path.dirname(file)).find((name) => name.toLowerCase() === lower);
  return stored === undefined ? file : path.join(path.dirname(file), stored);
}

/**
 * Finds a program on the PATH and returns its absolute path, or null. On Windows it tries the
 * extensions in PATHEXT, as the command prompt does.
 */
export function findExecutable(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const pathValue = env["PATH"] ?? env["Path"] ?? "";
  const known = (env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  // On Windows a name runs only with one of these extensions: try it as given if it has one.
  const hasKnown = known.some((ext) => name.toLowerCase().endsWith(ext.toLowerCase()));
  const extensions = platform === "win32" && !hasKnown ? known : [""];
  const delimiter = platform === "win32" ? ";" : ":";
  for (const dir of pathValue.split(delimiter).filter(Boolean)) {
    for (const ext of extensions) {
      const candidate = path.resolve(dir, name + ext);
      if (isRunnable(candidate, platform)) return asStored(candidate, platform);
    }
  }
  return null;
}

/**
 * Runs a program to completion and collects its output. The program must be given by absolute
 * path. Windows batch files (.cmd, .bat) are refused: Windows starts them only through a shell,
 * which reads quotes and special characters in the arguments. npm's `claude.cmd` shim is one
 * (L-45); point to the real executable instead.
 */
export function runProcess(
  executable: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<ProcessResult> {
  if (!path.isAbsolute(executable)) {
    return Promise.reject(new Error(`Give the program's full path, not "${executable}".`));
  }
  if (/\.(cmd|bat)$/i.test(executable)) {
    return Promise.reject(
      new Error(
        `"${executable}" is a Windows batch file, which can only start through a shell. Use the program's own .exe instead.`,
      ),
    );
  }
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      // No input is sent, so the program reads end-of-input at once instead of waiting.
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killer: ReturnType<typeof setTimeout> | undefined;
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill();
            // Outside Windows a program can catch or ignore that request; then it's ended outright.
            killer = setTimeout(() => child.kill("SIGKILL"), STOP_GRACE_MS);
          }, options.timeoutMs);
    // The result comes when the program exits, once its output has arrived. A program it started
    // and left running can hold the output open; the call then waits only OUTPUT_GRACE_MS more.
    let exitCode: number | null = null;
    let grace: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(grace);
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ exitCode, stdout, stderr, timedOut });
    };
    child.on("error", (error) => {
      settled = true;
      clearTimeout(timer);
      clearTimeout(killer);
      reject(error);
    });
    child.on("exit", (code) => {
      exitCode = code;
      clearTimeout(timer);
      clearTimeout(killer);
      grace = setTimeout(finish, OUTPUT_GRACE_MS);
    });
    child.on("close", finish);
  });
}
