import path from "node:path";

// Path helpers that behave the same on Windows, macOS and Linux (PLAT-01).

/** A path with forward slashes, for logs, keys and messages; never for opening files. */
export const toPosixPath = (p: string): string => p.split(path.sep).join("/");

/** Text with Windows (\r\n) and old Mac (\r) line endings turned into \n. */
export const normalizeNewlines = (text: string): string => text.replace(/\r\n?/g, "\n");

/**
 * Whether `child` is `parent` itself or somewhere inside it. Windows paths compare without regard
 * to letter case, as Windows does. Both paths are resolved first, so `..` can't escape.
 */
export function isInsideFolder(
  parent: string,
  child: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const p = platform === "win32" ? path.win32 : path.posix;
  const fold = (s: string) => (platform === "win32" ? s.toLowerCase() : s);
  const relative = p.relative(fold(p.resolve(parent)), fold(p.resolve(child)));
  // Outside means the first step is "..", the parent folder; a name like "..cache" is inside.
  const goesUp = relative === ".." || relative.startsWith(`..${p.sep}`);
  return relative === "" || (!goesUp && !p.isAbsolute(relative));
}
