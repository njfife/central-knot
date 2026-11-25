// Exclusive per-home lock for `.central-knot/sessions/` (`lock.sqlite`), shared by `sessionsweep.ts` and future store
// mutators (Clear, retention). Owns: gating lock creation on `share.ts writeAccess` and verifying `.central-knot`,
// `sessions`, and `lock.sqlite` are real home-owned paths (not links or wrong file types) before making anything on disk;
// in-process exclusion by canonical home (`share.ts landingOf`); and cross-process OS exclusion via `node:sqlite`
// `DatabaseSync` with zero busy timeout, `PRAGMA journal_mode = MEMORY` (no sidecar journal), and `BEGIN IMMEDIATE`, held
// until `work` settles and released in `finally`. The empty `lock.sqlite` file stays permanently; process exit or crash
// releases the OS lock automatically.
//
// Limits: promises exclusion on a local file system only; a home on a network folder is not covered.
// Not here: record shapes, reads, upserts, or turns (`sessionrecord.ts`); sweeping (`sessionsweep.ts`); Clear, retention,
// callers, Settings, or timers.
import { access, constants, lstat, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sessionsDirectory, type HeldEntry } from './sessionrecord.ts';
import { errorCode, landingOf, storeDirectory, writeAccess, type ShareContext } from './share.ts';

/** Permanent empty SQLite file inside `.central-knot/sessions/` used solely for OS-level store locking. */
export const SESSION_LOCK_FILE = 'lock.sqlite';

const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const inProcessLocks = new Set<string>();

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
  const name = file === '.central-knot' ? 'The Central Knot' : file === 'sessions' ? 'The sessions' : file;
  const label = dir ? `${name} folder` : name;
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) return { file, kind: 'link', reason: `${label} is a link.` };
    if (dir ? !info.isDirectory() : !info.isFile()) {
      return { file, kind: 'not-a-file', reason: dir ? `${name} path is not a folder.` : `${name} is not a regular file.` };
    }
    if (!dir) await access(path, constants.R_OK | constants.W_OK);
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
  const access = await writeAccess(context);
  if (!access.allowed) return { status: 'refused', refused: access.reason };
  const key = (await landingOf(context.home)) ?? resolve(context.home);
  if (inProcessLocks.has(key)) return { status: 'busy' };
  inProcessLocks.add(key);
  let db: DatabaseSync | undefined;
  try {
    const store = await checkPath(storeDirectory(context.home), '.central-knot', true);
    if (typeof store !== 'string') return heldRefusal(store);
    const dirPath = sessionsDirectory(context.home);
    const dir = store === 'ok' ? await checkPath(dirPath, 'sessions', true) : 'missing';
    if (typeof dir !== 'string') return heldRefusal(dir);
    if (dir === 'missing') {
      const made = await mkdir(dirPath, { recursive: true }).then(() => true, () => false);
      if (!made) return heldRefusal({ file: 'sessions', kind: 'damaged', reason: 'The sessions folder could not be created.' });
    }
    const lockPath = sessionLockPath(context.home);
    const lock = await checkPath(lockPath, SESSION_LOCK_FILE, false);
    if (typeof lock !== 'string') return heldRefusal(lock);
    try {
      db = new DatabaseSync(lockPath, { timeout: 0 });
      db.exec('PRAGMA journal_mode = MEMORY');
      db.exec('BEGIN IMMEDIATE');
    } catch (error) {
      if (isBusyError(error)) return { status: 'busy' };
      return heldRefusal({ file: SESSION_LOCK_FILE, kind: 'damaged', reason: `${SESSION_LOCK_FILE} could not be locked.` });
    }
    return { status: 'ok', value: await work() };
  } finally {
    closeLock(db);
    inProcessLocks.delete(key);
  }
}
