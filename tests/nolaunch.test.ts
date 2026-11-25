// Nothing is started once a stop is asked, on every platform: no taskkill for a child already seen to end (its process id may
// be another program's by then: launch.ts stopTree), no tool for a draft stopped before its tool starts (draftbase.ts
// writeDraft), and none for a sign-in check Quit stops while its folder is being made (mcpsigninrun.ts). What is started is
// seen by wrapping child_process's spawn, which every one of them uses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stopTree } from '../src/launch.ts';
import { draftPrompt, writeDraft, type DraftSources } from '../src/draftbase.ts';
import { checkSignin, stopChecks } from '../src/mcpsigninrun.ts';
import { standIn } from './standin.ts';

/** Every program started in this file, with its arguments. */
const started: string[] = [];
const spawnAsIs = childProcess.spawn;
childProcess.spawn = ((...args: Parameters<typeof spawnAsIs>) => {
  started.push([args[0], ...args[1]].join(' '));
  return spawnAsIs(...args);
}) as typeof spawnAsIs;
syncBuiltinESMExports();

/** A test's own folder, as os.tmpdir() for its length (TMPDIR; on Windows TEMP and TMP), so that what it leaves there is its own. */
async function sandbox() {
  const base = await fsp.realpath(await fsp.mkdtemp(join(tmpdir(), 'ck-nolaunch-')));
  const keys = process.platform === 'win32' ? ['TMPDIR', 'TEMP', 'TMP'] : ['TMPDIR'];
  const shared = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) process.env[key] = base;
  return { base, end: async () => {
    for (const [key, value] of Object.entries(shared)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    await fsp.rm(base, { recursive: true, force: true });
  } };
}

test('A child already seen to end gets no taskkill: its stop answers that the tree is not known to be gone, and nothing is started', async () => {
  const child = childProcess.spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await new Promise(done => child.once('exit', done));
  const before = started.length;
  assert.equal(await stopTree(child), false);
  assert.deepEqual(started.slice(before), []);
});

test('A draft stopped before its tool starts starts none, and leaves no folder', async () => {
  const box = await sandbox();
  try {
    const sources: DraftSources = { base: '', baseHash: '', files: [{ tool: 'claude-cli', path: join(box.base, 'CLAUDE.md'), hash: 'h', own: 'Be brief.\n' }] };
    const tool = await standIn(join(box.base, 'pi'), '#!/bin/sh\ncat > /dev/null\n', 'require("fs").readFileSync(0);');
    const stopped = new AbortController();
    stopped.abort();
    const before = started.length;
    assert.deepEqual(await writeDraft(sources, 'pi-cli', tool, { shown: draftPrompt(sources), signal: stopped.signal }), { cancelled: true });
    assert.deepEqual(started.slice(before), [], 'no tool was started');
    assert.deepEqual((await fsp.readdir(box.base)).filter(name => name.startsWith('central-knot-draft-')), [], 'its folder is gone');
  } finally { await box.end(); }
});

// Last in this file: Quit closes the door to new checks for the rest of the process, as it does for the app.
test('Quit while a sign-in check’s folder is being made: its tool is not started, and the folder goes', async () => {
  const box = await sandbox();
  const before = process.env.CK_TEST_HOME_ONLY, mkdtempAsIs = fsp.mkdtemp;
  process.env.CK_TEST_HOME_ONLY = 'claude';
  let made = '', quit: Promise<unknown> | undefined;
  // Quit comes while the check's folder is being made, after its command line was found.
  fsp.mkdtemp = (async (prefix: string) => {
    const folder = await mkdtempAsIs(prefix);
    if (prefix.includes('ck-mcp-signin-')) { made = folder; quit = stopChecks(); }
    return folder;
  }) as typeof fsp.mkdtemp;
  syncBuiltinESMExports();
  try {
    await standIn(join(box.base, 'tools/.local/bin/claude'), '#!/bin/sh\necho "{}"\n', 'process.stdout.write("{}\\n");');
    const startedBefore = started.length;
    assert.equal(await checkSignin({ home: join(box.base, 'home'), actual: false, toolsHome: join(box.base, 'tools'), searchPath: '' }, 'claude-cli', []), undefined);
    assert.ok(made && quit, 'Quit came while the folder was made');
    await quit;
    assert.deepEqual(started.slice(startedBefore), [], 'no tool was started');
    await assert.rejects(fsp.readdir(made), { code: 'ENOENT' }, 'its folder is gone');
  } finally {
    fsp.mkdtemp = mkdtempAsIs;
    syncBuiltinESMExports();
    if (before === undefined) delete process.env.CK_TEST_HOME_ONLY; else process.env.CK_TEST_HOME_ONLY = before;
    await box.end();
  }
});
