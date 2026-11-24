// The order of the rows under a heading on the Library and a tool's tabs (src/itemrow.ts inOrder), as worked examples: by
// name, or by last updated, newest first; the Library's kinds mixed under one heading. An item's versions change only through library.ts's keepVersion and
// setCurrent, so each example makes them that way. Then the rows a click pins where they were (Pinned), as the MCP servers
// page draws them; and a skill and an agent of one name, two rows apart (rowId), on two lists and on one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byUsage, inOrder, noPins, pin, pinsOn, placeIn, rankIn, rowId, type ItemRow, type Pinned, type RowUsage } from '../src/itemrow.ts';
import { lastUse, rowFigure, type ToolSays } from '../src/usagerow.ts';
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
/** A row as the page has it, a skill unless `kind` says; `copyDays`: when each tool's copy was last changed, for a found item. */
const row = (key: string, copyDays: Record<string, number> = {}, kind: ItemRow['kind'] = 'skills'): ItemRow => ({ kind, key, description: '', copies: {}, on: true, except: [],
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

test('By last used: the newest use first, an item with no use seen after every one with a use, by name among those', () => {
  const lastUse: Record<string, number> = { notes: Date.parse(daysAgo(5)), standup: Date.parse(daysAgo(1)) };
  const rows = [row('release-notes'), row('alpha'), row('notes'), row('standup')];
  assert.deepEqual(keys(inOrder(rows, 'used', from({}), each => lastUse[each.key])), ['standup', 'notes', 'alpha', 'release-notes']);
});

// ---------- Rows pinned where they were ----------

/** Servers On and Off, as their rows' own state says (matrix.ts sectionOf): `on` names the On ones. */
const servers = (on: string[], off: string[]) => new Map([...on.map(key => [key, 'on'] as const), ...off.map(key => [key, 'off'] as const)]);
/** A server's row id, which its pin goes by. */
const server = (key: string) => rowId('mcp', key);
/** The page as drawn, heading by heading (matrix.ts itemsTable): each row under the heading it is pinned under, else its own, by name. */
const drawn = (own: Map<string, string>, pins: Pinned<string>) => ['on', 'off'].map(heading =>
  [heading, keys(inOrder([...own.keys()].filter(key => placeIn(pins, server(key), own.get(key)!) === heading).map(key => row(key, {}, 'mcp')), 'name', from({})))]);
const byName = 'MCP servers by name';

test('A server turned off by its own switch stays where it was under On, drawn Off; a second click keeps that place', () => {
  const pins = pinsOn(noPins<string>(), byName);
  // beta's switch is clicked: it is pinned under the heading it is under now, then the click turns it Off.
  pin(pins, server('beta'), 'on');
  assert.deepEqual(drawn(servers(['alpha', 'gamma'], ['beta', 'delta']), pins), [['on', ['alpha', 'beta', 'gamma']], ['off', ['delta']]]);
  // Clicked again, from under On where it is drawn: its own heading is Off now, and it stays where it was.
  pin(pins, server('beta'), 'off');
  assert.deepEqual(drawn(servers(['alpha', 'gamma'], ['beta', 'delta']), pins), [['on', ['alpha', 'beta', 'gamma']], ['off', ['delta']]]);
  // A change by another route (a profile switch turns gamma Off): gamma was never clicked here, so it goes under Off.
  assert.deepEqual(drawn(servers(['alpha'], ['beta', 'delta', 'gamma']), pins), [['on', ['alpha', 'beta']], ['off', ['delta', 'gamma']]]);
});

test('A server new to the list goes where its own heading and the order put it', () => {
  const pins = pinsOn(noPins<string>(), byName);
  pin(pins, server('beta'), 'on');
  assert.deepEqual(drawn(servers(['aardvark', 'alpha'], ['beta', 'zeta']), pins), [['on', ['aardvark', 'alpha', 'beta']], ['off', ['zeta']]]);
});

test('Another Sort, or another list drawn in between, lets the pinned rows go, and every row takes its own heading again', () => {
  const own = servers(['alpha'], ['beta']), regrouped = [['on', ['alpha']], ['off', ['beta']]];
  const clicked = () => { const pins = pinsOn(noPins<string>(), byName); pin(pins, server('beta'), 'on'); return pins; };
  // Sort by Last updated: the page asks for another list's rows.
  assert.deepEqual(drawn(own, pinsOn(clicked(), 'MCP servers by last updated')), regrouped);
  // Agents, then back on MCP servers: the Agents segment let them go, so none are pinned on coming back.
  assert.deepEqual(drawn(own, pinsOn(pinsOn(clicked(), 'Agents by name'), byName)), regrouped);
});

test('Sorted by last updated, a found item taken in by its Add keeps its place among its neighbours: it goes by the time it had when clicked', () => {
  // Found, with no time, they go by name; Add takes beta in with today's time.
  const rows = [row('alpha'), row('beta'), row('gamma')], library = { beta: takenIn('beta', 0) };
  const pins = pinsOn(noPins<string>(), 'Skills by last updated');
  pin(pins, rowId('skills', 'beta'), 'found', undefined);
  assert.deepEqual(keys(inOrder(rows, 'updated', from(library), undefined, pins)), ['alpha', 'beta', 'gamma']);
  // Not pinned (the list drawn afresh), it goes first, by its time.
  assert.deepEqual(keys(inOrder(rows, 'updated', from(library))), ['beta', 'alpha', 'gamma']);
});

// ---------- A skill and an agent of one name ----------

test('A skill and an agent both named review have two row ids, and a pin on the Skills list holds nothing on the Agents list', () => {
  const skill: ItemRow = { ...row('review'), kind: 'skills' }, agent: ItemRow = { ...row('review'), kind: 'agents' };
  // The opened row, the flash, the armed Delete and a plugin item's file shown go by the row's id.
  assert.deepEqual([rowId(skill.kind, skill.key), rowId(agent.kind, agent.key)], ['skills-review', 'agents-review']);
  // The skill's switch clicked on Skills pins it there; on Agents, whose list is another, the agent goes under its own heading.
  const onSkills = pinsOn(noPins<string>(), 'Skills by name');
  pin(onSkills, rowId(skill.kind, skill.key), 'on');
  assert.deepEqual([placeIn(onSkills, rowId(skill.kind, skill.key), 'off'), placeIn(pinsOn(onSkills, 'Agents by name'), rowId(agent.kind, agent.key), 'off')], ['on', 'off']);
});

test('On one list, a skill and an agent both named review keep their own times and their own pins', async () => {
  const skill = row('review'), agent = row('review', {}, 'agents'), notes = row('notes');
  const skills: Record<string, LibraryItem> = { review: takenIn('review', 9), notes: takenIn('notes', 3) }, agents: Record<string, LibraryItem> = { review: takenIn('review', 0) };
  const itemOf = (each: ItemRow) => (each.kind === 'agents' ? agents : skills)[each.key];
  const ids = (rows: ItemRow[]) => rows.map(each => rowId(each.kind, each.key));
  // By last updated: the agent, taken in today; notes, 3 days ago; the skill, 9 days ago. Each goes by its own item's time.
  assert.deepEqual(ids(inOrder([skill, notes, agent], 'updated', itemOf)), ['agents-review', 'skills-notes', 'skills-review']);
  // The skill's switch is clicked: it is pinned with the time it had. Edited today, it stays last; the agent keeps its own time.
  const pins = pinsOn(noPins<string>(), 'Library by last updated');
  pin(pins, rowId('skills', 'review'), 'on', Date.parse(daysAgo(9)));
  await edited(skills.review!, 0);
  assert.deepEqual(ids(inOrder([skill, notes, agent], 'updated', itemOf, undefined, pins)), ['agents-review', 'skills-notes', 'skills-review']);
});

test('On the Library, the kinds are mixed under one heading in the chosen Sort, and one name goes skill, server, agent', () => {
  const rows = [row('review', {}, 'agents'), row('github', {}, 'mcp'), row('review', {}, 'mcp'), row('notes'), row('review')];
  const ids = (list: ItemRow[]) => list.map(each => rowId(each.kind, each.key));
  // By name: github, notes, then the three named review, the skill first, then the server, then the agent.
  assert.deepEqual(ids(inOrder(rows, 'name', from({}))), ['mcp-github', 'skills-notes', 'skills-review', 'mcp-review', 'agents-review']);
  // By last updated, none has a time: they go by name and kind the same way, whatever order they came in.
  assert.deepEqual(ids(inOrder([...rows].reverse(), 'updated', from({}))), ['mcp-github', 'skills-notes', 'skills-review', 'mcp-review', 'agents-review']);
});

// ---------- By most used ----------

test('By most used: rows with 12, 3 and 7 sessions in the last 30 days go 12, 7, 3', () => {
  const usage: Record<string, { sessions: number; at: number }> = {
    alpha: { sessions: 12, at: Date.parse(daysAgo(6)) },
    beta: { sessions: 3, at: Date.parse(daysAgo(1)) },
    gamma: { sessions: 7, at: Date.parse(daysAgo(4)) },
  };
  const rows = [row('beta'), row('gamma'), row('alpha')];
  assert.deepEqual(keys(inOrder(rows, 'most-used', from({}), each => usage[each.key])), ['alpha', 'gamma', 'beta']);
});

test('By most used: equal counts go by the more recent use first, then by name and kind', () => {
  const tiedTime = Date.parse(daysAgo(1));
  const usage: Record<string, RowUsage> = {
    'skills-alpha': { sessions: 5, at: Date.parse(daysAgo(7)) },
    'skills-beta': { sessions: 5, at: tiedTime },
  };
  assert.deepEqual(keys(inOrder([row('alpha'), row('beta')], 'most-used', from({}), each => usage[rowId(each.kind, each.key)])), ['beta', 'alpha']);
  // Same count and same last use: by name, and one name by kind (skill, server, agent), whatever order they came in.
  const mixed = [row('review', {}, 'agents'), row('review', {}, 'mcp'), row('notes'), row('review')];
  const ids = (list: ItemRow[]) => list.map(each => rowId(each.kind, each.key));
  const sameUsage = () => ({ sessions: 5, at: tiedTime });
  assert.deepEqual(ids(inOrder(mixed, 'most-used', from({}), sameUsage)), ['skills-notes', 'skills-review', 'mcp-review', 'agents-review']);
  assert.deepEqual(ids(inOrder([...mixed].reverse(), 'most-used', from({}), sameUsage)), ['skills-notes', 'skills-review', 'mcp-review', 'agents-review']);
});

test('By most used: rows with no figure (no use seen, can’t say, or usage not collected) go last by name', () => {
  const saysByKey: Record<string, ToolSays[]> = {
    used: [{ tool: 'claude-cli', sessions: 4, last: daysAgo(2) }],
    // Used 40 days ago: 0 sessions in 30 days, so rowFigure is noneSeen (no figure for Most used, still has lastUse for Last used).
    old: [{ tool: 'claude-cli', sessions: 0, last: daysAgo(40) }],
    unknown: [{ tool: 'codex-cli', sessions: 0, cantSay: 'no-record' }],
    never: [{ tool: 'claude-cli', sessions: 0 }],
  };
  const usage = (each: ItemRow): RowUsage => {
    const says = saysByKey[each.key] ?? [], figure = rowFigure(says, ['claude-cli', 'codex-cli']);
    return figure && 'used' in figure ? { sessions: figure.sessions, at: Date.parse(figure.used) } : { at: lastUse(says) };
  };
  const rows = [row('unknown'), row('old'), row('never'), row('used')];
  assert.deepEqual(keys(inOrder(rows, 'most-used', from({}), usage)), ['used', 'never', 'old', 'unknown']);
  assert.deepEqual(keys(inOrder(rows, 'used', from({}), usage)), ['used', 'old', 'never', 'unknown']);
  // With usage not collected at all, every row has no figure and the whole list is by name.
  assert.deepEqual(keys(inOrder(rows, 'most-used', from({}), () => undefined)), ['never', 'old', 'unknown', 'used']);
  // A direct RowUsage with sessions: 0 still counts as no figure under Most used (goes by name, not ahead by its older time).
  assert.deepEqual(keys(inOrder([row('zebra'), row('alpha')], 'most-used', from({}), each => (each.key === 'zebra' ? { sessions: 0, at: Date.parse(daysAgo(40)) } : undefined))), ['alpha', 'zebra']);
});

test('By most used: pinned rows keep their count and tie-breaking time until unpinned, and byUsage marks usage orders', () => {
  assert.deepEqual((['name', 'updated', 'used', 'most-used'] as const).map(byUsage), [false, false, true, true]);
  const rows = [row('alpha'), row('beta'), row('gamma')];
  // Before any reading lands, every row is pinned with no rank: once a reading lands, they stay by name until unpinned.
  const beforeFirst = pinsOn(noPins<string>(), 'Library by most-used');
  for (const each of rows) pin(beforeFirst, rowId(each.kind, each.key), 'on', rankIn(each, 'most-used', from({}), () => undefined));
  const firstReading: Record<string, RowUsage> = {
    alpha: { sessions: 3, at: Date.parse(daysAgo(2)) },
    beta: { sessions: 7, at: Date.parse(daysAgo(1)) },
    gamma: { sessions: 12, at: Date.parse(daysAgo(3)) },
  };
  assert.deepEqual(keys(inOrder(rows, 'most-used', from({}), each => firstReading[each.key], beforeFirst)), ['alpha', 'beta', 'gamma']);
  assert.deepEqual(keys(inOrder(rows, 'most-used', from({}), each => firstReading[each.key])), ['gamma', 'beta', 'alpha']);
  // Already ordered by Most used (alpha and beta tied at 5, alpha newer; gamma uncounted): an update raises gamma and makes beta newer.
  const earlier: Record<string, RowUsage | undefined> = {
    alpha: { sessions: 5, at: Date.parse(daysAgo(1)) },
    beta: { sessions: 5, at: Date.parse(daysAgo(7)) },
    gamma: undefined,
  };
  const held = pinsOn(noPins<string>(), 'Library by most-used');
  for (const each of rows) pin(held, rowId(each.kind, each.key), 'on', rankIn(each, 'most-used', from({}), row => earlier[row.key]));
  const updated: Record<string, RowUsage> = {
    alpha: { sessions: 5, at: Date.parse(daysAgo(1)) },
    beta: { sessions: 5, at: Date.parse(daysAgo(0)) },
    gamma: { sessions: 10, at: Date.parse(daysAgo(0)) },
  };
  assert.deepEqual(keys(inOrder(rows, 'most-used', from({}), each => updated[each.key], held)), ['alpha', 'beta', 'gamma']);
  assert.deepEqual(keys(inOrder(rows, 'most-used', from({}), each => updated[each.key])), ['gamma', 'beta', 'alpha']);
});
