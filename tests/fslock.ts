// Shared file and folder permission locks for unit tests (POSIX chmod on macOS/Linux; Windows icacls ACL denials on
// win32), with automatic cleanup on process exit and—when running under the Node test runner (`NODE_TEST_CONTEXT`)—in
// `after`, plus `makeWritableTree` to unlock recorded paths and clear read-only attributes without shelling out to
// `chmod`. A killed process keeps its locks. Does not cover scripts/e2e.mjs's own `chmodSync` calls (step 8).
import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';
import { chmod, lstat, readdir, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { after } from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Skip value on macOS and Linux when running as root (root bypasses permission locks); false on Windows. */
export const lockSkip: string | false = process.getuid?.() === 0 && 'root bypasses file and folder permission locks';

/** Skip value on Windows while the app's own locked-folder checks (fs.access W_OK / EACCES-only) are fixed in step 6B. */
export const winLockAppSkip: string | false = process.platform === 'win32'
  && 'App locked-folder checks on Windows are step 6B; covered on macOS and Linux.';

/** Skip value on POSIX as root or on Windows for step 6B app locked-folder gaps. */
export const lockAppSkip: string | false = lockSkip || winLockAppSkip;

export type LockKind = 'dir-readonly' | 'dir-unreadable' | 'dir-unlistable' | 'file-unreadable';

// Specific Windows rights only (never simple `W` or `D`, which include SYNCHRONIZE and break ordinary opens):
// dir-readonly blocks create/delete/rename in or out while listing and file rewrites still work;
// dir-unreadable denies listing/writes; nothing denies traversal on Windows, so the inherited deny stands in for it and blocks existing children from being stat'ed or read;
// dir-unlistable (POSIX 0o111) blocks listing and adding entries while known child paths stay readable (on Windows a known child can still be removed or moved out);
// file-unreadable denies read/write while stat (RA) and parent-permitted unlink still work.
const WIN_DENY: Record<LockKind, readonly string[]> = {
  'dir-readonly': ['(WD,AD,DC)', '(OI)(CI)(NP)(IO)(DE)'],
  'dir-unreadable': ['(RD,WD,AD,DC)', '(OI)(CI)(IO)(RD,RA,WD,AD,DE)'],
  'dir-unlistable': ['(RD,WD,AD,DC)'],
  'file-unreadable': ['(RD,WD,AD)'],
};

type HeldLock = { path: string; key: string; restored: number };
const heldLocks = new Set<HeldLock>();
let cachedSid: string | undefined;

const norm = (path: string) => (process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path));
const inside = (path: string, root: string) => path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
const runIcacls = (args: string[]) => execFileAsync('icacls', args, { windowsHide: true });
const shallowFirst = () => [...heldLocks].sort((a, b) => a.path.length - b.path.length);

function currentSid(): string {
  if (cachedSid) return cachedSid;
  const out = execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
  const match = /"(S-1-\d+(?:-\d+)+)"/.exec(out);
  if (!match) throw new Error(`Could not read Windows user SID from whoami: ${out.trim()}`);
  return (cachedSid = match[1]!);
}

// On Windows, /remove:d removes every deny ACE for this user on the path, not only the helper's (assumes a fresh temp folder).
// An entry leaves `heldLocks` only once its unlock succeeds or the path is confirmed gone (ENOENT), so a transient failure can still be retried.
async function releaseLock(entry: HeldLock): Promise<void> {
  if (!heldLocks.has(entry)) return;
  try {
    if (process.platform === 'win32') {
      const err = await lstat(entry.path).then(() => undefined, error => error as NodeJS.ErrnoException);
      if (err?.code === 'ENOENT') throw err;
      await runIcacls([entry.path, '/remove:d', `*${currentSid()}`]);
    } else {
      await chmod(entry.path, entry.restored);
    }
    heldLocks.delete(entry);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') heldLocks.delete(entry);
    throw error;
  }
}

function releaseLockSync(entry: HeldLock): void {
  if (!heldLocks.has(entry)) return;
  try {
    if (process.platform === 'win32') {
      if (existsSync(entry.path)) execFileSync('icacls', [entry.path, '/remove:d', `*${currentSid()}`], { windowsHide: true, stdio: 'ignore' });
    } else chmodSync(entry.path, entry.restored);
    heldLocks.delete(entry);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') heldLocks.delete(entry);
  }
}

process.on('exit', () => { for (const entry of shallowFirst()) releaseLockSync(entry); });
if (process.env.NODE_TEST_CONTEXT) after(async () => { for (const entry of shallowFirst()) await releaseLock(entry).catch(() => undefined); });

/**
 * Locks `path` (read-only folder, unreadable folder, unlistable folder, or unreadable file) and returns an idempotent
 * unlock function. Recorded locks are also released in `after` (under the test runner) and synchronously on exit.
 */
export async function lockPath(path: string, kind: LockKind): Promise<() => Promise<void>> {
  const target = process.platform === 'win32' ? resolve(path) : path;
  const locked = kind === 'dir-readonly' ? 0o555 : kind === 'dir-unlistable' ? 0o111 : 0o000;
  const restored = kind === 'file-unreadable' ? 0o644 : 0o755;
  // Canonicalize the parent so Windows 8.3 short paths (e.g. RUNNER~1) match realpathed roots in makeWritableTree.
  const parent = await realpath(dirname(resolve(path))).catch(() => dirname(resolve(path)));
  const key = norm(join(parent, basename(resolve(path))));
  if (process.platform === 'win32') {
    await lstat(target);
    const sid = currentSid();
    await runIcacls([target, ...WIN_DENY[kind].flatMap(rights => ['/deny', `*${sid}:${rights}`])]);
  } else {
    await chmod(target, locked);
  }
  const entry: HeldLock = { path: target, key, restored };
  heldLocks.add(entry);
  return () => releaseLock(entry);
}

/** Runs `work` with `path` locked and restores its permissions in `finally`. */
export async function withLock<T>(path: string, kind: LockKind, work: () => Promise<T>): Promise<T> {
  const unlock = await lockPath(path, kind);
  try { return await work(); } finally { await unlock(); }
}

/**
 * Unlocks any recorded locks under `root` and restores owner write/read/traverse permissions across a temp tree without
 * shelling out to `chmod` or `icacls /reset /T`, so `rm` succeeds after a test leaves read-only files or locked folders
 * behind. Never follows symlinks.
 */
export async function makeWritableTree(root: string): Promise<void> {
  const roots = [norm(root), norm(await realpath(root).catch(() => resolve(root)))];
  for (const entry of shallowFirst()) {
    if (roots.some(base => inside(entry.key, base))) await releaseLock(entry).catch(() => undefined);
  }
  const walk = async (at: string): Promise<void> => {
    const info = await lstat(at).catch(() => undefined);
    if (!info || info.isSymbolicLink()) return;
    if (info.isDirectory()) {
      if (process.platform !== 'win32') await chmod(at, 0o700).catch(() => undefined);
      const entries = await readdir(at).catch(() => []);
      for (const name of entries) await walk(join(at, name));
      return;
    }
    await chmod(at, process.platform === 'win32' ? 0o666 : 0o600).catch(() => undefined);
  };
  await walk(root);
}
