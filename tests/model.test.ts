import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caughtUpNames, plural, timesApart } from '../src/model.ts';

test('plural words read naturally', () => {
  assert.equal(plural(1, 'copy', 'copies'), '1 copy');
  assert.equal(plural(3, 'copy', 'copies'), '3 copies');
  assert.equal(plural(0, 'skill'), '0 skills');
});

test('caught-up names list each written skill once and leave out ones a notice already tells', () => {
  const caughtUp = [
    { item: 'review', outcome: 'written' },
    { item: 'review', outcome: 'written' },
    { item: 'deploy', outcome: 'written' },
    { item: 'notes', outcome: 'kept' },
  ];
  const manage = { caughtUp } as unknown as Parameters<typeof caughtUpNames>[0];
  assert.deepEqual(caughtUpNames(manage, new Set(['deploy'])), ['review']);
});

test('Every row of a list says its time in one form: how long ago while that tells them apart, else the clock, to the second where two would match', () => {
  const ten = new Date(); ten.setHours(10, 0, 5, 0);
  const plus = (seconds: number) => new Date(ten.getTime() + seconds * 1000).toISOString(), now = ten.getTime() + 3600_000;
  // All today and apart: how long ago.
  assert.deepEqual(timesApart([plus(3540), plus(60), plus(3590)], now), ['1 min ago', '59 min ago', 'just now']);
  // 10:00:05 and 9:50:05 would both read "1 h ago", and 10:00:05 and 10:00:40 both "10:00": every row to the second.
  const close = timesApart([plus(0), plus(35), plus(-600)], now);
  assert.ok(close.every(time => /\d:\d\d:\d\d/.test(time)), close.join(' | '));
  assert.notEqual(close[0], close[1]);
  // A row from yesterday: the clock for every row; the versions list (withDay) names that day, History (under day headings) does not.
  const yesterday = new Date(ten.getTime() - 86_400_000 - 3600_000).toISOString();
  const [todayRow, dayRow] = timesApart([plus(0), yesterday], now, true);
  assert.ok(/^\d+:\d\d\D/.test(todayRow) && !/\d:\d\d:\d\d/.test(todayRow), todayRow);
  assert.match(dayRow, /^yesterday at \d+:\d\d\D/);
  assert.doesNotMatch(timesApart([plus(0), yesterday], now)[1], /yesterday/);
});
