// Checks for the Windows CI helper (scripts/windows-check.mjs parseUnitLog) and the shared test lock helper (tests/fslock.ts).
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseUnitLog } from '../scripts/windows-check.mjs';
import { lockSkip, makeWritableTree, withLock } from './fslock.ts';

test('parseUnitLog pulls totals, failing tests with their first error line, cancellations, skips with reasons, and clean files', () => {
  const raw = [
    '✔ passes (1.2ms)',
    '﹣ skipped one (0.1ms) # Mac-only hdiutil',
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
  const summary = parseUnitLog(raw, 1);
  assert.match(summary, /Advisory npm test exit: 1/);
  assert.match(summary, /ℹ tests 4/);
  assert.match(summary, /- tests\/map\.test\.ts: 1 failed/);
  assert.match(summary, /- tests\/upgrade\.test\.ts: 0 failed, 1 cancelled/);
  assert.match(summary, /- tests\/map\.test\.ts:76:1 \| fails one :: AssertionError \[ERR_ASSERTION\]: scripts\\alpha-check\.mjs has no entry/);
  assert.match(summary, /- tests\/upgrade\.test\.ts:12:3 \| cancelled child/);
  assert.match(summary, /- skipped one \[Mac-only hdiutil\]/);
  const cleanSection = summary.split('## Clean files')[1]!.split('## Failing tests')[0]!;
  assert.ok(!cleanSection.includes('tests/map.test.ts'));
  assert.ok(cleanSection.includes('tests/words.test.ts'));
});

test('makeWritableTree clears read-only files and locked folders so cleanup removes them without shelling out', async () => {
  const base = await mkdtemp(join(tmpdir(), 'ck-fslock-'));
  try {
    const nested = join(base, 'nested');
    await mkdir(nested, { recursive: true });
    const file = join(nested, 'note.txt');
    await writeFile(file, 'hello\n');
    if (!lockSkip) {
      await withLock(nested, 'dir-readonly', async () => {
        assert.equal((await stat(nested)).mode & 0o777, 0o555);
      });
      assert.equal((await stat(nested)).mode & 0o777, 0o755);
    }
    await makeWritableTree(base);
    await rm(base, { recursive: true, force: true });
    await assert.rejects(stat(base));
  } finally {
    await makeWritableTree(base);
    await rm(base, { recursive: true, force: true });
  }
});
