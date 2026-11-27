// Library Used cell words by Sort (matrix.ts usedCellWords).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayWords, DAY_MS } from '../src/model.ts';
import type { RowOrder } from '../src/itemrow.ts';
import { installDom } from './domstub.ts';

installDom({});
// In the order the page's entry (renderer.ts) loads them: settingspage.ts first, before matrix.ts.
await import('../src/settingspage.ts');
const { usageLineWords, usedCellWords } = await import('../src/matrix.ts');

test('usedCellWords shows the Sort’s figure (recency in the unused filter), keeps no-use and use unknown, and drops hover when blank', () => {
  const usedAt = new Date(Date.now() - 2 * DAY_MS - 3_600_000).toISOString();
  const sinceAt = new Date(Date.now() - 18 * DAY_MS).toISOString();
  const since = dayWords(sinceAt);
  const usedBy = (sessions: string): Record<RowOrder, string> => ({ 'most-used': sessions, used: '2 days ago', name: '', updated: '' });
  for (const order of ['most-used', 'used', 'name', 'updated'] as RowOrder[]) {
    const pluralText = usedBy('28 sessions')[order], singleText = usedBy('1 session')[order];
    assert.deepEqual(usedCellWords({ used: usedAt, sessions: 28 }, order), { text: pluralText, hover: pluralText ? 'Used 2 days ago · 28 sessions.' : '' });
    assert.deepEqual(usedCellWords({ used: usedAt, sessions: 1 }, order), { text: singleText, hover: singleText ? 'Used 2 days ago · 1 session.' : '' });
    assert.deepEqual(usedCellWords({ used: usedAt, sessions: 28 }, order, true), { text: '2 days ago', hover: 'Used 2 days ago · 28 sessions.' });
    assert.deepEqual(usedCellWords({ noneSeen: true }, order), { text: 'no use seen in 30 days', hover: 'No use seen in 30 days.' });
    assert.deepEqual(usedCellWords({ noneSeen: true, since: sinceAt }, order), { text: `no use seen since ${since}`, hover: `No use seen since ${since}.` });
    assert.deepEqual(usedCellWords(undefined, order), { text: 'use unknown', hover: 'No tool that has it on can tell whether it was used.' });
  }
});

test('usageLineWords keeps both figures short, hides standing Can’t say reasons behind hover, preserves unread counts and past use, and blanks absent unobserved plugins', () => {
  const usedAt = new Date(Date.now() - 2 * DAY_MS - 3_600_000).toISOString();
  const oldAt = new Date(Date.now() - 40 * DAY_MS).toISOString();
  const sinceAt = new Date(Date.now() - 18 * DAY_MS).toISOString();
  const since = dayWords(sinceAt);
  assert.deepEqual(usageLineWords({ tool: 'claude-cli', sessions: 28, last: usedAt }, 'skills'), { text: 'used 2 days ago · 28 sessions' });
  assert.deepEqual(usageLineWords({ tool: 'codex-cli', sessions: 1, last: usedAt, skipped: 2 }, 'skills'), { text: 'used 2 days ago · 1 session · 2 session files couldn’t be read' });
  assert.deepEqual(usageLineWords({ tool: 'pi-cli', sessions: 0, since: sinceAt }, 'skills'), { text: `no use seen since ${since}` });
  assert.deepEqual(usageLineWords({ tool: 'claude-cli', sessions: 0, last: oldAt }, 'skills'), { text: 'no use seen in 30 days · last used 5 weeks ago' });
  assert.deepEqual(usageLineWords({ tool: 'copilot-cli', sessions: 0, cantSay: 'no-sessions' }, 'skills'), { text: 'Can’t say', hover: 'Can’t say: Copilot CLI keeps no sessions here.' });
  assert.deepEqual(usageLineWords({ tool: 'codex-cli', sessions: 0, cantSay: 'not-sure', last: oldAt }, 'skills'), { text: 'Can’t say · last used 5 weeks ago', hover: 'Can’t say: it doesn’t always record which skill was used.' });
  assert.deepEqual(usageLineWords({ tool: 'codex-cli', sessions: 0, cantSay: 'unread', skipped: 1 }, 'skills'), { text: 'Can’t say: 1 session file couldn’t be read' });
  assert.equal(usageLineWords({ tool: 'copilot-cli', sessions: 0, cantSay: 'no-sessions' }, 'skills', true), undefined);
  assert.deepEqual(usageLineWords({ tool: 'claude-cli', sessions: 0, last: oldAt }, 'skills', true), { text: 'no use seen in 30 days · last used 5 weeks ago' });
  assert.deepEqual(usageLineWords({ tool: 'codex-cli', sessions: 0, cantSay: 'unread', skipped: 1 }, 'skills', true), { text: 'Can’t say: 1 session file couldn’t be read' });
});
