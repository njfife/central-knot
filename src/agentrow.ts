// An agent's row on the Agents page, without the DOM: where it stands, what each harness's mark says, and the clicks its
// controls send. matrix.ts draws these; the tests click them exactly as the page does (tests/agentclicks.ts).
//
// An agent stands in one of three places (library.ts has the model):
//   on     in Central Knot's library and On: applied to every managed harness it is not kept out of
//   off    in the library and Off: in Central Knot only, in no harness
//   found  in a managed harness, not in the library; its switch takes it in
// What a harness holds is told by the library's own rule (library.ts decide), so a mark says what the next pass will do
// there and never something of its own.
import { decide, wantedIn, type LibraryItem } from './library.ts';
import type { Change, HarnessId } from './types.ts';

/** What the page knows of an agent besides its library item: each harness's copy by content, and why a harness can't hold or show it. */
export interface AgentRow {
  key: string; name?: string;
  /** Each harness's copy, by its content. */
  hashes?: Partial<Record<string, string>>;
  cannot?: Partial<Record<string, string>>;
  unseen?: Partial<Record<string, string>>;
}

export type Place = 'on' | 'off' | 'found';
/** The item when the agent is in the library (a deleted one is not: what a harness holds of it is found). */
export const inLibrary = (item: LibraryItem | undefined) => (item && !item.deleted ? item : undefined);
export const placeOf = (item: LibraryItem | undefined): Place => { const held = inLibrary(item); return !held ? 'found' : held.on ? 'on' : 'off'; };

/**
 * What one harness has of an agent, as its mark and its line say it:
 * - `current`: the current version; `gets-it`: it is written there at the next pass; `edited`: its copy was edited there and
 *   becomes the current version at the next pass; `deleted`: its copy was deleted there by hand, which turns the agent Off at
 *   the next pass; `leaving`: its copy is removed at the next pass;
 * - `own-copy`: a copy Central Knot didn't put there (a found agent's, or one that turned up while the agent is Off or kept
 *   out of that harness); `kept-out`: the person keeps the agent out of this harness; `none`: no copy;
 * - `cannot`: it can't be given a copy (the row says why); `unseen`: its copy can't be read for sure, so nothing happens there.
 */
export type HarnessIs = 'current' | 'gets-it' | 'edited' | 'deleted' | 'leaving' | 'own-copy' | 'kept-out' | 'none' | 'cannot' | 'unseen';

export function harnessIs(row: AgentRow, item: LibraryItem | undefined, tool: string): HarnessIs {
  const hash = row.hashes?.[tool], held = inLibrary(item), harness = tool as HarnessId;
  if (row.unseen?.[tool]) return 'unseen';
  if (!held) return hash === undefined ? 'none' : 'own-copy';
  const wanted = wantedIn(held, harness), keptOut = held.on && held.except.includes(harness);
  if (hash === undefined && wanted && row.cannot?.[tool]) return 'cannot';
  switch (decide(wanted, held.hash, hash === undefined ? { is: 'absent' } : { is: 'present', hash, at: 0 }, held.applied[harness])) {
    case 'write': case 'keep-then-write': return 'gets-it';
    case 'take-in': case 'latest-wins': return 'edited';
    case 'turn-off': return 'deleted';
    case 'remove': case 'keep-then-remove': return 'leaving';
    case 'found': return 'own-copy';
    default: return hash !== undefined ? 'current' : keptOut ? 'kept-out' : 'none';
  }
}

const KEPT_FIRST = 'before it is written over, a copy Central Knot doesn’t have yet is kept as a version';

/** A harness's line in the opened row: what it has, in a sentence. `where` is the harness's name. */
export function harnessLine(row: AgentRow, item: LibraryItem | undefined, tool: string, where: string): string {
  const held = inLibrary(item), has = row.hashes?.[tool] !== undefined;
  switch (harnessIs(row, item, tool)) {
    case 'current': return 'Has the current version.';
    case 'gets-it': return has ? `Has another copy. It gets the current version when sync runs; ${KEPT_FIRST}.` : 'Gets it when sync runs next.';
    case 'edited': return `Edited in ${where}. It becomes the current version when sync runs, and reaches the other harnesses.`;
    case 'deleted': return `Its copy was deleted in ${where}. When sync runs, the agent turns off everywhere; Central Knot keeps it.`;
    case 'leaving': return 'Its copy is removed when sync runs. Central Knot keeps it.';
    case 'own-copy':
      if (!held) return 'Has it.';
      return `Has a copy Central Knot didn’t put there. It is left alone while ${held.on ? 'this harness is kept out' : 'the agent is off'}; ${KEPT_FIRST}.`;
    case 'kept-out': return 'Kept out of this harness. Central Knot keeps its file for when you turn it on here.';
    case 'none': return held ? 'No copy while it is off.' : 'No copy. Turning it on adds it here.';
    case 'cannot': return row.cannot![tool]!;
    case 'unseen': return row.unseen![tool]!;
  }
}

/** Whether the switch must ask which copy to take in: a found agent whose copies differ. A library item never asks. */
export const needsChoice = (row: AgentRow, item: LibraryItem | undefined, tools: readonly string[]) =>
  !inLibrary(item) && new Set(tools.map(tool => row.hashes?.[tool]).filter(hash => hash !== undefined)).size > 1;

/** The agent as it is, as a click that changes nothing: each click below changes one thing of it. */
function asItIs(row: AgentRow, item: LibraryItem | undefined): Change {
  const held = inLibrary(item);
  return { key: row.key, managed: !!held?.on, off: held ? [...held.except] : [], seenManaged: !!held?.on };
}

/** The clicks an agent's controls send (agents.ts click takes each). */
export const agentClicks = {
  /** The row's switch, On: a found agent is taken in (`use`: the copy every harness takes, where they differ); one in the library is applied. */
  on: (row: AgentRow, item: LibraryItem | undefined, use?: string): Change =>
    ({ ...asItIs(row, item), managed: true, ...(use ? { use: use as HarnessId, useHash: row.hashes?.[use] } : {}) }),
  /** The row's switch, Off: out of every harness; Central Knot keeps it. */
  off: (row: AgentRow, item: LibraryItem | undefined): Change => ({ ...asItIs(row, item), managed: false }),
  /** A harness's own switch in the opened row: kept out of it (`out`), or let in again. */
  inHarness: (row: AgentRow, item: LibraryItem | undefined, tool: string, out: boolean): Change => {
    const now = asItIs(row, item);
    return { ...now, off: out ? [...now.off, tool as HarnessId] : now.off.filter(other => other !== tool) };
  },
  /** Make current, on an earlier version in the opened row. */
  makeCurrent: (row: AgentRow, item: LibraryItem | undefined, version: string): Change => ({ ...asItIs(row, item), version }),
  /** Delete from Central Knot. */
  remove: (row: AgentRow, item: LibraryItem | undefined): Change => ({ ...asItIs(row, item), deleted: true }),
};
