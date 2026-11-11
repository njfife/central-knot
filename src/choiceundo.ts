// Undo of a copy choice, one way for skills, MCP servers and agents: each copy the choice replaced goes back in its own tool,
// the copies its own pass added (its 'added' entry, named on it as `addedId`) go again, and the item is as it was before the
// choice: synced or not, and a tool that held a copy of its own waits for a choice again. Each kind reads and writes its own
// copies through `sides`; the checks, the order and the end state are here.
import { randomUUID } from 'node:crypto';
import type { DestinationResult, HarnessId, HistoryEvent } from './types.ts';
import { toolName } from './words.ts';

/** One kind's copies of the item, as the Undo of a choice reads and writes them. */
export interface ChoiceSides {
  /** The item's name, for the results. */
  name: string;
  /** What one copy is called: "copy", or "entry" for an MCP server. */
  noun: string;
  /** Whether the tool still holds what the choice wrote there. */
  wrote(tool: HarnessId): boolean;
  /** Why the replaced copy can't go back (no longer in Central Knot's store, a folder it can't write), if it can't. */
  cantPutBack(tool: HarnessId, own: string): Promise<string | undefined>;
  /** Whether a copy the choice's pass added is as it was added, or gone. */
  addedAsIs(tool: HarnessId, hash: string): boolean;
  /**
   * Takes out the copies the choice's pass added, and puts the record's part of that right (a tool synced to again is left out
   * again). A copy that couldn't go is a 'failed' result, and the added entry stays open for History's Undo to finish.
   */
  takeOutAdded(added: HistoryEvent): Promise<{ results: DestinationResult[]; writes: number; stopped?: string }>;
  /** Puts the replaced copy back in its tool: a problem, if it couldn't. */
  putBack(tool: HarnessId, own: string): Promise<string | undefined>;
  /** What the tool's user does next to use the copy put back ("Start a new Codex session to use it."). */
  nextStep?(tool: HarnessId): string;
  /**
   * The item's record once the copies are back (`back`: each tool holding its own replaced copy again, with that content).
   * Synced before the choice (`synced`, the content it synced then): it stays synced to that; a tool put back holding it is on
   * record with it, and each tool holding anything else now is not on record, so its next pass holds for a choice, as before
   * the choice. Not synced before (undefined): not synced again, each tool keeping its copy.
   */
  settle(synced: string | undefined, back: Map<HarnessId, string>): Promise<void>;
  /** Saves History once its entries are marked. */
  saveHistory(): Promise<void>;
}

export interface ChoiceUndone { results: DestinationResult[]; writes: number; stopped?: string }

/**
 * Undoes the choice `chosen`. Everything is checked first: each replaced tool still holds what the choice wrote and the added
 * copies are unchanged; otherwise nothing is written. The entries are marked undone only when every copy went back and every
 * added one went: a write that fails is said, the tools put back are kept on the entry (`restoredTools`) and the added entry
 * stays open, and History's Undo of the same entry finishes the rest.
 */
export async function undoChoice(history: HistoryEvent[], chosen: HistoryEvent, sides: ChoiceSides): Promise<ChoiceUndone> {
  const stop = (stopped: string): ChoiceUndone => ({ stopped, results: [], writes: 0 });
  if (chosen.undoneBy) return stop('That choice was already undone.');
  if (!chosen.winner) return stop('That choice can’t be undone.');
  const added = chosen.addedId ? history.find(entry => entry.id === chosen.addedId && !entry.undoneBy) : undefined;
  const done = new Set(chosen.restoredTools ?? []);
  const pending = chosen.losers.filter(loser => !done.has(loser.tool));
  for (const loser of pending) {
    if (!sides.wrote(loser.tool)) return stop(`${toolName(loser.tool)}’s ${sides.noun} of ${sides.name} changed since, so nothing was undone here. History can still put an earlier version back.`);
    const problem = await sides.cantPutBack(loser.tool, loser.hash);
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
    if (out.stopped) return out;
    results.push(...out.results);
    writes += out.writes;
    addedGone = !out.results.some(entry => entry.outcome === 'failed' || entry.outcome === 'held');
    if (addedGone) added.undoneBy ??= randomUUID();
  }
  for (const loser of pending) {
    const problem = await sides.putBack(loser.tool, loser.hash);
    if (problem) { results.push({ item: sides.name, harness: loser.tool, outcome: 'failed', message: `Could not put ${toolName(loser.tool)}’s ${sides.noun} back: ${problem}` }); continue; }
    writes++;
    done.add(loser.tool);
    results.push({ item: sides.name, harness: loser.tool, outcome: 'written', message: [`Its own ${sides.noun} is back.`, sides.nextStep?.(loser.tool)].filter(Boolean).join(' ') });
  }
  // Synced before only with content on record then: one held before its first write had nothing to stay synced to, so it ends
  // not synced, each tool keeping its copy (a copy that pass gave a tool too, as no 'added' entry names it), where it was On
  // and waiting. Left so: the page turns nothing on before its copy is chosen, so only a page read before then, or a record
  // from before one-switch pages, gets there, and not synced writes nothing more.
  await sides.settle(chosen.wasSynced ? chosen.previous : undefined, new Map(chosen.losers.filter(loser => done.has(loser.tool)).map(loser => [loser.tool, loser.hash])));
  if (addedGone && chosen.losers.every(loser => done.has(loser.tool))) { chosen.undoneBy = randomUUID(); delete chosen.restoredTools; }
  else chosen.restoredTools = [...done];
  await sides.saveHistory();
  return { results, writes };
}
