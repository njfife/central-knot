// A library item's row as worked examples on plain values (src/libraryrow.ts), an agent's on the Library: where it
// stands, what each harness's mark says, when its switch asks which copy, and the click each control sends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FOLDED_VERSIONS, addLabel, asksWhichCopy, copiesDiffer, waitsForSync, canAdd, fromSourceWords, rowClicks, foldVersions, harnessIs, loadsFrom, madeFrom, placeOf, libraryWords, ruleSays, sentences, showsPlaceTag, statusLine, stillIn, stillReadWords, switchLabel, switchedOffWords, versionChange, versionOrigin, type LibraryRow } from '../src/libraryrow.ts';
import { readAgainst, wordDiff } from '../src/diff.ts';
import { newItem, plan, takeInAnswer, type Copies, type FoundKey, type LibraryItem } from '../src/library.ts';
import { anyOn, kindSource } from '../src/itemrow.ts';
import { withPluginOnly } from '../src/pluginrows.ts';
import type { HarnessId, HomeView, LibraryFacts } from '../src/types.ts';

const { harnessLine, noticeWords, placeTag, said } = sentences(libraryWords.agents);

const tools = ['claude-cli', 'copilot-cli', 'codex-cli'];
/** "reviewer" On at version 'b', applied to all three harnesses. */
const item = (changes: Partial<LibraryItem> = {}): LibraryItem => ({ ...newItem('reviewer', 'reviewer'), on: true, hash: 'b',
  versions: [{ hash: 'b', at: '2026-11-08T09:20:00.000Z', from: { how: 'found', harness: 'claude-cli' } }], applied: { 'claude-cli': 'b', 'copilot-cli': 'b', 'codex-cli': 'b' }, ...changes });
/**
 * The row agents.ts gives the page for `agent` when the harnesses hold `hashes`: for an agent in the library, its plan from
 * those copies (a harness in `cannot` is held, one in `unseen` unknown, as librarypass.ts copiesOf reads them); for a found
 * one, the take-in table's answers from the copies that can be read (librarypass.ts foundKey).
 */
function row(hashes: LibraryRow['hashes'], more: Partial<LibraryRow> = {}, agent?: LibraryItem): LibraryRow {
  const copyOf = (tool: string): Copies[keyof Copies] => (more.unseen?.[tool] ? { is: 'unseen', why: more.unseen[tool]! } : more.cannot?.[tool] ? { is: 'held', why: more.cannot[tool]! }
    : hashes?.[tool] !== undefined ? { is: 'present', hash: hashes[tool]!, at: 0 } : { is: 'absent' });
  const copies: Copies = Object.fromEntries(tools.map(tool => [tool, copyOf(tool)]));
  const found: FoundKey = { copies: tools.flatMap(tool => (hashes?.[tool] !== undefined && !more.unseen?.[tool] ? [{ harness: tool as HarnessId, hash: hashes[tool]! }] : [])), deleted: !!agent?.deleted };
  const takeInAnswers = { click: takeInAnswer('click', found), rule: takeInAnswer('rule', found) };
  return { key: 'reviewer', name: 'reviewer', hashes, ...(agent && !agent.deleted ? { plan: plan(agent, copies) } : { takeInAnswers }), ...more };
}
const marks = (hashes: LibraryRow['hashes'], agent: LibraryItem | undefined, more: Partial<LibraryRow> = {}) => tools.map(tool => harnessIs(row(hashes, more, agent), agent, tool));
/** A row and its item, for the functions that take both. */
const withItem = (hashes: LibraryRow['hashes'], agent: LibraryItem) => [row(hashes, {}, agent), agent] as const;
const markIn = (hashes: LibraryRow['hashes'], agent: LibraryItem, tool: string) => harnessIs(row(hashes, {}, agent), agent, tool);
const lineIn = (hashes: LibraryRow['hashes'], agent: LibraryItem | undefined, tool: string, where: string, more: Partial<LibraryRow> = {}) => harnessLine(row(hashes, more, agent), agent, tool, where);

test('A skill whose copy in Claude Code sits beside a folder named like it but for case (a case-sensitive disk) can’t be removed there: Off and Delete say it is still in Claude Code, and so does its row', () => {
  // deploy is On in all three tools; then the person makes ~/.claude/skills/Deploy, another skill. Claude Code's copy of
  // deploy is unseen (skillfiles.ts readSkillsFolder), so no pass removes it, and no click's result names that tool.
  const skills = sentences(libraryWords.skills), all = { 'claude-cli': 'a', 'copilot-cli': 'a', 'codex-cli': 'a' };
  const twins = { 'claude-cli': 'Two folders whose names differ only by case are in Claude Code’s skills folder. Rename one so Central Knot can tell them apart.' };
  const deploy: LibraryRow = { key: 'deploy', name: 'deploy', hashes: all, unseen: twins }, on = { ...newItem('deploy', 'deploy'), on: true, applied: all };
  const noneFailed: string[] = [];
  assert.equal(skills.said.off('deploy', stillIn(deploy, on, noneFailed, tools), tools),
    'deploy is off, but still in Claude Code. Central Knot keeps it, and turning it on puts each folder back as it was.');
  assert.equal(skills.said.deleted('deploy', true, stillIn(deploy, on, noneFailed, tools), tools), 'deploy is deleted from Central Knot, but still in Claude Code. History can restore it.');
  // Off, its copy in Claude Code is still the one Central Knot wrote there: nothing was removed.
  const off = { ...newItem('deploy', 'deploy'), on: false, applied: { 'claude-cli': 'a' } };
  assert.deepEqual(skills.placeTag({ ...deploy, hashes: { 'claude-cli': 'a' } }, off, tools), { text: 'still in Claude Code', title: twins['claude-cli'] });
  // With nothing unseen, each says what it always said.
  const seen: LibraryRow = { key: 'deploy', name: 'deploy', hashes: all };
  assert.deepEqual([skills.said.off('deploy', stillIn(seen, on, noneFailed, tools), tools), skills.said.deleted('deploy', true, stillIn(seen, on, noneFailed, tools), tools), skills.placeTag({ key: 'deploy' }, { ...off, applied: {} }, tools)?.text],
    ['deploy is off: no tool has it. Central Knot keeps it, and turning it on puts each folder back as it was.', 'deploy is deleted from Central Knot, and out of every tool. History can restore it.', 'in Central Knot only']);
});

test('A tool whose whole settings file can’t be read has every MCP server unseen: Off, Delete and the row say “still in” it only of a server Central Knot wrote there', () => {
  // Codex's config.toml has a typo, so every server is unseen in Codex (librarypass.ts copyIn), written there or not. docs is
  // kept out of Codex and was never written there; relay was written there before the typo.
  const servers = sentences(libraryWords.mcp), noneFailed: string[] = [], both = { 'claude-cli': 'a', 'copilot-cli': 'a' };
  const typo = { 'codex-cli': '/home/me/.codex/config.toml could not be read as TOML, so its servers are not offered and it is never written.' };
  const rowOf = (key: string): LibraryRow => ({ key, name: key, hashes: both, unseen: typo });
  const docs = { ...newItem('docs', 'docs'), on: true, except: ['codex-cli'] as HarnessId[], applied: both };
  const relay = { ...newItem('relay', 'relay'), on: true, applied: { ...both, 'codex-cli': 'a' } };
  // After Off, Claude Code's and Copilot CLI's entries are gone; Codex's can't be read.
  const says = (key: string, on: LibraryItem, afterOff: LibraryItem) => [servers.said.off(key, stillIn(rowOf(key), on, noneFailed, tools), tools),
    servers.said.deleted(key, true, stillIn(rowOf(key), on, noneFailed, tools), tools), servers.placeTag({ ...rowOf(key), hashes: {} }, afterOff, tools)?.text];
  assert.deepEqual(says('docs', docs, { ...docs, on: false, applied: {} }), [
    'docs is off: no tool has it. Central Knot keeps it, and turning it on puts each entry back as it was.',
    'docs is deleted from Central Knot, and out of every tool. History can restore it.', 'in Central Knot only']);
  assert.deepEqual(says('relay', relay, { ...relay, on: false, applied: { 'codex-cli': 'a' } }), [
    'relay is off, but still in Codex. Central Knot keeps it, and turning it on puts each entry back as it was.',
    'relay is deleted from Central Knot, but still in Codex. History can restore it.', 'still in Codex']);
});

test('An agent stands in one of three places: on, off (in Central Knot only), or found; a deleted one is found again', () => {
  assert.deepEqual([placeOf(item()), placeOf(item({ on: false })), placeOf(undefined), placeOf(item({ deleted: { at: 'then' } }))], ['on', 'off', 'found', 'found']);
});

test('An On agent’s marks say what the next pass does in each harness', () => {
  assert.deepEqual(marks({ 'claude-cli': 'b', 'copilot-cli': 'b', 'codex-cli': 'b' }, item()), ['current', 'current', 'current']);
  // Edited in Copilot CLI; Codex's copy was deleted by hand: the edit becomes the current version, and the agent turns Off.
  assert.deepEqual(marks({ 'claude-cli': 'b', 'copilot-cli': 'c' }, item()), ['leaving', 'edited', 'deleted-by-hand']);
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

test('A found row’s Add says the take-in table’s answer for a click: it asks which copy only where the copies differ, and an item in the library has none', () => {
  // The answers are library.ts takeInAnswer's, which each kind's view gives its found rows (tests/agents.test.ts has them on real files).
  const differing = row({ 'claude-cli': 'a', 'codex-cli': 'x' }, { takeInAnswers: { click: { wait: 'choice' }, rule: { wait: 'choice' } } });
  const same = row({ 'claude-cli': 'a', 'codex-cli': 'a' }, { takeInAnswers: { click: { take: { harness: 'claude-cli', hash: 'a' }, chosen: false }, rule: { take: { harness: 'claude-cli', hash: 'a' }, chosen: false } } });
  const none = row({}, { takeInAnswers: { click: { leave: 'no-copy' }, rule: { leave: 'no-copy' } } });
  const inLibrary = row({ 'claude-cli': 'b' }, {}, item());
  assert.deepEqual([asksWhichCopy(differing), asksWhichCopy(same), asksWhichCopy(none), asksWhichCopy(inLibrary)], [true, false, false, false]);
  assert.deepEqual([canAdd(differing), canAdd(same), canAdd(none), canAdd(inLibrary)], [true, true, false, false]);
});

test('Each control sends the agent as it is with one thing changed', () => {
  const here = row({ 'claude-cli': 'b' }), agent = item({ except: ['copilot-cli'] });
  const asIs = { key: 'reviewer', on: true, except: ['copilot-cli'], seenOn: true };
  assert.deepEqual(rowClicks.off(here, agent), { ...asIs, on: false });
  assert.deepEqual(rowClicks.on(here, item({ on: false, except: ['copilot-cli'] })), { ...asIs, seenOn: false });
  assert.deepEqual(rowClicks.inHarness(here, agent, 'codex-cli', true), { ...asIs, except: ['copilot-cli', 'codex-cli'] });
  assert.deepEqual(rowClicks.inHarness(here, agent, 'copilot-cli', false), { ...asIs, except: [] });
  assert.deepEqual(rowClicks.makeCurrent(here, agent, 'a'), { ...asIs, version: 'a' });
  assert.deepEqual(rowClicks.remove(here, agent), { ...asIs, deleted: true });
  // A found agent: taken in, with the copy chosen where they differ, as it was seen.
  assert.deepEqual(rowClicks.on(row({ 'claude-cli': 'a', 'codex-cli': 'x' }), undefined, 'codex-cli'), { key: 'reviewer', on: true, except: [], seenOn: false, use: 'codex-cli', useHash: 'x' });
});

test('While an edit waits in one tool, the others have the current version and get that edit; an On row drops the bold summary line', () => {
  const waiting = { 'claude-cli': 'b', 'copilot-cli': 'c', 'codex-cli': 'b' };
  assert.equal(statusLine(...withItem(waiting, item()), tools), '');
  assert.equal(lineIn(waiting, item(), 'claude-cli', 'Claude Code'), 'Has the current version. It gets Copilot CLI’s edit when sync runs.');
  // A copy the library doesn't have yet is kept as a version before it is written over.
  assert.match(lineIn({ 'claude-cli': 'b', 'codex-cli': 'x' }, item({ applied: { 'claude-cli': 'b' } }), 'codex-cli', 'Codex'), /^Has another copy\. It gets the current version when sync runs; before it is written over, a copy Central Knot doesn’t have yet is kept as a version\.$/);
});

test('While a copy deleted by hand waits for sync, the deleted tool’s line says it turns off once; On statusLine stays empty', () => {
  const deleted = { 'copilot-cli': 'b', 'codex-cli': 'b' };
  assert.equal(statusLine(...withItem(deleted, item()), tools), '');
  assert.equal(lineIn(deleted, item(), 'claude-cli', 'Claude Code'),
    'Its copy was deleted in Claude Code. When sync runs, the agent turns off; Central Knot keeps it.');
});

test('A tool that can’t take the agent is said on its line; the On status line stays empty', () => {
  const why = { cannot: { 'copilot-cli': 'Copilot CLI can’t store this name (é). Rename it in Claude Code to use it there.', 'codex-cli': 'Codex can’t store this name (é). Rename it in Claude Code to use it there.' } };
  const agent = item({ applied: { 'claude-cli': 'b' } });
  assert.equal(statusLine(row({ 'claude-cli': 'b' }, why, agent), agent, tools), '');
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
  // Nine minutes ago reads "yesterday at" in the first minutes after midnight.
  assert.match(versionOrigin(item, again), /^back to: found in Claude Code, (yesterday at )?\d+:\d\d/);
  assert.equal(versionOrigin(item, item.versions[1]), 'edited in Codex');
});

test('The status line drops the bold On summary, keeps Off without an Off · prefix, and keeps Found', () => {
  const all = { 'claude-cli': 'b', 'copilot-cli': 'b', 'codex-cli': 'b' };
  assert.equal(statusLine(row(all, {}, item()), item(), tools), '');
  assert.equal(statusLine(...withItem({ 'claude-cli': 'b', 'copilot-cli': 'b' }, item({ except: ['codex-cli'], applied: { 'claude-cli': 'b', 'copilot-cli': 'b' } })), tools), '');
  assert.equal(statusLine(...withItem({ 'claude-cli': 'b' }, item({ applied: { 'claude-cli': 'b' } })), tools), '');
  assert.equal(statusLine(...withItem({ 'codex-cli': 'x' }, item({ on: false, applied: {} })), tools), 'In Central Knot and Codex. On puts it in every tool. Codex has a copy Central Knot didn’t put there.');
  const differing = row({ 'claude-cli': 'a', 'codex-cli': 'x' }, { takeInAnswers: { click: { wait: 'choice' }, rule: { wait: 'choice' } } });
  assert.equal(statusLine(differing, undefined, tools), 'Not in Central Knot · in Claude Code and Codex, with different copies. Add it to keep it in Central Knot and put it in every tool.');
  // With Synchronize everything on, a found row says what the rule does with it.
  assert.equal(statusLine(differing, undefined, tools, true), 'Not in Central Knot · in Claude Code and Codex, with different copies. Add it to keep it in Central Knot and put it in every tool. Synchronize everything leaves it for you to choose: its copies differ.');
  assert.deepEqual([ruleSays({ leave: 'deleted' }), ruleSays({ leave: 'no-copy' })],
    ['It was deleted from Central Knot, so it will not be added by itself again. Add, or Restore in History, brings it back.', '']);
});

test('The switch says what a click does: off everywhere, or on everywhere; a found agent’s Add says it takes it in, or asks which copy', () => {
  assert.equal(switchLabel(...withItem({ 'claude-cli': 'b', 'copilot-cli': 'b', 'codex-cli': 'b' }, item()), tools), 'reviewer: on. Click to take it out of every tool; Central Knot keeps it.');
  assert.equal(switchLabel(...withItem({ 'codex-cli': 'x' }, item({ on: false, applied: {} })), tools), 'reviewer: off, in Central Knot and Codex. Click to put it in every tool; Codex has a copy of its own, which is kept as versions first.');
  assert.equal(addLabel(row({ 'claude-cli': 'a' }), undefined, tools), 'Add reviewer to Central Knot and put it in every tool');
  assert.equal(addLabel(row({ 'claude-cli': 'a', 'codex-cli': 'x' }), undefined, tools, 'closed'), 'Add reviewer: its copies differ. Click to choose which one Central Knot takes in.');
  // The two tools it is in have their copies (a copy missing where Central Knot put one was deleted by hand: no tool loads it there).
  const all = row({ 'claude-cli': 'b', 'copilot-cli': 'b' }), notInCodex = { 'claude-cli': 'b', 'copilot-cli': 'b' };
  assert.deepEqual([placeTag(all, item(), tools)?.text, placeTag(row({}), item({ on: false, applied: {} }), tools)?.text, placeTag(all, undefined, tools)?.text], [undefined, 'in Central Knot only', 'not in Central Knot']);
  // Kept out of a tool (partial) shows on the closed row too: where it is, so it never reads as on everywhere.
  assert.deepEqual(placeTag(all, item({ except: ['codex-cli'], applied: notInCodex }), tools), { text: 'in 2 of 3 tools · kept out of Codex', title: 'Kept out of Codex. Its switch there, in the opened row, puts it back.' });
  assert.equal(switchLabel(all, item({ except: ['codex-cli'], applied: notInCodex }), tools), 'reviewer: on in 2 of 3 tools. Click to take it out of every tool; Central Knot keeps it.');
  // So does a tool that can't take it: the tag says where it can be, its tooltip why.
  const why = 'Codex can’t store this name (é). Rename it in Claude Code to use it there.';
  const cannotOnly = row({ 'claude-cli': 'b', 'copilot-cli': 'b' }, { cannot: { 'codex-cli': why } }, item());
  assert.deepEqual(placeTag(cannotOnly, item(), tools), { text: 'Claude Code and Copilot CLI only', title: why });
  const keptOut = item({ except: ['copilot-cli'] }), cannot = row({ 'claude-cli': 'b' }, { cannot: { 'codex-cli': why } }, keptOut);
  assert.deepEqual(placeTag(cannot, keptOut, tools), { text: 'in 1 of 3 tools · kept out of Copilot CLI', title: `${why} Kept out of Copilot CLI. Its switch there, in the opened row, puts it back.` });
  // A tool that still holds an older copy (its folder can't be written) has it, so the tag doesn't say "only".
  const locked = row({ 'claude-cli': 'b', 'copilot-cli': 'b', 'codex-cli': 'a' }, { cannot: { 'codex-cli': 'Codex’s agents folder can’t be written.' } }, item());
  assert.equal(placeTag(locked, item(), tools), undefined);
});

test('An Off agent on through its plugin in two tools names them in its page’s order: on Codex’s page, Codex first', () => {
  // The row holds the tools in its kind's own order; each page says them with its own tool first (matrix.ts toolsFor).
  const through = row({}, { pluginOn: ['claude-cli', 'codex-cli'] }), off = item({ on: false, applied: {} }), onCodexPage = ['codex-cli', 'claude-cli', 'copilot-cli'];
  assert.deepEqual([placeTag(through, off, tools)?.text, placeTag(through, off, onCodexPage)?.text, statusLine(through, off, onCodexPage, false, [])],
    ['on in Claude Code and Codex only, through its plugin', 'on in Codex and Claude Code only, through its plugin',
      'On in Codex and Claude Code only, through its plugin. On puts it in every tool.']);
  assert.equal(placeTag(through, off, onCodexPage)?.title, 'Central Knot keeps this agent and its versions. Codex and Claude Code have it on through its plugin: its switch there, in the opened row, turns that off.');
});

test('The switch counts the tools an item is on in as its tag does: a tool that can’t take it is not one of them', () => {
  // triage, a skill of the plugin issue-tracker, which is kept out of every tool but OpenCode: the three tools that install
  // plugins can't be given it (the plugin isn't there), Pi keeps it out, and OpenCode has it.
  const five = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli'];
  const away = 'Its plugin issue-tracker is kept out of this tool.';
  const triage: LibraryRow = { key: 'triage', name: 'triage', hashes: { 'opencode-cli': 'b' }, cannot: { 'claude-cli': away, 'copilot-cli': away, 'codex-cli': away } };
  const kept = item({ except: ['pi-cli'], applied: { 'opencode-cli': 'b' } });
  assert.equal(placeTag(triage, kept, five)?.text, 'in 1 of 5 tools · kept out of Pi');
  assert.equal(switchLabel(triage, kept, five), 'triage: on in 1 of 5 tools. Click to take it out of every tool; Central Knot keeps it.');
});

test('Whether a tool loads an item, and from which copy, is one answer: Central Knot’s, one it doesn’t write (which an Off leaves), a plugin’s, unknown or none', () => {
  const five = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli'], at = (folder: string) => ({ folder: 'notes', name: 'notes', skillFile: `${folder}/notes/SKILL.md`, switchedOff: false });
  const notes = { ...newItem('notes', 'notes'), on: true, hash: 'a', applied: { 'claude-cli': 'a', 'codex-cli': 'a' } };
  // Claude Code: its own folder's copy, Central Knot's. Copilot CLI: the shared folder's. Codex: Central Knot's and the shared
  // folder's (two copies). Pi: a copy that can't be seen for sure. OpenCode: Claude Code's, in Claude Code's folder, which it reads.
  const row: LibraryRow = { key: 'notes', name: 'notes', hashes: { 'claude-cli': 'a', 'codex-cli': 'a' }, unseen: { 'pi-cli': 'Pi’s copy can’t be read.' },
    anotherWay: { 'copilot-cli': 'shared', 'codex-cli': 'shared', 'opencode-cli': 'Claude Code’s' },
    loads: { 'claude-cli': { ...at('~/.claude/skills'), in: 'claude-cli' }, 'copilot-cli': at('~/.agents/skills'), 'codex-cli': { ...at('~/.codex/skills'), in: 'codex-cli' }, 'opencode-cli': { ...at('~/.claude/skills'), in: 'claude-cli' } } };
  // Only Copilot CLI's stays after an Off: OpenCode's goes with Claude Code's copy, and which of Codex's two it would then load isn't read.
  assert.deepEqual(five.map(tool => loadsFrom(row, notes, tool)), ['central-knot', 'elsewhere', 'central-knot', 'unknown', 'central-knot']);
  // A tool whose own switch has it off loads none; a plugin's copy on there is a plugin's.
  assert.deepEqual([loadsFrom({ ...row, switchedOff: ['copilot-cli'] }, notes, 'copilot-cli'), loadsFrom({ key: 'notes', pluginOn: ['claude-cli'] }, notes, 'claude-cli')], [undefined, 'plugin']);
});

test('After Use the plugin’s in Pi, his server’s row counts the five tools that load it, four running their own copies, as its tag and its switch say; the take’s Undo gives the row back as before', () => {
  // tracker, his in five tools; the plugin's taken in Pi (library.ts TAKE): its version current and written in Pi alone, the
  // four others kept out and let go, so each keeps running his copy, which Central Knot didn't put there.
  const five = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli'], servers = sentences(libraryWords.mcp);
  const present = (hashes: Record<string, string>) => Object.fromEntries(Object.entries(hashes).map(([tool, hash]) => [tool, { is: 'present', hash, at: 0 }])) as Copies;
  const his = Object.fromEntries(five.map(tool => [tool, 'his'])), takenIn = { ...his, 'pi-cli': 'kit' };
  const taken = { ...newItem('tracker', 'tracker'), on: true, hash: 'kit', except: five.filter(tool => tool !== 'pi-cli') as HarnessId[], applied: { 'pi-cli': 'kit' } };
  const after: LibraryRow = { key: 'tracker', name: 'tracker', hashes: takenIn, plan: plan(taken, present(takenIn)) };
  assert.deepEqual(five.map(tool => loadsFrom(after, taken, tool)), ['elsewhere', 'elsewhere', 'elsewhere', 'central-knot', 'elsewhere']);
  assert.deepEqual([servers.placeTag(after, taken, five)?.text, switchLabel(after, taken, five)],
    ['in 5 of 5 tools · 4 run their own copies', 'tracker: on in 5 of 5 tools; 4 run their own copies. Click to take it out of every tool; Central Knot keeps it.']);
  // Undone (librarypass.ts untake): his version current again, applied in every tool, kept out of none.
  const back = { ...taken, hash: 'his', except: [], applied: his }, before: LibraryRow = { key: 'tracker', name: 'tracker', hashes: his, plan: plan(back, present(his)) };
  assert.deepEqual([servers.placeTag(before, back, five), switchLabel(before, back, five)], [undefined, 'tracker: on. Click to take it out of every tool; Central Knot keeps it.']);
});

test('After a take, a tool kept out that reads another tool’s copy of his is a reader too: OpenCode, reading Claude Code’s folder, counts, and its tag part says it has it another way', () => {
  // triage, his skill in Claude Code, Copilot CLI and Codex (OpenCode reads Claude Code's folder); the plugin's taken in Pi.
  const five = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli'], skills = sentences(libraryWords.skills);
  const at = (tool: string, inTool: HarnessId) => ({ folder: 'triage', name: 'triage', skillFile: `~/${tool}/triage/SKILL.md`, switchedOff: false, in: inTool });
  const hashes = { 'claude-cli': 'his', 'copilot-cli': 'his', 'codex-cli': 'his', 'pi-cli': 'kit' };
  const taken = { ...newItem('triage', 'triage'), on: true, hash: 'kit', except: five.filter(tool => tool !== 'pi-cli') as HarnessId[], applied: { 'pi-cli': 'kit' } };
  const copies = Object.fromEntries(Object.entries(hashes).map(([tool, hash]) => [tool, { is: 'present', hash, at: 0 }])) as Copies;
  const row: LibraryRow = { key: 'triage', name: 'triage', hashes, plan: plan(taken, copies), anotherWay: { 'opencode-cli': 'OpenCode reads a copy in Claude Code’s skills folder, which is not Central Knot’s.' },
    loads: { 'claude-cli': at('claude', 'claude-cli'), 'copilot-cli': at('copilot', 'copilot-cli'), 'codex-cli': at('codex', 'codex-cli'), 'pi-cli': at('pi', 'pi-cli'), 'opencode-cli': at('claude', 'claude-cli') } };
  assert.deepEqual([skills.placeTag(row, taken, five)?.text, switchLabel(row, taken, five)], ['in 5 of 5 tools · 3 run their own copies · OpenCode has it another way',
    'triage: on in 5 of 5 tools; 3 run their own copies; OpenCode has it another way. Click to take it out of every tool; Central Knot keeps it.']);
});

test('Kept out of OpenCode, which reads Claude Code’s folder where Central Knot’s copy stays: OpenCode still loads it, counted and said as having it another way', () => {
  const three = ['claude-cli', 'codex-cli', 'opencode-cli'], skills = sentences(libraryWords.skills);
  const notes = { ...newItem('notes', 'notes'), on: true, hash: 'a', except: ['opencode-cli'] as HarnessId[], applied: { 'claude-cli': 'a', 'codex-cli': 'a' } };
  const hashes = { 'claude-cli': 'a', 'codex-cli': 'a' }, copies = Object.fromEntries(Object.entries(hashes).map(([tool, hash]) => [tool, { is: 'present', hash, at: 0 }])) as Copies;
  const row: LibraryRow = { key: 'notes', name: 'notes', hashes, plan: plan(notes, copies), anotherWay: { 'opencode-cli': 'OpenCode reads Claude Code’s copy, in Claude Code’s skills folder.' },
    loads: { 'opencode-cli': { folder: 'notes', name: 'notes', skillFile: '~/.claude/skills/notes/SKILL.md', switchedOff: false, in: 'claude-cli' } } };
  assert.deepEqual([skills.placeTag(row, notes, three)?.text, switchLabel(row, notes, three)],
    ['in 3 of 3 tools · OpenCode has it another way', 'notes: on in 3 of 3 tools; OpenCode has it another way. Click to take it out of every tool; Central Knot keeps it.']);
});

test('What a result says of Off skills tools still read another way, one click and a run alike: one sentence for the skills the same tools read, none for a tool whose own switch has it off', () => {
  const five = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli'];
  // Read by `readers` through a link into the shared folder, with no copy of Central Knot's; `off`: those whose own switch has it off.
  const linked = (key: string, readers: string[], off: string[] = []): { name: string; row: LibraryRow } => ({ name: key, row: { key, name: key, hashes: {},
    anotherWay: Object.fromEntries(readers.map(tool => [tool, 'It has it through a link in its skills folder (to ~/.agents/skills), which is not Central Knot’s copy.'])),
    loads: Object.fromEntries(readers.map(tool => [tool, { folder: key, name: key, skillFile: `/home/me/.agents/skills/${key}/SKILL.md`, switchedOff: off.includes(tool) }])) } });
  const plain = (key: string) => ({ name: key, row: { key, name: key, hashes: {} } });
  assert.deepEqual(stillReadWords([linked('a', ['codex-cli', 'pi-cli']), linked('b', ['codex-cli', 'pi-cli']), plain('c'), plain('d')], five), ['Codex and Pi still read a and b another way.']);
  assert.deepEqual(stillReadWords(['a', 'b', 'c'].map(key => linked(key, five)), five), ['All 5 tools still read a, b and c another way.']);
  assert.deepEqual(stillReadWords([linked('a', ['codex-cli', 'pi-cli']), linked('b', ['codex-cli'])], five), ['Codex and Pi still read a another way.', 'Codex still reads b another way.']);
  // Pi's own switch has it off: Pi doesn't read it, whatever link it has, and so does the row's tag.
  assert.deepEqual(stillReadWords([linked('a', ['codex-cli', 'pi-cli'], ['pi-cli'])], five), ['Codex still reads a another way.']);
  assert.equal(sentences(libraryWords.skills).placeTag(linked('a', ['codex-cli', 'pi-cli'], ['pi-cli']).row, { ...newItem('a', 'a'), on: false }, five)?.text, 'in Central Knot and Codex');
  assert.deepEqual([copiesDiffer(['draft']), copiesDiffer(['draft (agent)', 'review'])],
    ['draft has differing copies. Choose which copy every tool uses.', 'draft (agent) and review have differing copies. Choose which copy every tool uses for each.']);
  // Who still reads what, and what waits, is the point of these sentences: every name is said, never "and 2 more".
  const names = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual([stillReadWords(names.map(key => linked(key, ['codex-cli', 'pi-cli'])), five), copiesDiffer(names)],
    [['Codex and Pi still read a, b, c, d and e another way.'], 'a, b, c, d and e have differing copies. Choose which copy every tool uses for each.']);
});

test('An Off skill whose only copy left is one a tool has switched off in its own settings: the tool has it and doesn’t read it, and nothing says no tool has it', () => {
  // notes is in Codex through a link into the shared folder, and Codex's own switch has it off: Codex doesn't load it.
  const notes: LibraryRow = { key: 'notes', name: 'notes', hashes: {}, anotherWay: { 'codex-cli': 'Codex has it through a link in its skills folder (to ~/.agents/skills/notes), which is not Central Knot’s copy.' },
    loads: { 'codex-cli': { folder: 'notes', name: 'notes', skillFile: '/home/me/.agents/skills/notes/SKILL.md', switchedOff: true } } };
  const off = { ...newItem('notes', 'notes'), on: false }, skills = sentences(libraryWords.skills);
  assert.deepEqual(skills.placeTag(notes, off, tools), { text: 'in Central Knot · switched off in Codex', title: 'Central Knot keeps this skill and its versions. Codex has a copy switched off in its own settings.' });
  assert.equal(switchLabel(notes, off, tools), 'notes: off, in Central Knot · switched off in Codex. Click to put it in every tool.');
  assert.deepEqual([stillReadWords([{ name: 'notes', row: notes }], tools), switchedOffWords(notes, tools)], [[], ['Codex has a copy switched off in its own settings.']]);
  assert.equal(skills.said.off('notes', [], tools, [], [], switchedOffWords(notes, tools)),
    'notes is off. Codex has a copy switched off in its own settings. Central Knot keeps it, and turning it on puts each folder back as it was.');
});

test('The switch of an Off item says where it is as its row does: a removal still owed first, then a copy that can’t be seen for sure', () => {
  // Codex's removal was refused (its file couldn't be written): the plan still removes it there, so the row reads "still in Codex until sync runs".
  const off = item({ on: false, applied: { 'codex-cli': 'b' } }), owed = row({ 'codex-cli': 'b' }, {}, off);
  assert.deepEqual([placeTag(owed, off, tools)?.text, switchLabel(owed, off, tools)],
    ['still in Codex until sync runs', 'reviewer: off, still in Codex until sync runs. Click to put it in every tool.']);
  const twins = { 'claude-cli': 'Two folders whose names differ only by case are in Claude Code’s skills folder.' };
  const unseen = row({ 'claude-cli': 'b' }, { unseen: twins }, item({ on: false, applied: { 'claude-cli': 'b' } }));
  assert.deepEqual([placeTag(unseen, item({ on: false, applied: { 'claude-cli': 'b' } }), tools)?.text, switchLabel(unseen, item({ on: false, applied: { 'claude-cli': 'b' } }), tools)],
    ['still in Claude Code', 'reviewer: off, still in Claude Code. Click to put it in every tool.']);
  // The opened row's status line says the same place.
  assert.deepEqual([statusLine(owed, off, tools), statusLine(unseen, item({ on: false, applied: { 'claude-cli': 'b' } }), tools)].map(line => line.split('. ')[0]),
    ['Still in Codex until sync runs', 'Still in Claude Code']);
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

test('A notice says what sync did by itself, and which action its button runs; of two edits, "the latest" only where times proved it', () => {
  const notice = (kind: 'edit' | 'conflict' | 'deleted-by-hand', losers: ('claude-cli' | 'copilot-cli')[], orderProved = true) => noticeWords({ kind, item: 'reviewer', winner: 'codex-cli', losers, orderProved });
  assert.deepEqual([notice('edit', ['claude-cli']).text, notice('edit', ['claude-cli']).action], ['reviewer was edited in Codex; that is its current version now, in Claude Code too.', 'undo']);
  assert.equal(notice('conflict', ['copilot-cli']).text, 'reviewer: Codex’s edit is the latest, so it is the current version. Copilot CLI’s is kept as a version.');
  assert.equal(notice('conflict', ['copilot-cli'], false).text, 'reviewer: Codex’s edit is the current version, though the times can’t tell which edit came last. Copilot CLI’s is kept as a version.');
  assert.deepEqual([notice('deleted-by-hand', ['claude-cli']).text, notice('deleted-by-hand', ['claude-cli']).action], ['reviewer was deleted in Codex, so it is off and was taken out of Claude Code. Central Knot keeps it.', 'turn-on']);
});

test('A long versions list folds to its newest four, and says how many more there are; four fit without a fold', () => {
  const versions = (count: number) => Array.from({ length: count }, (_, index) => ({ hash: String(index), at: '2026-11-08T09:20:00.000Z', from: { how: 'edited' as const } }));
  assert.deepEqual([foldVersions(versions(4), false).rest, foldVersions(versions(5), false).rest, foldVersions(versions(5), false).shown.length], [0, 1, FOLDED_VERSIONS]);
  assert.deepEqual([foldVersions(versions(9), true).rest, foldVersions(versions(9), true).shown.length, foldVersions([], false).rest], [0, 9, 0]);
});

test('A library kind’s rows reach the item pages through itemrow.ts kindSource as the view has them, the same rows for the same read', () => {
  const facts = (key: string, on: boolean, except: LibraryFacts['except'] = []): LibraryFacts => ({ key, name: key, description: '', copies: {}, on, except, cannot: {}, edited: [] });
  const home = (items: LibraryFacts[]) => ({ skills: { tools, items: [], library: {} }, mcp: { tools, items: [], library: {} },
    agents: { tools, items, library: { reviewer: item() } } }) as unknown as HomeView;
  const read = home([facts('reviewer', true, ['codex-cli']), facts('writer', false)]);
  const source = kindSource(read, 'agents');
  assert.deepEqual(source.facts.map(fact => [fact.key, fact.on, fact.except]), [['reviewer', true, ['codex-cli']], ['writer', false, []]]);
  assert.equal(source.library.reviewer.on, true);
  assert.equal(kindSource(read, 'agents').facts, source.facts, 'the same rows for the same read, so a page that caches by them keeps them');
  assert.deepEqual([anyOn(read), anyOn(home([facts('writer', false)]))], [true, false], 'an item On in the library counts; one Off does not');
});

test('The sentences that name the item or its copies are in the kind’s words: an agent, and its file', () => {
  const out = item({ except: ['codex-cli'], applied: { 'claude-cli': 'b', 'copilot-cli': 'b' } });
  assert.equal(lineIn({ 'claude-cli': 'b', 'copilot-cli': 'b' }, out, 'codex-cli', 'Codex'), 'Kept out of this tool. Central Knot keeps its file for when you turn it on here.');
  assert.equal(lineIn({ 'claude-cli': 'b', 'copilot-cli': 'b' }, item(), 'codex-cli', 'Codex'), 'Its copy was deleted in Codex. When sync runs, the agent turns off; Central Knot keeps it.');
  assert.deepEqual([placeTag(row({}), item({ on: false }), tools)?.title, placeTag(row({ 'codex-cli': 'x' }), undefined, tools)?.title],
    ['Central Knot keeps this agent and its versions. No tool has it until you turn it on.', 'A tool has this agent; Central Knot doesn’t yet. Add it to keep it in Central Knot and put it in every tool.']);
  assert.equal(noticeWords({ kind: 'deleted-by-hand', item: 'reviewer', winner: 'codex-cli', losers: [], orderProved: true }).help, 'Put reviewer back in every tool, each file as it was');
});

test('The same sentences in another kind’s words name that kind and its copies, never an agent or a file', () => {
  const notes = sentences({ item: 'note', an: 'a note', many: 'notes', copy: 'page', shared: '', own: () => '', body: 'Text' });
  const out = item({ except: ['codex-cli'], applied: { 'claude-cli': 'b', 'copilot-cli': 'b' } });
  const said = [
    notes.harnessLine(row({ 'claude-cli': 'b', 'copilot-cli': 'b' }, {}, out), out, 'codex-cli', 'Codex'),
    notes.harnessLine(row({ 'claude-cli': 'b', 'copilot-cli': 'b' }, {}, item()), item(), 'codex-cli', 'Codex'),
    notes.harnessLine(row({ 'copilot-cli': 'c' }, {}, item({ on: false })), item({ on: false }), 'copilot-cli', 'Copilot CLI'),
    notes.placeTag(row({}), item({ on: false }), tools)?.title, notes.placeTag(row({ 'codex-cli': 'x' }), undefined, tools)?.title,
    notes.said.off('plan', [], tools), notes.said.inHarness('plan', 'codex-cli', true, false),
    notes.noticeWords({ kind: 'deleted-by-hand', item: 'plan', winner: 'codex-cli', losers: [], orderProved: true }).help,
  ];
  assert.deepEqual(said, [
    'Kept out of this tool. Central Knot keeps its page for when you turn it on here.',
    'Its copy was deleted in Codex. When sync runs, the note turns off; Central Knot keeps it.',
    'Edited in Copilot CLI. When sync runs it becomes the current version, then its copy here is removed: the note is off.',
    'Central Knot keeps this note and its versions. No tool has it until you turn it on.',
    'A tool has this note; Central Knot doesn’t yet. Add it to keep it in Central Knot and put it in every tool.',
    'plan is off: no tool has it. Central Knot keeps it, and turning it on puts each page back as it was.',
    'plan is kept out of Codex. Central Knot keeps its page for when you turn it on there.',
    'Put plan back in every tool, each page as it was',
  ]);
  assert.ok(said.every(line => !/\bagent|\bfile\b/.test(line ?? '')), 'no word of the agents’ own');
});

test('What waits for the next pass (waitsForSync: the Overview card’s changes waiting to sync): nothing where every copy is current, or where the one missing can’t be given; an edit to take in; a copy to write; a copy deleted by hand, the only one too, where nothing is left to remove', () => {
  const all = { 'claude-cli': 'b', 'copilot-cli': 'b', 'codex-cli': 'b' }, onlyInCodex = item({ applied: { 'codex-cli': 'b' } }), notCodex = item({ applied: { 'claude-cli': 'b', 'copilot-cli': 'b' } });
  // `cannot`: a tool the plan would write to that can't take it (librarypass.ts copiesOf: an MCP transport it can't hold, say).
  const waits = (hashes: LibraryRow['hashes'], agent = item(), edited: HarnessId[] = [], cannot: LibraryRow['cannot'] = {}) =>
    waitsForSync({ on: agent.on, edited, cannot, plan: row(hashes, {}, agent).plan });
  const cannotTake = { 'codex-cli': 'Codex can’t run a server over this transport.' };
  assert.deepEqual([waits(all), waits({ 'claude-cli': 'b', 'copilot-cli': 'b' }, notCodex, [], cannotTake), waits({ ...all, 'codex-cli': 'c' }, item(), ['codex-cli']),
    waits({ 'claude-cli': 'b', 'copilot-cli': 'b' }, notCodex), waits({ 'claude-cli': 'b', 'copilot-cli': 'b' }), waits({}, onlyInCodex)], [false, false, true, true, true, true]);
  // The last waits as a hand deletion alone: it turns Off at the next pass, with no copy left to remove.
  assert.deepEqual([row({}, {}, onlyInCodex).plan?.turnedOffBy, row({}, {}, onlyInCodex).plan?.remove], ['codex-cli', []]);
});

test('An On item unseen or held in every tool states why on its tool lines; the bold On summary stays empty', () => {
  const why = 'The plugins record is damaged. Nothing was written or deleted. Put the record back, then try again. Its plugins’ items are held as they are until then. The next sync takes them up again once the record is back.';
  const unseen = Object.fromEntries(tools.map(tool => [tool, why]));
  assert.equal(statusLine(row({}, { unseen }, item()), item(), tools), '');
  assert.equal(lineIn({}, item(), 'claude-cli', 'Claude Code', { unseen }), why);
  const pluginOnly = Object.fromEntries(tools.map(tool => [tool, `${tool} gets it only with the plugin partial, and the plugin is kept out.`]));
  assert.equal(statusLine(row({}, { cannot: pluginOnly }, item({ applied: {} })), item({ applied: {} }), tools), '');
  assert.equal(statusLine(row({}, { cannot: { 'claude-cli': pluginOnly['claude-cli'] } }, item({ applied: {} })), item({ applied: {} }), ['claude-cli']), '');
  const keptOld = 'Codex will not load a skill with no YAML frontmatter.';
  assert.equal(statusLine(row({ 'codex-cli': 'a' }, { cannot: { 'codex-cli': keptOld } }, item({ applied: { 'codex-cli': 'a' } })), item({ applied: { 'codex-cli': 'a' } }), ['codex-cli']), '');
  assert.equal(statusLine(row({ 'codex-cli': 'a' }, { cannot: { 'claude-cli': pluginOnly['claude-cli'], 'codex-cli': keptOld } }, item({ applied: { 'codex-cli': 'a' } })),
    item({ applied: { 'codex-cli': 'a' } }), ['claude-cli', 'codex-cli']), '');
});

test('An Off row offers one tool only: rowClicks.onOnly keeps every other tool out, Off lines mark kept-out tools, status and switch label tell where On puts it back, and said.onOnly names any other tool that still has it', () => {
  const six = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli', 'antigravity-cli'] as const;
  const skills = sentences(libraryWords.skills);
  const offTwo = item({ on: false, except: ['codex-cli', 'pi-cli'], applied: {} });
  // One click: on in Claude Code only, keeping every other known harness out so a tool managed later doesn't get it.
  assert.deepEqual(rowClicks.onOnly(row({}), offTwo, 'claude-cli'), {
    key: 'reviewer', on: true, except: ['copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli', 'antigravity-cli'], seenOn: false,
  });
  // Off lines: Kept out where in except, blank otherwise; plugin-sourced Off rows keep today's line; On rows unchanged.
  assert.deepEqual(six.map(tool => skills.harnessLine(row({}, {}, offTwo), offTwo, tool, tool)), ['', '', 'Kept out', 'Kept out', '', '']);
  const pluginOff = row({}, { fromSource: { link: 'plugin:kit@market' } }, offTwo);
  assert.equal(skills.harnessLine(pluginOff, offTwo, 'pi-cli', 'Pi'), 'No copy while it is off.');
  assert.equal(skills.harnessLine(row({}, {}, item({ except: ['codex-cli'], applied: {} })), item({ except: ['codex-cli'], applied: {} }), 'codex-cli', 'Codex'),
    'Kept out of this tool. Central Knot keeps its folder for when you turn it on here.');
  // Off status and switch label: every tool, 4 of 6, 1 tool only, kept out of every tool, and removal still owed.
  const offAll = item({ on: false, except: [], applied: {} });
  const offOne = item({ on: false, except: ['copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli', 'antigravity-cli'], applied: {} });
  const offNone = item({ on: false, except: [...six], applied: {} });
  assert.deepEqual([statusLine(row({}), offAll, six), statusLine(row({}), offTwo, six), statusLine(row({}), offOne, six), statusLine(row({}), offNone, six)], [
    'On puts it in every tool.',
    'On puts it back in 4 of 6 tools.',
    'On puts it back in Claude Code only.',
    'Kept out of every tool; turn on in a tool below.',
  ]);
  assert.deepEqual([switchLabel(row({}), offAll, six), switchLabel(row({}), offTwo, six), switchLabel(row({}), offOne, six), switchLabel(row({}), offNone, six)], [
    'reviewer: off, in Central Knot only. Click to put it in every tool.',
    'reviewer: off, in Central Knot only. Click to put it back in 4 of 6 tools.',
    'reviewer: off, in Central Knot only. Click to put it back in Claude Code.',
    'reviewer: off, in Central Knot only. Click to turn it on (kept out of every tool).',
  ]);
  // A removal still owed keeps offPlace's "Still in … until sync runs." before the On sentence.
  const owed = item({ on: false, except: ['codex-cli'], applied: { 'codex-cli': 'b' } });
  assert.equal(statusLine(row({ 'codex-cli': 'b' }, {}, owed), owed, tools), 'Still in Codex until sync runs. On puts it back in 2 of 3 tools.');
  // An On row drops its bold status line; OpenCode's own line says it reads Claude Code's copy.
  const onClaudeOnly = item({ on: true, except: ['copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli', 'antigravity-cli'], applied: { 'claude-cli': 'b' } });
  const openReads: LibraryRow = {
    key: 'bench-runner', hashes: { 'claude-cli': 'b' },
    plan: { orderProved: true, write: [], remove: [], keep: [], forget: [], ownCopy: [], current: ['claude-cli'] },
    anotherWay: { 'opencode-cli': 'OpenCode reads Claude Code’s copy, in Claude Code’s skills folder.' },
    loads: { 'opencode-cli': { folder: 'bench-runner', name: 'bench-runner', skillFile: '~/.claude/skills/bench-runner/SKILL.md', switchedOff: false, in: 'claude-cli' } },
  };
  assert.equal(statusLine(openReads, onClaudeOnly, six), '');
  // said.onOnly: failure, clean one-tool-only, missing fresh row or unmanaged tool (no "only"), OpenCode reading Claude Code's folder, link reader, own copy in another tool, shared folder + pluginOn.
  assert.equal(skills.said.onOnly('bench-runner', 'claude-cli', true, row({}), six), 'bench-runner couldn’t be put in Claude Code.');
  assert.equal(skills.said.onOnly('bench-runner', 'codex-cli', false, { key: 'bench-runner', hashes: { 'codex-cli': 'b' } }, six), 'bench-runner is on in Codex only.');
  assert.equal(skills.said.onOnly('bench-runner', 'codex-cli', false, undefined, six), 'bench-runner is on in Codex.');
  assert.equal(skills.said.onOnly('left-out-test', 'codex-cli', false, { key: 'left-out-test', hashes: { 'codex-cli': 'b' } },
    ['claude-cli', 'codex-cli', 'pi-cli', 'opencode-cli', 'antigravity-cli'], undefined, ['copilot-cli']),
    'left-out-test is on in Codex.');
  assert.equal(skills.said.onOnly('bench-runner', 'claude-cli', false, openReads, six, onClaudeOnly),
    'bench-runner is on in Claude Code. OpenCode reads it too.');
  const linkedOther: LibraryRow = {
    key: 'bench-runner', hashes: { 'claude-cli': 'b' },
    anotherWay: { 'pi-cli': 'Pi has a link at ~/.pi/agent/skills/bench-runner to ~/shared/bench-runner.' },
    loads: { 'pi-cli': { folder: 'bench-runner', name: 'bench-runner', skillFile: '~/.pi/agent/skills/bench-runner/SKILL.md', switchedOff: false } },
  };
  assert.equal(skills.said.onOnly('bench-runner', 'claude-cli', false, linkedOther, six, onClaudeOnly),
    'bench-runner is on in Claude Code. Pi reads it too.');
  const onCodexOnly = item({ on: true, except: ['claude-cli', 'copilot-cli', 'pi-cli', 'opencode-cli', 'antigravity-cli'], applied: { 'codex-cli': 'b' } });
  const ownInCopilot: LibraryRow = {
    key: 'own-test', hashes: { 'codex-cli': 'b', 'copilot-cli': 'x' },
    plan: { orderProved: true, write: [], remove: [], keep: [], forget: [], ownCopy: ['copilot-cli'], current: ['codex-cli'] },
  };
  assert.equal(skills.said.onOnly('own-test', 'codex-cli', false, ownInCopilot, six, onCodexOnly),
    'own-test is on in Codex. Copilot CLI has its own copy.');
  const ownInTwo: LibraryRow = {
    key: 'own-test', hashes: { 'codex-cli': 'b', 'copilot-cli': 'x', 'pi-cli': 'y' },
    plan: { orderProved: true, write: [], remove: [], keep: [], forget: [], ownCopy: ['copilot-cli', 'pi-cli'], current: ['codex-cli'] },
  };
  assert.equal(skills.said.onOnly('own-test', 'codex-cli', false, ownInTwo, six, onCodexOnly),
    'own-test is on in Codex. Copilot CLI and Pi have their own copies.');
  const sharedAndPlugin: LibraryRow = {
    key: 'bench-runner', hashes: { 'claude-cli': 'b' }, pluginOn: ['copilot-cli'],
    anotherWay: { 'codex-cli': 'Codex also reads a copy at ~/.agents/skills/bench-runner, which is not Central Knot’s.' },
    loads: { 'codex-cli': { folder: 'bench-runner', name: 'bench-runner', skillFile: '~/.agents/skills/bench-runner/SKILL.md', switchedOff: false } },
  };
  assert.equal(skills.said.onOnly('bench-runner', 'claude-cli', false, sharedAndPlugin, six, onClaudeOnly),
    'bench-runner is on in Claude Code. Codex reads it too. Copilot CLI has it on through its plugin.');
});

test('Opened-row shared cards, own-settings label, and armed Delete use the short wording with History’s days and no deleteOffer', () => {
  assert.deepEqual([libraryWords.skills.shared, libraryWords.agents.shared, libraryWords.mcp.shared], [
    'Each tool it is on in gets the same folder: files as they are, scripts runnable.',
    'Name, description and prompt are shared; the rest stays in each tool’s file.',
    'Command, arguments, environment, or URL and headers are shared; the rest stays in each tool’s file.',
  ]);
  assert.deepEqual([libraryWords.agents.own(['tools', 'model']), libraryWords.mcp.own(['timeout']), libraryWords.skills.own()], [
    'Own settings kept: tools and model',
    'Own settings kept: timeout',
    '',
  ]);
  assert.equal(said.deleteArmed(7), 'Removed from Central Knot and every tool it manages. History can restore it for 7 days.');
  assert.equal(said.deleteArmed(30), 'Removed from Central Knot and every tool it manages. History can restore it for 30 days.');
  assert.equal('deleteOffer' in said, false);
});

test('Opened-row tool lines (detailLine) drop standing filler while closed-row marks (harnessLine) keep whole sentences', () => {
  const skills = sentences(libraryWords.skills), agents = sentences(libraryWords.agents), servers = sentences(libraryWords.mcp);
  const all = { 'claude-cli': 'b', 'copilot-cli': 'b', 'codex-cli': 'b' };
  const onItem = item();
  // Current: opened row is blank; closed row's mark keeps the whole sentence.
  assert.deepEqual(skills.detailLine(row(all, {}, onItem), onItem, 'claude-cli', 'Claude Code'), []);
  assert.equal(skills.harnessLine(row(all, {}, onItem), onItem, 'claude-cli', 'Claude Code'), 'Has the current version.');
  // Kept out on an On row: opened row is blank; closed row's mark keeps the whole sentence.
  const out = item({ except: ['codex-cli'], applied: { 'claude-cli': 'b', 'copilot-cli': 'b' } });
  assert.deepEqual(skills.detailLine(row({ 'claude-cli': 'b', 'copilot-cli': 'b' }, {}, out), out, 'codex-cli', 'Codex'), []);
  assert.equal(skills.harnessLine(row({ 'claude-cli': 'b', 'copilot-cli': 'b' }, {}, out), out, 'codex-cli', 'Codex'),
    'Kept out of this tool. Central Knot keeps its folder for when you turn it on here.');
  // Off row (ordinary and plugin-sourced): Kept out where in except, blank otherwise; readBy names readers before the click on ordinary Off rows only (never plugin-sourced or On rows).
  const offTwo = item({ on: false, except: ['codex-cli', 'pi-cli'], applied: {} });
  const plainOff = row({}, {}, offTwo);
  assert.deepEqual(skills.detailLine(plainOff, offTwo, 'codex-cli', 'Codex'), [{ text: 'Kept out' }]);
  assert.deepEqual(skills.detailLine(plainOff, offTwo, 'claude-cli', 'Claude Code'), []);
  const offWithReader = row({}, { readBy: { 'claude-cli': ['opencode-cli'] } }, offTwo);
  assert.deepEqual(skills.detailLine(offWithReader, offTwo, 'claude-cli', 'Claude Code'), [{ text: 'If on, OpenCode reads it too' }]);
  assert.deepEqual(skills.detailLine(offWithReader, offTwo, 'opencode-cli', 'OpenCode'), []);
  const offClaudeOut = item({ on: false, except: ['claude-cli'], applied: {} });
  assert.deepEqual(skills.detailLine(row({}, { readBy: { 'claude-cli': ['opencode-cli'] } }, offClaudeOut), offClaudeOut, 'claude-cli', 'Claude Code'),
    [{ text: 'Kept out' }, { text: 'If on, OpenCode reads it too' }]);
  assert.deepEqual(skills.detailLine(row({}, { readBy: { 'claude-cli': ['opencode-cli', 'pi-cli'] } }, offTwo), offTwo, 'claude-cli', 'Claude Code'),
    [{ text: 'If on, OpenCode and Pi read it too' }]);
  assert.deepEqual(skills.detailLine(row(all, { readBy: { 'claude-cli': ['opencode-cli'] } }, onItem), onItem, 'claude-cli', 'Claude Code'), []);
  const onClaudeOut = item({ except: ['claude-cli'], applied: { 'copilot-cli': 'b', 'codex-cli': 'b' } });
  assert.deepEqual(skills.detailLine(row({ 'copilot-cli': 'b', 'codex-cli': 'b' }, { readBy: { 'claude-cli': ['opencode-cli'] } }, onClaudeOut), onClaudeOut, 'claude-cli', 'Claude Code'), []);
  const pluginOff = row({}, { fromSource: { link: 'plugin:kit@market' }, readBy: { 'claude-cli': ['opencode-cli'] } }, offTwo);
  assert.deepEqual(skills.detailLine(pluginOff, offTwo, 'pi-cli', 'Pi'), [{ text: 'Kept out' }]);
  assert.deepEqual(skills.detailLine(pluginOff, offTwo, 'claude-cli', 'Claude Code'), []);
  assert.equal(skills.harnessLine(pluginOff, offTwo, 'pi-cli', 'Pi'), 'No copy while it is off.');
  // Found row with no copy keeps its line; a tool waiting on another's folder reads readBy (not the sentence text).
  assert.deepEqual(skills.detailLine(row({ 'claude-cli': 'a' }), undefined, 'codex-cli', 'Codex'), [{ text: 'No copy. Adding it puts it here.' }]);
  assert.deepEqual(skills.detailLine(row({ 'codex-cli': 'a' }, { anotherWay: { 'opencode-cli': 'Any wording.' }, readBy: { 'claude-cli': ['opencode-cli'] } }), undefined, 'opencode-cli', 'OpenCode'),
    [{ text: 'Gets it from Claude Code’s skills folder once it is on there.' }]);
  // Reads another tool's folder (skills.ts anotherWay -> readsFrom): short label with T1.10 card; kept-out another-way, link, shared folder, and non-CK copy stay whole.
  const opencodeReads = row({ 'claude-cli': 'b' }, {
    anotherWay: { 'opencode-cli': 'OpenCode reads Claude Code’s copy, in Claude Code’s skills folder.' },
    readsFrom: { 'opencode-cli': 'claude-cli' },
  }, onItem);
  assert.deepEqual(skills.detailLine(opencodeReads, onItem, 'opencode-cli', 'OpenCode'), [{
    text: 'Reads Claude Code’s copy',
    card: 'OpenCode reads this skill from Claude Code’s folder; Central Knot writes nothing to OpenCode meanwhile.',
  }]);
  assert.equal(skills.harnessLine(opencodeReads, onItem, 'opencode-cli', 'OpenCode'),
    'OpenCode reads Claude Code’s copy, in Claude Code’s skills folder. Nothing of Central Knot’s goes there while it does.');
  const opencodeKeptOut = item({ except: ['opencode-cli'], applied: { 'claude-cli': 'b' } });
  assert.deepEqual(skills.detailLine(opencodeReads, opencodeKeptOut, 'opencode-cli', 'OpenCode'), [{
    text: 'Kept out of this tool, but it still has it another way. OpenCode reads Claude Code’s copy, in Claude Code’s skills folder. Keeping it out stops only a folder of Central Knot’s here.',
  }]);
  const notCkCopy = row({}, { anotherWay: { 'opencode-cli': 'OpenCode reads a copy in Claude Code’s skills folder, which is not Central Knot’s.' } }, onItem);
  assert.deepEqual(skills.detailLine(notCkCopy, onItem, 'opencode-cli', 'OpenCode'), [{
    text: 'OpenCode reads a copy in Claude Code’s skills folder, which is not Central Knot’s. Nothing of Central Knot’s goes there while it does.',
  }]);
  const sharedWay = row({}, { anotherWay: { 'codex-cli': 'Codex also reads a copy at ~/.agents/skills, which is not Central Knot’s.' } }, onItem);
  assert.deepEqual(skills.detailLine(sharedWay, onItem, 'codex-cli', 'Codex'), [{
    text: 'Codex also reads a copy at ~/.agents/skills, which is not Central Knot’s. Nothing of Central Knot’s goes there while it does.',
  }]);
  // Own switch & own settings kept; closed mark keeps whole own-switch sentence.
  assert.match(servers.harnessLine(row(all, { switchedOff: ['copilot-cli'] }, onItem), onItem, 'copilot-cli', 'Copilot CLI'),
    /It is switched off in Copilot CLI’s own settings: Copilot CLI doesn’t start it\. Central Knot leaves that switch as it is/);
  // Kept-whole states: own-copy, gets-it, edited, deleted-by-hand, leaving, cannot, unseen, both-ways; current with anotherWay stays blank.
  const bothWays: LibraryRow = {
    key: 'notes',
    hashes: { 'claude-cli': 'b', 'opencode-cli': 'x' },
    anotherWay: { 'opencode-cli': 'OpenCode reads Claude Code’s copy, in Claude Code’s skills folder.' },
    readsFrom: { 'opencode-cli': 'claude-cli' },
    plan: { orderProved: true, write: [], remove: [], keep: [], forget: [], ownCopy: ['opencode-cli'], current: ['claude-cli'] },
  };
  assert.deepEqual(skills.detailLine(bothWays, onItem, 'opencode-cli', 'OpenCode'), [{
    text: skills.harnessLine(bothWays, onItem, 'opencode-cli', 'OpenCode'),
  }]);
  assert.match(skills.detailLine(bothWays, onItem, 'opencode-cli', 'OpenCode')[0]!.text, /has it both ways/);
  const currentWithOther: LibraryRow = { key: 'notes', hashes: all, anotherWay: { 'claude-cli': 'Extra note.' }, plan: { orderProved: true, write: [], remove: [], keep: [], forget: [], ownCopy: [], current: ['claude-cli'] } };
  assert.deepEqual(skills.detailLine(currentWithOther, onItem, 'claude-cli', 'Claude Code'), []);
  const ownCopyItem = item({ on: false, applied: {} });
  assert.deepEqual(skills.detailLine(row({ 'codex-cli': 'x' }, {}, ownCopyItem), ownCopyItem, 'codex-cli', 'Codex'), [{
    text: skills.harnessLine(row({ 'codex-cli': 'x' }, {}, ownCopyItem), ownCopyItem, 'codex-cli', 'Codex'),
  }]);
  const waiting = { 'claude-cli': 'b', 'copilot-cli': 'c', 'codex-cli': 'b' };
  for (const [tool, where] of [['claude-cli', 'Claude Code'], ['copilot-cli', 'Copilot CLI']] as const) {
    assert.deepEqual(agents.detailLine(row(waiting, {}, onItem), onItem, tool, where), [{ text: agents.harnessLine(row(waiting, {}, onItem), onItem, tool, where) }]);
  }
  const deletedRow = row({ 'copilot-cli': 'b', 'codex-cli': 'b' }, {}, onItem);
  assert.deepEqual(agents.detailLine(deletedRow, onItem, 'claude-cli', 'Claude Code'), [{ text: agents.harnessLine(deletedRow, onItem, 'claude-cli', 'Claude Code') }]);
  assert.deepEqual(agents.detailLine(deletedRow, onItem, 'copilot-cli', 'Copilot CLI'), [{ text: agents.harnessLine(deletedRow, onItem, 'copilot-cli', 'Copilot CLI') }]);
  const unseenWhy = { unseen: { 'copilot-cli': 'Copilot CLI’s file could not be read.' } };
  assert.deepEqual(agents.detailLine(row(all, unseenWhy, onItem), onItem, 'copilot-cli', 'Copilot CLI'), [{ text: unseenWhy.unseen['copilot-cli'] }]);
});

test('Pi agent detailLine shows As a skill (?) only where Pi holds the file, not when deleted by hand or still waiting', () => {
  const agents = sentences(libraryWords.agents);
  const all = { 'claude-cli': 'b', 'copilot-cli': 'b', 'codex-cli': 'b' };
  const onItem = item(), withPi = item({ applied: { ...onItem.applied, 'pi-cli': 'b' } });
  const piRow: LibraryRow = { key: 'reviewer', hashes: { ...all, 'pi-cli': 'b' }, plan: { orderProved: true, write: [], remove: [], keep: [], forget: [], ownCopy: [], current: ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli'] } };
  const shortCard = 'Pi has no agents: this is a skill file, with no context, tool limits or model of its own.';
  const card = `${shortCard} Deleting it in Pi turns the agent off everywhere.`;
  assert.deepEqual(agents.detailLine(piRow, withPi, 'pi-cli', 'Pi'), [{ text: 'As a skill', card }]);
  assert.deepEqual(agents.detailLine({ ...piRow, switchedOff: ['pi-cli'] }, withPi, 'pi-cli', 'Pi'), [{ text: 'As a skill', card }, { text: 'Off in Pi’s settings' }]);
  // Leaving and Pi's own copy: deleting it in Pi does not turn the agent off everywhere, so the card omits that sentence.
  const piLeaving: LibraryRow = { key: 'reviewer', hashes: { ...all, 'pi-cli': 'b' }, plan: { orderProved: true, write: [], remove: ['pi-cli'], keep: [], forget: [], ownCopy: [], current: ['claude-cli', 'copilot-cli', 'codex-cli'] } };
  const keptOutPi = item({ except: ['pi-cli'], applied: { ...onItem.applied, 'pi-cli': 'b' } });
  assert.deepEqual(agents.detailLine(piLeaving, keptOutPi, 'pi-cli', 'Pi'), [{ text: agents.harnessLine(piLeaving, keptOutPi, 'pi-cli', 'Pi') }, { text: 'As a skill', card: shortCard }]);
  const piOwnOff = item({ on: false, applied: {} });
  const piOwnRow: LibraryRow = { key: 'reviewer', hashes: { 'pi-cli': 'x' }, plan: { orderProved: true, write: [], remove: [], keep: [], forget: [], ownCopy: ['pi-cli'], current: [] } };
  assert.deepEqual(agents.detailLine(piOwnRow, piOwnOff, 'pi-cli', 'Pi'), [{ text: agents.harnessLine(piOwnRow, piOwnOff, 'pi-cli', 'Pi') }, { text: 'As a skill', card: shortCard }]);
  assert.deepEqual(agents.detailLine({ key: 'reviewer', hashes: { 'pi-cli': 'x' } }, undefined, 'pi-cli', 'Pi'), [{ text: 'Has it.' }, { text: 'As a skill', card: shortCard }]);
  const piDeleted: LibraryRow = { key: 'reviewer', hashes: all, plan: { orderProved: true, write: [], remove: ['claude-cli', 'copilot-cli', 'codex-cli'], keep: [], forget: [], ownCopy: [], current: [], turnedOffBy: 'pi-cli' } };
  assert.deepEqual(agents.detailLine(piDeleted, withPi, 'pi-cli', 'Pi'), [{ text: agents.harnessLine(piDeleted, withPi, 'pi-cli', 'Pi') }]);
  const piPending: LibraryRow = { key: 'reviewer', hashes: all, plan: { orderProved: true, write: ['pi-cli'], remove: [], keep: [], forget: [], ownCopy: [], current: ['claude-cli', 'copilot-cli', 'codex-cli'] } };
  assert.deepEqual(agents.detailLine(piPending, onItem, 'pi-cli', 'Pi'), [{ text: 'Gets it when sync runs next.' }]);
  assert.deepEqual(agents.detailLine({ key: 'reviewer', hashes: all, cannot: { 'pi-cli': 'Pi already has a skill named reviewer.' } }, onItem, 'pi-cli', 'Pi'),
    [{ text: 'Pi already has a skill named reviewer.' }]);
  assert.deepEqual(agents.detailLine(row({}, {}, item({ on: false, applied: {} })), item({ on: false, applied: {} }), 'pi-cli', 'Pi'), []);
});

test('MCP server Off in settings carries a card explaining Central Knot leaves the switch and how to turn it back on; skills carry none', () => {
  const skills = sentences(libraryWords.skills), servers = sentences(libraryWords.mcp);
  const all = { 'claude-cli': 'b', 'copilot-cli': 'b', 'codex-cli': 'b' }, onItem = item();
  assert.deepEqual(servers.detailLine(row(all, { switchedOff: ['copilot-cli'] }, onItem), onItem, 'copilot-cli', 'Copilot CLI', ['tools']), [
    {
      text: 'Off in Copilot CLI’s settings',
      card: 'Copilot CLI doesn’t start it. Central Knot leaves that switch as it is, so it is still off there after Off and On. Turn it back on in Copilot CLI’s own settings.',
    },
    { text: 'Own settings kept: tools' },
  ]);
  assert.equal(servers.placeTag(row(all, { switchedOff: ['copilot-cli'] }, onItem), onItem, tools)?.title,
    'Switched off in Copilot CLI’s own settings: each tool’s own switch, which Central Knot leaves as it is. Turn it back on in that tool’s own settings.');
  assert.deepEqual(skills.detailLine(row(all, { switchedOff: ['copilot-cli'] }, onItem), onItem, 'copilot-cli', 'Copilot CLI'), [
    { text: 'Off in Copilot CLI’s settings' },
  ]);
});

test('A plugin’s agent on in Claude Code through the plugin names Codex as unable to take it, never Claude Code; with the plugin off in Claude Code, the line says not in Claude Code or Codex', () => {
  const five: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli'];
  const link = 'plugin:release-helper@team-tools';
  const held = (claudeWhy: string) => ({
    'claude-cli': claudeWhy,
    'copilot-cli': 'Copilot CLI gets it only with the plugin release-helper, and it isn’t installed there (its line on the plugin’s page says why).',
    'codex-cli': 'Codex gets it only with the plugin release-helper, and it isn’t installed there (its line on the plugin’s page says why).',
  });
  const agent = {
    ...newItem('release-reviewer', 'release-reviewer'),
    on: true,
    hash: 'b',
    except: ['pi-cli', 'opencode-cli'] as HarnessId[],
    applied: {},
  };
  const home = {
    agents: { tools: five, items: [], library: {} },
    pluginItems: [{ tool: 'claude-cli', plugin: 'release-helper', marketName: 'team-tools', items: [] }],
  } as unknown as HomeView;
  const getsWithPlugin = withPluginOnly(home, 'agents', { fromSource: { link }, on: true, except: agent.except });
  const rowWith = (claudeWhy: string, pluginOn: string[]): LibraryRow => {
    const cannot = held(claudeWhy);
    const copies: Copies = Object.fromEntries(five.map(tool => [
      tool,
      cannot[tool as keyof typeof cannot] ? { is: 'held' as const, why: cannot[tool as keyof typeof cannot] } : { is: 'absent' as const },
    ]));
    return { key: 'release-reviewer', name: 'release-reviewer', fromSource: { link }, hashes: {}, cannot, getsWithPlugin, pluginOn, plan: plan(agent, copies) };
  };
  assert.equal(
    statusLine(rowWith('Claude Code has it with the plugin release-helper, so no separate copy is placed there.', ['claude-cli']), agent, five),
    '',
  );
  assert.equal(
    statusLine(rowWith('Claude Code has it with the plugin release-helper, turned off there, so no separate copy is placed there.', []), agent, five),
    '',
  );
});

test('A library row from a Git source names Sync this source and Replace mine in its directions', () => {
  const link = 'https://github.com/team/notes';
  assert.equal(fromSourceWords({ link }).before,
    'From github.com/team/notes, a source. What changes there comes in once a day while Automatic sync is on, and at Sync this source on ');
  assert.equal(fromSourceWords({ link, nextWaits: true }).before,
    'From github.com/team/notes, a source. You changed it here, or a tool’s copy of it can’t be read just now, so the source’s next change will wait for you to Merge, Replace mine or Keep mine on ');
  const waiting = fromSourceWords({ link, waits: true });
  assert.match(waiting.after, /and Replace mine takes it as it is; either keeps yours as a version\./);
  assert.match(waiting.tag?.title ?? '', /and Replace mine takes it as it is; either keeps yours as a version\./);
  // A plugin link keeps its hover tag and drops the standing paragraph at the bottom of details.
  const fromPlugin = fromSourceWords({ link: 'plugin:issue-tracker@team-tools' });
  assert.deepEqual([fromPlugin.tag?.text, fromPlugin.before, fromPlugin.after], ['from the plugin issue-tracker', '', '']);
  assert.match(fromPlugin.tag?.title ?? '', /In Pi, OpenCode and Antigravity it follows the plugin; a change you make to it here makes it your own/);
});

test('showsPlaceTag hides routine Found and Off tags under their own headings, keeps non-routine rows and every tag under other headings', () => {
  const plainFound = row({ 'claude-cli': 'a' });
  const cantAdd = row({}, { unseen: { 'claude-cli': 'Cannot read.' } });
  const cannotFound = row({ 'claude-cli': 'a' }, { cannot: { 'codex-cli': 'Codex can’t take it.' } });
  const sharedFound = row({ 'claude-cli': 'a' }, { anotherWay: { 'codex-cli': 'Codex reads ~/.agents/skills.' } });
  const readerTools = ['claude-cli', 'codex-cli', 'opencode-cli'];
  const readerFound = row({ 'claude-cli': 'a' }, {
    anotherWay: { 'opencode-cli': 'OpenCode reads Claude Code’s copy.' },
    readsFrom: { 'opencode-cli': 'claude-cli' },
    readBy: { 'claude-cli': ['opencode-cli'] },
  });
  const off = item({ on: false, applied: {} });
  const plainOff = row({}, {}, off);
  const offOwn = row({ 'codex-cli': 'x' }, {}, off);
  const offPlugin = row({}, { pluginOn: ['claude-cli'] }, off);
  const offSwitched = row({}, {
    anotherWay: { 'codex-cli': 'Codex has a link.' },
    loads: { 'codex-cli': { folder: 'reviewer', name: 'reviewer', skillFile: '~/.codex/skills/reviewer/SKILL.md', switchedOff: true } },
  }, off);
  const offOwedItem = item({ on: false, applied: { 'codex-cli': 'b' } });
  const offOwed = row({ 'codex-cli': 'b' }, {}, offOwedItem);
  // Under Found: routine plain found (including OpenCode reading Claude Code) hides; !canAdd, cannot, non-reader anotherWay, and pinned Off stay.
  assert.deepEqual([
    showsPlaceTag('found', plainFound, undefined, tools),
    showsPlaceTag('found', readerFound, undefined, readerTools),
    showsPlaceTag('found', cantAdd, undefined, tools),
    showsPlaceTag('found', cannotFound, undefined, tools),
    showsPlaceTag('found', sharedFound, undefined, tools),
    showsPlaceTag('found', plainOff, off, tools),
  ], [false, false, true, true, true, true]);
  // Under Off: routine Off hides; own copy, pluginOn, switchedOff, and pending removal stay.
  assert.deepEqual([
    showsPlaceTag('off', plainOff, off, tools),
    showsPlaceTag('off', offOwn, off, tools),
    showsPlaceTag('off', offPlugin, off, tools),
    showsPlaceTag('off', offSwitched, off, tools),
    showsPlaceTag('off', offOwed, offOwedItem, tools),
  ], [false, true, true, true, true]);
  // Under Results, Not in <tool> (away), and On: routine tags stay.
  for (const heading of ['results', 'away', 'on'] as const) {
    assert.deepEqual([showsPlaceTag(heading, plainFound, undefined, tools), showsPlaceTag(heading, plainOff, off, tools)], [true, true]);
  }
});
