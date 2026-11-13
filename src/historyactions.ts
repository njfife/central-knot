// History's entries about items in Central Knot's library (skills, MCP servers and agents), in one place: whose they are (libraryEntry),
// what each says (librarySentence), what it still offers (libraryAction, versionChoices), and what its row shows once its
// action was used (doneWords). Read by History's page (the row and its buttons), by app.ts (what is said after a click), by
// librarypass.ts restore (the click an action runs, through each kind's Kind.historyAction) and by the tests. Pure: no
// files, no DOM. The entries of profiles and instructions are historypage.ts's own.
//
// Every action is decided from the entry and the item as the library holds it now (library.ts LibraryItem), so it is offered
// exactly while it would change something and is always safe to click. Most are a click the item's page could send as well
// (types.ts Change). Two are not: an Undo that gives tools their own copies back (Change giveBack, which the page never
// sends), and a cleared switch's Undo, which sets that tool's own switch again (skills.ts switchBack, not a Change). An entry
// from before an item was on the library (a skill's Remove, Disable or take-over by the earlier engine; an MCP server's Undo
// write, Undo add or Finish undo) offers only what can still be said as one of these; otherwise it shows as past, with no action.
//
//   entry (HistoryEvent.kind, `cause`)       action                 offered while
//   off: the switch, or a copy deleted       Turn on                the item is Off
//     by hand (`winner`: where)
//   off in a tool managed again              none: no click turned it off
//     (`tool-back`)
//   off in one harness (`only`)              Turn on in <harness>   the item is On and kept out of that harness
//   on: the switch, or an item Pull          Turn off               the item is On
//     brought
//   on in one harness (`only`)               Turn off in <harness>  the item is On and in that harness
//   on or off whose click took tools' own    Undo: that action,     the item is as the click left it (asTheClickLeftIt);
//     copies over (`tookFrom`)               each such copy given   after that, the plain action above, which gives
//                                            back                   nothing back
//   a found item taken in (on, `found`, or   Undo: out of Central   the item is as the click left it, and the place it
//     `sync-everything` with no click;       Knot again, found      was taken from still holds that copy
//     chosen)                                again, each tool it    (sourceReplaced); after that, an `on` one offers
//                                            was found in keeping   Turn off
//                                            its own copy
//   (either Undo, when a copy would go back to Claude Code's MCP settings: not offered, see givesBackLater)
//   deleted                                  Restore                the item is deleted
//   a content change: edit, conflict,        Undo; once later       the version from before it (`previous`) is not the
//     current, and any entry from before     changes came, "Make    current one
//     the library that names `previous`      the version before
//                                            this current"
//   conflict, chosen, kept-edit (an edit     Use <harness>’s        that copy's version is not the current one
//     not taken in that was written over,
//     a copy a tool managed again held, or
//     a copy of a tool's own: `own-copy`),
//     and on (a tool's own copy the click
//     wrote over): copies that gave way
//   switched: a skill's tool switch          Undo: sets that        some tool still loads it (`loads`)
//     cleared (isClearedSwitch)              switch again
//
// One entry is not here: a Pull that changed only Claude Code's own settings of an agent (`settingsFile`) keeps its own Undo
// (gitrepo.ts undoSettingsChange), since no version tells such a change apart. A copy taken over (skills.ts takeOver,
// `took-over`) has no action.
// To add an entry or an action: its kind (or its `cause`) in types.ts HistoryEvent, its sentence in librarySentence, its row
// in libraryAction, the entry librarypass.ts logItem makes for it, and its case in historypage.ts describe.
import type { IconName } from './icons.ts';
import { itemKey, theVersion, type LibraryItem } from './library.ts';
import { asItIs, versionClock, writesWait, type RowWords } from './libraryrow.ts';
import type { Change, HarnessId, HistoryEvent, LibraryFacts } from './types.ts';
import { andList, toolName, toolsPhrase } from './words.ts';

/**
 * Whose a History entry is among the library's kinds, by the page's name for the kind (app.ts PageKind), with the item's key:
 * an agent's is keyed `agent:<key>` (not a Pull's change to Claude Code's own settings alone, which is gitrepo.ts's); an MCP
 * server's `mcp:<key>` (before the library, `mcp:<name>` as written, whose key is share.ts itemKey of it); a skill's by its key
 * alone, as before the library (no other kind's key is without a `kind:` prefix). Undefined for any other entry.
 */
export function libraryEntry(event: HistoryEvent): { kind: 'agents' | 'skills' | 'mcp'; key: string } | undefined {
  if (event.key.startsWith('agent:')) return event.settingsFile ? undefined : { kind: 'agents', key: event.key.slice('agent:'.length) };
  if (event.key.startsWith('mcp:')) return { kind: 'mcp', key: itemKey(event.key.slice('mcp:'.length)) };
  if (!event.key || event.key.includes(':') || event.base || event.kind === 'profile') return undefined;
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
  const pulled = event.cause === 'pulled', keeps = 'Central Knot keeps it.';
  // An Undo that gave tools their own copies back instead of removing what was there (types.ts HistoryEvent gaveBack).
  const gave = (event.gaveBack ?? []).map(toolName);
  const gaveSaid = gave.length ? ` ${andList(gave)} ${gave.length === 1 ? 'has its own copy' : 'have their own copies'} back, as before.` : '';
  // A click that wrote over a copy a tool had of its own (tookFrom, and written: in `losers`), which is kept as a version.
  const over = (event.tookFrom ?? []).filter(copy => event.losers.some(loser => loser.tool === copy.tool)).map(copy => toolName(copy.tool));
  const overSaid = over.length ? ` ${andList(over)}’s own ${words.copy}${over.length === 1 ? ' was' : 's were'} written over and kept as a version.` : '';
  switch (event.kind) {
    case 'on': {
      if (event.only) return { glyph: 'circle-check', text: `Turned on in ${where}: its ${words.copy} there is back.${overSaid}${gaveSaid}` };
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
      if (event.only) return { glyph: 'circle-off', text: `Kept out of ${where}: its copy there was removed. ${keeps}${gaveSaid}` };
      if (event.cause === 'deleted-by-hand') return { glyph: 'trash-2', text: `Its copy was deleted in ${from}, so it was turned off${also(' and removed from')}. ${keeps}` };
      // Off (or kept out) while those tools were left out or away: their copies went once they were managed again.
      if (event.cause === 'tool-back') {
        const away = andList(event.losers.map(loser => toolName(loser.tool))), one = event.losers.length === 1;
        return { glyph: 'circle-off', text: `Off while Central Knot didn’t manage ${away}, so its ${words.copy} there was removed once ${one ? 'it was' : 'they were'} managed again. ${keeps}` };
      }
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
export function libraryAction(event: HistoryEvent, item: LibraryItem | undefined, version?: string, loads?: LibraryFacts['loads']): EntryAction | undefined {
  if (!item || event.undoneBy) return undefined;
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
  if (tookIn(event) && item.on && asTheClickLeftIt(event, item) && !sourceReplaced(event, item)) {
    if (givesBackLater(event, givenBack(event, item).giveBack)) return undefined;
    return { label: 'Undo', help: `Take ${name} out of Central Knot again: the copies it put in tools go, and each tool it was found in keeps its own`, change: { ...now, deleted: true, ...givenBack(event, item) } };
  }
  // A copy removed from a tool managed again: no click turned it off, so there is nothing to undo.
  if (event.kind === 'off' && event.cause === 'tool-back') return undefined;
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

/**
 * Whether the place a found item was taken from no longer holds that copy: the tool had it another way (a link, a copy in
 * ~/.agents/skills: no copy of its own, so not in `tookFrom`), and Central Knot's copy is there now (Take over replaced it, or
 * it went). Its Undo would then leave that tool nothing, so it is not offered.
 */
const sourceReplaced = (event: HistoryEvent, item: LibraryItem) => !!event.winner
  && !(event.tookFrom ?? []).some(copy => copy.tool === event.winner!.tool) && item.applied[event.winner.tool] !== undefined;

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
