// The one answer to "can this folder be written?" (share.ts folderAccess) and a refusal read as a denial (share.ts denied),
// as worked examples: off Windows the answer is access itself; on Windows the folder itself opened for writing and closed,
// once a folder a pass, leaving nothing behind and waking no watcher.
import assert from 'node:assert/strict';
import { constants, watch } from 'node:fs';
import fsp, { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { mock, test } from 'node:test';
import { denied, folderAccess } from '../src/share.ts';
import { lockPath, lockSkip, makeWritableTree, withLock } from './fslock.ts';
import { pass, put, roots, sandbox, turnOn } from './skillclicks.ts';

const windowsOnly = process.platform !== 'win32' && 'The Windows way only.';
const outcome = (done: Promise<unknown>) => done.then(() => 'ok', (error: NodeJS.ErrnoException) => error.code ?? String(error));
const pause = (ms: number) => new Promise(done => setTimeout(done, ms));

async function inBase(work: (folder: string) => Promise<void>) {
  const base = await mkdtemp(join(tmpdir(), 'ck-folderaccess-')), folder = join(base, 'skills');
  await mkdir(folder);
  try { await work(folder); } finally { await makeWritableTree(base); await rm(base, { recursive: true, force: true }); }
}

test('On Windows a folder that can be written opens for writing; under a read-only or unreadable lock it is refused; unlocked, it opens again; nothing is made in it', { skip: windowsOnly }, () => inBase(async folder => {
  const ask = () => outcome(folderAccess({}, folder, constants.W_OK));
  const before = await ask();
  const unlock = await lockPath(folder, 'dir-readonly');
  const locked = await ask();
  await unlock();
  const unreadable = await withLock(folder, 'dir-unreadable', ask);
  assert.deepEqual([before, locked, await ask(), unreadable], ['ok', 'EPERM', 'ok', 'EPERM']);
  assert.deepEqual(await readdir(folder), []);
}));

test('On Windows a folder that takes a new file but refuses a removal can be written: the removal itself says it failed', { skip: windowsOnly }, () => inBase(async folder => {
  await writeFile(join(folder, 'old.txt'), 'old\n');
  await withLock(folder, 'dir-noremove', async () => {
    assert.equal(await outcome(folderAccess({}, folder, constants.W_OK)), 'ok');
    assert.notEqual(await outcome(rm(join(folder, 'old.txt'))), 'ok');
  });
}));

test('Off Windows the answer is access itself: the caller’s mode, its error, asked every time', { skip: process.platform === 'win32' ? 'Off Windows only.' : lockSkip }, () => inBase(async folder => {
  const reads = new Map<string, Promise<unknown>>();
  const both = (mode: number) => Promise.all([outcome(folderAccess({ reads }, folder, mode)), outcome(access(folder, mode))]);
  assert.deepEqual(await both(constants.W_OK | constants.X_OK), ['ok', 'ok']);
  await withLock(folder, 'dir-readonly', async () => {
    assert.deepEqual(await both(constants.W_OK), ['EACCES', 'EACCES'], 'asked again once locked: nothing kept from the first ask');
    assert.deepEqual(await both(constants.R_OK | constants.X_OK), ['ok', 'ok']);
  });
  await withLock(folder, 'dir-unlistable', async () => {
    assert.deepEqual(await both(constants.X_OK), ['ok', 'ok']);
    assert.deepEqual(await both(constants.W_OK | constants.X_OK), ['EACCES', 'EACCES']);
  });
  assert.deepEqual(await Promise.all([outcome(folderAccess({}, join(folder, 'gone'), constants.W_OK)), outcome(access(join(folder, 'gone'), constants.W_OK))]), ['ENOENT', 'ENOENT']);
  assert.equal(reads.size, 0);
}));

test('A refusal is a denial of permission by its code: EACCES everywhere, EPERM on Windows only', () => {
  const said = (code: string | undefined) => (['darwin', 'linux', 'win32'] as const).map(platform => denied(code ? { code } : new Error('no code'), platform));
  assert.deepEqual(said('EACCES'), [true, true, true]);
  assert.deepEqual(said('EPERM'), [false, false, true]);
  assert.deepEqual(said('ENOENT'), [false, false, false]);
  assert.deepEqual(said(undefined), [false, false, false]);
});

test('On Windows a hundred passes over four tools open each folder once a pass at most and leave every tool’s folder as it was', { skip: windowsOnly }, async () => {
  const box = await sandbox(['claude-cli', 'copilot-cli', 'codex-cli', 'opencode-cli']);
  const opened: string[] = [], open = fsp.open;
  const toolFolders = box.tools.map(tool => dirname(join(box.home, roots[tool as keyof typeof roots])));
  const entries = () => Promise.all(toolFolders.map(folder => readdir(folder, { recursive: true }).then(names => names.sort())));
  let before: string[][] = [];
  try {
    await put(box, 'claude-cli');
    await turnOn(box);
    before = await entries();
    mock.method(fsp, 'open', (path: string, flags: unknown, ...rest: []) => { if (flags === constants.O_WRONLY) opened.push(path); return open(path, flags as number, ...rest); });
    syncBuiltinESMExports();
    for (let at = 0; at < 100; at++) {
      opened.length = 0;
      await pass(box);
      assert.ok(opened.length >= box.tools.length, `pass ${at}: each tool’s skills folder is asked about`);
      assert.equal(new Set(opened).size, opened.length, `pass ${at}: ${opened.join(', ')}`);
    }
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
  }
  try { assert.deepEqual(await entries(), before); } finally { await box.cleanup(); }
});

test('On Windows the opens wake no watcher, the tool’s own or the folder above, nested folders included; a real entry does', { skip: windowsOnly }, () => inBase(async skills => {
  const nested = join(skills, 'notes', 'scripts'), events: string[] = [];
  await mkdir(nested, { recursive: true });
  const watchers = [watch(skills, { recursive: true }, (event, name) => events.push(`${event} ${name}`)), watch(dirname(skills), (event, name) => events.push(`${event} ${name}`))];
  try {
    // What the watches' own start brings in (a folder's last access, on a disk that keeps it) is not the opens': it settles first.
    await pause(1000);
    events.length = 0;
    for (let at = 0; at < 100; at++) for (const folder of [skills, join(skills, 'notes'), nested]) await folderAccess({}, folder, constants.W_OK);
    await pause(1000);
    assert.equal(events.length, 0, events.join(', '));
    await writeFile(join(nested, 'real.txt'), 'real\n');
    for (let wait = 0; wait < 40 && !events.length; wait++) await pause(50);
    assert.ok(events.some(event => event.includes('real.txt')), events.join(', '));
  } finally { for (const watcher of watchers) watcher.close(); }
}));
