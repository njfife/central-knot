// Crash recovery of moved-aside settings files: none is ever lost, even several for the same path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { recoverParked } from '../src/share.ts';

test('A moved-aside original goes back to an empty place; ones whose place is taken become separate backups', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'ck-recover-'));
  try {
    await writeFile(join(folder, 'config.toml'), 'current\n');
    for (const text of ['a\n', 'b\n', 'c\n']) await writeFile(join(folder, `.config.toml.ck-${randomUUID()}.old`), text);
    await writeFile(join(folder, `.agent.md.ck-${randomUUID()}.old`), 'original\n');
    await recoverParked(folder);
    const names = await readdir(folder);
    const backups = names.filter(name => name.endsWith('.bak'));
    assert.deepEqual((await Promise.all(backups.map(name => readFile(join(folder, name), 'utf8')))).sort(), ['a\n', 'b\n', 'c\n']);
    assert.equal(await readFile(join(folder, 'config.toml'), 'utf8'), 'current\n');
    assert.equal(await readFile(join(folder, 'agent.md'), 'utf8'), 'original\n');
    assert.equal(names.length, 5, names.join(', '));
  } finally { await rm(folder, { recursive: true, force: true }); }
});
