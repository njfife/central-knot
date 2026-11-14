// History's entries about items in Central Knot's library (skills, MCP servers and agents), in one place: whose they are (libraryEntry),
// what each says (librarySentence), what it still offers (libraryAction, versionChoices), and what its row shows once its
// action was used (doneWords). Read by History's page (the row and its buttons), by app.ts (what is said after a click), by
// librarypass.ts restore (the click an action runs, through each kind's Kind.historyAction) and by the tests. Pure: no
// files, no DOM. The entries of profiles, the base instructions and a tool's Manage switch are historypage.ts's own.
//
// Every action is decided from the entry, the item as the library holds it now (library.ts LibraryItem) and, for a take-in's
// Undo and a cleared switch's, what the managed tools hold now (ItemNow; a skill row's `loads`), so it is offered exactly while
// it would change something. Most are a click the item's page could send as well
// (types.ts Change). Two are not: an Undo that gives tools their own copies back (Change giveBack, which the page never
// sends), and a cleared switch's Undo, which sets that tool's own switch again (skills.ts switchBack, not a Change). An entry
// from before an item was on the library (a skill's Remove, Disable or take-over by the earlier engine; an MCP server's Undo
// write, Undo add or Finish undo) offers only what can still be said as one of these; otherwise it shows as past, with no action.
//
//   entry (HistoryEvent.kind, `cause`)       action                 offered while
//   off: the switch, a copy deleted by       Turn on                the item is Off
//     hand (`winner`: where), or a source
//     (`source`: brought in, Off;
//     `source-dropped`: no longer there)
//   on, off or deleted by a pass no click    none: nothing was asked (a deleted item's Restore is its Delete's
//     asked (`in-line`)                      entry's; what an `on` wrote over is kept among the item's versions)
//   off in one harness (`only`)              Turn on in <harness>   the item is On and kept out of that harness
//   on: the switch, or an item Pull          Turn off               the item is On
//     brought
//   on in one harness (`only`)               Turn off in <harness>  the item is On and in that harness
//   on or off whose click took tools' own    Undo: that action,     the item is as the click left it (asTheClickLeftIt);
//     copies over (`tookFrom`)               each such copy given   after that, the plain action above, which gives
//                                            back                   nothing back
//   a found item taken in (on, `found`, or   Undo: out of Central   every place it was found in still holds the copy it
//     `sync-everything` with no click;       Knot again, found      held then, in a tool still managed, as the copies
//     chosen)                                again, each tool it    are now (takeInHeld); after that, an `on` one
//                                            was found in keeping   offers a plain Turn off, a `chosen` one nothing
//                                            its own copy
//   (either Undo, when a copy would go back to Claude Code's MCP settings: not offered, see givesBackLater)
//   deleted                                  Restore                the item is deleted
//   a content change: edit, conflict,        Undo; once later       the version from before it (`previous`) is not the
//     current, and any entry from before     changes came, "Make    current one
//     the library that names `previous`      the version before
//                                            this current"
//   kept-edit from a source (`source`):      Use it                 the source's version (`version`) is not the
//     its version kept, the current one                               current one
//     being later
//   conflict, chosen, kept-edit (an edit     Use <harness>’s        that copy's version is not the current one
//     not taken in that was written over,
//     a copy a tool managed again held, or
//     a copy of a tool's own: `own-copy`),
//     and on (a tool's own copy the click
//     wrote over): copies that gave way
//   switched: a skill's tool switch          Undo: sets that        some tool still loads it (`loads`)
//     cleared (isClearedSwitch)              switch again
//
// Synchronize everything's own entries (a switch on or off, and the one Undo of a switch-on: everything.ts, whose header has
// their table) are worded and decided at the end of this file: everythingPlan reads what that Undo takes back from History,
// each take-in by its own Undo above (takeInHeld says why one is not offered).
// One entry is not here: a Pull that changed only Claude Code's own settings of an agent (`settingsFile`) keeps its own Undo
// (gitrepo.ts undoSettingsChange), since no version tells such a change apart. A copy taken over (skills.ts takeOver,
// `took-over`) has no action.
// To add an entry or an action: its kind (or its `cause`) in types.ts HistoryEvent, its sentence in librarySentence, its row
// in libraryAction, the entry librarypass.ts logItem makes for it, and its case in historypage.ts describe.
import type { IconName } from './icons.ts';
import { itemKey, pendingChanges, theVersion, type LibraryItem } from './library.ts';
import { linkLabel } from './sourcelink.ts';
import { asItIs, noTimeTells, versionClock, writesWait, type RowWords } from './libraryrow.ts';
import type { Change, HarnessId, HistoryEvent, HomeView, LibraryFacts } from './types.ts';
import { andList, sentence, toolName, toolsPhrase } from './words.ts';

/**
 * Whose a History entry is among the library's kinds, by the page's name for the kind (app.ts PageKind), with the item's key.
 * No library item's: a profile's, a tool's Manage switch's and Synchronize everything's entries (by their kind), a Pull's
 * change to the base instructions (`base`) or to an agent's Claude Code settings alone (`settingsFile`), both gitrepo.ts's.
 * Of the rest, an agent's is keyed `agent:<key>`; an MCP server's `mcp:<key>` (before the library, `mcp:<name>` as written,
 * whose key is share.ts itemKey of it); and a skill's by its key alone, whatever characters its folder's name holds.
 */
export function libraryEntry(event: HistoryEvent): { kind: 'agents' | 'skills' | 'mcp'; key: string } | undefined {
  if (!event.key || event.base || event.settingsFile || ['profile', 'managing', 'everything'].includes(event.kind)) return undefined;
  if (event.key.startsWith('agent:')) return { kind: 'agents', key: event.key.slice('agent:'.length) };
  if (event.key.startsWith('mcp:')) return { kind: 'mcp', key: itemKey(event.key.slice('mcp:'.length)) };
  return { kind: 'skills', key: event.key };
}

/** Restore over an agent of the same name made since: what becomes of it, for Restore's result and its tooltip. */
export function keptOver(name: string, tools: readonly string[]): string {
  const where = andList(tools.map(toolName));
  return tools.length === 1 ? `Your newer ${name} from ${where} is kept as a version.` : `Your newer copies of ${name} in ${where} are kept as versions.`;
}

/**
 * What a library item's entry says happened, in its kind's words (libraryrow.ts RowWords), or undefined for a kind from before
 * the library whose general sentence still holds (historypage.ts describe). `homeTools`: the home's harnesses, so "all 3
 * tools" can be said. `item`: the item now, to name a version. `undid`: the entry is another's Undo (that one's `undoneBy`
 * names it), so it reads as one.
 */
export function librarySentence(event: HistoryEvent, words: RowWords, homeTools: string[], item?: LibraryItem, undid = false): { glyph: IconName; text: string } | undefined {
  const tools = toolsPhrase(event.losers.map(loser => loser.tool), homeTools);
  /** " and removed from Codex", or nothing when no harness was touched. */
  const also = (words: string) => (tools ? `${words} ${tools}` : '');
  const where = event.only ? toolName(event.only) : '', from = event.winner ? toolName(event.winner.tool) : '';
  // What made it happen is the entry's `cause` alone (types.ts HistoryEvent); none is the person's own switch or click.
  const pulled = event.cause === 'pulled', keeps = 'Central Knot keeps it.', source = event.link ? linkLabel(event.link) : 'Its source';
  // An Undo that gave tools their own copies back instead of removing what was there (types.ts HistoryEvent gaveBack).
  const gave = (event.gaveBack ?? []).map(toolName);
  const gaveSaid = gave.length ? ` ${andList(gave)} ${gave.length === 1 ? 'has its own copy' : 'have their own copies'} back, as before.` : '';
  /** Whether the entry names this harness as written or removed (a write or removal held is not: librarypass.ts untell). */
  const named = (tool: HarnessId) => event.losers.some(loser => loser.tool === tool);
  // A click that wrote over a copy a tool had of its own (tookFrom, and written: in `losers`), which is kept as a version.
  const over = (event.tookFrom ?? []).filter(copy => named(copy.tool)).map(copy => toolName(copy.tool));
  const overSaid = over.length ? ` ${andList(over)}’s own ${words.copy}${over.length === 1 ? ' was' : 's were'} written over and kept as a version.` : '';
  switch (event.kind) {
    case 'on': {
      // A pass no click asked wrote the current version over copies there (a tool managed again, a folder writable again).
      if (event.cause === 'in-line') return { glyph: 'circle-check', text: `Written over in ${tools} with the current version when sync reached ${event.losers.length === 1 ? 'it' : 'them'}; what was there is one of its versions.` };
      if (event.only) return { glyph: 'circle-check', text: `Turned on in ${where}${named(event.only) ? `: its ${words.copy} there is back` : ''}.${overSaid}${gaveSaid}` };
      const said = {
        switch: { glyph: 'circle-check', text: `Turned on${also(': put in')}.` },
        found: { glyph: 'plus', text: `Found in ${from} and taken into Central Knot${also('; put in')}.` },
        'sync-everything': { glyph: 'plus', text: `Found in ${from} and taken into Central Knot by Synchronize everything${also('; put in')}.` },
        pulled: { glyph: 'git-branch', text: `Pulled from the Git repo into Central Knot${also('; put in')}.` },
      } as const;
      const { glyph, text } = said[event.cause === 'found' || event.cause === 'sync-everything' || event.cause === 'pulled' ? event.cause : 'switch'];
      // A take-in whose Undo would hand Claude Code's own MCP entry back, which only Write to Claude Code writes (givesBackLater): none.
      const tookFrom = Object.fromEntries((event.tookFrom ?? []).map(copy => [copy.tool, copy.hash]));
      const noUndo = tookIn(event) && givesBackLater(event, tookFrom) ? ` It has no Undo: an Undo would hand Claude Code’s own entry back, and Claude Code’s MCP settings are written only by Write to Claude Code. Turn it off instead (Central Knot keeps it), or keep it out of the other tools on its row.` : '';
      return { glyph, text: `${text}${overSaid}${gaveSaid}${noUndo}` };
    }
    case 'off':
      if (event.only && event.gaveBack?.includes(event.only)) return { glyph: 'circle-off', text: `Kept out of ${where}: ${where} has its own copy back, as before. ${keeps}` };
      if (event.only) return { glyph: 'circle-off', text: `Kept out of ${where}${named(event.only) ? ': its copy there was removed' : ''}. ${keeps}${gaveSaid}` };
      if (event.cause === 'deleted-by-hand') return { glyph: 'trash-2', text: `Its copy was deleted in ${from}, so it was turned off${also(' and removed from')}. ${keeps}` };
      if (event.cause === 'source') return { glyph: 'link-2', text: `Brought in from ${source}: in Central Knot, Off, until you turn it on.` };
      if (event.cause === 'source-dropped') return { glyph: 'link-2-off', text: `${source} no longer has it, so it is off${also(' and removed from')}, and no longer from that source. ${keeps}` };
      // A pass no click asked took its copies out where it is off (or kept out): a tool managed again, a folder writable again.
      if (event.cause === 'in-line') return { glyph: 'circle-off', text: `Off in ${tools}, so its ${words.copy} there was removed when sync reached ${event.losers.length === 1 ? 'it' : 'them'}. ${keeps}` };
      return { glyph: 'circle-off', text: `Turned off${also(': removed from')}.${gaveSaid} ${keeps}` };
    case 'current': {
      // The version as it was first kept says where the content came from; the entry that made it current again doesn't.
      const made = item?.versions.findLast(version => version.hash === event.version), when = made && item && versionClock(item, made);
      if (undid) return { glyph: 'undo-2', text: `Undone: ${when ? `the version from ${when}` : 'the version before'} is current again${also(', in')}.` };
      return { glyph: 'undo-2', text: `${made ? `T${theVersion(made.from).slice(1)} (${when})` : 'An earlier version'} was made current${also(', in')}.` };
    }
    case 'deleted': {
      // One with a `winner` is from before the library (a deletion sync spread from a tool): the general sentence says it.
      if (event.winner) return undefined;
      // Its copies a pass no click asked removed afterwards, where they were left (a tool managed again).
      if (event.cause === 'in-line') return { glyph: 'trash-2', text: `Deleted from Central Knot, so its ${words.copy} in ${tools} was removed when sync reached ${event.losers.length === 1 ? 'it' : 'them'}. History can restore it.` };
      // The Undo of taking a found item in: out of Central Knot again, each tool it was found in keeping its own copy.
      if (gave.length) return { glyph: 'undo-2', text: `Undone: taken out of Central Knot again${also(' and removed from')}; ${andList(gave)} ${gave.length === 1 ? 'keeps its own copy' : 'keep their own copies'}, as before. History keeps it.` };
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
      if (event.cause === 'source') return { glyph: 'link-2', text: `Updated from ${source}; that became the current version${tools ? `, in ${tools}` : ''}.` };
      return { glyph: 'pencil-line', text: `Edited in ${from}; that became the current version${tools ? `, in ${tools} too` : ''}.` };
    case 'switched': {
      // Clear the switch's Undo turns the tool's switch off again (`cause` 'switch'); any other that turned a switch off is
      // from before the library (Disable): the general sentence says it.
      const again = event.cause === 'switch' && event.switched?.every(entry => entry.disabled) ? event.switched.map(entry => toolName(entry.tool)) : [];
      if (again.length) return { glyph: 'undo-2', text: `Undone: ${andList(again)}’s own switch has it off again.` };
      const cleared = event.switched?.filter(entry => !entry.disabled).map(entry => toolName(entry.tool)) ?? [];
      if (event.switched?.some(entry => entry.disabled) || !cleared.length) return undefined;
      return { glyph: 'circle-check', text: `${andList(cleared)}’s own switch for it was cleared: ${cleared.length > 1 ? 'they load' : `${cleared[0]} loads`} it again.` };
    }
    case 'took-over': {
      // One with `tookOver` is from before the library (Replace with managed copies): the general sentence says it.
      if (event.tookOver) return undefined;
      const [copy] = event.losers;
      if (!copy) return undefined;
      const what = copy.linkTo !== undefined ? `the link in ${toolName(copy.tool)}’s skills folder (to ${copy.linkTo})` : `the copy at ${copy.path}`;
      return { glyph: 'arrow-right-left', text: `Took over ${what}: ${toolName(copy.tool)} has Central Knot’s copy now, and what that copy held is a version. This has no Undo.` };
    }
    case 'kept-edit': {
      // One with a `winner` is from before the library (an edit kept over a deletion): the general sentence says it.
      if (event.winner) return undefined;
      const where = andList([...new Set(event.losers.map(loser => toolName(loser.tool)))]);
      if (event.cause === 'tool-back') return { glyph: 'diff', text: `${where}’s copy changed while Central Knot didn’t manage ${where}; it gave way to the current version and is kept as a version.` };
      if (event.cause === 'own-copy') return { glyph: 'diff', text: `${where} had a copy of its own, which Central Knot hadn’t put there; it gave way to the current version and is kept as a version.` };
      if (event.cause === 'source') return { glyph: 'link-2', text: `${source} changed it too, but the current version is later, so the source’s is kept as a version.` };
      return { glyph: 'diff', text: `Edited in ${where}, not taken in yet, and written over by the current version: the edit is kept as a version.` };
    }
    case 'conflict': {
      const gaveWay = event.losers.filter(loser => loser.hash !== event.previous && loser.hash !== event.winner?.hash);
      const others = andList([...new Set(gaveWay.map(loser => toolName(loser.tool)))]);
      // "The latest" only where times proved it (types.ts HistoryEvent orderProved); an entry stored before the library may say so too.
      const chosen = event.orderProved ? `${from}’s edit was the latest, so it became the current version` : `${from}’s edit became the current version, though ${noTimeTells}`;
      return { glyph: 'diff', text: `${chosen}. ${others}’s is kept as a version.` };
    }
    case 'chosen': {
      const gave = [...new Set(event.losers.map(loser => toolName(loser.tool)))];
      return { glyph: 'check', text: `You chose ${from}’s copy; ${andList(gave)}’s ${gave.length === 1 ? 'is kept as a version' : 'are kept as versions'}.` };
    }
    default: return undefined;
  }
}

/** What an entry's row shows in place of its action once that action was used (a found item taken in: its Undo). */
export function doneWords(event: HistoryEvent): string {
  if (tookIn(event)) return 'Undone';
  if (event.kind === 'kept-edit' && event.cause === 'source') return 'Made current';
  return event.kind === 'off' ? 'Turned on since' : event.kind === 'on' ? 'Turned off since' : event.kind === 'deleted' ? 'Restored' : 'Undone';
}

/** A found item taken in, by a click on Add (`found`, or `chosen` among copies that differed) or by Synchronize everything. */
const tookIn = (event: HistoryEvent) => event.kind === 'chosen' || (event.kind === 'on' && (event.cause === 'found' || event.cause === 'sync-everything'));

/**
 * Whether an entry is a skill's tool switch cleared by the person (skills.ts clearSwitch), whose Undo sets it again: read here
 * (libraryAction) and by skills.ts restoreSkill, which runs that Undo. Not its Undo's own entry (`cause` 'switch').
 */
export const isClearedSwitch = (event: HistoryEvent) =>
  event.kind === 'switched' && event.cause !== 'switch' && !!event.switched?.length && event.switched.every(entry => !entry.disabled);

/** An entry's action: the button's words, what it does (said before the click), and the click it sends. */
export interface EntryAction { label: string; help: string; change: Change }
/** Whether a content is a version of the item that could be made current: one it has, other than the current one. */
const isVersion = (item: LibraryItem, hash: string | undefined): hash is string =>
  !!hash && hash !== item.hash && item.versions.some(version => version.hash === hash);

/**
 * The action `event` offers for the item `item` now, if any (the table at the top). `version`: one of versionChoices
 * instead of the entry's own action ("Use Codex’s"). `loads`: a skill row's own switches now, so Clear the switch's Undo
 * is not offered once each tool has it off again.
 */
export function libraryAction(event: HistoryEvent, item: LibraryItem | undefined, itemNow: ItemNow, version?: string, loads?: LibraryFacts['loads']): EntryAction | undefined {
  if (!item || event.undoneBy) return undefined;
  // A pass no click asked brought tools into line: nothing was asked, so nothing is undone here (a deleted item's Restore is
  // its Delete's entry's).
  if (event.cause === 'in-line') return undefined;
  const name = item.name, now = asItIs(item.key, item), everywhere = item.on ? ', in every tool it is on in' : '';
  if (event.kind === 'deleted') {
    const help = `Put ${name} back in Central Knot as it was${item.on ? ', and in every tool it was on in' : ''}`;
    return item.deleted ? { label: 'Restore', help, change: { ...now, deleted: false } } : undefined;
  }
  if (item.deleted) return undefined;
  if (version) {
    const offered = versionChoices(event, item).some(choice => choice.hash === version);
    return offered ? { label: 'Use it', help: `Make that copy’s version of ${name} the current one${everywhere}`, change: { ...now, version } } : undefined;
  }
  // Clear the switch (a skill's): its Undo turns that tool's own switch off again (skills.ts restoreSkill does it, not a Change).
  // Offered while one of those tools still loads it (`loads`, the row's: each tool's own switch now; unknown, it is offered).
  const stillCleared = !loads || event.switched?.some(entry => !loads[entry.tool]?.off);
  if (isClearedSwitch(event) && stillCleared) return { label: 'Undo', help: `Turn ${name} off again in ${andList(event.switched!.map(entry => toolName(entry.tool)))}’s own settings`, change: now };
  // A found item taken in (by a click on Add, or by Synchronize everything), while it is still as that left it: its Undo takes it
  // out again (found once more, a tombstone the rule leaves for good), each tool it was found in keeping its own copy.
  // Once it is not (takeInHeld), an `on` one offers a plain Turn off, which gives no copy back, and a `chosen` one nothing.
  if (tookIn(event)) {
    const held = takeInHeld(event, item, itemNow);
    if (!held) return { label: 'Undo', help: `Take ${name} out of Central Knot again: the copies it put in tools go, and each tool it was found in keeps its own`, change: { ...now, deleted: true, ...givenBack(event, item) } };
    return held !== 'claude-code' && event.kind === 'on' ? switchAction(false, undefined, item) : undefined;
  }
  // A source's version kept, the current one being later: made current on a click.
  if (event.kind === 'kept-edit' && event.cause === 'source') {
    return isVersion(item, event.version) ? { label: 'Use it', help: `Make the source’s version of ${name} the current one${everywhere}`, change: { ...now, version: event.version } } : undefined;
  }
  if (event.kind === 'off' || event.kind === 'on') {
    const action = switchAction(event.kind === 'off', event.only, item), back = givenBack(event, item).giveBack;
    // Copies go back only with an Undo, while the item is as the click left it; a plain Turn off or Turn on gives none back.
    if (!action || !back || !asTheClickLeftIt(event, item) || givesBackLater(event, back)) return action;
    const tools = (Object.keys(back) as HarnessId[]).map(toolName);
    const own = `${andList(tools)} ${tools.length === 1 ? 'has its own copy' : 'have their own copies'} back, as before`;
    return { label: 'Undo', help: `${action.help}; ${own}`, change: { ...action.change, giveBack: back } };
  }
  // Copies an earlier engine added, removed, switched or took over: there is no earlier version to go back to.
  if (['added', 'removed', 'switched', 'took-over'].includes(event.kind) || !isVersion(item, event.previous)) return undefined;
  // Undo while what this entry made is still current; once later changes came, it says what it does instead.
  const latest = (event.version ?? event.winner?.hash) === item.hash;
  return { label: latest ? 'Undo' : 'Go back before this', help: `Make the version from before this change current again${everywhere}`, change: { ...now, version: event.previous } };
}

/**
 * What the managed tools hold of an entry's item now, as a pass reads it (librarypass.ts itemsNow; on the page, the row's facts:
 * entriesNow): the tools Central Knot manages, and the tools whose copy holds a change no pass has taken in yet, an edit or the
 * copy deleted by hand (library.ts pendingChanges). A take-in's Undo is decided on it (takeInHeld), not on the library's record alone.
 */
export interface ItemNow { managed: readonly HarnessId[]; pending: readonly HarnessId[] }
/** An entry's item as History decides its action: the library's record (deleted or not), and what the tools hold of it now. */
export type EntryItem = (entry: HistoryEvent) => { item: LibraryItem | undefined; now: ItemNow };

/** The page's EntryItem: each entry's item and its row as the open home's view gives them (types.ts HomeView). */
export const entriesNow = (home: Pick<HomeView, 'skills' | 'mcp' | 'agents' | 'sync'>): EntryItem => entry => {
  const at = libraryEntry(entry), row = at && home[at.kind].items.find(fact => fact.key === at.key);
  return { item: at && home[at.kind].library[at.key], now: { managed: home.sync.managed, pending: row?.plan ? pendingChanges(row.plan) : [] } };
};

/**
 * Why a found item's take-in (tookIn) no longer offers its own Undo, or undefined while it does (libraryAction's row "a found
 * item taken in"). The one rule: it is taken back only while every place it was found in still holds the copy it held then, in a
 * tool still managed; anything else is left in. In the order asked: the item is deleted from Central Knot or Off since; at another
 * version, or a copy holds an edit not taken in yet or was deleted by hand (`changed`, by the copies now: ItemNow pending); a tool it was found in is not
 * managed now (`left-out`); a tool it took a copy from is kept out (`kept-out`); a place it was found in another way (a link,
 * ~/.agents/skills) holds Central Knot's copy now (`taken-over`); or the Undo would hand Claude Code its own MCP entry back
 * (`claude-code`: givesBackLater). Synchronize everything's one Undo leaves and names each by this (everythingPlan).
 */
export type TakeInHeld = 'deleted' | 'off' | 'changed' | 'left-out' | 'kept-out' | 'taken-over' | 'claude-code';
export function takeInHeld(event: HistoryEvent, item: LibraryItem | undefined, now: ItemNow): TakeInHeld | undefined {
  if (!item || item.deleted) return 'deleted';
  if (!item.on) return 'off';
  if ((event.version ?? event.winner?.hash) !== item.hash || now.pending.length) return 'changed';
  const found = foundIn(event), took = (event.tookFrom ?? []).map(copy => copy.tool);
  if (found.some(tool => !now.managed.includes(tool))) return 'left-out';
  if (took.some(tool => item.except.includes(tool))) return 'kept-out';
  if (found.some(tool => !took.includes(tool) && item.applied[tool] !== undefined)) return 'taken-over';
  return givesBackLater(event, givenBack(event, item).giveBack) ? 'claude-code' : undefined;
}
/** The tools a take-in found the item in (types.ts HistoryEvent foundIn); an entry from before it was recorded: where it was taken from, and its own copies. */
const foundIn = (event: HistoryEvent): HarnessId[] => event.foundIn ?? [...new Set([...(event.winner ? [event.winner.tool] : []), ...(event.tookFrom ?? []).map(copy => copy.tool)])];

/**
 * Whether an Undo would give a copy back to a harness that the kind writes only on a step of the person's own (libraryrow.ts
 * writesWait: Claude Code's MCP settings, written by Write to Claude Code alone). That give-back would wait, and the write
 * after would remove the copy instead, so such an Undo is not offered.
 */
const givesBackLater = (event: HistoryEvent, back: Change['giveBack']) => {
  const kind = libraryEntry(event)?.kind;
  return !!kind && Object.keys(back ?? {}).some(tool => writesWait(kind, tool));
};

/**
 * Whether the item is still as the entry's click left it: at the version it left (types.ts HistoryEvent version, or the
 * `winner` a take-in took), and no tool it took a copy from kept out since (that tool has no copy to give back). An Undo
 * that gives copies back is offered only then.
 */
function asTheClickLeftIt(event: HistoryEvent, item: LibraryItem): boolean {
  const left = event.version ?? event.winner?.hash;
  return !!left && left === item.hash && !(event.tookFrom ?? []).some(copy => item.except.includes(copy.tool));
}

/** The copies an entry's click took over from tools (`tookFrom`), each a version still, for its Undo to give back (types.ts Change giveBack). */
function givenBack(event: HistoryEvent, item: LibraryItem): Pick<Change, 'giveBack'> {
  // The current version counts too: a copy the click counted as the item's because it was the same.
  const back = (event.tookFrom ?? []).filter(copy => item.versions.some(version => version.hash === copy.hash)).map(copy => [copy.tool, copy.hash] as const);
  return back.length ? { giveBack: Object.fromEntries(back) } : {};
}

/** An Off entry's Turn on (`turnOn`), or an On entry's Turn off: for the whole item, or (`only`) for one harness of an item that is On. */
function switchAction(turnOn: boolean, only: HarnessId | undefined, item: LibraryItem): EntryAction | undefined {
  const name = item.name, now = asItIs(item.key, item);
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
  // An On entry offers the copies of a tool's own its click wrote over (each kept as a version), as the others offer theirs.
  if (!item || item.deleted || event.undoneBy || !['conflict', 'chosen', 'kept-edit', 'on'].includes(event.kind)) return [];
  const seen = new Set<string>([event.previous ?? '', event.winner?.hash ?? '']);
  const choices: { tool: HarnessId; hash: string }[] = [];
  const gaveWay = event.kind === 'on' ? event.losers.filter(loser => event.tookFrom?.some(copy => copy.tool === loser.tool)) : event.losers;
  for (const { tool, hash } of gaveWay) {
    if (!isVersion(item, hash) || seen.has(hash)) continue;
    seen.add(hash);
    choices.push({ tool, hash });
  }
  return choices;
}

// ---------- Synchronize everything's own entries (everything.ts) ----------

/** One take-in a switch-on's Undo leaves in, by name, with why (TakeInHeld); `chosen`: a copy chosen meanwhile, with its own Undo. */
export type LeftIn = { item: string; why: TakeInHeld | 'chosen' };

/** What the one Undo of a switch-on covers, as every place that promises it says it (the question, Yes's band, Settings, History). */
export const oneUndoCovers = (fromClaude = true) => `One Undo in History takes back what it takes in; a copy you choose has its own Undo${fromClaude ? ', and an MCP server found in Claude Code has none (its entry says why)' : ''}.`;

/**
 * What a switch-on entry's one Undo would do now, read from History (`history`, oldest first): the rule's take-ins after it (cause
 * `sync-everything`) up to the next switch (a Synchronize everything entry that is no Undo), and the copies chosen meanwhile.
 * Each take-in whose own Undo is offered (takeInHeld) is taken back (`takeBack`); each other is left in, named with why (`left`),
 * as is each copy chosen (its `chosen` entry has its own Undo, or is named by why it hasn't); one undone by itself already is
 * neither. `switchOff`: no switch came after it, so the rule is on as it set it and the Undo switches it off. `keptIn`: the tools a
 * take-in taken back wrote that are not managed now, which keep Central Knot's copy until they are.
 */
export function everythingPlan(switchOn: HistoryEvent, history: HistoryEvent[], about: EntryItem) {
  const after = history.slice(history.findIndex(entry => entry.id === switchOn.id) + 1);
  const end = after.findIndex(entry => entry.kind === 'everything' && !entry.everything?.undo);
  const since = (end < 0 ? after : after.slice(0, end)).filter(entry => !entry.undoneBy && libraryEntry(entry));
  const held = (entry: HistoryEvent) => takeInHeld(entry, about(entry).item, about(entry).now);
  const takeIns = since.filter(entry => entry.kind === 'on' && entry.cause === 'sync-everything');
  const takeBack = takeIns.filter(entry => !held(entry));
  const left: LeftIn[] = [...takeIns.flatMap(entry => { const why = held(entry); return why ? [{ item: entry.item, why }] : []; }),
    ...since.filter(entry => entry.kind === 'chosen').map((entry): LeftIn => ({ item: entry.item, why: held(entry) ?? 'chosen' }))];
  const managed = about(switchOn).now.managed, wrote = takeBack.flatMap(entry => entry.losers.map(copy => copy.tool));
  return { takeBack, left, switchOff: end < 0, keptIn: [...new Set(wrote)].filter(tool => !managed.includes(tool)) };
}

/**
 * What the Restore of a switch-on's Undo (`undo`) puts back: each item it took back (`undo.itemUndos`, the entries their own
 * Undos made) whose own Restore is offered and that no click or edit after the Undo's entry is about (`back`); the others were
 * added, changed or deleted since, and are passed over (`passed`, by name). A pass's `in-line` entry (a copy removed from a tool
 * managed again) is no change to the item. `switchOn`: the Undo switched the rule off and no switch came after it, so the Restore
 * switches it on again; a switch in Settings since is left as it is.
 */
export function restorePlan(undo: HistoryEvent, history: HistoryEvent[], about: EntryItem) {
  const after = history.slice(history.findIndex(entry => entry.id === undo.id) + 1);
  const itemUndos = history.filter(entry => undo.everything?.undo?.itemUndos.includes(entry.id));
  const back = itemUndos.filter(entry => !after.some(later => later.key === entry.key && later.cause !== 'in-line') && libraryAction(entry, about(entry).item, about(entry).now)?.label === 'Restore');
  const switchOn = !!undo.everything?.undo?.switchedOff && !after.some(later => later.kind === 'everything' && !later.everything?.undo);
  return { back, passed: itemUndos.filter(entry => !back.includes(entry)).map(entry => entry.item), switchOn };
}

/** Why take-ins were left in, after their names, for one of them and for several: "notes (changed since)". */
const leftWords: Record<LeftIn['why'], [string, string]> = {
  deleted: ['deleted from Central Knot since', 'deleted from Central Knot since'], off: ['turned off since', 'turned off since'],
  changed: ['changed since', 'changed since'], 'left-out': ['a tool it was found in is left out', 'a tool they were found in is left out'],
  'kept-out': ['kept out of a tool since', 'kept out of a tool since'],
  'taken-over': ['a copy it was found in taken over since', 'copies they were found in taken over since'],
  'claude-code': ['found in Claude Code: no Undo', 'found in Claude Code: no Undo'],
  chosen: ['you chose its copy: it has its own Undo', 'you chose their copies: each has its own Undo'],
};
/** The items left in, by reason, each reason once: "deploy and review (you chose their copies: each has its own Undo)". */
const leftSaid = (left: LeftIn[]) => andList([...new Set(left.map(entry => entry.why))].map(why => {
  const names = left.filter(entry => entry.why === why).map(entry => entry.item);
  return `${andList(names)} (${leftWords[why][names.length === 1 ? 0 : 1]})`;
}));
const itemsSaid = (count: number) => `${count} ${count === 1 ? 'item' : 'items'}`;
/** Tools not managed now that a take-in taken back wrote: "Codex isn’t managed now, so it keeps Central Knot’s copy until it is". */
const keptSaid = (tools: HarnessId[]) => (tools.length === 1 ? `${toolName(tools[0])} isn’t managed now, so it keeps Central Knot’s copy until it is`
  : `${andList(tools.map(toolName))} aren’t managed now, so they keep Central Knot’s copies until they are`);

/** What a Synchronize everything entry says: switched on, switched off, or a switch-on's Undo and what it did. */
export function everythingSentence(event: HistoryEvent): { glyph: IconName; text: string } {
  const { ruleOn, undo } = event.everything ?? { ruleOn: false };
  if (!undo) return ruleOn ? { glyph: 'refresh-cw', text: `Switched on: a skill, MCP server or agent that turns up in a tool is taken into Central Knot by itself. ${oneUndoCovers().replace(/^One Undo in History/, 'Its Undo')}` }
    : { glyph: 'circle-minus', text: 'Switched off: what turns up in a tool waits on its page for Add.' };
  const count = undo.itemUndos.length;
  const out = count ? `${itemsSaid(count)} it took in ${count === 1 ? 'is' : 'are'} out of Central Knot again, each tool it was found in keeping its own copy` : 'nothing it took in was taken back';
  return { glyph: 'undo-2', text: `Undone: ${undo.switchedOff ? `switched off${count ? ', and ' : '; '}` : ''}${out}.${undo.left.length ? ` Left in: ${leftSaid(undo.left)}.` : ''}${undo.keptIn.length ? ` ${keptSaid(undo.keptIn)}.` : ''}` };
}

/**
 * What a Synchronize everything entry's action did, as its band says it (app.ts sayEverything): `past` is the entry clicked, a
 * switch-on (its Undo ran: the Undo's entry, `made[0]`, says what it did) or an Undo's entry (its Restore ran: `restored` items
 * came back).
 */
export function everythingDone(past: HistoryEvent, made: (HistoryEvent | undefined)[], restored: number, switchedOn: boolean): string {
  const undo = past.everything?.undo;
  if (!undo) return made[0] ? everythingSentence(made[0]).text : 'Undone.';
  return `${switchedOn ? 'Synchronize everything is on again. ' : ''}Restored ${itemsSaid(restored)}; the switch-on’s Undo takes ${restored === 1 ? 'it' : 'them'} back.`;
}

/**
 * What a Synchronize everything entry offers now: a switch-on its one Undo, while that would do something (switch the rule off,
 * or take something back); a switch-on's Undo its Restore, while it can put an item back (restorePlan). None once used, and none
 * for a plain switch-off (the Settings row is the way back).
 */
export function everythingAction(event: HistoryEvent, history: HistoryEvent[], about: EntryItem): { label: 'Undo' | 'Restore'; help: string } | undefined {
  const switched = event.everything;
  if (event.undoneBy || !switched || (!switched.ruleOn && !switched.undo)) return undefined;
  if (switched.undo) {
    const { back, passed, switchOn } = restorePlan(event, history, about);
    if (!back.length) return undefined;
    const skipped = passed.length ? `; ${andList(passed)} ${passed.length === 1 ? 'was' : 'were'} added, changed or deleted since, and ${passed.length === 1 ? 'stays' : 'stay'} as ${passed.length === 1 ? 'it is' : 'they are'}` : '';
    return { label: 'Restore', help: `${switchOn ? 'Switch Synchronize everything on again and put' : 'Put'} back the ${itemsSaid(back.length)} this took out of Central Knot, which the switch-on’s Undo then takes back again${skipped}` };
  }
  const { takeBack, left, switchOff, keptIn } = everythingPlan(event, history, about);
  if (!switchOff && !takeBack.length) return undefined;
  const takes = takeBack.length ? `take back the ${itemsSaid(takeBack.length)} it took in since, each tool it was found in keeping its own copy` : '';
  const help = sentence([switchOff ? 'switch Synchronize everything off' : '', takes].filter(Boolean).join(' and '));
  return { label: 'Undo', help: `${help}${left.length ? `; ${leftSaid(left)} stay${left.length === 1 ? 's' : ''}` : ''}${keptIn.length ? `; ${keptSaid(keptIn)}` : ''}` };
}
