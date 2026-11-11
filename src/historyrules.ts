// History's rules: what each entry is, where an item is off, and which entries still have an action. Pure: no files, no DOM.
//
// Three questions are answered here and nowhere else:
// - "What is this entry?": entryIs, one name (EntryIs) per kind of entry. Whatever treats kinds differently reads that name:
//   Rule B's table below (`reach`), History's action table (historyactions.ts), the row's sentence (historypage.ts describe)
//   and the agents engine's route to each kind's Undo (agents.ts restoreAgent).
// - Rule A, "where is this item off?": offTools / heldTools. A tool that a standing Off holds gets no copy from sync or from any
//   click but that Off's own, put back. Read by the Agents page's rows (manage.ts heldOffFacts and goneFacts) and by every
//   agents pass and click (agents.ts notSyncing, putBackAgent, restoreVersion). History's prune keeps an Off until it is turned
//   on (keptOff), with every later entry of its item, so these read the same whatever History's days.
// - Rule B, "is this History entry's action still offered?": endedBy. An entry's action stands only while no later Off,
//   deletion, put-back or copy choice changed what it acts on. For agents only: a skill or an MCP server is turned off with each
//   tool's own switch, nothing is removed, and its entries keep their actions for History's days. Read by History's action
//   table (historyactions.ts offered, drawn by historypage.ts), which shows sinceWords in place of the action, and by
//   agents.ts restoreAgent, which refuses an ended action in the same words. One action outlives Rule B: an On's "Use the kept
//   copy" (keptCopiesOffered).
// Entries are in History's order (oldest first); "later" means after in that list. A deletion ends what came before it by time.
// Worked examples on plain entries: tests/historyactions.test.ts.
import type { HarnessId, HistoryEvent } from './types.ts';

/** What an entry is, as History acts on it: one name per kind of entry, decided by entryIs. */
export type EntryIs = 'pulled-base' | 'pulled-deletion' | 'pulled-choice' | 'pulled-edit' | 'pulled-add' | 'edit' | 'conflict' | 'kept-edit' | 'deletion' | 'delete-everywhere'
  | 'choice' | 'agent-choice' | 'unfinished-choice' | 'kept-copy' | 'switch' | 'profile' | 'off' | 'removal' | 'take-over' | 'write' | 'add'
  | 'on-after-off' | 'delete-everywhere-again' | 'deletion-again' | 'redo' | 'restore-after-removal' | 'undo';

/** Names `event`'s kind of entry (EntryIs), from its own fields and, for the Undo or Restore of another entry, from what it undid. */
export function entryIs(event: HistoryEvent, events: HistoryEvent[]): EntryIs {
  if (event.base) return 'pulled-base';
  // Made by Pull from the git repo, and not undone: its action is the Pull's Undo.
  if (event.via === 'repo' && !event.undoneBy) {
    if (event.kind === 'deleted') return 'pulled-deletion';
    if (event.kind === 'chosen') return 'pulled-choice';
    if (event.kind === 'edit') return 'pulled-edit';
    if (event.kind === 'added') return 'pulled-add';
  }
  switch (event.kind) {
    case 'edit': case 'conflict': case 'kept-edit': case 'switched': case 'profile': case 'took-over': case 'written': case 'added':
      return ({ edit: 'edit', conflict: 'conflict', 'kept-edit': 'kept-edit', switched: 'switch', profile: 'profile', 'took-over': 'take-over', written: 'write', added: 'add' } as const)[event.kind];
    case 'deleted': return event.everywhere ? 'delete-everywhere' : 'deletion';
    case 'chosen':
      // Use the kept copy (one tool took back the copy an Off kept for it) is undone in that tool alone.
      if (event.keptFrom) return 'kept-copy';
      // An agent's choice is undone from History as its click's Undo is: each replaced copy back in its own tool.
      return event.restoredTools ? 'unfinished-choice' : event.key.startsWith('agent:') ? 'agent-choice' : 'choice';
    case 'removed': return event.turnedOff ? 'off' : 'removal';
    case 'restored': {
      // A 'restored' entry is the Undo or Restore of another: what it undid says what its own action is.
      const undone = events.find(other => other.undoneBy === event.id);
      if (undone?.kind === 'restored') return 'redo';
      if (event.putBackFrom === 'off') return 'on-after-off';
      // Two deletions can be made again: Delete everywhere's (agents.ts undoPutBack) and one sync spread from a tool (deleteAgainAgent).
      if (event.putBackFrom === 'delete-everywhere') return 'delete-everywhere-again';
      if (undone?.kind === 'deleted') return 'deletion-again';
      return undone?.kind === 'removed' ? 'restore-after-removal' : 'undo';
    }
  }
}

const toolsOf = (copies: HistoryEvent['losers'] = []) => copies.map(copy => copy.tool);
/**
 * The copies an Off holds, one per tool: those it took out (`losers`), and for a tool it holds without having removed anything
 * (`turnedUp`: Turn off again found the tool's own copy there and left it), the copy History still keeps for that tool.
 */
export const heldCopies = (off: HistoryEvent) => [...off.losers, ...(off.turnedUp ?? [])];
/** An entry's tools that its Undo or put-back hasn't reached yet (`restoredTools`: those it has, part-way). */
const stillOpen = (event: HistoryEvent, tools: HarnessId[]) => tools.filter(tool => !event.restoredTools?.includes(tool));

/**
 * Rule B's table, one row per kind of entry.
 * - `changes`: the tools its click changed and that are still as it left them. A later entry's `changes` are what ends an
 *   earlier entry's action.
 * - `actsOn`: what its own action reaches, which says what ends it:
 *     'tools'   its own `changes`: ended by a later change of one of those tools;
 *     'choice'  its own `changes` and the agent's record as the choice left it: ended by a later change of one of those tools,
 *               and by any later choice, so choices are undone newest first;
 *     'item'    the whole item (its Undo puts the synced state back too): ended by any later change;
 *     'nothing' that a later click can end: it keeps its action for History's days (sync's own entries, an edit's Undo or
 *               Redo, a deletion's Restore; they wait, in agents.ts restoreVersion, while an Off holds a tool).
 */
interface Reach { changes: (event: HistoryEvent) => HarnessId[]; actsOn: 'tools' | 'choice' | 'item' | 'nothing' }
const none = () => [];
const keepsItsAction: Reach = { changes: none, actsOn: 'nothing' };
/** A copy choice changes the tools whose copy it replaced. */
const choice: Reach = { changes: event => stillOpen(event, toolsOf(event.losers)), actsOn: 'choice' };
const reach: Record<EntryIs, Reach> = {
  // An Off changes the tools it holds, until each is put back.
  off: { changes: event => stillOpen(event, toolsOf(heldCopies(event))), actsOn: 'tools' },
  // Turning it on changes the tools it put a copy back in and those where it found a copy turned up; its Turn off again is the Off again, synced state and all.
  'on-after-off': { changes: event => [...toolsOf(event.losers), ...toolsOf(event.turnedUp)], actsOn: 'item' },
  'agent-choice': choice, 'unfinished-choice': choice, 'pulled-choice': choice, choice,
  // Use the kept copy changes its one tool.
  'kept-copy': { changes: event => stillOpen(event, [event.winner!.tool]), actsOn: 'tools' },
  // A deletion's Restore puts everything back as it was before that deletion, so it changes nothing; its Delete again is the whole deletion again.
  'delete-everywhere-again': { changes: none, actsOn: 'item' }, 'deletion-again': { changes: none, actsOn: 'item' },
  // Undo add makes the item not synced again.
  add: { changes: none, actsOn: 'item' },
  'pulled-base': keepsItsAction, 'pulled-deletion': keepsItsAction, 'pulled-edit': keepsItsAction, 'pulled-add': keepsItsAction, edit: keepsItsAction, conflict: keepsItsAction,
  'kept-edit': keepsItsAction, deletion: keepsItsAction, 'delete-everywhere': keepsItsAction, switch: keepsItsAction, profile: keepsItsAction, removal: keepsItsAction,
  'take-over': keepsItsAction, write: keepsItsAction, redo: keepsItsAction, 'restore-after-removal': keepsItsAction, undo: keepsItsAction,
};

/** Whether `later` is a deletion of `event`'s item, made at or after it, that still stands (not restored). */
const deletes = (later: HistoryEvent, event: HistoryEvent) => later.id !== event.id && later.key === event.key && later.kind === 'deleted' && !later.undoneBy
  && Date.parse(later.at) >= Date.parse(event.at);
/**
 * Whether the item `event` is about was deleted after it, by a deletion that still stands: what `event` did is then that
 * deletion's to put back. History's prune, its page, an Off row and turning an item on again all ask this one question.
 */
export const deletedSince = (event: HistoryEvent, events: HistoryEvent[]) => events.some(later => deletes(later, event));

/**
 * Pairs that cancel. A click and the click that undid it leave things as they were: an Off and its On, an On and its Turn off
 * again, a choice and its Undo (which writes no entry of its own). So among `clicks`, an entry undone an odd number of times in
 * a row (undone; or undone, that undone, and that undone again) has cancelled out, and one undone an even number of times
 * stands, as itself. An entry that is only the undoing of another one of `clicks` never stands for itself.
 * `later`: every entry the chain of undos may run through. Returns the clicks that stand.
 */
function standing(clicks: HistoryEvent[], later: HistoryEvent[]): HistoryEvent[] {
  const byId = new Map(later.map(entry => [entry.id, entry]));
  const timesUndone = (entry: HistoryEvent) => { let times = 0; for (let at: HistoryEvent | undefined = entry; at?.undoneBy; at = byId.get(at.undoneBy)) times++; return times; };
  const undoings = new Set(clicks.flatMap(entry => (entry.undoneBy && byId.has(entry.undoneBy) ? [entry.undoneBy] : [])));
  return clicks.filter(entry => !undoings.has(entry.id) && timesUndone(entry) % 2 === 0);
}
/**
 * What is left: the changes made to `event`'s item after it that still stand, each with its tools (`reach`'s `changes`), oldest
 * first. Sync's own entries change nothing here. Worked examples, oldest first, seen from On₁:
 *   Off₁ On₁ Off₂          Off₂ stands: On₁ shows "Turned off since".
 *   Off₁ On₁ Off₂ On₂      Off₂ and the On₂ that undid it cancel: nothing is left, and On₁'s Turn off again is offered again.
 *   Off₁ On₁ choice        the choice stands; once its own Undo undid it, nothing is left.
 * Turning on an Off that came after `event` (whole or part-way) is that Off's own undoing, never a change of its own, except in a
 * tool where it found a copy turned up: that tool keeps its own copy from then on, a change that stays.
 */
function laterChanges(event: HistoryEvent, events: HistoryEvent[]): { entry: HistoryEvent; tools: HarnessId[] }[] {
  const later = events.slice(events.findIndex(other => other.id === event.id) + 1).filter(entry => entry.key === event.key);
  const undoesLaterOff = (entry: HistoryEvent) => !!entry.reverses && later.some(other => other.id === entry.reverses);
  const left = standing(later.filter(entry => !undoesLaterOff(entry)), later).map(entry => ({ entry, tools: reach[entryIs(entry, events)].changes(entry) }));
  const keptOwn = later.filter(undoesLaterOff).map(entry => ({ entry, tools: toolsOf(entry.turnedUp) }));
  return [...left, ...keptOwn].filter(change => change.tools.length).sort((first, second) => later.indexOf(first.entry) - later.indexOf(second.entry));
}

/** An Off: a removal for tools with no switch for the item (`turnedOff`), not turned on again (undone). */
const isOff = (event: HistoryEvent) => event.kind === 'removed' && !!event.turnedOff && !event.undoneBy;
/** An Off's tools that no later click changed: a copy that turned up there, turned off again, is held by that later Off. */
const unchangedOff = (event: HistoryEvent, events: HistoryEvent[]) => {
  if (!isOff(event)) return [];
  const changed = new Set(laterChanges(event, events).flatMap(change => change.tools));
  return reach.off.changes(event).filter(tool => !changed.has(tool));
};
/**
 * Rule A, one answer to "where is this item off?": the tools `event`, an Off, still holds. No copy goes into such a tool, from
 * sync or any click, but this Off's own, put back. Its Off row, sync, every click and History's prune read it.
 */
export const offTools = (event: HistoryEvent, events: HistoryEvent[]) => (deletedSince(event, events) ? [] : unchangedOff(event, events));
/**
 * The Offs of item `key` that still keep a copy for `tool` though a later Off holds it now (that one took the tool over),
 * newest first. Once the holder's copy is back, the newest of these holds the tool again, its copy there one that turned up.
 * So turning the tool on puts the holder back and then each of these: it finds the tool's copy, and leaves its own kept copy
 * in History, on offer (itemrow.ts putBackOrder).
 */
export const offsWaitingFor = (events: HistoryEvent[], key: string, tool: HarnessId) =>
  events.filter(event => event.key === key && isOff(event) && !deletedSince(event, events) && reach.off.changes(event).includes(tool) && !unchangedOff(event, events).includes(tool)).reverse();
/** Every tool a standing Off of item `key` holds (offTools). */
export const heldTools = (events: HistoryEvent[], key: string) => [...new Set(events.filter(event => event.key === key).flatMap(event => offTools(event, events)))];

/**
 * Rule B, one answer to "is this History entry's action still offered?": it stands only while it still means what it says. This
 * returns what ended it, if anything did: a deletion since, or a later change that reaches what it acts on (`reach`). An Off
 * stands while it still holds a tool. An agent's entries only: every other item's keep their actions. The History page shows
 * the ending's words (sinceWords) in place of the action, and agents.ts restoreAgent refuses the action in the same words when
 * a page read before asks for it.
 */
export function endedBy(event: HistoryEvent, events: HistoryEvent[]): HistoryEvent | undefined {
  if (!event.key.startsWith('agent:') || event.undoneBy || event.kind === 'deleted') return undefined;
  const deletion = events.findLast(later => deletes(later, event));
  const { changes, actsOn } = reach[entryIs(event, events)];
  if (deletion || actsOn === 'nothing') return deletion;
  if (unchangedOff(event, events).length) return undefined;
  const tools = changes(event);
  const reaches = (change: { entry: HistoryEvent; tools: HarnessId[] }) => actsOn === 'item' || change.tools.some(tool => tools.includes(tool))
    || (actsOn === 'choice' && reach[entryIs(change.entry, events)].actsOn === 'choice');
  return laterChanges(event, events).findLast(reaches)?.entry;
}
/** What History says of an entry `endedBy` ended, by what ended it. */
export const sinceWords = (ending: HistoryEvent) => (ending.kind === 'deleted' ? 'Deleted since' : ending.kind === 'removed' ? 'Turned off since'
  : ending.kind === 'chosen' ? 'Chosen since' : ending.putBackFrom === 'off' ? 'Turned on since' : 'Restored since');

/**
 * The kept copies that `on`, an On, still offers with "Use the kept copy", at most one per tool. Turning the agent on left
 * them out (`turnedUp`): the tool had a copy of its own there, or an older Off had kept a copy for a tool a later Off took
 * over. So each can come back only from this entry, which offers it for as long as History keeps the entry, whatever is
 * clicked later (a copy choice doesn't end it), but not:
 * - while that kept copy is in use there: a use of it (a 'kept-copy' entry naming this On and that copy) that Rule B hasn't
 *   ended or its Undo undone. With several kept for one tool, the next one not in use is offered, so each has its turn;
 * - where the tool held the kept copy already, byte for byte (`same`);
 * - while an Off holds that tool (Rule A): it is offered again once that Off is turned on;
 * - once the On is undone (the Off that undid it holds that tool, kept copies and all) or the agent was deleted since (the
 *   deletion's Restore brings this back).
 */
export function keptCopiesOffered(on: HistoryEvent, events: HistoryEvent[]): HistoryEvent['losers'] {
  if (on.undoneBy || deletedSince(on, events)) return [];
  const held = heldTools(events, on.key);
  const inUse = (copy: HistoryEvent['losers'][number]) => events.some(use => use.keptFrom === on.id && use.winner?.tool === copy.tool && use.winner.kept === copy.kept
    && use.winner.hash === copy.hash && !use.undoneBy && !endedBy(use, events));
  const waiting = (on.turnedUp ?? []).filter(copy => !copy.same && !held.includes(copy.tool) && !inUse(copy));
  return waiting.filter((copy, at) => waiting.findIndex(other => other.tool === copy.tool) === at);
}

/**
 * The copies that Offs other than `by` still keep for `tool` and can no longer put back themselves, because `by`, a later Off,
 * took that tool over from them (Rule A), each with its Off. The put-back of `by` takes them on (agents.ts putBackAgent), so
 * no kept copy is left without a way back.
 */
export const keptByEarlierOffs = (by: HistoryEvent, events: HistoryEvent[], tool: HarnessId) =>
  events.filter(off => off.id !== by.id && off.key === by.key && isOff(off) && !deletedSince(off, events))
    .flatMap(off => heldCopies(off).filter(copy => copy.tool === tool && !off.restoredTools?.includes(tool)).map(copy => ({ off, copy })));

/**
 * Whether History keeps `event` whatever its age (`cutoff`: the oldest moment it keeps otherwise): an Off, and the content it
 * names, while anything can still bring its copies back. That is until it is turned on again (undone), and once a deletion ended
 * it, for as long as History keeps that deletion, whose Restore brings the Off back. A tool a later Off took over still counts:
 * turning that Off on gives this one its hold back. readHistory keeps every later entry of its item with it, so what it holds
 * reads the same whatever the window.
 */
export const keptOff = (event: HistoryEvent, events: HistoryEvent[], cutoff: number) => isOff(event) && !events.some(later => deletes(later, event) && Date.parse(later.at) < cutoff);
