import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pageData, putPageData, readPageData, resetPageData } from '../src/pagedata.ts';

/** A reply the test sends when it chooses, so reads can overlap in a known order. */
function later<T>() {
  let send!: (value: T) => void;
  const reply = new Promise<T>(done => { send = done; });
  return { reply, send };
}

test('a slot says it is reading until its first read answers', async () => {
  const slot = pageData<string[]>();
  assert.equal(slot.state, 'reading');
  const answer = later<string[]>();
  const read = readPageData(slot, () => answer.reply);
  assert.equal(slot.state, 'reading');
  answer.send(['a']);
  assert.equal(await read, 'ready');
  assert.deepEqual([slot.state, slot.data], ['ready', ['a']]);
});

test('a newer read of the same kind wins, whichever answers first', async () => {
  const slot = pageData<string>();
  const older = later<string>(), newer = later<string>();
  const first = readPageData(slot, () => older.reply);
  const second = readPageData(slot, () => newer.reply);
  newer.send('new');
  older.send('old');
  assert.deepEqual([await first, await second], ['dropped', 'ready']);
  assert.equal(slot.data, 'new');
});

test('an action in between does not drop the read; only a put of the same kind does', async () => {
  const history = pageData<string>(), instructions = pageData<string>();
  const answer = later<string>();
  const read = readPageData(history, () => answer.reply);
  // An action that writes the other kind's data, as a save writes Instructions while History is being read.
  putPageData(instructions, 'saved');
  answer.send('events');
  assert.equal(await read, 'ready');
  assert.equal(history.data, 'events');
  // An action that read this kind itself is newer: the older read's reply is dropped.
  const slow = later<string>();
  const again = readPageData(history, () => slow.reply);
  putPageData(history, 'from the action');
  slow.send('stale');
  assert.equal(await again, 'dropped');
  assert.deepEqual([history.state, history.data], ['ready', 'from the action']);
});

test('a failure shows as failed, keeping what was read before', async () => {
  const slot = pageData<string>();
  assert.equal(await readPageData(slot, async () => { throw new Error('no'); }), 'failed');
  assert.deepEqual([slot.state, slot.data], ['failed', undefined]);
  await readPageData(slot, async () => 'one');
  assert.equal(await readPageData(slot, async () => null), 'failed');
  assert.deepEqual([slot.state, slot.data], ['failed', 'one']);
});

test('a new home clears the data and drops replies still on their way', async () => {
  const slot = pageData<string>();
  await readPageData(slot, async () => 'old home');
  const answer = later<string>();
  const read = readPageData(slot, () => answer.reply);
  resetPageData(slot);
  assert.deepEqual([slot.state, slot.data], ['reading', undefined]);
  answer.send('old home again');
  assert.equal(await read, 'dropped');
  assert.equal(slot.data, undefined);
});
