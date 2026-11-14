// The order of the rows under a heading on the Skills, MCP servers and Agents pages (src/itemrow.ts inOrder), as worked
// examples: by name, or by last updated, newest first. An item's versions change only through library.ts's keepVersion and
// setCurrent, so each example makes them that way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inOrder, type ItemRow } from '../src/itemrow.ts';
import { keepVersion, newItem, setCurrent, type LibraryItem, type Shelf } from '../src/library.ts';

/** A shelf that keeps nothing: these examples read only the item's record. */
const shelf: Shelf<null> = { store: async () => {}, save: async () => {} };
/** Nine in the morning, `days` days before 14 November 2026. */
const daysAgo = (days: number) => new Date(Date.UTC(2026, 10, 14 - days, 9)).toISOString();
/** An item taken in from Claude Code `days` days ago, On. */
const takenIn = (key: string, days: number): LibraryItem =>
  ({ ...newItem(key, key), on: true, hash: `${key}-1`, versions: [{ hash: `${key}-1`, at: daysAgo(days), from: { how: 'found', harness: 'claude-cli' } }] });
/** An edit made in a tool `days` days ago, taken in as the current version. */
const edited = (item: LibraryItem, days: number) => setCurrent(shelf, item, { hash: `${item.key}-edit-${days}`, at: daysAgo(days), from: { how: 'edited', harness: 'codex-cli' } }, null);
/** A row as the page has it; `copyDays`: when each tool's copy was last changed, for a found item. */
const row = (key: string, copyDays: Record<string, number> = {}): ItemRow => ({ key, description: '', copies: {}, on: true, except: [],
  versions: Object.fromEntries(Object.entries(copyDays).map(([tool, days]) => [tool, { lines: '3 lines', changed: '', text: '', at: daysAgo(days) }])) });
const keys = (rows: ItemRow[]) => rows.map(each => each.key);
/** Each row's item, as the page finds it in the kind's library (matrix.ts itemOf). */
const from = (library: Record<string, LibraryItem>) => (each: ItemRow) => library[each.key];

test('By last updated, a skill edited yesterday comes before one edited last week; by name, the order is as always', async () => {
  const releaseNotes = takenIn('release-notes', 30), standup = takenIn('standup', 30);
  await edited(releaseNotes, 7);
  await edited(standup, 1);
  const rows = [row('release-notes'), row('standup')], library = { 'release-notes': releaseNotes, standup };
  assert.deepEqual(keys(inOrder(rows, 'updated', from(library))), ['standup', 'release-notes']);
  assert.deepEqual(keys(inOrder(rows, 'name', from(library))), ['release-notes', 'standup']);
});

test('Make current is an update: the version made current again today puts its item first', async () => {
  const notes = takenIn('notes', 30), standup = takenIn('standup', 30);
  await edited(notes, 1);
  await edited(standup, 7);
  await setCurrent(shelf, standup, { hash: 'standup-1', at: daysAgo(0), from: { how: 'made-current' } }, null);
  assert.deepEqual(keys(inOrder([row('notes'), row('standup')], 'updated', from({ notes, standup }))), ['standup', 'notes']);
});

test('Switching a skill Off and On again does not move it, though turning it on kept a tool’s own copy as a version today', async () => {
  const notes = takenIn('notes', 3), standup = takenIn('standup', 7);
  const rows = [row('standup'), row('notes')], library = { notes, standup };
  const before = keys(inOrder(rows, 'updated', from(library)));
  // Off takes it out of every tool; On again finds Codex holding a copy of its own, written today, which is kept as a version
  // that was never current before the item is written there (library.ts, THE RULE: "a copy, no A").
  Object.assign(standup, { on: false, applied: {} });
  Object.assign(standup, { on: true, applied: { 'claude-cli': 'standup-1', 'codex-cli': 'standup-1' } });
  await keepVersion(shelf, standup, { hash: 'codex-own', at: daysAgo(0), from: { how: 'was-in', harness: 'codex-cli' } }, null);
  assert.deepEqual([before, keys(inOrder(rows, 'updated', from(library)))], [['notes', 'standup'], ['notes', 'standup']]);
});

test('A found item goes by its newest copy’s time; one with no time goes last; equal times, or none, go by name on every look', () => {
  const library = { gamma: takenIn('gamma', 1), alpha: takenIn('alpha', 4), beta: takenIn('beta', 4) };
  // Found (no item): its copies were changed two and five days ago. An MCP entry carries no time of its own.
  const found = row('found-skill', { 'claude-cli': 5, 'copilot-cli': 2 }), server = row('found-server'), another = row('another-server');
  const expected = ['gamma', 'found-skill', 'alpha', 'beta', 'another-server', 'found-server'];
  for (const rows of [[server, found, another, row('beta'), row('alpha'), row('gamma')], [row('gamma'), row('alpha'), row('beta'), another, found, server]]) {
    assert.deepEqual(keys(inOrder(rows, 'updated', from(library))), expected);
  }
});

test('A deleted item, found again, goes by its copy’s time, not by the versions Central Knot still holds', () => {
  const notes = { ...takenIn('notes', 0), deleted: { at: daysAgo(0) } }, standup = takenIn('standup', 1);
  assert.deepEqual(keys(inOrder([row('notes', { 'claude-cli': 9 }), row('standup')], 'updated', from({ notes, standup }))), ['standup', 'notes']);
});
