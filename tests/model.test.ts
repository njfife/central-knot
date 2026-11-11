import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caughtUpNames, keptDays, noSwitchRule, plural } from '../src/model.ts';

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

test('Off in a tool with no switch removes its copy, keeps it, or, before Settings could be read, changes nothing; History’s days are the default until then', () => {
  assert.deepEqual([noSwitchRule({ removeWhenNoSwitch: true }), noSwitchRule({ removeWhenNoSwitch: false }), noSwitchRule(undefined)], ['remove', 'keep', 'unread']);
  assert.deepEqual([keptDays({ historyDays: 7 }), keptDays(undefined)], [7, 30]);
});
