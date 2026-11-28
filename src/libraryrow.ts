// A library item's row in the Library (library.ts: skills, MCP servers and agents), without the DOM: where it stands, what each harness's
// mark says, the clicks its controls send, and every sentence the page says about it (its status, its switch, a click's
// result, a notice). The same for every kind on the library: a kind supplies only its words (RowWords; each kind's are in
// libraryWords), and the sentences that name the item or its copies are made in them (sentences). matrix.ts draws these, with
// what else a kind's opened row shows of its own (librarypages.ts); the tests click them exactly as the page does
// (tests/agentclicks.ts).
//
// An item stands in one of three places (library.ts has the model):
//   on     in Central Knot's library and On: applied to every managed harness it is not kept out of; `partial` when the
//          person keeps it out of some (the opened row's switches), which its row and switch tell apart from On everywhere
//   off    in the library and Off: in Central Knot only, in no harness (a tool may still have it on through a plugin: `pluginOn`,
//          or a copy of its own that Central Knot leaves alone: ownCopies)
//   found  in a managed harness, not in the library; its Add takes it in, and so does Synchronize everything where it may
//          (the kind's view gives both answers of library.ts takeInAnswer: `takeInAnswers`; this file only says them)
// A harness's line can say two more things the kind's view works out at each look and that change nothing a pass does: how
// the harness has the item another way (`anotherWay`), and that its own switch turns it off there (`switchedOff`, skills and
// MCP servers). From those and the copies: whether a tool loads the item now and from which copy (loadsFrom), which the row's
// count and switches ask, and what an Off leaves loaded (keptByOff), which the Profiles page asks (profileplan.ts homeItems).
// What each harness's mark says is the library's plan for the item (library.ts plan), worked out by the kind's view
// (agents.ts agentsView) from the same reading a pass makes (copiesOf), so a mark says what the next pass will do there and
// never something of its own.
import { originWords, theVersion, wantedIn, type LibraryItem, type Plan, type TakeInAnswer, type Version, type VersionChange } from './library.ts';
import { clockTimesApart, dayAndTime } from './model.ts';
import { agentsKeptIn } from './presence.ts';
import { linkLabel, pluginOf } from './sourcelink.ts';
import type { Change, HarnessId, ItemNotice, LibraryFacts, PluginItemNotice, TakenInNotice } from './types.ts';
import { andList, deletedIn, harnessIds, kindNouns, pageNames, readsIt, sentence, toolName, toolsPhrase } from './words.ts';

// ---------- What a kind supplies ----------

/**
 * Said of two edits where no time decided which became the current version (library.ts Plan orderProved), in History and the
 * notice alike, in place of "the latest".
 */
export const noTimeTells = 'the times can’t tell which edit came last';

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
   * A kind with a tool's own switch for an item (skills, MCP servers; LibraryRow `switchedOff`): what a closed-row mark says
   * after "It is switched off in Codex’s own settings:" (`line`, `where` the tool's name), what the tag's tooltip adds, and
   * (`card`: MCP servers, which have no button to clear it) whether the opened row's short label carries both in a `(?)` card.
   */
  switchedOff?: { line(where: string): string; tag(where?: string): string; card?: true };
  /** Agents: tools listed as `'skills folder'` in presence.ts agentsKeptIn (Pi) show `As a skill (?)` on their opened-row line. */
  asSkill?: true;
}

/** A skill's, or an agent's in Pi (a skill there), that the tool's own switch keeps out: the opened row's Let … load it clears it. */
const notLoaded = { line: (where: string) => `${where} doesn’t load it.`, tag: () => 'The opened row can clear it.' };
/**
 * Each kind on the library, in its words, keyed by the page's name for it (app.ts PageKind); the one place they are written
 * (agents.ts takes its Kind's from here). Every other place a kind is wired in is in librarypass.ts's recipe.
 */
export const libraryWords = {
  agents: {
    item: kindNouns.agents.one, an: kindNouns.agents.a, many: kindNouns.agents.many, copy: 'file', body: 'Prompt',
    shared: 'Name, description and prompt are shared; the rest stays in each tool’s file.',
    own: names => `Own settings kept: ${andList([...names])}`,
    switchedOff: notLoaded,
    asSkill: true,
  },
  skills: {
    item: kindNouns.skills.one, an: kindNouns.skills.a, many: kindNouns.skills.many, copy: 'folder',
    shared: 'Each tool it is on in gets the same folder: files as they are, scripts runnable.',
    // A skill's folder is the same in every tool: no part of it stays one tool's own.
    own: () => '',
    switchedOff: notLoaded,
  },
  mcp: {
    item: kindNouns.mcp.one, an: kindNouns.mcp.a, many: kindNouns.mcp.many, copy: 'entry',
    shared: 'Command, arguments, environment, or URL and headers are shared; the rest stays in each tool’s file.',
    own: names => `Own settings kept: ${andList([...names])}`,
    // Claude Code's and Copilot's switch is kept apart from the entry, Codex's, Pi's and OpenCode's in it: either way it stays.
    switchedOff: {
      line: where => `${where} doesn’t start it. Central Knot leaves that switch as it is, so it is still off there after Off and On.`,
      tag: where => `Turn it back on in ${where ? `${where}’s` : 'that tool’s'} own settings.`,
      card: true,
    },
  },
} satisfies Record<string, RowWords>;

// ---------- Where it stands, and each harness's mark ----------

/** One piece of an opened row's tool line (sentences.detailLine): plain text, with an optional info-card text. */
export interface DetailPart { text: string; card?: string }

/** What the page knows of an item besides its library item (the kind's view gives it: types.ts LibraryFacts). */
export interface LibraryRow {
  key: string; name?: string;
  /** A library item linked to a source or plugin (types.ts LibraryFacts fromSource). */
  fromSource?: LibraryFacts['fromSource'];
  /** Each harness's copy, by its content. */
  hashes?: Partial<Record<string, string>>;
  /** In the library: what the next pass does in each harness. */
  plan?: Plan;
  /** Why a harness the item should be in can't be given a copy, and why a harness's copy can't be seen for sure. */
  cannot?: Partial<Record<string, string>>;
  unseen?: Partial<Record<string, string>>;
  /** Found: what a click on its Add does, and what Synchronize everything does with it (types.ts LibraryFacts takeInAnswers). */
  takeInAnswers?: { click: TakeInAnswer; rule: TakeInAnswer };
  /** How a harness has it another way (a link, a folder Central Knot doesn't own, another tool's folder, a plugin), in words. */
  anotherWay?: Partial<Record<string, string>>;
  /** Skills: for a tool reading another managed tool's skills folder (skills.ts anotherWay), which tool's copy it reads. */
  readsFrom?: LibraryFacts['readsFrom'];
  /** Skills: for each tool, managed tools that read its skills folder and would load the skill from there (skills.ts readers). */
  readBy?: LibraryFacts['readBy'];
  loads?: LibraryFacts['loads']; alsoLoads?: LibraryFacts['alsoLoads']; takeOver?: LibraryFacts['takeOver'];
  /** Harnesses whose own switch turns it off there (types.ts LibraryFacts switchedOff), said as offInOwnSettings says it. */
  switchedOff?: readonly string[];
  /** `pluginOn`: the tools with no copy of their own that have it on through an installed plugin (pluginrows.ts pluginOnIn): an Off item is still on there. */
  pluginOn?: readonly string[];
  /** The tools an item from a plugin gets only by installing that plugin (pluginrows.ts withPluginOnly): said apart from those that can't take it. */
  getsWithPlugin?: readonly string[];
}

const FOLLOWS_IN = 'In Pi, OpenCode and Antigravity';
/** How a plugin's item follows its plugin in tools that take no plugins: one home for its row tag (fromSourceWords) and In each tool (?) (pluginToolsCard). */
export const PLUGIN_FOLLOWS = `${FOLLOWS_IN} it follows the plugin; a change you make to it here makes it your own, no longer the plugin’s.`;
/** The card behind In each tool (?) when a plugin supplies the row: plugin-only (`shared` omitted) or plugin-linked (`shared` first). */
export const pluginToolsCard = (shared?: string) => (shared
  ? `${shared} ${PLUGIN_FOLLOWS} Hooks and commands can’t.`
  : `Tools that take plugins get the whole plugin; switches here belong to the plugin. ${FOLLOWS_IN} its items follow the plugin; hooks and commands can’t.`);

/**
 * What an item's row says of the source it is from (types.ts LibraryFacts fromSource): while a version waits there (the item
 * changed here, or a tool's copy unreadable: library.ts changedHere), or once the source removed it (`removed`: library.ts
 * REMOVED AT ITS SOURCE), the tag after its name; and the opened row's line, written around its link to Sources (`before`, the
 * link, `after`), which also says when nothing waits yet but the next change would (`nextWaits`: edited here, an older version
 * made current, or a Merge's result). A plugin's item has no link there: its plugin's strip on the opened row has its page (matrix.ts pluginStrip).
 */
export function fromSourceWords(from: NonNullable<LibraryFacts['fromSource']>): { tag?: { text: string; title: string }; before: string; after: string; page?: 'sources' } {
  const label = linkLabel(from.link);
  // An item a plugin brought (library.ts A PLUGIN): its tag and In each tool (?) card share PLUGIN_FOLLOWS / pluginToolsCard (no standing paragraph).
  if (pluginOf(from.link)) return { tag: { text: `from ${label}`, title: PLUGIN_FOLLOWS }, before: '', after: '' };
  if (from.removed) {
    const off = `${label} no longer has it: it is Off, and no longer from that source. Turn it on to use it again`;
    return { tag: { text: 'removed at its source', title: `${off}.` },
      before: `${off}. Should ${label} have it again, it follows the source if unchanged here, and stays as you have it if you changed it. See `, after: '.', page: 'sources' };
  }
  const changed = 'You changed it here, or a tool’s copy of it can’t be read just now';
  if (from.nextWaits) return { before: `From ${label}, a source. ${changed}, so the source’s next change will wait for you to Merge, Replace mine or Keep mine on `, after: '.', page: 'sources' };
  if (!from.waits) return { before: `From ${label}, a source. What changes there comes in once a day while Automatic sync is on, and at Sync this source on `, after: ', unless you change it here.', page: 'sources' };
  const waits = 'Yours stays current, since it was changed here or a tool’s copy of it can’t be read just now';
  const choose = 'Merge puts its changes into yours if they don’t clash, and Replace mine takes it as it is; either keeps yours as a version.'
    + ' Keep mine keeps yours current, and the source’s version as a version, so it no longer waits.';
  return { tag: { text: 'update at its source', title: `${label} has a newer version. ${waits}. On ${pageNames.sources}, ${choose}` },
    before: `From ${label}, a source, which has a newer version. ${waits}. On `, after: `, ${choose}`, page: 'sources' };
}

/** A harness's own switch that turns the item off there, as its line and tag's tooltip say it: "switched off in Codex’s own settings". */
const offInOwnSettings = (tool: string) => `switched off in ${toolName(tool)}’s own settings`;

export type Place = 'on' | 'off' | 'found';
/** The item when it is in the library (a deleted one is not: what a harness holds of it is found). */
export const inLibrary = (item: LibraryItem | undefined) => (item && !item.deleted ? item : undefined);
export const placeOf = (item: LibraryItem | undefined): Place => { const inLib = inLibrary(item); return !inLib ? 'found' : inLib.on ? 'on' : 'off'; };
/**
 * On, and kept out of some of the home's harnesses by the person (`tools`), or (`row` given) switched off in some of them by
 * their own settings: partial, which the row and its switch say.
 */
export const isPartial = (item: LibraryItem | undefined, tools: readonly string[], row?: LibraryRow) =>
  placeOf(item) === 'on' && (item!.except.some(tool => tools.includes(tool)) || (!!row && tools.some(tool => row.switchedOff?.includes(tool))));

/**
 * What one harness has of an item, as its mark and its line say it, from the plan:
 * - `current`: the current version; `gets-it`: it is written there at the next pass; `edited`: its copy was edited there and
 *   becomes the current version at the next pass; `deleted-by-hand`: its copy was deleted there by hand, which turns the item Off at
 *   the next pass; `leaving`: its copy is removed at the next pass;
 * - `own-copy`: a copy Central Knot didn't put there (a found item's, or one that turned up while the item is Off or kept
 *   out of that harness); `kept-out`: the person keeps the item out of this harness; `none`: no copy;
 * - `another-way`: no copy of its own, and it has the item another way (`anotherWay`), so nothing of Central Knot's goes there;
 * - `cannot`: it can't be given a copy (the row says why); `unseen`: its copy can't be read for sure (or a hold keeps it as it is), so nothing happens there.
 */
export type HarnessIs = 'current' | 'gets-it' | 'edited' | 'deleted-by-hand' | 'leaving' | 'own-copy' | 'kept-out' | 'none' | 'another-way' | 'cannot' | 'unseen';

export function harnessIs(row: LibraryRow, item: LibraryItem | undefined, tool: string): HarnessIs {
  const inLib = inLibrary(item), made = row.plan, harness = tool as HarnessId;
  if (row.unseen?.[tool]) return 'unseen';
  if (row.anotherWay?.[tool] && row.hashes?.[tool] === undefined) return 'another-way';
  // Found (or Off with nothing planned): a harness with no copy that couldn't be given one says so already.
  if (!inLib || !made) return row.hashes?.[tool] !== undefined ? 'own-copy' : row.cannot?.[tool] ? 'cannot' : 'none';
  if (row.cannot?.[tool]) return 'cannot';
  if (made.takeIn === harness) return 'edited';
  if (made.turnedOffBy === harness) return 'deleted-by-hand';
  const step = (['write', 'remove', 'ownCopy', 'current'] as const).find(list => made[list].includes(harness));
  if (step) return ({ write: 'gets-it', remove: 'leaving', ownCopy: 'own-copy', current: 'current' } as const)[step];
  return inLib.on && inLib.except.includes(harness) ? 'kept-out' : 'none';
}

/**
 * Whether one tool loads a library item now, and from which copy, from what the read observed: `central-knot`, a copy Central
 * Knot wrote (item `applied`), in the tool's own folder or in another tool's it reads (LibraryFacts loads `in`, alsoLoads);
 * `elsewhere`, a copy Central Knot doesn't write (in the shared skills folder, a link, a folder of his), which an Off leaves as it
 * is; `plugin`, a plugin's (`pluginOn`: pluginrows.ts pluginOnIn); `unknown`, its copy can't be seen for sure; undefined, none (no
 * copy, or its own switch has it off). Asked by the row's count and switches (loadingIn) and, for what an Off leaves, by keptByOff.
 * A plugin's own item answers from its copies' own fields instead (profileplan.ts keptOn, PluginCopy `way`).
 */
export type LoadsFrom = 'central-knot' | 'elsewhere' | 'plugin' | 'unknown';
export function loadsFrom(row: LibraryRow, item: LibraryItem | undefined, tool: string): LoadsFrom | undefined {
  if (row.unseen?.[tool]) return 'unknown';
  if (row.switchedOff?.includes(tool)) return undefined;
  const has = row.hashes?.[tool] !== undefined, loads = row.loads?.[tool as HarnessId] ?? row.alsoLoads?.[tool as HarnessId];
  if (!has && !loads) return row.pluginOn?.includes(tool) ? 'plugin' : undefined;
  return wrote(item, has ? tool : loads!.in) ? 'central-knot' : 'elsewhere';
}
const wrote = (item: LibraryItem | undefined, tool: string | undefined) => !!tool && inLibrary(item)?.applied[tool as HarnessId] !== undefined;
/** How a tool loads a copy Central Knot doesn't write, where the read knows: the shared skills folder, a link, a copy of his own there, another tool's folder, a plugin's. */
export type LoadWay = 'shared' | 'link' | 'yours' | 'tool' | 'plugin';
/**
 * Whether a tool still loads an item once an Off removes what Central Knot wrote, and how (`way`, where the read knows it): a copy
 * Central Knot doesn't write (loadsFrom `elsewhere`), a plugin's copy of the same item (loadsFrom `plugin`, from the row's
 * `pluginOn`), or, beside Central Knot's in its own folder, one in another tool's folder it reads (alsoLoads). A copy Central Knot
 * wrote beside one it has another way is not counted: which it would then load isn't read.
 */
export function keptByOff(row: LibraryRow, item: LibraryItem | undefined, tool: string): { way?: LoadWay } | undefined {
  const from = loadsFrom(row, item, tool), also = row.alsoLoads?.[tool as HarnessId], loads = row.loads?.[tool as HarnessId];
  if (from === 'plugin') return { way: 'plugin' };
  if (from === 'central-knot') return row.hashes?.[tool] !== undefined && also && !wrote(item, also.in) ? { way: 'tool' } : undefined;
  if (from !== 'elsewhere') return undefined;
  return { way: row.hashes?.[tool] !== undefined ? 'yours' : !loads || (loads.in && loads.in !== tool) ? 'tool' : row.takeOver?.[tool as HarnessId]?.kind };
}
/** Each tool's copy hash, from a view's copies (types.ts LibraryFacts): a row's `hashes`. */
export const hashesOf = (copies: LibraryFacts['copies']) => Object.fromEntries(Object.entries(copies).map(([tool, copy]) => [tool, copy!.hash]));

const KEPT_FIRST = 'before it is written over, a copy Central Knot doesn’t have yet is kept as a version';

/** A found row's Add asks which copy to take in: the take-in table's answer for a click is to wait for a choice. A library item never asks. */
export const asksWhichCopy = (row: LibraryRow) => !!row.takeInAnswers && 'wait' in row.takeInAnswers.click;
/** A found row's Add does something (the take-in table's answer for a click): takes it in, or asks which copy. */
export const canAdd = (row: LibraryRow) => !!row.takeInAnswers && !('leave' in row.takeInAnswers.click);

// ---------- The clicks ----------

/**
 * The item as it is, as a click that changes nothing (a types.ts Change): each click a row's controls or a History entry sends
 * (historyactions.ts) changes one thing of it. `item` as the caller means it: a row's, in the library or none (inLibrary);
 * History's, deleted or not.
 */
export const asItIs = (key: string, item: LibraryItem | undefined): Change => ({ key, on: !!item?.on, except: item ? [...item.except] : [] });
/** A row's item as it is, with whether the page showed it On (`seenOn`): a click made from an older read is refused. */
const rowAsItIs = (row: LibraryRow, item: LibraryItem | undefined): Change =>
  ({ ...asItIs(row.key, inLibrary(item)), seenOn: !!inLibrary(item)?.on });

/**
 * The clicks a row's controls send. Each is a types.ts Change, as every item list sends it, which main.ts's `changes`
 * sanitizer passes on field by field to the library's pass.
 */
export const rowClicks = {
  /** The row's switch, On: a found item is taken in (`use`: the copy every harness takes, where they differ); one in the library is applied. */
  on: (row: LibraryRow, item: LibraryItem | undefined, use?: string): Change =>
    ({ ...rowAsItIs(row, item), on: true, ...(use ? { use: use as HarnessId, useHash: row.hashes?.[use] } : {}) }),
  /** The row's switch, Off: out of every harness; Central Knot keeps it. */
  off: (row: LibraryRow, item: LibraryItem | undefined): Change => ({ ...rowAsItIs(row, item), on: false }),
  /** A harness's own switch in the opened row: kept out of it (`out`), or let in again. */
  inHarness: (row: LibraryRow, item: LibraryItem | undefined, tool: string, out: boolean): Change => {
    const now = rowAsItIs(row, item);
    return { ...now, except: out ? [...now.except, tool as HarnessId] : now.except.filter(other => other !== tool) };
  },
  /** An Off item's tool switch: on in this tool only, kept out of every other tool so one managed later doesn't get it. */
  onOnly: (row: LibraryRow, item: LibraryItem | undefined, tool: string): Change =>
    ({ ...rowAsItIs(row, item), on: true, except: harnessIds.filter(other => other !== tool) }),
  /** Make current, on an earlier version in the opened row. */
  makeCurrent: (row: LibraryRow, item: LibraryItem | undefined, version: string): Change => ({ ...rowAsItIs(row, item), version }),
  /** Delete from Central Knot. */
  remove: (row: LibraryRow, item: LibraryItem | undefined): Change => ({ ...rowAsItIs(row, item), deleted: true }),
};

/**
 * THE TOOL SWITCH: what stands in one tool's place for an item's own switch there, one rule for the Library's opened row (matrix.ts
 * libraryHarnessSwitch) and a plugin's page's item switches (pluginpage.ts itemCells), and found again by their one click (matrix.ts
 * flipInHarness, by switchDrawn) before it acts.
 * `none`: not in the library, or Off and from a plugin. `cannot`: the tool can't take it (`row.cannot` says why). Where it isn't
 * kept out there, the tool's own state in its word: `switched-off` (its own settings keep it off) or `another-way`. `own-copy`:
 * kept out, and the tool loads a copy of his that Central Knot didn't write (its own folder, or one it reads such as the shared
 * skills folder): the Library's switch lets it in over his copy, kept as a version; a plugin's page leaves that to Use the
 * plugin's. `switch`: its switch.
 */
export type ToolSwitch = 'none' | 'cannot' | 'switched-off' | 'another-way' | 'own-copy' | 'switch';
export function toolSwitch(row: LibraryRow, item: LibraryItem | undefined, tool: string): ToolSwitch {
  const lib = inLibrary(item);
  if (!lib || (!lib.on && pluginOf(row.fromSource?.link ?? ''))) return 'none';
  const is = harnessIs(row, lib, tool);
  if (is === 'cannot') return 'cannot';
  if (!lib.on || !lib.except.includes(tool as HarnessId)) return row.switchedOff?.includes(tool) ? 'switched-off' : is === 'another-way' ? 'another-way' : 'switch';
  return is === 'own-copy' || loadsFrom(row, lib, tool) === 'elsewhere' ? 'own-copy' : 'switch';
}
/** A tool's switch as a page drew it: the rule's answer, the tool's mark and whether it was kept out, which its click finds again before it acts (matrix.ts flipInHarness). */
export const switchDrawn = (row: LibraryRow, item: LibraryItem | undefined, tool: string) =>
  ({ at: toolSwitch(row, item, tool), is: harnessIs(row, item, tool), out: !!inLibrary(item)?.except.includes(tool as HarnessId) });
export type SwitchDrawn = ReturnType<typeof switchDrawn>;
/** A tool's own state in its word, where it stands in place of the switch (toolSwitch). */
export const TOOL_STATE_WORDS = { 'switched-off': 'Switched off', 'another-way': 'Another way', 'own-copy': 'Its own copy' } as const;

/** What a tool's own switch for an On item does (`out`: kept out there now), as its tooltip says: in the opened row (matrix.ts) and on a plugin's page under Its items (pluginpage.ts itemSwitch). */
export const inHarnessDoes = (where: string, out: boolean, copy: string) =>
  (out ? `Click to put it in ${where} again, its ${copy} as it was.` : `Click to keep it out of ${where}: its copy there goes, and Central Knot keeps it.`);

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
  return 'differs' in changed ? 'Against the version that took its place' : 'Against the version that was current before it';
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
export function versionOrigin(item: Pick<LibraryItem, 'versions'>, version: Version, when: (back: Version) => string = madeAt): string {
  const back = version.from.how === 'made-current' ? madeFrom(item, version) : undefined;
  return back ? `back to: ${originWords(back.from)}, ${when(back)}` : originWords(version.from);
}

/** How many versions a folded list shows. */
export const FOLDED_VERSIONS = 4;
/** The versions an opened row shows: all of them once unfolded, else the newest few, and how many more there are. */
export function foldVersions(versions: readonly Version[], unfolded: boolean): { shown: readonly Version[]; rest: number } {
  const shown = unfolded ? versions : versions.slice(0, FOLDED_VERSIONS);
  return { shown, rest: versions.length - shown.length };
}

// ---------- Words ----------

/** The tools with a skill's copy outside their own folder (`anotherWay`; none of Central Knot's there), by whether their own switch has it off. */
const outsideCopyIn = (row: LibraryRow, tools: readonly string[], switchedOff: boolean) =>
  tools.filter(tool => row.loads?.[tool as HarnessId] && row.loads[tool as HarnessId]!.switchedOff === switchedOff && !row.hashes?.[tool] && row.anotherWay?.[tool]);
/** The tools that still read an item another way: they have such a copy, and load it. */
const otherReaders = (row: LibraryRow, tools: readonly string[]) => outsideCopyIn(row, tools, false);
/** Each of otherReaders' copies as its tool's line in the details describes it. */
const otherReadLines = (row: LibraryRow, tools: readonly string[]) => otherReaders(row, tools).map(tool => row.anotherWay![tool]!);
/** The tools that have such a copy and don't read it, their own switch having it off, as an Off item's result and tag's tooltip say them. */
export function switchedOffWords(row: LibraryRow, tools: readonly string[]): string[] {
  const held = outsideCopyIn(row, tools, true), one = held.length === 1;
  return held.length ? [`${sentence(named(held, tools))} ${one ? 'has a copy' : 'have copies'} switched off in ${one ? 'its' : 'their'} own settings.`] : [];
}
/**
 * What a result says after an Off of items tools still read another way (otherReaders; its row says which way), one click's
 * or a run's alike: a sentence for the items the same tools read ("Codex and Pi still read a and b another way."). `name`: the
 * item as the result names it.
 */
export function stillReadWords(rows: readonly { name: string; row: LibraryRow }[], tools: readonly string[]): string[] {
  const byReaders = new Map<string, { readers: string[]; names: string[] }>();
  for (const { name, row } of rows) {
    const readers = otherReaders(row, tools), key = readers.join();
    if (readers.length) byReaders.set(key, { readers, names: [...(byReaders.get(key)?.names ?? []), name] });
  }
  // Every name: who still reads what is the point of the sentence.
  return [...byReaders.values()].map(({ readers, names }) => `${sentence(named(readers, tools))} still ${readers.length === 1 ? 'reads' : 'read'} ${andList(names)} another way.`);
}
/** What a result says of found items whose copies differ, which wait for a choice of copy, every one named: one click's or a run's alike. */
export const copiesDiffer = (names: readonly string[]) =>
  `${andList([...names])} ${names.length === 1 ? 'has' : 'have'} differing copies. Choose which copy every tool uses${names.length === 1 ? '' : ' for each'}.`;

/**
 * What an Off row's tag says beyond its heading (undefined for a routine Off item held only in Central Knot): copies that can't
 * be seen (`stillIn`), removals owed until sync runs, tools still reading or holding their own copy (`otherReaders`, `ownNamed`),
 * tools with it on through a plugin (`onThrough`), or tools holding an outside copy switched off in their own settings (`outsideCopyIn`).
 * `underOff`: drops the leading "in Central Knot" and names an own/other-reader copy as "another copy in …" so it never contradicts Off.
 */
function offExtra(row: LibraryRow, item: LibraryItem | undefined, tools: readonly string[], underOff = false): string | undefined {
  const unseen = stillIn(row, item, [], tools);
  if (unseen.length) return `still in ${andList(unseen.map(toolName))}`;
  const owed = removalOwed(row, tools);
  if (owed.length) return `still in ${andList(owed.map(toolName))} until sync runs`;
  const through = onThrough(row, tools);
  const own = ownNamed(row, item, tools, through);
  const readers = otherReaders(row, tools);
  const held = outsideCopyIn(row, tools, true);
  if (readers.length || (through.length && own.length)) {
    const rest = tools.filter(tool => readers.includes(tool) || own.includes(tool) || through.includes(tool)).map(toolName);
    return underOff ? `another copy in ${andList(rest)}` : `in ${andList(['Central Knot', ...rest])}`;
  }
  return through.length ? `on in ${andList(through.map(toolName))} only, through its plugin`
    : own.length ? (underOff ? `another copy in ${andList(own.map(toolName))}` : `in ${andList(['Central Knot', ...own.map(toolName)])}`)
    : held.length ? `${underOff ? '' : 'in Central Knot · '}switched off in ${andList(held.map(toolName))}` : undefined;
}
/**
 * Where an item that is Off is, as its tag, its switch and its status line say it: `offExtra` where a tool still has it,
 * else routine (`leftOut`: installed tools with Manage off).
 */
function offPlace(row: LibraryRow, item: LibraryItem | undefined, tools: readonly string[], leftOut: readonly string[]) {
  return offExtra(row, item, tools) ?? (leftOut.length ? 'in no tool Central Knot manages' : 'in Central Knot only');
}
/**
 * The managed tool whose skills folder `tool` reads this skill from — now (`row.readsFrom`), or once it is on there
 * (`row.readBy`, from `skills.ts readers`: managed, writable, can take it, no copy or way of its own, not disabled).
 * For a found row, such a reader is routine (Add's hover and the tool marks already show it), so `showsPlaceTag` hides its tag.
 */
function readsFolderOf(row: LibraryRow, tool: string): HarnessId | undefined {
  return row.readsFrom?.[tool as HarnessId]
    ?? Object.entries(row.readBy ?? {}).find(([, list]) => list?.includes(tool as HarnessId))?.[0] as HarnessId | undefined;
}
/** Whether a row's placeTag is drawn under `heading` (matrix.ts Role): false when Found or Off already says a routine row's place. */
export function showsPlaceTag(heading: 'on' | 'found' | 'off' | 'away' | 'results', row: LibraryRow, item: LibraryItem | undefined, tools: readonly string[]): boolean {
  const place = placeOf(item);
  if (heading === 'off' && place === 'off') return offExtra(row, item, tools) !== undefined;
  if (heading !== 'found' || place !== 'found' || !canAdd(row)) return true;
  return harnessesWhere(row, item, tools, 'cannot').length > 0
    || harnessesWhere(row, item, tools, 'another-way').some(tool => !readsFolderOf(row, tool));
}
/** The tools that have an Off item on through its plugin (`pluginOn`), in the page's order of `tools` (its own tool first on a tool's page). */
const onThrough = (row: LibraryRow, tools: readonly string[]) => tools.filter(tool => row.pluginOn?.includes(tool));
/** The tools with a copy of their own (ownCopies) an Off item's tag names: beside a plugin on (`through`), only those whose own switch lets them load it. */
const ownNamed = (row: LibraryRow, item: LibraryItem | undefined, tools: readonly string[], through: readonly string[]) =>
  ownCopies(row, item, tools).filter(tool => !through.length || !row.switchedOff?.includes(tool));
/**
 * Whether an item in Central Knot has a change that waits for the next pass, as its status line says it ("when sync runs"): an On
 * item's edit to take in, a copy deleted by hand that turns it off, a copy to write in a tool that can take it, or copies still to
 * be removed. With Automatic sync on a pass follows in seconds; off, they wait for Sync once. The one count of what waits: the
 * Overview's card, and a kind's toolbar and its band with Automatic sync off (matrix.ts toolbarState, syncOffBand).
 */
export const waitsForSync = (row: { on: boolean; edited?: readonly string[]; plan?: Plan; cannot?: Partial<Record<string, string>> }) => (row.on && !!row.edited?.length)
  || !!row.plan?.turnedOffBy || !!row.plan?.write.some(tool => !row.cannot?.[tool]) || !!row.plan?.remove.length;
/** The tools whose copy of an Off item the plan still removes (a removal held: Claude Code's lock, a file that couldn't be written). */
const removalOwed = (row: LibraryRow, tools: readonly string[]) => (row.plan?.remove ?? []).filter(tool => tools.includes(tool));

/** The home's harnesses by name, as a sentence lists them ("all 3 tools", or their names). */
const named = (some: readonly string[], tools: readonly string[]) => toolsPhrase([...some], [...tools]);
/**
 * The tools where an item is still, after a click or while it is Off: those where the click's write or removal didn't go
 * through (`notIn`, clickplan.ts clickResults), and those where Central Knot wrote it (`item.applied`) and its copy can't be
 * seen for sure now (`row.unseen`: two folders named alike but for case, say), where no pass changes anything and so no
 * result names the tool. A tool whose whole file or folder can't be read has every item unseen: one never written there
 * isn't counted.
 */
export const stillIn = (row: LibraryRow, item: LibraryItem | undefined, notIn: readonly string[], tools: readonly string[]) =>
  tools.filter(tool => notIn.includes(tool) || (!!row.unseen?.[tool] && item?.applied[tool as HarnessId] !== undefined));
const harnessesWhere = (row: LibraryRow, item: LibraryItem | undefined, tools: readonly string[], ...states: HarnessIs[]) =>
  tools.filter(tool => states.includes(harnessIs(row, item, tool)));
/** The home's harnesses whose mark says they have a copy of their own, which Central Knot didn't put there (`own-copy`). */
export const ownCopies = (row: LibraryRow, item: LibraryItem | undefined, tools: readonly string[]) => harnessesWhere(row, item, tools, 'own-copy');

/** Where turning an Off item On puts it back, given its kept-out tools, for statusLine and switchLabel. */
function offOnWords(item: LibraryItem | undefined, tools: readonly string[], forSwitch: boolean, ownClause = ''): string {
  const back = tools.filter(tool => !item?.except.includes(tool as HarnessId));
  if (back.length === tools.length) return forSwitch ? `Click to put it in every tool${ownClause}.` : 'On puts it in every tool.';
  if (!back.length) return forSwitch ? 'Click to turn it on (kept out of every tool).' : 'Kept out of every tool; turn on in a tool below.';
  const place = back.length === 1 ? toolName(back[0]!) : `${back.length} of ${tools.length} tools`;
  return forSwitch ? `Click to put it back in ${place}${ownClause}.` : `On puts it back in ${place}${back.length === 1 ? ' only' : ''}.`;
}

/**
 * An opened row's status line: where a found item is and what Add does (and with Synchronize everything on, what the rule does);
 * and where turning an Off item On puts it back (with any still-present or shared copies). Empty on every On row and on a found
 * row that can't be added (its tag and tool lines already say so).
 */
export function statusLine(row: LibraryRow, item: LibraryItem | undefined, tools: readonly string[], everything = false, leftOut: readonly string[] = []): string {
  const where = (...states: HarnessIs[]) => harnessesWhere(row, item, tools, ...states);
  const place = placeOf(item);
  if (place === 'found') {
    const differ = asksWhichCopy(row) ? ', with different copies' : '';
    if (!canAdd(row)) return '';
    const below = where('cannot').length ? ' (see below)' : '';
    const rule = everything && row.takeInAnswers ? ` ${ruleSays(row.takeInAnswers.rule)}` : '';
    return `Not in Central Knot · ${foundWhere(row, item, tools)}${differ}. Add it to keep it in Central Knot${whereAdded(row, item, tools)}${below}.${rule}`;
  }
  if (place === 'off') {
    const own = where('own-copy'), at = offPlace(row, item, tools, leftOut);
    const placePart = at === 'in Central Knot only' ? '' : `${sentence(at)}.`;
    const ownSaid = own.length ? ` ${sentence(named(own, tools))} ${own.length === 1 ? 'has a copy' : 'have copies'} Central Knot didn’t put there.` : '';
    return [placePart, ...otherReadLines(row, tools), `${offOnWords(item, tools, false)}${ownSaid}`].filter(Boolean).join(' ');
  }
  return '';
}

/**
 * What the switch of an item in Central Knot says: where it stands, as its row's tag says it (offPlace; `leftOut` as offPlace's),
 * and what a click does. (A found item has Add instead: addLabel.)
 */
export function switchLabel(row: LibraryRow, item: LibraryItem | undefined, tools: readonly string[], leftOut: readonly string[] = []): string {
  const name = row.name ?? row.key;
  if (placeOf(item) === 'on') {
    const loads = loadingIn(row, item, tools), said = keptOutLoading(loads);
    const where = loads.loading.length < tools.length || said.length ? [` in ${loads.loading.length} of ${tools.length} tools`, ...said].join('; ') : '';
    return `${name}: on${where}. Click to take it out of every tool; Central Knot keeps it.`;
  }
  const own = ownCopies(row, item, tools).filter(tool => !item?.except.includes(tool as HarnessId));
  const kept = own.length === 1 ? 'has a copy of its own, which is' : 'have copies of their own, which are';
  const ownClause = own.length ? `; ${named(own, tools)} ${kept} kept as versions first` : '';
  return `${name}: off, ${offPlace(row, item, tools, leftOut)}. ${offOnWords(item, tools, true, ownClause)}`;
}

/**
 * What a found item's Add says (its tooltip and accessible name): Add takes it into Central Knot and turns it on. `question`:
 * its copies differ, and the click opens or closes the question of which copy Central Knot takes in.
 */
export function addLabel(row: LibraryRow, item: LibraryItem | undefined, tools: readonly string[], question?: 'open' | 'closed'): string {
  const name = row.name ?? row.key;
  if (question) return `Add ${name}: its copies differ. Click to ${question === 'open' ? 'close the question' : 'choose which one Central Knot takes in'}.`;
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

/**
 * The home's harnesses that can't take an item and have no copy of it (the row says why: row.cannot), as lasting as one it is
 * kept out of. One that holds an older copy (its folder locked) has it, and is told by its mark and line alone.
 */
const cannotHave = (row: LibraryRow, item: LibraryItem | undefined, tools: readonly string[]) =>
  tools.filter(tool => harnessIs(row, item, tool) === 'cannot' && row.hashes?.[tool] === undefined);
/**
 * The home's harnesses that load an item (loadsFrom), as its tag and its switch count them: one it is kept out of only where its
 * copy stays so, one Central Knot doesn't write there (a take, library.ts TAKE, leaves his so) or Central Knot's in another tool's
 * folder it reads, not Central Knot's in its own, which leaves when sync runs. Of those kept out, `own` run a copy of their own;
 * `another` have it another way (another tool's folder, a link, a plugin).
 */
export function loadingIn(row: LibraryRow, item: LibraryItem | undefined, tools: readonly string[]) {
  const out = (tool: string) => !!item?.except.includes(tool as HarnessId), from = (tool: string) => loadsFrom(row, item, tool);
  const loading = tools.filter(tool => (from(tool) === 'central-knot' && (!out(tool) || row.hashes?.[tool] === undefined)) || from(tool) === 'elsewhere' || from(tool) === 'plugin');
  const own = loading.filter(tool => out(tool) && harnessIs(row, item, tool) === 'own-copy');
  return { loading, own, another: loading.filter(tool => out(tool) && !own.includes(tool)) };
}
/** What loadingIn's tools kept out say, as the tag and the switch say it: how many run their own copy, and which have it another way. */
const keptOutLoading = ({ own, another }: { own: readonly string[]; another: readonly string[] }) => [own.length === 1 ? '1 runs its own copy' : own.length ? `${own.length} run their own copies` : '',
  another.length ? `${andList(another.map(toolName))} ${another.length === 1 ? 'has' : 'have'} it another way` : ''].filter(Boolean);

/**
 * What Synchronize everything does with a found item, as its row says it while the rule is on (the take-in table's answer for
 * the rule; library.ts takeInAnswer). Nothing where its row already says it can't be added, nor for a copy still being
 * saved, which the page never sees (its look has no settle clock).
 */
export function ruleSays(answer: TakeInAnswer): string {
  if ('take' in answer) return 'Synchronize everything takes it in when sync runs.';
  if ('wait' in answer) return 'Synchronize everything leaves it for you to choose: its copies differ.';
  return { deleted: 'It was deleted from Central Knot, so it will not be added by itself again. Add, or Restore in History, brings it back.',
    'switched-off': 'Synchronize everything leaves it: every tool that has it has it switched off in its own settings, so only Add takes it in.',
    settling: '', 'held-back': '', 'no-copy': '', 'choice-changed': '' }[answer.leave];
}
/** Where a found item is: "in Claude Code and Codex", or, with no copy of a harness's own, "Pi has it another way". */
function foundWhere(row: LibraryRow, item: LibraryItem | undefined, tools: readonly string[]) {
  const own = harnessesWhere(row, item, tools, 'own-copy');
  if (own.length) return `in ${named(own, tools)}`;
  const another = harnessesWhere(row, item, tools, 'another-way');
  return `${sentence(named(another, tools))} ${another.length === 1 ? 'has' : 'have'} it another way`;
}

/**
 * The sentences that name the item or its copies, in one kind's words: closed-row marks (harnessLine), opened-row lines
 * (detailLine), the tag after its name (placeTag), what each click's result says (said), and sync notices (noticeWords).
 */
export function sentences(words: RowWords) {
  const { item: noun, copy } = words;

  /**
   * Closed-row tool marks' whole sentence (matrix.ts libraryMark hover and aria-label); kept whole so marks never fall back to
   * "No copy while it is off." for an On or kept-out tool. Opened-row lines use `detailLine` below from the same facts.
   */
  function harnessLine(row: LibraryRow, item: LibraryItem | undefined, tool: string, where: string): string {
    const off = row.switchedOff?.includes(tool) && words.switchedOff ? `It is ${offInOwnSettings(tool)}: ${words.switchedOff.line(where)}` : '';
    return [hasLine(row, item, tool, where), off].filter(Boolean).join(' ');
  }

  /**
   * Opened-row tool line (matrix.ts detailToolLine): short labels and optional `(?)` cards from the same `harnessIs`/`hasLine`
   * facts as `harnessLine`, cutting standing filler while keeping action-needed and outside-copy lines whole.
   */
  function detailLine(row: LibraryRow, item: LibraryItem | undefined, tool: string, where: string, own: readonly string[] = []): DetailPart[] {
    const inLib = inLibrary(item), has = row.hashes?.[tool] !== undefined, is = harnessIs(row, item, tool);
    const parts: DetailPart[] = [];
    const reads = is === 'another-way' && !(inLib?.on && !wantedIn(inLib, tool as HarnessId)) ? row.readsFrom?.[tool as HarnessId] : undefined;
    if (reads) {
      const from = toolName(reads);
      parts.push({ text: `Reads ${from}’s copy`, card: `${where} reads this skill from ${from}’s folder; Central Knot writes nothing to ${where} meanwhile.` });
    } else if (is === 'none' && inLib) {
      if (inLib.except.includes(tool as HarnessId)) parts.push({ text: 'Kept out' });
      const also = !inLib.on && !pluginOf(row.fromSource?.link ?? '') ? row.readBy?.[tool as HarnessId] : undefined;
      if (also?.length) parts.push({ text: `If on, ${readsIt(also)} too` });
    } else if (is !== 'current' && is !== 'kept-out') {
      const waits = !inLib && is === 'another-way' ? readsFolderOf(row, tool) : undefined;
      parts.push({ text: waits ? `Gets it from ${toolName(waits)}’s skills folder once it is on there.` : hasLine(row, item, tool, where) });
    }
    if (words.asSkill && (agentsKeptIn as Partial<Record<string, string>>)[tool] === 'skills folder'
      && has && ['current', 'gets-it', 'edited', 'leaving', 'own-copy'].includes(is)) {
      const turnsOff = is !== 'leaving' && is !== 'own-copy' && !!inLib && wantedIn(inLib, tool as HarnessId) && inLib.applied[tool as HarnessId] !== undefined;
      const card = `${where} has no agents: this is a skill file, with no context, tool limits or model of its own.${turnsOff ? ` Deleting it in ${where} turns the agent off everywhere.` : ''}`;
      parts.push({ text: 'As a skill', card });
    }
    if (row.switchedOff?.includes(tool) && words.switchedOff) {
      const card = words.switchedOff.card ? `${words.switchedOff.line(where)} ${words.switchedOff.tag(where)}` : undefined;
      parts.push({ text: `Off in ${where}’s settings`, ...(card ? { card } : {}) });
    }
    const ownText = own.length ? words.own(own) : '';
    if (ownText) parts.push({ text: ownText });
    return parts;
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
      case 'deleted-by-hand': {
        const place = row.plan?.sharedWay === 'copy' ? deletedIn(tool, 'copy') : where;
        return `Its copy was deleted in ${place}. When sync runs, the ${noun} turns off; Central Knot keeps it.`;
      }
      case 'leaving': {
        const kept = row.plan?.keep.some(entry => entry.harness === tool);
        return kept ? 'Has a copy Central Knot doesn’t have yet. When sync runs it is kept as a version, then removed.' : 'Its copy is removed when sync runs. Central Knot keeps it.';
      }
      case 'own-copy':
        if (!inLib) return 'Has it.';
        return `Has a copy Central Knot didn’t put there. It is left alone while ${inLib.on ? 'this tool is kept out' : `the ${noun} is off`}; ${KEPT_FIRST}.`;
      case 'kept-out': return `Kept out of this tool. Central Knot keeps its ${copy} for when you turn it on here.`;
      case 'none':
        if (!inLib) return canAdd(row) ? 'No copy. Adding it puts it here.' : 'No copy.';
        if (pluginOf(row.fromSource?.link ?? '')) return 'No copy while it is off.';
        return inLib.except.includes(tool as HarnessId) ? 'Kept out' : '';
      case 'cannot': return row.cannot![tool]!;
      case 'unseen': return row.unseen![tool]!;
    }
  }

  /**
   * The tag after an item's name when it isn't plainly on everywhere: where it stands, or the tools it is kept out of, and
   * (its tooltip) what that means. `tools`: the home's harnesses; `leftOut`: the installed tools left out (offPlace); `underOff`:
   * row sits under the Off heading, so a kept Off tag drops the leading "in Central Knot" (offExtra).
   */
  function placeTag(row: LibraryRow, item: LibraryItem | undefined, tools: readonly string[], leftOut: readonly string[] = [], underOff = false): { text: string; title: string; warn?: boolean } | undefined {
    const place = placeOf(item);
    const unseen = stillIn(row, item, [], tools);
    const through = onThrough(row, tools), own = ownNamed(row, item, tools, through);
    const none = [through.length ? `${andList(through.map(toolName))} ${through.length === 1 ? 'has' : 'have'} it on through its plugin: its switch there, in the opened row, turns that off.` : '',
      own.length ? `${sentence(named(own, tools))} ${own.length === 1 ? 'has a copy' : 'have copies'} Central Knot didn’t put there, left alone while the ${noun} is off.` : ''].filter(Boolean).join(' ')
      || (switchedOffWords(row, tools)[0] ?? (leftOut.length ? `No tool it manages has it until you turn it on; ${andList(leftOut.map(toolName))}, left out, ${leftOut.length === 1 ? 'keeps whatever it has' : 'keep whatever they have'}.`
      : 'No tool has it until you turn it on.'));
    const owed = andList(removalOwed(row, tools).map(toolName));
    // Its tooltip says why it is where its text says (offPlace): a copy that can't be seen, a removal still owed, or where else it is.
    if (place === 'off') return { text: (underOff ? offExtra(row, item, tools, true) : undefined) ?? offPlace(row, item, tools, leftOut), title: unseen.length ? unseen.map(tool => row.unseen![tool]).join(' ')
      : owed ? `Off. Central Knot keeps this ${noun}; its ${copy} leaves ${owed} when sync runs.` : `Central Knot keeps this ${noun} and its versions. ${otherReadLines(row, tools).join(' ') || none}` };
    const found = `A tool has this ${noun}; Central Knot doesn’t yet. Add it to keep it in Central Knot${whereAdded(row, item, tools)}.`;
    if (place === 'found' && !canAdd(row)) return { text: 'can’t be added', title: 'Its line in the opened row says why.', warn: true };
    if (place === 'found') return { text: 'not in Central Knot', title: found };
    const out = item!.except.filter(tool => tools.includes(tool)), keptOut = `Kept out of ${andList(out.map(toolName))}. Its switch there, in the opened row, puts it back.`;
    // A tool that can't take it and has no copy is as lasting as one it is kept out of: the tag names where it is.
    const cannot = cannotHave(row, item, tools), loads = loadingIn(row, item, tools), loading = loads.loading, away = out.filter(tool => !loading.includes(tool));
    // Partial: kept out of some of the tools by the person's choice (or by a take), and said as such, never as On everywhere.
    const where = out.length ? [`in ${loading.length} of ${tools.length} tools`, ...keptOutLoading(loads), away.length ? `kept out of ${andList(away.map(toolName))}` : ''].filter(Boolean).join(' · ')
      : cannot.length ? (loading.length ? `${andList(loading.map(toolName))} only` : 'in no tool') : '';
    const whereTitle = [...cannot.map(tool => row.cannot![tool]!), out.length ? keptOut : ''].filter(Boolean).join(' ');
    // A tool's own switch that turns it off: said too, so an item switched off everywhere never reads as plainly on.
    const switched = tools.filter(tool => row.switchedOff?.includes(tool) && !out.includes(tool as HarnessId));
    const off = !switched.length ? '' : switched.length === tools.length && switched.length > 1 ? `switched off in all ${switched.length} tools` : `switched off in ${andList(switched.map(toolName))}`;
    const whose = sentence(andList(switched.map(offInOwnSettings)));
    const offTitle = switched.length ? `${whose}: each tool’s own switch, which Central Knot leaves as it is. ${words.switchedOff?.tag() ?? ''}`.trim() : '';
    const text = [where, off].filter(Boolean).join(' · ');
    return text ? { text, title: [whereTitle, offTitle].filter(Boolean).join(' ') } : undefined;
  }

  /**
   * What the result says after each click. `notIn`: the harnesses where the click's write or removal didn't go through; `own`
   * (Off's): those with a copy of their own, which Off leaves alone (ownCopies). `ways`: the tools still reading it another way (stillReadWords).
   */
  const said = {
    off(name: string, notIn: readonly string[], tools: readonly string[], leftOut: readonly string[] = [], own: readonly string[] = [], ways: readonly string[] = []): string {
      const left = notIn.length ? `, but still in ${named(notIn, tools)}` : own.length ? `, but ${named(own, tools)} ${own.length === 1 ? 'has a copy' : 'have copies'} Central Knot didn’t put there`
        : ways.length ? '' : leftOut.length ? ': no tool Central Knot manages has it' : ': no tool has it';
      return [`${name} is off${left}.`, ...ways, `Central Knot keeps it, and turning it on puts each ${copy} back as it was.`].join(' ');
    },
    /** A found item taken in; `use`: the harness whose copy was chosen where they differed. */
    takenIn(name: string, on: readonly string[], tools: readonly string[], use?: string, another: readonly string[] = []): string {
      const chosen = use ? `, with ${toolName(use)}’s copy` : '', others = use ? ' The other copies are kept as its versions.' : '';
      const way = another.length ? `; ${andList(another.map(toolName))} ${another.length === 1 ? 'has' : 'have'} it another way` : '';
      return `${name} is in Central Knot now${chosen}, and ${on.length ? `on in ${named(on, tools)}` : 'not on in any tool yet'}${way}.${others}`;
    },
    /** One harness's switch: kept out (`out`), or let in again. */
    inHarness(name: string, tool: string, out: boolean, failed: boolean): string {
      const where = toolName(tool);
      if (!out) return failed ? `${name} couldn’t be put in ${where}.` : `${name} is on in ${where} again.`;
      return failed ? `${name} couldn’t be taken out of ${where} yet.` : `${name} is kept out of ${where}. Central Knot keeps its ${copy} for when you turn it on there.`;
    },
    /** An Off row's tool switch: on in one tool, naming every other tool holding it; "only" when every installed tool is managed. */
    onOnly(name: string, tool: string, failed: boolean, row?: LibraryRow, tools: readonly string[] = [], item?: LibraryItem, leftOut: readonly string[] = []): string {
      const where = toolName(tool);
      if (failed) return `${name} couldn’t be put in ${where}.`;
      if (!row) return `${name} is on in ${where}.`;
      const left = (taken: readonly string[]) => tools.filter(each => each !== tool && !taken.includes(each));
      const through = onThrough(row, left([]));
      const readers = otherReaders(row, left(through));
      const own = ownCopies(row, item, left([...through, ...readers]));
      const still = left([...through, ...readers, ...own]).filter(each => row.hashes?.[each] !== undefined || stillIn(row, item, [], [each]).length > 0);
      const say = (list: readonly string[], one: string, many: string) => (list.length ? `${andList(list.map(toolName))} ${list.length === 1 ? one : many}.` : '');
      const extra = [say(readers, 'reads it too', 'read it too'), say(own, 'has its own copy', 'have their own copies'),
        say(through, 'has it on through its plugin', 'have it on through its plugin'), say(still, 'still has a copy', 'still have copies')].filter(Boolean);
      return extra.length ? [`${name} is on in ${where}.`, ...extra].join(' ') : `${name} is on in ${where}${leftOut.length ? '' : ' only'}.`;
    },
    /** `when`: the version's time (versionClock). `on`: the harnesses it was written to; undefined for an item that is Off. */
    madeCurrent(name: string, version: Version, when: string, on: readonly string[] | undefined, tools: readonly string[]): string {
      const where = on ? `, in ${named(on, tools)}.` : '. It is Off, so no tool was changed.';
      return `${name}: ${theVersion(version.from)}, ${when}, is current again${where}`;
    },
    /** `left`: the tools it is still in (stillIn). */
    deleted: (name: string, wasOn: boolean, left: readonly string[] = [], tools: readonly string[] = []) =>
      `${name} is deleted from Central Knot${!wasOn ? '' : left.length ? `, but still in ${named(left, tools)}` : ', and out of every tool'}. History can restore it.`,
    /** Under Delete it now: what happens, and for how long History can restore it (`days`: History's days, from Settings). */
    deleteArmed: (days: number) => `Removed from Central Knot and every tool it manages. History can restore it for ${days} days.`,
  };

  /**
   * What sync did to an item on its own, as its notice says it: an edit taken in as the current version, the one of two edits
   * taken in (the latest, where times prove it), or a copy deleted by hand that turned the item off. `action`: the notice's button, which runs its History entry's
   * own action (historyactions.ts); `help`: what that does.
   */
  function noticeWords(notice: Pick<ItemNotice, 'kind' | 'item' | 'winner' | 'losers' | 'orderProved' | 'sharedWay' | 'stillRead' | 'settingsChanged'> | PluginItemNotice)
    : { text: string; action?: 'undo' | 'turn-on'; help: string } {
    // A plugin's item (library.ts A PLUGIN): let go as the person's own, said with no button (History has the entry), or dropped.
    if ('link' in notice) return notice.kind === 'let-go' ? { text: `${notice.item} is your own now: you changed it here, so it no longer follows ${linkLabel(notice.link)}. It stays in the tools that have it; its row lets it into the others.`, help: '' }
      : { text: `${notice.item}: ${linkLabel(notice.link)} no longer has it, so it is off. Central Knot keeps it.`, action: 'turn-on', help: `Put ${notice.item} back in every tool, as your own: it no longer follows the plugin` };
    const who = toolName(notice.winner), others = andList(notice.losers.map(toolName)), name = notice.item;
    const earlier = `Make the version from before ${who}’s edit current again, in every tool ${name} is on in`;
    if (notice.kind === 'deleted-by-hand') {
      // The tools it was taken out of.
      const place = deletedIn(notice.winner, notice.sharedWay), readers = notice.stillRead ?? [];
      const still = readers.length ? ` ${andList(readers.map(toolName))} still ${readers.length === 1 ? 'reads' : 'read'} it another way.` : '';
      const changed = notice.settingsChanged ? ` ${notice.settingsChanged.join(' ')}` : '';
      const text = `${name} was deleted in ${place}, so it is off${others ? ` and was taken out of ${others}` : ''}.${still} Central Knot keeps it.${changed}`;
      // What it had through the shared folder isn't put back: each tool gets Central Knot's own copy (library.ts THE SHARED FOLDER).
      const help = notice.sharedWay === 'link' ? `Put ${name} in ${who} as Central Knot’s own ${copy}; the tools that read the shared copy still have it`
        : notice.sharedWay ? `Put ${name} in every tool as Central Knot’s own ${copy}, in place of a link that leads nowhere`
        : `Put ${name} back in every tool, each ${copy} as it was`;
      return { text, action: 'turn-on', help };
    }
    if (notice.kind === 'conflict') {
      const chosen = notice.orderProved ? `${who}’s edit is the latest, so it is the current version` : `${who}’s edit is the current version, though ${noTimeTells}`;
      return { text: `${name}: ${chosen}. ${others}’s is kept as a version.`, action: 'undo', help: earlier };
    }
    return { text: `${name} was edited in ${who}; that is its current version now${others ? `, in ${others} too` : ''}.`, action: 'undo', help: earlier };
  }

  /**
   * What Synchronize everything's notice says (types.ts TakenInNotice), on its page and in Settings: how many it added and
   * where it found them, their names, and (unless `history` is false, as on Settings while the band holds Undo) that History
   * can undo each. `lead: false` omits the repeated "Synchronize everything" lead under Settings' own row.
   */
  function takenInWords(notice: Pick<TakenInNotice, 'items' | 'from' | 'settingsChanged'>, options?: { history?: boolean; lead?: boolean }): string {
    const { history = true, lead = true } = options ?? {};
    const count = notice.items.length, from = andList(notice.from.map(toolName));
    const what = lead ? `Synchronize everything took in ${count} ${count === 1 ? noun : words.many}, found in ${from}: ${andList(notice.items)}.`
      : count === 1 ? `Added ${noun} ${notice.items[0]} from ${from}.` : `Added ${count} ${words.many} from ${from}: ${andList(notice.items)}.`;
    const tail = history ? ` History can undo ${count === 1 ? 'it' : 'each'}.` : '';
    return `${what}${notice.settingsChanged ? ` ${notice.settingsChanged.join(' ')}` : ''}${tail}`;
  }

  return { harnessLine, detailLine, placeTag, said, noticeWords, takenInWords };
}
