// Library Used cell words by Sort (matrix.ts usedCellWords), reload step rendering (reloadLines, reloadChips), and row-hiding rules (matrix.ts tableOf).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayWords, DAY_MS } from '../src/model.ts';
import type { RowOrder } from '../src/itemrow.ts';
import { reloadAdvice } from '../src/reload.ts';
import type { Outcome } from '../src/app.ts';
import { newItem } from '../src/library.ts';
import { pluginLink } from '../src/sourcelink.ts';
import type { HarnessId, HomeView, ItemNotice } from '../src/types.ts';
import { findById, findNode, installDom, textOf, type FakeNode } from './domstub.ts';

let nextRefresh: (() => Promise<HomeView | null>) | undefined;
let nextSearch: ((text: string) => Promise<{ ready: boolean; home: string; rows: { id: string }[] }>) | undefined;
const { dispatch } = installDom({
  refresh: () => (nextRefresh ? nextRefresh() : Promise.resolve(null)),
  search: (text: string) => (nextSearch ? nextSearch(text) : Promise.resolve({ ready: false, home: '', rows: [] })),
});
// In the order the page's entry (renderer.ts) loads them: settingspage.ts first, before matrix.ts.
await import('../src/settingspage.ts');
const { oweHomeRead, readHomeOnce, setRenderer, state } = await import('../src/app.ts');
const { headerNotices, libraryTable, listResult, noticeKindsShown, openKind, reloadChips, reloadLines, rowByKey, unshownReloadRows, usedCellWords } = await import('../src/matrix.ts');
const { pluginsResult, runBand } = await import('../src/pluginspage.ts');
const { market } = await import('../src/pluginstate.ts');

const collectNodes = (node: unknown, match: (el: FakeNode) => boolean, out: FakeNode[] = []): FakeNode[] => {
  if (!node || typeof node !== 'object') return out;
  const el = node as FakeNode;
  if (el.tag && match(el)) out.push(el);
  for (const child of el.children ?? []) collectNodes(child, match, out);
  return out;
};

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
  const rows = collectNodes(view, el => el.className.split(/\s+/).includes('reload-row'));
  const rowShape = (row: FakeNode) => ({
    cmdRow: row.className.split(/\s+/).includes('reload-row-cmd'),
    parts: (row.children ?? []).map(child => {
      const el = child as FakeNode;
      return el.tag === 'button' ? ['button', textOf(el), el.attrs['data-copy']] : [el.className, textOf(el)];
    }),
  });
  assert.deepEqual(rows.map(rowShape), [
    { cmdRow: true, parts: [['button', 'Copilot CLI: /skills reload', '/skills reload']] },
    { cmdRow: false, parts: [['reload-row-text', 'Codex picks it up at the next turn; if not, start a new chat.']] },
    { cmdRow: true, parts: [['button', 'Pi: /reload', '/reload']] },
    { cmdRow: true, parts: [['button', 'Antigravity: /skills reload', '/skills reload'], ['reload-row-note', 'Antigravity reads it at the next turn anyway; this is only for the CLI’s slash menu.']] },
  ]);
  // Secondary command + desktop app caveat (Codex MCP both + Claude MCP both): each command paired with what it is for, reading as two ways not three.
  const bothMcp = reloadAdvice([
    { tool: 'claude-cli', kind: 'mcp', key: 'docs', on: true },
    { tool: 'codex-cli', kind: 'mcp', key: 'docs', on: true },
  ], { 'claude-cli': 'both', 'codex-cli': 'both' });
  const mcpRows = collectNodes(reloadLines(bothMcp, 'whole') as unknown as FakeNode, el => el.className.split(/\s+/).includes('reload-row'));
  assert.deepEqual(mcpRows.map(rowShape), [
    { cmdRow: true, parts: [['button', 'Claude Code: claude --continue', 'claude --continue'], ['reload-row-note', 'Restart (keeps the chat), or restart Claude desktop.']] },
    { cmdRow: true, parts: [
      ['button', 'Codex: /new', '/new'], ['reload-row-note', 'for a new chat, or'],
      ['button', 'codex resume --last', 'codex resume --last'], ['reload-row-note', 'to restart and keep the chat; restart the ChatGPT desktop app if it is open.'],
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
    collectNodes(chipsWithCodex, el => 'data-reload-tool' in el.attrs).map(el => el.attrs['data-reload-tool']),
    ['copilot-cli', 'pi-cli', 'antigravity-cli'],
  );
  const chipsTwoCmd = reloadChips(mcpFour, outcomeA) as unknown as FakeNode;
  assert.equal(findById(chipsTwoCmd, 'outcome-reload-more')?.attrs['data-reload-rows'], '4');
  assert.deepEqual(
    collectNodes(chipsTwoCmd, el => 'data-reload-tool' in el.attrs).map(el => el.attrs['data-reload-tool']),
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
  const okStep = (tool: HarnessId) => ({ source: 'm', marketName: 'team', plugin: 'kit', tool, action: 'install-items' as const, report: { ok: true, changed: true, message: 'ok', reloads: [{ tool, kind: 'mcp' as const, key: 'docs', on: true }] } });
  const failStep = { source: 'm', marketName: 'team', plugin: 'bad', tool: 'claude-cli' as const, action: 'install' as const, report: { ok: false, changed: false, message: 'failed' } };
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
    state.shownWhole = plugRun;
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
