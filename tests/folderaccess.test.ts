// How Windows answers "can this folder be written?" when the folder itself is opened for writing and closed (the way
// share.ts's one answer takes on Windows), measured before anything is built on it.
import assert from 'node:assert/strict';
import { constants, watch } from 'node:fs';
import { chmod, mkdir, mkdtemp, open, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { lockPath, makeWritableTree, withLock } from './fslock.ts';

const windowsOnly = process.platform !== 'win32' && 'The Windows way only.';
const openForWriting = async (folder: string) => { await (await open(folder, constants.O_WRONLY)).close(); };
const outcome = (done: Promise<unknown>) => done.then(() => 'ok', (error: NodeJS.ErrnoException) => error.code ?? String(error));
const pause = (ms: number) => new Promise(done => setTimeout(done, ms));

async function inBase(work: (base: string) => Promise<void>) {
  const base = await mkdtemp(join(tmpdir(), 'ck-folderaccess-'));
  try { await work(base); } finally { await makeWritableTree(base); await rm(base, { recursive: true, force: true }); }
}

test('An empty folder opens for writing; under a read-only lock it is refused; once unlocked it opens again; nothing is made in it', { skip: windowsOnly }, () => inBase(async base => {
  const folder = join(base, 'skills');
  await mkdir(folder);
  const before = await outcome(openForWriting(folder));
  const unlock = await lockPath(folder, 'dir-readonly');
  const locked = await outcome(openForWriting(folder));
  await unlock();
  const after = await outcome(openForWriting(folder));
  const unreadable = await withLock(folder, 'dir-unreadable', () => outcome(openForWriting(folder)));
  const unlistable = await withLock(folder, 'dir-unlistable', () => outcome(openForWriting(folder)));
  console.log(`measured: open O_WRONLY before ${before}, dir-readonly ${locked}, after ${after}, dir-unreadable ${unreadable}, dir-unlistable ${unlistable}`);
  assert.deepEqual([before, locked, after], ['ok', 'EPERM', 'ok']);
  assert.deepEqual(await readdir(folder), []);
}));

test('A folder that takes a new file but refuses a removal opens for writing', { skip: windowsOnly }, () => inBase(async base => {
  const folder = join(base, 'skills');
  await mkdir(folder);
  await writeFile(join(folder, 'old.txt'), 'old\n');
  const [opened, made, removed] = await withLock(folder, 'dir-noremove', async () =>
    [await outcome(openForWriting(folder)), await outcome(writeFile(join(folder, 'new.txt'), 'new\n')), await outcome(rm(join(folder, 'old.txt')))]);
  console.log(`measured: dir-noremove open ${opened}, new file ${made}, removal ${removed}`);
  assert.deepEqual([opened, made], ['ok', 'ok']);
  assert.notEqual(removed, 'ok');
}));

test('A folder with the read-only attribute (chmod 0o555 on Windows)', { skip: windowsOnly }, () => inBase(async base => {
  const folder = join(base, 'skills');
  await mkdir(folder);
  await chmod(folder, 0o555);
  const opened = await outcome(openForWriting(folder));
  const made = await outcome(writeFile(join(folder, 'new.txt'), 'new\n'));
  await chmod(folder, 0o755);
  console.log(`measured: read-only attribute open ${opened}, new file ${made}`);
}));

test('Opening folders for writing gives a recursive watch, and one on the folder above, no event; a real entry gives one', { skip: windowsOnly }, () => inBase(async base => {
  const tool = join(base, '.codex'), skills = join(tool, 'skills'), nested = join(skills, 'notes', 'scripts');
  await mkdir(nested, { recursive: true });
  await writeFile(join(skills, 'notes', 'SKILL.md'), '---\nname: notes\ndescription: Notes.\n---\n');
  const recursive: string[] = [], above: string[] = [];
  const watchers = [watch(skills, { recursive: true }, (event, name) => recursive.push(`${event}:${name}`)), watch(tool, (event, name) => above.push(`${event}:${name}`))];
  try {
    await pause(300);
    const entries = await readdir(skills, { recursive: true });
    const times = await stat(skills);
    for (let pass = 0; pass < 100; pass++) for (const folder of [tool, skills, join(skills, 'notes'), nested]) await openForWriting(folder);
    await pause(1000);
    const fromOpens = { recursive: [...recursive], above: [...above] };
    const timesAfter = await stat(skills);
    assert.deepEqual(await readdir(skills, { recursive: true }), entries);
    await writeFile(join(nested, 'real.txt'), 'real\n');
    for (let wait = 0; wait < 40 && !recursive.some(event => event.includes('real.txt')); wait++) await pause(50);
    console.log(`measured: events from opens ${JSON.stringify(fromOpens)}; skills mtime ${times.mtimeMs} -> ${timesAfter.mtimeMs}, atime ${times.atimeMs} -> ${timesAfter.atimeMs}; after a real entry ${JSON.stringify(recursive)}`);
    assert.deepEqual(fromOpens, { recursive: [], above: [] });
    assert.ok(recursive.some(event => event.includes('real.txt')));
  } finally { for (const watcher of watchers) watcher.close(); }
}));
