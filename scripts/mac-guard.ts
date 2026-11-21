// The Mac run's check before npm ci (.github/workflows/mac.yml). The Mac is its owner's own computer, so a run waits while it
// is short of memory, swap or disk, reading it again each minute, and after WAIT_MINUTES fails with one line naming the limit
// and the number: no fault of the change. Once there is room it says the figures it read. The limits are here only; a figure
// that can't be read, its command's failure included, is said as unread and holds no run back. Usage: node scripts/mac-guard.ts
import { execFileSync } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

/** Spotlight's indexer (mds) at most 4 GB of memory, at most 8 GB of swap used, at least 30 GB of disk free. */
export const LIMITS = { mdsGB: 4, swapUsedGB: 8, freeDiskGB: 30 }, WAIT_MINUTES = 10;
type Reading = { mdsGB: number; swapUsedGB: number; swapTotalGB: number; freeDiskGB: number };

/** What a reading is short of, in words, or undefined when it is within every limit. */
export const short = (r: Reading) => [
  r.mdsGB > LIMITS.mdsGB && `Spotlight’s indexer (mds) uses ${r.mdsGB.toFixed(1)} GB of memory, above ${LIMITS.mdsGB} GB`,
  r.swapUsedGB > LIMITS.swapUsedGB && `${r.swapUsedGB.toFixed(1)} of ${r.swapTotalGB.toFixed(1)} GB of swap used, above ${LIMITS.swapUsedGB} GB`,
  r.freeDiskGB < LIMITS.freeDiskGB && `${r.freeDiskGB.toFixed(1)} GB of disk free, below ${LIMITS.freeDiskGB} GB`,
].filter(Boolean).join('; ') || undefined;

/** The reading in words, each figure in GB or `unread`: `mds 0.0 GB, swap used 1.7 GB of 3.0 GB, disk free 331.0 GB`. */
export const figures = (r: Reading) => {
  const gb = (figure: number) => (Number.isNaN(figure) ? 'unread' : `${figure.toFixed(1)} GB`);
  return `mds ${gb(r.mdsGB)}, swap used ${gb(r.swapUsedGB)} of ${gb(r.swapTotalGB)}, disk free ${gb(r.freeDiskGB)}`;
};

/** The Mac's reading now: top's MEM column (it counts what is compressed), sysctl's swap, df where the run is. Undefined off a Mac. */
export function readMac(platform = process.platform, run = (command: string, args: string[]) => execFileSync(command, args, { encoding: 'utf8' })): Reading | undefined {
  if (platform !== 'darwin') return undefined;
  const printed = (command: string, args: string[]) => { try { return run(command, args); } catch { return ''; } };
  const inGB = (figure?: string, unit?: string) => (figure && unit ? Number(figure) * 1024 ** ('KMGT'.indexOf(unit) - 2) : NaN);
  const mds = /^\s*([\d.]+)([KMGT])\S*[ \t]+mds[ \t]*$/m.exec(printed('top', ['-l', '1', '-stats', 'mem,command']));
  const swap = printed('sysctl', ['-n', 'vm.swapusage']), swapGB = (name: string) => inGB(...(new RegExp(`${name} = ([\\d.]+)([KMGT])`).exec(swap)?.slice(1) ?? []));
  const freeKB = Number(printed('df', ['-Pk', '.']).trim().split('\n').at(-1)?.split(/\s+/)[3]);
  return { mdsGB: inGB(mds?.[1], mds?.[2]), swapUsedGB: swapGB('used'), swapTotalGB: swapGB('total'), freeDiskGB: freeKB / 1024 ** 2 };
}

/** Resolves undefined once the Mac has room, or, after WAIT_MINUTES more readings short of it, the line the run fails with. */
export async function roomToRun(read: () => Reading | undefined = readMac, minute = () => wait(60_000)) {
  for (let waited = 0; ; waited++) {
    const reading = read(), said = reading && short(reading);
    if (!said) { if (reading) console.log(`The Mac has room for the checks: ${figures(reading)}.`); return undefined; }
    if (waited === WAIT_MINUTES) return `The Mac is short of room for the checks, still after ${WAIT_MINUTES} minutes (not a fault of the change): ${said}.`;
    console.log(`The Mac is short of room (${said}): reading it again in a minute.`);
    await minute();
  }
}

if (process.argv[1] === import.meta.filename) {
  const failed = await roomToRun();
  if (failed || process.platform !== 'darwin') console.log(failed ? `::error::${failed}` : 'Not a Mac: nothing to read.');
  process.exitCode = failed ? 1 : 0;
}
