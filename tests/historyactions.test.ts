// History's entries about agents, as worked examples on plain values (src/historyactions.ts): what each entry says, the
// action it offers for the agent as the library holds it now, and when it offers none. The same on real files, with the
// click each action runs: tests/agents.test.ts and tests/agentswalk.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentAction, agentSentence, doneWords, isAgentEntry, versionChoices } from '../src/historyactions.ts';
import { newItem, type LibraryItem } from '../src/library.ts';
import type { HistoryEvent } from '../src/types.ts';

const tools = ['claude-cli', 'copilot-cli', 'codex-cli'];
const at = '2026-11-08T09:20:00.000Z';
/** "reviewer", On at version 'b' (edited in Codex), with the earlier 'a' and a copy that gave way, 'x'. */
const item = (changes: Partial<LibraryItem> = {}): LibraryItem => ({ ...newItem('agent', 'reviewer', 'reviewer'), on: true, hash: 'b', versions: [
  { hash: 'b', at, from: { how: 'edited', harness: 'codex-cli' } }, { hash: 'x', at, from: { how: 'was-in', harness: 'copilot-cli' } }, { hash: 'a', at, from: { how: 'found', harness: 'claude-cli' } }], ...changes });
const entry = (fields: Partial<HistoryEvent>): HistoryEvent => ({ id: 'e', at, key: 'agent:reviewer', item: 'reviewer', kind: 'edit', losers: [], orderProved: true, ...fields });
const offered = (event: HistoryEvent, agent: LibraryItem | undefined) => { const action = agentAction(event, agent); return action && [action.label, action.change]; };
const asIs = { key: 'reviewer', managed: true, off: [] };

test('An Off entry offers Turn on while the agent is Off, and nothing once it is On again', () => {
  const off = entry({ kind: 'off', cause: 'switch', losers: [{ tool: 'claude-cli', hash: 'b' }, { tool: 'codex-cli', hash: 'b' }] });
  assert.equal(agentSentence(off, tools)?.text, 'Turned off: removed from Claude Code and Codex. Central Knot keeps it.');
  assert.deepEqual(offered(off, item({ on: false })), ['Turn on', { ...asIs, managed: true }]);
  assert.equal(offered(off, item()), undefined);
});

test('A copy deleted by hand says where, and its entry turns the agent on again', () => {
  const byHand = entry({ kind: 'off', cause: 'deleted-by-hand', winner: { tool: 'copilot-cli', hash: 'b' }, losers: [{ tool: 'claude-cli', hash: 'b' }] });
  assert.equal(agentSentence(byHand, tools)?.text, 'Its copy was deleted in Copilot CLI, so it was turned off and removed from Claude Code. Central Knot keeps it.');
  assert.deepEqual(offered(byHand, item({ on: false }))?.[0], 'Turn on');
});

test('An On entry offers Turn off while the agent is On; a found agent taken in says where it was found, and one Pull brought says so', () => {
  const on = entry({ kind: 'on', cause: 'switch', losers: tools.map(tool => ({ tool: tool as 'claude-cli', hash: 'b' })) });
  assert.equal(agentSentence(on, tools)?.text, 'Turned on: put in all 3 tools.');
  assert.deepEqual(offered(on, item()), ['Turn off', { ...asIs, managed: false }]);
  assert.equal(offered(on, item({ on: false })), undefined);
  const takenIn = entry({ kind: 'on', cause: 'found', winner: { tool: 'claude-cli', hash: 'a' }, losers: [{ tool: 'codex-cli', hash: '' }] });
  assert.equal(agentSentence(takenIn, tools)?.text, 'Found in Claude Code and taken into Central Knot; put in Codex.');
  const pulled = entry({ kind: 'on', cause: 'pulled', via: 'repo', losers: tools.map(tool => ({ tool: tool as 'claude-cli', hash: '' })) });
  assert.equal(agentSentence(pulled, tools)?.text, 'Pulled from the Git repo into Central Knot; put in all 3 tools.');
  assert.deepEqual(offered(pulled, item())?.[0], 'Turn off');
});

test('One harness’s switch: its entry turns that harness on or off again, while that would change something', () => {
  const out = entry({ kind: 'off', only: 'codex-cli', losers: [{ tool: 'codex-cli', hash: 'b' }] });
  assert.equal(agentSentence(out, tools)?.text, 'Kept out of Codex: its copy there was removed. Central Knot keeps it.');
  assert.deepEqual(offered(out, item({ except: ['codex-cli', 'copilot-cli'] })), ['Turn on in Codex', { ...asIs, off: ['copilot-cli'] }]);
  assert.equal(offered(out, item()), undefined, 'it is in Codex again');
  assert.equal(offered(out, item({ on: false, except: ['codex-cli'] })), undefined, 'the whole agent is off: its row’s switch comes first');
  const back = entry({ kind: 'on', only: 'codex-cli', losers: [{ tool: 'codex-cli', hash: 'b' }] });
  assert.equal(agentSentence(back, tools)?.text, 'Turned on in Codex: its file there is back.');
  assert.deepEqual(offered(back, item()), ['Turn off in Codex', { ...asIs, off: ['codex-cli'] }]);
  assert.equal(offered(back, item({ except: ['codex-cli'] })), undefined);
});

test('A content change offers Undo: the version from before it made current, unless it is current already or no longer a version', () => {
  const edit = entry({ kind: 'edit', winner: { tool: 'codex-cli', hash: 'b' }, previous: 'a', losers: [{ tool: 'claude-cli', hash: 'a' }] });
  assert.equal(agentSentence(edit, tools)?.text, 'Edited in Codex; that became the current version, in Claude Code too.');
  assert.deepEqual(offered(edit, item()), ['Undo', { ...asIs, version: 'a' }]);
  assert.equal(offered(edit, item({ hash: 'a' })), undefined, 'the earlier version is current already');
  assert.equal(offered({ ...edit, previous: 'gone' }, item()), undefined, 'not a version of this agent');
  assert.deepEqual(offered(edit, item({ on: false }))?.[1], { key: 'reviewer', managed: false, off: [], version: 'a' }, 'an Off agent’s version changes too; it stays off');
  // Once later changes came, an older entry's action says what it does: it doesn't roll back everything after it.
  assert.deepEqual(offered(edit, item({ hash: 'x' })), ['Go back before this', { ...asIs, version: 'a' }]);
  const current = entry({ kind: 'current', version: 'a', previous: 'b', losers: [{ tool: 'claude-cli', hash: 'b' }] });
  assert.match(agentSentence(current, tools, item({ hash: 'a' }))!.text, /^The version found in Claude Code \(.*\) was made current, in Claude Code\.$/);
  assert.deepEqual(offered(current, item({ hash: 'a' }))?.[1], { ...asIs, version: 'b' });
});

test('Competing edits and a choice among found copies offer each copy that gave way, while its version is not the current one', () => {
  const conflict = entry({ kind: 'conflict', winner: { tool: 'codex-cli', hash: 'b' }, previous: 'a', losers: [{ tool: 'copilot-cli', hash: 'x' }, { tool: 'claude-cli', hash: 'a' }] });
  assert.equal(agentSentence(conflict, tools)?.text, 'Codex’s edit was the latest, so it became the current version. Copilot CLI’s is kept as a version.');
  assert.deepEqual(versionChoices(conflict, item()), [{ tool: 'copilot-cli', hash: 'x' }]);
  assert.deepEqual(agentAction(conflict, item(), 'x')?.change, { ...asIs, version: 'x' });
  assert.deepEqual(versionChoices(conflict, item({ hash: 'x' })), [], 'that copy’s version is current now');
  assert.equal(agentAction(conflict, item(), 'a'), undefined, 'only a copy the entry offers');
  const chosen = entry({ kind: 'chosen', winner: { tool: 'codex-cli', hash: 'b' }, losers: [{ tool: 'copilot-cli', hash: 'x' }] });
  assert.equal(agentSentence(chosen, tools)?.text, 'You chose Codex’s copy; Copilot CLI’s is kept as a version.');
  assert.deepEqual([offered(chosen, item()), versionChoices(chosen, item())], [undefined, [{ tool: 'copilot-cli', hash: 'x' }]]);
});

test('A deletion offers Restore while the agent is deleted; every other entry of a deleted agent offers nothing', () => {
  const deleted = entry({ kind: 'deleted', losers: tools.map(tool => ({ tool: tool as 'claude-cli', hash: 'b' })) });
  const gone = item({ deleted: { at } });
  assert.equal(agentSentence(deleted, tools)?.text, 'Deleted from Central Knot and removed from all 3 tools. History keeps it.');
  assert.deepEqual(offered(deleted, gone), ['Restore', { ...asIs, deleted: false }]);
  assert.equal(offered(deleted, item()), undefined, 'it is back already');
  assert.equal(offered(entry({ kind: 'edit', previous: 'a' }), gone), undefined);
  assert.deepEqual(versionChoices(entry({ kind: 'chosen', losers: [{ tool: 'copilot-cli', hash: 'x' }] }), gone), []);
  assert.equal(agentSentence(entry({ kind: 'restored' }), tools)?.text, 'Restored to Central Knot.');
});

test('An entry whose action was used offers nothing, and its row says what became of it', () => {
  assert.equal(offered(entry({ kind: 'off', undoneBy: 'later' }), item({ on: false })), undefined);
  assert.deepEqual(['off', 'on', 'deleted', 'edit'].map(kind => doneWords(entry({ kind: kind as 'off' }))), ['Turned on since', 'Turned off since', 'Restored', 'Undone']);
});

test('Entries from before the library: one naming an earlier version offers Undo; copies an earlier engine added offer nothing; an unknown agent, nothing', () => {
  assert.deepEqual(offered(entry({ kind: 'restored', winner: { tool: 'claude-cli', hash: 'b' }, previous: 'a' }), item())?.[0], 'Undo');
  assert.equal(agentSentence(entry({ kind: 'restored', winner: { tool: 'claude-cli', hash: 'b' }, previous: 'a' }), tools), undefined, 'the general sentence still holds');
  assert.equal(offered(entry({ kind: 'added', previous: 'a' }), item()), undefined);
  assert.equal(offered(entry({ kind: 'off' }), undefined), undefined);
});

test('A Pull that changed only Claude Code’s own settings is not one of these entries: it keeps its own Undo', () => {
  assert.equal(isAgentEntry(entry({ settingsFile: { path: '/x', kept: '/y', wrote: 'z' } })), false);
  assert.deepEqual([isAgentEntry(entry({})), isAgentEntry(entry({ key: 'mcp:docs' }))], [true, false]);
});
