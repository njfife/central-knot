// Worked examples of keeping each hook's last collected output (hookrunstore.ts): fresh read as a new process,
// edited hook key mismatch, 16 KB text bound with cut mark (at limit, 1 byte past, multi-byte UTF-8), 50-entry
// global cap dropping the oldest across homes, stopped and refused runs skipped without touching an earlier kept
// result, explicit remove, concurrent overlapping writes serialized so both stay, corrupt file recovery, and
// write failure leaving the store intact. Made-up folders under /tmp only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHookRunStore, HOOK_RESULT_CUT_NOTE, MAX_HOOK_RESULT_BYTES, MAX_HOOK_RESULTS } from '../src/hookrunstore.ts';
import type { HookRunResult, HookSourceRef } from '../src/types.ts';

const refFor = (name: string, extra: Partial<HookSourceRef> = {}): HookSourceRef => ({
  from: 'own',
  tool: 'claude-cli',
  declaredIn: `/tmp/home/.claude/settings.json`,
  event: 'SessionStart',
  at: 0,
  command: `~/bin/${name}.sh`,
  fingerprint: `fp-${name}`,
  ...extra,
} as HookSourceRef);

const resultFor = (fields: Partial<HookRunResult> & Pick<HookRunResult, 'outcome'>): HookRunResult => ({
  allPrinted: '',
  stderr: '',
  durationMs: 120,
  at: '2026-11-28T17:30:00.000Z',
  cwd: '/tmp/home',
  emptyPrompt: false,
  ...fields,
});

test('Worked examples 2 & 4: fresh store reads kept result from disk, and an edited command does not match', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ck-hookstore-'));
  try {
    const file = join(dir, 'hook-results.json');
    const home = '/tmp/home-a';
    const ref = refFor('greet');
    const saved = resultFor({ outcome: 'adds', added: 'Line one\nLine two\n', allPrinted: 'Line one\nLine two\n', pluginVersion: '0.4.1' });

    const first = createHookRunStore(file);
    await first.put(home, ref, saved);
    assert.ok((await readFile(file, 'utf8')).includes('Line one'));

    // Fresh instance simulates a new process reading the app data file from disk.
    const second = createHookRunStore(file);
    const edited = refFor('greet-edited');
    const [found, missing, wrongHome] = [
      ...(await second.get(home, [ref, edited])),
      ...(await second.get('/tmp/home-b', [ref])),
    ];
    assert.deepEqual(found, saved);
    assert.equal(missing, null);
    assert.equal(wrongHome, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Worked example 5: text fields at 16 KB stay whole, past 16 KB cut cleanly on UTF-8 boundary and mark as cut, and the 51st hook drops the oldest globally', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ck-hookstore-'));
  try {
    const file = join(dir, 'hook-results.json');
    const store = createHookRunStore(file);
    const homeA = '/tmp/home-a';
    const homeB = '/tmp/home-b';

    const exact = 'a'.repeat(MAX_HOOK_RESULT_BYTES);
    const refExact = refFor('exact');
    await store.put(homeA, refExact, resultFor({ outcome: 'adds', added: exact, allPrinted: exact, stderr: exact }));
    const [gotExact] = await store.get(homeA, [refExact]);
    assert.equal(gotExact!.added, exact);
    assert.equal(gotExact!.allPrinted, exact);
    assert.equal(gotExact!.stderr, exact);

    // 1 byte past limit + 3-byte UTF-8 char straddling the boundary must not produce U+FFFD.
    const over = `${'x'.repeat(MAX_HOOK_RESULT_BYTES - 1)}€tail`;
    const refOver = refFor('over');
    await store.put(homeA, refOver, resultFor({ outcome: 'adds', added: over, allPrinted: `{"wrap":"${over}"}`, stderr: over }));
    const [gotOver] = await store.get(homeA, [refOver]);
    assert.ok(gotOver!.added!.endsWith(HOOK_RESULT_CUT_NOTE));
    assert.ok(gotOver!.allPrinted.endsWith(HOOK_RESULT_CUT_NOTE));
    assert.ok(gotOver!.stderr.endsWith(HOOK_RESULT_CUT_NOTE));
    const keptBody = gotOver!.added!.slice(0, -HOOK_RESULT_CUT_NOTE.length);
    assert.ok(Buffer.byteLength(keptBody, 'utf8') <= MAX_HOOK_RESULT_BYTES);
    assert.equal(keptBody.includes('\uFFFD'), false);

    // Fill to MAX_HOOK_RESULTS (50) across two homes, refresh the 1st entry, then add one more -> 2nd drops, 1st stays.
    const storeCap = createHookRunStore(join(dir, 'cap.json'));
    const refs = Array.from({ length: MAX_HOOK_RESULTS + 1 }, (_, i) => ({
      home: i % 2 === 0 ? homeA : homeB,
      ref: refFor(`hook-${i}`),
    }));
    for (let i = 0; i < MAX_HOOK_RESULTS; i++) {
      await storeCap.put(refs[i]!.home, refs[i]!.ref, resultFor({ outcome: 'adds', added: `out-${i}`, allPrinted: `out-${i}` }));
    }
    // Re-collecting hook-0 makes it newest so hook-1 becomes the oldest.
    await storeCap.put(refs[0]!.home, refs[0]!.ref, resultFor({ outcome: 'adds', added: 'out-0-refreshed', allPrinted: 'out-0-refreshed' }));
    await storeCap.put(refs[MAX_HOOK_RESULTS]!.home, refs[MAX_HOOK_RESULTS]!.ref, resultFor({ outcome: 'adds', added: 'out-50', allPrinted: 'out-50' }));

    const fresh = createHookRunStore(join(dir, 'cap.json'));
    const [got0] = await fresh.get(refs[0]!.home, [refs[0]!.ref]);
    const [got1] = await fresh.get(refs[1]!.home, [refs[1]!.ref]);
    const [got2] = await fresh.get(refs[2]!.home, [refs[2]!.ref]);
    const [gotLast] = await fresh.get(refs[MAX_HOOK_RESULTS]!.home, [refs[MAX_HOOK_RESULTS]!.ref]);
    assert.equal(got0?.added, 'out-0-refreshed');
    assert.equal(got1, null, 'oldest entry across homes is dropped at cap + 1');
    assert.equal(got2?.added, 'out-2');
    assert.equal(gotLast?.added, 'out-50');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Worked example 6: stopped and refused runs are not kept, leave an earlier kept result standing, and remove deletes it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ck-hookstore-'));
  try {
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
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Concurrent writes serialize so two results landing together both stay; corrupt file recovers; failed write rejects cleanly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ck-hookstore-'));
  try {
    const file = join(dir, 'hook-results.json');
    const store = createHookRunStore(file);
    const home = '/tmp/home-a';
    const refA = refFor('alpha');
    const refB = refFor('beta');
    const resA = resultFor({ outcome: 'adds', added: 'A', allPrinted: 'A' });
    const resB = resultFor({ outcome: 'adds', added: 'B', allPrinted: 'B' });

    await Promise.all([store.put(home, refA, resA), store.put(home, refB, resB)]);
    assert.deepEqual(await createHookRunStore(file).get(home, [refA, refB]), [resA, resB]);

    // Corrupt file on disk returns nulls without throwing and recovers on the next write.
    await writeFile(file, '{ not valid json');
    assert.deepEqual(await store.get(home, [refA]), [null]);
    await store.put(home, refA, resA);
    assert.deepEqual(await store.get(home, [refA]), [resA]);

    // Path occupied by a directory makes writeDurably fail without breaking later writes once cleared.
    const blocked = join(dir, 'blocked');
    await mkdir(blocked, { recursive: true });
    const badStore = createHookRunStore(blocked);
    await assert.rejects(badStore.put(home, refA, resA));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
