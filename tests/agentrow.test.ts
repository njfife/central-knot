// An agent's row on the Agents page as worked examples on plain values (src/agentrow.ts): where it stands, what each
// harness's mark says, when its switch asks which copy, and the click each control sends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentClicks, harnessIs, harnessLine, needsChoice, placeOf, type AgentRow } from '../src/agentrow.ts';
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
