// A script's throwaway folder in the system's temporary folder (TMPDIR; the Mac run gives it one of its own, mac.yml), and
// what it started that must not outlive it. However the script ends but by SIGKILL (an ordinary end, process.exit, an uncaught
// error, or a signal it turns into process.exit(130)), what it started is killed, then the folder is removed. Used by
// scripts/e2e.mjs, ui-tour.mjs, alpha-check.mjs and bundled-check.mjs; each says what a signal does there.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Every app and stand-in a script started: each is killed as the script ends, with every process under it. */
export const launched = new Set();

/** These processes and every one under them, from ps: an app's helpers (on Linux some under its zygote), which would write on. */
function withAllUnder(pids) {
  const rows = spawnSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' }).stdout.trim().split('\n').map(row => row.trim().split(/\s+/).map(Number));
  for (let at = 0; at < pids.length; at++) pids.push(...rows.filter(([, parent]) => parent === pids[at]).map(([pid]) => pid));
  return pids;
}

/** Makes `<TMPDIR>/<prefix>XXXXXX` (its real path), removed with all in it as the script ends. */
export function scratchFolder(prefix) {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  process.on('exit', () => {
    // Only those still running (an ended one's pid may be another's now), all listed before any is killed: a killed app's
    // helpers would be moved from under it.
    const running = [...launched].filter(child => child.exitCode === null && child.signalCode === null).map(child => child.pid);
    for (const pid of withAllUnder(running)) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
    // A flow may have left a folder unreadable.
    spawnSync('chmod', ['-R', 'u+rwx', folder]);
    try { rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (error) { console.error(`Could not remove ${folder}: ${error.message}`); }
  });
  return folder;
}

/** An app's temporary places: Node reads TMPDIR, and Chromium on a Mac reads MAC_CHROMIUM_TMPDIR in its place (its scoped_dir folders). */
export const tempPlaces = folder => ({ TMPDIR: folder, MAC_CHROMIUM_TMPDIR: folder });
