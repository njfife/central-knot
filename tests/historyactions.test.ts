// History's entries about agents, as worked examples on plain values (src/historyactions.ts): what each entry says, the
// action it offers for the agent as the library holds it now, and when it offers none. The same on real files, with the
// click each action runs: tests/agents.test.ts and tests/agentswalk.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doneWords, libraryAction, libraryEntry, librarySentence, versionChoices } from '../src/historyactions.ts';
import { libraryWords } from '../src/libraryrow.ts';
import { newItem, type LibraryItem } from '../src/library.ts';
import type { HistoryEvent } from '../src/types.ts';

const tools = ['claude-cli', 'copilot-cli', 'codex-cli'];
const at = '2026-11-08T09:20:00.000Z';
/** "reviewer", On at version 'b' (edited in Codex), with the earlier 'a' and a copy that gave way, 'x'. */
const item = (changes: Partial<LibraryItem> = {}): LibraryItem => ({ ...newItem('agent', 'reviewer', 'reviewer'), on: true, hash: 'b', versions: [
  { hash: 'b', at, from: { how: 'edited', harness: 'codex-cli' } }, { hash: 'x', at, from: { how: 'was-in', harness: 'copilot-cli' } }, { hash: 'a', at, from: { how: 'found', harness: 'claude-cli' } }], ...changes });
const entry = (fields: Partial<HistoryEvent>): HistoryEvent => ({ id: 'e', at, key: 'agent:reviewer', item: 'reviewer', kind: 'edit', losers: [], orderProved: true, ...fields });
const offered = (event: HistoryEvent, agent: LibraryItem | undefined) => { const action = libraryAction(event, agent); return action && [action.label, action.change]; };
const asIs = { key: 'reviewer', managed: true, off: [] };

test('An Off entry offers Turn on while the agent is Off, and nothing once it is On again', () => {
  const off = entry({ kind: 'off', cause: 'switch', losers: [{ tool: 'claude-cli', hash: 'b' }, { tool: 'codex-cli', hash: 'b' }] });
  assert.equal(librarySentence(off, libraryWords.agents, tools)?.text, 'Turned off: removed from Claude Code and Codex. Central Knot keeps it.');
  assert.deepEqual(offered(off, item({ on: false })), ['Turn on', { ...asIs, managed: true }]);
  assert.equal(offered(off, item()), undefined);
});

test('A copy deleted by hand says where, and its entry turns the agent on again', () => {
  const byHand = entry({ kind: 'off', cause: 'deleted-by-hand', winner: { tool: 'copilot-cli', hash: 'b' }, losers: [{ tool: 'claude-cli', hash: 'b' }] });
  assert.equal(librarySentence(byHand, libraryWords.agents, tools)?.text, 'Its copy was deleted in Copilot CLI, so it was turned off and removed from Claude Code. Central Knot keeps it.');
  assert.deepEqual(offered(byHand, item({ on: false }))?.[0], 'Turn on');
});

test('An On entry offers Turn off while the agent is On; a found agent taken in says where it was found, and one Pull brought says so', () => {
  const on = entry({ kind: 'on', cause: 'switch', losers: tools.map(tool => ({ tool: tool as 'claude-cli', hash: 'b' })) });
  assert.equal(librarySentence(on, libraryWords.agents, tools)?.text, 'Turned on: put in all 3 tools.');
  assert.deepEqual(offered(on, item()), ['Turn off', { ...asIs, managed: false }]);
  assert.equal(offered(on, item({ on: false })), undefined);
  const takenIn = entry({ kind: 'on', cause: 'found', winner: { tool: 'claude-cli', hash: 'a' }, losers: [{ tool: 'codex-cli', hash: '' }] });
  assert.equal(librarySentence(takenIn, libraryWords.agents, tools)?.text, 'Found in Claude Code and taken into Central Knot; put in Codex.');
  const pulled = entry({ kind: 'on', cause: 'pulled', via: 'repo', losers: tools.map(tool => ({ tool: tool as 'claude-cli', hash: '' })) });
  assert.equal(librarySentence(pulled, libraryWords.agents, tools)?.text, 'Pulled from the Git repo into Central Knot; put in all 3 tools.');
  assert.deepEqual(offered(pulled, item())?.[0], 'Turn off');
});

test('One harness’s switch: its entry turns that harness on or off again, while that would change something', () => {
  const out = entry({ kind: 'off', only: 'codex-cli', losers: [{ tool: 'codex-cli', hash: 'b' }] });
  assert.equal(librarySentence(out, libraryWords.agents, tools)?.text, 'Kept out of Codex: its copy there was removed. Central Knot keeps it.');
  assert.deepEqual(offered(out, item({ except: ['codex-cli', 'copilot-cli'] })), ['Turn on in Codex', { ...asIs, off: ['copilot-cli'] }]);
  assert.equal(offered(out, item()), undefined, 'it is in Codex again');
  assert.equal(offered(out, item({ on: false, except: ['codex-cli'] })), undefined, 'the whole agent is off: its row’s switch comes first');
  const back = entry({ kind: 'on', only: 'codex-cli', losers: [{ tool: 'codex-cli', hash: 'b' }] });
  assert.equal(librarySentence(back, libraryWords.agents, tools)?.text, 'Turned on in Codex: its file there is back.');
  assert.deepEqual(offered(back, item()), ['Turn off in Codex', { ...asIs, off: ['codex-cli'] }]);
  assert.equal(offered(back, item({ except: ['codex-cli'] })), undefined);
});

test('A content change offers Undo: the version from before it made current, unless it is current already or no longer a version', () => {
  const edit = entry({ kind: 'edit', winner: { tool: 'codex-cli', hash: 'b' }, previous: 'a', losers: [{ tool: 'claude-cli', hash: 'a' }] });
  assert.equal(librarySentence(edit, libraryWords.agents, tools)?.text, 'Edited in Codex; that became the current version, in Claude Code too.');
  // What made it is the entry's cause alone: Pull's own entries say so, with or without a new version.
  const pulled = entry({ kind: 'edit', cause: 'pulled', previous: 'a', version: 'b', losers: [{ tool: 'claude-cli', hash: 'a' }] });
  assert.equal(librarySentence(pulled, libraryWords.agents, tools)?.text, 'Pulled from the Git repo; that became the current version, in Claude Code.');
  assert.match(librarySentence({ ...pulled, previous: undefined, losers: [] }, libraryWords.agents, tools)!.text, /^Pulled from the Git repo: Claude Code’s own settings for it/);
  assert.equal(librarySentence(entry({ kind: 'deleted', cause: 'pulled', losers: [] }), libraryWords.agents, tools)?.text, 'Removed in the Git repo, so Pull deleted it from Central Knot. History keeps it.');
  assert.deepEqual(offered(edit, item()), ['Undo', { ...asIs, version: 'a' }]);
  assert.equal(offered(edit, item({ hash: 'a' })), undefined, 'the earlier version is current already');
  assert.equal(offered({ ...edit, previous: 'gone' }, item()), undefined, 'not a version of this agent');
  assert.deepEqual(offered(edit, item({ on: false }))?.[1], { key: 'reviewer', managed: false, off: [], version: 'a' }, 'an Off agent’s version changes too; it stays off');
  // Once later changes came, an older entry's action says what it does: it doesn't roll back everything after it.
  assert.deepEqual(offered(edit, item({ hash: 'x' })), ['Go back before this', { ...asIs, version: 'a' }]);
  const current = entry({ kind: 'current', version: 'a', previous: 'b', losers: [{ tool: 'claude-cli', hash: 'b' }] });
  // Named as the versions list names it: this agent's versions share a minute, so to the second.
  assert.match(librarySentence(current, libraryWords.agents, tools, item({ hash: 'a' }))!.text, /^The version found in Claude Code \(.*\d:\d\d:\d\d.*\) was made current, in Claude Code\.$/);
  // An entry that undid another (that one's undoneBy names it) reads as an Undo, so the two never read alike.
  assert.match(librarySentence(current, libraryWords.agents, tools, item({ hash: 'a' }), true)!.text, /^Undone: the version from .*\d:\d\d:\d\d.* is current again, in Claude Code\.$/);
  assert.deepEqual(offered(current, item({ hash: 'a' }))?.[1], { ...asIs, version: 'b' });
});

test('Competing edits and a choice among found copies offer each copy that gave way, while its version is not the current one', () => {
  const conflict = entry({ kind: 'conflict', winner: { tool: 'codex-cli', hash: 'b' }, previous: 'a', losers: [{ tool: 'copilot-cli', hash: 'x' }, { tool: 'claude-cli', hash: 'a' }] });
  assert.equal(librarySentence(conflict, libraryWords.agents, tools)?.text, 'Codex’s edit was the latest, so it became the current version. Copilot CLI’s is kept as a version.');
  assert.deepEqual(versionChoices(conflict, item()), [{ tool: 'copilot-cli', hash: 'x' }]);
  assert.deepEqual(libraryAction(conflict, item(), 'x')?.change, { ...asIs, version: 'x' });
  assert.deepEqual(versionChoices(conflict, item({ hash: 'x' })), [], 'that copy’s version is current now');
  assert.equal(libraryAction(conflict, item(), 'a'), undefined, 'only a copy the entry offers');
  const chosen = entry({ kind: 'chosen', winner: { tool: 'codex-cli', hash: 'b' }, losers: [{ tool: 'copilot-cli', hash: 'x' }], tookFrom: [{ tool: 'codex-cli', hash: 'b' }, { tool: 'copilot-cli', hash: 'x' }] });
  assert.equal(librarySentence(chosen, libraryWords.agents, tools)?.text, 'You chose Codex’s copy; Copilot CLI’s is kept as a version.');
  assert.deepEqual(versionChoices(chosen, item()), [{ tool: 'copilot-cli', hash: 'x' }]);
  // While the item is as the choice left it, its Undo takes it out again and gives each tool its own copy back.
  assert.deepEqual(offered(chosen, item()), ['Undo', { ...asIs, deleted: true, giveBack: { 'codex-cli': 'b', 'copilot-cli': 'x' } }]);
  assert.equal(offered(chosen, item({ hash: 'x' })), undefined, 'not once it has moved on');
});

test('A deletion offers Restore while the agent is deleted; every other entry of a deleted agent offers nothing', () => {
  const deleted = entry({ kind: 'deleted', losers: tools.map(tool => ({ tool: tool as 'claude-cli', hash: 'b' })) });
  const gone = item({ deleted: { at } });
  assert.equal(librarySentence(deleted, libraryWords.agents, tools)?.text, 'Deleted from Central Knot and removed from all 3 tools. History keeps it.');
  assert.deepEqual(offered(deleted, gone), ['Restore', { ...asIs, deleted: false }]);
  assert.equal(offered(deleted, item()), undefined, 'it is back already');
  assert.equal(offered(entry({ kind: 'edit', previous: 'a' }), gone), undefined);
  assert.deepEqual(versionChoices(entry({ kind: 'chosen', losers: [{ tool: 'copilot-cli', hash: 'x' }] }), gone), []);
  assert.equal(librarySentence(entry({ kind: 'restored' }), libraryWords.agents, tools)?.text, 'Restored to Central Knot.');
  // Over newer copies of that name, which were kept as versions before the write.
  const over = entry({ kind: 'restored', losers: [{ tool: 'claude-cli', hash: 'n' }, { tool: 'codex-cli', hash: 'm' }, { tool: 'copilot-cli', hash: '' }] });
  assert.equal(librarySentence(over, libraryWords.agents, tools)?.text, 'Restored to Central Knot and put back in all 3 tools. Your newer copies of reviewer in Claude Code and Codex are kept as versions.');
});

test('An entry whose action was used offers nothing, and its row says what became of it', () => {
  assert.equal(offered(entry({ kind: 'off', undoneBy: 'later' }), item({ on: false })), undefined);
  assert.deepEqual(['off', 'on', 'deleted', 'edit'].map(kind => doneWords(entry({ kind: kind as 'off' }))), ['Turned on since', 'Turned off since', 'Restored', 'Undone']);
});

test('Entries from before the library: one naming an earlier version offers Undo; copies an earlier engine added offer nothing; an unknown agent, nothing', () => {
  assert.deepEqual(offered(entry({ kind: 'restored', winner: { tool: 'claude-cli', hash: 'b' }, previous: 'a' }), item())?.[0], 'Undo');
  assert.equal(librarySentence(entry({ kind: 'restored', winner: { tool: 'claude-cli', hash: 'b' }, previous: 'a' }), libraryWords.agents, tools), undefined, 'the general sentence still holds');
  assert.equal(offered(entry({ kind: 'added', previous: 'a' }), item()), undefined);
  assert.equal(offered(entry({ kind: 'off' }), undefined), undefined);
});

test('Whose an entry is: an agent’s and a server’s by their prefix (a server named as written before the library), a skill’s by its bare key; a Pull of Claude Code’s own settings, a profile or the base is none of these', () => {
  assert.equal(libraryEntry(entry({ settingsFile: { path: '/x', kept: '/y', wrote: 'z' } })), undefined);
  assert.deepEqual(libraryEntry(entry({})), { kind: 'agents', key: 'reviewer' });
  assert.deepEqual(libraryEntry(entry({ key: 'notes' })), { kind: 'skills', key: 'notes' });
  assert.deepEqual([libraryEntry(entry({ key: 'mcp:docs' })), libraryEntry(entry({ key: 'mcp:GitHub' }))], [{ kind: 'mcp', key: 'docs' }, { kind: 'mcp', key: 'github' }]);
  for (const other of [entry({ key: 'profiles:switch', kind: 'profile' }), entry({ key: 'instructions:base' })]) assert.equal(libraryEntry(other), undefined);
});

test('A skill’s entries from before the library that no click can say again show as past: Remove, Disable, take-over, copies added', () => {
  const skill = { ...item(), kind: 'skill' as const, key: 'notes', name: 'notes' };
  for (const kind of ['removed', 'switched', 'took-over', 'added'] as const) assert.equal(libraryAction(entry({ key: 'notes', kind, previous: 'a' }), skill), undefined, kind);
  // A skill's copies taken over now, and a tool's switch cleared, are said in the skill's words; neither has an Undo.
  assert.equal(librarySentence(entry({ key: 'notes', kind: 'switched', switched: [{ tool: 'codex-cli', disabled: false }] }), libraryWords.skills, tools)?.text, 'Codex’s own switch for it was cleared: Codex loads it again.');
  assert.equal(librarySentence(entry({ key: 'notes', kind: 'switched', switched: [{ tool: 'codex-cli', disabled: true }] }), libraryWords.skills, tools), undefined, 'a Disable from before the library keeps the general sentence');
  assert.match(librarySentence(entry({ key: 'notes', kind: 'took-over', losers: [{ tool: 'codex-cli', hash: 'x', path: '/h/.agents/skills/notes' }] }), libraryWords.skills, tools)!.text, /^Took over the copy at \/h\/\.agents\/skills\/notes: Codex has Central Knot’s copy now/);
});

test('An action leaves the rest of the agent as it is: one kept out of a tool stays kept out of it', () => {
  const edit = entry({ kind: 'edit', previous: 'a', winner: { tool: 'codex-cli', hash: 'b' } });
  assert.deepEqual(offered(edit, item({ except: ['copilot-cli'] })), ['Undo', { key: 'reviewer', managed: true, off: ['copilot-cli'], version: 'a' }]);
});
