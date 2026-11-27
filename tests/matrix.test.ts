// Library Used cell words by Sort (matrix.ts usedCellWords) and row-hiding rules (matrix.ts tableOf).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayWords, DAY_MS } from '../src/model.ts';
import type { RowOrder } from '../src/itemrow.ts';
import { newItem } from '../src/library.ts';
import { pluginLink } from '../src/sourcelink.ts';
import type { HarnessId, HomeView, ItemNotice } from '../src/types.ts';
import { findById, installDom, textOf, type FakeNode } from './domstub.ts';

installDom({});
// In the order the page's entry (renderer.ts) loads them: settingspage.ts first, before matrix.ts.
await import('../src/settingspage.ts');
const { setRenderer, state } = await import('../src/app.ts');
const { headerNotices, libraryTable, listResult, openKind, usedCellWords } = await import('../src/matrix.ts');

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

const emptyKind = (tools: HarnessId[]) => ({ tools, items: [], library: {}, notices: [], gate: { state: 'open' }, unread: [], problems: [], access: { allowed: true } });

function makeHome(homePath: string, skills: Record<string, unknown>[], library: Record<string, unknown> = {}, notices: ItemNotice[] = []): HomeView {
  const tools: HarnessId[] = ['claude-cli', 'copilot-cli'];
  return {
    home: homePath, label: 'Test', syncOn: true, mode: 'fixture', readId: 1,
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

test('openKind with a key not yet in state.home keeps it waiting across an intermediate draw and opens it once the next read brings it', () => {
  setRenderer(() => {});
  const beta = { key: 'beta', name: 'beta', description: 'Beta skill.', copies: { 'claude-cli': { hash: 'h3', directory: '/c' } }, hashes: { 'claude-cli': 'h3' }, except: [] };
  const fromPlugin = { key: 'from-plugin', name: 'from-plugin', description: 'New plugin skill.', copies: { 'claude-cli': { hash: 'h4', directory: '/d' } }, hashes: { 'claude-cli': 'h4' }, except: [] };
  const homeBefore = makeHome('/tmp/matrix-waiting-open', [beta]);
  const homeAfter = makeHome('/tmp/matrix-waiting-open', [beta, fromPlugin]);
  const homeGone = makeHome('/tmp/matrix-waiting-open', [beta]);
  state.home = homeBefore;
  Object.assign(state, { page: 'plugins', libraryKind: 'skills', libraryView: 'list', visit: 30, shownWhole: undefined, outcome: undefined });
  // Plugin page clicks Open from-plugin in the Library while readHomeOnce() is still pending (homeBefore lacks from-plugin).
  openKind('skills', { key: 'from-plugin' });
  // Intermediate render on homeBefore (header + table) must spare the pending open.
  listResult();
  libraryTable();
  // Next home read brings from-plugin: the row opens.
  state.home = homeAfter;
  const arrived = libraryTable();
  assert.equal(findById(arrived, 'open-skills-from-plugin')?.attrs['aria-expanded'], 'true', 'row opens once the awaited home read brings it');
  // Once open, if a later read removes it and another brings it back, it closes instead of reopening.
  state.home = homeGone;
  libraryTable();
  state.home = homeAfter;
  const backAgain = libraryTable();
  assert.equal(findById(backAgain, 'open-skills-from-plugin')?.attrs['aria-expanded'], 'false', 'row stays closed once a read genuinely dropped it');
});

