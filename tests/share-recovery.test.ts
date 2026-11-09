// Crash recovery of moved-aside settings files: none is ever lost, even several for the same path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { recoverParked } from '../src/share.ts';

test('Ten moved-aside originals for a path that is taken become ten backups; none overwrites another', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'ck-recover-'));
  try {
    await writeFile(join(folder, 'config.toml'), 'current\n');
    for (let index = 0; index < 10; index++) await writeFile(join(folder, `.config.toml.ck-${randomUUID()}.old`), `original ${index}\n`);
    await recoverParked(folder);
    const names = await readdir(folder);
    const backups = names.filter(name => name.endsWith('.bak'));
    assert.equal(backups.length, 10, names.join(', '));
    const contents = new Set(await Promise.all(backups.map(name => readFile(join(folder, name), 'utf8'))));
    assert.equal(contents.size, 10);
    assert.equal(await readFile(join(folder, 'config.toml'), 'utf8'), 'current\n');
    assert.ok(!names.some(name => name.endsWith('.old')));
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('A moved-aside original whose place is empty goes back', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'ck-recover-'));
  try {
    await writeFile(join(folder, `.config.toml.ck-${randomUUID()}.old`), 'original\n');
    await recoverParked(folder);
    assert.equal(await readFile(join(folder, 'config.toml'), 'utf8'), 'original\n');
    assert.deepEqual((await readdir(folder)).filter(name => name !== 'config.toml'), []);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
