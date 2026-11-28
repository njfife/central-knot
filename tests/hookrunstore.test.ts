// Worked examples of hookrunstore.ts: fresh read as a new process, edited hook key mismatch, 16 KB UTF-8-safe
// cut mark and 50-entry global cap dropping the oldest across homes, stopped/refused skipped without overwriting an
// earlier kept result, remove, serialized concurrent writes, corrupt file recovery, and write-error recovery.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHookRunStore } from '../src/hookrunstore.ts';
import type { HookRunResult, HookSourceRef } from '../src/types.ts';

const refFor = (name: string): HookSourceRef => ({
  from: 'own', tool: 'claude-cli', declaredIn: '/tmp/home/.claude/settings.json',
  event: 'SessionStart', at: 0, command: `~/bin/${name}.sh`, fingerprint: `fp-${name}`,
});
const resultFor = (fields: Partial<HookRunResult> & Pick<HookRunResult, 'outcome'>): HookRunResult => ({
  allPrinted: '', stderr: '', durationMs: 120, at: '2026-11-28T17:30:00.000Z', cwd: '/tmp/home', emptyPrompt: false, ...fields,
});
async function withTemp(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'ck-hookstore-'));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('Worked examples 2 & 4: fresh store reads kept result from disk, and an edited command or other home does not match', () => withTemp(async dir => {
  const file = join(dir, 'hook-results.json');
  const home = '/tmp/home-a';
  const ref = refFor('greet');
  const saved = resultFor({ outcome: 'adds', added: 'Line one\nLine two\n', allPrinted: 'Line one\nLine two\n', pluginVersion: '0.4.1' });

  await createHookRunStore(file).put(home, ref, saved);
  assert.ok((await readFile(file, 'utf8')).includes('Line one'));

  const second = createHookRunStore(file);
  assert.deepEqual(await second.get(home, [ref, refFor('greet-edited')]), [saved, null]);
  assert.deepEqual(await second.get('/tmp/home-b', [ref]), [null]);
}));

test('Worked example 5: 16 KB text fields stay whole, past 16 KB cuts on UTF-8 boundary with cut mark, and 51st hook drops oldest globally', () => withTemp(async dir => {
  const store = createHookRunStore(join(dir, 'hook-results.json'));
  const homeA = '/tmp/home-a';
  const homeB = '/tmp/home-b';
  const limitBytes = 16 * 1024;
  const cutNote = '\n\n[Central Knot kept the first 16 KB.]';

  const exact = 'a'.repeat(limitBytes);
  const refExact = refFor('exact');
  await store.put(homeA, refExact, resultFor({ outcome: 'adds', added: exact, allPrinted: exact, stderr: exact }));
  const [gotExact] = await store.get(homeA, [refExact]);
  assert.deepEqual([gotExact!.added, gotExact!.allPrinted, gotExact!.stderr], [exact, exact, exact]);

  // 1 byte past limit + 3-byte UTF-8 char straddling the boundary must not produce U+FFFD.
  const over = `${'x'.repeat(limitBytes - 1)}€tail`;
  const refOver = refFor('over');
  await store.put(homeA, refOver, resultFor({ outcome: 'adds', added: over, allPrinted: `{"wrap":"${over}"}`, stderr: over }));
  const [gotOver] = await store.get(homeA, [refOver]);
  assert.ok(gotOver!.added!.endsWith(cutNote) && gotOver!.allPrinted.endsWith(cutNote) && gotOver!.stderr.endsWith(cutNote));
  const keptBody = gotOver!.added!.slice(0, -cutNote.length);
  assert.ok(Buffer.byteLength(keptBody, 'utf8') <= limitBytes);
  assert.equal(keptBody.includes('\uFFFD'), false);

  // Fill to 50 across two homes, refresh hook-0, then add hook-50 -> hook-1 (oldest) drops while hook-0 stays.
  const capFile = join(dir, 'cap.json');
  const storeCap = createHookRunStore(capFile);
  const refs = Array.from({ length: 51 }, (_, i) => ({ home: i % 2 === 0 ? homeA : homeB, ref: refFor(`hook-${i}`) }));
  for (let i = 0; i < 50; i++) {
    await storeCap.put(refs[i]!.home, refs[i]!.ref, resultFor({ outcome: 'adds', added: `out-${i}`, allPrinted: `out-${i}` }));
  }
  await storeCap.put(refs[0]!.home, refs[0]!.ref, resultFor({ outcome: 'adds', added: 'out-0-refreshed', allPrinted: 'out-0-refreshed' }));
  await storeCap.put(refs[50]!.home, refs[50]!.ref, resultFor({ outcome: 'adds', added: 'out-50', allPrinted: 'out-50' }));

  const fresh = createHookRunStore(capFile);
  const picks = [0, 1, 2, 50];
  const got = await Promise.all(picks.map(i => fresh.get(refs[i]!.home, [refs[i]!.ref]).then(([r]) => r?.added ?? null)));
  assert.deepEqual(got, ['out-0-refreshed', null, 'out-2', 'out-50']);
}));

test('Worked example 6: stopped and refused runs are skipped without overwriting an earlier kept result, and remove deletes it', () => withTemp(async dir => {
  const file = join(dir, 'hook-results.json');
  const store = createHookRunStore(file);
  const home = '/tmp/home-a';
  const refA = refFor('never-kept');
  const refB = refFor('kept-then-stopped');

  await store.put(home, refA, resultFor({ outcome: 'stopped' }));
  await store.put(home, refA, resultFor({ outcome: 'refused', problem: 'Hooks are off.' }));
  assert.deepEqual(await store.get(home, [refA]), [null]);

  const earlier = resultFor({ outcome: 'adds', added: 'earlier output', allPrinted: 'earlier output' });
  await store.put(home, refB, earlier);
  await store.put(home, refB, resultFor({ outcome: 'stopped' }));
  await store.put(home, refB, resultFor({ outcome: 'refused', problem: 'Already running.' }));
  assert.deepEqual(await store.get(home, [refB]), [earlier]);

  await store.remove(home, refB);
  assert.deepEqual(await createHookRunStore(file).get(home, [refB]), [null]);
}));

test('Concurrent writes serialize so both stay; corrupt file recovers; failed write does not break later writes', () => withTemp(async dir => {
  const file = join(dir, 'hook-results.json');
  const store = createHookRunStore(file);
  const home = '/tmp/home-a';
  const refA = refFor('alpha');
  const refB = refFor('beta');
  const resA = resultFor({ outcome: 'adds', added: 'A', allPrinted: 'A' });
  const resB = resultFor({ outcome: 'adds', added: 'B', allPrinted: 'B' });

  await Promise.all([store.put(home, refA, resA), store.put(home, refB, resB)]);
  assert.deepEqual(await createHookRunStore(file).get(home, [refA, refB]), [resA, resB]);

  await writeFile(file, '{ not valid json');
  assert.deepEqual(await store.get(home, [refA]), [null]);
  await store.put(home, refA, resA);
  assert.deepEqual(await store.get(home, [refA]), [resA]);

  const blocked = join(dir, 'blocked');
  await mkdir(blocked, { recursive: true });
  const badStore = createHookRunStore(blocked);
  await assert.rejects(badStore.put(home, refA, resA));
  await rm(blocked, { recursive: true, force: true });
  await badStore.put(home, refA, resA);
  assert.deepEqual(await badStore.get(home, [refA]), [resA]);
}));
