import assert from 'node:assert/strict';
import { test } from 'node:test';
import { undoChoice, type ChoiceSides } from '../src/choiceundo.ts';
import type { HarnessId, HistoryEvent } from '../src/types.ts';

/** Copies by tool, as content ids, and sides that read and write them; `failing`: tools whose put-back, or removal, fails. */
function copies(start: Partial<Record<HarnessId, string>>, failing: HarnessId[] = []) {
  const held = { ...start };
  const settled: { synced?: string; back: [HarnessId, string][] }[] = [];
  const sides: ChoiceSides = {
    name: 'notes', noun: 'copy',
    wrote: tool => held[tool] === 'chosen',
    cantPutBack: async () => undefined,
    addedAsIs: (tool, hash) => held[tool] === undefined || held[tool] === hash,
    takeOutAdded: async added => {
      const results = added.losers.map(loser => {
        if (failing.includes(loser.tool)) return { item: 'notes', harness: loser.tool, outcome: 'failed' as const, message: 'Could not remove it.' };
        delete held[loser.tool];
        return { item: 'notes', harness: loser.tool, outcome: 'removed' as const, message: '' };
      });
      return { results, writes: results.filter(entry => entry.outcome === 'removed').length };
    },
    putBack: async (tool, own) => { if (failing.includes(tool)) return 'the folder is read-only'; held[tool] = own; return undefined; },
    settle: async (synced, back) => { settled.push({ synced, back: [...back] }); },
    saveHistory: async () => undefined,
  };
  return { held, settled, sides };
}
const event = (fields: Partial<HistoryEvent>): HistoryEvent => ({ id: crypto.randomUUID(), at: new Date().toISOString(), key: 'notes', item: 'notes', kind: 'chosen', orderProved: true, losers: [], ...fields });

test('a choice whose Undo can’t put every copy back stays open with what it did put back, and History’s Undo finishes it', async () => {
  const added = event({ kind: 'added', losers: [{ tool: 'pi-cli', hash: 'chosen' }] });
  const chosen = event({ winner: { tool: 'claude-cli', hash: 'chosen' }, losers: [{ tool: 'copilot-cli', hash: 'mine' }, { tool: 'codex-cli', hash: 'theirs' }], addedId: added.id });
  const history = [added, chosen];
  const first = copies({ 'claude-cli': 'chosen', 'copilot-cli': 'chosen', 'codex-cli': 'chosen', 'pi-cli': 'chosen' }, ['codex-cli']);
  const once = await undoChoice(history, chosen, first.sides);
  assert.deepEqual(once.results.map(entry => [entry.harness, entry.outcome]), [['pi-cli', 'removed'], ['copilot-cli', 'written'], ['codex-cli', 'failed']]);
  assert.deepEqual([chosen.undoneBy, chosen.restoredTools, !!added.undoneBy], [undefined, ['copilot-cli'], true], 'not marked undone; what went back is kept on it');
  // Finished later: Copilot CLI's copy is back already, so only Codex's is written.
  const later = copies({ ...first.held, 'codex-cli': 'chosen' });
  const twice = await undoChoice(history, chosen, later.sides);
  assert.deepEqual(twice.results.map(entry => [entry.harness, entry.outcome]), [['codex-cli', 'written']]);
  assert.deepEqual([!!chosen.undoneBy, chosen.restoredTools, later.held['codex-cli']], [true, undefined, 'theirs']);
});

test('an Undo of a choice takes out only the copies its own entry names, and keeps a synced item synced', async () => {
  // An earlier On's copies come just before the choice in History: never the choice's.
  const earlier = event({ kind: 'added', losers: [{ tool: 'codex-cli', hash: 'chosen' }] });
  const chosen = event({ winner: { tool: 'claude-cli', hash: 'chosen' }, losers: [{ tool: 'copilot-cli', hash: 'mine' }], wasSynced: true, previous: 'synced' });
  const { held, settled, sides } = copies({ 'claude-cli': 'chosen', 'copilot-cli': 'chosen', 'codex-cli': 'chosen' });
  assert.equal((await undoChoice([earlier, chosen], chosen, sides)).stopped, undefined);
  assert.deepEqual([held['codex-cli'], held['copilot-cli'], settled], ['chosen', 'mine', [{ synced: 'synced', back: [['copilot-cli', 'mine']] }]]);
});

test('an Undo of a choice leaves an item not synced when the choice says it wasn’t, or had nothing synced yet', async () => {
  for (const fields of [{ previous: 'synced' }, { wasSynced: true as const }]) {
    const chosen = event({ winner: { tool: 'claude-cli', hash: 'chosen' }, losers: [{ tool: 'copilot-cli', hash: 'mine' }], ...fields });
    const { settled, sides } = copies({ 'claude-cli': 'chosen', 'copilot-cli': 'chosen' });
    assert.equal((await undoChoice([chosen], chosen, sides)).stopped, undefined);
    assert.deepEqual(settled.map(entry => entry.synced), [undefined], JSON.stringify(fields));
  }
});

test('an added copy that can’t be removed keeps both entries open, and History’s Undo removes it later', async () => {
  const added = event({ kind: 'added', losers: [{ tool: 'pi-cli', hash: 'chosen' }] });
  const chosen = event({ winner: { tool: 'claude-cli', hash: 'chosen' }, losers: [{ tool: 'copilot-cli', hash: 'mine' }], addedId: added.id });
  const history = [added, chosen];
  const first = copies({ 'claude-cli': 'chosen', 'copilot-cli': 'chosen', 'pi-cli': 'chosen' }, ['pi-cli']);
  const once = await undoChoice(history, chosen, first.sides);
  assert.deepEqual(once.results.map(entry => [entry.harness, entry.outcome]), [['pi-cli', 'failed'], ['copilot-cli', 'written']]);
  assert.deepEqual([chosen.undoneBy, chosen.restoredTools, added.undoneBy], [undefined, ['copilot-cli'], undefined]);
  const later = copies(first.held);
  const twice = await undoChoice(history, chosen, later.sides);
  assert.deepEqual(twice.results.map(entry => [entry.harness, entry.outcome]), [['pi-cli', 'removed']]);
  assert.deepEqual([!!chosen.undoneBy, !!added.undoneBy, later.held['pi-cli']], [true, true, undefined]);
});

test('a copy changed since stops the Undo of a choice before anything is written', async () => {
  const chosen = event({ winner: { tool: 'claude-cli', hash: 'chosen' }, losers: [{ tool: 'copilot-cli', hash: 'mine' }] });
  const { held, sides } = copies({ 'claude-cli': 'chosen', 'copilot-cli': 'edited since' });
  assert.match((await undoChoice([chosen], chosen, sides)).stopped ?? '', /Copilot CLI’s copy of notes changed since, so nothing was undone here/);
  assert.deepEqual([held['copilot-cli'], chosen.undoneBy], ['edited since', undefined]);
});
