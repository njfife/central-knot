// A file of Central Knot's own that is there and can't be read: how its text is read (values.ts jsonObject), and how it is kept
// aside so the next write never writes over it (share.ts keepUnreadable). main.ts loadAppSettings reads app-settings.json this
// way; history.ts keeps unreadable History the same way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jsonObject } from '../src/values.ts';
import { keepUnreadable } from '../src/share.ts';

test('A settings file is read as its JSON object; text that is not one is unreadable', () => {
  // Empty, cut short by a crash, not JSON, or JSON that is no object: unreadable, so the caller keeps it aside.
  for (const text of ['', '{"home": {"mode": "act', 'appearance = dark', '[]', 'null', '42', '"dark"']) assert.equal(jsonObject(text), undefined, text);
  // A field of the wrong type keeps the file readable and its good fields: each setting's reader falls back to its default alone.
  assert.deepEqual(jsonObject('{"appearance": "dark", "historyDays": "ninety"}'), { appearance: 'dark', historyDays: 'ninety' });
});

test('An unreadable file is kept beside it as name.unreadable-time.json, byte for byte, and its place is free for the next write', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'ck-unreadable-'));
  try {
    const path = join(folder, 'app-settings.json');
    await writeFile(path, '{"home": {"mode": "act');
    const kept = await keepUnreadable(path);
    assert.match(kept, /\/app-settings\.unreadable-\d+\.json$/);
    assert.equal(await readFile(kept, 'utf8'), '{"home": {"mode": "act');
    assert.deepEqual(await readdir(folder), [kept.slice(folder.length + 1)]);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

// Root may rename in a folder it can't write, so this one can't be shown as root.
test('An unreadable file in a folder that can’t be written can’t be kept aside: that fails, and the file stays where it is', { skip: process.getuid?.() === 0 && 'root can rename in a read-only folder' }, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'ck-unreadable-'));
  const path = join(folder, 'app-settings.json');
  try {
    await writeFile(path, '');
    await chmod(folder, 0o555);
    await assert.rejects(keepUnreadable(path), { code: 'EACCES' });
    assert.deepEqual(await readdir(folder), ['app-settings.json']);
  } finally { await chmod(folder, 0o755); await rm(folder, { recursive: true, force: true }); }
});
