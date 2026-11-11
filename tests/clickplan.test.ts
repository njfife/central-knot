import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clickResults, inverseChanges, offPlan, recordChanged, stillOn, undoOrder } from '../src/clickplan.ts';
import type { DestinationResult, HistoryEvent } from '../src/types.ts';

const tools = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli'];
const broken = { file: '~/.codex/config.toml', reason: 'isn’t valid TOML.' };

test('Off turns it off with each tool’s own switch, leaves a tool whose switch file is broken on, and says why for each', () => {
  const item = { copies: { 'claude-cli': 'h', 'copilot-cli': 'h', 'codex-cli': 'h', 'pi-cli': 'h' }, managed: true, off: [], disabled: ['copilot-cli'], switchProblem: { 'codex-cli': broken, 'pi-cli': { ...broken, file: '~/.pi/agent/settings.json', reason: 'isn’t valid JSON.' } } };
  assert.deepEqual(offPlan(item, tools), { disable: ['claude-cli'], held: ['codex-cli', 'pi-cli'] });
  const names: Record<string, string> = { 'codex-cli': 'Codex', 'pi-cli': 'Pi' };
  assert.equal(stillOn(item, ['codex-cli', 'pi-cli'], tool => names[tool]!, problem => `${problem.file} ${problem.reason}`),
    'Still on in Codex: ~/.codex/config.toml isn’t valid TOML. Still on in Pi: ~/.pi/agent/settings.json isn’t valid JSON.');
  // A synced skill also turns off where sync is about to give it a copy, so it never arrives on.
  assert.deepEqual(offPlan({ copies: { 'claude-cli': 'h' }, managed: true, off: ['pi-cli'] }, tools).disable, ['claude-cli', 'copilot-cli', 'codex-cli']);
});

test('A click reads only its own results out of the pass: another skill held or failing is not its warning, and copies that differ are no failure', () => {
  const results: DestinationResult[] = [
    { item: 'foo', outcome: 'held', message: 'It contains a link.' },
    { item: 'baz', harness: 'codex-cli', outcome: 'failed', message: 'Could not copy.' },
    { item: 'Bar', outcome: 'held', differs: true, message: 'Copies differ. Choose which copy to use.' },
  ];
  assert.deepEqual(clickResults(results, ['bar']), { ours: [results[2]], did: false, refusal: undefined, failed: false, differs: true });
  const refused = clickResults([...results, { item: 'bar', outcome: 'held', message: 'bar changed since the page was read. Nothing was changed; read again.' }], ['bar']);
  assert.deepEqual([refused.refusal, refused.failed], ['bar changed since the page was read. Nothing was changed; read again.', true]);
  assert.equal(clickResults([{ item: 'bar', harness: 'codex-cli', outcome: 'switched', disabled: true, message: '' }, ...results], ['bar']).did, true);
});

test('A click that only changed the record is undone by the change that puts the record back, made against the record as it is', () => {
  const before = new Map([['pair', { managed: false, off: [] }], ['solo', { managed: true, off: ['codex-cli'] }]]);
  const after = new Map([['pair', { managed: true, off: [] }], ['solo', { managed: true, off: ['codex-cli'] }]]);
  assert.deepEqual(recordChanged(before, after), ['pair']);
  assert.deepEqual(inverseChanges(['pair'], before, after), [{ key: 'pair', managed: false, off: [], seenManaged: true }]);
  // Its History entries already put it back: nothing more to send.
  assert.deepEqual(inverseChanges(['pair'], before, new Map([['pair', { managed: false, off: [] }]])), []);
});

test('Undo goes back switches and removals first, then a copy choice, then added copies, newest first', () => {
  const event = (id: string, kind: HistoryEvent['kind'], at: number) => ({ id, kind, at: new Date(at).toISOString(), key: 'k', item: 'k', losers: [], orderProved: true }) as HistoryEvent;
  assert.deepEqual(undoOrder([event('add', 'added', 3), event('choose', 'chosen', 2), event('off', 'switched', 1), event('out', 'removed', 4)]).map(entry => entry.id), ['out', 'off', 'choose', 'add']);
});
