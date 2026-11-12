// An agent's row on the Agents page as worked examples on plain values (src/agentrow.ts): where it stands, what each
// harness's mark says, when its switch asks which copy, and the click each control sends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentClicks, harnessIs, harnessLine, needsChoice, noticeWords, placeOf, placeTag, said, statusLine, switchLabel, type AgentRow } from '../src/agentrow.ts';
import { newItem, type LibraryItem } from '../src/library.ts';

const tools = ['claude-cli', 'copilot-cli', 'codex-cli'];
/** "reviewer" On at version 'b', applied to all three harnesses. */
const item = (changes: Partial<LibraryItem> = {}): LibraryItem => ({ ...newItem('agent', 'reviewer', 'reviewer'), on: true, hash: 'b',
  versions: [{ hash: 'b', at: '2026-11-08T09:20:00.000Z', from: { how: 'found', harness: 'claude-cli' } }], applied: { 'claude-cli': 'b', 'copilot-cli': 'b', 'codex-cli': 'b' }, ...changes });
const row = (hashes: AgentRow['hashes'], more: Partial<AgentRow> = {}): AgentRow => ({ key: 'reviewer', name: 'reviewer', hashes, ...more });
const marks = (agentRow: AgentRow, agent: LibraryItem | undefined) => tools.map(tool => harnessIs(agentRow, agent, tool));

test('An agent stands in one of three places: on, off (in Central Knot only), or found; a deleted one is found again', () => {
  assert.deepEqual([placeOf(item()), placeOf(item({ on: false })), placeOf(undefined), placeOf(item({ deleted: { at: 'then' } }))], ['on', 'off', 'found', 'found']);
});

test('An On agent’s marks say what the next pass does in each harness', () => {
  assert.deepEqual(marks(row({ 'claude-cli': 'b', 'copilot-cli': 'b', 'codex-cli': 'b' }), item()), ['current', 'current', 'current']);
  // Edited in Copilot CLI; Codex's copy was deleted by hand.
  assert.deepEqual(marks(row({ 'claude-cli': 'b', 'copilot-cli': 'c' }), item()), ['current', 'edited', 'deleted']);
  // The current version moved on to 'c' and reached only Claude Code yet; nothing was ever applied to Codex.
  const moved = item({ hash: 'c', applied: { 'claude-cli': 'c', 'copilot-cli': 'b' } });
  assert.deepEqual(marks(row({ 'claude-cli': 'c', 'copilot-cli': 'b' }), moved), ['current', 'gets-it', 'gets-it']);
  assert.match(harnessLine(row({ 'copilot-cli': 'c' }), item(), 'copilot-cli', 'Copilot CLI'), /^Edited in Copilot CLI\. It becomes the current version when sync runs/);
});

test('A harness the agent is kept out of: no copy, a copy still to go, or a copy of its own that is left alone', () => {
  const out = item({ except: ['codex-cli'], applied: { 'claude-cli': 'b', 'copilot-cli': 'b' } });
  assert.equal(harnessIs(row({ 'claude-cli': 'b', 'copilot-cli': 'b' }), out, 'codex-cli'), 'kept-out');
  assert.equal(harnessIs(row({ 'codex-cli': 'x' }), out, 'codex-cli'), 'own-copy');
  assert.equal(harnessIs(row({ 'codex-cli': 'b' }), item({ except: ['codex-cli'] }), 'codex-cli'), 'leaving');
});

test('An Off agent has no copy anywhere; one that turns up is its harness’s own; a found agent’s copies are just there', () => {
  const off = item({ on: false, applied: {} });
  assert.deepEqual(marks(row({ 'codex-cli': 'x' }), off), ['none', 'none', 'own-copy']);
  assert.match(harnessLine(row({ 'codex-cli': 'x' }), off, 'codex-cli', 'Codex'), /left alone while the agent is off/);
  assert.deepEqual(marks(row({ 'claude-cli': 'a' }), undefined), ['own-copy', 'none', 'none']);
  assert.equal(harnessLine(row({ 'claude-cli': 'a' }), undefined, 'claude-cli', 'Claude Code'), 'Has it.');
});

test('A harness that can’t be given a copy, or whose copy can’t be read, says why in its own words', () => {
  const cannot = row({ 'claude-cli': 'b' }, { cannot: { 'codex-cli': 'This name can’t be a file name here.' }, unseen: { 'copilot-cli': 'Copilot CLI’s file for this agent is there but could not be read.' } });
  const agent = item({ applied: { 'claude-cli': 'b', 'copilot-cli': 'b' } });
  assert.deepEqual(marks(cannot, agent), ['current', 'unseen', 'cannot']);
  assert.equal(harnessLine(cannot, agent, 'codex-cli', 'Codex'), 'This name can’t be a file name here.');
});

test('Only a found agent whose copies differ asks which copy; an agent in the library never does', () => {
  const differing = row({ 'claude-cli': 'a', 'codex-cli': 'x' });
  assert.deepEqual([needsChoice(differing, undefined, tools), needsChoice(differing, item({ on: false }), tools), needsChoice(differing, item({ deleted: { at: 'then' } }), tools)], [true, false, true]);
  assert.equal(needsChoice(row({ 'claude-cli': 'a', 'codex-cli': 'a' }), undefined, tools), false);
  assert.equal(needsChoice(differing, undefined, ['claude-cli', 'copilot-cli']), false, 'a harness Central Knot doesn’t manage has no say');
});

test('Each control sends the agent as it is with one thing changed', () => {
  const here = row({ 'claude-cli': 'b' }), agent = item({ except: ['copilot-cli'] });
  const asIs = { key: 'reviewer', managed: true, off: ['copilot-cli'], seenManaged: true };
  assert.deepEqual(agentClicks.off(here, agent), { ...asIs, managed: false });
  assert.deepEqual(agentClicks.on(here, item({ on: false, except: ['copilot-cli'] })), { ...asIs, seenManaged: false });
  assert.deepEqual(agentClicks.inHarness(here, agent, 'codex-cli', true), { ...asIs, off: ['copilot-cli', 'codex-cli'] });
  assert.deepEqual(agentClicks.inHarness(here, agent, 'copilot-cli', false), { ...asIs, off: [] });
  assert.deepEqual(agentClicks.makeCurrent(here, agent, 'a'), { ...asIs, version: 'a' });
  assert.deepEqual(agentClicks.remove(here, agent), { ...asIs, deleted: true });
  // A found agent: taken in, with the copy chosen where they differ, as it was seen.
  assert.deepEqual(agentClicks.on(row({ 'claude-cli': 'a', 'codex-cli': 'x' }), undefined, 'codex-cli'), { key: 'reviewer', managed: true, off: [], seenManaged: false, use: 'codex-cli', useHash: 'x' });
});

test('The status line says where the agent stands, and in which harnesses', () => {
  const all = { 'claude-cli': 'b', 'copilot-cli': 'b', 'codex-cli': 'b' };
  assert.equal(statusLine(row(all), item(), tools), 'On in all 3 tools');
  assert.equal(statusLine(row({ 'claude-cli': 'b', 'copilot-cli': 'b' }), item({ except: ['codex-cli'], applied: { 'claude-cli': 'b', 'copilot-cli': 'b' } }), tools), 'On in Claude Code and Copilot CLI · kept out of Codex');
  assert.equal(statusLine(row({ 'claude-cli': 'b' }), item({ applied: { 'claude-cli': 'b' } }), tools), 'On in Claude Code · Copilot CLI and Codex get it when sync runs');
  assert.equal(statusLine(row({ 'codex-cli': 'x' }), item({ on: false, applied: {} }), tools), 'Off · in Central Knot only. Turn it on to put it in every harness. Codex has a copy Central Knot didn’t put there.');
  assert.equal(statusLine(row({ 'claude-cli': 'a', 'codex-cli': 'x' }), undefined, tools), 'Not in Central Knot · in Claude Code and Codex, with different copies. Turn it on to take it in and put it in every harness.');
});

test('The switch says what a click does: off everywhere, on everywhere, take a found agent in, or ask which copy', () => {
  assert.equal(switchLabel(row({ 'claude-cli': 'b' }), item(), tools), 'reviewer: on. Click to take it out of every harness; Central Knot keeps it.');
  assert.equal(switchLabel(row({ 'codex-cli': 'x' }), item({ on: false, applied: {} }), tools), 'reviewer: off, in Central Knot only. Click to put it in every harness; Codex has a copy of its own, which is kept as versions first.');
  assert.equal(switchLabel(row({ 'claude-cli': 'a' }), undefined, tools), 'reviewer: in Claude Code, not in Central Knot. Click to take it in and put it in every harness.');
  assert.match(switchLabel(row({ 'claude-cli': 'a', 'codex-cli': 'x' }), undefined, tools, 'closed'), /its copies differ\. Click to choose which copy every harness uses\.$/);
  assert.deepEqual([placeTag(item())?.text, placeTag(item({ on: false }))?.text, placeTag(undefined)?.text], [undefined, 'in Central Knot only', 'not in Central Knot']);
});

test('A click’s result says what happened, and never claims a harness where it didn’t', () => {
  assert.equal(said.off('reviewer', [], tools), 'reviewer is off: no harness has it. Central Knot keeps it, and turning it on puts each file back as it was.');
  assert.match(said.off('reviewer', ['codex-cli'], tools), /^reviewer is off, but still in Codex\./);
  assert.equal(said.takenIn('reviewer', tools, tools), 'reviewer is in Central Knot now, and on in all 3 tools.');
  assert.equal(said.takenIn('reviewer', ['claude-cli', 'codex-cli'], tools, 'codex-cli'), 'reviewer is in Central Knot now, with Codex’s copy, and on in Claude Code and Codex. The other copies are kept as its versions.');
  assert.deepEqual([said.inHarness('reviewer', 'codex-cli', true, false), said.inHarness('reviewer', 'codex-cli', false, false), said.inHarness('reviewer', 'codex-cli', true, true)],
    ['reviewer is kept out of Codex. Central Knot keeps its file for when you turn it on there.', 'reviewer is on in Codex again.', 'reviewer couldn’t be taken out of Codex yet.']);
  assert.match(said.madeCurrent('reviewer', item().versions[0], tools, tools), /^reviewer: the version found in Claude Code, .*, is current again, in all 3 tools\.$/);
  assert.deepEqual([said.deleted('reviewer', true), said.deleted('reviewer', false)],
    ['reviewer is deleted from Central Knot, and out of every harness. History can restore it.', 'reviewer is deleted from Central Knot. History can restore it.']);
});

test('A notice says what sync did by itself, and which action its button runs', () => {
  const notice = (kind: 'edit' | 'conflict' | 'deleted', losers: ('claude-cli' | 'copilot-cli')[]) => noticeWords({ kind, item: 'reviewer', winner: 'codex-cli', losers });
  assert.deepEqual([notice('edit', ['claude-cli']).text, notice('edit', ['claude-cli']).action], ['reviewer was edited in Codex; that is its current version now, in Claude Code too.', 'undo']);
  assert.equal(notice('conflict', ['copilot-cli']).text, 'reviewer: Codex’s edit is the latest, so it is the current version. Copilot CLI’s is kept as a version.');
  assert.deepEqual([notice('deleted', ['claude-cli']).text, notice('deleted', ['claude-cli']).action], ['reviewer was deleted in Codex, so it is off everywhere. Central Knot keeps it.', 'turn-on']);
});
