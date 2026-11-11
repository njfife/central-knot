// History's actions, in one table. For each kind of entry (EntryIs, named by entryIs), the table gives the action its row offers
// (the button's word), how far it reaches (its scope in the label), what the button says it does (help), the state its row shows
// once the entry is undone (done), and what is said after the click (after). historypage.ts draws each row's action from
// `offered`, and app.ts restoreEvent says the result with `afterWords`; the engines (agents.ts restoreAgent, mcp.ts restoreMcp,
// manage.ts restoreFromHistory) do the work. Whether an entry's action is still offered after later clicks is Rule B
// (historyrules.ts endedBy): an ended entry shows what ended it in place of its action. Pure: no DOM, no app state.
//
// To add a kind of History action: add its EntryIs, say when an entry is one in entryIs, and give it a row in `table`.
import { endedBy, offTools, sinceWords } from './historyrules.ts';
import { NO_PROFILE, redoneSwitch } from './profileplan.ts';
import { andList, toolName, toolsPhrase } from './words.ts';
import type { DestinationResult, HarnessId, HistoryEvent, RestoreHow } from './types.ts';

/** What an entry is, as History acts on it. */
export type EntryIs = 'pulled-base' | 'pulled-deletion' | 'pulled-edit' | 'pulled-add' | 'edit' | 'conflict' | 'kept-edit' | 'deletion' | 'delete-everywhere'
  | 'choice' | 'agent-choice' | 'unfinished-choice' | 'switch' | 'profile' | 'off' | 'removal' | 'take-over' | 'write' | 'add'
  | 'on-after-off' | 'delete-everywhere-again' | 'deletion-again' | 'redo' | 'restore-after-removal' | 'undo';

export function entryIs(event: HistoryEvent, events: HistoryEvent[]): EntryIs {
  if (event.base) return 'pulled-base';
  if (event.via === 'repo' && !event.undoneBy) {
    if (event.kind === 'deleted') return 'pulled-deletion';
    if (event.kind === 'chosen' || event.kind === 'edit') return 'pulled-edit';
    if (event.kind === 'added') return 'pulled-add';
  }
  switch (event.kind) {
    case 'edit': case 'conflict': case 'kept-edit': case 'switched': case 'profile': case 'took-over': case 'written': case 'added':
      return ({ edit: 'edit', conflict: 'conflict', 'kept-edit': 'kept-edit', switched: 'switch', profile: 'profile', 'took-over': 'take-over', written: 'write', added: 'add' } as const)[event.kind];
    case 'deleted': return event.everywhere ? 'delete-everywhere' : 'deletion';
    // An agent's choice is undone from History as its click's Undo is: each replaced copy back in its own tool.
    case 'chosen': return event.restoredTools ? 'unfinished-choice' : event.key.startsWith('agent:') ? 'agent-choice' : 'choice';
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

/** What a click on an entry's action led to, for the words said after it. */
export interface AfterClick { results: DestinationResult[]; homeTools: string[] }
/** How far the action reaches, for its label: the tools it names, every tool, or none said. */
type Scope = 'named' | 'held' | 'switched' | 'base' | 'all' | 'none';
interface Row {
  /** The button's word, or none: the row has no action (one with several overwritten edits has one button per edit, historypage.ts). */
  word?: (event: HistoryEvent, events: HistoryEvent[]) => string | undefined;
  scope: Scope;
  /** What the button does, said before the click. */
  help: (event: HistoryEvent, tools: HarnessId[], events: HistoryEvent[], homeTools: string[]) => string;
  /** The row's state once the entry is undone. */
  done?: string;
  /** What the engine is asked (RestoreHow), when not the plain way. */
  how?: RestoreHow;
  /** What is said after the click went through; none: app.ts restoreEvent says it in its own words for that kind. */
  after?: (event: HistoryEvent, click: AfterClick) => string;
}

const who = (tool?: string) => (tool ? toolName(tool) : 'Central Knot');
const where = (results: DestinationResult[], outcome: DestinationResult['outcome']) => [...new Set(results.filter(entry => entry.outcome === outcome && entry.harness).map(entry => entry.harness!))];
/** The tools' own words for what didn't go as asked (a copy changed since, a folder that can't be written). */
const leftAsIs = (results: DestinationResult[]) => results.filter(entry => entry.outcome !== 'written' && entry.outcome !== 'removed').map(entry => entry.message);
const sentence = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');
const deletedAgain = (event: HistoryEvent, results: DestinationResult[]) => { const gone = where(results, 'removed'); return sentence(`Deleted ${event.item} again${gone.length ? ` from ${andList(gone.map(toolName))}` : ''}. History keeps it.`, ...leftAsIs(results)); };
const put = (verb: string) => (event: HistoryEvent, tools: HarnessId[]) => `${verb} ${event.item} again: each copy it put back removed${tools.length ? ` from ${andList(tools.map(toolName))}` : ''}, and History keeps it`;

const table: Record<EntryIs, Row> = {
  'pulled-base': { word: event => (event.via === 'repo' ? 'Undo pull' : 'Undo'), scope: 'base', help: () => 'Put the base instructions back as they were before this Pull, and in the tools that got them (where their file is unchanged since)' },
  'pulled-deletion': { word: () => 'Restore', scope: 'all', help: event => `Put ${event.item} back in every tool it synced to` },
  'pulled-edit': { word: () => 'Undo pull', scope: 'all', help: event => `Put ${event.item} back as it was before this change, in every tool it syncs to (including where it was edited)` },
  'pulled-add': { word: () => 'Undo add', scope: 'none', help: event => `Remove the copies Pull added (only while unchanged) and stop syncing ${event.item}` },
  edit: { word: () => 'Undo edit', scope: 'all', help: event => `Put ${event.item} back as it was before this change, in every tool it syncs to (including where it was edited)` },
  conflict: { word: () => 'Undo', scope: 'all', help: event => `Put ${event.item} back as it was before this change, in every tool it syncs to (including where it was edited)` },
  'kept-edit': { scope: 'none', help: () => '' },
  deletion: { word: () => 'Restore', scope: 'all', help: event => `Put ${event.item} back in every tool it synced to` },
  'delete-everywhere': { word: () => 'Restore', scope: 'named', help: (event, tools) => (event.losers.length ? `Put each copy back in ${andList(tools.map(toolName))}, as it was` : `Put ${event.item} back on its page, off, its copies in History`),
    after: (event, { results, homeTools }) => sentence(where(results, 'written').length ? `${event.item} is back in ${toolsPhrase(where(results, 'written'), homeTools)}.` : !event.losers.length ? `${event.item} is back on its page, off.` : '', ...leftAsIs(results)) },
  choice: { word: () => 'Undo choice', scope: 'all', help: event => `Put ${event.item} back as it was before this change, in every tool it syncs to (including where it was edited)` },
  'agent-choice': { word: () => 'Undo choice', scope: 'named', how: { narrow: true }, help: (event, tools) => `Put each copy this choice replaced back in its own tool (${andList(tools.map(toolName))}), take out the copies it added, and leave ${event.item} as it was before the choice (only while unchanged since)` },
  'unfinished-choice': { word: () => 'Finish undo', scope: 'none', how: { narrow: true }, help: (event, _tools, events, homeTools) => `${unfinished(event, events, homeTools, true)} (only while unchanged since)` },
  switch: { word: event => { const flips = new Set((event.switched ?? []).map(entry => entry.disabled)); return flips.size === 1 ? (flips.has(true) ? 'Undo: enable' : 'Undo: disable') : 'Undo'; }, scope: 'switched',
    help: event => (event.switched ?? []).map(entry => `${entry.disabled ? 'Enable' : 'Disable'} it again in ${who(entry.tool)}`).join('; ') },
  profile: { word: (event, events) => (redoneSwitch(events, event) ? 'Undo switch' : events.find(other => other.undoneBy === event.id)?.kind === 'profile' ? 'Redo switch' : 'Undo switch'), scope: 'none',
    help: event => `Each switch this changed goes back, where it is still as this left it; ${event.profile?.fromName ?? NO_PROFILE} is in use again if this switch is the one that chose the profile in use` },
  off: { word: () => 'Turn on', scope: 'held', done: 'Turned on since', help: event => `Turn ${event.item} on again there: each copy back as it was`,
    after: (event, { results }) => sentence(where(results, 'written').length ? `${event.item} is back in ${andList(where(results, 'written').map(toolName))}.` : '', ...leftAsIs(results)) },
  removal: { word: () => 'Restore', scope: 'named', done: 'Restored', help: event => `Put the removed copy back in ${andList(event.losers.map(loser => toolName(loser.tool)))}` },
  'take-over': { word: () => 'Undo', scope: 'all', help: event => `Put the links and the shared copy back as they were${event.tookOver?.managedNow ? `, remove the copies that turning it on added, and stop syncing ${event.item}` : ''} (only while unchanged)` },
  write: { word: () => 'Undo write', scope: 'none', help: () => 'Put back what Claude Code had before (quit Claude Code first)' },
  add: { word: () => 'Undo add', scope: 'none', help: event => `Remove the copies it added (only while unchanged) and stop syncing ${event.item}${event.rejoined ? ' there' : ''}` },
  'on-after-off': { word: () => 'Turn off again', scope: 'named', done: 'Turned off since', help: put('Turn off'),
    after: (event, { results }) => { const off = where(results, 'removed'); return sentence(off.length ? `${event.item} is off in ${andList(off.map(toolName))} again. History keeps ${off.length === 1 ? 'its copy' : 'the copies'}.` : `${event.item} is off again.`, ...leftAsIs(results)); } },
  'delete-everywhere-again': { word: () => 'Delete again', scope: 'named', help: put('Delete'), after: (event, { results }) => deletedAgain(event, results) },
  'deletion-again': { word: () => 'Delete again', scope: 'all', help: put('Delete'), after: (event, { results }) => deletedAgain(event, results) },
  redo: { word: (event, events) => { const undone = events.find(other => other.undoneBy === event.id); const first = undone && events.find(other => other.undoneBy === undone.id); return first?.kind === 'deleted' ? 'Restore' : 'Undo edit'; }, scope: 'all',
    help: event => `Put ${event.item} back as it was before this change, in every tool it syncs to (including where it was edited)` },
  'restore-after-removal': { scope: 'none', help: () => '' },
  undo: { word: () => 'Redo edit', scope: 'all', help: () => 'Undo the undo: put back the version that was replaced' },
};

/** The tools an action names in its label: those it touched (an Off: those it still holds), the switched ones, or a Pull's base's. */
function scopeTools(event: HistoryEvent, events: HistoryEvent[], scope: Scope): HarnessId[] {
  if (scope === 'held') return offTools(event, events);
  if (scope === 'switched') return (event.switched ?? []).map(entry => entry.tool);
  if (scope === 'base') return (event.base?.list.tools ?? []) as HarnessId[];
  return scope === 'named' ? [...new Set(event.losers.map(loser => loser.tool).filter(tool => !event.restoredTools?.includes(tool)))] : [];
}

/** An entry's action as its row offers it: the label, what it does (help), and how the engine is asked. */
export interface EntryAction { word: string; label: string; help: string; how?: RestoreHow }
/**
 * What an entry's row shows in its right-hand column: its action, or (`state`) why it has none: undone (the table's `done`), or
 * ended by a later click (Rule B, in what ended it's words). Neither: a row with no action of its own.
 */
export function offered(event: HistoryEvent, events: HistoryEvent[], homeTools: string[]): { action?: EntryAction; state?: string } {
  const is = entryIs(event, events), row = table[is];
  if (event.undoneBy) return { state: row.done ?? 'Undone' };
  const ending = event.key.startsWith('agent:') ? endedBy(event, events) : undefined;
  if (ending) return { state: sinceWords(ending) };
  const word = row.word?.(event, events);
  if (!word) return {};
  const tools = scopeTools(event, events, row.scope);
  const scope = tools.length ? `in ${toolsPhrase(tools, homeTools)}` : row.scope === 'all' ? 'in all tools' : '';
  return { action: { word, label: is === 'profile' ? word : `${word} ${scope}`.trim(), help: row.help(event, tools, events, homeTools), ...(row.how ? { how: row.how } : {}) } };
}

/**
 * A choice whose Undo stopped part-way: what went back and what is still to go ("Undone in Copilot CLI; Codex still to go; the
 * new copy in Pi still to remove."), or, `todo`, what its Finish undo will do.
 */
export function unfinished(event: HistoryEvent, events: HistoryEvent[], homeTools: string[], todo = false): string {
  const noun = event.key.startsWith('mcp:') ? 'entry' : 'copy';
  const phrase = (tools: string[]) => toolsPhrase(tools, homeTools);
  const back = event.restoredTools ?? [];
  const left = event.losers.map(loser => loser.tool).filter(tool => !back.includes(tool));
  const added = events.find(other => other.id === event.addedId && !other.undoneBy)?.losers.map(loser => loser.tool) ?? [];
  const said = todo ? [left.length && `put ${left.length === 1 ? 'the' : 'each'} replaced ${noun} back in ${phrase(left)}`, added.length && `remove the new ${noun} in ${phrase(added)}`].filter(Boolean).join(', and ')
    : [back.length && `undone in ${phrase(back)}`, left.length && `${phrase(left)} still to go`, added.length && `the new ${noun} in ${phrase(added)} still to remove`].filter(Boolean).join('; ');
  return said ? `${said.charAt(0).toUpperCase()}${said.slice(1)}${todo ? '' : '.'}` : todo ? 'Finish the Undo' : '';
}

/** What is said after an entry's action went through, from what the engine did; undefined where restoreEvent says it itself. */
export const afterWords = (event: HistoryEvent, events: HistoryEvent[], click: AfterClick) => table[entryIs(event, events)].after?.(event, click);
