// Exclusive per-home lock for `.central-knot/sessions/` (`lock.sqlite`), shared by `sessionsweep.ts` and future store
// mutators (Clear, retention). Owns: gating lock creation on `share.ts writeAccess` and verifying `sessions` and
// `lock.sqlite` are real paths (not links, wrong file types, non-empty, or read-only) before making anything on disk; and
// in-process and cross-process exclusion via `node:sqlite` `DatabaseSync` with zero busy timeout,
// `PRAGMA journal_mode = MEMORY` (no `-journal` sidecar), and `BEGIN IMMEDIATE`, held until `work` settles and released
// in `finally`. Removing `lock.sqlite` while it is held lets another process create a new inode and take a second lock, so
// nothing removes it (Clear leaves it in place); process exit or crash releases the OS lock automatically.
//
// Limits: promises exclusion on a local file system only; a home on a network folder is not covered.
// Not here: record shapes, reads, upserts, or turns (`sessionrecord.ts`); sweeping (`sessionsweep.ts`); Clear, retention,
// callers, Settings, or timers.
import { access, constants, lstat, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sessionsDirectory, type HeldEntry } from './sessionrecord.ts';
import { errorCode, writeAccess, type ShareContext } from './share.ts';

/** Permanent empty SQLite file inside `.central-knot/sessions/` used solely for OS-level store locking. */
export const SESSION_LOCK_FILE = 'lock.sqlite';

const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;

/** Outcome of `withSessionStoreLock`: `ok` with `work`'s answer, `busy` when held, or `refused` (with optional `held`). */
export type SessionLockResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'busy' }
  | { status: 'refused'; refused: string; held?: HeldEntry };

/** Path of a home's permanent session-store lock file (`.central-knot/sessions/lock.sqlite`). */
export const sessionLockPath = (home: string): string => join(sessionsDirectory(home), SESSION_LOCK_FILE);

const heldRefusal = (held: HeldEntry): SessionLockResult<never> => ({ status: 'refused', refused: held.reason, held });

function isBusyError(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'errcode' in error ? error.errcode : undefined;
  return typeof code === 'number' && ((code & 0xff) === SQLITE_BUSY || (code & 0xff) === SQLITE_LOCKED);
}

async function checkPath(path: string, file: string, dir: boolean): Promise<'ok' | 'missing' | HeldEntry> {
  const label = dir ? 'The sessions folder' : file;
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) return { file, kind: 'link', reason: `${label} is a link.` };
    if (dir ? !info.isDirectory() : !info.isFile()) {
      return { file, kind: 'not-a-file', reason: dir ? 'The sessions path is not a folder.' : `${file} is not a regular file.` };
    }
    if (!dir) {
      if (info.size > 0) return { file, kind: 'damaged', reason: `${file} is not empty. Remove it to clear the lock.` };
      // SQLite opens a read-only 0-byte file without write-locking it, so require write access up front.
      const writable = await access(path, constants.R_OK | constants.W_OK).then(() => true, () => false);
      if (!writable) return { file, kind: 'damaged', reason: `${file} cannot be written. Remove it to clear the lock.` };
    }
    return 'ok';
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT') return 'missing';
    return { file, kind: code === 'ENOTDIR' ? 'not-a-file' : 'damaged', reason: `${label} could not be read.` };
  }
}

function closeLock(db: DatabaseSync | undefined): void {
  if (!db?.isOpen) return;
  if (db.isTransaction) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Closing below releases the OS lock even if ROLLBACK fails.
    }
  }
  try {
    db.close();
  } catch {
    // Never mask an error thrown by `work`.
  }
}

/**
 * Runs `work` holding an exclusive local-filesystem OS lock on `context.home`'s session store (`lock.sqlite`).
 * Verifies `writeAccess` and store paths before creating `.central-knot/sessions/` or the lock file, and returns `busy`
 * without waiting if another caller in this process or another process holds the store.
 */
export async function withSessionStoreLock<T>(context: ShareContext, work: () => Promise<T>): Promise<SessionLockResult<T>> {
  const accessCheck = await writeAccess(context);
  if (!accessCheck.allowed) return { status: 'refused', refused: accessCheck.reason };
  const dirPath = sessionsDirectory(context.home);
  const dir = await checkPath(dirPath, 'sessions', true);
  if (typeof dir !== 'string') return heldRefusal(dir);
  if (dir === 'missing') {
    const made = await mkdir(dirPath, { recursive: true }).then(() => true, () => false);
    if (!made) {
      const parent = await stat(dirname(dirPath)).catch(() => undefined);
      return heldRefusal({ file: 'sessions', kind: parent && !parent.isDirectory() ? 'not-a-file' : 'damaged', reason: 'The sessions folder could not be created.' });
    }
  }
  const lockPath = sessionLockPath(context.home);
  const lock = await checkPath(lockPath, SESSION_LOCK_FILE, false);
  if (typeof lock !== 'string') return heldRefusal(lock);
  let db: DatabaseSync | undefined;
  try {
    try {
      db = new DatabaseSync(lockPath, { timeout: 0 });
      db.exec('PRAGMA journal_mode = MEMORY');
      db.exec('BEGIN IMMEDIATE');
    } catch (error) {
      if (isBusyError(error)) return { status: 'busy' };
      return heldRefusal({ file: SESSION_LOCK_FILE, kind: 'damaged', reason: `${SESSION_LOCK_FILE} could not be locked. Remove it to clear the lock.` });
    }
    return { status: 'ok', value: await work() };
  } finally {
    closeLock(db);
  }
}
