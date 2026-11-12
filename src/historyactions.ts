// History's entries about agents, in one place: what each says (agentSentence), what it still offers (agentAction,
// versionChoices), and what its row shows once its action was used (doneWords). Read by History's page (the row and its
// buttons), by app.ts (what is said after a click), by agents.ts restoreAgent (the click an action runs) and by the tests.
// Pure: no files, no DOM. The entries of skills and MCP servers are still historypage.ts's own.
//
// Every action is a click the Agents page could send as well (types.ts Change), decided from the entry and the agent as the
// library holds it now (library.ts LibraryItem). So an action is offered exactly while it would change something, and it is
// always safe to click: nothing has to be worked out about what happened since the entry was made.
//
//   entry (HistoryEvent.kind)                action                 offered while
//   off: the switch, or a copy deleted       Turn on                the agent is Off
//     by hand (`winner`: where)
//   off in one harness (`only`)              Turn on in <harness>   the agent is On and kept out of that harness
//   on: the switch, or a found agent         Turn off               the agent is On
//     taken in (`winner`: where found)
//   on in one harness (`only`)               Turn off in <harness>  the agent is On and in that harness
//   deleted                                  Restore                the agent is deleted
//   a content change: edit, conflict,        Undo                   the version from before it (`previous`) is not the
//     current, and any entry from before                              current one
//     the library that names `previous`
//   conflict, chosen: copies that gave way   Use <harness>’s        that copy's version is not the current one
//
// One entry is not here: a Pull that changed only Claude Code's own settings of an agent (`settingsFile`) keeps its own Undo
// (gitrepo.ts undoSettingsChange), since no version tells such a change apart.
// To add an entry or an action: its kind in types.ts HistoryEvent, its sentence in agentSentence, its row in agentAction.
import type { IconName } from './icons.ts';
import { sourceWords, type LibraryItem } from './library.ts';
import { dayAndTime } from './model.ts';
import type { Change, HarnessId, HistoryEvent } from './types.ts';
import { andList, toolName, toolsPhrase } from './words.ts';

/** Whether an entry is one of these: about an agent, and not a Pull's change to Claude Code's own settings alone. */
export const isAgentEntry = (event: HistoryEvent) => event.key.startsWith('agent:') && !event.settingsFile;
export const agentKeyOf = (event: HistoryEvent) => event.key.slice('agent:'.length);

/**
 * What an agent's entry says happened, or undefined for a kind from before the library whose general sentence still holds
 * (historypage.ts describe). `homeTools`: the home's harnesses, so "all 3 tools" can be said. `item`: the agent now, to name a version.
 */
export function agentSentence(event: HistoryEvent, homeTools: string[], item?: LibraryItem): { glyph: IconName; text: string } | undefined {
  const tools = toolsPhrase(event.losers.map(loser => loser.tool), homeTools);
  const where = event.only ? toolName(event.only) : '', from = event.winner ? toolName(event.winner.tool) : '';
  const pulled = event.via === 'repo', keeps = 'Central Knot keeps it.';
  switch (event.kind) {
    case 'on':
      if (event.only) return { glyph: 'circle-check', text: `Turned on in ${where}: its file there is back.` };
      if (event.winner) return { glyph: pulled ? 'git-branch' : 'plus', text: `${pulled ? `Pulled from the Git repo into ${from}` : `Found in ${from}`} and taken into Central Knot${tools ? `; put in ${tools}` : ''}.` };
      return { glyph: 'circle-check', text: `Turned on${tools ? `: put in ${tools}` : ''}.` };
    case 'off':
      if (event.only) return { glyph: 'circle-off', text: `Kept out of ${where}: its copy there was removed. ${keeps}` };
      if (event.winner) return { glyph: 'trash-2', text: `Its copy was deleted in ${from}, so it was turned off${tools ? ` and removed from ${tools}` : ''}. ${keeps}` };
      return { glyph: 'circle-off', text: `Turned off${tools ? `: removed from ${tools}` : ''}. ${keeps}` };
    case 'current': {
      // The version as it was first kept says where the content came from; the entry that made it current again doesn't.
      const made = item?.versions.findLast(version => version.hash === event.version);
      return { glyph: 'undo-2', text: `${made ? `The version ${sourceWords(made.from)} (${dayAndTime(made.at)})` : 'An earlier version'} was made current${tools ? `, in ${tools}` : ''}.` };
    }
    case 'deleted':
      return event.winner ? undefined : { glyph: pulled ? 'git-branch' : 'trash-2', text: `${pulled ? 'Removed in the Git repo, so Pull deleted it' : 'Deleted'} from Central Knot${tools ? ` and removed from ${tools}` : ''}. History keeps it.` };
    case 'restored':
      return event.winner || event.previous ? undefined : { glyph: 'undo-2', text: `Restored to Central Knot${tools ? ` and put back in ${tools}` : ''}.` };
    case 'edit':
      return { glyph: pulled ? 'git-branch' : 'pencil-line', text: `${pulled ? `Pulled from the Git repo into ${from}` : `Edited in ${from}`}; that became the current version${tools ? `, in ${tools} too` : ''}.` };
    case 'conflict': {
      const others = [...new Set(event.losers.filter(loser => loser.hash !== event.previous && loser.hash !== event.winner?.hash).map(loser => toolName(loser.tool)))];
      return { glyph: 'diff', text: `${from}’s edit was the latest, so it became the current version. ${andList(others)}’s is kept as a version.` };
    }
    case 'chosen': {
      const gave = [...new Set(event.losers.map(loser => toolName(loser.tool)))];
      return { glyph: 'check', text: `You chose ${from}’s copy; ${andList(gave)}’s ${gave.length === 1 ? 'is kept as a version' : 'are kept as versions'}.` };
    }
    default: return undefined;
  }
}

/** What an entry's row shows in place of its action once that action was used. */
export const doneWords = (event: HistoryEvent) => (event.kind === 'off' ? 'Turned on since' : event.kind === 'on' ? 'Turned off since' : event.kind === 'deleted' ? 'Restored' : 'Undone');

/** An entry's action: the button's words, what it does (said before the click), and the click it sends. */
export interface EntryAction { label: string; help: string; change: Change }

/** The agent as it is, as a click that changes nothing: each action changes one thing of it. */
const asItIs = (item: LibraryItem): Change => ({ key: item.key, managed: item.on, off: [...item.except] });
const isVersion = (item: LibraryItem, hash: string | undefined): hash is string => !!hash && hash !== item.hash && item.versions.some(version => version.hash === hash);

/**
 * The action `event` offers for the agent `item` now, if any. `version`: one of versionChoices instead of the entry's own
 * action ("Use Codex’s").
 */
export function agentAction(event: HistoryEvent, item: LibraryItem | undefined, version?: string): EntryAction | undefined {
  if (!item || event.undoneBy) return undefined;
  const name = item.name, now = asItIs(item);
  if (event.kind === 'deleted') return item.deleted ? { label: 'Restore', help: `Put ${name} back in Central Knot as it was${item.on ? ', and in every harness it was on in' : ''}`, change: { ...now, deleted: false } } : undefined;
  if (item.deleted) return undefined;
  const makeCurrent = (hash: string, label: string, help: string): EntryAction => ({ label, help, change: { ...now, version: hash } });
  if (version) return versionChoices(event, item).some(choice => choice.hash === version) ? makeCurrent(version, 'Use it', `Make that copy’s version of ${name} the current one`) : undefined;
  const there = event.only ? toolName(event.only) : '';
  if (event.kind === 'off' && event.only) return item.on && item.except.includes(event.only) ? { label: `Turn on in ${there}`, help: `Put ${name} back in ${there}, as it was`, change: { ...now, off: item.except.filter(tool => tool !== event.only) } } : undefined;
  if (event.kind === 'off') return item.on ? undefined : { label: 'Turn on', help: `Put ${name} back in every harness it is not kept out of, each file as it was`, change: { ...now, managed: true } };
  if (event.kind === 'on' && event.only) return item.on && !item.except.includes(event.only) ? { label: `Turn off in ${there}`, help: `Take ${name} out of ${there}; Central Knot keeps it`, change: { ...now, off: [...item.except, event.only] } } : undefined;
  if (event.kind === 'on') return item.on ? { label: 'Turn off', help: `Take ${name} out of every harness; Central Knot keeps it`, change: { ...now, managed: false } } : undefined;
  // Copies an earlier engine added: there is no earlier version to go back to.
  if (event.kind === 'added') return undefined;
  return isVersion(item, event.previous) ? makeCurrent(event.previous, 'Undo', `Make the version from before this change current again${item.on ? ', in every harness it is on in' : ''}`) : undefined;
}

/** The copies an entry says gave way, each of which is a version that can be made current now: one "Use <harness>’s" each. */
export function versionChoices(event: HistoryEvent, item: LibraryItem | undefined): { tool: HarnessId; hash: string }[] {
  if (!item || item.deleted || event.undoneBy || !['conflict', 'chosen', 'kept-edit'].includes(event.kind)) return [];
  const seen = new Set<string>([event.previous ?? '', event.winner?.hash ?? '']);
  return event.losers.filter(loser => isVersion(item, loser.hash) && !seen.has(loser.hash) && seen.add(loser.hash)).map(({ tool, hash }) => ({ tool, hash }));
}
