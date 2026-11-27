// Library Used cell words by Sort (matrix.ts usedCellWords), tool-tab single mark, Mark key disclosure, section jump and docked description priority.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayWords, DAY_MS } from '../src/model.ts';
import { newItem, type LibraryItem } from '../src/library.ts';
import type { RowOrder } from '../src/itemrow.ts';
import type { HarnessId, HomeView, LibraryFacts, ToolCopy } from '../src/types.ts';
import { findById, installDom, textOf, type FakeNode } from './domstub.ts';

installDom({});
// In the order the page's entry (renderer.ts) loads them: settingspage.ts first, before matrix.ts.
await import('../src/settingspage.ts');
const { state: app, unpin } = await import('../src/app.ts');
const { runAfterLayout } = await import('../src/dom.ts');
const { itemsTable, libraryTable, openKind, skillsBrowser, usedCellWords } = await import('../src/matrix.ts');

const findAll = (node: unknown, match: (el: FakeNode) => boolean, out: FakeNode[] = []): FakeNode[] => {
  if (!node || typeof node !== 'object') return out;
  const el = node as FakeNode;
  if (el.tag && match(el)) out.push(el);
  for (const child of el.children ?? []) findAll(child, match, out);
  return out;
};

const FIVE: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli'];
const OLD_AT = '2026-09-01T00:00:00.000Z';
const makeCopy = (name: string, hash = `h-${name}`): ToolCopy => ({
  hash, directory: `/home/.claude/skills/${name}`, rootLabel: '~/.claude/skills', lines: 4, modified: OLD_AT, summary: `The ${name} skill.`, writable: true, folder: name,
});
const makeItem = (key: string, on: boolean, except: HarnessId[] = []): LibraryItem => ({
  ...newItem(key, key), on, except,
  applied: on ? Object.fromEntries(FIVE.filter(tool => !except.includes(tool)).map(tool => [tool, `h-${key}`])) : {},
  versions: [{ hash: `h-${key}`, at: OLD_AT, from: { how: 'found', harness: 'claude-cli' } }],
});
const makeFact = (key: string, overrides: Partial<LibraryFacts> = {}): LibraryFacts => ({
  key, name: key, description: `Desc for ${key}.`, copies: {}, on: false, except: [], cannot: {}, edited: [], ...overrides,
});

function makeFiveToolHome(skills: LibraryFacts[], library: Record<string, LibraryItem>, pluginItems: HomeView['pluginItems'] = []): HomeView {
  const empty = { tools: FIVE, items: [] as LibraryFacts[], library: {} as Record<string, LibraryItem>, access: { allowed: true }, gate: { state: 'ready' as const }, problems: [], notices: [], unread: [] };
  return {
    home: '/toolpage-t1-unit',
    mode: 'actual',
    label: 'Test home',
    syncOn: true,
    snapshots: FIVE.map(harness => ({ harness, root: `/home/.${harness}`, discovery: 'found', detection: 'Installed', probe: { version: '1.0.0', detail: '' }, skills: [], issues: [] })),
    sync: { managed: FIVE, present: FIVE, leftOut: [], access: { allowed: true }, gate: { state: 'ready' }, syncEverything: false, caughtUp: [] },
    skills: { ...empty, items: skills, library },
    mcp: empty,
    agents: empty,
    pluginItems,
    profiles: { profiles: [], plugins: [] },
  } as unknown as HomeView;
}

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

test('tool tab shows only this tool’s mark, folds the key behind Mark key, keeps global switch labels and full details, while Library and Files keep all tool marks', () => {
  const onSkill = makeFact('alpha', {
    on: true,
    except: ['codex-cli'],
    copies: { 'claude-cli': makeCopy('alpha'), 'copilot-cli': makeCopy('alpha'), 'pi-cli': makeCopy('alpha') },
    anotherWay: { 'opencode-cli': 'OpenCode reads Claude Code’s skills folder.' },
    loads: { 'opencode-cli': { folder: 'alpha', name: 'alpha', skillFile: '/home/.claude/skills/alpha/SKILL.md', in: 'claude-cli', switchedOff: false } },
    plan: { orderProved: true, keep: [], write: [], remove: [], forget: [], current: ['claude-cli', 'copilot-cli', 'pi-cli'], ownCopy: [] },
  });
  const foundSkill = makeFact('found-one', {
    copies: { 'claude-cli': makeCopy('found-one') },
    takeInAnswers: {
      click: { take: { harness: 'claude-cli', hash: 'h-found-one', at: Date.parse(OLD_AT) }, chosen: false },
      rule: { take: { harness: 'claude-cli', hash: 'h-found-one', at: Date.parse(OLD_AT) }, chosen: false },
    },
  });
  const awaySkill = makeFact('other-only', {
    copies: { 'copilot-cli': makeCopy('other-only') },
    takeInAnswers: {
      click: { take: { harness: 'copilot-cli', hash: 'h-other-only', at: Date.parse(OLD_AT) }, chosen: false },
      rule: { take: { harness: 'copilot-cli', hash: 'h-other-only', at: Date.parse(OLD_AT) }, chosen: false },
    },
  });
  const offSkill = makeFact('off-one');
  const library = { alpha: makeItem('alpha', true, ['codex-cli']), 'off-one': makeItem('off-one', false) };
  const pluginItems: HomeView['pluginItems'] = [
    { tool: 'claude-cli', plugin: 'kit', source: '/market', marketName: 'team', off: false, listed: true, items: [{ kind: 'skill', name: 'triage', description: 'Triages.' }] },
    { tool: 'copilot-cli', plugin: 'kit', source: '/market', marketName: 'team', off: false, listed: true, items: [{ kind: 'skill', name: 'triage', description: 'Triages.' }] },
  ];

  app.home = makeFiveToolHome([onSkill, foundSkill, awaySkill, offSkill], library, pluginItems);
  unpin();

  // Tool tab (Claude Code): 1 mark per ordinary and plugin row, Mark key disclosure closed, global switch labels intact.
  const tabTree = itemsTable('skills', 'claude-cli') as unknown as FakeNode;
  const alphaRow = findAll(tabTree, el => el.attrs['data-key'] === 'skills-alpha')[0]!;
  const pluginRow = findAll(tabTree, el => el.className.split(/\s+/).includes('ov-plugin-row'))[0]!;
  assert.deepEqual(findAll(alphaRow, el => el.className.split(/\s+/).includes('tool-mark')).map(el => el.dataset.tool), ['claude-cli']);
  assert.deepEqual(findAll(pluginRow, el => el.className.split(/\s+/).includes('tool-mark')).map(el => el.dataset.tool), ['claude-cli']);
  const alphaSwitch = findById(tabTree, 'switch-skills-alpha')!;
  assert.equal(alphaSwitch.attrs['aria-label'], 'alpha: on in 4 of 5 tools. Click to take it out of every tool; Central Knot keeps it.');
  const pluginSwitch = findAll(pluginRow, el => el.attrs.role === 'switch')[0]!;
  assert.match(pluginSwitch.attrs['aria-label'] ?? '', /every tool that can switch it/);

  const legendFold = findById(tabTree, 'mark-legend');
  assert.ok(legendFold && legendFold.tag === 'details', 'tool tab wraps key in a <details id="mark-legend"> disclosure');
  assert.equal('open' in legendFold.attrs, false, 'Mark key starts closed');
  assert.equal(textOf(findById(tabTree, 'mark-legend-toggle')), 'Mark key');
  const legendItems = findAll(legendFold, el => el.className.split(/\s+/).includes('legend-item')).map(el => textOf(el));
  assert.ok(legendItems.includes('Has the current version') && legendItems.includes('No copy') && legendItems.includes('Off: Central Knot keeps it') && legendItems.includes('On there'));
  assert.equal(legendItems.includes('Has it another way, not from Central Knot'), false, 'only states drawn on this tool tab appear in its key');

  // Opening a row on the tool tab still shows all 5 tools' lines, with Claude Code first.
  findById(tabTree, 'open-skills-alpha')!.click();
  const openedTabTree = itemsTable('skills', 'claude-cli') as unknown as FakeNode;
  const detailTools = findAll(openedTabTree, el => el.className.split(/\s+/).includes('details-tool-label')).map(el => textOf(el));
  assert.deepEqual(detailTools, ['Claude Code', 'Copilot CLI', 'Codex', 'Pi', 'OpenCode']);
  findById(openedTabTree, 'open-skills-alpha')!.click();

  // Section jump derives its labels and counts from drawn sections (5 sections -> 5 buttons).
  const jump = findAll(tabTree, el => el.className.split(/\s+/).includes('section-jump'))[0];
  assert.ok(jump, 'tool tab renders section jump when multiple sections are drawn');
  assert.deepEqual(findAll(jump, el => el.className.split(/\s+/).includes('section-jump-btn')).map(el => textOf(el)),
    ['On1', 'Found1', 'Only through a plugin1', 'Not in Claude Code1', 'Off1']);

  // Library keeps all 5 tool marks, open key (no Mark key fold), and no section jump.
  openKind('skills');
  const libTree = libraryTable() as unknown as FakeNode;
  const libAlpha = findAll(libTree, el => el.attrs['data-key'] === 'skills-alpha')[0]!;
  const libPlugin = findAll(libTree, el => el.className.split(/\s+/).includes('ov-plugin-row'))[0]!;
  assert.equal(findAll(libAlpha, el => el.className.split(/\s+/).includes('tool-mark')).length, 5);
  assert.equal(findAll(libPlugin, el => el.className.split(/\s+/).includes('tool-mark')).length, 5);
  assert.equal(findById(libTree, 'mark-legend'), undefined);
  assert.ok(findAll(libTree, el => el.className.split(/\s+/).includes('legend-item')).map(el => textOf(el)).includes('Has it another way, not from Central Knot'));
  assert.equal(findAll(libTree, el => el.className.split(/\s+/).includes('section-jump')).length, 0);

  // Files view (rowMarks second caller) keeps all 5 tool marks.
  const filesTree = skillsBrowser(() => ({ where: [], contents: [] }), () => {}) as unknown as FakeNode;
  const firstListRow = findAll(filesTree, el => el.className.split(/\s+/).includes('list-row'))[0]!;
  assert.equal(findAll(firstListRow, el => el.className.split(/\s+/).includes('tool-mark')).length, 5);

  // Single-section tool tab omits the section jump.
  app.home = makeFiveToolHome([onSkill], { alpha: library.alpha });
  const singleTree = itemsTable('skills', 'claude-cli') as unknown as FakeNode;
  assert.equal(findAll(singleTree, el => el.className.split(/\s+/).includes('section-jump')).length, 0);
});

test('settleDescriptions prioritizes full filenames over descriptions when docked, while keeping name-cut on undocked tables', () => {
  const runSettle = (docked: boolean) => {
    const tableClasses = new Set<string>();
    const cellClasses = new Set<string>();
    const main = { offsetWidth: 320 };
    const cell = {
      clientWidth: 460,
      classList: {
        add: (name: string) => cellClasses.add(name),
        remove: (name: string) => cellClasses.delete(name),
      },
      querySelector: (sel: string) => (sel === '.ov-name-main' ? main : null),
    };
    const about = {
      offsetTop: 0,
      offsetHeight: 40,
      get clientWidth() { return cellClasses.has('name-cut') ? 210 : 60; },
      parentElement: cell,
    };
    const table = {
      classList: {
        remove: (name: string) => tableClasses.delete(name),
        toggle: (name: string, on: boolean) => { if (on) tableClasses.add(name); else tableClasses.delete(name); },
        contains: (name: string) => tableClasses.has(name),
      },
      closest: (sel: string) => (docked && sel === '.docked' ? {} : null),
      querySelectorAll: (sel: string) => (sel === '.ov-name-about' ? [about] : sel === '.name-cut' ? (cellClasses.has('name-cut') ? [cell] : []) : []),
    };
    const prevAll = document.querySelectorAll;
    (document as unknown as { querySelectorAll: (sel: string) => unknown[] }).querySelectorAll = (sel: string) => (sel === '.ov' ? [table] : []);
    try { runAfterLayout(); } finally { (document as unknown as { querySelectorAll: typeof prevAll }).querySelectorAll = prevAll; }
    return { nameCut: cellClasses.has('name-cut'), noAbout: tableClasses.has('no-about') };
  };
  assert.deepEqual(runSettle(false), { nameCut: true, noAbout: false });
  assert.deepEqual(runSettle(true), { nameCut: false, noAbout: true });
});
