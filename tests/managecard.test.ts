// The question asked before a tool left out is managed again (managecard.ts askManage, manageQuestion), on its Harnesses card:
// read when the switch is pressed (main.ts `tools:joining`), answered by Manage <tool> with the counts it showed, asked again
// with main's new counts when those changed, and the reason where the read failed. A stand-in for main answers; nothing is written.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HarnessId, HomeView, JoinCounts } from '../src/types.ts';
import { findById, installDom, textOf, type FakeNode } from './domstub.ts';

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
setRenderer(() => { rendered = harnessesPage() as unknown as FakeNode; });

const counts = (some: Partial<JoinCounts>): JoinCounts => ({ written: 0, kept: 0, removed: 0, found: 0, takenIn: 0, changing: [], unread: [], ...some });
const settle = () => new Promise(done => setTimeout(done, 0));
const press = async (id: string) => { findById(rendered, id)!.click(); await settle(); };
const question = () => (findById(rendered, 'manage-codex-cli-text') ? textOf(findById(rendered, 'manage-codex-cli-text')) : undefined);

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
  Object.assign(app, { page: 'harnesses', harness: undefined, busy: undefined, instructions: { state: 'ready', data: [], gen: 0 } });
  asked.length = 0;
  rerender();
}

test('A left-out tool’s switch asks first: what managing it does is read at the press, and Manage Codex sends the counts it showed', async () => {
  open();
  answers.read = { counts: counts({ kept: 1, written: 2, found: 2, changing: ['standup', 'notes'] }) };
  findById(rendered, 'manage-codex-cli')!.click();
  assert.equal(question(), 'Reading Codex…', 'the question opens at once, Cancel in it');
  await settle();
  assert.equal(question(), 'Managing Codex: saves 1 copy there that differs as a version and writes Central Knot’s version of 2 items there; shows 2 of its items under Found in the Library.');
  assert.deepEqual([asked, findById(rendered, 'manage-codex-cli')!.attrs['aria-checked']], [[['read', 'codex-cli', '/home']], 'false'], 'read for that tool and home; nothing turned yet');
  answers.manage = { view: null, did: [] };
  await press('manage-codex-cli-confirm');
  assert.deepEqual(asked.at(-1), ['manage', 'codex-cli', true, false, '/home', counts({ kept: 1, written: 2, found: 2, changing: ['standup', 'notes'] })]);
  assert.equal(question(), undefined, 'answered, the question is gone');
});

test('What managing it does changed before Manage Codex: main turns nothing, and the question asks again with main’s new counts', async () => {
  open({ syncOn: false });
  answers.read = { counts: counts({ found: 2 }) };
  await press('manage-codex-cli');
  assert.equal(question(), 'Managing Codex: changes no item there; shows 2 of its items under Found in the Library. With Automatic sync off, Sync once brings it into line; a click on an item brings that item.');
  answers.manage = { changed: counts({ kept: 1, written: 1, found: 2, changing: ['standup'] }), view: null, did: [] };
  await press('manage-codex-cli-confirm');
  assert.equal(question(), 'Changed since it was read. Managing Codex: writes Central Knot’s version of standup there, saving the copy there as a version first; shows 2 of its items under Found in the Library. With Automatic sync off, Sync once brings it into line; a click on an item brings that item.');
  assert.deepEqual([asked.at(-1)?.[5], findById(rendered, 'manage-codex-cli')!.attrs['aria-checked']], [counts({ found: 2 }), 'false'], 'the counts it showed went with the click');
  answers.manage = { view: null, did: [] };
  await press('manage-codex-cli-confirm');
  assert.deepEqual([asked.at(-1)?.[5], question()], [counts({ kept: 1, written: 1, found: 2, changing: ['standup'] }), undefined], 'the second Manage Codex sends the counts asked again');
});

test('A read that fails says why and offers Cancel alone, which closes it on the switch; a kind not read is unknown, never “no item”', async () => {
  open();
  answers.read = { failed: 'Codex is no longer present here. Nothing was changed.' };
  await press('manage-codex-cli');
  assert.deepEqual([question(), !!findById(rendered, 'manage-codex-cli-confirm')], ['Codex is no longer present here. Nothing was changed.', false]);
  await press('manage-codex-cli-cancel');
  assert.deepEqual([question(), findById(rendered, 'manage-codex-cli')!.focused], [undefined, 1], 'closed, the switch has the focus');
  answers.read = null;
  await press('manage-codex-cli');
  assert.equal(question(), 'Couldn’t read what managing Codex would do. Nothing was changed.', 'no answer is no forecast');
  answers.read = { counts: counts({ unread: ['mcp'] }) };
  await press('manage-codex-cli');
  assert.equal(question(), 'Managing Codex: its MCP servers couldn’t be read, so what it does to them isn’t known.');
  answers.read = { counts: counts({ written: 1, changing: ['standup'], unread: ['mcp', 'agent'] }) };
  await press('manage-codex-cli');
  assert.equal(question(), 'Managing Codex: writes Central Knot’s version of standup there; its MCP servers and agents couldn’t be read, so what it does to them isn’t known.');
});

test('The one item it changes is named from its plan, with what happens to the copy there; two items, or two copies saved, are counted', async () => {
  open();
  const said = async (some: Partial<JoinCounts>) => { answers.read = { counts: counts(some) }; await press('manage-codex-cli'); return question(); };
  assert.deepEqual([
    await said({ removed: 1, kept: 1, changing: ['notes'] }), await said({ removed: 1, changing: ['notes'] }), await said({ kept: 1, changing: ['notes'] }),
    await said({ kept: 1, written: 1, changing: ['notes', 'notes'] }), await said({ kept: 2, written: 1, changing: ['notes'] }),
  ], [
    'Managing Codex: removes notes there, which is off, saving the copy as a version first.', 'Managing Codex: removes notes there, which is off.',
    'Managing Codex: saves the copy of notes there as a version.',
    'Managing Codex: saves 1 copy there that differs as a version and writes Central Knot’s version of 1 item there.',
    'Managing Codex: saves 2 copies there that differ as versions and writes Central Knot’s version of 1 item there.',
  ]);
});
