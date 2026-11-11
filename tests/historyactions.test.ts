// History's rules (historyrules.ts: Rule A, where an agent is off; Rule B, endedBy; the kept copy's rule) and its action table
// (historyactions.ts), on History entries as the agents engine writes them: what each row offers, what it shows once something
// ended it, and what is said after its click. Entries are made oldest first: each `entry` is later than the ones before it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterWords, offered } from '../src/historyactions.ts';
import { entryIs, heldTools, keptByEarlierOffs, keptCopiesOffered, offTools, standsIn } from '../src/historyrules.ts';
import { putBackOrder } from '../src/itemrow.ts';
import type { DestinationResult, HarnessId, HistoryEvent } from '../src/types.ts';

const tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
let made = 0;
const entry = (kind: HistoryEvent['kind'], losers: HarnessId[], more: Partial<HistoryEvent> = {}): HistoryEvent =>
  ({ id: `e${++made}`, at: new Date(Date.UTC(2026, 10, 1, 0, made)).toISOString(), key: 'agent:reviewer', item: 'reviewer', kind, losers: losers.map(tool => ({ tool, hash: `h-${tool}` })), orderProved: true, ...more });
const off = (losers: HarnessId[] = tools, more: Partial<HistoryEvent> = {}) => entry('removed', losers, { turnedOff: true, ...more });
const on = (losers: HarnessId[] = tools, more: Partial<HistoryEvent> = {}) => entry('restored', losers, { putBackFrom: 'off', ...more });
/** `undone` undone by `by`, as the engine marks it. */
const undid = (undone: HistoryEvent, by: HistoryEvent) => { undone.undoneBy = by.id; return by; };
const choice = (losers: HarnessId[], more: Partial<HistoryEvent> = {}) => entry('chosen', losers, { winner: { tool: 'claude-cli', hash: 'h-chosen' }, ...more });
const shown = (event: HistoryEvent, events: HistoryEvent[]) => { const { action, state } = offered(event, events, tools); return action ? action.label : state; };
const also = (event: HistoryEvent, events: HistoryEvent[]) => offered(event, events, tools).also.map(action => action.label);
const kept = (tool: HarnessId) => ({ tool, hash: `h-${tool}` });
const keptOfferedIn = (on: HistoryEvent, events: HistoryEvent[]) => keptCopiesOffered(on, events).map(copy => copy.tool);
const results = (outcome: DestinationResult['outcome'], ...harnesses: HarnessId[]) => harnesses.map(harness => ({ item: 'reviewer', harness, outcome, message: '' }));

test('An Off offers Turn on where it still holds a tool; once turned on it says so, and a deletion since ends it', () => {
  const first = off();
  assert.deepEqual([entryIs(first, [first]), shown(first, [first]), heldTools([first], 'agent:reviewer')], ['off', 'Turn on in all 3 tools', tools]);
  const back = undid(first, on());
  assert.deepEqual([shown(first, [first, back]), shown(back, [first, back])], ['Turned on since', 'Turn off again in all 3 tools']);
  const again = off([], {});
  const deleted = entry('deleted', [], { everywhere: true });
  assert.deepEqual([shown(again, [again, deleted]), offTools(again, [again, deleted])], ['Deleted since', []]);
});

test('Rule B: an On’s Turn off again ends with a later Off or choice of its tools, and an Off and the On that undid it cancel out', () => {
  const first = off(), back = undid(first, on());
  const later = off(['codex-cli']);
  assert.equal(shown(back, [first, back, later]), 'Turned off since');
  // Turned on again: the later Off and its On cancel, so the first On's Turn off again stands again.
  const laterBack = undid(later, on(['codex-cli']));
  assert.equal(shown(back, [first, back, later, laterBack]), 'Turn off again in all 3 tools');
  // A copy choice that replaced one of its copies ends it too.
  assert.equal(shown(back, [first, back, entry('chosen', ['copilot-cli'])]), 'Copy chosen since');
  // A choice undone by its own Undo (no entry of its own) is as if never made.
  const choice = entry('chosen', ['copilot-cli'], { undoneBy: 'gone' });
  assert.equal(shown(back, [first, back, choice]), 'Turn off again in all 3 tools');
});

test('Rule A: a copy that turned up in a tool an Off holds, turned off again, is held by the later Off; the earlier one keeps the rest', () => {
  const first = off();
  const second = off(['codex-cli']);
  assert.deepEqual([offTools(first, [first, second]), offTools(second, [first, second]), shown(first, [first, second])], [['claude-cli', 'copilot-cli'], ['codex-cli'], 'Turn on in Claude Code and Copilot CLI']);
});

test('Delete everywhere offers Restore, its Restore offers Delete again until a later click, and an edit keeps its Undo through an Off', () => {
  const deletion = entry('deleted', tools, { everywhere: true });
  const restored = undid(deletion, entry('restored', tools, { putBackFrom: 'delete-everywhere' }));
  assert.deepEqual([entryIs(restored, [deletion, restored]), shown(restored, [deletion, restored])], ['delete-everywhere-again', 'Delete again in all 3 tools']);
  assert.equal(shown(restored, [deletion, restored, off(['codex-cli'])]), 'Turned off since');
  const edit = entry('edit', ['copilot-cli']);
  assert.equal(shown(edit, [edit, off()]), 'Undo edit in all tools');
});

test('What is said after an Off’s, an On’s or a deletion’s action, from what the engine did', () => {
  const homeTools = tools;
  const back = on(['claude-cli', 'copilot-cli']);
  assert.equal(afterWords(back, [back], { results: results('removed', 'claude-cli', 'copilot-cli'), homeTools }), 'reviewer is off in Claude Code and Copilot CLI again. History keeps the copies.');
  const first = off();
  assert.equal(afterWords(first, [first], { results: results('written', 'codex-cli'), homeTools }), 'reviewer is back in Codex.');
  const deletion = entry('deleted', [], { everywhere: true });
  assert.equal(afterWords(deletion, [deletion], { results: [], homeTools }), 'reviewer is back on its page, off.');
  const again = entry('restored', tools, { putBackFrom: 'delete-everywhere' });
  assert.equal(afterWords(again, [again], { results: results('removed', ...tools), homeTools }), 'Deleted reviewer again from Claude Code, Copilot CLI and Codex. History keeps it.');
});

test('Rule A: an Off partly turned on holds only the tools not put back yet', () => {
  const first = off(tools, { restoredTools: ['codex-cli'] });
  assert.deepEqual([offTools(first, [first]), shown(first, [first])], [['claude-cli', 'copilot-cli'], 'Turn on in Claude Code and Copilot CLI']);
});

test('Rule B: a choice’s Undo ends with a later Off of one of its tools, not of another; Undo add ends with any later Off, and both stand again once that Off is turned on', () => {
  const added = entry('added', ['copilot-cli', 'codex-cli']);
  const chose = choice(['codex-cli']);
  const elsewhere = off(['claude-cli']);
  // Undo add shows the latest thing that ended it.
  assert.deepEqual([shown(chose, [added, chose, elsewhere]), shown(added, [added, chose]), shown(added, [added, chose, elsewhere])], ['Undo choice in Codex', 'Copy chosen since', 'Turned off since']);
  const there = off(['codex-cli']);
  assert.deepEqual([shown(chose, [chose, there]), shown(added, [added, there])], ['Turned off since', 'Turned off since']);
  const back = undid(there, on(['codex-cli'], { reverses: there.id }));
  assert.deepEqual([shown(chose, [chose, there, back]), shown(added, [added, there, back])], ['Undo choice in Codex', 'Undo add']);
});

test('Rule B: a choice’s Undo stands tool by tool: a later change ends it only in the tools it reached, and it is ended once every one was', () => {
  const older = choice(['copilot-cli', 'codex-cli']);
  // A later choice that replaced another tool's copy reaches neither.
  const elsewhere = choice(['claude-cli']);
  assert.deepEqual([shown(older, [older, elsewhere]), shown(elsewhere, [older, elsewhere])], ['Undo choice in Copilot CLI and Codex', 'Undo choice in Claude Code']);
  // One that replaced Codex's copy again ends it there and no further, until its own Undo (which writes no entry) undid it.
  const there = choice(['codex-cli']);
  assert.deepEqual([shown(older, [older, there]), standsIn(older, [older, there])], ['Undo choice in Copilot CLI', ['copilot-cli']]);
  assert.match(offered(older, [older, there], tools).action!.help, /back in its own tool \(Copilot CLI\), .* \(only while unchanged since\)\. Codex, changed since, stays as it is$/);
  assert.equal(shown(older, [older, { ...there, undoneBy: 'its own Undo' }]), 'Undo choice in Copilot CLI and Codex');
  // Every tool reached: ended, in the words of the last change that reached one.
  assert.equal(shown(older, [older, there, off(['copilot-cli'])]), 'Turned off since');
});

test('Rule B: an On counts as a change where it found a copy turned up, so an earlier choice of that tool loses its Undo', () => {
  const first = off();
  const chose = choice(['codex-cli']);
  const back = undid(first, on(['claude-cli', 'copilot-cli'], { reverses: first.id, keptAside: [kept('codex-cli')] }));
  assert.equal(shown(chose, [first, chose, back]), 'Turned on since');
  const elsewhere = choice(['copilot-cli']);
  const plain = undid(first, on(['claude-cli'], { reverses: first.id }));
  assert.equal(shown(elsewhere, [first, elsewhere, plain]), 'Undo choice in Copilot CLI');
  // The same under an Off made after the choice: that Off and its On cancel out, but Codex keeps its own copy from then on.
  const later = off(['codex-cli']);
  const found = undid(later, on([], { reverses: later.id, keptAside: [kept('codex-cli')] }));
  assert.equal(shown(chose, [chose, later, found]), 'Turned on since');
});

test('Rule B: a click undone and undone again stands: as the Off that Turn off again wrote, which holds only what it took out then; turned on once more, it cancels out', () => {
  const chose = choice(['copilot-cli']);
  const later = off(['copilot-cli', 'codex-cli']);
  const back = undid(later, on(['copilot-cli', 'codex-cli'], { reverses: later.id }));
  assert.equal(shown(chose, [chose, later, back]), 'Undo choice in Copilot CLI');
  // Turn off again took both out again: the Off stands, as the entry Turn off again wrote.
  const again = undid(back, off(['copilot-cli', 'codex-cli']));
  assert.deepEqual([shown(chose, [chose, later, back, again]), heldTools([chose, later, back, again], 'agent:reviewer')], ['Turned off since', ['copilot-cli', 'codex-cli']]);
  // Had it taken out Codex's copy alone (Copilot CLI's was changed since, and stayed), Copilot CLI is as the choice left it.
  const partly = { ...again, losers: again.losers.slice(1) };
  assert.deepEqual([shown(chose, [chose, later, back, partly]), heldTools([chose, later, back, partly], 'agent:reviewer')], ['Undo choice in Copilot CLI', ['codex-cli']]);
  // Turned on once more: undone three times, it has cancelled out again.
  const once = undid(again, on(['copilot-cli', 'codex-cli'], { reverses: again.id }));
  assert.equal(shown(chose, [chose, later, back, again, once]), 'Undo choice in Copilot CLI');
});

test('Rule B: an On undone and done again stands as itself: History’s Turn on of the Off that Turn off again wrote is no change of its own', () => {
  const older = off(['claude-cli']), other = off(['codex-cli']);
  const first = undid(older, on(['claude-cli'], { reverses: older.id }));
  // Codex turned on after it: a later change, so the first On's Turn off again is not offered.
  const second = undid(other, on(['codex-cli'], { reverses: other.id }));
  assert.equal(shown(first, [older, other, first, second]), 'Turned on since');
  // That undone: they cancel out. And turned on once more: Codex is on since the first On, as the second On left it.
  const again = undid(second, off(['codex-cli']));
  assert.equal(shown(first, [older, other, first, second, again]), 'Turn off again in Claude Code');
  const once = undid(again, on(['codex-cli'], { reverses: again.id }));
  assert.equal(shown(first, [older, other, first, second, again, once]), 'Turned on since');
});

test('Rule B is for agents only: a skill’s and an MCP server’s entries keep their actions whatever came later', () => {
  for (const key of ['reviewer', 'mcp:files']) {
    const older = choice(['codex-cli'], { key }), newer = choice(['codex-cli'], { key });
    assert.deepEqual([shown(older, [older, newer]), shown(newer, [older, newer])], ['Undo choice in all tools', 'Undo choice in all tools']);
  }
});

test('Rule B: a deletion keeps its Restore whatever came later, a later deletion too', () => {
  const first = entry('deleted', tools, { everywhere: true });
  const second = entry('deleted', [], { everywhere: true });
  assert.deepEqual([shown(first, [first, second]), shown(second, [first, second])], ['Restore in all 3 tools', 'Restore']);
});

test('An On that found a tool’s own copy offers Use the kept copy there for as long as it is in History: a later choice doesn’t end it; a use of it, an Off of that tool, its own Undo or a deletion do', () => {
  const first = off();
  const back = undid(first, on(['claude-cli', 'copilot-cli'], { reverses: first.id, keptAside: [kept('codex-cli')] }));
  const events = [first, back];
  assert.deepEqual([shown(back, events), also(back, events)], ['Turn off again in Claude Code and Copilot CLI', ['Use the kept copy in Codex']]);
  // A copy choice ends its Turn off again, never the kept copy.
  const chose = choice(['codex-cli']);
  assert.deepEqual([shown(back, [...events, chose]), also(back, [...events, chose])], ['Copy chosen since', ['Use the kept copy in Codex']]);
  // In use: not offered. Its Undo (which writes no entry), or a later choice that replaced it there, and it is offered again.
  const used = choice(['codex-cli'], { keptFrom: back.id, winner: { tool: 'codex-cli', hash: 'h-codex-cli' } });
  assert.deepEqual([entryIs(used, [...events, used]), shown(used, [...events, used]), keptOfferedIn(back, [...events, used])], ['kept-copy', 'Undo in Codex', []]);
  assert.deepEqual(keptOfferedIn(back, [...events, used, choice(['codex-cli'])]), ['codex-cli']);
  assert.deepEqual(keptOfferedIn(back, [...events, { ...used, undoneBy: 'its own Undo' }]), ['codex-cli']);
  // An Off of that tool holds it: offered again once that is turned on. Undone, the Off that undid it has the kept copy.
  const later = off(['codex-cli']);
  assert.deepEqual(keptOfferedIn(back, [...events, later]), []);
  assert.deepEqual(keptOfferedIn(back, [...events, later, undid(later, on(['codex-cli'], { reverses: later.id }))]), ['codex-cli']);
  assert.deepEqual(keptOfferedIn({ ...back, undoneBy: 'an Off again' }, events), []);
  assert.deepEqual(keptOfferedIn(back, [...events, entry('deleted', tools, { everywhere: true })]), []);
  // Found byte for byte the same as the kept one: nothing to offer.
  assert.deepEqual(keptOfferedIn({ ...back, keptAside: [{ ...kept('codex-cli'), same: true }] }, events), []);
});

test('An On that keeps two copies aside for one tool offers one at a time, the next once the first is in use; a use that replaced nothing has no Undo', () => {
  const first = off();
  const newer = { tool: 'codex-cli' as const, hash: 'h-newer', kept: 'newer' }, older = { tool: 'codex-cli' as const, hash: 'h-older', kept: 'older' };
  const back = undid(first, on(['claude-cli', 'copilot-cli'], { reverses: first.id, keptAside: [newer, older] }));
  assert.deepEqual([also(back, [first, back]), keptCopiesOffered(back, [first, back])], [['Use the kept copy in Codex'], [newer]]);
  // Where the On put Codex's newer kept copy back and kept the older aside, Codex has no copy of its own to leave alone.
  const both = on(['codex-cli'], { keptAside: [older] });
  assert.equal(offered(both, [both], tools).action?.help, 'Turn off reviewer again: each copy it put back removed from Codex, and History keeps it');
  // Codex had no copy when the newer one was used: nothing was replaced, so that row has no Undo. The older one is offered now.
  const used = choice([], { keptFrom: back.id, winner: newer });
  assert.deepEqual([shown(used, [first, back, used]), keptCopiesOffered(back, [first, back, used])], [undefined, [older]]);
});

test('An earlier Off’s kept copy is taken on by a later Off’s On once: not again after that Off is done with the tool', () => {
  const earlier = off(['claude-cli', 'codex-cli']), by = off(['codex-cli']);
  assert.deepEqual(keptByEarlierOffs(by, [earlier, by], 'codex-cli').map(({ off: from, copy }) => [from.id, copy.tool]), [[earlier.id, 'codex-cli']]);
  // Handed on (agents.ts handedOn): the earlier Off notes it is done with Codex, and still holds Claude Code.
  earlier.restoredTools = ['codex-cli'];
  assert.deepEqual([keptByEarlierOffs(by, [earlier, by], 'codex-cli'), offTools(earlier, [earlier, by])], [[], ['claude-cli']]);
});

test('An On that only found a tool’s own copy removed nothing, so it has no Turn off again: its Undo leaves that copy alone again, and the Off it writes says so', () => {
  const first = off(['codex-cli']);
  const back = undid(first, on([], { reverses: first.id, keptAside: [kept('codex-cli')] }));
  const { action } = offered(back, [first, back], tools);
  assert.deepEqual([action?.label, action?.help], ['Undo turn on in Codex', 'Codex’s own copy is left alone again, as before reviewer was turned on there: nothing is removed, and Central Knot doesn’t sync it']);
  assert.equal(afterWords(back, [first, back], { results: results('stayed', 'codex-cli'), homeTools: tools }), 'Codex’s own copy is left alone again.');
  // The Off that Undo writes holds Codex without having removed anything: Rule A reads it, and its Turn on names it.
  const again = undid(back, off([], { keptAside: [kept('codex-cli')] }));
  assert.deepEqual([offTools(again, [first, back, again]), shown(again, [first, back, again])], [['codex-cli'], 'Turn on in Codex']);
  // Undone, the row says so: nothing was turned off. An On that put copies back, undone, reads "Turned off since".
  assert.deepEqual([shown(back, [first, back, again]), shown({ ...on(['claude-cli']), undoneBy: again.id }, [again])], ['Undone', 'Turned off since']);
  // One that also put copies back says both.
  const mixed = on(['claude-cli'], { keptAside: [kept('codex-cli')] });
  assert.equal(offered(mixed, [mixed], tools).action?.help, 'Turn off reviewer again: each copy it put back removed from Claude Code, and History keeps it; Codex’s own copy is left alone again');
  assert.equal(afterWords(mixed, [mixed], { results: [...results('removed', 'claude-cli'), ...results('stayed', 'codex-cli')], homeTools: tools }), 'reviewer is off in Claude Code again. History keeps its copy. Codex’s own copy is left alone again.');
});

test('What is said after Use the kept copy, and after its Undo', () => {
  const back = on(['claude-cli'], { keptAside: [kept('codex-cli')] });
  const wrote = [{ item: 'reviewer', harness: 'codex-cli' as const, outcome: 'written' as const, replaced: true as const, message: '' }];
  assert.equal(afterWords(back, [back], { results: wrote, homeTools: tools, how: { keptIn: 'codex-cli' } }), 'Codex has the kept copy of reviewer again. The one it replaced is in History, with its own Undo.');
  const used = choice(['codex-cli'], { keptFrom: back.id, winner: { tool: 'codex-cli', hash: 'h-codex-cli' } });
  assert.equal(afterWords(used, [back, used], { results: results('written', 'codex-cli'), homeTools: tools }), 'Codex has the copy it had before again.');
});

test('The row’s On puts back the Off that holds a one-way copy’s source before the Offs of the copies waiting for it', () => {
  const row = { key: 'reviewer', description: '', copies: {}, managed: false, off: [], heldOff: [{ tool: 'copilot-cli', history: 'receiver’s Off', source: 'claude-cli' }, { tool: 'claude-cli', history: 'source’s Off' }] };
  assert.deepEqual(putBackOrder(row), ['source’s Off', 'receiver’s Off']);
});

test('A deletion’s Restore that found a tool’s own copy offers Use the kept copy too', () => {
  const deletion = entry('deleted', tools, { everywhere: true });
  const restored = undid(deletion, entry('restored', ['claude-cli', 'copilot-cli'], { putBackFrom: 'delete-everywhere', reverses: deletion.id, keptAside: [kept('codex-cli')] }));
  assert.deepEqual([shown(restored, [deletion, restored]), also(restored, [deletion, restored])], ['Delete again in Claude Code and Copilot CLI', ['Use the kept copy in Codex']]);
});
