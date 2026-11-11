// History's rules about an item turned off and about which entries still have an action. Pure: no files, no DOM.
//
// Two questions are answered here and nowhere else:
// - Rule A, "where is this item off?": offTools / heldTools. A tool that a standing Off holds gets no copy from sync or from any
//   click but that Off's own, put back. Read by the Agents page's rows (manage.ts heldOffFacts and goneFacts) and by every
//   agents pass and click (agents.ts notSyncing, putBackAgent, restoreVersion). History's prune keeps an Off until it is turned
//   on (keptOff), with every later entry of its item, so these read the same whatever History's days.
// - Rule B, "is this History entry's action still offered?": endedBy. An entry's action stands only while no later Off,
//   deletion, put-back or copy choice changed what it acts on. Read by History's action table (historyactions.ts offered,
//   drawn by historypage.ts), which shows sinceWords in place of the action, and by agents.ts restoreAgent, which refuses an
//   ended action in the same words.
// Entries are in History's order (oldest first); "later" means after in that list. A deletion ends what came before it by time.
import type { HarnessId, HistoryEvent } from './types.ts';

/** Whether `later` is a deletion of `event`'s item, made at or after it, that still stands (not restored). */
const deletes = (later: HistoryEvent, event: HistoryEvent) => later.id !== event.id && later.key === event.key && later.kind === 'deleted' && !later.undoneBy
  && Date.parse(later.at) >= Date.parse(event.at);
/**
 * Whether the item `event` is about was deleted after it, by a deletion that still stands: what `event` did is then that
 * deletion's to put back. History's prune, its page, an Off row and turning an item on again all ask this one question.
 */
export const deletedSince = (event: HistoryEvent, events: HistoryEvent[]) => events.some(later => deletes(later, event));
/** An Off: a removal for tools with no switch for the item (`turnedOff`), not turned on again (undone). */
const isOff = (event: HistoryEvent) => event.kind === 'removed' && !!event.turnedOff && !event.undoneBy;
const toolsOf = (losers: HistoryEvent['losers'] = []) => losers.map(loser => loser.tool);
/**
 * The tools a click's entry changed: an Off took their copies out (those it still holds: what was put back since is undone),
 * turning it on put them back (or found one turned up), a choice replaced them. A deletion's Restore changes none: it puts
 * everything back as it was before that deletion.
 */
const changedBy = (event: HistoryEvent): HarnessId[] => (event.kind === 'removed' && event.turnedOff ? toolsOf(event.losers).filter(tool => !event.restoredTools?.includes(tool))
  : event.kind === 'restored' && event.putBackFrom === 'off' ? [...toolsOf(event.losers), ...toolsOf(event.turnedUp)] : event.kind === 'chosen' ? toolsOf(event.losers) : []);
/**
 * What a click's entry acts on: its tools, or '*' for the whole item (a deletion made again). None for what keeps its action for
 * History's days: sync's own entries, deletions, and an edit's Undo or Redo (they write a version, and wait while an Off holds a tool).
 */
const actsOn = (event: HistoryEvent, events: HistoryEvent[]): HarnessId[] | '*' | undefined => {
  const open = (tools: HarnessId[]) => tools.filter(tool => !event.restoredTools?.includes(tool));
  if (event.kind === 'removed') return event.turnedOff ? open(toolsOf(event.losers)) : undefined;
  // Turn off again or Delete again puts the agent's synced state back too: any later click ends it, whatever its tools.
  if (event.kind === 'restored') return event.putBackFrom || events.some(other => other.undoneBy === event.id && other.kind === 'deleted') ? '*' : undefined;
  // Undo add makes it not synced again: it acts on the whole item.
  return event.kind === 'chosen' ? open(toolsOf(event.losers)) : event.kind === 'added' && event.via !== 'repo' ? '*' : undefined;
};
/**
 * What the later entries of `event`'s item still change since it, each with its tools: an Off, a put-back or a copy choice
 * (changedBy). An entry undone since and the one that undid it cancel out when both came after `event` (an Off and its On, an
 * On and its Turn off again, a choice and its Undo, which leaves no entry): a chain of undos counts once, as its first entry,
 * when it has an odd number of steps, and not at all when even. Turning on an Off that came after `event`, whole or part-way,
 * is that Off's own undoing, except in a tool where it found a copy turned up: that tool keeps its own copy, a change that stays.
 */
function laterChanges(event: HistoryEvent, events: HistoryEvent[]): { entry: HistoryEvent; tools: HarnessId[] }[] {
  const all = events.slice(events.findIndex(other => other.id === event.id) + 1).filter(later => later.key === event.key);
  const reversesLater = (later: HistoryEvent) => !!later.reverses && all.some(other => other.id === later.reverses);
  const after = all.filter(later => !reversesLater(later));
  const byId = new Map(all.map(later => [later.id, later]));
  const undoers = new Set(after.flatMap(later => (later.undoneBy && byId.has(later.undoneBy) ? [later.undoneBy] : [])));
  const steps = (first: HistoryEvent) => { let count = 1; for (let at: HistoryEvent | undefined = first; at?.undoneBy; at = byId.get(at.undoneBy)) count++; return count; };
  const counted = after.filter(later => !undoers.has(later.id) && steps(later) % 2 === 1).map(entry => ({ entry, tools: changedBy(entry) }));
  const turnedUp = all.filter(reversesLater).map(entry => ({ entry, tools: toolsOf(entry.turnedUp) }));
  return [...counted, ...turnedUp].filter(change => change.tools.length).sort((first, second) => all.indexOf(first.entry) - all.indexOf(second.entry));
}
/** An Off's tools that no later click changed: a copy that turned up there, turned off again, is held by that later Off. */
const unchangedOff = (event: HistoryEvent, events: HistoryEvent[]) => {
  const changed = new Set(laterChanges(event, events).flatMap(change => change.tools));
  const tools = actsOn(event, events);
  return isOff(event) && Array.isArray(tools) ? tools.filter(tool => !changed.has(tool)) : [];
};
/**
 * Rule A, one answer to "where is this item off?": the tools `event`, an Off, still holds. No copy goes into such a tool, from
 * sync or any click, but this Off's own, put back. Its Off row, sync, every click and History's prune read it.
 */
export const offTools = (event: HistoryEvent, events: HistoryEvent[]) => (deletedSince(event, events) ? [] : unchangedOff(event, events));
/** Every tool a standing Off of item `key` holds (offTools). */
export const heldTools = (events: HistoryEvent[], key: string) => [...new Set(events.filter(event => event.key === key).flatMap(event => offTools(event, events)))];
/**
 * Rule B, one answer to "is this History entry's action still offered?": it stands only while it still means what it says. This
 * returns what ended it, if anything did: a deletion since, or a later Off, put-back or copy choice of the item that changed what
 * it acts on (for an Off, every tool it held). Sync's own edits end nothing. An edit keeps its Undo until a deletion since, and a
 * deletion its Restore for History's days. The History page shows the ending's words (sinceWords) in place of the action, and
 * agents.ts restoreAgent refuses the action in the same words when a page read before asks for it.
 */
export function endedBy(event: HistoryEvent, events: HistoryEvent[]): HistoryEvent | undefined {
  if (event.undoneBy || event.kind === 'deleted') return undefined;
  const deletion = events.findLast(later => deletes(later, event));
  const tools = actsOn(event, events);
  if (deletion || !tools) return deletion;
  const touches = (change: { tools: HarnessId[] }) => tools === '*' || change.tools.some(tool => tools.includes(tool));
  return isOff(event) && unchangedOff(event, events).length ? undefined : laterChanges(event, events).findLast(touches)?.entry;
}
/** What History says of an entry `endedBy` ended, by what ended it. */
export const sinceWords = (ending: HistoryEvent) => (ending.kind === 'deleted' ? 'Deleted since' : ending.kind === 'removed' ? 'Turned off since'
  : ending.kind === 'chosen' ? 'Chosen since' : ending.putBackFrom === 'off' ? 'Turned on since' : 'Restored since');
/**
 * Whether History keeps `event` whatever its age (`cutoff`: the oldest moment it keeps otherwise): an Off, and the content it
 * names, while anything can still bring its copies back. That is until it is turned on again (undone), and once a deletion ended
 * it, for as long as History keeps that deletion, whose Restore brings the Off back. A tool a later Off took over still counts:
 * turning that Off on gives this one its hold back. readHistory keeps every later entry of its item with it, so what it holds
 * reads the same whatever the window.
 */
export const keptOff = (event: HistoryEvent, events: HistoryEvent[], cutoff: number) => isOff(event) && !events.some(later => deletes(later, event) && Date.parse(later.at) < cutoff);
