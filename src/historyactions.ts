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
//   off: the switch, a copy deleted by       Turn it on             the item is Off
//     hand (`winner`: where), or a source
//     (`source`: brought in, Off;
//     `source-dropped`: no longer there)
//   on, off or deleted by a pass no click    none: nothing was asked (a deleted item's Restore is its Delete's
//     asked (`in-line`), copies written      entry's; what an `on` wrote over is kept among the item's versions)
//     over or removed
//   off in one harness (`only`)              Turn it on in          the item is On and kept out of that harness
//                                            <harness>
//   on: the switch, or an item Pull          Turn it off            the item is On
//     brought
//   on in one harness (`only`): the switch,  Turn it off in         the item is On and in that harness
//     or a copy a pass no click asked put    <harness>
//     there (`in-line`)
//   on or off in one harness (`only`) while  none: its switch there would change nothing now (the entry says that
//     that harness is not managed            harness isn't managed now)
//   kept out of or back in several harnesses Undo: the keep-outs    the item is On and kept out of exactly those
//     at once while On (`exceptOnly`)        before it back         it left (sameTools)
//   on or off whose click took tools' own    Undo: that action,     still as the click left it (copies: asTheClickLeftIt;
//     copies over (`tookFrom`) or changed    earlier keep-outs      keep-outs: sameTools); after that, the plain action
//     keep-outs with `on` (`wasExcept`)      and copies back        above, which leaves keep-outs and copies as they are
//   a found item taken in (on, `found`, or   Undo: out of Central   every place it was found in still holds the copy it
//     `sync-everything` with no click;       Knot again, found      held then, in a tool still managed, as the copies
//     chosen)                                again, each tool it    are now (takeInHeld); after that, an `on` one
//                                            was found in keeping   offers a plain Turn it off, a `chosen` one nothing
//                                            its own copy
//   deleted                                  Restore                the item is deleted
//   a content change: edit, conflict,        Undo; once later       the version from before it (`previous`) is not the
//     current, and any entry from before     changes came, "Make    current one
//     the library that names `previous`      the version before
//                                            this current"; a
//                                            Replace's, a Merge's
//                                            or their Undo's
//                                            (`seen`) puts back the
//                                            source's version the
//                                            item had taken
//   Keep mine (edit, `source-kept`), at the  Undo: only `seen`      the item is linked to a source the home records
//     version it kept (previous = version)   goes back              (ItemNow linked), at that version; an entry for an
//                                                                   Undo that moved only `seen` (current, previous =
//                                                                   version) offers nothing, at any version
//   conflict, chosen, kept-edit (an edit     Use <harness>’s        that copy's version is not the current one
//     not taken in that was written over,
//     a copy a tool managed again held, or
//     a copy of a tool's own: `own-copy`),
//     and on (a tool's own copy the click
//     wrote over): copies that gave way
//   switched: a skill's tool switch          Undo: sets that        some tool still loads it (`loads`)
//     cleared (isClearedSwitch)              switch again
//   a plugin's item let go (edit, `own-now`) none: no version changed, and the item is the person's own
//   a plugin's version taken over his        Undo: his version      it carries a link, at the version the take made;
//     (edit, `plugin-taken`: library.ts      current, his own, On   after that, "Go back before this", while it carries
//     TAKE)                                  or Off and kept out    a link or his version is not the current one
//                                            as before (`took`)
//   that Undo (current, `plugin-taken`)      none: the plugin's page offers Use the plugin's again
//
// Synchronize everything's own entries (a switch on or off, and the one Undo of a switch-on: everything.ts, whose header has
// their table) are worded and decided at the end of this file: everythingPlan reads what that Undo takes back from History,
// each take-in by its own Undo above (takeInHeld says why one is not offered). After them, Settings' added lines (stillAdded)
// and their own Undo of what the rule added, with its Restore (undoesAddition, restoresAddition, undoneAddedWords).
// One entry is not here: a Pull that changed only Claude Code's own settings of an agent (`settingsFile`) keeps its own Undo
// (gitrepo.ts undoSettingsChange), since no version tells such a change apart. A copy taken over (skills.ts takeOver,
// `took-over`) has no action.
// To add an entry or an action: its kind (or its `cause`) in types.ts HistoryEvent, its sentence in librarySentence, its row
// in libraryAction, the entry librarypass.ts logItem makes for it, and its case in historypage.ts describe.
import type { IconName } from './icons.ts';
import { itemKey, pendingChanges, theVersion, type LibraryItem } from './library.ts';
import { linkLabel, pluginOf } from './sourcelink.ts';
import { asItIs, noTimeTells, versionClock, type RowWords } from './libraryrow.ts';
import type { Change, HarnessId, HistoryEvent, HomeView, LibraryFacts, PartKind, TakenInNotice } from './types.ts';
import { andList, byToolOrder, deletedIn, harnessIds, keptOutWords, readsIt, sameTools, sentence, toolName, toolsPhrase, turnIt } from './words.ts';

/**
 * Whose a History entry is among the library's kinds, by the page's name for the kind (app.ts PageKind), with the item's key.
 * No library item's: a profile's, a tool's Manage switch's and Synchronize everything's entries (by their kind), a Pull's
 * change to the base instructions (`base`) or to an agent's Claude Code settings alone (`settingsFile`), both gitrepo.ts's.
 * Of the rest, an agent's is keyed `agent:<key>`; an MCP server's `mcp:<key>` (before the library, `mcp:<name>` as written,
 * whose key is share.ts itemKey of it); and a skill's by its key alone, whatever characters its folder's name holds. A skill's
 * key is its folder's name, which may itself start `agent:` or `mcp:`, so the key alone can't say whose an entry is: an entry
 * says its kind (`of`), and one from before that is read by its key's start, as it always was.
 */
export function libraryEntry(event: HistoryEvent): { kind: 'agents' | 'skills' | 'mcp'; key: string } | undefined {
  const of = event.settingsFile ? undefined : entryKind(event);
  if (!of) return undefined;
  if (of === 'agent') return { kind: 'agents', key: event.key.slice('agent:'.length) };
  if (of === 'mcp') return { kind: 'mcp', key: itemKey(event.key.slice('mcp:'.length)) };
  return { kind: 'skills', key: event.key };
}
/**
 * The kind of item an entry is about: the one it records (`of`), or an older entry's, by its key's start; none for an entry about
 * no item (a profile's, a tool's Manage switch's, Synchronize everything's, the base instructions'). An agent's Claude Code
 * settings change, from a Pull, is about the agent, though it has no library action (libraryEntry).
 */
export const entryKind = (event: HistoryEvent): PartKind | undefined => (!event.key || event.base || ['profile', 'managing', 'everything'].includes(event.kind) ? undefined
  : event.of ?? (event.key.startsWith('agent:') ? 'agent' : event.key.startsWith('mcp:') ? 'mcp' : 'skill'));

/** Restore over an agent of the same name made since: what becomes of it, for Restore's result and its tooltip. */
export function keptOver(name: string, tools: readonly string[]): string {
  const where = andList(tools.map(toolName));
  return tools.length === 1 ? `Your newer ${name} from ${where} is kept as a version.` : `Your newer copies of ${name} in ${where} are kept as versions.`;
}

/** Optional row-display overrides for librarySentence (historypage.ts): a custom tool-list formatter, shorter wording, and version-choice controls already shown on the row. */
export interface SentenceOptions { tools?: (touched: string[], inHome: string[]) => string; row?: boolean; choices?: boolean }

/**
 * What a library item's entry says happened, in its kind's words (libraryrow.ts RowWords), or undefined for a kind from before
 * the library whose general sentence still holds (historypage.ts describe). `homeTools`: the home's harnesses, so "all 3
 * tools" can be said, and an entry about one harness no longer among them says it isn't managed now. `item`: the item now, to name a version. `undid`: the entry is another's Undo (that one's `undoneBy`
 * names it), so it reads as one. `options`: History's row view omits redundant fillers and folds long tool lists; announcements keep the plain sentence.
 */
export function librarySentence(
  event: HistoryEvent, words: RowWords, homeTools: string[], item?: LibraryItem, undid = false, options?: SentenceOptions,
): { glyph: IconName; text: string } | undefined {
  const formatTools = options?.tools ?? toolsPhrase;
  // Lazy: skips formatting raw event.losers (and pushing an unused fold group on 3+ losers) in branches like conflict that format a filtered list.
  let losersText: string | undefined;
  const tools = () => losersText ??= formatTools(event.losers.map(loser => loser.tool), homeTools);
  /** " and removed from Codex", or nothing when no harness was touched. */
  const also = (words: string) => (tools() ? `${words} ${tools()}` : '');
  const where = event.only ? toolName(event.only) : '', from = event.winner ? toolName(event.winner.tool) : '';
  const away = event.only && !homeTools.includes(event.only) ? ` ${where} isn’t managed now.` : '';
  // What made it happen is the entry's `cause` alone (types.ts HistoryEvent); none is the person's own switch or click.
  const pulled = event.cause === 'pulled', keeps = options?.row ? '' : ' Central Knot keeps it.', historyKeeps = options?.row ? '' : ' History keeps it.';
  const source = event.link ? linkLabel(event.link) : 'Its source', plugin = event.link && pluginOf(event.link);
  // An Undo that gave tools their own copies back instead of removing what was there (types.ts HistoryEvent gaveBack).
  const gave = (event.gaveBack ?? []).map(toolName);
  const gaveSaid = gave.length ? ` ${andList(gave)} ${gave.length === 1 ? 'has its own copy' : 'have their own copies'} back, as before.` : '';
  /** Whether the entry names this harness as written or removed (a write or removal held is not: librarypass.ts untell). */
  const named = (tool: HarnessId) => event.losers.some(loser => loser.tool === tool);
  // A click that wrote over a copy a tool had of its own (tookFrom, and written: in `losers`), which is kept as a version.
  const over = (event.tookFrom ?? []).filter(copy => named(copy.tool)).map(copy => toolName(copy.tool));
  const overSaid = over.length ? ` ${andList(over)}’s own ${over.length === 1 ? 'copy was' : 'copies were'} written over and kept as a version.` : '';
  // Several harnesses' keep-outs changed at once while it stayed On (a profile switch's Undo): each named.
  if (event.exceptOnly && event.wasExcept && event.nowExcept) {
    return { glyph: event.kind === 'off' ? 'circle-off' : 'circle-check', text: `${keptOutWords(event.wasExcept, event.nowExcept, 'Kept out of')}.` };
  }
  switch (event.kind) {
    case 'on': {
      // A pass no click asked put a copy in one tool that had none (`only`: a tool that came under management, say), or wrote
      // the current version over copies there (a tool managed again, a folder writable again).
      if (event.cause === 'in-line' && event.only) return { glyph: 'circle-check', text: `Copied to ${where}.${away}` };
      if (event.cause === 'in-line') return { glyph: 'circle-check', text: `Written over in ${tools()} with the current version when sync reached ${event.losers.length === 1 ? 'it' : 'them'}; what was there is one of its versions.` };
      if (event.only) return { glyph: 'circle-check', text: `Turned on in ${where}${named(event.only) && !over.length ? `: its ${words.copy} there is back` : ''}.${overSaid}${gaveSaid}${away}` };
      const reads = event.alsoRead?.length ? `${readsIt(event.alsoRead)} too` : '';
      const onlyIn = event.cause === 'switch' && event.nowExcept ? harnessIds.filter(tool => !event.nowExcept!.includes(tool)) : [];
      if (onlyIn.length === 1) {
        const rest = reads ? `${reads}; kept out of the rest` : 'kept out of every other tool';
        return { glyph: 'circle-check', text: `Turned on in ${toolName(onlyIn[0]!)}; ${rest}.${overSaid}${gaveSaid}` };
      }
      // A plugin's read brought it in with the plugin's On (library.ts A PLUGIN).
      if (event.cause === 'source') return { glyph: 'link-2', text: `Brought in from ${source}${also(': put in')}.` };
      const said = {
        switch: { glyph: 'circle-check', text: `Turned on${also(': put in')}${reads ? `; ${reads}` : ''}.` },
        found: { glyph: 'plus', text: `Found in ${from} and taken into Central Knot${also('; put in')}.` },
        'sync-everything': { glyph: 'plus', text: `Found in ${from} and taken into Central Knot by Synchronize everything${also('; put in')}.` },
        pulled: { glyph: 'git-branch', text: `Pulled from the Git repo into Central Knot${also('; put in')}.` },
      } as const;
      const { glyph, text } = said[event.cause === 'found' || event.cause === 'sync-everything' || event.cause === 'pulled' ? event.cause : 'switch'];
      return { glyph, text: `${text}${overSaid}${gaveSaid}` };
    }
    case 'off':
      if (event.only && event.gaveBack?.includes(event.only)) return { glyph: 'circle-off', text: `Kept out of ${where}: ${where} has its own copy back, as before.${keeps}${away}` };
      if (event.only) return { glyph: 'circle-off', text: `Kept out of ${where}${named(event.only) ? ': its copy there was removed' : ''}.${keeps}${gaveSaid}${away}` };
      if (event.cause === 'deleted-by-hand') {
        const place = deletedIn(event.winner?.tool ?? '', event.sharedWay);
        return { glyph: 'trash-2', text: `Its copy was deleted in ${place}, so it was turned off${also(' and removed from')}.${keeps}` };
      }
      if (event.cause === 'source') return { glyph: 'link-2', text: `Brought in from ${source}: in Central Knot, Off${options?.row ? '' : ', until you turn it on'}.` };
      if (event.cause === 'source-dropped' && plugin) return { glyph: 'link-2-off', text: `The plugin ${plugin} no longer has it, so it is off${also(' and removed from')}, and no longer follows it.${keeps}` };
      if (event.cause === 'source-dropped') return { glyph: 'link-2-off', text: `${source} no longer has it, so it is off${also(' and removed from')}, and no longer from that source.${keeps}` };
      // A pass no click asked took its copies out where it is off (or kept out): a tool managed again, a folder writable again.
      if (event.cause === 'in-line') return { glyph: 'circle-off', text: `Off in ${tools()}, so its ${words.copy} there was removed when sync reached ${event.losers.length === 1 ? 'it' : 'them'}.${keeps}` };
      return { glyph: 'circle-off', text: `Turned off${also(': removed from')}.${gaveSaid}${keeps}` };
    case 'current': {
      // The version as it was first kept says where the content came from; the entry that made it current again doesn't.
      const made = item?.versions.findLast(version => version.hash === event.version), when = made && item && versionClock(item, made);
      // An Undo that moved only `seen` back (Keep mine's, or a Replace's or Merge's at the version already current: librarypass.ts makeCurrent).
      if (event.previous !== undefined && event.previous === event.version) {
        return { glyph: 'undo-2', text: 'Undone: yours stays current; the source’s version is no longer marked as declined or taken, and the source’s row says whether an update waits.' };
      }
      if (event.cause === 'plugin-taken') return { glyph: 'undo-2', text: `Undone: ${event.item} is yours again, as it was in every tool.` };
      if (undid) return { glyph: 'undo-2', text: `Undone: ${when ? `the version from ${when}` : 'the version before'} is current again${also(', in')}.` };
      return { glyph: 'undo-2', text: `${made ? `T${theVersion(made.from).slice(1)} (${when})` : 'An earlier version'} was made current${also(', in')}.` };
    }
    case 'deleted': {
      // One with a `winner` is from before the library (a deletion sync spread from a tool): the general sentence says it.
      if (event.winner) return undefined;
      // Its copies a pass no click asked removed afterwards, where they were left (a tool managed again).
      if (event.cause === 'in-line') return { glyph: 'trash-2', text: `Deleted from Central Knot, so its ${words.copy} in ${tools()} was removed when sync reached ${event.losers.length === 1 ? 'it' : 'them'}. History can restore it.` };
      // The Undo of taking a found item in: out of Central Knot again, each tool it was found in keeping its own copy.
      if (gave.length) return { glyph: 'undo-2', text: `Undone: taken out of Central Knot again${also(' and removed from')}; ${andList(gave)} ${gave.length === 1 ? 'keeps its own copy' : 'keep their own copies'}, as before.${historyKeeps}` };
      const how = pulled ? 'Removed in the Git repo, so Pull deleted it' : 'Deleted';
      return { glyph: pulled ? 'git-branch' : 'trash-2', text: `${how} from Central Knot${also(' and removed from')}.${historyKeeps}` };
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
      if (pulled) return { glyph: 'git-branch', text: `Pulled from the Git repo; that became the current version${tools() ? `, in ${tools()}` : ''}.` };
      // A Replace (`seen`): the person took the source's version over the one changed here.
      if (event.cause === 'source' && event.seen !== undefined) return { glyph: 'link-2', text: `Replaced with ${source}’s version; that became the current version${tools() ? `, in ${tools()}` : ''}. The version it replaced is kept.` };
      if (event.cause === 'source') return { glyph: 'link-2', text: `Updated from ${source}; that became the current version${tools() ? `, in ${tools()}` : ''}.` };
      if (event.cause === 'source-merged') return { glyph: 'link-2', text: `Merged ${source}’s version into yours; that became the current version${tools() ? `, in ${tools()}` : ''}. The version it had and the source’s are kept.` };
      // Keep mine, or a Merge whose result was exactly yours: no tool was written.
      if (event.cause === 'source-kept') {
        return { glyph: 'link-2', text: `Yours stays current over ${source}’s version, which no longer waits: it is kept as a version, and the source’s next change is compared with it.` };
      }
      if (event.cause === 'plugin-taken') return { glyph: 'link-2', text: `Use the plugin’s: the plugin ${plugin}’s version became current${tools() ? `, in ${tools()}` : ''};`
        + ' yours is kept as a version, and each other tool with your copy keeps it as its own.' };
      if (event.cause === 'own-now') return { glyph: 'link-2-off', text: `Yours now: it was changed here, so it no longer follows ${source}, which never writes over it. It stays in the tools that had it, and its row lets it into the others. Its versions stay.` };
      return { glyph: 'pencil-line', text: `Edited in ${from}; that became the current version${tools() ? `, in ${tools()} too` : ''}.` };
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
      // The write over it may be held in this pass: the in-line entry names it when it happens.
      return { glyph: 'diff', text: `Edited in ${where}, not taken in yet; it gave way to the current version and is kept as a version.` };
    }
    case 'conflict': {
      const gaveWay = options?.choices ? [] : [...new Set(event.losers.filter(loser => loser.hash !== event.previous && loser.hash !== event.winner?.hash).map(loser => loser.tool))];
      const others = gaveWay.length ? formatTools(gaveWay, homeTools) : '';
      // "The latest" only where times proved it (types.ts HistoryEvent orderProved); an entry stored before the library may say so too.
      const chosen = event.orderProved ? `${from}’s edit was the latest, so it became the current version` : `${from}’s edit became the current version, though ${noTimeTells}`;
      const lost = !gaveWay.length ? '' : gaveWay.length > 2 ? ` Edits from ${others} are kept as versions.` : ` ${others}’s is kept as a version.`;
      return { glyph: 'diff', text: `${chosen}.${lost}` };
    }
    case 'chosen': {
      const gave = options?.choices ? [] : [...new Set(event.losers.map(loser => toolName(loser.tool)))];
      return { glyph: 'check', text: gave.length ? `You chose ${from}’s copy; ${andList(gave)}’s ${gave.length === 1 ? 'is kept as a version' : 'are kept as versions'}.` : `You chose ${from}’s copy.` };
    }
    default: return undefined;
  }
}

/** What an entry's row shows in place of its action once that action was used (a found item taken in: its Undo). */
export function doneWords(event: HistoryEvent): string {
  if (tookIn(event)) return 'Undone';
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
  // its Delete's entry's); but a copy it put in one tool (`only`) can be taken out of that tool, as its switch there would.
  if (event.cause === 'in-line' && !event.only) return undefined;
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
  // An entry about one harness (`only`) offers no action of its own while it isn't managed: its switch there would change
  // nothing in it now. A version choice above writes only to the tools that are, as any does.
  if (event.only && !itemNow.managed.includes(event.only)) return undefined;
  // Clear the switch (a skill's): its Undo turns that tool's own switch off again (skills.ts restoreSkill does it, not a Change).
  // Offered while one of those tools still loads it (`loads`, the row's: each tool's own switch now; unknown, it is offered).
  const stillCleared = !loads || event.switched?.some(entry => !loads[entry.tool]?.switchedOff);
  if (isClearedSwitch(event) && stillCleared) return { label: 'Undo', help: `Turn ${name} off again in ${andList(event.switched!.map(entry => toolName(entry.tool)))}’s own settings`, change: now };
  // A found item taken in (by a click on Add, or by Synchronize everything), while it is still as that left it: its Undo takes it
  // out again (found once more, a tombstone the rule leaves for good), each tool it was found in keeping its own copy.
  // Once it is not (takeInHeld), an `on` one offers a plain Turn it off, which gives no copy back, and a `chosen` one nothing.
  if (tookIn(event)) {
    const held = takeInHeld(event, item, itemNow);
    if (!held) return { label: 'Undo', help: `Take ${name} out of Central Knot again: the copies it put in tools go, and each tool it was found in keeps its own`, change: { ...now, deleted: true, ...givenBack(event, item) } };
    return event.kind === 'on' ? switchAction(false, undefined, item) : undefined;
  }
  if (event.exceptOnly && event.wasExcept && event.nowExcept) {
    const asLeft = item.on && sameTools(item.except, event.nowExcept);
    return asLeft ? { label: 'Undo', help: `Put ${name} back in the tools it was in before this, and out of the others`, change: { ...now, except: [...event.wasExcept] } } : undefined;
  }
  if (event.kind === 'off' || event.kind === 'on') {
    const action = switchAction(event.kind === 'off', event.only, item);
    if (!action) return undefined;
    const exact = !!(event.wasExcept && event.nowExcept && sameTools(item.except, event.nowExcept));
    const back = givenBack(event, item).giveBack;
    // Earlier keep-outs and copies go back only with an exact Undo; otherwise the plain Turn it off / on.
    if ((event.wasExcept && !exact) || (back && !asTheClickLeftIt(event, item)) || (!exact && !back)) return action;
    const tools = back ? (Object.keys(back) as HarnessId[]).map(toolName) : [];
    const own = tools.length ? `${andList(tools)} ${tools.length === 1 ? 'has its own copy' : 'have their own copies'} back, as before` : '';
    const kept = exact ? 'with its earlier kept-out tools back' : '';
    return { label: 'Undo', help: [action.help, kept, own].filter(Boolean).join('; '),
      change: { ...action.change, ...(exact ? { except: [...event.wasExcept!] } : {}), ...(back ? { giveBack: back } : {}) } };
  }
  // Keep mine moved only `seen` on: its Undo moves it back (librarypass.ts makeCurrent, asked for the current version), while
  // the item is at the version it kept. The entry that Undo makes (previous = version) offers nothing: Keep mine is on the source's row.
  if (event.cause === 'source-kept') {
    const asLeft = !!itemNow.linked && event.version === item.hash && event.seen !== undefined;
    const help = 'Take back Keep mine: yours stays current, and the source’s version is no longer marked as declined';
    return asLeft ? { label: 'Undo', help, change: { ...now, version: item.hash, seen: event.seen } } : undefined;
  }
  if (event.kind === 'current' && event.previous !== undefined && event.previous === event.version) return undefined;
  // A plugin's item let go as the person's own changed no version: nothing to take back.
  if (event.cause === 'own-now') return undefined;
  if (event.cause === 'plugin-taken') return event.took ? takeBack(event, event.took, item) : undefined;
  // Copies an earlier engine added, removed, switched or took over: there is no earlier version to go back to.
  if (['added', 'removed', 'switched', 'took-over'].includes(event.kind) || !isVersion(item, event.previous)) return undefined;
  // Undo while what this entry made is still current; once later changes came, it says what it does instead.
  const latest = (event.version ?? event.winner?.hash) === item.hash;
  // A Replace's or a Merge's Undo puts back the source's version the item had taken (`seen`), so where it had been changed here, that waits again;
  // the Undo of that Undo puts back the one it replaced, recorded on its own entry.
  const replaced = event.seen !== undefined ? { seen: event.seen } : {};
  return { label: latest ? 'Undo' : 'Go back before this', help: `Make the version from before this change current again${everywhere}`, change: { ...now, version: event.previous, ...replaced } };
}

/**
 * A take's Undo (library.ts TAKE; Change untake): his version current, his own, On or Off and kept out as before it, each tool's
 * own copy the take wrote over given back. Undo while the item is as the take left it; else Go back before this, while there is
 * something to go back to: it still carries a link (`source`, its plugin recorded or not: a tick's Undo takes the record back
 * first), or his version is not the current one.
 */
function takeBack(event: HistoryEvent, took: NonNullable<HistoryEvent['took']>, item: LibraryItem): EntryAction | undefined {
  const latest = !!item.source && event.version === item.hash;
  if (!item.source && !isVersion(item, event.previous)) return undefined;
  const help = `Make your ${item.name} from before this current again and your own, in the tools it was in before; the plugin’s stays a version`;
  const change: Change = { key: item.key, on: took.on, except: [...took.except], version: event.previous, untake: { ...took.copies }, ...givenBack(event, item) };
  return { label: latest ? 'Undo' : 'Go back before this', help, change };
}

/**
 * What the managed tools hold of an entry's item now, as a pass reads it (librarypass.ts itemsNow; on the page, the row's facts:
 * entriesNow): the tools Central Knot manages, and the tools whose copy holds a change no pass has taken in yet, an edit or the
 * copy deleted by hand (library.ts pendingChanges). A take-in's Undo is decided on it (takeInHeld), not on the library's record alone.
 * `linked`: the item is linked to a source the home records (library.ts linkedSource), which Keep mine's Undo needs.
 */
export interface ItemNow { managed: readonly HarnessId[]; pending: readonly HarnessId[]; linked?: true }
/** An entry's item as History decides its action: the library's record (deleted or not), and what the tools hold of it now. */
export type EntryItem = (entry: HistoryEvent) => { item: LibraryItem | undefined; now: ItemNow };

/** The page's EntryItem: each entry's item and its row as the open home's view gives them (types.ts HomeView). */
export const entriesNow = (home: Pick<HomeView, 'skills' | 'mcp' | 'agents' | 'sync'>): EntryItem => entry => {
  const at = libraryEntry(entry), row = at && home[at.kind].items.find(fact => fact.key === at.key);
  const linked = !!row?.fromSource && !row.fromSource.removed ? { linked: true as const } : {};
  return { item: at && home[at.kind].library[at.key], now: { managed: home.sync.managed, pending: row?.plan ? pendingChanges(row.plan) : [], ...linked } };
};

/**
 * Why a found item's take-in (tookIn) no longer offers its own Undo, or undefined while it does (libraryAction's row "a found
 * item taken in"). The one rule: it is taken back only while every place it was found in still holds the copy it held then, in a
 * tool still managed; anything else is left in. In the order asked: the item is deleted from Central Knot or Off since; at another
 * version, or a copy holds an edit not taken in yet or was deleted by hand (`changed`, by the copies now: ItemNow pending); a tool it was found in is not
 * managed now (`left-out`); a tool it took a copy from is kept out (`kept-out`); a place it was found in another way (a link,
 * ~/.agents/skills) holds Central Knot's copy now (`taken-over`). Synchronize everything's one Undo leaves and names each by
 * this (everythingPlan).
 */
export type TakeInHeld = 'deleted' | 'off' | 'changed' | 'left-out' | 'kept-out' | 'taken-over';
export function takeInHeld(event: HistoryEvent, item: LibraryItem | undefined, now: ItemNow): TakeInHeld | undefined {
  if (!item || item.deleted) return 'deleted';
  if (!item.on) return 'off';
  if ((event.version ?? event.winner?.hash) !== item.hash || now.pending.length) return 'changed';
  const found = foundIn(event), took = (event.tookFrom ?? []).map(copy => copy.tool);
  if (found.some(tool => !now.managed.includes(tool))) return 'left-out';
  if (took.some(tool => item.except.includes(tool))) return 'kept-out';
  if (found.some(tool => !took.includes(tool) && item.applied[tool] !== undefined)) return 'taken-over';
  return undefined;
}
/** The tools a take-in found the item in (types.ts HistoryEvent foundIn); an entry from before it was recorded: where it was taken from, and its own copies. */
const foundIn = (event: HistoryEvent): HarnessId[] => event.foundIn ?? [...new Set([...(event.winner ? [event.winner.tool] : []), ...(event.tookFrom ?? []).map(copy => copy.tool)])];



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

/**
 * An Off entry's Turn it on (`turnOn`), or an On entry's Turn it off: the item's own switch, as on its page, for the whole item,
 * or (`only`) for one harness of an item that is On. "It" is the item the row names, so the words say the item's switch is
 * turned, not that History or a source starts or stops anything.
 */
function switchAction(turnOn: boolean, only: HarnessId | undefined, item: LibraryItem): EntryAction | undefined {
  const name = item.name, now = asItIs(item.key, item);
  if (!only) {
    if (item.on === turnOn) return undefined;
    return turnOn ? { label: turnIt(true), help: `Put ${name} back in every tool it is not kept out of, each file as it was`, change: { ...now, on: true } }
      : { label: turnIt(false), help: `Take ${name} out of every tool; Central Knot keeps it`, change: { ...now, on: false } };
  }
  const there = toolName(only), out = item.except.includes(only);
  if (!item.on || out !== turnOn) return undefined;
  return turnOn ? { label: turnIt(true, there), help: `Put ${name} back in ${there}, as it was`, change: { ...now, except: item.except.filter(tool => tool !== only) } }
    : { label: turnIt(false, there), help: `Take ${name} out of ${there}; Central Knot keeps it`, change: { ...now, except: [...item.except, only] } };
}

/** The copies an entry says gave way, each of which is a version that can be made current now: one "Use <harness>’s" each, grouping tools that share a hash in `tools`. */
export function versionChoices(event: HistoryEvent, item: LibraryItem | undefined): { tool: HarnessId; tools: HarnessId[]; hash: string }[] {
  // An On entry offers the copies of a tool's own its click wrote over (each kept as a version), as the others offer theirs.
  if (!item || item.deleted || event.undoneBy || !['conflict', 'chosen', 'kept-edit', 'on'].includes(event.kind)) return [];
  const skip = new Set<string>([event.previous ?? '', event.winner?.hash ?? '']);
  const byHash = new Map<string, { tool: HarnessId; tools: HarnessId[]; hash: string }>();
  const gaveWay = event.kind === 'on' ? event.losers.filter(loser => event.tookFrom?.some(copy => copy.tool === loser.tool)) : event.losers;
  for (const { tool, hash } of gaveWay) {
    if (!isVersion(item, hash) || skip.has(hash)) continue;
    const held = byHash.get(hash);
    if (held) { if (!held.tools.includes(tool)) held.tools.push(tool); continue; }
    byHash.set(hash, { tool, tools: [tool], hash });
  }
  return [...byHash.values()];
}

// ---------- Synchronize everything's own entries (everything.ts) ----------

/**
 * One take-in a switch-on's Undo leaves in, by name, with why (TakeInHeld); `chosen`: a copy chosen meanwhile, with its own Undo.
 * Kept in its History entry. `claude-code` is only read: earlier builds left in an MCP server found in Claude Code, whose
 * settings they wrote only at a click of the person's own.
 */
export type LeftIn = { item: string; why: TakeInHeld | 'chosen' | 'claude-code' };

/**
 * What a switch-on's one Undo covers (everythingPlan): the items it added, but those changed since (takeInHeld: edited, off,
 * deleted, kept or left out, taken over); and, where a copy may be chosen (`chosen`), that a chosen copy has its own Undo. Said,
 * each with its own subject, by first setup's (?) (firstsetup.ts), the band's Undo after a switch-on (app.ts
 * everythingSwitchedOn) and History's entry.
 */
export const oneUndoCovers = (subject: string, chosen = true) => `${subject} takes back the items it added, but for any changed since${chosen ? '; a copy you choose has its own Undo' : ''}.`;

/** A take-in by Synchronize everything's rule, no click behind it. */
const takenByRule = (entry: HistoryEvent) => entry.kind === 'on' && entry.cause === 'sync-everything';
/**
 * What a switch-on entry's one Undo would do now, read from History (`history`, oldest first): the rule's take-ins after it (cause
 * `sync-everything`) up to the next switch (a Synchronize everything entry that is no Undo), and the copies chosen meanwhile.
 * Each take-in whose own Undo is offered (takeInHeld) is taken back (`takeBack`); each other is left in, named with why (`left`),
 * as is each copy chosen (its `chosen` entry has its own Undo, or is named by why it hasn't); one undone by itself already is
 * neither. `switchOff`: no switch came after it, so the rule is on as it set it and the Undo switches it off. `keptIn`: the tools a
 * take-in taken back wrote that are not managed now, which keep Central Knot's copy until they are. `added`: how many take-ins there
 * are, left in or not (what a band says the switch-on added: app.ts everythingSwitchedOn).
 */
export function everythingPlan(switchOn: HistoryEvent, history: HistoryEvent[], about: EntryItem) {
  const after = history.slice(history.findIndex(entry => entry.id === switchOn.id) + 1);
  const end = after.findIndex(entry => entry.kind === 'everything' && !entry.everything?.undo);
  const since = (end < 0 ? after : after.slice(0, end)).filter(entry => !entry.undoneBy && libraryEntry(entry));
  const held = (entry: HistoryEvent) => takeInHeld(entry, about(entry).item, about(entry).now);
  const takeIns = since.filter(takenByRule);
  const takeBack = takeIns.filter(entry => !held(entry));
  const left: LeftIn[] = [...takeIns.flatMap(entry => { const why = held(entry); return why ? [{ item: entry.item, why }] : []; }),
    ...since.filter(entry => entry.kind === 'chosen').map((entry): LeftIn => ({ item: entry.item, why: held(entry) ?? 'chosen' }))];
  const managed = about(switchOn).now.managed, wrote = takeBack.flatMap(entry => entry.losers.map(copy => copy.tool));
  return { added: takeIns.length, takeBack, left, switchOff: end < 0, keptIn: [...new Set(wrote)].filter(tool => !managed.includes(tool)) };
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
  // A later entry is about the same item when it has its kind and its key (a skill may be keyed like an agent's entry: entryKind).
  const sameItem = (later: HistoryEvent, entry: HistoryEvent) => later.key === entry.key && entryKind(later) === entryKind(entry);
  const back = itemUndos.filter(entry => !after.some(later => sameItem(later, entry) && later.cause !== 'in-line') && libraryAction(entry, about(entry).item, about(entry).now)?.label === 'Restore');
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
const keptOwn = (count: number) => (count === 1 ? 'each tool it was found in keeping its own copy' : 'each tool they were found in keeping its own');
/** Why a take-in has no Undo (TakeInHeld), as Settings' added line says it in Undo's place; for a change, what an Undo would cost (`help`). */
export const heldSaid = (why: TakeInHeld) => (why === 'changed'
  ? { tag: 'changed since', help: 'Changed since it was added, so an Undo would lose that change.' } : { tag: leftWords[why][0] });
/** Tools not managed now that a take-in taken back wrote: "Codex isn’t managed now, so it keeps Central Knot’s copy until it is". */
const keptSaid = (tools: HarnessId[]) => (tools.length === 1 ? `${toolName(tools[0])} isn’t managed now, so it keeps Central Knot’s copy until it is`
  : `${andList(tools.map(toolName))} aren’t managed now, so they keep Central Knot’s copies until they are`);

/** What a Synchronize everything entry says: switched on, switched off, or a switch-on's Undo and what it did. */
export function everythingSentence(event: HistoryEvent): { glyph: IconName; text: string } {
  const { ruleOn, undo } = event.everything ?? { ruleOn: false };
  if (!undo) return ruleOn ? { glyph: 'refresh-cw', text: `Switched on: a skill, MCP server or agent that turns up in a tool is taken into Central Knot by itself. ${oneUndoCovers('Its Undo')}` }
    : { glyph: 'circle-minus', text: 'Switched off: what turns up in a tool waits on its page for Add.' };
  const count = undo.itemUndos.length;
  const out = count ? `${itemsSaid(count)} it took in ${count === 1 ? 'is' : 'are'} out of Central Knot again, ${keptOwn(count)}` : 'nothing it took in was taken back';
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
  const takes = takeBack.length ? `take back the ${itemsSaid(takeBack.length)} it took in since, ${keptOwn(takeBack.length)}` : '';
  const help = sentence([switchOff ? 'switch Synchronize everything off' : '', takes].filter(Boolean).join(' and '));
  return { label: 'Undo', help: `${help}${left.length ? `; ${leftSaid(left)} stay${left.length === 1 ? 's' : ''}` : ''}${keptIn.length ? `; ${keptSaid(keptIn)}` : ''}` };
}

// ---------- Settings' added lines, and their own Undo (everything.ts undoAdded) ----------

/**
 * What a taken-in notice names now, as Settings' added line says it: each item no entry has undone since (`named`: its name, key,
 * History entry id, and that entry once History is read; none where History has pruned it, whose name stays), and its words
 * (`words`, for libraryrow.ts takenInParts: those names, where their take-ins found them, what they changed in a tool's settings).
 */
export function stillAdded(notice: TakenInNotice, events: readonly HistoryEvent[] | undefined) {
  const ids = notice.histories?.length ? notice.histories : [notice.history];
  const all = notice.items.map((name, at) => ({ name, key: notice.keys[at], id: ids[at], entry: events?.find(event => event.id === ids[at]) }));
  const named = all.filter(each => !each.entry?.undoneBy);
  if (named.length === all.length) return { named, words: notice };
  const from = [...new Set(named.flatMap(each => (each.entry ? foundIn(each.entry) : notice.from)))].sort(byToolOrder);
  const settingsChanged = named.flatMap(each => each.entry?.settingsChanged ?? []);
  return { named, words: { items: named.map(each => each.name), from, ...(settingsChanged.length ? { settingsChanged } : {}) } };
}

/**
 * Whether an entry's own action now (`change`: libraryAction's on the page, Kind.historyAction's in main) is the Undo of an
 * addition the rule made, which takes it out of Central Knot again (a take-in changed since offers Turn it off instead, which
 * this is not). The one test for an added line's Undo, on Settings and in main (everything.ts undoAdded).
 */
export const undoesAddition = (entry: HistoryEvent, change: Change | undefined) => takenByRule(entry) && change?.deleted === true;
/** Whether an entry is the deletion of a take-in by the rule (any such Undo's, not only one line's) whose own action now is its Restore. */
export const restoresAddition = (entry: HistoryEvent, change: Change | undefined, history: readonly HistoryEvent[]) =>
  entry.kind === 'deleted' && change?.deleted === false && history.some(added => added.undoneBy === entry.id && takenByRule(added));

/** Why an added line's Undo, or its Restore, left an entry as it is: its own action is another now, it was done already, or History no longer has it. */
export type AddedPassed = 'changed' | 'done' | 'gone';
const passedWords = (why: AddedPassed, putBack: boolean) => ({ changed: 'changed since', done: putBack ? 'restored already' : 'undone already', gone: 'no longer in History' })[why];
/**
 * What an added line's Undo did (`putBack` false: what went and what stayed), or its Restore (the items back); then each item it
 * passed over, by why, also when it did nothing.
 */
export function undoneAddedWords(done: readonly string[], passed: readonly { item: string; why: AddedPassed }[], putBack: boolean): string {
  const whys = [...new Set(passed.map(entry => entry.why))].map(why => `${andList(passed.filter(entry => entry.why === why).map(entry => entry.item))} (${passedWords(why, putBack)})`);
  const not = putBack ? 'restored' : 'taken back';
  if (!done.length) return `Nothing was ${not}${whys.length ? `: ${andList(whys)}` : ''}.`;
  const one = done.length === 1;
  const lead = putBack ? `${andList([...done])} ${one ? 'is' : 'are'} back in Central Knot`
    : `${andList([...done])} ${one ? 'is' : 'are'} out of Central Knot again. The copies Central Knot put in other tools are gone; the tools ${one ? 'it was' : 'they were'} found in keep theirs`;
  return `${lead}.${whys.length ? ` Not ${not}: ${andList(whys)}.` : ''}`;
}
