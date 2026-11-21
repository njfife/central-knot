// The Mac run's guard (scripts/mac-guard.ts): given the Mac's readings, a run goes, or waits a minute at a time and then fails
// in one line naming the limit and the number. The readings are made up, as top, sysctl and df print them on a Mac.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMac, roomToRun, short, WAIT_MINUTES } from '../scripts/mac-guard.ts';

const roomy = { mdsGB: 0.04, swapUsedGB: 1.7, swapTotalGB: 3, freeDiskGB: 331 };
/** The guard over one reading a minute (the last one repeated): what it came to, and the minutes it waited. */
async function guarded(...readings: (typeof roomy | undefined)[]) {
  let minutes = 0;
  const came = await roomToRun(() => readings[Math.min(minutes, readings.length - 1)], async () => { minutes++; });
  return { came, minutes };
}

test('Spotlight’s indexer at 69 GB, or swap 58 of 59 GB used: the run waits ten minutes, then fails saying which limit and the number', async () => {
  const fails = (said: string) => ({ came: `The Mac is short of room for the checks, still after 10 minutes (not a fault of the change): ${said}.`, minutes: WAIT_MINUTES });
  assert.deepEqual(await guarded({ ...roomy, mdsGB: 69 }), fails('Spotlight’s indexer (mds) uses 69.0 GB of memory, above 4 GB'));
  assert.deepEqual(await guarded({ ...roomy, swapUsedGB: 58, swapTotalGB: 59 }), fails('58.0 of 59.0 GB of swap used, above 8 GB'));
});

test('Within every limit the run goes at once, and a short one goes the minute it is not; off a Mac nothing is read and it goes', async () => {
  assert.deepEqual(await guarded(roomy), { came: undefined, minutes: 0 });
  assert.deepEqual(await guarded({ ...roomy, freeDiskGB: 12 }, { ...roomy, freeDiskGB: 12 }, roomy), { came: undefined, minutes: 2 });
  assert.deepEqual(await guarded(readMac('linux', () => { throw new Error('read off a Mac'); })), { came: undefined, minutes: 0 });
});

test('Each limit is where it says: at it the run goes, one past it the limit is named', () => {
  const at = { mdsGB: 4, swapUsedGB: 8, swapTotalGB: 59, freeDiskGB: 30 };
  assert.deepEqual([short(at), short({ ...at, mdsGB: 4.1 }), short({ ...at, swapUsedGB: 8.1 }), short({ ...at, freeDiskGB: 29.9 })],
    [undefined, 'Spotlight’s indexer (mds) uses 4.1 GB of memory, above 4 GB', '8.1 of 59.0 GB of swap used, above 8 GB', '29.9 GB of disk free, below 30 GB']);
});

test('On a Mac the readings come from top’s memory column, sysctl’s swap and df’s free blocks; one that can’t be read holds nothing back', () => {
  const printed: Record<string, string> = {
    top: 'Processes: 702 total\n\nMEM    COMMAND\n1280M+ WindowServer\n69G    mds\n17M    mds_stores\n',
    sysctl: 'total = 60416.00M  used = 59392.00M  free = 1024.00M  (encrypted)\n',
    df: 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3s5 971350180 586314652 347075384 63% /System/Volumes/Data\n',
  };
  const reading = readMac('darwin', command => printed[command]);
  assert.deepEqual(reading && { ...reading, freeDiskGB: Math.round(reading.freeDiskGB) }, { mdsGB: 69, swapUsedGB: 58, swapTotalGB: 59, freeDiskGB: 331 });
  assert.equal(short(readMac('darwin', () => 'nothing it knows')!), undefined);
});
