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
 * (historypage.ts describe). `homeTools`: the home's harnesses, so "all 3 tools" can be said. `item`: the agent now, to name
 * a version.
 */
export function agentSentence(event: HistoryEvent, homeTools: string[], item?: LibraryItem): { glyph: IconName; text: string } | undefined {
  const tools = toolsPhrase(event.losers.map(loser => loser.tool), homeTools);
  /** " and removed from Codex", or nothing when no harness was touched. */
  const also = (words: string) => (tools ? `${words} ${tools}` : '');
  const where = event.only ? toolName(event.only) : '', from = event.winner ? toolName(event.winner.tool) : '';
  const pulled = event.via === 'repo', keeps = 'Central Knot keeps it.';
  switch (event.kind) {
    case 'on':
      if (event.only) return { glyph: 'circle-check', text: `Turned on in ${where}: its file there is back.` };
      if (!event.winner) return { glyph: 'circle-check', text: `Turned on${also(': put in')}.` };
      return pulled ? { glyph: 'git-branch', text: `Pulled from the Git repo into ${from} and taken into Central Knot${also('; put in')}.` }
        : { glyph: 'plus', text: `Found in ${from} and taken into Central Knot${also('; put in')}.` };
    case 'off':
      if (event.only) return { glyph: 'circle-off', text: `Kept out of ${where}: its copy there was removed. ${keeps}` };
      if (!event.winner) return { glyph: 'circle-off', text: `Turned off${also(': removed from')}. ${keeps}` };
      return { glyph: 'trash-2', text: `Its copy was deleted in ${from}, so it was turned off${also(' and removed from')}. ${keeps}` };
    case 'current': {
      // The version as it was first kept says where the content came from; the entry that made it current again doesn't.
      const made = item?.versions.findLast(version => version.hash === event.version);
      const which = made ? `The version ${sourceWords(made.from)} (${dayAndTime(made.at)})` : 'An earlier version';
      return { glyph: 'undo-2', text: `${which} was made current${also(', in')}.` };
    }
    case 'deleted': {
      // One with a `winner` is from before the library (a deletion sync spread from a tool): the general sentence says it.
      if (event.winner) return undefined;
      const how = pulled ? 'Removed in the Git repo, so Pull deleted it' : 'Deleted';
      return { glyph: pulled ? 'git-branch' : 'trash-2', text: `${how} from Central Knot${also(' and removed from')}. History keeps it.` };
    }
    case 'restored':
      // Likewise: an Undo or Restore from before the library names a tool or an earlier version.
      return event.winner || event.previous ? undefined : { glyph: 'undo-2', text: `Restored to Central Knot${also(' and put back in')}.` };
    case 'edit': {
      const how = pulled ? `Pulled from the Git repo into ${from}` : `Edited in ${from}`;
      return { glyph: pulled ? 'git-branch' : 'pencil-line', text: `${how}; that became the current version${tools ? `, in ${tools} too` : ''}.` };
    }
    case 'conflict': {
      const gaveWay = event.losers.filter(loser => loser.hash !== event.previous && loser.hash !== event.winner?.hash);
      const others = andList([...new Set(gaveWay.map(loser => toolName(loser.tool)))]);
      return { glyph: 'diff', text: `${from}’s edit was the latest, so it became the current version. ${others}’s is kept as a version.` };
    }
    case 'chosen': {
      const gave = [...new Set(event.losers.map(loser => toolName(loser.tool)))];
      return { glyph: 'check', text: `You chose ${from}’s copy; ${andList(gave)}’s ${gave.length === 1 ? 'is kept as a version' : 'are kept as versions'}.` };
    }
    default: return undefined;
  }
}

/** What an entry's row shows in place of its action once that action was used. */
export function doneWords(event: HistoryEvent): string {
  return event.kind === 'off' ? 'Turned on since' : event.kind === 'on' ? 'Turned off since' : event.kind === 'deleted' ? 'Restored' : 'Undone';
}

/** An entry's action: the button's words, what it does (said before the click), and the click it sends. */
export interface EntryAction { label: string; help: string; change: Change }

/** The agent as it is, as a click that changes nothing: each action changes one thing of it. */
const asItIs = (item: LibraryItem): Change => ({ key: item.key, managed: item.on, off: [...item.except] });
/** Whether a content is a version of the agent that could be made current: one it has, other than the current one. */
const isVersion = (item: LibraryItem, hash: string | undefined): hash is string =>
  !!hash && hash !== item.hash && item.versions.some(version => version.hash === hash);

/**
 * The action `event` offers for the agent `item` now, if any (the table at the top). `version`: one of versionChoices
 * instead of the entry's own action ("Use Codex’s").
 */
export function agentAction(event: HistoryEvent, item: LibraryItem | undefined, version?: string): EntryAction | undefined {
  if (!item || event.undoneBy) return undefined;
  const name = item.name, now = asItIs(item), everywhere = item.on ? ', in every tool it is on in' : '';
  if (event.kind === 'deleted') {
    const help = `Put ${name} back in Central Knot as it was${item.on ? ', and in every tool it was on in' : ''}`;
    return item.deleted ? { label: 'Restore', help, change: { ...now, deleted: false } } : undefined;
  }
  if (item.deleted) return undefined;
  if (version) {
    const offered = versionChoices(event, item).some(choice => choice.hash === version);
    return offered ? { label: 'Use it', help: `Make that copy’s version of ${name} the current one${everywhere}`, change: { ...now, version } } : undefined;
  }
  if (event.kind === 'off' || event.kind === 'on') return switchAction(event.kind === 'off', event.only, item);
  // Copies an earlier engine added: there is no earlier version to go back to.
  if (event.kind === 'added' || !isVersion(item, event.previous)) return undefined;
  return { label: 'Undo', help: `Make the version from before this change current again${everywhere}`, change: { ...now, version: event.previous } };
}

/** An Off entry's Turn on (`turnOn`), or an On entry's Turn off: for the whole agent, or (`only`) for one harness of an agent that is On. */
function switchAction(turnOn: boolean, only: HarnessId | undefined, item: LibraryItem): EntryAction | undefined {
  const name = item.name, now = asItIs(item);
  if (!only) {
    if (item.on === turnOn) return undefined;
    return turnOn ? { label: 'Turn on', help: `Put ${name} back in every tool it is not kept out of, each file as it was`, change: { ...now, managed: true } }
      : { label: 'Turn off', help: `Take ${name} out of every tool; Central Knot keeps it`, change: { ...now, managed: false } };
  }
  const there = toolName(only), out = item.except.includes(only);
  if (!item.on || out !== turnOn) return undefined;
  return turnOn ? { label: `Turn on in ${there}`, help: `Put ${name} back in ${there}, as it was`, change: { ...now, off: item.except.filter(tool => tool !== only) } }
    : { label: `Turn off in ${there}`, help: `Take ${name} out of ${there}; Central Knot keeps it`, change: { ...now, off: [...item.except, only] } };
}

/** The copies an entry says gave way, each of which is a version that can be made current now: one "Use <harness>’s" each. */
export function versionChoices(event: HistoryEvent, item: LibraryItem | undefined): { tool: HarnessId; hash: string }[] {
  if (!item || item.deleted || event.undoneBy || !['conflict', 'chosen', 'kept-edit'].includes(event.kind)) return [];
  const seen = new Set<string>([event.previous ?? '', event.winner?.hash ?? '']);
  const choices: { tool: HarnessId; hash: string }[] = [];
  for (const { tool, hash } of event.losers) {
    if (!isVersion(item, hash) || seen.has(hash)) continue;
    seen.add(hash);
    choices.push({ tool, hash });
  }
  return choices;
}
