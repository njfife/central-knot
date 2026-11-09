// Crash recovery of moved-aside settings files: none is ever lost, even several for the same path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { recoverParked, writeFileChecked } from '../src/share.ts';

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

for (const race of ['changed before the move', 'no hard links']) {
  test(`A moved-aside original that cannot go back is kept as a backup (${race})`, async () => {
    const folder = await mkdtemp(join(tmpdir(), 'ck-putback-'));
    const path = join(folder, 'settings.json');
    const original = race === 'no hard links' ? 'expected\n' : 'edited\n';
    const originalLink = fs.link;
    const originalRename = fs.rename;
    try {
      await writeFile(path, original);
      fs.rename = async (source, destination) => {
        await originalRename(source, destination);
        if (race === 'changed before the move' && String(destination).endsWith('.old')) await writeFile(path, 'later\n');
      };
      fs.link = async (source, destination) => {
        if (race === 'no hard links' && String(source).endsWith('.tmp')) throw Object.assign(new Error('no hard links'), { code: 'EPERM' });
        if (race === 'no hard links' && String(destination) === path) await writeFile(path, 'later\n');
        return originalLink(source, destination);
      };
      syncBuiltinESMExports();
      await assert.rejects(writeFileChecked(path, 'replacement\n', 'expected\n'), { code: 'CK_CHANGED' });
      assert.equal(await readFile(path, 'utf8'), 'later\n');
      const names = await readdir(folder);
      const contents = await Promise.all(names.map(name => readFile(join(folder, name), 'utf8')));
      assert.ok(contents.includes(original), `Original lost; remaining files: ${names.join(', ')}`);
    } finally {
      fs.link = originalLink;
      fs.rename = originalRename;
      syncBuiltinESMExports();
      await rm(folder, { recursive: true, force: true });
    }
  });
}
