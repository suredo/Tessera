import { DatabaseSync } from "node:sqlite";

// An exclusive lock on a file, held through SQLite (ADR 0003), which takes it from the operating
// system: LockFileEx on Windows, fcntl elsewhere. The system releases it when the process ends,
// however it ends, so a lock is never left behind by a copy that was killed.

/** SQLite's "database is locked": another connection, in this process or another, holds it. */
const SQLITE_BUSY = 5;

export type FileLock = {
  /** Releases the lock; calling it again does nothing. */
  release(): void;
};

/**
 * Takes an exclusive lock on `file`, creating it if needed, without waiting. Returns null when
 * someone else holds it. Hold it for as long as the work it guards lasts.
 */
export function tryLockFile(file: string): FileLock | null {
  const db = new DatabaseSync(file, { timeout: 0 });
  try {
    // An exclusive transaction that never ends holds the lock until the connection closes.
    db.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    db.close();
    if ((error as { errcode?: number }).errcode === SQLITE_BUSY) return null;
    throw error;
  }
  let held = true;
  return {
    release: () => {
      if (held) db.close();
      held = false;
    },
  };
}
