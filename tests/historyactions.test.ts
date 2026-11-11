// History's action table (historyactions.ts) and Rule B (historyrules.ts endedBy), on History entries as the agents engine writes
// them: what each row offers, what it shows once something ended it, and what is said after its click.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterWords, offered } from '../src/historyactions.ts';
import { entryIs, heldTools, offTools } from '../src/historyrules.ts';
import type { DestinationResult, HarnessId, HistoryEvent } from '../src/types.ts';

const tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
let made = 0;
const entry = (kind: HistoryEvent['kind'], losers: HarnessId[], more: Partial<HistoryEvent> = {}): HistoryEvent =>
  ({ id: `e${++made}`, at: new Date(Date.UTC(2026, 10, 1, 0, made)).toISOString(), key: 'agent:reviewer', item: 'reviewer', kind, losers: losers.map(tool => ({ tool, hash: `h-${tool}` })), orderProved: true, ...more });
const off = (losers: HarnessId[] = tools, more: Partial<HistoryEvent> = {}) => entry('removed', losers, { turnedOff: true, ...more });
const on = (losers: HarnessId[] = tools, more: Partial<HistoryEvent> = {}) => entry('restored', losers, { putBackFrom: 'off', ...more });
/** `undone` undone by `by`, as the engine marks it. */
const undid = (undone: HistoryEvent, by: HistoryEvent) => { undone.undoneBy = by.id; return by; };
const shown = (event: HistoryEvent, events: HistoryEvent[]) => { const { action, state } = offered(event, events, tools); return action ? action.label : state; };
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
  assert.equal(shown(back, [first, back, entry('chosen', ['copilot-cli'])]), 'Chosen since');
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
