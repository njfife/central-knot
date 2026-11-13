// A library item's row as worked examples on plain values (src/libraryrow.ts), an agent's on the Agents page: where it
// stands, what each harness's mark says, when its switch asks which copy, and the click each control sends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FOLDED_VERSIONS, addLabel, rowClicks, foldVersions, harnessIs, madeFrom, needsChoice, placeOf, libraryWords, sentences, statusLine, switchLabel, versionChange, versionSource, type LibraryRow } from '../src/libraryrow.ts';
import { readAgainst, wordDiff } from '../src/diff.ts';
import { newItem, plan, type Copies, type LibraryItem } from '../src/library.ts';
import { anyManaged, kindSource } from '../src/itemrow.ts';
import type { HomeView, LibraryFacts } from '../src/types.ts';

const { harnessLine, noticeWords, placeTag, said } = sentences(libraryWords.agents);

const tools = ['claude-cli', 'copilot-cli', 'codex-cli'];
/** "reviewer" On at version 'b', applied to all three harnesses. */
const item = (changes: Partial<LibraryItem> = {}): LibraryItem => ({ ...newItem('agent', 'reviewer', 'reviewer'), on: true, hash: 'b',
  versions: [{ hash: 'b', at: '2026-11-08T09:20:00.000Z', from: { how: 'found', harness: 'claude-cli' } }], applied: { 'claude-cli': 'b', 'copilot-cli': 'b', 'codex-cli': 'b' }, ...changes });
/**
 * The row agents.ts gives the page for `agent` when the harnesses hold `hashes`: for an agent in the library, its plan from
 * those copies (a harness in `cannot` is held, one in `unseen` unknown, as librarypass.ts copiesOf reads them).
 */
function row(hashes: LibraryRow['hashes'], more: Partial<LibraryRow> = {}, agent?: LibraryItem): LibraryRow {
  const copyOf = (tool: string): Copies[keyof Copies] => (more.unseen?.[tool] ? { is: 'unseen', why: more.unseen[tool]! } : more.cannot?.[tool] ? { is: 'held', why: more.cannot[tool]! }
    : hashes?.[tool] !== undefined ? { is: 'present', hash: hashes[tool]!, at: 0 } : { is: 'absent' });
  const copies: Copies = Object.fromEntries(tools.map(tool => [tool, copyOf(tool)]));
  return { key: 'reviewer', name: 'reviewer', hashes, ...more, ...(agent && !agent.deleted ? { plan: plan(agent, copies) } : {}) };
}
const marks = (hashes: LibraryRow['hashes'], agent: LibraryItem | undefined, more: Partial<LibraryRow> = {}) => tools.map(tool => harnessIs(row(hashes, more, agent), agent, tool));
/** A row and its item, for the functions that take both. */
const withItem = (hashes: LibraryRow['hashes'], agent: LibraryItem) => [row(hashes, {}, agent), agent] as const;
const markIn = (hashes: LibraryRow['hashes'], agent: LibraryItem, tool: string) => harnessIs(row(hashes, {}, agent), agent, tool);
const lineIn = (hashes: LibraryRow['hashes'], agent: LibraryItem | undefined, tool: string, where: string, more: Partial<LibraryRow> = {}) => harnessLine(row(hashes, more, agent), agent, tool, where);

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
  const why = { cannot: { 'codex-cli': 'Codex can’t store this name (é). Rename it in Claude Code to use it there.' }, unseen: { 'copilot-cli': 'Copilot CLI’s file for this agent is there but could not be read.' } };
  const agent = item({ applied: { 'claude-cli': 'b', 'copilot-cli': 'b' } });
  assert.deepEqual(marks({ 'claude-cli': 'b' }, agent, why), ['current', 'unseen', 'cannot']);
  assert.equal(lineIn({ 'claude-cli': 'b' }, agent, 'codex-cli', 'Codex', why), 'Codex can’t store this name (é). Rename it in Claude Code to use it there.');
});

test('Only a found agent whose copies differ asks which copy; an agent in the library never does', () => {
  // Whether the found copies differ is librarypass.ts foundCopies' answer (tests/agents.test.ts has it on real files).
  const differing = row({ 'claude-cli': 'a', 'codex-cli': 'x' }, { differs: true });
  assert.deepEqual([needsChoice(differing, undefined), needsChoice(differing, item({ on: false })), needsChoice(differing, item({ deleted: { at: 'then' } }))], [true, false, true]);
  assert.equal(needsChoice(row({ 'claude-cli': 'a', 'codex-cli': 'a' }, { differs: false }), undefined), false);
});

test('Each control sends the agent as it is with one thing changed', () => {
  const here = row({ 'claude-cli': 'b' }), agent = item({ except: ['copilot-cli'] });
  const asIs = { key: 'reviewer', managed: true, off: ['copilot-cli'], seenManaged: true };
  assert.deepEqual(rowClicks.off(here, agent), { ...asIs, managed: false });
  assert.deepEqual(rowClicks.on(here, item({ on: false, except: ['copilot-cli'] })), { ...asIs, seenManaged: false });
  assert.deepEqual(rowClicks.inHarness(here, agent, 'codex-cli', true), { ...asIs, off: ['copilot-cli', 'codex-cli'] });
  assert.deepEqual(rowClicks.inHarness(here, agent, 'copilot-cli', false), { ...asIs, off: [] });
  assert.deepEqual(rowClicks.makeCurrent(here, agent, 'a'), { ...asIs, version: 'a' });
  assert.deepEqual(rowClicks.remove(here, agent), { ...asIs, deleted: true });
  // A found agent: taken in, with the copy chosen where they differ, as it was seen.
  assert.deepEqual(rowClicks.on(row({ 'claude-cli': 'a', 'codex-cli': 'x' }), undefined, 'codex-cli'), { key: 'reviewer', managed: true, off: [], seenManaged: false, use: 'codex-cli', useHash: 'x' });
});

test('While an edit waits in one tool, the others have the current version and get that edit; the status says so', () => {
  const waiting = { 'claude-cli': 'b', 'copilot-cli': 'c', 'codex-cli': 'b' };
  assert.equal(statusLine(...withItem(waiting, item()), tools), 'On in all 3 tools · Copilot CLI’s edit becomes the current version when sync runs');
  assert.equal(lineIn(waiting, item(), 'claude-cli', 'Claude Code'), 'Has the current version. It gets Copilot CLI’s edit when sync runs.');
  // A copy the library doesn't have yet is kept as a version before it is written over.
  assert.match(lineIn({ 'claude-cli': 'b', 'codex-cli': 'x' }, item({ applied: { 'claude-cli': 'b' } }), 'codex-cli', 'Codex'), /^Has another copy\. It gets the current version when sync runs; before it is written over, a copy Central Knot doesn’t have yet is kept as a version\.$/);
});

test('While a copy deleted by hand waits for sync, the status says the agent is about to turn off, not that a tool keeps it out', () => {
  assert.equal(statusLine(...withItem({ 'copilot-cli': 'b', 'codex-cli': 'b' }, item()), tools),
    'On · its copy was deleted in Claude Code, so it turns off everywhere when sync runs. Central Knot keeps it.');
});

test('A tool that can’t take the agent is said in the status: on in the others only', () => {
  const why = { cannot: { 'copilot-cli': 'Copilot CLI can’t store this name (é). Rename it in Claude Code to use it there.', 'codex-cli': 'Codex can’t store this name (é). Rename it in Claude Code to use it there.' } };
  const agent = item({ applied: { 'claude-cli': 'b' } });
  assert.equal(statusLine(row({ 'claude-cli': 'b' }, why, agent), agent, tools), 'On in Claude Code only · Copilot CLI and Codex can’t take it (see below)');
});

test('Reading a version against the current one compares word by word and keeps its line breaks', () => {
  const words = (kind: string) => wordDiff('Read the whole change,\nthen report:\n1. Bugs', 'Read the change,\nthen report:\n1. Bugs and more').filter(part => part.kind === kind && part.text.trim()).map(part => part.text);
  assert.deepEqual([words('removed'), words('added')], [['whole'], ['and', 'more']]);
  assert.equal(wordDiff('a\nb', 'a\nb').map(part => part.text).join(''), 'a\nb');
});

test('Read marks the words a line changed a little; a line that changed mostly is shown whole, the current one’s struck, then this one’s', () => {
  const marks = (current: string, text: string) => readAgainst(current, text).map(run => `${run.kind}:${run.text}`);
  assert.deepEqual(marks('Reviews a change before it is merged.\n', 'Edited. Reviews a change before it is merged.\n'), ['added:Edited.', 'same: Reviews a change before it is merged.\n']);
  assert.deepEqual(marks('description: Review a pull request for correctness.\nKeep it short.\n', 'description: Read a small diff and summarize it.\nKeep it short.\n'),
    ['removed:description: Review a pull request for correctness.\n', 'added:description: Read a small diff and summarize it.\n', 'same:Keep it short.\n']);
});

test('A version’s note says what it changed, or what a copy that gave way differs in; one made current again says what it went back to', () => {
  assert.deepEqual([versionChange('first'), versionChange({ changed: ['prompt'] }), versionChange({ changed: ['name', 'description'] }), versionChange({ differs: ['prompt'] }), versionChange({ differs: ['description', 'prompt'] }), versionChange('none'), versionChange('unknown')],
    ['first version', 'prompt changed', 'name and description changed', 'prompt differs', 'description and prompt differ', '', '']);
  const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const found = { hash: 'a', at: at(9), from: { how: 'found' as const, harness: 'claude-cli' as const } }, again = { hash: 'a', at: at(1), from: { how: 'made-current' as const } };
  const item = { versions: [again, { hash: 'b', at: at(5), from: { how: 'edited' as const, harness: 'codex-cli' as const } }, found] };
  assert.equal(madeFrom(item, again), found);
  assert.match(versionSource(item, again), /^back to: found in Claude Code, \d+:\d\d/);
  assert.equal(versionSource(item, item.versions[1]), 'edited in Codex');
});

test('The status line says where the agent stands, and in which harnesses', () => {
  const all = { 'claude-cli': 'b', 'copilot-cli': 'b', 'codex-cli': 'b' };
  assert.equal(statusLine(row(all, {}, item()), item(), tools), 'On in all 3 tools');
  assert.equal(statusLine(...withItem({ 'claude-cli': 'b', 'copilot-cli': 'b' }, item({ except: ['codex-cli'], applied: { 'claude-cli': 'b', 'copilot-cli': 'b' } })), tools), 'On in Claude Code and Copilot CLI · kept out of Codex');
  assert.equal(statusLine(...withItem({ 'claude-cli': 'b' }, item({ applied: { 'claude-cli': 'b' } })), tools), 'On in Claude Code · Copilot CLI and Codex get it when sync runs');
  assert.equal(statusLine(...withItem({ 'codex-cli': 'x' }, item({ on: false, applied: {} })), tools), 'Off · in Central Knot only. Turn it on to put it in every tool. Codex has a copy Central Knot didn’t put there.');
  assert.equal(statusLine(row({ 'claude-cli': 'a', 'codex-cli': 'x' }, { differs: true }), undefined, tools), 'Not in Central Knot · in Claude Code and Codex, with different copies. Add it to keep it in Central Knot and put it in every tool.');
});

test('The switch says what a click does: off everywhere, or on everywhere; a found agent’s Add says it takes it in, or asks which copy', () => {
  assert.equal(switchLabel(...withItem({ 'claude-cli': 'b' }, item()), tools), 'reviewer: on. Click to take it out of every tool; Central Knot keeps it.');
  assert.equal(switchLabel(...withItem({ 'codex-cli': 'x' }, item({ on: false, applied: {} })), tools), 'reviewer: off, in Central Knot only. Click to put it in every tool; Codex has a copy of its own, which is kept as versions first.');
  assert.equal(addLabel(row({ 'claude-cli': 'a' }), undefined, tools), 'Add reviewer to Central Knot and put it in every tool');
  assert.equal(addLabel(row({ 'claude-cli': 'a', 'codex-cli': 'x' }), undefined, tools, 'closed'), 'Add reviewer: its copies differ. Click to choose which one Central Knot takes in.');
  const all = row({ 'claude-cli': 'b' });
  assert.deepEqual([placeTag(all, item(), tools)?.text, placeTag(all, item({ on: false }), tools)?.text, placeTag(all, undefined, tools)?.text], [undefined, 'in Central Knot only', 'not in Central Knot']);
  // Kept out of a tool (partial) shows on the closed row too: where it is, so it never reads as on everywhere.
  assert.deepEqual(placeTag(all, item({ except: ['codex-cli'] }), tools), { text: 'in 2 of 3 tools · kept out of Codex', title: 'Kept out of Codex. Its switch there, in the opened row, puts it back.' });
  assert.equal(switchLabel(all, item({ except: ['codex-cli'] }), tools), 'reviewer: on in 2 of 3 tools. Click to take it out of every tool; Central Knot keeps it.');
  // So does a tool that can't take it: the tag says where it can be, its tooltip why.
  const why = 'Codex can’t store this name (é). Rename it in Claude Code to use it there.';
  const cannotOnly = row({ 'claude-cli': 'b' }, { cannot: { 'codex-cli': why } }, item());
  assert.deepEqual(placeTag(cannotOnly, item(), tools), { text: 'Claude Code and Copilot CLI only', title: why });
  const keptOut = item({ except: ['copilot-cli'] }), cannot = row({ 'claude-cli': 'b' }, { cannot: { 'codex-cli': why } }, keptOut);
  assert.deepEqual(placeTag(cannot, keptOut, tools), { text: 'in 1 of 3 tools · kept out of Copilot CLI', title: `${why} Kept out of Copilot CLI. Its switch there, in the opened row, puts it back.` });
  // A tool that still holds an older copy (its folder can't be written) has it, so the tag doesn't say "only".
  const locked = row({ 'claude-cli': 'b', 'copilot-cli': 'b', 'codex-cli': 'a' }, { cannot: { 'codex-cli': 'Codex’s agents folder can’t be written.' } }, item());
  assert.equal(placeTag(locked, item(), tools), undefined);
});

test('A click’s result says what happened, and never claims a harness where it didn’t', () => {
  assert.equal(said.off('reviewer', [], tools), 'reviewer is off: no tool has it. Central Knot keeps it, and turning it on puts each file back as it was.');
  assert.match(said.off('reviewer', ['codex-cli'], tools), /^reviewer is off, but still in Codex\./);
  assert.equal(said.takenIn('reviewer', tools, tools), 'reviewer is in Central Knot now, and on in all 3 tools.');
  assert.equal(said.takenIn('reviewer', ['claude-cli', 'codex-cli'], tools, 'codex-cli'), 'reviewer is in Central Knot now, with Codex’s copy, and on in Claude Code and Codex. The other copies are kept as its versions.');
  assert.deepEqual([said.inHarness('reviewer', 'codex-cli', true, false), said.inHarness('reviewer', 'codex-cli', false, false), said.inHarness('reviewer', 'codex-cli', true, true)],
    ['reviewer is kept out of Codex. Central Knot keeps its file for when you turn it on there.', 'reviewer is on in Codex again.', 'reviewer couldn’t be taken out of Codex yet.']);
  assert.equal(said.madeCurrent('reviewer', item().versions[0], '9:20:05 AM', tools, tools), 'reviewer: the version found in Claude Code, 9:20:05 AM, is current again, in all 3 tools.');
  // Off: no tool gets it, and the result says so.
  assert.match(said.madeCurrent('reviewer', item().versions[0], '9:20:05 AM', undefined, tools), /is current again\. It is Off, so no tool was changed\.$/);
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

test('A library kind’s rows reach the item pages through itemrow.ts kindSource: On is `managed`, kept out is `off`, once per read', () => {
  const facts = (key: string, on: boolean, except: LibraryFacts['except'] = []): LibraryFacts => ({ key, name: key, description: '', copies: {}, on, except, cannot: {}, edited: [] });
  const home = (items: LibraryFacts[]) => ({ skills: { tools, items: [], library: {} }, mcp: { tools, items: [], library: {} },
    agents: { tools, items, library: { reviewer: item() } } }) as unknown as HomeView;
  const read = home([facts('reviewer', true, ['codex-cli']), facts('writer', false)]);
  const source = kindSource(read, 'agents');
  assert.deepEqual(source.facts.map(fact => [fact.key, fact.managed, fact.off]), [['reviewer', true, ['codex-cli']], ['writer', false, []]]);
  assert.equal(source.library.reviewer.on, true);
  assert.equal(kindSource(read, 'agents').facts, source.facts, 'the same rows for the same read, so a page that caches by them keeps them');
  assert.deepEqual([anyManaged(read), anyManaged(home([facts('writer', false)]))], [true, false], 'an item On in the library is something the home manages; one Off is not');
});

test('The sentences that name the item or its copies are in the kind’s words: an agent, and its file', () => {
  const out = item({ except: ['codex-cli'], applied: { 'claude-cli': 'b', 'copilot-cli': 'b' } });
  assert.equal(lineIn({ 'claude-cli': 'b', 'copilot-cli': 'b' }, out, 'codex-cli', 'Codex'), 'Kept out of this tool. Central Knot keeps its file for when you turn it on here.');
  assert.equal(lineIn({ 'claude-cli': 'b', 'copilot-cli': 'b' }, item(), 'codex-cli', 'Codex'), 'Its copy was deleted in Codex. When sync runs, the agent turns off everywhere; Central Knot keeps it.');
  assert.deepEqual([placeTag(row({}), item({ on: false }), tools)?.title, placeTag(row({ 'codex-cli': 'x' }), undefined, tools)?.title],
    ['Central Knot keeps this agent and its versions. No tool has it until you turn it on.', 'A tool has this agent; Central Knot doesn’t yet. Add it to keep it in Central Knot and put it in every tool.']);
  assert.equal(noticeWords({ kind: 'deleted', item: 'reviewer', winner: 'codex-cli', losers: [] }).help, 'Put reviewer back in every tool, each file as it was');
});

test('The same sentences in another kind’s words name that kind and its copies, never an agent or a file', () => {
  const notes = sentences({ item: 'note', an: 'a note', copy: 'page', shared: '', own: () => '', body: 'Text' });
  const out = item({ except: ['codex-cli'], applied: { 'claude-cli': 'b', 'copilot-cli': 'b' } });
  const said = [
    notes.harnessLine(row({ 'claude-cli': 'b', 'copilot-cli': 'b' }, {}, out), out, 'codex-cli', 'Codex'),
    notes.harnessLine(row({ 'claude-cli': 'b', 'copilot-cli': 'b' }, {}, item()), item(), 'codex-cli', 'Codex'),
    notes.harnessLine(row({ 'copilot-cli': 'c' }, {}, item({ on: false })), item({ on: false }), 'copilot-cli', 'Copilot CLI'),
    notes.placeTag(row({}), item({ on: false }), tools)?.title, notes.placeTag(row({ 'codex-cli': 'x' }), undefined, tools)?.title,
    notes.said.off('plan', [], tools), notes.said.inHarness('plan', 'codex-cli', true, false),
    notes.noticeWords({ kind: 'deleted', item: 'plan', winner: 'codex-cli', losers: [] }).help,
  ];
  assert.deepEqual(said, [
    'Kept out of this tool. Central Knot keeps its page for when you turn it on here.',
    'Its copy was deleted in Codex. When sync runs, the note turns off everywhere; Central Knot keeps it.',
    'Edited in Copilot CLI. When sync runs it becomes the current version, then its copy here is removed: the note is off.',
    'Central Knot keeps this note and its versions. No tool has it until you turn it on.',
    'A tool has this note; Central Knot doesn’t yet. Add it to keep it in Central Knot and put it in every tool.',
    'plan is off: no tool has it. Central Knot keeps it, and turning it on puts each page back as it was.',
    'plan is kept out of Codex. Central Knot keeps its page for when you turn it on there.',
    'Put plan back in every tool, each page as it was',
  ]);
  assert.ok(said.every(line => !/\bagent|\bfile\b/.test(line ?? '')), 'no word of the agents’ own');
});
