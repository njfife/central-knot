// Checks for the Windows CI helper (scripts/windows-check.mjs parseUnitLog), shared path helper (tests/wincompat.ts),
// and shared test lock cleanup (tests/fslock.ts).
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { test } from 'node:test';
import { parseUnitLog } from '../scripts/windows-check.mjs';
import { lockPath, lockSkip, makeWritableTree } from './fslock.ts';
import { slashPath } from './wincompat.ts';

test('parseUnitLog pulls totals, failing tests with their first error line, cancellations, skips with reasons, and combines strict and advisory logs', () => {
  const strict = [
    '✔ strict pass (2.0ms)',
    '﹣ strict skip (0.1ms) # Mac-only hdiutil',
    'ℹ tests 2',
    'ℹ suites 1',
    'ℹ pass 1',
    'ℹ fail 0',
    'ℹ cancelled 0',
    'ℹ skipped 1',
    'ℹ todo 0',
    'ℹ duration_ms 20.5',
  ].join('\r\n');
  const advisory = [
    '✔ passes (1.2ms)',
    '﹣ skipped one (0.1ms) # Locked folders on Windows are step 6',
    '✖ fails one (2.3ms)',
    'ℹ tests 4',
    'ℹ suites 1',
    'ℹ pass 1',
    'ℹ fail 1',
    'ℹ cancelled 1',
    'ℹ skipped 1',
    'ℹ todo 0',
    'ℹ duration_ms 10.5',
    '',
    '✖ failing tests:',
    '',
    'test at tests\\map.test.ts:76:1',
    '✖ fails one (2.3ms)',
    '  AssertionError [ERR_ASSERTION]:',
    '  scripts\\alpha-check.mjs has no entry',
    '      at TestContext.<anonymous>',
    '',
    'test at tests\\upgrade.test.ts:12:3',
    '✖ cancelled child',
    "  'test did not finish before its parent and was cancelled'",
  ].join('\r\n');
  const summary = parseUnitLog(advisory, 1, strict);
  assert.match(summary, /Advisory unit test exit: 1/);
  assert.match(summary, /ℹ tests 6/);
  assert.match(summary, /ℹ suites 2/);
  assert.match(summary, /ℹ pass 2/);
  assert.match(summary, /ℹ fail 1/);
  assert.match(summary, /ℹ cancelled 1/);
  assert.match(summary, /ℹ skipped 2/);
  assert.match(summary, /ℹ duration_ms 31\.0/);
  assert.match(summary, /- tests\/map\.test\.ts: 1 failed/);
  assert.match(summary, /- tests\/upgrade\.test\.ts: 0 failed, 1 cancelled/);
  assert.match(summary, /- tests\/map\.test\.ts:76:1 \| fails one :: AssertionError \[ERR_ASSERTION\]: scripts\\alpha-check\.mjs has no entry/);
  assert.match(summary, /- tests\/upgrade\.test\.ts:12:3 \| cancelled child/);
  assert.match(summary, /- strict skip \[Mac-only hdiutil\]/);
  assert.match(summary, /- skipped one \[Locked folders on Windows are step 6\]/);
  const cleanSection = summary.split('## Clean files')[1]!.split('## Failing tests')[0]!;
  assert.ok(!cleanSection.includes('tests/map.test.ts'));
  assert.ok(cleanSection.includes('tests/words.test.ts'));
});

test('slashPath replaces only the host native separator, keeping backslashes intact on POSIX', () => {
  assert.equal(slashPath(['a', 'b', 'c'].join(sep)), 'a/b/c');
  if (sep === '/') assert.equal(slashPath('folder/file\\name.md'), 'folder/file\\name.md');
});

test('makeWritableTree clears read-only files and locked folders while still locked so cleanup removes them without shelling out', async () => {
  const base = await mkdtemp(join(tmpdir(), 'ck-fslock-'));
  try {
    const nested = join(base, 'nested');
    await mkdir(nested, { recursive: true });
    const file = join(nested, 'note.txt');
    await writeFile(file, 'hello\n');
    await chmod(file, 0o444);
    // Keep the folder locked (without unlocking first) so makeWritableTree must restore permissions itself.
    if (!lockSkip) await lockPath(nested, 'dir-readonly');
    await makeWritableTree(base);
    await rm(base, { recursive: true, force: true });
    await assert.rejects(stat(base));
  } finally {
    await makeWritableTree(base);
    await rm(base, { recursive: true, force: true });
  }
});
