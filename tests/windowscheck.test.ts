// Checks for the Windows CI helper (scripts/windows-check.mjs parseUnitLog), shared path helper (tests/wincompat.ts),
// and shared test lock cleanup (tests/fslock.ts).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
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
  assert.ok(!summary.includes('## Not run'));
});

test('parseUnitLog reports advisory files under Not run (never Clean files) when strict emitted totals but advisory exited without totals', () => {
  const strict = [
    '✔ strict pass (1.0ms)',
    'ℹ tests 1',
    'ℹ suites 0',
    'ℹ pass 1',
    'ℹ fail 0',
    'ℹ cancelled 0',
    'ℹ skipped 0',
    'ℹ todo 0',
    'ℹ duration_ms 5.0',
  ].join('\n');
  const crashedAdvisory = 'Error: worker crashed before node --test printed totals\n';
  const summary = parseUnitLog(crashedAdvisory, 1, strict, ['tests/words.test.ts']);
  const cleanSection = summary.split('## Clean files (1 of ')[1]!.split('## Not run')[0]!;
  const notRunSection = summary.split('## Not run')[1]!;
  assert.ok(cleanSection.includes('tests/words.test.ts'));
  assert.ok(!cleanSection.includes('tests/skills.test.ts'));
  assert.ok(notRunSection.includes('tests/skills.test.ts'));
  assert.ok(!notRunSection.includes('tests/words.test.ts'));
  assert.match(summary, /## Output \(advisory, before node --test summary\)\nError: worker crashed/);
});

test('lockPath enforces each lock kind (dir-noremove on Windows, refused elsewhere), unlocks idempotently, rejects ENOENT if gone, and unlocks on child exit after throw', { skip: lockSkip }, async () => {
  const base = await mkdtemp(join(tmpdir(), 'ck-fslock-unlock-'));
  try {
    const roDir = join(base, 'ro');
    const roFile = join(roDir, 'existing.txt');
    await mkdir(roDir);
    await writeFile(roFile, 'before\n');
    const unlockRo = await lockPath(roDir, 'dir-readonly');
    await assert.rejects(writeFile(join(roDir, 'added.txt'), 'x'));
    await assert.rejects(rm(roFile));
    assert.deepEqual(await readdir(roDir), ['existing.txt']);
    assert.equal(await readFile(roFile, 'utf8'), 'before\n');
    await writeFile(roFile, 'after\n');
    assert.equal(await readFile(roFile, 'utf8'), 'after\n');
    await unlockRo();
    await unlockRo();
    await writeFile(join(roDir, 'added.txt'), 'ok\n');
    await rm(roFile);
    const noReadDir = join(base, 'noread');
    await mkdir(noReadDir);
    await writeFile(join(noReadDir, 'secret.txt'), 'hidden\n');
    const unlockNoRead = await lockPath(noReadDir, 'dir-unreadable');
    await assert.rejects(readdir(noReadDir));
    await assert.rejects(stat(join(noReadDir, 'secret.txt')));
    await unlockNoRead();
    assert.deepEqual(await readdir(noReadDir), ['secret.txt']);
    assert.equal(await readFile(join(noReadDir, 'secret.txt'), 'utf8'), 'hidden\n');
    const noListDir = join(base, 'nolist');
    await mkdir(noListDir);
    await writeFile(join(noListDir, 'known.txt'), 'known\n');
    const unlockNoList = await lockPath(noListDir, 'dir-unlistable');
    await assert.rejects(readdir(noListDir));
    await assert.rejects(writeFile(join(noListDir, 'new.txt'), 'x'));
    assert.equal(await readFile(join(noListDir, 'known.txt'), 'utf8'), 'known\n');
    await unlockNoList();
    assert.deepEqual(await readdir(noListDir), ['known.txt']);
    if (process.platform === 'win32') {
      const unlockNoRemove = await lockPath(noListDir, 'dir-noremove');
      await writeFile(join(noListDir, 'new.txt'), 'new\n');
      await assert.rejects(rm(join(noListDir, 'known.txt')));
      await unlockNoRemove();
      await rm(join(noListDir, 'known.txt'));
    } else await assert.rejects(lockPath(noListDir, 'dir-noremove'), /Windows lock only/);
    const okFile = join(base, 'ok.txt');
    await writeFile(okFile, 'ok\n');
    const unlockOk = await lockPath(okFile, 'file-unreadable');
    await assert.rejects(readFile(okFile, 'utf8'));
    await unlockOk();
    await unlockOk();
    assert.equal(await readFile(okFile, 'utf8'), 'ok\n');
    const goneFile = join(base, 'gone.txt');
    await writeFile(goneFile, 'gone\n');
    const unlockGone = await lockPath(goneFile, 'file-unreadable');
    await rm(goneFile);
    await assert.rejects(unlockGone(), { code: 'ENOENT' });
    const crashDir = join(base, 'crash');
    await mkdir(crashDir);
    const childEnv: NodeJS.ProcessEnv = { ...process.env, CK_LOCK_TARGET: crashDir };
    delete childEnv.NODE_TEST_CONTEXT;
    const script = `import { lockPath } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, 'fslock.ts')).href)}; await lockPath(process.env.CK_LOCK_TARGET, 'dir-readonly'); throw new Error('boom');`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: childEnv, encoding: 'utf8' });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /Error: boom/);
    await writeFile(join(crashDir, 'after-crash.txt'), 'unlocked\n');
  } finally {
    await makeWritableTree(base);
    await rm(base, { recursive: true, force: true });
  }
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
