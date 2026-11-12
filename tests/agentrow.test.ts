// An agent's row on the Agents page as worked examples on plain values (src/agentrow.ts): where it stands, what each
// harness's mark says, when its switch asks which copy, and the click each control sends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FOLDED_VERSIONS, agentClicks, foldVersions, harnessIs, harnessLine, madeFrom, needsChoice, noticeWords, placeOf, placeTag, said, statusLine, switchLabel, versionChange, versionTimes, type AgentRow } from '../src/agentrow.ts';
import { newItem, plan, type Copies, type LibraryItem } from '../src/library.ts';

const tools = ['claude-cli', 'copilot-cli', 'codex-cli'];
/** "reviewer" On at version 'b', applied to all three harnesses. */
const item = (changes: Partial<LibraryItem> = {}): LibraryItem => ({ ...newItem('agent', 'reviewer', 'reviewer'), on: true, hash: 'b',
  versions: [{ hash: 'b', at: '2026-11-08T09:20:00.000Z', from: { how: 'found', harness: 'claude-cli' } }], applied: { 'claude-cli': 'b', 'copilot-cli': 'b', 'codex-cli': 'b' }, ...changes });
/**
 * The row agents.ts gives the page for `agent` when the harnesses hold `hashes`: for an agent in the library, its plan from
 * those copies (a harness in `cannot` is held, one in `unseen` unknown, as agents.ts copiesOf reads them).
 */
function row(hashes: AgentRow['hashes'], more: Partial<AgentRow> = {}, agent?: LibraryItem): AgentRow {
  const copyOf = (tool: string): Copies[keyof Copies] => (more.unseen?.[tool] ? { is: 'unknown', why: more.unseen[tool]! } : more.cannot?.[tool] ? { is: 'held', why: more.cannot[tool]! }
    : hashes?.[tool] !== undefined ? { is: 'present', hash: hashes[tool]!, at: 0 } : { is: 'absent' });
  const copies: Copies = Object.fromEntries(tools.map(tool => [tool, copyOf(tool)]));
  return { key: 'reviewer', name: 'reviewer', hashes, ...more, ...(agent && !agent.deleted ? { plan: plan(agent, copies) } : {}) };
}
const marks = (hashes: AgentRow['hashes'], agent: LibraryItem | undefined, more: Partial<AgentRow> = {}) => tools.map(tool => harnessIs(row(hashes, more, agent), agent, tool));
/** A row and its item, for the functions that take both. */
const withItem = (hashes: AgentRow['hashes'], agent: LibraryItem) => [row(hashes, {}, agent), agent] as const;
const markIn = (hashes: AgentRow['hashes'], agent: LibraryItem, tool: string) => harnessIs(row(hashes, {}, agent), agent, tool);
const lineIn = (hashes: AgentRow['hashes'], agent: LibraryItem | undefined, tool: string, where: string, more: Partial<AgentRow> = {}) => harnessLine(row(hashes, more, agent), agent, tool, where);

test('An agent stands in one of three places: on, off (in Central Knot only), or found; a deleted one is found again', () => {
  assert.deepEqual([placeOf(item()), placeOf(item({ on: false })), placeOf(undefined), placeOf(item({ deleted: { at: 'then' } }))], ['on', 'off', 'found', 'found']);
});

test('An On agent’s marks say what the next pass does in each harness', () => {
  assert.deepEqual(marks({ 'claude-cli': 'b', 'copilot-cli': 'b', 'codex-cli': 'b' }, item()), ['current', 'current', 'current']);
  // Edited in Copilot CLI; Codex's copy was deleted by hand: the edit becomes the current version, and the agent turns Off.
  assert.deepEqual(marks({ 'claude-cli': 'b', 'copilot-cli': 'c' }, item()), ['leaving', 'edited', 'deleted']);
  // The current version moved on to 'c' and reached only Claude Code yet; nothing was ever applied to Codex.
  const moved = item({ hash: 'c', applied: { 'claude-cli': 'c', 'copilot-cli': 'b' } });
  assert.deepEqual(marks({ 'claude-cli': 'c', 'copilot-cli': 'b' }, moved), ['current', 'gets-it', 'gets-it']);
  assert.match(lineIn({ 'claude-cli': 'b', 'copilot-cli': 'c', 'codex-cli': 'b' }, item(), 'copilot-cli', 'Copilot CLI'), /^Edited in Copilot CLI\. It becomes the current version when sync runs/);
  // Off, or kept out: the edit still becomes the current version, and then the copy goes.
  assert.match(lineIn({ 'copilot-cli': 'c' }, item({ on: false }), 'copilot-cli', 'Copilot CLI'), /becomes the current version, then its copy here is removed: the agent is off\.$/);
  assert.match(lineIn({ 'claude-cli': 'b', 'copilot-cli': 'c', 'codex-cli': 'b' }, item({ except: ['copilot-cli'] }), 'copilot-cli', 'Copilot CLI'), /reaches the other tools, then its copy here is removed: the agent is kept out of this tool\.$/);
});

test('Two edits no pass has taken in yet: only the latest is marked as the one that becomes current; the other is written over', () => {
  const both = { 'claude-cli': 'c', 'copilot-cli': 'b', 'codex-cli': 'd' };
  const copies: Copies = { 'claude-cli': { is: 'present', hash: 'c', at: 1 }, 'copilot-cli': { is: 'present', hash: 'b', at: 0 }, 'codex-cli': { is: 'present', hash: 'd', at: 2 } };
  const agentRow = { ...row(both), plan: plan(item(), copies) };
  assert.deepEqual(tools.map(tool => harnessIs(agentRow, item(), tool)), ['gets-it', 'gets-it', 'edited']);
});

test('A harness the agent is kept out of: no copy, a copy still to go, or a copy of its own that is left alone', () => {
  const out = item({ except: ['codex-cli'], applied: { 'claude-cli': 'b', 'copilot-cli': 'b' } });
  assert.equal(markIn({ 'claude-cli': 'b', 'copilot-cli': 'b' }, out, 'codex-cli'), 'kept-out');
  assert.equal(markIn({ 'claude-cli': 'b', 'copilot-cli': 'b', 'codex-cli': 'x' }, out, 'codex-cli'), 'own-copy');
  assert.equal(markIn({ 'claude-cli': 'b', 'copilot-cli': 'b', 'codex-cli': 'b' }, item({ except: ['codex-cli'] }), 'codex-cli'), 'leaving');
});

test('An Off agent has no copy anywhere; one that turns up is its harness’s own; a found agent’s copies are just there', () => {
  const off = item({ on: false, applied: {} });
  assert.deepEqual(marks({ 'codex-cli': 'x' }, off), ['none', 'none', 'own-copy']);
  assert.match(lineIn({ 'codex-cli': 'x' }, off, 'codex-cli', 'Codex'), /left alone while the agent is off/);
  assert.deepEqual(marks({ 'claude-cli': 'a' }, undefined), ['own-copy', 'none', 'none']);
  assert.equal(lineIn({ 'claude-cli': 'a' }, undefined, 'claude-cli', 'Claude Code'), 'Has it.');
});

test('A harness that can’t be given a copy, or whose copy can’t be read, says why in its own words', () => {
  const why = { cannot: { 'codex-cli': 'Codex can’t store this name (é). Rename the agent to use it there.' }, unseen: { 'copilot-cli': 'Copilot CLI’s file for this agent is there but could not be read.' } };
  const agent = item({ applied: { 'claude-cli': 'b', 'copilot-cli': 'b' } });
  assert.deepEqual(marks({ 'claude-cli': 'b' }, agent, why), ['current', 'unseen', 'cannot']);
  assert.equal(lineIn({ 'claude-cli': 'b' }, agent, 'codex-cli', 'Codex', why), 'Codex can’t store this name (é). Rename the agent to use it there.');
});

test('Only a found agent whose copies differ asks which copy; an agent in the library never does', () => {
  // Whether the found copies differ is agents.ts foundCopies' answer (tests/agents.test.ts has it on real files).
  const differing = row({ 'claude-cli': 'a', 'codex-cli': 'x' }, { differs: true });
  assert.deepEqual([needsChoice(differing, undefined), needsChoice(differing, item({ on: false })), needsChoice(differing, item({ deleted: { at: 'then' } }))], [true, false, true]);
  assert.equal(needsChoice(row({ 'claude-cli': 'a', 'codex-cli': 'a' }, { differs: false }), undefined), false);
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

test('A tool that can’t take the agent is said in the status: on in the others only', () => {
  const why = { cannot: { 'copilot-cli': 'Copilot CLI can’t store this name (é). Rename the agent to use it there.', 'codex-cli': 'Codex can’t store this name (é). Rename the agent to use it there.' } };
  const agent = item({ applied: { 'claude-cli': 'b' } });
  assert.equal(statusLine(row({ 'claude-cli': 'b' }, why, agent), agent, tools), 'On in Claude Code only · Copilot CLI and Codex can’t take it (see below)');
});

test('A version says what it changed, and neighbours’ times read apart: how long ago today, to the second where two would read the same', () => {
  assert.deepEqual([versionChange('first'), versionChange(['prompt']), versionChange(['name', 'description']), versionChange([]), versionChange('unknown')],
    ['first version', 'prompt changed', 'name and description changed', 'same content', '']);
  const now = Date.parse('2026-11-12T15:00:00.000Z'), at = (minutes: number, seconds = 0) => new Date(now - minutes * 60_000 - seconds * 1000).toISOString();
  const said = versionTimes([at(3), at(3, 20), at(130), at(0, 10)].map(when => ({ hash: 'x', at: when, from: { how: 'edited' as const } })), now);
  assert.deepEqual([said[2], said[3]], ['2 h ago', 'just now']);
  assert.match(said[0], /^\d+:\d\d:\d\d/);
  assert.notEqual(said[0], said[1]);
  // A version made current again names the one it was made from.
  const found = { hash: 'a', at: at(9), from: { how: 'found' as const, harness: 'claude-cli' as const } }, again = { hash: 'a', at: at(1), from: { how: 'made-current' as const } };
  assert.equal(madeFrom({ versions: [again, { hash: 'b', at: at(5), from: { how: 'edited' as const } }, found] }, again), found);
});

test('The status line says where the agent stands, and in which harnesses', () => {
  const all = { 'claude-cli': 'b', 'copilot-cli': 'b', 'codex-cli': 'b' };
  assert.equal(statusLine(row(all, {}, item()), item(), tools), 'On in all 3 tools');
  assert.equal(statusLine(...withItem({ 'claude-cli': 'b', 'copilot-cli': 'b' }, item({ except: ['codex-cli'], applied: { 'claude-cli': 'b', 'copilot-cli': 'b' } })), tools), 'On in Claude Code and Copilot CLI · kept out of Codex');
  assert.equal(statusLine(...withItem({ 'claude-cli': 'b' }, item({ applied: { 'claude-cli': 'b' } })), tools), 'On in Claude Code · Copilot CLI and Codex get it when sync runs');
  assert.equal(statusLine(...withItem({ 'codex-cli': 'x' }, item({ on: false, applied: {} })), tools), 'Off · in Central Knot only. Turn it on to put it in every tool. Codex has a copy Central Knot didn’t put there.');
  assert.equal(statusLine(row({ 'claude-cli': 'a', 'codex-cli': 'x' }, { differs: true }), undefined, tools), 'Not in Central Knot · in Claude Code and Codex, with different copies. Turn it on to take it in and put it in every tool.');
});

test('The switch says what a click does: off everywhere, on everywhere, take a found agent in, or ask which copy', () => {
  assert.equal(switchLabel(...withItem({ 'claude-cli': 'b' }, item()), tools), 'reviewer: on. Click to take it out of every tool; Central Knot keeps it.');
  assert.equal(switchLabel(...withItem({ 'codex-cli': 'x' }, item({ on: false, applied: {} })), tools), 'reviewer: off, in Central Knot only. Click to put it in every tool; Codex has a copy of its own, which is kept as versions first.');
  assert.equal(switchLabel(row({ 'claude-cli': 'a' }), undefined, tools), 'reviewer: in Claude Code, not in Central Knot. Click to take it in and put it in every tool.');
  assert.match(switchLabel(row({ 'claude-cli': 'a', 'codex-cli': 'x' }), undefined, tools, 'closed'), /its copies differ\. Click to choose which copy every tool uses\.$/);
  assert.deepEqual([placeTag(item(), tools)?.text, placeTag(item({ on: false }), tools)?.text, placeTag(undefined, tools)?.text], [undefined, 'in Central Knot only', 'not in Central Knot']);
  // Kept out of a tool shows on the closed row too, in the words used everywhere else.
  assert.deepEqual(placeTag(item({ except: ['codex-cli'] }), tools), { text: 'not in Codex', title: 'Kept out of Codex. Its switch there, in the opened row, puts it back.' });
});

test('A click’s result says what happened, and never claims a harness where it didn’t', () => {
  assert.equal(said.off('reviewer', [], tools), 'reviewer is off: no tool has it. Central Knot keeps it, and turning it on puts each file back as it was.');
  assert.match(said.off('reviewer', ['codex-cli'], tools), /^reviewer is off, but still in Codex\./);
  assert.equal(said.takenIn('reviewer', tools, tools), 'reviewer is in Central Knot now, and on in all 3 tools.');
  assert.equal(said.takenIn('reviewer', ['claude-cli', 'codex-cli'], tools, 'codex-cli'), 'reviewer is in Central Knot now, with Codex’s copy, and on in Claude Code and Codex. The other copies are kept as its versions.');
  assert.deepEqual([said.inHarness('reviewer', 'codex-cli', true, false), said.inHarness('reviewer', 'codex-cli', false, false), said.inHarness('reviewer', 'codex-cli', true, true)],
    ['reviewer is kept out of Codex. Central Knot keeps its file for when you turn it on there.', 'reviewer is on in Codex again.', 'reviewer couldn’t be taken out of Codex yet.']);
  assert.match(said.madeCurrent('reviewer', item().versions[0], tools, tools), /^reviewer: the version found in Claude Code, .*, is current again, in all 3 tools\.$/);
  assert.deepEqual([said.deleted('reviewer', true), said.deleted('reviewer', false)],
    ['reviewer is deleted from Central Knot, and out of every tool. History can restore it.', 'reviewer is deleted from Central Knot. History can restore it.']);
});

test('A notice says what sync did by itself, and which action its button runs', () => {
  const notice = (kind: 'edit' | 'conflict' | 'deleted', losers: ('claude-cli' | 'copilot-cli')[]) => noticeWords({ kind, item: 'reviewer', winner: 'codex-cli', losers });
  assert.deepEqual([notice('edit', ['claude-cli']).text, notice('edit', ['claude-cli']).action], ['reviewer was edited in Codex; that is its current version now, in Claude Code too.', 'undo']);
  assert.equal(notice('conflict', ['copilot-cli']).text, 'reviewer: Codex’s edit is the latest, so it is the current version. Copilot CLI’s is kept as a version.');
  assert.deepEqual([notice('deleted', ['claude-cli']).text, notice('deleted', ['claude-cli']).action], ['reviewer was deleted in Codex, so it is off everywhere. Central Knot keeps it.', 'turn-on']);
});

test('A long versions list folds to its newest four, and says how many more there are; four fit without a fold', () => {
  const versions = (count: number) => Array.from({ length: count }, (_, index) => ({ hash: String(index), at: '2026-11-08T09:20:00.000Z', from: { how: 'edited' as const } }));
  assert.deepEqual([foldVersions(versions(4), false).rest, foldVersions(versions(5), false).rest, foldVersions(versions(5), false).shown.length], [0, 1, FOLDED_VERSIONS]);
  assert.deepEqual([foldVersions(versions(9), true).rest, foldVersions(versions(9), true).shown.length, foldVersions([], false).rest], [0, 9, 0]);
});
