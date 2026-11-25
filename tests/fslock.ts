// Shared file and folder permission locks for unit tests (POSIX chmod on macOS/Linux; Windows icacls ACL denials on
// win32), with automatic cleanup in `after` and on process exit so a failing test leaves no locked temp path behind,
// plus `makeWritableTree` to unlock recorded paths and clear read-only attributes without shelling out to `chmod`.
// Does not cover scripts/e2e.mjs's own `chmodSync` calls (step 8).
import { execFile, execFileSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import { chmod, lstat, readdir, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { after } from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Skip value on macOS and Linux when running as root (root bypasses permission locks); false on Windows. */
export const lockSkip: string | false = process.getuid?.() === 0 && 'root bypasses file and folder permission locks';

export type LockKind = 'dir-readonly' | 'dir-unreadable' | 'dir-unlistable' | 'file-unreadable';

// Specific Windows rights only (never simple `W`, which includes SYNCHRONIZE and breaks ordinary opens):
// dir-readonly blocks create/delete/rename in or out while listing and file rewrites still work;
// dir-unreadable denies listing/writes and uses inherited deny in place of traversal so children cannot be stat'ed;
// dir-unlistable (POSIX 0o111) blocks listing/writes while known child paths stay readable;
// file-unreadable denies read/write while stat (RA) and parent-permitted unlink still work.
const WIN_DENY: Record<LockKind, readonly string[]> = {
  'dir-readonly': ['(WD,AD,DC)', '(OI)(CI)(NP)(IO)(D)'],
  'dir-unreadable': ['(RD,WD,AD,DC)', '(OI)(CI)(IO)(RD,RA,WD,AD,D)'],
  'dir-unlistable': ['(RD,WD,AD,DC)'],
  'file-unreadable': ['(RD,WD,AD)'],
};

type HeldLock = { path: string; key: string; restored: number; unlocked: boolean };
const heldLocks = new Set<HeldLock>();
let cachedSid: string | undefined;

const norm = (path: string) => (process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path));
const inside = (path: string, root: string) => path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
const runIcacls = (args: string[]) => execFileAsync('icacls', args, { windowsHide: true });

function currentSid(): string {
  if (cachedSid) return cachedSid;
  const out = execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
  const match = /"(S-1-\d+(?:-\d+)+)"/.exec(out);
  if (!match) throw new Error(`Could not read Windows user SID from whoami: ${out.trim()}`);
  return (cachedSid = match[1]!);
}

function unlockRemaining(): void {
  for (const entry of [...heldLocks].sort((a, b) => a.path.length - b.path.length)) {
    try {
      if (process.platform === 'win32') execFileSync('icacls', [entry.path, '/remove:d', `*${currentSid()}`], { windowsHide: true, stdio: 'ignore' });
      else chmodSync(entry.path, entry.restored);
    } catch { /* best-effort teardown cleanup */ }
    entry.unlocked = true;
    heldLocks.delete(entry);
  }
}

process.on('exit', unlockRemaining);
if (process.env.NODE_TEST_CONTEXT) after(unlockRemaining);

/**
 * Locks `path` (read-only folder, unreadable folder, unlistable folder, or unreadable file) and returns an idempotent
 * unlock function. Recorded locks are also released when the test file ends (`after`) and on process exit.
 */
export async function lockPath(path: string, kind: LockKind): Promise<() => Promise<void>> {
  const target = process.platform === 'win32' ? resolve(path) : path;
  const locked = kind === 'dir-readonly' ? 0o555 : kind === 'dir-unlistable' ? 0o111 : 0o000;
  const restored = kind === 'file-unreadable' ? 0o644 : 0o755;
  const parent = await realpath(dirname(resolve(path))).catch(() => dirname(resolve(path)));
  const key = norm(join(parent, basename(resolve(path))));
  if (process.platform === 'win32') {
    await lstat(target);
    const sid = currentSid();
    await runIcacls([target, ...WIN_DENY[kind].flatMap(rights => ['/deny', `*${sid}:${rights}`])]);
  } else {
    await chmod(target, locked);
  }
  const entry: HeldLock = { path: target, key, restored, unlocked: false };
  heldLocks.add(entry);
  return async () => {
    if (entry.unlocked) return;
    try {
      if (process.platform === 'win32') {
        const err = await lstat(target).then(() => undefined, error => error as NodeJS.ErrnoException);
        if (err?.code === 'ENOENT') throw err;
        await runIcacls([target, '/remove:d', `*${currentSid()}`]);
      } else {
        await chmod(target, restored);
      }
      entry.unlocked = true;
      heldLocks.delete(entry);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') heldLocks.delete(entry);
      throw error;
    }
  };
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
export async function makeWritableTree(root: string, top = true): Promise<void> {
  if (top) {
    const roots = [norm(root), norm(await realpath(root).catch(() => resolve(root)))];
    for (const entry of [...heldLocks].sort((a, b) => a.path.length - b.path.length)) {
      if (!roots.some(base => inside(entry.key, base))) continue;
      if (process.platform === 'win32') await runIcacls([entry.path, '/remove:d', `*${currentSid()}`]).catch(() => undefined);
      entry.unlocked = true;
      heldLocks.delete(entry);
    }
  }
  const info = await lstat(root).catch(() => undefined);
  if (!info || info.isSymbolicLink()) return;
  if (info.isDirectory()) {
    if (process.platform !== 'win32') await chmod(root, 0o700).catch(() => undefined);
    const entries = await readdir(root).catch(() => []);
    for (const name of entries) await makeWritableTree(join(root, name), false);
    return;
  }
  await chmod(root, process.platform === 'win32' ? 0o666 : 0o600).catch(() => undefined);
}
