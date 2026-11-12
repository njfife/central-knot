// A library item's row on its kind's page (library.ts: agents today), without the DOM: where it stands, what each harness's
// mark says, the clicks its controls send, and every sentence the page says about it (its status, its switch, a click's
// result, a notice). The same for every kind on the library: a kind supplies only its words (RowWords; each kind's are in
// libraryWords), and the sentences that name the item or its copies are made in them (sentences). matrix.ts draws these, with
// what else a kind's opened row shows of its own (librarypages.ts); the tests click them exactly as the page does
// (tests/agentclicks.ts).
//
// An item stands in one of three places (library.ts has the model):
//   on     in Central Knot's library and On: applied to every managed harness it is not kept out of; `partial` when the
//          person keeps it out of some (the opened row's switches), which its row and switch tell apart from On everywhere
//   off    in the library and Off: in Central Knot only, in no harness
//   found  in a managed harness, not in the library; its switch takes it in
// A harness's line can say two more things the kind's view works out at each look and that change nothing a pass does: how
// the harness has the item another way (`anotherWay`), and that its own switch turns it off there (`switched`, skills).
// What each harness's mark says is the library's plan for the item (library.ts plan), worked out by the kind's view
// (agents.ts agentsView) from the same reading a pass makes (copiesOf), so a mark says what the next pass will do there and
// never something of its own.
import { sourceWords, wantedIn, type LibraryItem, type Plan, type Version, type VersionChange } from './library.ts';
import { clockTimesApart, dayAndTime } from './model.ts';
import type { Change, HarnessId, SyncNotice } from './types.ts';
import { andList, kindNouns, sentence, toolName, toolsPhrase } from './words.ts';

// ---------- What a kind supplies ----------

/** A kind's words on its rows, where they differ from another kind's. */
export interface RowWords {
  /** The item as a sentence names it ("agent"), and with its article ("an agent"). */
  item: string; an: string;
  /** One harness's copy of it ("file"). */
  copy: string;
  /** Said once in the opened row, where there is more than one tool: what every tool shares of it, and what stays each tool's own. */
  shared: string;
  /** After a harness's line, what of its copy stays that harness's own (`names`: its own part's, types.ts ToolCopy ownPart; at least one). */
  own(names: readonly string[]): string;
  /** The part of a copy the copy question compares and shows side by side (types.ts ToolCopy body), as its heading names it ("Prompt"). */
  body: string;
}

/**
 * Each kind on the library, in its words, keyed by the page's name for it (app.ts PageKind); the one place they are written
 * (agents.ts takes its Kind's from here). Every other place a kind is wired in is in librarypass.ts's recipe.
 */
export const libraryWords = {
  agents: {
    item: kindNouns.agents.one, an: kindNouns.agents.a, copy: 'file', body: 'Prompt',
    shared: 'Name, description and prompt are the same in every tool; other settings stay in each tool’s file.',
    own: names => `Its own settings stay in its file: ${andList([...names])}.`,
  },
  skills: {
    item: kindNouns.skills.one, an: kindNouns.skills.a, copy: 'folder', body: 'SKILL.md',
    shared: 'Its whole folder is the same in every tool: every file, and which can run.',
    // A skill's folder is the same in every tool: no part of it stays one tool's own.
    own: () => '',
  },
} satisfies Record<string, RowWords>;

// ---------- Where it stands, and each harness's mark ----------

/** What the page knows of an item besides its library item (the kind's view gives it: types.ts LibraryFacts). */
export interface LibraryRow {
  key: string; name?: string;
  /** Each harness's copy, by its content. */
  hashes?: Partial<Record<string, string>>;
  /** In the library: what the next pass does in each harness. */
  plan?: Plan;
  /** Why a harness the item should be in can't be given a copy, and why a harness's copy can't be seen for sure. */
  cannot?: Partial<Record<string, string>>;
  unseen?: Partial<Record<string, string>>;
  /** Found: its copies differ, so the switch asks which one to take in. */
  differs?: boolean;
  /** How a harness has it another way (a link, a folder Central Knot doesn't own, another tool's folder, a plugin), in words. */
  anotherWay?: Partial<Record<string, string>>;
  /** A harness whose own switch turns it off there, as its mark says it ("switched off in Codex’s own settings"). */
  switched?: Partial<Record<string, string>>;
}

export type Place = 'on' | 'off' | 'found';
/** The item when it is in the library (a deleted one is not: what a harness holds of it is found). */
export const inLibrary = (item: LibraryItem | undefined) => (item && !item.deleted ? item : undefined);
export const placeOf = (item: LibraryItem | undefined): Place => { const inLib = inLibrary(item); return !inLib ? 'found' : inLib.on ? 'on' : 'off'; };
/** On, and kept out of some of the home's harnesses by the person (`tools`): partial, which the row and its switch say. */
export const isPartial = (item: LibraryItem | undefined, tools: readonly string[]) => placeOf(item) === 'on' && item!.except.some(tool => tools.includes(tool));

/**
 * What one harness has of an item, as its mark and its line say it, from the plan:
 * - `current`: the current version; `gets-it`: it is written there at the next pass; `edited`: its copy was edited there and
 *   becomes the current version at the next pass; `deleted`: its copy was deleted there by hand, which turns the item Off at
 *   the next pass; `leaving`: its copy is removed at the next pass;
 * - `own-copy`: a copy Central Knot didn't put there (a found item's, or one that turned up while the item is Off or kept
 *   out of that harness); `kept-out`: the person keeps the item out of this harness; `none`: no copy;
 * - `another-way`: no copy of its own, and it has the item another way (`anotherWay`), so nothing of Central Knot's goes there;
 * - `cannot`: it can't be given a copy (the row says why); `unseen`: its copy can't be read for sure, so nothing happens there.
 */
export type HarnessIs = 'current' | 'gets-it' | 'edited' | 'deleted' | 'leaving' | 'own-copy' | 'kept-out' | 'none' | 'another-way' | 'cannot' | 'unseen';

export function harnessIs(row: LibraryRow, item: LibraryItem | undefined, tool: string): HarnessIs {
  const inLib = inLibrary(item), made = row.plan, harness = tool as HarnessId;
  if (row.unseen?.[tool]) return 'unseen';
  if (row.anotherWay?.[tool] && row.hashes?.[tool] === undefined) return 'another-way';
  if (!inLib || !made) return row.hashes?.[tool] === undefined ? 'none' : 'own-copy';
  if (row.cannot?.[tool]) return 'cannot';
  if (made.takeIn === harness) return 'edited';
  if (made.turnedOffBy === harness) return 'deleted';
  const step = (['write', 'remove', 'found', 'current'] as const).find(list => made[list].includes(harness));
  if (step) return ({ write: 'gets-it', remove: 'leaving', found: 'own-copy', current: 'current' } as const)[step];
  return inLib.on && inLib.except.includes(harness) ? 'kept-out' : 'none';
}

const KEPT_FIRST = 'before it is written over, a copy Central Knot doesn’t have yet is kept as a version';

/** Whether the switch must ask which copy to take in: a found item whose copies differ (librarypass.ts foundCopies). A library item never asks. */
export const needsChoice = (row: LibraryRow, item: LibraryItem | undefined) => !inLibrary(item) && !!row.differs;

// ---------- The clicks ----------

/**
 * The item as it is, as a click that changes nothing (a types.ts Change: `managed` is On, `off` the harnesses it is kept out
 * of): each click a row's controls or a History entry sends (historyactions.ts) changes one thing of it. `item` as the caller
 * means it: a row's, in the library or none (inLibrary); History's, deleted or not.
 */
export const asItIs = (key: string, item: LibraryItem | undefined): Change => ({ key, managed: !!item?.on, off: item ? [...item.except] : [] });
/** A row's item as it is, with whether the page showed it On (`seenManaged`): a click made from an older read is refused. */
const rowAsItIs = (row: LibraryRow, item: LibraryItem | undefined): Change =>
  ({ ...asItIs(row.key, inLibrary(item)), seenManaged: !!inLibrary(item)?.on });

/**
 * The clicks a row's controls send. Each is a types.ts Change, as every item page sends it. main.ts's `changes` sanitizer
 * passes it on field by field, and librarypass.ts itemClick makes it the library's click.
 */
export const rowClicks = {
  /** The row's switch, On: a found item is taken in (`use`: the copy every harness takes, where they differ); one in the library is applied. */
  on: (row: LibraryRow, item: LibraryItem | undefined, use?: string): Change =>
    ({ ...rowAsItIs(row, item), managed: true, ...(use ? { use: use as HarnessId, useHash: row.hashes?.[use] } : {}) }),
  /** The row's switch, Off: out of every harness; Central Knot keeps it. */
  off: (row: LibraryRow, item: LibraryItem | undefined): Change => ({ ...rowAsItIs(row, item), managed: false }),
  /** A harness's own switch in the opened row: kept out of it (`out`), or let in again. */
  inHarness: (row: LibraryRow, item: LibraryItem | undefined, tool: string, out: boolean): Change => {
    const now = rowAsItIs(row, item);
    return { ...now, off: out ? [...now.off, tool as HarnessId] : now.off.filter(other => other !== tool) };
  },
  /** Make current, on an earlier version in the opened row. */
  makeCurrent: (row: LibraryRow, item: LibraryItem | undefined, version: string): Change => ({ ...rowAsItIs(row, item), version }),
  /** Delete from Central Knot. */
  remove: (row: LibraryRow, item: LibraryItem | undefined): Change => ({ ...rowAsItIs(row, item), deleted: true }),
};

// ---------- Versions ----------

/** A version's note: what it changed ("prompt changed"), what a copy that gave way differs in ("prompt differs"), or "first version". */
export function versionChange(changed: VersionChange | undefined): string {
  if (changed === undefined || changed === 'unknown' || changed === 'none') return '';
  if (changed === 'first') return 'first version';
  const fields = 'differs' in changed ? changed.differs : changed.changed;
  if (!fields.length) return 'same content';
  return `${andList([...fields])} ${'differs' in changed ? (fields.length > 1 ? 'differ' : 'differs') : 'changed'}`;
}
/** What a version's note is compared with, for its tooltip. */
export function versionChangeHelp(changed: VersionChange | undefined): string | undefined {
  if (changed === undefined || typeof changed === 'string') return undefined;
  return 'differs' in changed ? 'Against the version written over this copy' : 'Against the version that was current before it';
}

/** When a version was made, said short: its time today, else its day and time. */
export const madeAt = (version: Version) => dayAndTime(version.at).replace(/^today at /, '');
/**
 * A version as a sentence names it (History, a Make current's result): its clock time, to the second where two of the
 * item's versions would read the same minute, as the versions list says them (model.ts clockTimesApart).
 */
export function versionClock(item: Pick<LibraryItem, 'versions'>, version: Version, now = Date.now()): string {
  const at = item.versions.indexOf(version), all = at < 0 ? [...item.versions, version] : item.versions;
  return clockTimesApart(all.map(entry => entry.at), now, true)[at < 0 ? all.length - 1 : at];
}

/** The version a "made current again" one was made from: the earlier entry with its content that came from somewhere else. */
export function madeFrom(item: Pick<LibraryItem, 'versions'>, version: Version): Version | undefined {
  return item.versions.slice(item.versions.indexOf(version) + 1).find(older => older.hash === version.hash && older.from.how !== 'made-current');
}
/**
 * Where a listed version came from, as its row says it: a version made current again names the one it went back to, with
 * that one's time as `when` says it (the list's own form; madeAt by default).
 */
export function versionSource(item: Pick<LibraryItem, 'versions'>, version: Version, when: (source: Version) => string = madeAt): string {
  const source = version.from.how === 'made-current' ? madeFrom(item, version) : undefined;
  return source ? `back to: ${sourceWords(source.from)}, ${when(source)}` : sourceWords(version.from);
}

/** How many versions a folded list shows. */
export const FOLDED_VERSIONS = 4;
/** The versions an opened row shows: all of them once unfolded, else the newest few, and how many more there are. */
export function foldVersions(versions: readonly Version[], unfolded: boolean): { shown: readonly Version[]; rest: number } {
  const shown = unfolded ? versions : versions.slice(0, FOLDED_VERSIONS);
  return { shown, rest: versions.length - shown.length };
}

// ---------- Words ----------

/** The home's harnesses by name, as a sentence lists them ("all 3 tools", or their names). */
const named = (some: readonly string[], tools: readonly string[]) => toolsPhrase([...some], [...tools]);
const harnessesWhere = (row: LibraryRow, item: LibraryItem | undefined, tools: readonly string[], ...states: HarnessIs[]) =>
  tools.filter(tool => states.includes(harnessIs(row, item, tool)));

/** An item's status in one line: on and where, in Central Knot only, or found in a harness and not in Central Knot yet. */
export function statusLine(row: LibraryRow, item: LibraryItem | undefined, tools: readonly string[]): string {
  const where = (...states: HarnessIs[]) => harnessesWhere(row, item, tools, ...states);
  const own = where('own-copy'), place = placeOf(item);
  if (place === 'found') {
    const differ = needsChoice(row, item) ? ', with different copies' : '';
    return `Not in Central Knot · in ${named(own, tools)}${differ}. Turn it on to take it in and put it in every tool.`;
  }
  const ownSaid = own.length ? ` ${sentence(named(own, tools))} ${own.length === 1 ? 'has a copy' : 'have copies'} Central Knot didn’t put there.` : '';
  if (place === 'off') return `Off · in Central Knot only. Turn it on to put it in every tool.${ownSaid}`;
  // A copy deleted by hand turns the item Off at the next pass: that is what it is about to be.
  const deletedIn = row.plan?.turnedOffBy;
  if (deletedIn) return `On · its copy was deleted in ${toolName(deletedIn)}, so it turns off everywhere when sync runs. Central Knot keeps it.`;
  // A harness holding the current version that only waits for an edit made elsewhere has it on.
  const waitsForEdit = (tool: string) => row.hashes?.[tool] === item!.hash;
  const gets = where('gets-it').filter(tool => !waitsForEdit(tool)), out = where('kept-out', 'leaving'), cannot = where('cannot');
  const onIn = tools.filter(tool => ['current', 'edited'].includes(harnessIs(row, item, tool)) || (harnessIs(row, item, tool) === 'gets-it' && waitsForEdit(tool)));
  const edit = row.plan?.takeIn;
  const parts = [`On in ${named(onIn, tools)}${cannot.length ? ' only' : ''}`,
    edit ? `${toolName(edit)}’s edit becomes the current version when sync runs` : '',
    gets.length ? `${named(gets, tools)} ${gets.length === 1 ? 'gets' : 'get'} it when sync runs` : '',
    cannot.length ? `${andList(cannot.map(toolName))} can’t take it (see below)` : '',
    out.length ? `kept out of ${named(out, tools)}` : ''];
  return `${parts.filter(Boolean).join(' · ')}${ownSaid ? `.${ownSaid}` : ''}`;
}

/**
 * What the row's switch says: where the item stands, and what a click does. `question`: a found item whose copies differ
 * asks which copy every harness uses, and the click opens or closes that question.
 */
export function switchLabel(row: LibraryRow, item: LibraryItem | undefined, tools: readonly string[], question?: 'open' | 'closed'): string {
  const name = row.name ?? row.key, place = placeOf(item);
  if (place === 'on') {
    const out = item!.except.filter(tool => tools.includes(tool)).length;
    return `${name}: on${out ? ` in ${tools.length - out} of ${tools.length} tools` : ''}. Click to take it out of every tool; Central Knot keeps it.`;
  }
  const own = harnessesWhere(row, item, tools, 'own-copy');
  if (place === 'off') {
    const kept = own.length === 1 ? 'has a copy of its own, which is' : 'have copies of their own, which are';
    return `${name}: off, in Central Knot only. Click to put it in every tool${own.length ? `; ${named(own, tools)} ${kept} kept as versions first` : ''}.`;
  }
  const ask = question === 'open' ? 'close the question' : 'choose which copy every tool uses';
  if (question) return `${name}: not in Central Knot, and its copies differ. Click to ${ask}.`;
  return `${name}: in ${named(own, tools)}, not in Central Knot. Click to take it in and put it in every tool.`;
}

/**
 * The sentences that name the item or its copies, in one kind's words: a harness's line in the opened row (harnessLine),
 * the tag after its name (placeTag), what each click's result says (said), and what a notice of sync's says (noticeWords).
 */
export function sentences(words: RowWords) {
  const { item: noun, copy } = words;

  /**
   * A harness's line in the opened row: what it has, in a sentence, then that its own switch turns it off there, if it does.
   * `where` is the harness's name.
   */
  function harnessLine(row: LibraryRow, item: LibraryItem | undefined, tool: string, where: string): string {
    const switched = row.switched?.[tool];
    const off = switched ? ` It is ${switched}: ${where} doesn’t load it, and Central Knot leaves that switch as it is.` : '';
    return `${hasLine(row, item, tool, where)}${off}`;
  }
  function hasLine(row: LibraryRow, item: LibraryItem | undefined, tool: string, where: string): string {
    const inLib = inLibrary(item), has = row.hashes?.[tool] !== undefined, other = row.anotherWay?.[tool];
    // It has it another way too: Central Knot's own copy there is one too many, and any other is left alone (library.ts).
    if (other && has) {
      const is = harnessIs(row, item, tool);
      if (is === 'leaving' || is === 'edited') return `${other} So the ${copy} Central Knot put in its own folder is removed when sync runs; Central Knot keeps it.`;
      if (is === 'own-copy') return `${other} It also has a ${copy} of its own, which Central Knot didn’t put there and leaves alone: it has it both ways.`;
    }
    switch (harnessIs(row, item, tool)) {
      case 'another-way': return inLib?.on ? `${other} Nothing of Central Knot’s goes there while it does.` : `${inLib ? 'Off' : 'Not in Central Knot'} · ${other!.charAt(0).toLowerCase()}${other!.slice(1)}`;
      case 'current': return 'Has the current version.';
      case 'gets-it': {
        if (!has) return 'Gets it when sync runs next.';
        // While an edit waits elsewhere, a harness with the current version gets that edit; a copy the library lacks is kept first.
        const edit = row.plan?.takeIn, kept = row.plan?.keep.some(entry => entry.harness === tool);
        const now = row.hashes?.[tool] === inLib?.hash ? 'Has the current version' : 'Has another copy';
        return `${now}. It gets ${edit ? `${toolName(edit)}’s edit` : 'the current version'} when sync runs${kept ? `; ${KEPT_FIRST}` : ''}.`;
      }
      case 'edited': {
        if (wantedIn(inLib!, tool as HarnessId)) return `Edited in ${where}. It becomes the current version when sync runs, and reaches the other tools.`;
        const reaches = inLib!.on ? ' and reaches the other tools' : '';
        const gone = inLib!.on ? `the ${noun} is kept out of this tool` : `the ${noun} is off`;
        return `Edited in ${where}. When sync runs it becomes the current version${reaches}, then its copy here is removed: ${gone}.`;
      }
      case 'deleted': return `Its copy was deleted in ${where}. When sync runs, the ${noun} turns off everywhere; Central Knot keeps it.`;
      case 'leaving': {
        const kept = row.plan?.keep.some(entry => entry.harness === tool);
        return kept ? 'Has a copy Central Knot doesn’t have yet. When sync runs it is kept as a version, then removed.' : 'Its copy is removed when sync runs. Central Knot keeps it.';
      }
      case 'own-copy':
        if (!inLib) return 'Has it.';
        return `Has a copy Central Knot didn’t put there. It is left alone while ${inLib.on ? 'this tool is kept out' : `the ${noun} is off`}; ${KEPT_FIRST}.`;
      case 'kept-out': return `Kept out of this tool. Central Knot keeps its ${copy} for when you turn it on here.`;
      case 'none': return inLib ? 'No copy while it is off.' : 'No copy. Turning it on adds it here.';
      case 'cannot': return row.cannot![tool]!;
      case 'unseen': return row.unseen![tool]!;
    }
  }

  /**
   * The tag after an item's name when it isn't plainly on everywhere: where it stands, or the tools it is kept out of, and
   * (its tooltip) what that means. `tools`: the home's harnesses.
   */
  function placeTag(row: LibraryRow, item: LibraryItem | undefined, tools: readonly string[]): { text: string; title: string } | undefined {
    const place = placeOf(item);
    if (place === 'off') return { text: 'in Central Knot only', title: `Central Knot keeps this ${noun} and its versions. No tool has it until you turn it on.` };
    const found = `A tool has this ${noun}; Central Knot doesn’t yet. Turn it on to take it in and put it in every tool.`;
    if (place === 'found') return { text: 'not in Central Knot', title: found };
    const out = item!.except.filter(tool => tools.includes(tool)), keptOut = `Kept out of ${andList(out.map(toolName))}. Its switch there, in the opened row, puts it back.`;
    // A tool that can't take it (the kind's view says why: row.cannot) and has no copy is as lasting as one it is kept out
    // of: the tag names where it is. (A tool that holds an older copy, its folder locked, is told by its mark and line alone.)
    const cannot = tools.filter(tool => harnessIs(row, item, tool) === 'cannot' && row.hashes?.[tool] === undefined);
    const can = tools.filter(tool => !cannot.includes(tool) && !out.includes(tool as HarnessId));
    // Partial: on in some of the tools, by the person's choice, and said as such, never as On everywhere.
    const where = out.length ? `in ${can.length} of ${tools.length} tools · not in ${andList(out.map(toolName))}`
      : cannot.length ? (can.length ? `${andList(can.map(toolName))} only` : 'in no tool') : '';
    const whereTitle = [...cannot.map(tool => row.cannot![tool]!), out.length ? keptOut : ''].filter(Boolean).join(' ');
    // A tool's own switch that turns it off: said too, so an item switched off everywhere never reads as plainly on.
    const switched = tools.filter(tool => row.switched?.[tool] && !out.includes(tool as HarnessId));
    const off = !switched.length ? '' : switched.length === tools.length && switched.length > 1 ? `switched off in all ${switched.length} tools` : `switched off in ${andList(switched.map(toolName))}`;
    const offTitle = switched.length ? `${sentence(andList(switched.map(tool => row.switched![tool]!)))}: each tool’s own switch, which Central Knot leaves as it is. The opened row can clear it.` : '';
    const text = [where, off].filter(Boolean).join(' · ');
    return text ? { text, title: [whereTitle, offTitle].filter(Boolean).join(' ') } : undefined;
  }

  /** What the result says after each click. `notIn`: the harnesses where the click's write or removal didn't go through. */
  const said = {
    off(name: string, notIn: readonly string[], tools: readonly string[]): string {
      const left = notIn.length ? `, but still in ${named(notIn, tools)}` : ': no tool has it';
      return `${name} is off${left}. Central Knot keeps it, and turning it on puts each ${copy} back as it was.`;
    },
    /** A found item taken in; `use`: the harness whose copy was chosen where they differed. */
    takenIn(name: string, on: readonly string[], tools: readonly string[], use?: string): string {
      const chosen = use ? `, with ${toolName(use)}’s copy` : '', others = use ? ' The other copies are kept as its versions.' : '';
      return `${name} is in Central Knot now${chosen}, and on in ${named(on, tools)}.${others}`;
    },
    /** One harness's switch: kept out (`out`), or let in again. */
    inHarness(name: string, tool: string, out: boolean, failed: boolean): string {
      const where = toolName(tool);
      if (!out) return failed ? `${name} couldn’t be put in ${where}.` : `${name} is on in ${where} again.`;
      return failed ? `${name} couldn’t be taken out of ${where} yet.` : `${name} is kept out of ${where}. Central Knot keeps its ${copy} for when you turn it on there.`;
    },
    /** `when`: the version's time (versionClock). `on`: the harnesses it was written to; undefined for an item that is Off. */
    madeCurrent(name: string, version: Version, when: string, on: readonly string[] | undefined, tools: readonly string[]): string {
      const where = on ? `, in ${named(on, tools)}.` : '. It is Off, so no tool was changed.';
      return `${name}: the version ${sourceWords(version.from)}, ${when}, is current again${where}`;
    },
    deleted: (name: string, wasOn: boolean) => `${name} is deleted from Central Knot${wasOn ? ', and out of every tool' : ''}. History can restore it.`,
    /** Beside Delete from Central Knot, before it is armed: how it differs from Off. */
    deleteOffer: 'Off keeps it here; Delete removes it from Central Knot.',
    /** Under Delete it now: what happens, and for how long History can undo it (`days`: History's days, from Settings). */
    deleteArmed: (days: number) => `It leaves every tool and this page. History keeps it, with its versions, for ${days} days, and can restore it.`,
  };

  /**
   * What sync did to an item on its own, as its notice says it: an edit taken in as the current version, the latest of two
   * edits, or a copy deleted by hand that turned the item off. `action`: the notice's button, which runs its History entry's
   * own action (historyactions.ts); `help`: what that does.
   */
  function noticeWords(notice: Pick<SyncNotice, 'kind' | 'item' | 'winner' | 'losers'>): { text: string; action: 'undo' | 'turn-on'; help: string } {
    const who = toolName(notice.winner), others = andList(notice.losers.map(toolName)), name = notice.item;
    const earlier = `Make the version from before ${who}’s edit current again, in every tool ${name} is on in`;
    if (notice.kind === 'deleted') {
      const text = `${name} was deleted in ${who}, so it is off everywhere. Central Knot keeps it.`;
      return { text, action: 'turn-on', help: `Put ${name} back in every tool, each ${copy} as it was` };
    }
    if (notice.kind === 'conflict') {
      const text = `${name}: ${who}’s edit is the latest, so it is the current version. ${others}’s is kept as a version.`;
      return { text, action: 'undo', help: earlier };
    }
    return { text: `${name} was edited in ${who}; that is its current version now${others ? `, in ${others} too` : ''}.`, action: 'undo', help: earlier };
  }

  return { harnessLine, placeTag, said, noticeWords };
}
