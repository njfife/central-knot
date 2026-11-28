// Library Used cell words by Sort (matrix.ts usedCellWords), row-hiding rules (matrix.ts tableOf), tool-tab single mark, Mark key disclosure, section jump and docked description priority.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayWords, DAY_MS } from '../src/model.ts';
import { newItem, type LibraryItem } from '../src/library.ts';
import type { RowOrder } from '../src/itemrow.ts';
import { pluginLink } from '../src/sourcelink.ts';
import type { HarnessId, HomeView, ItemNotice, LibraryFacts, ToolCopy } from '../src/types.ts';
import { findById, installDom, textOf, type FakeNode } from './domstub.ts';

let nextRefresh: (() => Promise<HomeView | null>) | undefined;
let nextSearch: ((text: string) => Promise<{ ready: boolean; home: string; rows: { id: string }[] }>) | undefined;
const { dispatch } = installDom({
  refresh: () => (nextRefresh ? nextRefresh() : Promise.resolve(null)),
  search: (text: string) => (nextSearch ? nextSearch(text) : Promise.resolve({ ready: false, home: '', rows: [] })),
});
// In the order the page's entry (renderer.ts) loads them: settingspage.ts first, before matrix.ts.
await import('../src/settingspage.ts');
const { oweHomeRead, readHomeOnce, setRenderer, state, unpin } = await import('../src/app.ts');
const { runAfterLayout } = await import('../src/dom.ts');
const { headerNotices, itemsTable, libraryTable, listResult, noticeKindsShown, openKind, rowByKey, skillsBrowser, usedCellWords } = await import('../src/matrix.ts');
const app = state;

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
    assert.deepEqual(usedCellWords({ noneSeen: true }, order), { text: 'no use seen', hover: 'No use seen in 30 days.' });
    assert.deepEqual(usedCellWords({ noneSeen: true, since: sinceAt }, order), { text: 'no use seen', hover: `No use seen · records from ${since}.` });
    assert.deepEqual(usedCellWords(undefined, order), { text: 'use unknown', hover: 'No tool that has it on can tell whether it was used.' });
  }
});

test('tool tab shows only this tool’s mark, folds the key behind Mark key, keeps global switch labels and full details, while Library and Files keep all tool marks', () => {
  setRenderer(() => {});
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

const emptyKind = (tools: HarnessId[]) => ({ tools, items: [], library: {}, notices: [], gate: { state: 'open' }, unread: [], problems: [], access: { allowed: true } });

function makeHome(homePath: string, skills: Record<string, unknown>[], library: Record<string, unknown> = {}, notices: ItemNotice[] = []): HomeView {
  const tools: HarnessId[] = ['claude-cli', 'copilot-cli'];
  return {
    home: homePath, label: 'Test', syncOn: true, mode: 'fixture', readId: 1, snapshots: [],
    sync: { managed: tools, present: tools, caughtUp: [], gate: { state: 'open' }, access: { allowed: true } },
    skills: { ...emptyKind(tools), items: skills, library, notices },
    mcp: emptyKind(tools),
    agents: emptyKind(tools),
    pluginItems: [],
  } as unknown as HomeView;
}

const fromSelect = (tree: unknown, value: string) => {
  const select = findById(tree, 'item-from') as (FakeNode & { onchange?: (event: unknown) => void }) | undefined;
  assert.ok(select?.onchange, 'From select is drawn');
  select.onchange({ target: { value } });
};

test('hiding an open differing row with From clears comparing before header reads listResult and headerNotices', () => {
  setRenderer(() => {});
  const packLink = pluginLink('pack', 'team');
  const notice: ItemNotice = { kind: 'edit', key: 'alpha', item: 'alpha', history: 'ev-alpha', winner: 'claude-cli', losers: [], orderProved: true };
  state.home = makeHome('/tmp/matrix-header-rule', [
    { key: 'alpha', name: 'alpha', description: 'Alpha skill.', copies: { 'claude-cli': { hash: 'h1', directory: '/a' }, 'copilot-cli': { hash: 'h2', directory: '/b' } }, hashes: { 'claude-cli': 'h1', 'copilot-cli': 'h2' }, except: [], fromSource: { link: packLink, title: 'pack', waits: false, removed: false }, takeInAnswers: { click: { wait: 'differs' }, rule: { wait: 'differs' } } },
    { key: 'beta', name: 'beta', description: 'Beta skill.', copies: { 'claude-cli': { hash: 'h3', directory: '/c' } }, hashes: { 'claude-cli': 'h3' }, except: [] },
  ], {}, [notice]);
  Object.assign(state, { page: 'library', libraryKind: 'skills', libraryView: 'list', visit: 10, shownWhole: undefined });
  openKind('skills');
  state.said.seq = 1;
  state.outcome = { page: 'library', text: 'Earlier result for alpha.', rows: [{ kind: 'skills', key: 'alpha' }], said: 1, act: { label: 'Undo', id: 'outcome-undo', run: () => {} } };
  const first = libraryTable();
  state.said.seq = 2;
  findById(first, 'open-skills-alpha')?.click();
  // Open the Notices card so syncNotice draws alpha's name as whole (button when closed, strong when open).
  headerNotices(false)?.control.click();
  assert.equal(listResult().length, 0, 'older result steps aside while alpha copy question is open');
  assert.equal(findById(headerNotices(false)?.lines, 'notice-open-ev-alpha'), undefined, 'open row name is not a link while open');
  // Now hide alpha via From: Your own, and read header BEFORE libraryTable() (as renderer.ts renderHeader precedes renderPage).
  const drawn = libraryTable();
  fromSelect(drawn, 'yours');
  const headerAfter = listResult();
  const noticesAfter = headerNotices(false);
  assert.ok(headerAfter.some(band => textOf(band).includes('Earlier result for alpha.')), 'result shows immediately in header once From hides the open row');
  assert.ok(findById(noticesAfter?.lines, 'notice-open-ev-alpha'), 'notice name links immediately in header once From hides the open row');
});

test('hiding a closed row with an armed Delete disarms it so reopening it does not show Delete it now', () => {
  setRenderer(() => {});
  const packLink = pluginLink('pack', 'team');
  const libItem = { ...newItem('alpha', 'alpha'), on: true, hash: 'h1', applied: { 'claude-cli': 'h1' } };
  state.home = makeHome('/tmp/matrix-armed-delete', [
    { key: 'alpha', name: 'alpha', description: 'Alpha skill.', on: true, copies: { 'claude-cli': { hash: 'h1', directory: '/a' } }, hashes: { 'claude-cli': 'h1' }, except: [], fromSource: { link: packLink, title: 'pack', waits: false, removed: false } },
    { key: 'beta', name: 'beta', description: 'Beta skill.', on: true, copies: { 'claude-cli': { hash: 'h3', directory: '/c' } }, hashes: { 'claude-cli': 'h3' }, except: [] },
  ], { alpha: libItem });
  Object.assign(state, { page: 'library', libraryKind: 'skills', libraryView: 'list', visit: 20, shownWhole: undefined, outcome: undefined });
  openKind('skills');
  // Open alpha and arm Delete.
  findById(libraryTable(), 'open-skills-alpha')?.click();
  findById(libraryTable(), 'delete-skills-alpha')?.click();
  assert.ok(findById(libraryTable(), 'delete-confirm-skills-alpha'), 'Delete it now is armed');
  // Close alpha's details, hide alpha with From: Your own, draw, restore From: Anywhere, reopen alpha.
  findById(libraryTable(), 'open-skills-alpha')?.click();
  fromSelect(libraryTable(), 'yours');
  libraryTable();
  fromSelect(libraryTable(), 'anywhere');
  findById(libraryTable(), 'open-skills-alpha')?.click();
  const reopened = libraryTable();
  assert.equal(findById(reopened, 'delete-confirm-skills-alpha'), undefined, 'armed Delete is disarmed after hidden while closed');
  assert.ok(findById(reopened, 'delete-skills-alpha'), 'quiet Delete… button is shown again');
});

test('tableOf skips drawnRows when nothing is open, armed or viewing a file, and still reconciles when a row is open', () => {
  setRenderer(() => {});
  let originReads = 0;
  const alpha = { key: 'alpha', name: 'alpha', description: 'Alpha skill.', copies: { 'claude-cli': { hash: 'h1', directory: '/a' } }, hashes: { 'claude-cli': 'h1' }, except: [] };
  state.home = makeHome('/tmp/matrix-cost-nothing', [alpha]);
  Object.assign(state, { page: 'library', libraryKind: 'skills', libraryView: 'list', visit: 25, shownWhole: undefined, outcome: undefined });
  openKind('skills');
  // Warm pluginsHere's WeakMap cache and factsCache on this home, then instrument the cached row's fromSource.
  libraryTable();
  const cached = rowByKey('skills', 'alpha')!;
  Object.defineProperty(cached, 'fromSource', { enumerable: true, configurable: true, get() { originReads++; return undefined; } });
  originReads = 0;
  listResult();
  headerNotices(false);
  noticeKindsShown();
  assert.equal(originReads, 0, 'tableOf does not run drawnRows when nothing is open, armed or viewing a file');
  // Opening a row makes tableOf run the reconcile again.
  findById(libraryTable(), 'open-skills-alpha')?.click();
  originReads = 0;
  listResult();
  headerNotices(false);
  noticeKindsShown();
  assert.equal(originReads, 3, 'tableOf still reconciles across header and sidebar calls when a row is open');
});

test('Escape while Library Find’s answer is still out keeps an open body-matched row open', async () => {
  setRenderer(() => {});
  const alpha = { key: 'alpha', name: 'alpha', description: 'Alpha skill.', copies: { 'claude-cli': { hash: 'h1', directory: '/a' } }, hashes: { 'claude-cli': 'h1' }, except: [] };
  const beta = { key: 'beta', name: 'beta', description: 'Beta skill.', copies: { 'claude-cli': { hash: 'h3', directory: '/c' } }, hashes: { 'claude-cli': 'h3' }, except: [] };
  state.home = makeHome('/tmp/matrix-escape-find', [alpha, beta]);
  Object.assign(state, { page: 'library', libraryKind: 'skills', libraryView: 'list', visit: 28, shownWhole: undefined, outcome: undefined });
  openKind('skills');
  findById(libraryTable(), 'open-skills-alpha')?.click();
  assert.equal(findById(libraryTable(), 'open-skills-alpha')?.attrs['aria-expanded'], 'true', 'alpha starts open');
  let reply: ((answer: { ready: boolean; home: string; rows: { id: string }[] }) => void) | undefined;
  nextSearch = () => new Promise(resolve => { reply = resolve; });
  try {
    const input = findById(libraryTable(), 'find') as (FakeNode & { oninput?: (event: unknown) => void }) | undefined;
    assert.ok(input?.oninput, 'Find input is drawn');
    // Type text matching only in alpha's body (not key or description); main has not answered yet.
    input.oninput({ target: { value: 'bodyneedle' } });
    assert.ok(reply, 'Library Find sent a search request to main');
    dispatch('keydown', { key: 'Escape', target: { id: 'find' } });
    const afterEscape = libraryTable();
    assert.equal(findById(afterEscape, 'open-skills-alpha')?.attrs['aria-expanded'], 'true', 'Escape while Find’s answer is still out keeps the open row open');
    reply({ ready: true, home: '/tmp/matrix-escape-find', rows: [] });
    await new Promise(done => setImmediate(done));
    // Once Find actually receives an answer excluding alpha (without Escape), alpha closes and stays closed once Find is cleared.
    const inputAgain = findById(libraryTable(), 'find') as (FakeNode & { oninput?: (event: unknown) => void }) | undefined;
    inputAgain?.oninput?.({ target: { value: 'nomatch' } });
    reply?.({ ready: true, home: '/tmp/matrix-escape-find', rows: [] });
    await new Promise(done => setImmediate(done));
    assert.equal(findById(libraryTable(), 'open-skills-alpha'), undefined, 'answered Find hides alpha');
    dispatch('keydown', { key: 'Escape', target: { id: 'find' } });
    assert.equal(findById(libraryTable(), 'open-skills-alpha')?.attrs['aria-expanded'], 'false', 'answered Find closed alpha so clearing Find leaves it closed');
  } finally {
    nextSearch = undefined;
  }
});

test('openKind with a key not yet in state.home awaits the owed home read and opens through reveal even under From: Your own', async () => {
  setRenderer(() => {});
  const packLink = pluginLink('pack', 'team');
  const beta = { key: 'beta', name: 'beta', description: 'Beta skill.', copies: { 'claude-cli': { hash: 'h3', directory: '/c' } }, hashes: { 'claude-cli': 'h3' }, except: [] };
  const fromPlugin = { key: 'from-plugin', name: 'from-plugin', description: 'New plugin skill.', copies: { 'claude-cli': { hash: 'h4', directory: '/d' } }, hashes: { 'claude-cli': 'h4' }, except: [], fromSource: { link: packLink, title: 'pack', waits: false, removed: false } };
  const homeBefore = makeHome('/tmp/matrix-waiting-open', [beta]);
  const homeAfter = makeHome('/tmp/matrix-waiting-open', [beta, fromPlugin]);
  const homeGone = makeHome('/tmp/matrix-waiting-open', [beta]);
  state.home = homeBefore;
  Object.assign(state, { page: 'library', libraryKind: 'skills', libraryView: 'list', visit: 30, shownWhole: undefined, outcome: undefined });
  openKind('skills');
  // Leave the Library filtered to From: Your own (which hides plugin-sourced rows).
  fromSelect(libraryTable(), 'yours');
  libraryTable();
  let resolveRefresh: ((view: HomeView | null) => void) | undefined;
  let refreshCalls = 0;
  nextRefresh = () => { refreshCalls++; return new Promise<HomeView | null>(resolve => { resolveRefresh = resolve; }); };
  try {
    // Plugin page enables a plugin (oweHomeRead + in-flight readHomeOnce) and user follows Its items link before refresh lands.
    state.page = 'plugins';
    oweHomeRead();
    const readDone = readHomeOnce();
    openKind('skills', { key: 'from-plugin' });
    // Intermediate render on homeBefore before refresh lands.
    listResult();
    libraryTable();
    // Owed home read returns homeAfter (containing from-plugin): reveal lets go of From: Your own and opens it.
    resolveRefresh!(homeAfter);
    await readDone;
    await new Promise(done => setImmediate(done));
    const arrived = libraryTable();
    assert.equal(refreshCalls, 1, 'shares the in-flight readHomeOnce instead of starting a second refresh');
    assert.equal(findById(arrived, 'open-skills-from-plugin')?.attrs['aria-expanded'], 'true', 'row opens through reveal once the owed home read brings it');
    // Once open, if a later read removes it and another brings it back, it closes instead of reopening.
    state.home = homeGone;
    libraryTable();
    state.home = homeAfter;
    const backAgain = libraryTable();
    assert.equal(findById(backAgain, 'open-skills-from-plugin')?.attrs['aria-expanded'], 'false', 'row stays closed once a read genuinely dropped it');
    // When owed read resolves without the requested item, nothing opens and From stays untouched.
    fromSelect(libraryTable(), 'yours');
    libraryTable();
    state.page = 'plugins';
    oweHomeRead();
    openKind('skills', { key: 'never-there' });
    resolveRefresh!(homeAfter);
    await new Promise(done => setImmediate(done));
    const missing = libraryTable();
    assert.equal(findById(missing, 'open-skills-from-plugin'), undefined, 'From: Your own stays untouched when the owed read does not hold the requested row');
  } finally {
    nextRefresh = undefined;
  }
});
