// History's entries about agents, in one place: what each says (agentSentence), what it still offers (agentAction,
// versionChoices), and what its row shows once its action was used (doneWords). Read by History's page (the row and its
// buttons), by app.ts (what is said after a click), by librarypass.ts restore (the click an action runs, through agents.ts restoreAgent) and by the tests.
// Pure: no files, no DOM. The entries of skills and MCP servers are still historypage.ts's own.
//
// Every action is a click the Agents page could send as well (librarypass.ts ItemClick), decided from the entry and the agent as the
// library holds it now (library.ts LibraryItem). So an action is offered exactly while it would change something, and it is
// always safe to click: nothing has to be worked out about what happened since the entry was made.
//
//   entry (HistoryEvent.kind, `cause`)       action                 offered while
//   off: the switch, or a copy deleted       Turn on                the agent is Off
//     by hand (`winner`: where)
//   off in one harness (`only`)              Turn on in <harness>   the agent is On and kept out of that harness
//   on: the switch, a found agent taken      Turn off               the agent is On
//     in (`winner`: where found), or an
//     agent Pull brought
//   on in one harness (`only`)               Turn off in <harness>  the agent is On and in that harness
//   deleted                                  Restore                the agent is deleted
//   a content change: edit, conflict,        Undo; once later       the version from before it (`previous`) is not the
//     current, and any entry from before     changes came, "Make    current one
//     the library that names `previous`      the version before
//                                            this current"
//   conflict, chosen, kept-edit (an edit     Use <harness>’s        that copy's version is not the current one
//     not taken in that was written over,
//     or a copy a tool managed again held):
//     copies that gave way
//
// One entry is not here: a Pull that changed only Claude Code's own settings of an agent (`settingsFile`) keeps its own Undo
// (gitrepo.ts undoSettingsChange), since no version tells such a change apart.
// To add an entry or an action: its kind (or its `cause`) in types.ts HistoryEvent, its sentence in agentSentence, its row in
// agentAction, the entry librarypass.ts logItem makes for it, and its case in historypage.ts describe.
import type { IconName } from './icons.ts';
import { sourceWords, type LibraryItem } from './library.ts';
import type { ItemClick } from './librarypass.ts';
import { versionClock } from './libraryrow.ts';
import type { HarnessId, HistoryEvent } from './types.ts';
import { andList, toolName, toolsPhrase } from './words.ts';

/** Whether an entry is one of these: about an agent, and not a Pull's change to Claude Code's own settings alone. */
export const isAgentEntry = (event: HistoryEvent) => event.key.startsWith('agent:') && !event.settingsFile;
export const agentKeyOf = (event: HistoryEvent) => event.key.slice('agent:'.length);

/** Restore over an agent of the same name made since: what becomes of it, for Restore's result and its tooltip. */
export function keptOver(name: string, tools: readonly string[]): string {
  const where = andList(tools.map(toolName));
  return tools.length === 1 ? `Your newer ${name} from ${where} is kept as a version.` : `Your newer copies of ${name} in ${where} are kept as versions.`;
}

/**
 * What an agent's entry says happened, or undefined for a kind from before the library whose general sentence still holds
 * (historypage.ts describe). `homeTools`: the home's harnesses, so "all 3 tools" can be said. `item`: the agent now, to name
 * a version. `undid`: the entry is another's Undo (that one's `undoneBy` names it), so it reads as one.
 */
export function agentSentence(event: HistoryEvent, homeTools: string[], item?: LibraryItem, undid = false): { glyph: IconName; text: string } | undefined {
  const tools = toolsPhrase(event.losers.map(loser => loser.tool), homeTools);
  /** " and removed from Codex", or nothing when no harness was touched. */
  const also = (words: string) => (tools ? `${words} ${tools}` : '');
  const where = event.only ? toolName(event.only) : '', from = event.winner ? toolName(event.winner.tool) : '';
  // What made it happen is the entry's `cause` alone (types.ts HistoryEvent); none is the person's own switch or click.
  const pulled = event.cause === 'pulled', keeps = 'Central Knot keeps it.';
  switch (event.kind) {
    case 'on': {
      if (event.only) return { glyph: 'circle-check', text: `Turned on in ${where}: its file there is back.` };
      const said = {
        switch: { glyph: 'circle-check', text: `Turned on${also(': put in')}.` },
        found: { glyph: 'plus', text: `Found in ${from} and taken into Central Knot${also('; put in')}.` },
        pulled: { glyph: 'git-branch', text: `Pulled from the Git repo into Central Knot${also('; put in')}.` },
      } as const;
      return said[event.cause === 'found' || event.cause === 'pulled' ? event.cause : 'switch'];
    }
    case 'off':
      if (event.only) return { glyph: 'circle-off', text: `Kept out of ${where}: its copy there was removed. ${keeps}` };
      if (event.cause === 'deleted-by-hand') return { glyph: 'trash-2', text: `Its copy was deleted in ${from}, so it was turned off${also(' and removed from')}. ${keeps}` };
      return { glyph: 'circle-off', text: `Turned off${also(': removed from')}. ${keeps}` };
    case 'current': {
      // The version as it was first kept says where the content came from; the entry that made it current again doesn't.
      const made = item?.versions.findLast(version => version.hash === event.version), when = made && item && versionClock(item, made);
      if (undid) return { glyph: 'undo-2', text: `Undone: ${when ? `the version from ${when}` : 'the version before'} is current again${also(', in')}.` };
      return { glyph: 'undo-2', text: `${made ? `The version ${sourceWords(made.from)} (${when})` : 'An earlier version'} was made current${also(', in')}.` };
    }
    case 'deleted': {
      // One with a `winner` is from before the library (a deletion sync spread from a tool): the general sentence says it.
      if (event.winner) return undefined;
      const how = pulled ? 'Removed in the Git repo, so Pull deleted it' : 'Deleted';
      return { glyph: pulled ? 'git-branch' : 'trash-2', text: `${how} from Central Knot${also(' and removed from')}. History keeps it.` };
    }
    case 'restored': {
      // Likewise: an Undo or Restore from before the library names a tool or an earlier version.
      if (event.winner || event.previous) return undefined;
      // A tool that had a copy of its own by then (a newer agent of that name) had it kept as a version before the write.
      const over = event.losers.filter(loser => loser.hash).map(loser => loser.tool);
      return { glyph: 'undo-2', text: `Restored to Central Knot${also(' and put back in')}.${over.length ? ` ${keptOver(event.item, over)}` : ''}` };
    }
    case 'edit':
      // Pull's own entry names no harness. With no version before it, only Claude Code's own settings came, for later.
      if (pulled && !event.previous) return { glyph: 'git-branch', text: 'Pulled from the Git repo: Claude Code’s own settings for it, which Claude Code gets when it has the agent.' };
      if (pulled) return { glyph: 'git-branch', text: `Pulled from the Git repo; that became the current version${tools ? `, in ${tools}` : ''}.` };
      return { glyph: 'pencil-line', text: `Edited in ${from}; that became the current version${tools ? `, in ${tools} too` : ''}.` };
    case 'kept-edit': {
      // One with a `winner` is from before the library (an edit kept over a deletion): the general sentence says it.
      if (event.winner) return undefined;
      const where = andList([...new Set(event.losers.map(loser => toolName(loser.tool)))]);
      if (event.cause === 'tool-back') return { glyph: 'diff', text: `${where}’s copy changed while Central Knot didn’t manage ${where}; it gave way to the current version and is kept as a version.` };
      return { glyph: 'diff', text: `Edited in ${where}, not taken in yet, and written over by the current version: the edit is kept as a version.` };
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
export interface EntryAction { label: string; help: string; click: ItemClick }

/** The agent as it is, as a click that changes nothing: each action changes one thing of it. */
const asItIs = (item: LibraryItem): ItemClick => ({ key: item.key, on: item.on, except: [...item.except] });
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
    return item.deleted ? { label: 'Restore', help, click: { ...now, deleted: false } } : undefined;
  }
  if (item.deleted) return undefined;
  if (version) {
    const offered = versionChoices(event, item).some(choice => choice.hash === version);
    return offered ? { label: 'Use it', help: `Make that copy’s version of ${name} the current one${everywhere}`, click: { ...now, version } } : undefined;
  }
  if (event.kind === 'off' || event.kind === 'on') return switchAction(event.kind === 'off', event.only, item);
  // Copies an earlier engine added: there is no earlier version to go back to.
  if (event.kind === 'added' || !isVersion(item, event.previous)) return undefined;
  // Undo while what this entry made is still current; once later changes came, it says what it does instead.
  const latest = (event.version ?? event.winner?.hash) === item.hash;
  return { label: latest ? 'Undo' : 'Go back before this', help: `Make the version from before this change current again${everywhere}`, click: { ...now, version: event.previous } };
}

/** An Off entry's Turn on (`turnOn`), or an On entry's Turn off: for the whole agent, or (`only`) for one harness of an agent that is On. */
function switchAction(turnOn: boolean, only: HarnessId | undefined, item: LibraryItem): EntryAction | undefined {
  const name = item.name, now = asItIs(item);
  if (!only) {
    if (item.on === turnOn) return undefined;
    return turnOn ? { label: 'Turn on', help: `Put ${name} back in every tool it is not kept out of, each file as it was`, click: { ...now, on: true } }
      : { label: 'Turn off', help: `Take ${name} out of every tool; Central Knot keeps it`, click: { ...now, on: false } };
  }
  const there = toolName(only), out = item.except.includes(only);
  if (!item.on || out !== turnOn) return undefined;
  return turnOn ? { label: `Turn on in ${there}`, help: `Put ${name} back in ${there}, as it was`, click: { ...now, except: item.except.filter(tool => tool !== only) } }
    : { label: `Turn off in ${there}`, help: `Take ${name} out of ${there}; Central Knot keeps it`, click: { ...now, except: [...item.except, only] } };
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
