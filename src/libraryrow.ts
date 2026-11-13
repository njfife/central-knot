// A library item's row on its kind's page (library.ts: skills, MCP servers and agents), without the DOM: where it stands, what each harness's
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
//   found  in a managed harness, not in the library; its Add takes it in, and so does Synchronize everything where it may
//          (the kind's view gives both answers of library.ts takeInAnswer: `takeIn`; this file only says them)
// A harness's line can say three more things the kind's view works out at each look and that change nothing a pass does: how
// the harness has the item another way (`anotherWay`), that its own switch turns it off there (`switched`, skills and MCP
// servers), and that a write or removal there waits for Write to Claude Code (`waits`, MCP servers).
// What each harness's mark says is the library's plan for the item (library.ts plan), worked out by the kind's view
// (agents.ts agentsView) from the same reading a pass makes (copiesOf), so a mark says what the next pass will do there and
// never something of its own.
import { sourceWords, theVersion, wantedIn, type LibraryItem, type Plan, type TakeInAnswer, type Version, type VersionChange } from './library.ts';
import { clockTimesApart, dayAndTime } from './model.ts';
import type { Change, HarnessId, ItemNotice, TakenInNotice } from './types.ts';
import { andList, kindNouns, sentence, toolName, toolsPhrase } from './words.ts';

// ---------- What a kind supplies ----------

/**
 * Whether a kind's writes and removals in a harness wait for a step of the person's own: Claude Code's MCP settings, which
 * Central Knot writes only when the person clicks Write to Claude Code (servers.ts holds them back until then). The page and
 * History say so before a click (matrix.ts, historyactions.ts).
 */
export const writesWait = (kind: 'skills' | 'mcp' | 'agents', tool: string) => kind === 'mcp' && tool === 'claude-cli';

/** A kind's words on its rows, where they differ from another kind's. */
export interface RowWords {
  /** The item as a sentence names it ("agent"), with its article ("an agent"), and many of them ("agents"). */
  item: string; an: string; many: string;
  /** One harness's copy of it ("file"). */
  copy: string;
  /** Said once in the opened row, where there is more than one tool: what every tool shares of it, and what stays each tool's own. */
  shared: string;
  /** After a harness's line, what of its copy stays that harness's own (`names`: its own part's, types.ts ToolCopy ownPart; at least one). */
  own(names: readonly string[]): string;
  /**
   * The part of a copy the copy question compares and shows side by side (types.ts ToolCopy body), as its heading names it
   * ("Prompt"). A kind without one (skills, MCP servers) quotes each copy's summary; skills compare theirs in the Files view.
   */
  body?: string;
  /**
   * A kind with a tool's own switch for an item (skills, MCP servers; `switched`): what a tool's line says after "It is switched
   * off in Codex’s own settings:" (`line`, `where` the tool's name), and what the tag's tooltip adds.
   */
  switchedOff?: { line(where: string): string; tag: string };
}

/**
 * Each kind on the library, in its words, keyed by the page's name for it (app.ts PageKind); the one place they are written
 * (agents.ts takes its Kind's from here). Every other place a kind is wired in is in librarypass.ts's recipe.
 */
export const libraryWords = {
  agents: {
    item: kindNouns.agents.one, an: kindNouns.agents.a, many: kindNouns.agents.many, copy: 'file', body: 'Prompt',
    shared: 'Name, description and prompt are the same in every tool; other settings stay in each tool’s file.',
    own: names => `Its own settings stay in its file: ${andList([...names])}.`,
  },
  skills: {
    item: kindNouns.skills.one, an: kindNouns.skills.a, many: kindNouns.skills.many, copy: 'folder',
    shared: 'Every tool it is on in gets the same folder: every file as it is, and its scripts still runnable.',
    // A skill's folder is the same in every tool: no part of it stays one tool's own.
    own: () => '',
    switchedOff: { line: where => `${where} doesn’t load it, and Central Knot leaves that switch as it is.`, tag: 'The opened row can clear it.' },
  },
  mcp: {
    item: kindNouns.mcp.one, an: kindNouns.mcp.a, many: kindNouns.mcp.many, copy: 'entry',
    shared: 'What it runs (its command, arguments and environment, or its URL and headers) is the same in every tool; other settings stay in each tool’s entry.',
    own: names => `Its own settings stay in its entry: ${andList([...names])}.`,
    // Claude Code's and Copilot's switch is kept apart from the entry, Codex's, Pi's and OpenCode's in it: either way it stays.
    switchedOff: { line: where => `${where} doesn’t start it. Central Knot leaves that switch as it is, so it is still off there after Off and On.`, tag: 'Turn it back on in that tool’s own settings.' },
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
  /** Found: what a click on its Add does, and what Synchronize everything does with it (types.ts LibraryFacts takeIn). */
  takeIn?: { click: TakeInAnswer; rule: TakeInAnswer };
  /** How a harness has it another way (a link, a folder Central Knot doesn't own, another tool's folder, a plugin), in words. */
  anotherWay?: Partial<Record<string, string>>;
  /** A harness whose own switch turns it off there, as its mark says it ("switched off in Codex’s own settings"). */
  switched?: Partial<Record<string, string>>;
  /** Harnesses where the next pass's write or removal waits for Write to Claude Code (types.ts LibraryFacts waits). */
  waits?: readonly string[];
}

export type Place = 'on' | 'off' | 'found';
/** The item when it is in the library (a deleted one is not: what a harness holds of it is found). */
export const inLibrary = (item: LibraryItem | undefined) => (item && !item.deleted ? item : undefined);
export const placeOf = (item: LibraryItem | undefined): Place => { const inLib = inLibrary(item); return !inLib ? 'found' : inLib.on ? 'on' : 'off'; };
/**
 * On, and kept out of some of the home's harnesses by the person (`tools`), or (`row` given) switched off in some of them by
 * their own settings: partial, which the row and its switch say.
 */
export const isPartial = (item: LibraryItem | undefined, tools: readonly string[], row?: LibraryRow) =>
  placeOf(item) === 'on' && (item!.except.some(tool => tools.includes(tool)) || (!!row && tools.some(tool => row.switched?.[tool])));

/**
 * What one harness has of an item, as its mark and its line say it, from the plan:
 * - `current`: the current version; `gets-it`: it is written there at the next pass; `edited`: its copy was edited there and
 *   becomes the current version at the next pass; `deleted`: its copy was deleted there by hand, which turns the item Off at
 *   the next pass; `leaving`: its copy is removed at the next pass;
 * - `own-copy`: a copy Central Knot didn't put there (a found item's, or one that turned up while the item is Off or kept
 *   out of that harness); `kept-out`: the person keeps the item out of this harness; `none`: no copy;
 * - `another-way`: no copy of its own, and it has the item another way (`anotherWay`), so nothing of Central Knot's goes there;
 * - `cannot`: it can't be given a copy (the row says why); `unseen`: its copy can't be read for sure, so nothing happens there;
 * - `waits`: the next pass's write or removal there waits for Write to Claude Code (`waits`).
 */
export type HarnessIs = 'current' | 'gets-it' | 'edited' | 'deleted' | 'leaving' | 'own-copy' | 'kept-out' | 'none' | 'another-way' | 'cannot' | 'unseen' | 'waits';

export function harnessIs(row: LibraryRow, item: LibraryItem | undefined, tool: string): HarnessIs {
  const inLib = inLibrary(item), made = row.plan, harness = tool as HarnessId;
  if (row.unseen?.[tool]) return 'unseen';
  if (row.waits?.includes(tool)) return 'waits';
  if (row.anotherWay?.[tool] && row.hashes?.[tool] === undefined) return 'another-way';
  // Found (or Off with nothing planned): a harness with no copy that couldn't be given one says so already.
  if (!inLib || !made) return row.hashes?.[tool] !== undefined ? 'own-copy' : row.cannot?.[tool] ? 'cannot' : 'none';
  if (row.cannot?.[tool]) return 'cannot';
  if (made.takeIn === harness) return 'edited';
  if (made.turnedOffBy === harness) return 'deleted';
  const step = (['write', 'remove', 'found', 'current'] as const).find(list => made[list].includes(harness));
  if (step) return ({ write: 'gets-it', remove: 'leaving', found: 'own-copy', current: 'current' } as const)[step];
  return inLib.on && inLib.except.includes(harness) ? 'kept-out' : 'none';
}

const KEPT_FIRST = 'before it is written over, a copy Central Knot doesn’t have yet is kept as a version';

/** A found row's Add asks which copy to take in: the take-in table's answer for a click is to wait for a choice. A library item never asks. */
export const asksWhichCopy = (row: LibraryRow) => !!row.takeIn && 'wait' in row.takeIn.click;
/** A found row's Add does something (the take-in table's answer for a click): takes it in, or asks which copy. */
export const canAdd = (row: LibraryRow) => !!row.takeIn && !('leave' in row.takeIn.click);

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

/**
 * An item's status in one line: on and where, in Central Knot only, or found in a harness and not in Central Knot yet (and,
 * with Synchronize everything on: `everything`, what it does with it).
 */
export function statusLine(row: LibraryRow, item: LibraryItem | undefined, tools: readonly string[], everything = false): string {
  const where = (...states: HarnessIs[]) => harnessesWhere(row, item, tools, ...states);
  const own = where('own-copy'), place = placeOf(item);
  const waiting = where('waits'), waits = waiting.length ? `${sentence(named(waiting, tools))} still ${waiting.length === 1 ? 'has' : 'have'} it until you click Write to Claude Code.` : '';
  // A deleted item whose copy there is still to go is a found row, with no Add, until it has gone.
  if (place === 'found' && waits) return `Deleted from Central Knot · ${waits} History can restore it.`;
  if (place === 'found') {
    const differ = asksWhichCopy(row) ? ', with different copies' : '';
    if (!canAdd(row)) return 'Not in Central Knot · it can’t be taken in now (see below).';
    const below = where('cannot').length ? ' (see below)' : '';
    const rule = everything && row.takeIn ? ` ${ruleSays(row.takeIn.rule)}` : '';
    return `Not in Central Knot · ${foundWhere(row, item, tools)}${differ}. Add it to keep it in Central Knot${whereAdded(row, item, tools)}${below}.${rule}`;
  }
  const ownSaid = own.length ? ` ${sentence(named(own, tools))} ${own.length === 1 ? 'has a copy' : 'have copies'} Central Knot didn’t put there.` : '';
  if (place === 'off') return `Off · ${waiting.length ? `still in ${named(waiting, tools)} until you click Write to Claude Code` : 'in Central Knot only'}. Turn it on to put it in every tool.${ownSaid}`;
  // A copy deleted by hand turns the item Off at the next pass: that is what it is about to be.
  const deletedIn = row.plan?.turnedOffBy;
  if (deletedIn) return `On · its copy was deleted in ${toolName(deletedIn)}, so it turns off when sync runs. Central Knot keeps it.`;
  // A harness holding the current version that only waits for an edit made elsewhere has it on.
  const waitsForEdit = (tool: string) => row.hashes?.[tool] === item!.hash;
  const gets = where('gets-it').filter(tool => !waitsForEdit(tool)), out = where('kept-out', 'leaving'), cannot = where('cannot');
  const switched = tools.filter(tool => row.switched?.[tool] && !out.includes(tool));
  const another = where('another-way').filter(tool => wantedIn(item!, tool as HarnessId));
  // A tool whose own switch has it off doesn't load it: it is no tool it is on in (the parts below say it).
  const onIn = tools.filter(tool => !row.switched?.[tool] && (['current', 'edited'].includes(harnessIs(row, item, tool)) || (harnessIs(row, item, tool) === 'gets-it' && waitsForEdit(tool))));
  const edit = row.plan?.takeIn;
  const parts = [`On in ${named(onIn, tools)}${cannot.length ? ' only' : ''}`,
    edit ? `${toolName(edit)}’s edit becomes the current version when sync runs` : '',
    gets.length ? `${named(gets, tools)} ${gets.length === 1 ? 'gets' : 'get'} it when sync runs` : '',
    cannot.length ? `${andList(cannot.map(toolName))} can’t take it (see below)` : '',
    another.length ? `${andList(another.map(toolName))} ${another.length === 1 ? 'has' : 'have'} it another way` : '',
    out.length ? `kept out of ${named(out, tools)}` : '',
    waiting.length ? `${andList(waiting.map(toolName))} ${waiting.length === 1 ? 'waits' : 'wait'} for Write to Claude Code` : '',
    // A harness's own switch that turns it off there: it has the item and doesn't load it, as the tag says.
    switched.length ? `switched off in ${andList(switched.map(toolName))}` : ''];
  return `${parts.filter(Boolean).join(' · ')}${ownSaid ? `.${ownSaid}` : ''}`;
}

/** What the switch of an item in Central Knot says: where it stands, and what a click does. (A found item has Add instead: addLabel.) */
export function switchLabel(row: LibraryRow, item: LibraryItem | undefined, tools: readonly string[]): string {
  const name = row.name ?? row.key;
  if (placeOf(item) === 'on') {
    const out = notOnIn(row, item, tools).length;
    return `${name}: on${out ? ` in ${tools.length - out} of ${tools.length} tools` : ''}. Click to take it out of every tool; Central Knot keeps it.`;
  }
  const own = harnessesWhere(row, item, tools, 'own-copy');
  const kept = own.length === 1 ? 'has a copy of its own, which is' : 'have copies of their own, which are';
  return `${name}: off, in Central Knot only. Click to put it in every tool${own.length ? `; ${named(own, tools)} ${kept} kept as versions first` : ''}.`;
}

/**
 * What a found item's Add says (its tooltip and accessible name): Add takes it into Central Knot and turns it on. `question`:
 * its copies differ, and the click opens or closes the question of which copy Central Knot takes in.
 */
export function addLabel(row: LibraryRow, item: LibraryItem | undefined, tools: readonly string[], question?: 'open' | 'closed'): string {
  const name = row.name ?? row.key;
  if (question) return `Add ${name}: its copies differ. Click to ${question === 'open' ? 'close the question' : 'choose which one Central Knot takes in'}.`;
  if (row.waits?.length) return `Add ${name}: it was deleted from Central Knot, and its entry leaves ${andList(row.waits.map(toolName))} at the next Write to Claude Code. History can restore it.`;
  if (!canAdd(row)) return `Add ${name}: it can’t be added now; its line in the opened row says why.`;
  return `Add ${name} to Central Knot${whereAdded(row, item, tools)}`;
}

/**
 * Where Add puts a found item, said only as far as it is true, as the rest of "Add it to keep it in Central Knot…": " and put it
 * in every tool", else the tools it goes to, and those that can't take it (each line says why). A tool that has it another way
 * gets nothing (foundWhere says so).
 */
export function whereAdded(row: LibraryRow, item: LibraryItem | undefined, tools: readonly string[]) {
  const own = harnessesWhere(row, item, tools, 'own-copy'), cannot = harnessesWhere(row, item, tools, 'cannot'), another = harnessesWhere(row, item, tools, 'another-way');
  if (!cannot.length && !another.length) return ' and put it in every tool';
  const goes = tools.filter(tool => ![...own, ...cannot, ...another].includes(tool));
  const can = cannot.length ? `; ${andList(cannot.map(toolName))} can’t take it` : '';
  return `${goes.length ? ` and put it in ${named(goes, tools)}` : ''}${can}`;
}

/** The home's harnesses an item that is On doesn't load in: kept out of, or switched off in that harness's own settings. */
export const notOnIn = (row: LibraryRow, item: LibraryItem | undefined, tools: readonly string[]) =>
  tools.filter(tool => item?.except.includes(tool as HarnessId) || !!row.switched?.[tool]);

/**
 * What Synchronize everything does with a found item, as its row says it while the rule is on (the take-in table's answer for
 * the rule; library.ts takeInAnswer). Nothing where its row already says it can't be taken in.
 */
export function ruleSays(answer: TakeInAnswer): string {
  if ('take' in answer) return 'Synchronize everything takes it in when sync runs.';
  if ('wait' in answer) return 'Synchronize everything leaves it for you to choose: its copies differ.';
  return { deleted: 'Synchronize everything leaves it: it was deleted from Central Knot, so only Add brings it back.',
    part: 'Synchronize everything leaves it: it is a plugin’s part, so only Add takes it in.',
    settling: 'Synchronize everything takes it in once it has stopped changing.', 'no-copy': '', leaving: '', 'choice-changed': '' }[answer.leave];
}
/** Where a found item is: "in Claude Code and Codex", or, with no copy of a harness's own, "Pi has it another way". */
function foundWhere(row: LibraryRow, item: LibraryItem | undefined, tools: readonly string[]) {
  const own = harnessesWhere(row, item, tools, 'own-copy');
  if (own.length) return `in ${named(own, tools)}`;
  const another = harnessesWhere(row, item, tools, 'another-way');
  return `${sentence(named(another, tools))} ${another.length === 1 ? 'has' : 'have'} it another way`;
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
    const off = switched && words.switchedOff ? ` It is ${switched}: ${words.switchedOff.line(where)}` : '';
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
      // The way is said as written: it may start with a tool's name ("OpenCode reads Claude Code’s copy…").
      case 'another-way':
        if (inLib?.on && !wantedIn(inLib, tool as HarnessId)) return `Kept out of this tool, but it still has it another way. ${other} Keeping it out stops only a ${copy} of Central Knot’s here.`;
        return inLib?.on ? `${other} Nothing of Central Knot’s goes there while it does.` : `${inLib ? 'Off' : 'Not in Central Knot'} · ${other}`;
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
      case 'deleted': return `Its copy was deleted in ${where}. When sync runs, the ${noun} turns off; Central Knot keeps it.`;
      case 'leaving': {
        const kept = row.plan?.keep.some(entry => entry.harness === tool);
        return kept ? 'Has a copy Central Knot doesn’t have yet. When sync runs it is kept as a version, then removed.' : 'Its copy is removed when sync runs. Central Knot keeps it.';
      }
      case 'own-copy':
        if (!inLib) return 'Has it.';
        return `Has a copy Central Knot didn’t put there. It is left alone while ${inLib.on ? 'this tool is kept out' : `the ${noun} is off`}; ${KEPT_FIRST}.`;
      case 'kept-out': return `Kept out of this tool. Central Knot keeps its ${copy} for when you turn it on here.`;
      case 'none': return inLib ? 'No copy while it is off.' : canAdd(row) ? 'No copy. Adding it puts it here.' : 'No copy.';
      case 'cannot': return row.cannot![tool]!;
      case 'unseen': return row.unseen![tool]!;
      case 'waits': {
        if (row.plan?.write.includes(tool as HarnessId)) return has ? `Its ${copy} here is behind. It gets the current version when you click Write to Claude Code.` : `It gets the ${noun} when you click Write to Claude Code.`;
        return `Its ${copy} here is removed when you click Write to Claude Code. ${inLib ? 'Central Knot keeps it.' : 'History can restore it.'}`;
      }
    }
  }

  /**
   * The tag after an item's name when it isn't plainly on everywhere: where it stands, or the tools it is kept out of, and
   * (its tooltip) what that means. `tools`: the home's harnesses.
   */
  function placeTag(row: LibraryRow, item: LibraryItem | undefined, tools: readonly string[]): { text: string; title: string } | undefined {
    const place = placeOf(item);
    if (place === 'off' && row.waits?.length) return { text: `still in ${andList(row.waits.map(toolName))} until Write`, title: `Off. Central Knot keeps this ${noun}; its ${copy} leaves ${andList(row.waits.map(toolName))} when you click Write to Claude Code.` };
    if (place === 'off') return { text: 'in Central Knot only', title: `Central Knot keeps this ${noun} and its versions. No tool has it until you turn it on.` };
    const found = `A tool has this ${noun}; Central Knot doesn’t yet. Add it to keep it in Central Knot${whereAdded(row, item, tools)}.`;
    if (place === 'found' && row.waits?.length) return { text: 'deleted', title: `Deleted from Central Knot. Its ${copy} leaves ${andList(row.waits.map(toolName))} when you click Write to Claude Code.` };
    if (place === 'found' && !canAdd(row)) return { text: 'can’t be taken in', title: 'Its line in the opened row says why.' };
    if (place === 'found') return { text: 'not in Central Knot', title: found };
    const out = item!.except.filter(tool => tools.includes(tool)), keptOut = `Kept out of ${andList(out.map(toolName))}. Its switch there, in the opened row, puts it back.`;
    // A tool that can't take it (the kind's view says why: row.cannot) and has no copy is as lasting as one it is kept out
    // of: the tag names where it is. (A tool that holds an older copy, its folder locked, is told by its mark and line alone.)
    const cannot = tools.filter(tool => harnessIs(row, item, tool) === 'cannot' && row.hashes?.[tool] === undefined);
    const can = tools.filter(tool => !cannot.includes(tool) && !out.includes(tool as HarnessId));
    // Partial: on in some of the tools, by the person's choice, and said as such, never as On everywhere.
    const where = out.length ? `in ${can.length} of ${tools.length} tools · kept out of ${andList(out.map(toolName))}`
      : cannot.length ? (can.length ? `${andList(can.map(toolName))} only` : 'in no tool') : '';
    const whereTitle = [...cannot.map(tool => row.cannot![tool]!), out.length ? keptOut : ''].filter(Boolean).join(' ');
    // A tool's own switch that turns it off: said too, so an item switched off everywhere never reads as plainly on.
    const switched = tools.filter(tool => row.switched?.[tool] && !out.includes(tool as HarnessId));
    const off = !switched.length ? '' : switched.length === tools.length && switched.length > 1 ? `switched off in all ${switched.length} tools` : `switched off in ${andList(switched.map(toolName))}`;
    const whose = sentence(andList(switched.map(tool => row.switched![tool]!)));
    const offTitle = switched.length ? `${whose}: each tool’s own switch, which Central Knot leaves as it is. ${words.switchedOff?.tag ?? ''}`.trim() : '';
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
    takenIn(name: string, on: readonly string[], tools: readonly string[], use?: string, another: readonly string[] = []): string {
      const chosen = use ? `, with ${toolName(use)}’s copy` : '', others = use ? ' The other copies are kept as its versions.' : '';
      const way = another.length ? `; ${andList(another.map(toolName))} ${another.length === 1 ? 'has' : 'have'} it another way` : '';
      return `${name} is in Central Knot now${chosen}, and on in ${named(on, tools)}${way}.${others}`;
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
      return `${name}: ${theVersion(version.from)}, ${when}, is current again${where}`;
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
  function noticeWords(notice: Pick<ItemNotice, 'kind' | 'item' | 'winner' | 'losers'>): { text: string; action: 'undo' | 'turn-on'; help: string } {
    const who = toolName(notice.winner), others = andList(notice.losers.map(toolName)), name = notice.item;
    const earlier = `Make the version from before ${who}’s edit current again, in every tool ${name} is on in`;
    if (notice.kind === 'deleted') {
      // The tools it was taken out of (one whose removal waits for Write to Claude Code is not among them: the band says it).
      const text = `${name} was deleted in ${who}, so it is off${others ? ` and was taken out of ${others}` : ''}. Central Knot keeps it.`;
      return { text, action: 'turn-on', help: `Put ${name} back in every tool, each ${copy} as it was` };
    }
    if (notice.kind === 'conflict') {
      const text = `${name}: ${who}’s edit is the latest, so it is the current version. ${others}’s is kept as a version.`;
      return { text, action: 'undo', help: earlier };
    }
    return { text: `${name} was edited in ${who}; that is its current version now${others ? `, in ${others} too` : ''}.`, action: 'undo', help: earlier };
  }

  /**
   * What Synchronize everything's notice says (types.ts TakenInNotice): how many it took in and where it found them, then
   * their names. Each one's own Undo is its History entry's.
   */
  function takenInWords(notice: Pick<TakenInNotice, 'items' | 'from'>): string {
    const count = notice.items.length, many = count === 1 ? noun : words.many;
    return `Synchronize everything took in ${count} ${many}, found in ${andList(notice.from.map(toolName))}: ${andList(notice.items)}. Each is on in every tool; History can undo each.`;
  }

  return { harnessLine, placeTag, said, noticeWords, takenInWords };
}
