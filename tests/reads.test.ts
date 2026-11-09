import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readInto, type Read } from '../src/reads.ts';

test('A failed quiet read stays failed, and is not read again until it is cleared (Refresh, Try again)', async () => {
  const reads = new Map<string, Read<string | null>>();
  let calls = 0;
  const read = () => { calls++; return Promise.resolve(null); };
  readInto(reads, 'home', read, () => {});
  await new Promise(done => setImmediate(done));
  readInto(reads, 'home', read, () => {});
  assert.equal(calls, 1, 'a redraw after the failure does not read again');
  assert.deepEqual(reads.get('home'), { reading: false, value: null });
  reads.delete('home');
  readInto(reads, 'home', read, () => {});
  assert.equal(calls, 2, 'Try again reads again');
});
