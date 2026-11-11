// Undo of a copy choice, one way for skills, MCP servers and agents: each copy the choice replaced goes back in its own tool,
// the copies its own pass added (its 'added' entry, named on it as `addedId`) go again, and the item is synced or not as it was
// before the choice. Each kind reads and writes its own copies through `sides`; the checks, the order and the end state are here.
import { randomUUID } from 'node:crypto';
import type { DestinationResult, HarnessId, HistoryEvent } from './types.ts';
import { toolName } from './words.ts';

/** One kind's copies of the item, as the Undo of a choice reads and writes them. */
export interface ChoiceSides {
  /** The item's name, for the results. */
  name: string;
  /** What one copy is called: "copy", or "entry" for an MCP server. */
  noun: string;
  /** What the tool holds now: what the choice wrote there, its own replaced copy (put back by an Undo that stopped part-way), or something else. */
  holds(tool: HarnessId, own: string): 'chosen' | 'own' | 'other';
  /** Why the replaced copy can't go back (no longer in Central Knot's store, a folder it can't write), if it can't. */
  cantPutBack(tool: HarnessId, own: string): Promise<string | undefined>;
  /** Whether a copy the choice's pass added is as it was added, or gone. */
  addedAsIs(tool: HarnessId, hash: string): boolean;
  /** Takes out the copies the choice's pass added, and puts the record's part of that right (a tool synced to again is left out again). */
  takeOutAdded(added: HistoryEvent): Promise<{ results: DestinationResult[]; writes: number; stopped?: string }>;
  /** Puts the replaced copy back in its tool: a problem, if it couldn't. */
  putBack(tool: HarnessId, own: string): Promise<string | undefined>;
  /**
   * The item's record once the copies are back (`back`: the tools holding their own copy again). Synced before the choice
   * (`synced`, the content it synced then): it stays synced to that, and each tool holding anything else (leftOutAfterChoice)
   * keeps its own copy, left out of sync, so no later pass catches it up over that copy or spreads it as an edit; Sync here
   * there asks for the choice again. Not synced before (undefined): not synced again, each tool keeping its copy. Returns the
   * tools left out.
   */
  settle(synced: string | undefined, back: HarnessId[]): Promise<HarnessId[]>;
  /** Saves History once its entries are marked. */
  saveHistory(): Promise<void>;
}

/**
 * The tools an Undo of a choice on a synced item leaves out of sync: each of `tools` whose copy now (`holds`: undefined for one
 * not counted, a tool reading another's copy or left out already) is not the synced content, a copy put back (`back`) holding
 * the content the choice replaced there.
 */
export const leftOutAfterChoice = (tools: HarnessId[], synced: string, chosen: HistoryEvent, back: HarnessId[], holds: (tool: HarnessId) => string | undefined) =>
  tools.filter(tool => { const now = back.includes(tool) ? chosen.losers.find(loser => loser.tool === tool)?.hash : holds(tool); return now !== undefined && now !== synced; });

export interface ChoiceUndone { results: DestinationResult[]; writes: number; stopped?: string }

/**
 * Undoes the choice `chosen`. Everything is checked first: each replaced tool still holds what the choice wrote (or its own
 * copy, put back already) and the added copies are unchanged; otherwise nothing is written. The entries are marked undone
 * only when every copy went back and every added one went: a write that fails is said, the tools put back are kept on the
 * entry (`restoredTools`), and History's Undo of the same entry finishes the rest.
 */
export async function undoChoice(history: HistoryEvent[], chosen: HistoryEvent, sides: ChoiceSides): Promise<ChoiceUndone> {
  const stop = (stopped: string): ChoiceUndone => ({ stopped, results: [], writes: 0 });
  if (chosen.undoneBy) return stop('That choice was already undone.');
  if (!chosen.winner) return stop('That choice can’t be undone.');
  const added = chosen.addedId ? history.find(entry => entry.id === chosen.addedId && !entry.undoneBy) : undefined;
  const done = new Set(chosen.restoredTools ?? []);
  const pending = chosen.losers.filter(loser => !done.has(loser.tool));
  const holds = new Map(pending.map(loser => [loser.tool, sides.holds(loser.tool, loser.hash)]));
  for (const loser of pending) {
    const now = holds.get(loser.tool);
    if (now === 'other') return stop(`${toolName(loser.tool)}’s ${sides.noun} of ${sides.name} changed since, so nothing was undone here. History can still put an earlier version back.`);
    const problem = now === 'chosen' ? await sides.cantPutBack(loser.tool, loser.hash) : undefined;
    if (problem) return stop(problem);
  }
  for (const loser of added?.losers ?? []) {
    if (!sides.addedAsIs(loser.tool, loser.hash)) return stop(`${toolName(loser.tool)}’s new ${sides.noun} of ${sides.name} was edited since, so nothing was undone here.`);
  }
  const results: DestinationResult[] = [];
  let writes = 0;
  let addedGone = !added;
  if (added) {
    const out = await sides.takeOutAdded(added);
    if (out.stopped) return { ...out, results: [...results, ...out.results] };
    results.push(...out.results);
    writes += out.writes;
    addedGone = !out.results.some(entry => entry.outcome === 'failed' || entry.outcome === 'held');
    if (addedGone && !added.undoneBy) added.undoneBy = randomUUID();
  }
  for (const loser of pending) {
    if (holds.get(loser.tool) === 'own') { done.add(loser.tool); continue; }
    const problem = await sides.putBack(loser.tool, loser.hash);
    if (problem) { results.push({ item: sides.name, harness: loser.tool, outcome: 'failed', message: `Could not put ${toolName(loser.tool)}’s ${sides.noun} back: ${problem}` }); continue; }
    writes++;
    done.add(loser.tool);
    results.push({ item: sides.name, harness: loser.tool, outcome: 'written', message: `Its own ${sides.noun} is back.` });
  }
  const leftOut = await sides.settle(chosen.wasSynced ? chosen.previous ?? chosen.winner.hash : undefined, [...done]);
  for (const entry of results) if (entry.outcome === 'written' && entry.harness && leftOut.includes(entry.harness)) Object.assign(entry, { leftOut: true, message: `Its own ${sides.noun} is back, left out of sync.` });
  if (addedGone && chosen.losers.every(loser => done.has(loser.tool))) { chosen.undoneBy = randomUUID(); delete chosen.restoredTools; }
  else chosen.restoredTools = [...done];
  await sides.saveHistory();
  return { results, writes };
}
