// Library Used cell words by Sort (matrix.ts usedCellWords), reload step rendering (reloadLines, reloadChips), row-hiding rules (matrix.ts tableOf), tool-tab single mark, What the marks mean disclosure, section jump and docked description priority.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayWords, DAY_MS } from '../src/model.ts';
import { newItem, type LibraryItem } from '../src/library.ts';
import type { RowOrder } from '../src/itemrow.ts';
import { reloadAdvice } from '../src/reload.ts';
import type { Outcome } from '../src/app.ts';
import { pluginLink } from '../src/sourcelink.ts';
import type { HarnessId, HomeView, ItemNotice, LibraryFacts, ToolCopy } from '../src/types.ts';
import { findById, findNode, installDom, textOf, type FakeNode } from './domstub.ts';

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
const { backFromFiles, headerNotices, itemsTable, libraryTable, listResult, noticeKindsShown, openFiles, openKind, reloadChips, reloadLines, rowByKey, skillsBrowser, unshownReloadRows, usedCellWords } = await import('../src/matrix.ts');
const { pluginsResult, runBand } = await import('../src/pluginspage.ts');
const { market } = await import('../src/pluginstate.ts');
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
    home: '/tool-page-unit',
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

function installFiveToolFixture() {
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
  return { onSkill, library };
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

test('reloadLines says each command once paired with its own note, distinguishes command rows from plain-text steps, and keeps secondary commands and desktop caveats', () => {
  // Five-tool skill write: Claude Code needs no reload, leaving four tools' steps.
  const fourSkill = reloadAdvice([
    { tool: 'claude-cli', kind: 'skill', key: 'draft-rfc', on: true },
    { tool: 'copilot-cli', kind: 'skill', key: 'draft-rfc', on: true },
    { tool: 'codex-cli', kind: 'skill', key: 'draft-rfc', on: true },
    { tool: 'pi-cli', kind: 'skill', key: 'draft-rfc', on: true },
    { tool: 'antigravity-cli', kind: 'skill', key: 'draft-rfc', on: true },
  ]);
  const view = reloadLines(fourSkill, 'whole') as unknown as FakeNode;
  const rows = findAll(view, el => el.className.split(/\s+/).includes('reload-row'));
  const partShape = (el: FakeNode): unknown => (
    el.tag === 'button' ? ['button', textOf(el), el.attrs['data-copy']]
      : el.className === 'reload-cmd-part' ? ['reload-cmd-part', (el.children ?? []).map(child => partShape(child as FakeNode))]
      : [el.className, textOf(el)]
  );
  const rowShape = (row: FakeNode) => ({
    cmdRow: row.className.split(/\s+/).includes('reload-row-cmd'),
    parts: (row.children ?? []).map(child => partShape(child as FakeNode)),
  });
  assert.deepEqual(rows.map(rowShape), [
    { cmdRow: true, parts: [['button', 'Copilot CLI: /skills reload', '/skills reload']] },
    { cmdRow: false, parts: [['reload-row-text', 'Codex picks it up at the next turn; if not, start a new chat.']] },
    { cmdRow: true, parts: [['button', 'Pi: /reload', '/reload']] },
    { cmdRow: true, parts: [['button', 'Antigravity: /skills reload', '/skills reload'], ['reload-row-note', 'Optional: it only refreshes the CLI’s slash menu.']] },
  ]);
  // Secondary command + desktop app caveat (Codex MCP both + Claude MCP both): each command paired with its purpose and grouped before "or" on wrap.
  const bothMcp = reloadAdvice([
    { tool: 'claude-cli', kind: 'mcp', key: 'docs', on: true },
    { tool: 'codex-cli', kind: 'mcp', key: 'docs', on: true },
  ], { 'claude-cli': 'both', 'codex-cli': 'both' });
  const mcpRows = findAll(reloadLines(bothMcp, 'whole') as unknown as FakeNode, el => el.className.split(/\s+/).includes('reload-row'));
  assert.deepEqual(mcpRows.map(rowShape), [
    { cmdRow: true, parts: [['button', 'Claude Code: claude --continue', 'claude --continue'], ['reload-row-note', 'Restart (keeps the chat), or restart Claude desktop.']] },
    { cmdRow: true, parts: [
      ['button', 'Codex: /new', '/new'], ['reload-row-note', 'for a new chat,'],
      ['reload-cmd-part', [
        ['reload-row-note', 'or'],
        ['button', 'codex resume --last', 'codex resume --last'],
        ['reload-row-note', 'to restart and keep the chat; restart the ChatGPT desktop app if it is open.'],
      ]],
    ] },
  ]);
});

test('reloadLines folds from exactly 3 shown steps on every page band (including Instructions runBand), keeps header whole unfolded, and counts unshown tool rows once per tool', () => {
  const outcomeA: Outcome = { page: 'history', text: 'Done A.' };
  const outcomeB: Outcome = { page: 'history', text: 'Done B.' };
  // 2 shown steps from 3 raw writes -> inline, no disclosure.
  const twoShown = reloadAdvice([
    { tool: 'claude-cli', kind: 'skill', key: 'notes', on: true },
    { tool: 'copilot-cli', kind: 'skill', key: 'notes', on: true },
    { tool: 'pi-cli', kind: 'skill', key: 'notes', on: true },
  ]);
  const inline = reloadLines(twoShown, outcomeA) as unknown as FakeNode;
  assert.equal(inline.tag, 'div');
  assert.equal(findById(inline, 'outcome-reloads-fold'), undefined);
  // Exactly 3 shown steps -> folds behind Reload steps (3).
  const threeShown = reloadAdvice([
    { tool: 'claude-cli', kind: 'skill', key: 'notes', on: true },
    { tool: 'copilot-cli', kind: 'skill', key: 'notes', on: true },
    { tool: 'codex-cli', kind: 'skill', key: 'notes', on: true },
    { tool: 'pi-cli', kind: 'skill', key: 'notes', on: true },
  ]);
  const foldedThree = reloadLines(threeShown, outcomeA) as unknown as FakeNode;
  assert.equal(foldedThree.tag, 'details');
  assert.equal(foldedThree.attrs.id, 'outcome-reloads-fold');
  assert.equal(textOf(findById(foldedThree, 'outcome-reloads-toggle')), 'Reload steps (3)');
  // 4 shown steps -> folds behind Reload steps (4); open state persists per owner and resets for a new owner.
  const fourShown = reloadAdvice([
    { tool: 'claude-cli', kind: 'skill', key: 'draft-rfc', on: true },
    { tool: 'copilot-cli', kind: 'skill', key: 'draft-rfc', on: true },
    { tool: 'codex-cli', kind: 'skill', key: 'draft-rfc', on: true },
    { tool: 'pi-cli', kind: 'skill', key: 'draft-rfc', on: true },
    { tool: 'antigravity-cli', kind: 'skill', key: 'draft-rfc', on: true },
  ]);
  const folded = reloadLines(fourShown, outcomeA) as unknown as FakeNode;
  assert.equal(folded.tag, 'details');
  assert.equal('open' in folded.attrs, false);
  assert.equal(textOf(findById(folded, 'outcome-reloads-toggle')), 'Reload steps (4)');
  (folded as unknown as { open: boolean; ontoggle: (event: { currentTarget: unknown }) => void }).open = true;
  (folded as unknown as { ontoggle: (event: { currentTarget: unknown }) => void }).ontoggle({ currentTarget: folded });
  assert.equal('open' in (reloadLines(fourShown, outcomeA) as unknown as FakeNode).attrs, true);
  assert.equal('open' in (reloadLines(fourShown, outcomeB) as unknown as FakeNode).attrs, false);
  // Header whole result ('whole') never folds; 0 steps returns null.
  assert.equal((reloadLines(fourShown, 'whole') as unknown as FakeNode).tag, 'div');
  assert.equal(reloadLines(reloadAdvice([{ tool: 'claude-cli', kind: 'skill', key: 'notes', on: true }]), outcomeA), null);
  // reloadChips stamps data-reload-rows and per-chip data-reload-tool so +N more counts rows without a chip in sight (one per tool).
  const mcpFour = reloadAdvice([
    { tool: 'claude-cli', kind: 'mcp', key: 'docs', on: true },
    { tool: 'codex-cli', kind: 'mcp', key: 'docs', on: true },
    { tool: 'pi-cli', kind: 'mcp', key: 'docs', on: true },
    { tool: 'opencode-cli', kind: 'mcp', key: 'docs', on: true },
  ]);
  const chipsWithCodex = reloadChips(fourShown, outcomeA) as unknown as FakeNode;
  assert.equal(findById(chipsWithCodex, 'outcome-reload-more')?.attrs['data-reload-rows'], '4');
  assert.deepEqual(
    findAll(chipsWithCodex, el => 'data-reload-tool' in el.attrs).map(el => el.attrs['data-reload-tool']),
    ['copilot-cli', 'pi-cli', 'antigravity-cli'],
  );
  const chipsTwoCmd = reloadChips(mcpFour, outcomeA) as unknown as FakeNode;
  assert.equal(findById(chipsTwoCmd, 'outcome-reload-more')?.attrs['data-reload-rows'], '4');
  assert.deepEqual(
    findAll(chipsTwoCmd, el => 'data-reload-tool' in el.attrs).map(el => el.attrs['data-reload-tool']),
    ['claude-cli', 'codex-cli', 'codex-cli', 'pi-cli', 'opencode-cli'],
  );
  // One unit: unshownReloadRows counts rows Show all opens without a visible chip (chipless row counts even when all chips fit; two hidden commands for one tool count once).
  assert.equal(unshownReloadRows(4, [{ tool: 'copilot-cli', hidden: false }, { tool: 'pi-cli', hidden: false }, { tool: 'antigravity-cli', hidden: false }]), 1);
  assert.equal(unshownReloadRows(5, [
    { tool: 'claude-cli', hidden: false }, { tool: 'copilot-cli', hidden: false },
    { tool: 'codex-cli', hidden: true }, { tool: 'codex-cli', hidden: true },
    { tool: 'pi-cli', hidden: true }, { tool: 'opencode-cli', hidden: true },
  ]), 3);
  assert.equal(unshownReloadRows(5, [
    { tool: 'claude-cli', hidden: false }, { tool: 'copilot-cli', hidden: false },
    { tool: 'codex-cli', hidden: false }, { tool: 'codex-cli', hidden: true },
    { tool: 'pi-cli', hidden: true }, { tool: 'opencode-cli', hidden: true },
  ]), 2);
  assert.equal(unshownReloadRows(2, [{ tool: 'copilot-cli', hidden: false }, { tool: 'pi-cli', hidden: false }]), 0);
  // Instructions runBand follows the same band fold rule (3+ steps fold behind Reload steps (N)), and Plugins header whole places problems before reload rows.
  const prevPage = state.page, prevHome = state.home, prevShown = state.shownWhole, prevOutcome = state.outcome;
  const okStep = (tool: HarnessId) => ({ source: 'm', marketName: 'team', plugin: 'kit', tool, action: 'install-items' as const, report: { tool, outcome: 'installed' as const, changed: true, message: 'ok', runs: [], reloads: [{ tool, kind: 'mcp' as const, key: 'docs', on: true }] } });
  const failStep = { source: 'm', marketName: 'team', plugin: 'bad', tool: 'claude-cli' as const, action: 'install' as const, report: { tool: 'claude-cli' as const, outcome: 'failed' as const, changed: false, message: 'failed', runs: [] } };
  try {
    state.home = makeHome('/tmp/ck-reload-unit', []);
    state.outcome = undefined;
    state.page = 'instructions';
    const insRun = { done: [okStep('claude-cli'), okStep('codex-cli'), okStep('pi-cli')], undo: false, home: '/tmp/ck-reload-unit', place: 'instructions' as const };
    market.lastRun = insRun;
    const insBand = runBand() as unknown as FakeNode;
    assert.equal(findById(insBand, 'outcome-reloads-fold')?.tag, 'details');
    assert.equal(textOf(findById(insBand, 'outcome-reloads-toggle')), 'Reload steps (3)');
    state.page = 'plugins';
    const plugRun = { done: [failStep, okStep('claude-cli'), okStep('codex-cli'), okStep('pi-cli')], undo: false, home: '/tmp/ck-reload-unit', place: 'plugins' as const };
    market.lastRun = plugRun;
    state.shownWhole = market.lastRun;
    const parts = pluginsResult() as unknown as FakeNode[];
    const problemAt = parts.findIndex(part => !!findNode(part, el => el.className.split(/\s+/).includes('problem-line')));
    const reloadAt = parts.findIndex(part => part.className.split(/\s+/).includes('reload-list'));
    assert.ok(problemAt >= 0 && reloadAt > problemAt, `Plugins header whole puts problems (${problemAt}) before reload rows (${reloadAt})`);
    assert.equal(parts.some(part => !!findById(part, 'outcome-reloads-fold')), false, 'Plugins header whole never folds reload rows');
  } finally {
    state.page = 'instructions'; market.lastRun = undefined;
    state.page = 'plugins'; market.lastRun = undefined;
    state.page = prevPage; state.home = prevHome; state.shownWhole = prevShown; state.outcome = prevOutcome;
  }
});

test('tool tab shows only this tool’s mark on ordinary and plugin rows and keeps global switch labels', () => {
  installFiveToolFixture();
  const tabTree = itemsTable('skills', 'claude-cli') as unknown as FakeNode;
  const alphaRow = findAll(tabTree, el => el.attrs['data-key'] === 'skills-alpha')[0]!;
  const pluginRow = findAll(tabTree, el => el.className.split(/\s+/).includes('ov-plugin-row'))[0]!;
  assert.deepEqual(findAll(alphaRow, el => el.className.split(/\s+/).includes('tool-mark')).map(el => el.dataset.tool), ['claude-cli']);
  assert.deepEqual(findAll(pluginRow, el => el.className.split(/\s+/).includes('tool-mark')).map(el => el.dataset.tool), ['claude-cli']);
  assert.equal(findById(tabTree, 'switch-skills-alpha')!.attrs['aria-label'], 'alpha: on in 4 of 5 tools. Click to take it out of every tool; Central Knot keeps it.');
  const pluginSwitch = findAll(pluginRow, el => el.attrs.role === 'switch')[0]!;
  assert.match(pluginSwitch.attrs['aria-label'] ?? '', /every tool that can switch it/);
});

test('tool tab switch column head states Every tool with its info mark and Library omits it', () => {
  installFiveToolFixture();
  const tabTree = itemsTable('skills', 'claude-cli') as unknown as FakeNode;
  const head = findAll(tabTree, el => el.className.split(/\s+/).includes('ov-tab-head'))[0];
  assert.ok(head, 'tool tab renders its switch column head');
  assert.ok(textOf(head).includes('Every tool'));
  assert.ok(findById(head, 'tab-switch-info'), 'Every tool carries its (?) info mark');
  assert.match(textOf(findById(head, 'tab-switch-info-card')), /every tool that can take it/i);

  openKind('skills');
  const libTree = libraryTable() as unknown as FakeNode;
  assert.equal(findAll(libTree, el => el.className.split(/\s+/).includes('ov-tab-head')).length, 0);
});

test('tool tab places What the marks mean by the toolbar with one entry per visual look and keeps every tool in opened details', () => {
  installFiveToolFixture();
  const tabTree = itemsTable('skills', 'claude-cli') as unknown as FakeNode;
  const toolbar = findAll(tabTree, el => el.className.split(/\s+/).includes('toolbar'))[0]!;
  const legendFold = findById(toolbar, 'mark-legend');
  assert.ok(legendFold && legendFold.tag === 'details', 'What the marks mean disclosure sits in the toolbar');
  assert.equal('open' in legendFold.attrs, false, 'What the marks mean starts closed');
  const toggleEl = findById(legendFold, 'mark-legend-toggle')!;
  assert.equal(textOf(toggleEl), 'What the marks mean');
  assert.equal(toggleEl.attrs['aria-controls'], 'mark-legend-body');
  assert.equal(findById(tabTree, 'mark-legend-body'), undefined, 'legend body stays hidden while closed');

  // Toggle open through fold's ontoggle handler and verify one entry per visual look directly under toolbar.
  (legendFold as unknown as { open: boolean; ontoggle: (e: { currentTarget: { open: boolean } }) => void }).ontoggle({ currentTarget: { open: true } });
  const openTree = itemsTable('skills', 'claude-cli') as unknown as FakeNode;
  const body = findById(openTree, 'mark-legend-body');
  assert.ok(body, 'opening What the marks mean draws #mark-legend-body below the toolbar');
  const legendItems = findAll(body, el => el.className.split(/\s+/).includes('legend-item')).map(el => textOf(el));
  assert.deepEqual(legendItems, ['On there / Has the current version / Has it', 'No copy', 'Off: Central Knot keeps it']);
  // Tool tab preserves open key across Files -> Back and across a home change in forgetOtherHomes (matching next).
  const prevPage = app.page, prevHarness = app.harness, prevTab = app.harnessTab, prevHome = app.home;
  app.page = 'harnesses';
  app.harness = 'claude-cli';
  app.harnessTab = 'skills';
  openFiles('alpha');
  backFromFiles();
  assert.ok(findById(itemsTable('skills', 'claude-cli') as unknown as FakeNode, 'mark-legend-body'), 'tool tab keeps What the marks mean open after Files -> Back');
  app.home = { ...prevHome!, home: '/tool-tab-other-home' };
  assert.ok(findById(itemsTable('skills', 'claude-cli') as unknown as FakeNode, 'mark-legend-body'), 'tool tab keeps What the marks mean open across forgetOtherHomes');
  app.home = prevHome;
  app.page = prevPage;
  app.harness = prevHarness;
  app.harnessTab = prevTab;
  // Close again to leave view clean for later tests.
  const openFold = findById(itemsTable('skills', 'claude-cli') as unknown as FakeNode, 'mark-legend') as unknown as { ontoggle: (e: { currentTarget: { open: boolean } }) => void };
  openFold.ontoggle({ currentTarget: { open: false } });

  // Opening a row on the tool tab still lists all 5 tools in order, Claude Code first.
  findById(tabTree, 'open-skills-alpha')!.click();
  const openedTabTree = itemsTable('skills', 'claude-cli') as unknown as FakeNode;
  assert.deepEqual(findAll(openedTabTree, el => el.className.split(/\s+/).includes('details-tool-label')).map(el => textOf(el)),
    ['Claude Code', 'Copilot CLI', 'Codex', 'Pi', 'OpenCode']);
  findById(openedTabTree, 'open-skills-alpha')!.click();
});

test('tool tab section jump lists all drawn section names without counts, sets data-section on plugins, and omits jump for a single section', () => {
  const { onSkill, library } = installFiveToolFixture();
  const tabTree = itemsTable('skills', 'claude-cli') as unknown as FakeNode;
  const pluginHead = findAll(tabTree, el => el.className.split(/\s+/).includes('ov-section-plugins'))[0]!;
  assert.equal(pluginHead.dataset.section, 'plugins', 'pluginSection sets data-section="plugins"');

  const jump = findAll(tabTree, el => el.className.split(/\s+/).includes('section-jump'))[0];
  assert.ok(jump, 'tool tab renders section jump when multiple sections are drawn');
  assert.equal(textOf(findAll(jump, el => el.className.split(/\s+/).includes('section-jump-lead'))[0]), 'Jump to:');
  const links = findAll(jump, el => el.className.split(/\s+/).includes('section-jump-link'));
  assert.deepEqual(links.map(el => [el.attrs.id, textOf(el), 'hidden' in el.attrs]), [
    ['jump-on', 'On', false],
    ['jump-found', 'Found', false],
    ['jump-plugins', 'Only through a plugin', false],
    ['jump-away', 'Not in Claude Code', false],
    ['jump-off', 'Off', false],
  ]);

  // Single-section tool tab omits the section jump.
  app.home = makeFiveToolHome([onSkill], { alpha: library.alpha });
  const singleTree = itemsTable('skills', 'claude-cli') as unknown as FakeNode;
  assert.equal(findAll(singleTree, el => el.className.split(/\s+/).includes('section-jump')).length, 0);
});

test('Library and its Files view keep all tool marks, pin grouped What the marks mean outside the scroll area (forgotten on way in), and have no section jump', () => {
  installFiveToolFixture();
  openKind('skills');
  const libTree = libraryTable() as unknown as FakeNode;
  const libAlpha = findAll(libTree, el => el.attrs['data-key'] === 'skills-alpha')[0]!;
  const libPlugin = findAll(libTree, el => el.className.split(/\s+/).includes('ov-plugin-row'))[0]!;
  assert.equal(findAll(libAlpha, el => el.className.split(/\s+/).includes('tool-mark')).length, 5);
  assert.equal(findAll(libPlugin, el => el.className.split(/\s+/).includes('tool-mark')).length, 5);
  const scroller = findAll(libTree, el => el.className.split(/\s+/).includes('matrix'))[0]!;
  const foot = findAll(libTree, el => el.className.split(/\s+/).includes('legend-foot'))[0];
  const toolbar = findAll(libTree, el => el.className.split(/\s+/).includes('toolbar'))[0]!;
  assert.equal(findById(toolbar, 'mark-legend'), undefined, 'Library does not place What the marks mean in the toolbar');
  assert.equal(findAll(scroller, el => el.className.split(/\s+/).includes('legend-foot')).length, 0, 'Library pins .legend-foot outside .scroll.matrix');
  const legendFold = findById(foot, 'mark-legend');
  assert.ok(legendFold && legendFold.tag === 'details', 'Library places What the marks mean in .legend-foot');
  assert.equal('open' in legendFold.attrs, false, 'Library What the marks mean starts closed');
  const toggleEl = findById(legendFold, 'mark-legend-toggle')!;
  assert.equal(textOf(toggleEl), 'What the marks mean');
  assert.equal(toggleEl.attrs['aria-controls'], 'mark-legend-body');
  assert.equal(findById(libTree, 'mark-legend-body'), undefined, 'Library legend body stays absent while closed');
  assert.equal(findAll(libTree, el => el.className.split(/\s+/).includes('legend-item')).length, 0);

  const openLibraryLegend = () => {
    const foldEl = findById(libraryTable() as unknown as FakeNode, 'mark-legend') as unknown as { ontoggle: (e: { currentTarget: { open: boolean } }) => void };
    foldEl.ontoggle({ currentTarget: { open: true } });
    return libraryTable() as unknown as FakeNode;
  };
  const openTree = openLibraryLegend();
  const openFoot = findAll(openTree, el => el.className.split(/\s+/).includes('legend-foot'))[0]!;
  const body = findById(openFoot, 'mark-legend-body')!;
  const openFold = findById(openFoot, 'mark-legend')!;
  assert.ok(body, 'opening Library What the marks mean draws #mark-legend-body in .legend-foot');
  assert.ok(openFoot.children.indexOf(body) < openFoot.children.indexOf(openFold), 'opened Library key renders above its toggle');
  const items = findAll(body, el => el.className.split(/\s+/).includes('legend-item')).map(el => textOf(el));
  assert.deepEqual(items, ['On there / Has the current version / Has it', 'No copy', 'Kept out', 'Off: Central Knot keeps it', 'Has it another way, not from Central Knot']);

  // Every way into the Library forgets the open state: another visit, openKind, another home, and another segment.
  app.visit += 1;
  assert.equal(findById(libraryTable() as unknown as FakeNode, 'mark-legend-body'), undefined, 'another visit forgets open key');
  openLibraryLegend();
  openKind('skills');
  assert.equal(findById(libraryTable() as unknown as FakeNode, 'mark-legend-body'), undefined, 'openKind forgets open key');
  openLibraryLegend();
  const savedHome = app.home;
  app.home = { ...savedHome!, home: '/library-other-home' };
  assert.equal(findById(libraryTable() as unknown as FakeNode, 'mark-legend-body'), undefined, 'another home forgets open key');
  app.home = savedHome;
  openLibraryLegend();
  app.libraryKind = 'all';
  assert.equal(findById(libraryTable() as unknown as FakeNode, 'mark-legend-body'), undefined, 'another segment forgets open key');
  openKind('skills');
  assert.equal(findAll(libTree, el => el.className.split(/\s+/).includes('section-jump')).length, 0);

  const filesTree = skillsBrowser(() => ({ where: [], contents: [] }), () => {}) as unknown as FakeNode;
  const firstListRow = findAll(filesTree, el => el.className.split(/\s+/).includes('list-row'))[0]!;
  assert.equal(findAll(firstListRow, el => el.className.split(/\s+/).includes('tool-mark')).length, 5);
});

test('domstub maps hyphenated data-* attributes to camelCase dataset keys', () => {
  const probe = document.createElement('div') as unknown as FakeNode;
  probe.setAttribute('data-foo-bar', 'ok');
  assert.equal(probe.dataset.fooBar, 'ok');
});

test('settleDescriptions hides only the long-name row’s description when docked, while keeping name-cut on undocked tables', () => {
  const runSettle = (docked: boolean) => {
    const tableClasses = new Set<string>();
    const makeRow = (mainWidth: number, cutAboutWidth: number, rawAboutWidth: number) => {
      const classes = new Set<string>();
      const cell = {
        clientWidth: 460,
        classList: {
          add: (...names: string[]) => names.forEach(n => classes.add(n)),
          remove: (...names: string[]) => names.forEach(n => classes.delete(n)),
          contains: (name: string) => classes.has(name),
        },
        querySelector: (sel: string) => (sel === '.ov-name-main' ? { offsetWidth: mainWidth } : null),
      };
      const about = {
        offsetTop: 0,
        offsetHeight: 40,
        get clientWidth() { return classes.has('name-cut') ? cutAboutWidth : rawAboutWidth; },
        parentElement: cell,
      };
      return { classes, cell, about };
    };
    const longRow = makeRow(320, 210, 60);
    const shortRow = makeRow(120, 260, 260);
    const rows = [longRow, shortRow];
    const table = {
      classList: {
        remove: (...names: string[]) => names.forEach(n => tableClasses.delete(n)),
        toggle: (name: string, on: boolean) => { if (on) tableClasses.add(name); else tableClasses.delete(name); },
        contains: (name: string) => tableClasses.has(name),
      },
      closest: (sel: string) => (docked && sel === '.docked' ? {} : null),
      querySelectorAll: (sel: string) => {
        if (sel === '.ov-name-about') return rows.map(r => r.about);
        if (sel === '.name-cut') return rows.filter(r => r.classes.has('name-cut')).map(r => r.cell);
        if (sel === '.name-cut, .no-about') return rows.filter(r => r.classes.has('name-cut') || r.classes.has('no-about')).map(r => r.cell);
        return [];
      },
    };
    const prevAll = document.querySelectorAll;
    (document as unknown as { querySelectorAll: (sel: string) => unknown[] }).querySelectorAll = (sel: string) => (sel === '.ov' ? [table] : []);
    try { runAfterLayout(); } finally { (document as unknown as { querySelectorAll: typeof prevAll }).querySelectorAll = prevAll; }
    return {
      tableNoAbout: tableClasses.has('no-about'),
      longNameCut: longRow.classes.has('name-cut'),
      longCellNoAbout: longRow.classes.has('no-about'),
      shortCellNoAbout: shortRow.classes.has('no-about'),
    };
  };
  assert.deepEqual(runSettle(false), { tableNoAbout: false, longNameCut: true, longCellNoAbout: false, shortCellNoAbout: false });
  assert.deepEqual(runSettle(true), { tableNoAbout: false, longNameCut: false, longCellNoAbout: true, shortCellNoAbout: false });
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
