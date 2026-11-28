// The question asked before a tool left out is managed again (managecard.ts askManage, manageQuestion), on its Harnesses card:
// read when the switch is pressed (main.ts `tools:joining`), answered by Manage <tool> with the counts it showed, asked again
// with main's new counts when those changed, and the reason where the read failed; and the band after the click (doneWords).
// A stand-in for main answers; nothing is written.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HarnessId, HomeView, JoinCounts, JoinItem } from '../src/types.ts';
import { findById, findNode, installDom, textOf, type FakeNode } from './domstub.ts';

let rendered: FakeNode | undefined;
/** What the page asked main, in order; and what main answers next. */
const asked: unknown[][] = [];
const answers: { read?: unknown; manage?: unknown } = {};
installDom({
  whatJoiningDoes: async (...args: unknown[]) => { asked.push(['read', ...args]); return answers.read; },
  manageTool: async (...args: unknown[]) => { asked.push(['manage', ...args]); return answers.manage; },
}, { byId: id => findById(rendered, id) ?? null });

const { rerender, setRenderer, state: app } = await import('../src/app.ts');
const { harnessesPage } = await import('../src/harnesspage.ts');
const { doneWords, manageTool } = await import('../src/managecard.ts');
setRenderer(() => { rendered = harnessesPage() as unknown as FakeNode; });

const counts = (some: Partial<JoinCounts>): JoinCounts => ({ written: 0, kept: 0, removed: 0, found: 0, takenIn: 0, changing: [], unread: [], ...some });
/** One item of a forecast, as joinCounts plans it: a skill unless said. */
const item = (name: string, does: JoinItem['does'], saves = 0, kind: JoinItem['kind'] = 'skill'): JoinItem => ({ kind, key: name, name, does, saves });
const settle = () => new Promise(done => setTimeout(done, 0));
const press = async (id: string) => { findById(rendered, id)!.click(); await settle(); };
const question = () => (findById(rendered, 'manage-codex-cli-text') ? textOf(findById(rendered, 'manage-codex-cli-text')) : undefined);
const buttons = () => ['cancel', 'close', 'retry', 'confirm'].filter(part => findById(rendered, `manage-codex-cli-${part}`));

/** This computer's home: Claude Code managed, Codex installed and left out. */
function open({ syncOn = true } = {}) {
  const present: HarnessId[] = ['claude-cli', 'codex-cli'];
  const kind = { tools: ['claude-cli'], items: [], notices: [], problems: [], unread: [], access: { allowed: true }, gate: { state: 'ready' }, library: {} };
  app.home = {
    home: '/home', mode: 'actual', label: 'This computer', syncOn, readId: 1,
    snapshots: present.map(harness => ({ harness, root: `/home/.${harness}`, discovery: 'found', detection: 'Installed', probe: { version: '1.0.0', detail: '' }, skills: [], issues: [] })),
    sync: { present, managed: ['claude-cli'], writes: {}, caughtUp: [], arrived: [], access: { allowed: true }, gate: { state: 'ready' } },
    skills: kind, mcp: kind, agents: kind, pluginItems: [], pluginRecordsUnread: [], profiles: { profiles: [] }, otherApps: [],
  } as unknown as HomeView;
  Object.assign(app, { page: 'harnesses', harness: undefined, busy: undefined, outcome: undefined, instructions: { state: 'ready', data: [], gen: 0 } });
  asked.length = 0;
  rerender();
}

test('A left-out tool’s switch asks first: what managing it does is read at the press, and Manage Codex sends the counts it showed', async () => {
  open();
  const shown = counts({ kept: 1, written: 2, found: 2, changing: [item('standup', 'write', 1), item('notes', 'write')] });
  answers.read = { counts: shown, plugins: true };
  findById(rendered, 'manage-codex-cli')!.click();
  assert.deepEqual([question(), buttons()], ['Reading Codex…', ['cancel']], 'the question opens at once, Cancel in it');
  await settle();
  assert.equal(question(), 'Saves 1 of Codex’s copies as a version (History can restore it). Writes Central Knot’s version of 2 items in Codex. '
    + '2 other items stay Codex’s own: they will show under Found in the Library. Codex also gets each plugin that is on and not kept out of it.');
  assert.deepEqual([asked, findById(rendered, 'manage-codex-cli')!.attrs['aria-checked']], [[['read', 'codex-cli', '/home']], 'false'], 'read for that tool and home; nothing turned yet');
  answers.manage = { view: null, did: [] };
  await press('manage-codex-cli-confirm');
  assert.deepEqual([asked.at(-1), question()], [['manage', 'codex-cli', true, false, '/home', shown], undefined], 'answered with what it showed; the question is gone');
});

test('What managing it does changed before Manage Codex: main turns nothing, and the question asks again with main’s new counts', async () => {
  open({ syncOn: false });
  answers.read = { counts: counts({ found: 1 }), plugins: false };
  await press('manage-codex-cli');
  assert.equal(question(), 'Changes no item in Codex. 1 item stays Codex’s own: it will show under Found in the Library. With Automatic sync off, Sync once brings it into line; a click on an item brings that item.');
  const now = counts({ kept: 1, written: 1, found: 1, changing: [item('standup', 'write', 1)] });
  answers.manage = { changed: now, view: null, did: [] };
  await press('manage-codex-cli-confirm');
  assert.equal(question(), 'Changed since this was read; nothing was written. Saves Codex’s copy of standup as a version (History can restore it), then replaces it in Codex with Central Knot’s version. '
    + '1 other item stays Codex’s own: it will show under Found in the Library. With Automatic sync off, Sync once brings it into line; a click on an item brings that item.');
  assert.deepEqual([asked.at(-1)?.[5], findById(rendered, 'manage-codex-cli')!.attrs['aria-checked'], app.outcome], [counts({ found: 1 }), 'false', undefined], 'the counts it showed went with the click; no band');
  answers.manage = { view: null, did: [] };
  await press('manage-codex-cli-confirm');
  assert.deepEqual([asked.at(-1)?.[5], question()], [now, undefined], 'the second Manage Codex sends the counts asked again');
});

test('A Manage click no question asked that main finds changed asks the question on the card, and says no “manages … now”', async () => {
  open();
  answers.manage = { changed: counts({ written: 1, changing: [item('notes', 'write')] }), view: null, did: [] };
  await manageTool('codex-cli', true, '/home');
  assert.deepEqual([question(), app.outcome], ['Changed since this was read; nothing was written. Writes Central Knot’s notes in Codex.', undefined]);
});

test('A read that fails says why, with Close and Try again; a kind not read is unknown, never “no item”', async () => {
  open();
  answers.read = { failed: 'Codex is no longer present here. Nothing was changed.' };
  await press('manage-codex-cli');
  assert.deepEqual([question(), buttons(), findById(rendered, 'manage-codex-cli-close')!.focused], ['Codex is no longer present here. Nothing was changed.', ['close', 'retry'], 1],
    'the failure takes the focus, on Close');
  answers.read = { counts: counts({ written: 1, changing: [item('standup', 'write')] }), plugins: false };
  await press('manage-codex-cli-retry');
  assert.deepEqual([question(), buttons()], ['Writes Central Knot’s standup in Codex.', ['cancel', 'confirm']], 'Try again reads again');
  answers.read = null;
  await press('manage-codex-cli');
  assert.equal(question(), 'Couldn’t read what managing Codex would do. Nothing was changed.', 'no answer is no forecast');
  await press('manage-codex-cli-close');
  assert.deepEqual([question(), findById(rendered, 'manage-codex-cli')!.focused], [undefined, 1], 'closed, the switch has the focus');
  answers.read = { counts: counts({ unread: ['mcp'] }), plugins: false };
  await press('manage-codex-cli');
  assert.equal(question(), 'Codex’s MCP servers couldn’t be read, so what it does to them isn’t known.');
  answers.read = { counts: counts({ written: 1, changing: [item('standup', 'write')], unread: ['mcp', 'agent'] }), plugins: false };
  await press('manage-codex-cli');
  assert.equal(question(), 'Writes Central Knot’s standup in Codex. Codex’s MCP servers and agents couldn’t be read, so what it does to them isn’t known.');
});

test('The one item it changes is named from its plan, in the order things happen; two items, or two copies saved, are counted', async () => {
  open();
  const said = async (some: Partial<JoinCounts>) => { answers.read = { counts: counts(some), plugins: false }; await press('manage-codex-cli'); return question(); };
  assert.deepEqual([
    await said({ removed: 1, kept: 1, changing: [item('notes', 'remove', 1)] }), await said({ removed: 1, changing: [item('notes', 'remove')] }),
    await said({ kept: 1, changing: [item('notes', 'keep', 1)] }),
    await said({ kept: 1, written: 2, changing: [item('notes', 'write', 1), item('notes', 'write', 0, 'mcp')] }), await said({ kept: 2, written: 1, changing: [item('notes', 'write', 2)] }),
    await said({ removed: 2, takenIn: 1, changing: [item('a', 'remove'), item('b', 'remove'), item('c', 'take')] }),
  ], [
    'Saves Codex’s copy of notes as a version (History can restore it), then removes it: notes is off.', 'Removes notes from Codex: it is off.',
    'Saves Codex’s copy of notes as a version (History can restore it).',
    'Saves 1 of Codex’s copies as a version (History can restore it). Writes Central Knot’s version of 2 items in Codex.',
    'Saves 2 of Codex’s copies as versions (History can restore them). Writes Central Knot’s version of 1 item in Codex.',
    'Removes Codex’s copies of 2 items that are off. Takes 1 of Codex’s items into the Library (Synchronize everything is on).',
  ]);
});

test('The band after the click names the one item the pass changed there, in the question’s words; more are counted', () => {
  const written = (item: string, replaced = false) => ({ item, harness: 'codex-cli' as const, outcome: 'written' as const, message: '', ...(replaced ? { replaced: true as const } : {}) });
  assert.deepEqual([
    doneWords('codex-cli', true, true, [written('standup', true)]).text, doneWords('codex-cli', true, true, [written('standup')]).text,
    doneWords('codex-cli', true, true, [{ item: 'notes', harness: 'codex-cli', outcome: 'removed', message: '' }]).text,
    doneWords('codex-cli', true, true, [written('standup', true), written('notes')]).text,
  ], [
    'Central Knot manages Codex now: Codex’s copy of standup is saved as a version (History can restore it), and Central Knot’s is written over it.',
    'Central Knot manages Codex now: Central Knot’s standup is written there.',
    'Central Knot manages Codex now: notes, which is off, is removed there.',
    'Central Knot manages Codex now: Central Knot’s version written there for 2 items (1 over Codex’s copy, saved as a version: History can restore it).',
  ]);
});

test('A single named library item gets a file mark opening Central Knot’s panel after its card; deleted or several items get none, and closing forgets its panel', async () => {
  open();
  const held = { versions: [], except: [], applied: {}, own: {} };
  app.home!.skills = { ...app.home!.skills, items: [{ key: 'standup', name: 'standup', on: true, copies: {}, except: [] }, { key: 'gone', name: 'gone', copies: {}, except: [] }],
    library: { standup: { key: 'standup', name: 'standup', on: true, hash: 'h1', ...held }, gone: { key: 'gone', name: 'gone', on: false, deleted: true, hash: 'h2', ...held } } } as unknown as HomeView['skills'];
  const ask = async (some: Partial<JoinCounts>) => { answers.read = { counts: counts(some), plugins: false }; await press('manage-codex-cli'); };
  await ask({ written: 2, changing: [item('standup', 'write'), item('notes', 'write')] });
  assert.equal(findNode(findById(rendered, 'manage-codex-cli-text'), el => el.classList.contains('row-file-btn')), undefined, 'several items: no mark');
  await ask({ removed: 1, changing: [item('gone', 'remove')] });
  assert.equal(findNode(findById(rendered, 'manage-codex-cli-text'), el => el.classList.contains('row-file-btn')), undefined, 'deleted item: no mark');
  await ask({ kept: 1, written: 1, changing: [item('standup', 'write', 1)] });
  const mark = findById(findById(rendered, 'manage-codex-cli-text'), 'file-skills-standup');
  assert.deepEqual([mark?.attrs.title, question()], ['Open the current version', 'Saves Codex’s copy of standup as a version (History can restore it), then replaces it in Codex with Central Knot’s version.']);
  mark!.click();
  const cards = (findNode(rendered, el => el.classList.contains('harness-cards'))?.children ?? []).map(el => (el as FakeNode).attrs?.id);
  assert.deepEqual([cards, findById(rendered, 'harness-card-codex-cli')!.classList.contains('file-anchored'), findById(findById(rendered, 'harness-card-codex-cli'), 'file-panel-harnesses')],
    [['harness-card-claude-cli', 'harness-card-codex-cli', 'file-panel-harnesses'], true, undefined]);
  await press('manage-codex-cli-cancel');
  await ask({ kept: 1, written: 1, changing: [item('standup', 'write', 1)] });
  assert.equal(findById(rendered, 'file-panel-harnesses'), undefined, 'closing the question forgets its open panel');
});
