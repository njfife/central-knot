// Library Used cell words by Sort (matrix.ts usedCellWords).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayWords, DAY_MS } from '../src/model.ts';
import type { RowOrder } from '../src/itemrow.ts';
import { installDom } from './domstub.ts';

installDom({});
await import('../src/settingspage.ts');
const { usedCellWords } = await import('../src/matrix.ts');

test('usedCellWords shows only the Sort’s figure for used rows, keeps no-use and can’t say under every Sort, and keeps both figures in hover', () => {
  const usedAt = new Date(Date.now() - 2 * DAY_MS - 3_600_000).toISOString();
  const sinceAt = new Date(Date.now() - 18 * DAY_MS).toISOString();
  const since = dayWords(sinceAt);
  const usedBy = (sessions: string): Record<RowOrder, string> => ({ 'most-used': sessions, used: '2 days ago', name: '', updated: '' });
  for (const order of ['most-used', 'used', 'name', 'updated'] as RowOrder[]) {
    assert.deepEqual(usedCellWords({ used: usedAt, sessions: 28 }, order), { text: usedBy('28 sessions')[order], hover: 'Used 2 days ago · 28 sessions.' });
    assert.deepEqual(usedCellWords({ used: usedAt, sessions: 1 }, order), { text: usedBy('1 session')[order], hover: 'Used 2 days ago · 1 session.' });
    assert.deepEqual(usedCellWords({ noneSeen: true }, order), { text: 'no use seen in 30 days', hover: 'No use seen in 30 days.' });
    assert.deepEqual(usedCellWords({ noneSeen: true, since: sinceAt }, order), { text: `no use seen since ${since}`, hover: `No use seen since ${since}.` });
    assert.deepEqual(usedCellWords(undefined, order), { text: 'can’t say', hover: 'No tool that has it on can tell whether it was used.' });
  }
});
