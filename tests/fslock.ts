// Shared file and folder permission locks for unit tests moved to this helper (chmod on POSIX; Windows ACL locking is
// step 6), plus cross-platform recursive writable cleanup so test teardown never shells out to `chmod`.
// Not every lock in the suite uses this helper yet: step 6 also owns the raw `chmod` locks in `tests/librarywalk.test.ts`
// (:162, :499), `tests/agentswalk.test.ts` (:73, :168), and `tests/plugintext.test.ts` (:496). On Windows today the strict
// walk suites pass while their `chmod` calls lock nothing on Windows folders even though their traces say "[tool read-only]".
import { chmod, lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Skip reason on Windows until step 6 builds Windows ACL locking here. */
export const LOCK_SKIP_WIN = 'Locked folders on Windows are step 6 (ACL lock helper not built yet); covered on macOS and Linux.';

/** Skip value on Windows only (leaves POSIX root behavior unchanged for tests that keep their own root branch). */
export const winLockSkip: string | false = process.platform === 'win32' && LOCK_SKIP_WIN;

/** Skip value for tests that lock a file or folder: false on non-root POSIX, a named reason on Windows or as root. */
export const lockSkip: string | false = winLockSkip
  || (process.getuid?.() === 0 && 'root bypasses file and folder permission locks');

export type LockKind = 'dir-readonly' | 'dir-unreadable' | 'file-unreadable';

/**
 * Locks `path` (read-only folder, unreadable folder, or unreadable file) and returns an idempotent unlock function.
 * Tests that call this must gate on `lockSkip` (or `winLockSkip`) until Windows ACL locking lands in step 6.
 */
export async function lockPath(path: string, kind: LockKind): Promise<() => Promise<void>> {
  if (process.platform === 'win32') throw new Error(LOCK_SKIP_WIN);
  const locked = kind === 'dir-readonly' ? 0o555 : 0o000;
  const restored = kind === 'file-unreadable' ? 0o644 : 0o755;
  await chmod(path, locked);
  return () => chmod(path, restored).catch(() => undefined);
}

/** Runs `work` with `path` locked and restores its permissions in `finally`. */
export async function withLock<T>(path: string, kind: LockKind, work: () => Promise<T>): Promise<T> {
  const unlock = await lockPath(path, kind);
  try { return await work(); } finally { await unlock(); }
}

/**
 * Restores owner write/read/traverse permissions across a temp tree without spawning `chmod`, so `rm` succeeds
 * after a test leaves read-only files or locked folders behind on any platform. Never follows symlinks.
 */
export async function makeWritableTree(root: string): Promise<void> {
  const info = await lstat(root).catch(() => undefined);
  if (!info || info.isSymbolicLink()) return;
  if (info.isDirectory()) {
    if (process.platform !== 'win32') await chmod(root, 0o700).catch(() => undefined);
    const entries = await readdir(root).catch(() => []);
    for (const name of entries) await makeWritableTree(join(root, name));
    return;
  }
  await chmod(root, process.platform === 'win32' ? 0o666 : 0o600).catch(() => undefined);
}
