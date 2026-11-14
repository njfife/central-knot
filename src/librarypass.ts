// The pass: the library's model (library.ts) carried out on real files, the same for every kind of item. A kind (skills.ts,
// servers.ts, agents.ts) implements `Kind`, below, and nothing else: where a harness keeps it, how a copy is read, written and
// removed in that harness's format, a harness's own part, and its record and store. Everything here is the same for every kind:
//
//   lookAt         each managed harness's copies, read once through the kind (Disk); a copy that can't be read for sure is
//                  unseen, never missing
//   deletionsTold  a deleted item that History has no standing entry for gets one, so it always has its Restore
//   pull, click    what Pull brings, and what the person asked (On, Off, a harness kept out, a version made current, Delete,
//                  Restore, a found item taken in by Add), recorded on the item
//   takeInByRule   in main.ts's pass of the whole home only (PassOptions background), with the home's Synchronize everything
//                  on: each found item the take-in table lets it take (library.ts takeInAnswer, through foundKey), taken in as
//                  Add takes it (takeIn); History's entry is an Add's, and the pass's one notice says what it took in
//   guardFolders   on the items as the clicks left them: a harness managed again (library.ts managedAgain, for every item at
//                  once), a folder moved, made again or gone
//   syncItem       the library's plan for the item (copiesOf, plan), carried out by carryOut: History first (logItem), then
//                  versions and the record, then each harness's copy (writeCopy, removeCopy, through the kind)
//   keepFolders    the folder identities the next pass compares with
//
// Also here: the page's look (lookFor: the same reading, guards applied in memory, nothing saved), so a mark says what a pass
// will do, and a found row's answers from the take-in table (takeInAnswers); History entries' actions (restoreAll; restore for one),
// decided on the copies as this look reads them now (itemsNow), each always one of the clicks above; and for the tool choice (toolchoice.ts), folders let go (forgetFolders) and what managing
// a tool would do there, counted from the same look with it added (joinCounts). What a kind's page shows, and how the Git
// repo reads it, stay with the kind (agents.ts agentsView and agentsForRepo, skills.ts skillsView and skillsForRepo, servers.ts
// serversView and serversForRepo). History's sentences and actions for the library's entries are historyactions.ts's.
//
// Two members exist for a kind whose copies are entries in one shared file (MCP servers), and change nothing for a kind of
// folders (skills, agents), which leaves the first out and never sets the second:
// - Kind.folderSeen answers the guard's look in place of its `stat` of a directory: a missing file is away (its entries are
//   written afresh once the settle window has passed, never read as deletions), one that is there keeps one fixed identity
//   (every save replaces the file, so an inode says nothing), and a file the pass itself made is noted as there at its end.
// - Disk.locked's `waits`: a harness whose writes wait for a step of the person's own (Claude Code's settings file, until Write
//   to Claude Code, which runs the pass with a kind whose read leaves it out). Its copies are planned as any other's; the pass
//   leaves each write and removal there undone, answers it held with `waits`, and A stays, so the next look still owes it.
//
// Words: a `Kind` is what one kind implements (below); its `Disk` is what it read of the managed harnesses now; a `Look` is
// one pass's or one page's reading (the Disk with the record, the folders and the settle clock); a `Shelf` (library.ts)
// stores a version's content and saves the record; `Hands` (library.ts) is what carryOut is given to act with, which
// syncItem builds from the Kind. An `ItemClick` is what a person asked of one item (On, kept out, a version, Delete). A copy
// that can't be seen for sure is `unseen` (Disk.unseen says why); a `held` copy is one nothing of Central Knot's goes to
// (Disk.held, and a folder that can't be written: Disk.locked). A pass answers with a types.ts PassResult; a result in it
// with `outcome: 'held'` (types.ts DestinationResult, the app's word for an action not done this time) is not a held copy.
//
// Where the library meets the app's types: a click comes as a types.ts Change (a row's, or a History entry's action) and
// itemClick makes it an ItemClick (`managed` is On); a kind's page view is a types.ts LibraryView, which the pages read through
// itemrow.ts kindSource.
//
// To put another kind on the library, every place it is wired in (this is the one list; librarypages.ts and LEDGER point
// here, and the compiler names a member `Kind` lacks):
// - the contract: its name in library.ts ItemKind, and one object implementing `Kind`, like agents.ts agentKind (a kind with
//   no part of its own per tool has `ownOf` answer undefined and `keepOwn` false; its read fills Disk.parts where a plugin's
//   part is one of its found copies, as share.ts partsIn gives them);
// - its callers: runPass for its passes (the app's clicks through itemClick), restore for History's actions, lookFor for its
//   page's view, and forgetFolders and joinCounts from toolchoice.ts;
// - its view: a types.ts LibraryView (as agents.ts agentsView gives), kept in types.ts HomeView under the page's name for the
//   kind (app.ts PageKind), and read there by itemrow.ts kindSource and the page's bands and notices (matrix.ts listView),
//   with no edit of their own;
// - its page: its words in libraryrow.ts libraryWords (agents.ts takes its Kind's from there), and its entry in
//   librarypages.ts libraryPages (how Read gets a version, what its opened row shows of its own); matrix.ts then draws its
//   rows as library rows, with no edit;
// - the app's wiring: app.ts kindPages (how its clicks are sent; where its last result is kept, which lastResult reads),
//   main.ts (its passes, in the background and on a click through the `changes` sanitizer; its view; a History action
//   sent on by its key's prefix), preload.ts (the page's calls);
// - History's sentences and actions for its entries: historyactions.ts, in the kind's words (historypage.ts asks it).
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { carryOut, itemKey, keepVersion, managedAgain, newItem, pendingChanges, plan, setCurrent, takeInAnswer, versionAt, wantedIn } from './library.ts';
import type { ItemNow } from './historyactions.ts';
import type { Copies, FoundCopy, FoundKey, HarnessCopy, ItemKind, LeftFound, LibraryItem, Plan, Shelf, Source, TakenBy, Version } from './library.ts';
import { appendHistory, historyCutoff, readHistory, replaceHistory } from './history.ts';
import { errorCode, libraryGate, stillOwned } from './share.ts';
import type { ShareContext } from './share.ts';
import type { Change, DestinationResult, HarnessId, HistoryEvent, ItemNotice, JoinCounts, PassResult, SyncNotice, TakenInNotice } from './types.ts';
import { byToolOrder, notManagedHere, toolName } from './words.ts';

const now = () => new Date().toISOString();

// ---------- What a kind implements ----------

/** One harness's copy of an item as the kind read it: what the pass needs of it (a kind's own entry carries more). */
export interface Seen {
  tool: HarnessId;
  /** The item's name as this copy has it: a found item is taken in under it, and its path is pathOf this name. */
  name: string;
  /** Its content's hash: the version it would be. */
  hash: string;
  /** When it was last changed (ms); absent where a copy has no time of its own (library.ts HarnessCopy). */
  at?: number;
}

/** The managed harnesses' copies of one kind now, read once (Kind.read) for a pass, or for a look of the page. */
export interface Disk<Entry extends Seen> {
  /** Each item's copies, by key, then harness. */
  byKey: Map<string, Partial<Record<HarnessId, Entry>>>;
  /** Why a copy can't be seen for sure, by `harness:key` (`harness:*`: the whole folder): it is `unseen`, and nothing happens there. */
  unseen: Map<string, string>;
  /**
   * Why a harness's folder can't be written now: no copy there can be written or removed (its copies are still read). `waits`:
   * the writes wait for a step of the person's own (Claude Code's settings file, written only by Write to Claude Code), so the
   * pass leaves each write and removal there undone, answers it held with `waits`, and plans it as it would any other.
   * Write to Claude Code's own pass turns it round: there every other harness waits (servers.ts), so that click writes Claude
   * Code alone and the next pass finishes the rest.
   */
  locked: Map<HarnessId, { why: string; waits?: true }>;
  /** What could not be read, in words for the page. */
  problems: string[];
  /**
   * Why a harness the item is wanted in is held (library.ts HarnessCopy), for the kind's own reasons: it can't be given a
   * copy (a name it can't store), or it has it another way (`anotherWay`: through a plugin, a tool that reads another's folder
   * while the item is in that one, a link or a folder Central Knot doesn't own). Undefined when it can be given it. Asked
   * also where the harness has a copy of its own: there only `anotherWay` counts (library.ts, the table's last row). `item` is
   * as this pass's clicks left it, so library.ts wantedIn says where else it is wanted and `applied` whether a copy elsewhere
   * is Central Knot's; what the other harnesses hold is this Disk's (byKey, unseen). A folder that can't be written is
   * `locked`, which the pass adds itself. Worked out at each look, never stored.
   */
  held(item: Wanted, harness: HarnessId): { why: string; anotherWay?: true } | undefined;
  /**
   * Why a harness won't load the item's current version, where that holds whether or not it has a copy (a skill's shape a tool
   * refuses): nothing of the item is written there, so a copy it has stays as it is and is `held`. A kind with no such reason
   * leaves it out.
   */
  refuses?(item: Wanted, harness: HarnessId): string | undefined;
  /**
   * Copies a harness has another way, read but never written or removed by Central Knot (a link in its folder, a copy in a
   * folder it doesn't own), by key, then harness: a found item can be taken in from one (foundCopies). A kind with none leaves
   * it out.
   */
  outside?: Map<string, Partial<Record<HarnessId, Entry>>>;
  /**
   * The harnesses whose own copy is a plugin's part (parts.ts: put there where the tool can't take the plugin), by key, which
   * Synchronize everything leaves found (library.ts takeInAnswer). A kind whose parts are never found copies (MCP servers:
   * unseen, "it is the plugin's") leaves it out.
   */
  parts?: Map<string, HarnessId[]>;
  /** Keys Convert to skill made from an agent (agentskill.ts), which the rule leaves found. A kind with none leaves it out. */
  converted?: Map<string, unknown>;
  /**
   * The harnesses whose own switch turns the item off there (skillswitch.ts, mcpswitch.ts), by key: where every found copy is
   * off, the rule leaves it found. A kind with no such switch (agents) leaves it out.
   */
  switchedOff?: Map<string, HarnessId[]>;
}
/**
 * An item as Disk.held is told of it: its name, where it is wanted (library.ts wantedIn), what was applied where, and its
 * current version as this pass's clicks left it (none for a found item, which is asked about as taking it in would leave it),
 * and each harness's own part where the record keeps one.
 */
export type Wanted = Pick<LibraryItem, 'key' | 'name' | 'on' | 'except' | 'deleted' | 'applied'> & Partial<Pick<LibraryItem, 'hash' | 'own'>>;

/** One kind's part of the library as its record holds it: its items, and each harness's folder as a pass last saw it. */
export interface KindLibrary { items: Record<string, LibraryItem>; folders: Partial<Record<HarnessId, FolderSeen>> }
/** A harness's folder for a kind as a pass last saw it: where it is, and its identity on disk (`away`: it wasn't there). */
export type FolderSeen = { path: string } & ({ away: true } | { ino: number; birth: number });

/**
 * What a kind must implement to be carried by the library. `Content` is what a version holds (an agent's shared part);
 * `Entry` one harness's copy as read; `D` the reading of every harness, when the kind's page needs more of it than Disk.
 * Agents are the worked example (agents.ts agentKind).
 */
export interface Kind<Content, Entry extends Seen, D extends Disk<Entry> = Disk<Entry>> {
  kind: ItemKind;
  /** How a sentence names one item, one copy and a harness's folder of them: "agent", "file", "agents folder". */
  words: { item: string; copy: string; folder: string };
  /** History's entries about this kind are keyed `<historyPrefix><item key>` ("agent:reviewer"). */
  historyPrefix: string;
  /** Of the harnesses Central Knot manages, those that can hold this kind. */
  harnesses(tools: readonly HarnessId[]): HarnessId[];
  /** A harness's folder for this kind, which the pass guards (gone, moved, made again), and the path of one item's copy in it. */
  folder(context: ShareContext, harness: HarnessId): string;
  /** One copy's path, which keys the settle clock: unique per item in a harness (an MCP server's is its entry in the settings file). */
  pathOf(context: ShareContext, harness: HarnessId, name: string): string;
  /**
   * The guard's look at a harness's folder, in place of its `stat` of a directory (guardFolders): for a kind whose copies share
   * one file (MCP servers' settings file), the file away when it is missing, else one fixed identity, so a file rewritten by a
   * save is never a folder made again. Asked again at the end of a pass for a file noted away (runPass), since the pass may have
   * made it. A kind of folders leaves it out.
   */
  folderSeen?(context: ShareContext, harness: HarnessId): Promise<FolderSeen>;
  /**
   * Its record: opened (an older one migrated; `persist`: the caller may write it; nothing recorded yet: an empty one) and
   * saved. A `problem` stops every write.
   */
  open(context: ShareContext, persist?: boolean): Promise<{ library: KindLibrary; problem?: string }>;
  save(home: string, library: KindLibrary): Promise<void>;
  /** A version's content: stored under the item by its hash (storing it again changes nothing), read back, and hashed. */
  store(context: ShareContext, item: LibraryItem, hash: string, content: Content): Promise<void>;
  readVersion(context: ShareContext, key: string, hash: string): Promise<Content | undefined>;
  hashOf(content: Content): string;
  /** Finishes a write or removal a crash interrupted in a harness's folder, so a copy moved aside is never read as deleted. */
  recover(context: ShareContext, harness: HarnessId): Promise<void>;
  /** Reads what each managed harness holds now. A copy that can't be read for sure is `unseen`, never left out. */
  read(context: ShareContext, managed: HarnessId[]): Promise<D>;
  /** A copy's content, as a version holds it. */
  contentOf(entry: Entry): Content;
  /**
   * A harness's own part (library.ts: the part of its copy a version doesn't hold): its text in a copy, and keeping that text
   * as the item's own part there (`own`), true when it differs from what was kept. The caller saves the record. A kind with
   * no own part answers undefined, and its keepOwn is never called (`async () => false`).
   */
  ownOf(entry: Entry): string | undefined;
  keepOwn(context: ShareContext, item: LibraryItem, harness: HarnessId, text: string): Promise<boolean>;
  /**
   * Writes a version into one harness in its format: over its copy (`here`, only while it is as read), every byte of its own
   * part kept; else as the copy the harness last had (its kept own part), or a new one. Answers why it could not be written,
   * if it couldn't (the next pass tries again). What it wrote is that harness's own part from then on: kept by the kind here
   * (agents), or by the next pass's keepOwn before anything there is removed (MCP servers).
   */
  write(context: ShareContext, item: LibraryItem, harness: HarnessId, here: Entry | undefined, content: Content): Promise<{ stopped: string } | undefined>;
  /**
   * Why a harness won't load this content, asked by writeCopy of the current version just before it writes it there (Disk.refuses
   * answered for the version the look read; an edit this same pass took in may be one the harness won't load). Not asked by
   * giveBackCopy, which puts back the harness's own copy as it was. A kind with no such reason leaves it out.
   */
  refusesToLoad?(context: ShareContext, item: LibraryItem, harness: HarnessId, content: Content): Promise<string | undefined>;
  /** Removes one harness's copy, only while it is as read: `changed` when a save landed meanwhile. */
  remove(context: ShareContext, item: LibraryItem, here: Entry): Promise<'removed' | 'changed' | 'failed'>;
  /**
   * A History entry's action as the click it is (the app's, as the page would send it: restore makes it the library's with
   * itemClick), from the entry, the item now and what the managed tools hold of it now (historyactions.ts ItemNow); undefined
   * when it has nothing left to do.
   */
  historyAction(entry: HistoryEvent, item: LibraryItem | undefined, now: ItemNow, version?: string): { change: Change } | undefined;
}

/**
 * What a person asked of one item: On or Off (`on`), the harnesses it is kept out of (`except`), a version to make current,
 * Delete from Central Knot (`deleted`: true) or its Restore (false), and, for a found item whose copies differ, the copy
 * every harness takes (`use`, as seen: `useHash`). `seenOn`: whether the page showed it On; a click made from an older read
 * is refused if that no longer holds.
 */
export interface ItemClick {
  key: string; on: boolean; except: HarnessId[]; seenOn?: boolean;
  use?: HarnessId; useHash?: string; version?: string; deleted?: boolean;
  /** An Undo's: each harness whose own copy the undone click took over, given back there where the item no longer goes (types.ts Change). */
  giveBack?: Partial<Record<HarnessId, string>>;
}

/**
 * The app's click (types.ts Change: the page's and History's, for every kind) as the library's: the one place the two meet.
 * `managed` is On, `off` the harnesses it is kept out of.
 */
export function itemClick(change: Change): ItemClick {
  const { key, managed: on, off, seenManaged: seenOn, use, useHash, version, deleted, giveBack } = change;
  return { key, on, except: [...off], seenOn, use, useHash, version, deleted, giveBack };
}

// ---------- What the harnesses hold ----------

/**
 * What one pass, or one look of the page, read once: the managed harnesses' copies, each folder as it is now (`foldersNow`,
 * filled by guardFolders) and (`settle`) the settle window's clock. Only a pass has that clock: the page's look reads the
 * window as passed and records nothing, so its marks say what the pass will do once the window has passed.
 */
export interface Look<Content, Entry extends Seen, D extends Disk<Entry> = Disk<Entry>> {
  kind: Kind<Content, Entry, D>; context: ShareContext; managed: HarnessId[]; library: KindLibrary; disk: D;
  foldersNow: KindLibrary['folders'];
  /** By item, the copies a harness managed again holds that give way to the library (cameBack): what the page says will be kept. */
  givingWay: Map<string, Plan['keep']>;
  /** How long a copy must stay missing before it counts as deleted by hand, the clock it is measured on, and whether a copy is inside it now. */
  settle?: { clock: number; ms: number; settling: boolean };
}
type AnyLook = Look<unknown, Seen, Disk<Seen>>;

/** Reads the managed harnesses once. The guards come after (guardFolders), once a pass's clicks are on its items. */
async function lookAt<C, E extends Seen, D extends Disk<E>>(
  kind: Kind<C, E, D>, context: ShareContext, managed: HarnessId[], library: KindLibrary, settle?: Look<C, E, D>['settle'],
): Promise<Look<C, E, D>> {
  return { kind, context, managed, library, disk: await kind.read(context, managed), foldersNow: {}, givingWay: new Map(), settle };
}

/**
 * The page's look, and Push's (agents.ts agentsForRepo): the same reading a pass makes, with the guards applied to the items
 * in memory. Nothing is saved, and a harness managed again keeps no version yet: the pass does that.
 */
export async function lookFor<C, E extends Seen, D extends Disk<E>>(kind: Kind<C, E, D>, context: ShareContext, tools: readonly HarnessId[]) {
  const { library, problem } = await kind.open(context);
  const live = Object.values(library.items).filter(item => !item.deleted);
  const look = await lookAt(kind, context, kind.harnesses(tools), library);
  await guardFolders(look, live);
  return { look, live, problem };
}

/**
 * What managing one more harness (`joining`) would do there now, as its Harnesses card says before its Manage switch is turned
 * on: the look a pass makes with `tools` (the managed harnesses with `joining` among them, in their order; the guards included,
 * so cameBack's copies that give way are counted; nothing is saved), and each item's plan there, deleted items' too. `rule`: the home's Synchronize
 * everything is on, so a found item it can take is counted as taken in. The one place this is counted; tests/managetool.test.ts
 * holds it equal to what the pass then does.
 */
export async function joinCounts<C, E extends Seen, D extends Disk<E>>(
  kind: Kind<C, E, D>, context: ShareContext, tools: readonly HarnessId[], joining: HarnessId, rule: boolean,
): Promise<JoinCounts> {
  const counts: JoinCounts = { written: 0, kept: 0, removed: 0, waits: 0, found: 0, takenIn: 0 };
  const { library, problem } = await kind.open(context);
  if (problem || !kind.harnesses([joining]).length) return counts;
  const look = await lookAt(kind, context, kind.harnesses(tools), library);
  const items = Object.values(library.items);
  await guardFolders(look, items);
  const waits = !!look.disk.locked.get(joining)?.waits, leaving = new Set<string>();
  for (const item of items) {
    const made = plan(item, copiesOf(look, item));
    counts.kept += [...made.keep, ...(look.givingWay.get(item.key) ?? [])].filter(kept => kept.harness === joining).length;
    if (made.write.includes(joining)) counts[waits ? 'waits' : 'written']++;
    if (made.remove.includes(joining)) { counts[waits ? 'waits' : 'removed']++; leaving.add(item.key); }
  }
  // Found there: each key it has a copy of that can be taken in (its own, or one it has another way: foundCopies) with no live
  // item for it, but a deleted item's copy the pass removes there.
  for (const key of new Set([...look.disk.byKey.keys(), ...(look.disk.outside?.keys() ?? [])])) {
    if ((library.items[key] && !library.items[key].deleted) || leaving.has(key) || !foundCopies(look, key, []).some(copy => copy.tool === joining)) continue;
    counts[rule && 'take' in takeInAnswer('rule', foundKey(look, key)) ? 'takenIn' : 'found']++;
  }
  return counts;
}

export const unseenIn = (disk: Disk<Seen>, tool: HarnessId, key: string) => disk.unseen.get(`${tool}:${key}`) ?? disk.unseen.get(`${tool}:*`);

/**
 * "H unseen is never H gone" for a whole folder, and a harness managed again, on `items` as a pass's clicks left them. A
 * harness's identity is let go when it stops being managed (keepFolders), so "no identity on record" is a harness managed
 * again, or one seen for the first time. One line per branch, in the order the code takes them:
 * - Not there, and managed again with something applied there: nothing noted, so the folder's arrival runs cameBack.
 * - Not there (any other harness is noted as away), inside the settle window: unseen, so nothing happens there.
 * - Not there, past the window: items wanted there are written afresh; a removal owed there waits for the folder (unseen).
 * - There, no identity on record: cameBack settles every item in the record that had something applied there.
 * - There, but elsewhere than at the last full pass (its config root moved): what was applied is forgotten for `items`.
 * - There, but made again since (reset, reinstalled, or back after being away): the same, for `items` with no copy there.
 * A click's pass moves no known identity on, so the next full pass still sees the change for the others (keepFolders).
 * `shelf`: a pass tells History and keeps the copies a harness managed again gives way with; the page's look only notes them.
 */
export async function guardFolders(look: AnyLook, items: LibraryItem[], shelf?: Shelf<unknown>) {
  for (const tool of look.managed) {
    const path = look.kind.folder(look.context, tool), was = look.library.folders[tool];
    const here = look.kind.folderSeen ? await look.kind.folderSeen(look.context, tool) : await folderAt(path);
    const forget = (which: LibraryItem[]) => { for (const item of which) delete item.applied[tool]; };
    if ('away' in here) {
      const backWithoutFolder = !was && Object.values(look.library.items).some(item => item.applied[tool] !== undefined);
      if (!backWithoutFolder) look.foldersNow[tool] = here;
      const applied = items.filter(item => item.applied[tool] !== undefined);
      if (!applied.length) continue;
      const where = `${toolName(tool)}’s ${look.kind.words.folder}`;
      if (stillSettling(look, path)) { look.disk.unseen.set(`${tool}:*`, `${where} isn’t there just now. If it stays away, Central Knot writes it afresh.`); continue; }
      forget(applied.filter(item => wantedIn(item, tool)));
      const owed = `${where} isn’t there. Its copy is removed once it is back.`;
      for (const item of applied.filter(item => !wantedIn(item, tool))) look.disk.unseen.set(`${tool}:${item.key}`, owed);
      continue;
    }
    look.foldersNow[tool] = here;
    seenAgain(look, path);
    if (!was) await cameBack(look, tool, shelf);
    else if (was.path !== path) forget(items);
    else if ('away' in was || was.ino !== here.ino || was.birth !== here.birth) forget(items.filter(item => !look.disk.byKey.get(item.key)?.[tool]));
  }
}

/** A folder's identity on disk, or away when it is not a folder there. */
async function folderAt(path: string): Promise<FolderSeen> {
  const info = await stat(path).catch(() => undefined);
  return info?.isDirectory() ? { path, ino: info.ino, birth: Math.round(info.birthtimeMs) } : { path, away: true };
}

/**
 * A file every copy of a kind shares, as the guard sees it (Kind.folderSeen: MCP servers' settings file): away when it is
 * missing, else one fixed identity, since every save (Central Knot's too) replaces the file and its own identity tells nothing.
 */
export const sharedFileSeen = (path: string, exists: boolean): FolderSeen => (exists ? { path, ino: 0, birth: 0 } : { path, away: true });

/**
 * A harness managed again (library.ts managedAgain), for every item in the record, deleted ones too, not only the pass's: A
 * becomes what the harness holds now, and each content the item doesn't hold gives way to the library. Each such copy is
 * noted on the look (`givingWay`, which the page shows), and a pass tells History of it first (a `kept-edit` entry, cause
 * `tool-back`, whose "Use <harness>’s" makes it current) and then keeps it as a version. Both happen here, for every item,
 * because the item may be outside this pass and written over or removed only by a later one; and before any harness file
 * changes (keepVersion saves; carryOut saves before it writes), so a pass that runs later finds the harness settled, and
 * only edits and deletions made after it count as such. A missing copy went while the harness was away: no settle window.
 */
async function cameBack(look: AnyLook, tool: HarnessId, shelf?: Shelf<unknown>) {
  const givingWay: { item: LibraryItem; version: Version; content: unknown }[] = [];
  for (const item of Object.values(look.library.items)) {
    const here = look.disk.byKey.get(item.key)?.[tool], unseen = unseenIn(look.disk, tool, item.key);
    const copy: HarnessCopy = unseen ? { is: 'unseen', why: unseen } : here ? { is: 'present', hash: here.hash, at: here.at } : { is: 'absent' };
    const version = managedAgain(item, tool, copy);
    if (!version || !here) continue;
    givingWay.push({ item, version, content: look.kind.contentOf(here) });
    look.givingWay.set(item.key, [...(look.givingWay.get(item.key) ?? []), { harness: tool, from: version.from }]);
  }
  if (!shelf || !givingWay.length) return;
  const told = givingWay.map(({ item, version }): HistoryEvent => ({ id: randomUUID(), at: now(), key: `${look.kind.historyPrefix}${item.key}`,
    item: item.name, kind: 'kept-edit', cause: 'tool-back', losers: [{ tool, hash: version.hash }], orderProved: true }));
  await appendHistory(look.context, told);
  for (const { item, version, content } of givingWay) await keepVersion(shelf, item, version, content);
}

/**
 * H for each managed harness (library.ts HarnessCopy): the one place that says what a harness holds of an item, read by a
 * pass and by the page. `unseen`, so that nothing happens there: a copy that can't be read for sure, a folder away inside
 * the settle window, and a copy missing for less than the settle window (an editor's save moves the file away for a moment).
 * `held`: a harness the item should be in that can't be given a copy (Disk.held, or its folder is locked), or has it another
 * way (Disk.held).
 */
export function copiesOf(look: AnyLook, item: LibraryItem): Copies {
  const slot = look.disk.byKey.get(item.key) ?? {};
  return Object.fromEntries(look.managed.map(tool => [tool, copyIn(look, item, tool, slot[tool])]));
}
function copyIn(look: AnyLook, item: LibraryItem, tool: HarnessId, here: Seen | undefined): HarnessCopy {
  const unseen = unseenIn(look.disk, tool, item.key);
  if (unseen) return { is: 'unseen', why: unseen };
  const path = look.kind.pathOf(look.context, tool, here?.name ?? item.name);
  const wanted = wantedIn(item, tool), kindHeld = wanted ? look.disk.held(item, tool) : undefined;
  if (here) {
    seenAgain(look, path);
    // A harness that won't load the current version keeps the copy it has: nothing is written over it (writeCopy asks the
    // same of what it writes, through Kind.refusesToLoad).
    const refused = wanted && !kindHeld?.anotherWay ? look.disk.refuses?.(item, tool) : undefined;
    if (refused) return { is: 'held', why: refused };
    // A copy of its own where the harness has the item another way too: the table's last row (library.ts wantedHere).
    return { is: 'present', hash: here.hash, at: here.at, ...(kindHeld?.anotherWay ? { anotherWay: kindHeld.why } : {}) };
  }
  // A harness whose writes wait (Disk.locked `waits`) is planned as any other: the pass leaves the write for that step.
  const locked = look.disk.locked.get(tool);
  const held = kindHeld ?? (wanted && locked && !locked.waits ? { why: locked.why } : undefined);
  if (held) return { is: 'held', ...held };
  const { copy, item: noun } = look.kind.words;
  const missing = `${toolName(tool)}’s ${copy} for it is missing just now. If it stays missing, the ${noun} turns off.`;
  if (wanted && item.applied[tool] !== undefined && stillSettling(look, path)) return { is: 'unseen', why: missing };
  seenAgain(look, path);
  return { is: 'absent' };
}

/** When each file or folder was first seen missing, kept while the app runs (the settle window). A restart forgets them, which only delays an Off. */
const firstSeenMissingAt = new Map<string, number>();
/** Whether something missing at `path` may still be a save in progress. Only a pass keeps the clock (Look `settle`). */
function stillSettling(look: AnyLook, path: string): boolean {
  if (!look.settle) return false;
  // A clock that went back (the system's, or a test's) restarts the window rather than holding it open.
  const first = Math.min(firstSeenMissingAt.get(path) ?? look.settle.clock, look.settle.clock);
  firstSeenMissingAt.set(path, first);
  if (look.settle.clock - first >= look.settle.ms) return false;
  look.settle.settling = true;
  return true;
}
const seenAgain = (look: AnyLook, path: string) => { if (look.settle) firstSeenMissingAt.delete(path); };

/**
 * The copies a found item is taken in from: one per managed harness that has it, can be read and isn't kept out (`off`): its
 * own copy, else one it has another way (Disk.outside). Where they differ, the person chooses which one every harness takes
 * (the copy question: library.ts takeInAnswer).
 */
export function foundCopies<E extends Seen>(look: Look<unknown, E, Disk<E>>, key: string, off: readonly HarnessId[]): E[] {
  const slot = look.disk.byKey.get(key) ?? {}, outside = look.disk.outside?.get(key) ?? {};
  return look.managed.flatMap(tool => {
    const copy = slot[tool] ?? outside[tool];
    return copy && !off.includes(tool) && !unseenIn(look.disk, tool, key) ? [copy] : [];
  });
}

/**
 * What the take-in table (library.ts takeInAnswer) is told of a found key, from this look: its copies (foundCopies, each a
 * plugin's part or not: Disk.parts), whether the record holds it deleted, and whether that deleted item's copy still waits to
 * leave a harness (its plan removes a copy where writes wait: Disk.locked `waits`). The one place both a click and
 * Synchronize everything, and each kind's view, learn it.
 */
export function foundKey(look: AnyLook, key: string, off: readonly HarnessId[] = []): FoundKey {
  const parts = look.disk.parts?.get(key) ?? [], switchedOff = look.disk.switchedOff?.get(key) ?? [];
  const tombstone = look.library.items[key]?.deleted ? look.library.items[key] : undefined;
  const copies = foundCopies(look, key, off).map((copy): FoundCopy => ({ harness: copy.tool, hash: copy.hash, at: copy.at,
    ...(parts.includes(copy.tool) ? { part: true } : {}), ...(switchedOff.includes(copy.tool) ? { off: true } : {}) }));
  return { copies, deleted: !!tombstone, converted: !!look.disk.converted?.has(key), leaving: !!tombstone && leavingIn(look, tombstone).length > 0 };
}

/**
 * The harnesses a deleted item's copy still waits to leave, at a step of the person's own (Write to Claude Code: Disk.locked
 * `waits`): the one place it is worked out, for the take-in table (foundKey) and for the row's words (servers.ts rowFacts `waits`).
 */
export const leavingIn = (look: AnyLook, tombstone: LibraryItem) =>
  plan(tombstone, copiesOf(look, tombstone)).remove.filter(tool => look.disk.locked.get(tool)?.waits);

/** A found key's answers, a click's and Synchronize everything's, as each kind's view gives its row (types.ts LibraryFacts takeInAnswers). */
export const takeInAnswers = (look: AnyLook, key: string) => {
  const found = foundKey(look, key);
  return { click: takeInAnswer('click', found), rule: takeInAnswer('rule', found) };
};

// ---------- A pass ----------

/**
 * What was asked of a pass for one item (a click, or what Pull brings), as the History entry it becomes: begun when it is
 * recorded, finished with the harnesses its plan writes or removes (`fill`: which of them it names).
 */
type Asked = Pick<HistoryEvent, 'kind' | 'cause' | 'winner' | 'only' | 'version' | 'previous' | 'foundIn'> & { losers?: HistoryEvent['losers']; fill?: 'written' | 'removed' };
/**
 * What Pull brings for one item (gitrepo.ts): its name and content, and where the repo holds one harness's own part, that
 * part's text (Claude Code's file, for an agent); or its removal.
 */
export type Pulled<Content> = { name: string; content: Content; own?: { harness: HarnessId; text: string } } | { removed: true };
interface Pass extends AnyLook {
  shelf: Shelf<unknown>;
  /** The record as last saved, to save it again only when it changed. */
  saved: string;
  /** What was asked of this pass for each item (a click, or Pull), as the History entry it becomes. */
  asked: Map<string, Asked>;
  /** An Undo's copies to give back, by item (ItemClick giveBack). */
  giveBack: Map<string, Partial<Record<HarnessId, string>>>;
  /** History has the clicks in an entry of the caller's own (PassOptions told). */
  told: boolean;
  /** What Synchronize everything took in, as History told it (logItem): its one notice, made when the pass ends. */
  takenIn: { name: string; foundIn: HarnessId[]; history: string }[];
  results: DestinationResult[]; notices: SyncNotice[]; writes: number; made: string[];
}
/** What may be asked of a pass besides its clicks. */
export interface PassOptions<Content> {
  /** With Automatic sync off, a click's pass concerns the items it names and nothing else spreads (SYN-03). */
  only?: Set<string>;
  /** An explicit Resume, for a record this app has no memory of. */
  resume?: boolean;
  /** What Pull brings, by item (gitrepo.ts): each becomes that item's current version before the pass (pull). */
  pulled?: Map<string, Pulled<Content>>;
  /**
   * The clicks are told to History in one entry the caller wrote first (a profile switch: profiles.ts), so their own On and
   * Off entries are not written (logItem). What else the pass finds (an edit taken in, a copy deleted by hand) is told as ever.
   */
  told?: boolean;
  /**
   * The pass of the whole home that main.ts runs with no click (the background pass, and Sync once): the only pass in which the
   * home's standing rule, Synchronize everything, takes found items in (takeInByRule). Never a click's pass, Pull's, or an Undo's.
   */
  background?: true;
  /** The settle window and its clock; tests pass their own. */
  settleMs?: number; now?: number;
}

/**
 * One pass of a kind: the `clicks`, then (the background pass, with the home's rule on) every found item Synchronize everything
 * takes in, then every item in its library brought into line with its harnesses (library.ts plan).
 */
export async function runPass<C, E extends Seen, D extends Disk<E>>(
  kind: Kind<C, E, D>, context: ShareContext, tools: readonly HarnessId[], clicks: ItemClick[], options: PassOptions<C> = {},
): Promise<PassResult> {
  const gate = await libraryGate(context, { start: clicks.length > 0 || !!options.pulled?.size, resume: options.resume });
  if ('refused' in gate) return { stopped: gate.refused, results: [], writes: 0 };
  // A home with no sync record gets one only when something is asked of the pass (a click, or what Pull brings).
  if (!gate.record) return { results: [], writes: 0 };
  const { library, problem } = await kind.open(context, true);
  if (problem) return { stopped: problem, results: [], writes: 0 };
  const managed = kind.harnesses(tools);
  // A write or removal a crash interrupted is finished first, so a copy moved aside is never read as deleted.
  for (const tool of managed) await kind.recover(context, tool);
  const saved = JSON.stringify(library);
  const inScope = (key: string) => !options.only || options.only.has(key) || clicks.some(asked => asked.key === key);
  const settle = { clock: options.now ?? Date.now(), ms: options.settleMs ?? context.settleMs ?? 2000, settling: false };
  const look: AnyLook = await lookAt(kind, context, managed, library, settle);
  const store = (item: LibraryItem, hash: string, content: unknown) => kind.store(context, item, hash, content as C);
  const pass: Pass = { ...look, shelf: { store, save: () => saveIfChanged(pass) }, saved, asked: new Map(), giveBack: new Map(), told: !!options.told, takenIn: [], results: [], notices: [], writes: 0, made: [] };
  try {
    await deletionsTold(pass);
    for (const [key, brought] of options.pulled ?? []) await pull(pass, key, brought);
    for (const asked of clicks) await click(pass, asked);
    if (options.background && gate.record.syncEverything === true) await takeInByRule(pass);
    const items = Object.values(library.items).filter(item => inScope(item.key));
    await guardFolders(pass, items, pass.shelf);
    for (const item of items) { await stillOwned(context.home, context.build); await syncItem(pass, item); }
    if (pass.takenIn.length) pass.notices.push(takenInNotice(pass.takenIn));
    // A file noted away that this pass made (a kind of files: Kind.folderSeen) is noted as it is now, so the next pass doesn't
    // take Central Knot's own write for a file made again (keepFolders: a click's pass still moves no known identity on).
    if (kind.folderSeen) for (const tool of managed) if (pass.foldersNow[tool] && 'away' in pass.foldersNow[tool]) pass.foldersNow[tool] = await kind.folderSeen(context, tool);
    keepFolders(library, pass.foldersNow, managed, !options.only);
    await saveIfChanged(pass);
  } catch (error) {
    // Another build took over syncing this home meanwhile (share.ts stillOwned, asked before each item and each save): the
    // pass stops there, what it wrote and kept stays, and it says why.
    if (errorCode(error) !== 'CK_TAKEN') throw error;
    return { stopped: (error as Error).message, results: pass.results, writes: pass.writes, notices: pass.notices, made: pass.made };
  }
  return { results: pass.results, writes: pass.writes, notices: pass.notices, settling: settle.settling, made: pass.made, ...(options.background ? { found: foundKeys(pass) } : {}) };
}

/**
 * The folder identities a pass leaves on the record (guardFolders reads them): those of harnesses no longer managed are let
 * go, so one managed again is told apart; one the record doesn't hold yet is noted by any pass (guardFolders has settled
 * every item there: cameBack); and a full pass moves every identity on. A click's pass with Sync off moves no known one on:
 * the items it leaves alone must still see a reset at the next full pass.
 */
function keepFolders(library: KindLibrary, now: KindLibrary['folders'], managed: readonly HarnessId[], full: boolean) {
  const still = Object.fromEntries(Object.entries(library.folders).filter(([tool]) => managed.includes(tool as HarnessId)));
  library.folders = full ? { ...still, ...now } : { ...now, ...still };
}

/**
 * The tool choice (toolchoice.ts) lets go of the folders of the harnesses it leaves out at once (keepFolders), so a harness
 * managed again is told apart whether or not a pass runs before it is back (guardFolders).
 */
export async function forgetFolders<C, E extends Seen, D extends Disk<E>>(kind: Kind<C, E, D>, context: ShareContext, managed: readonly HarnessId[]) {
  const { library, problem } = await kind.open(context, true);
  if (problem) return;
  const before = JSON.stringify(library.folders);
  keepFolders(library, {}, managed, true);
  if (JSON.stringify(library.folders) !== before) await kind.save(context.home, library);
}

/**
 * Saves the record when it is not as last saved: before any harness file changes (syncItem), and when the pass ends; never once
 * another build has taken over syncing this home (share.ts stillOwned).
 */
async function saveIfChanged(pass: Pass) {
  const text = JSON.stringify(pass.library);
  if (text === pass.saved) return;
  await stillOwned(pass.context.home, pass.context.build);
  await pass.kind.save(pass.context.home, pass.library);
  pass.saved = text;
}

/** Brings one item into line with its harnesses: the library's plan, carried out in the library's order (carryOut). */
async function syncItem(pass: Pass, item: LibraryItem) {
  const { kind, context } = pass, slot = pass.disk.byKey.get(item.key) ?? {}, giveBack = pass.giveBack.get(item.key) ?? {};
  const copies = copiesOf(pass, item), made = plan(item, copies);
  await carryOut(item, made, {
    ...pass.shelf,
    copy: harness => { const here = slot[harness]!; return { hash: here.hash, at: here.at, content: kind.contentOf(here) }; },
    // Each harness's copy as seen now holds its own part (the click on the item is recorded already).
    keepOwn: async () => {
      for (const harness of pass.managed) {
        const here = slot[harness], text = here && copies[harness]?.is === 'present' ? kind.ownOf(here) : undefined;
        if (text !== undefined) await kind.keepOwn(context, item, harness, text);
      }
    },
    log: () => appendHistory(context, logItem(pass, item, made, slot)),
    write: async harness => !waits(pass, item, harness) && writeCopy(pass, item, harness, slot[harness]),
    // An Undo gives a harness back the copy its click took over, as that harness's own, instead of removing what is there.
    remove: async harness => !waits(pass, item, harness)
      && (giveBack[harness] ? giveBackCopy(pass, item, slot[harness]!, giveBack[harness]!) : removeCopy(pass, item, slot[harness]!)),
  });
}

/**
 * Whether a write or removal in this harness waits for a step of the person's own (Disk.locked `waits`): then it is left
 * undone, said held with `waits` (a step to take, not a failure), and what is applied there stays, so the next look still owes it.
 */
function waits(pass: Pass, item: LibraryItem, tool: HarnessId): boolean {
  const lock = pass.disk.locked.get(tool);
  if (!lock?.waits) return false;
  pass.results.push({ item: item.name, harness: tool, outcome: 'held', waits: true, message: lock.why });
  return true;
}

/** Writes the current version into one harness (Kind.write). True when it is there (carryOut notes it as applied). */
async function writeCopy(pass: Pass, item: LibraryItem, tool: HarnessId, here: Seen | undefined): Promise<boolean> {
  const stopped = (message: string) => { pass.results.push({ item: item.name, harness: tool, outcome: 'held', message }); return false; };
  const content = await pass.kind.readVersion(pass.context, item.key, item.hash);
  if (!content) return stopped('This version is no longer in Central Knot’s store, so it can’t be written.');
  // A version this harness won't load is never written there; the copy it has stays (copyIn asks the same of the version it read).
  const wont = await pass.kind.refusesToLoad?.(pass.context, item, tool, content);
  if (wont) return stopped(wont);
  const refused = await pass.kind.write(pass.context, item, tool, here, content);
  if (refused) return stopped(refused.stopped);
  pass.writes++;
  const message = `${here ? 'Now has the current version' : 'Added'}. Start a new session to use it.`;
  pass.results.push({ item: item.name, harness: tool, outcome: 'written', replaced: here ? true : undefined, message });
  return true;
}

/** Removes one harness's copy (Kind.remove; its content and own part are kept already). True when it is gone. */
async function removeCopy(pass: Pass, item: LibraryItem, here: Seen): Promise<boolean> {
  const done = await pass.kind.remove(pass.context, item, here), where = toolName(here.tool);
  if (done !== 'removed') {
    // A save that landed between the read and the removal stays; the next pass keeps it as a version and removes it then.
    const message = done === 'changed' ? `${where}’s copy changed just now, so it stays until the next look.` : `Could not remove ${where}’s copy yet. Central Knot will try again.`;
    pass.results.push({ item: item.name, harness: here.tool, outcome: done === 'changed' ? 'held' : 'failed', message });
    return false;
  }
  pass.writes++;
  pass.results.push({ item: item.name, harness: here.tool, outcome: 'removed', message: 'Removed. Central Knot keeps it.' });
  return true;
}

/**
 * Gives a harness back its own copy (`hash`, a version) over the one Central Knot applied there, which carryOut then no
 * longer counts as applied: the harness's copy is its own again, as before the click this undoes. True when it is there.
 */
async function giveBackCopy(pass: Pass, item: LibraryItem, here: Seen, hash: string): Promise<boolean> {
  const where = toolName(here.tool), result = (outcome: 'written' | 'held', message: string) => pass.results.push({ item: item.name, harness: here.tool, outcome, message });
  if (here.hash === hash) { result('written', `${where} keeps its own copy, as before.`); return true; }
  const content = await pass.kind.readVersion(pass.context, item.key, hash);
  if (!content) { result('held', `${where}’s own copy is no longer in Central Knot’s store, so it can’t be given back.`); return false; }
  const refused = await pass.kind.write(pass.context, item, here.tool, here, content);
  if (refused) { result('held', refused.stopped); return false; }
  pass.writes++;
  result('written', `${where} has its own copy back, as before.`);
  return true;
}

// ---------- History ----------

/**
 * A deleted item always has its Restore. carryOut tells History first for its own item, but a pass saves the whole record,
 * so another item's save in the same pass can carry a Delete to disk before that Delete's entry is told; a crash then would
 * leave the item with no row and no Restore. So each pass, before any click, gives every item deleted within History's
 * days that has no standing `deleted` entry (one not undone) that entry, dated when it was deleted.
 */
async function deletionsTold(pass: Pass) {
  const cutoff = historyCutoff(pass.context), prefix = pass.kind.historyPrefix;
  const recent = Object.values(pass.library.items).filter(item => item.deleted && Date.parse(item.deleted.at) >= cutoff);
  if (!recent.length) return;
  // A copy a pass removed later (`in-line`) is no Delete's entry: it has no Restore.
  const told = new Set((await readHistory(pass.context)).filter(event => event.kind === 'deleted' && event.cause !== 'in-line' && !event.undoneBy).map(event => event.key));
  const untold = recent.filter(item => !told.has(`${prefix}${item.key}`));
  await appendHistory(pass.context, untold.map(item => ({
    id: randomUUID(), at: item.deleted!.at, key: `${prefix}${item.key}`, item: item.name, kind: 'deleted', losers: [], orderProved: true })));
}

/**
 * History's entries for one item's pass, made before anything of it is saved (carryOut): what was asked (with the harnesses
 * its plan writes or removes; not for a profile switch's clicks, which its own entry tells: PassOptions told), an edit taken
 * in, and a copy deleted by hand that turned it Off (these two are also notices, since no one asked for them); edits not
 * taken in that gave way, and a harness's own copies that gave way (`own-copy`). Then one rule for the rest, by what the pass
 * does and never why: a write over a copy, or a removal, that nothing above told gets its entry (cause `in-line`), whichever
 * pass makes it (a tool managed again, a folder that could not be written, Write to Claude Code): an `on` for the copies
 * written over, and an `off` (a `deleted` for a deleted item) for the copies removed. A harness whose copy can't be changed this
 * time is said in the pass's results, and the next pass finishes it. A copy a harness managed again gives way with has its entry
 * from cameBack, which may concern an item outside this pass.
 */
function logItem(pass: Pass, item: LibraryItem, made: Plan, slot: Partial<Record<HarnessId, Seen>>): HistoryEvent[] {
  // The item as it is before the plan is carried out: the edit taken in is current only after this is told.
  const taken = made.takeIn ? slot[made.takeIn]!.hash : item.hash;
  const key = `${pass.kind.historyPrefix}${item.key}`, events: HistoryEvent[] = [];
  // What the plan will change: not in a harness whose folder can't be written, so no entry or notice claims it.
  const can = (tools: HarnessId[]) => tools.filter(tool => !pass.disk.locked.has(tool));
  // An Undo gives a harness its own copy back instead of removing what is there (syncItem): not a removal.
  const giveBack = pass.giveBack.get(item.key) ?? {}, gaveBack = made.remove.filter(tool => giveBack[tool]);
  const did = { written: can(made.write), removed: can(made.remove.filter(tool => !giveBack[tool])) };
  // The copies a click takes over: each one Central Knot had not put there, which it writes over or counts as the item's.
  const tookFrom = [...made.current, ...made.write].filter(tool => slot[tool] && item.applied[tool] === undefined).map(tool => ({ tool, hash: slot[tool]!.hash }));
  const log = (fields: Omit<HistoryEvent, 'id' | 'at' | 'key' | 'item' | 'orderProved'>) => {
    const event: HistoryEvent = { id: randomUUID(), at: now(), key, item: item.name, orderProved: true, ...fields };
    events.push(event);
    return event.id;
  };
  const notice = (kind: ItemNotice['kind'], winner: HarnessId, losers: HarnessId[], history: string) =>
    pass.notices.push({ key, item: item.name, kind, winner, losers, orderProved: true, history });
  /** Each of these harnesses with what it held before the pass. */
  const before = (tools: HarnessId[]) => tools.map(tool => ({ tool, hash: slot[tool]?.hash ?? '' }));
  const asked = pass.asked.get(item.key), clicked = !!asked;
  // A profile switch's clicks are told in its own entry (PassOptions told).
  if (asked && pass.told) pass.asked.delete(item.key);
  else if (asked) {
    const { fill, ...entry } = asked;
    // A switch's entry says the version it left (`taken`, once this pass is carried out), so its Undo is offered only while it still is.
    const switched = (entry.kind === 'on' || entry.kind === 'off') && !entry.winner ? { version: taken } : {};
    const id = log({ ...entry, ...switched, losers: entry.losers ?? (fill ? before(did[fill]) : []), ...(tookFrom.length ? { tookFrom } : {}), ...(gaveBack.length ? { gaveBack } : {}) });
    // What Synchronize everything took in is no click's: its notice says it, and no click's Undo undoes it.
    if (entry.cause === 'sync-everything') pass.takenIn.push({ name: item.name, foundIn: entry.foundIn ?? [], history: id });
    else pass.made.push(id);
    pass.asked.delete(item.key);
  }
  if (made.takeIn) {
    // The copies edited as well, which gave way to the latest edit: each is a version, and History can make it current.
    const others = made.keep.filter(kept => kept.from.how === 'edited').map(kept => kept.harness);
    const kind = others.length ? 'conflict' : 'edit';
    const losers = before([...new Set([...others, ...did.written])]);
    const id = log({ kind, winner: { tool: made.takeIn, hash: taken }, previous: item.hash, losers });
    notice(kind, made.takeIn, others.length ? others : did.written, id);
  }
  if (made.turnedOffBy) {
    const id = log({ kind: 'off', cause: 'deleted-by-hand', winner: { tool: made.turnedOffBy, hash: taken }, losers: before(did.removed) });
    notice('deleted', made.turnedOffBy, did.removed, id);
  }
  // Edits no pass had taken in that give way to the current version (Pull, Make current): each is a version, offered back here.
  const gaveWay = made.takeIn ? [] : made.keep.filter(kept => kept.from.how === 'edited').map(kept => kept.harness);
  if (gaveWay.length) log({ kind: 'kept-edit', losers: before(gaveWay) });
  // A harness's own copies that Central Knot never put there, which no click took over (a tool managed for the first time, or
  // installed later): each gave way to the current version, is a version now, and is offered back here.
  const theirs = clicked ? [] : made.keep.filter(kept => kept.from.how === 'was-in').map(kept => kept.harness);
  if (theirs.length) log({ kind: 'kept-edit', cause: 'own-copy', losers: before(theirs) });
  // The rest of what this pass writes over or removes, which nothing above told: each copy written over or removed was a
  // version of the item (or was kept as one above), and the entry says where.
  if (clicked) return events;
  const told = new Set([...gaveWay, ...theirs, ...(pass.givingWay.get(item.key) ?? []).map(kept => kept.harness)]);
  const over = made.takeIn ? [] : did.written.filter(tool => slot[tool] && !told.has(tool));
  if (over.length) log({ kind: 'on', cause: 'in-line', losers: before(over) });
  const gone = made.turnedOffBy ? [] : did.removed;
  if (gone.length) log({ kind: item.deleted ? 'deleted' : 'off', cause: 'in-line', losers: before(gone) });
  return events;
}

/**
 * Each item of a kind as History's actions are decided on it (historyactions.ts EntryItem): its record, and what the managed tools
 * hold of it now, from the look a pass makes (lookFor): the tools whose copy holds an edit no pass has taken in (library.ts
 * pendingEdits). A History entry names its item by key (an MCP server's entries from before the library: its name as written).
 */
export async function itemsNow<C, E extends Seen, D extends Disk<E>>(kind: Kind<C, E, D>, context: ShareContext, tools: readonly HarnessId[]) {
  const { look, problem } = await lookFor(kind, context, tools);
  const of = (entry: HistoryEvent) => {
    const item = look.library.items[itemKey(entry.key.slice(kind.historyPrefix.length))];
    return { item, now: { managed: tools, pending: item && !item.deleted ? pendingChanges(plan(item, copiesOf(look, item))) : [] } };
  };
  return { of, problem };
}

/**
 * History entries' own actions (Kind.historyAction says which click each is, from the entry and its item now: itemsNow), run as
 * those clicks in one pass of the kind; each entry is marked done by the entry its click made (`undid`: entry, then that one). An
 * entry with nothing left to do is passed over. `version`: one of an entry's version choices ("Use Codex’s") instead of its own
 * action, which leaves the entry open: its other choices still stand. A harness an entry wrote, removed or took a copy from that
 * isn't managed now is left as it is, and the results say so. History's one button runs restore; Synchronize everything's one
 * Undo and its Restore run several (everything.ts).
 */
export async function restoreAll<C, E extends Seen, D extends Disk<E>>(
  kind: Kind<C, E, D>, context: ShareContext, tools: readonly HarnessId[], eventIds: string[], version?: string,
): Promise<PassResult & { undid: Map<string, string> }> {
  const undid = new Map<string, string>(), about = await itemsNow(kind, context, tools);
  if (about.problem) return { stopped: about.problem, results: [], writes: 0, undid };
  const asked = (await readHistory(context)).filter(event => eventIds.includes(event.id)).flatMap(past => {
    const { item, now } = about.of(past), action = kind.historyAction(past, item, now, version);
    return action ? [{ past, change: action.change }] : [];
  });
  if (!asked.length) return { results: [], writes: 0, undid };
  const done = await runPass(kind, context, tools, asked.map(({ change }) => itemClick(change)), { only: new Set(asked.map(({ change }) => change.key)) });
  const away = asked.flatMap(({ past }) => [...new Set([...past.losers, ...(past.tookFrom ?? [])].map(copy => copy.tool))]
    .filter(tool => !kind.harnesses(tools).includes(tool) && kind.harnesses([tool]).length).sort(byToolOrder)
    .map((tool): DestinationResult => ({ item: past.item, harness: tool, outcome: 'held', message: notManagedHere(tool) })));
  if (!done.stopped) done.results.push(...away);
  if (!done.made?.length || version) return { ...done, undid };
  const history = await readHistory(context), made = history.filter(event => done.made!.includes(event.id));
  for (const { past, change } of asked) {
    const by = made.find(event => event.key === `${kind.historyPrefix}${change.key}`);
    if (by) { history.find(event => event.id === past.id)!.undoneBy = by.id; undid.set(past.id, by.id); }
  }
  await replaceHistory(context, history);
  return { ...done, undid };
}

/** One History entry's action (restoreAll for one entry), or why it has nothing left to do. */
export async function restore<C, E extends Seen, D extends Disk<E>>(
  kind: Kind<C, E, D>, context: ShareContext, tools: readonly HarnessId[], eventId: string, version?: string,
): Promise<PassResult> {
  const { undid: _undid, ...done } = await restoreAll(kind, context, tools, [eventId], version);
  if (done.stopped || done.made?.length || done.results.length) return done;
  return { stopped: `That change has nothing left to undo: the ${kind.words.item} is as that would leave it.`, results: [], writes: 0 };
}

// ---------- Clicks, and what Pull brings ----------

type Refuse = (message: string, more?: Partial<DestinationResult>) => void;

/**
 * One click on an item, recorded on it; the same pass then applies it. A click that can't be taken is said in the results
 * (`unchanged`) and changes nothing.
 */
async function click(pass: Pass, asked: ItemClick) {
  const known = pass.library.items[asked.key];
  const item = known && !known.deleted ? known : undefined;
  const name = known?.name ?? asked.key;
  const refuse: Refuse = (message, more = {}) => { pass.results.push({ item: name, outcome: 'held', unchanged: true, message, ...more }); };
  const stale = asked.seenOn !== undefined && !!item?.on !== asked.seenOn;
  if (stale) return refuse(`${name} changed since the page was read. Nothing was changed; read again.`);
  if (asked.giveBack) pass.giveBack.set(asked.key, asked.giveBack);
  if (asked.deleted === false) {
    if (!known?.deleted) return;
    delete known.deleted;
    pass.asked.set(known.key, { kind: 'restored', fill: 'written' });
  } else if (!item) {
    if (asked.on) await addClicked(pass, asked, refuse);
  } else if (asked.deleted) {
    item.deleted = { at: now() };
    pass.asked.set(item.key, { kind: 'deleted', fill: 'removed' });
  } else if (asked.version) await makeCurrent(pass, item, asked.version, refuse);
  // A copy is chosen only when a found item is taken in: one in the library is at its current version in every harness.
  else if (asked.use) refuse(`${name} is in Central Knot already, so there is no copy to choose. Make one of its versions current instead.`);
  else turn(pass, item, asked);
}

/** The switches: the item On or Off, or one harness kept out or let in. */
function turn(pass: Pass, item: LibraryItem, asked: ItemClick) {
  const was = { on: item.on, except: item.except };
  Object.assign(item, { on: asked.on, except: [...asked.except] } satisfies Partial<LibraryItem>);
  const out = item.except.find(tool => !was.except.includes(tool)), back = was.except.find(tool => !item.except.includes(tool));
  if (was.on !== item.on) pass.asked.set(item.key, item.on ? { kind: 'on', cause: 'switch', fill: 'written' } : { kind: 'off', cause: 'switch', fill: 'removed' });
  else if (out) pass.asked.set(item.key, { kind: 'off', cause: 'switch', only: out, fill: 'removed' });
  else if (back) pass.asked.set(item.key, { kind: 'on', cause: 'switch', only: back, fill: 'written' });
}

/** What a click's refusal says, by why the take-in table leaves the key found; a click meets only these (library.ts takeInAnswer). */
const refusedAdd: Partial<Record<LeftFound, string>> = {
  'no-copy': 'No tool has a copy of it to take in any more.',
  leaving: 'It is deleted from Central Knot, and its copy still leaves a tool at the next Write to Claude Code. History can restore it.',
  'choice-changed': 'The copy you chose changed since you chose it. Nothing was changed; choose again.',
};

/**
 * A click on a found item's Add, as the take-in table's click column answers it (library.ts takeInAnswer): taken in, from the
 * one content or the copy chosen (`use`, as seen: `useHash`); a wait for a choice of copy, said as such; or refused.
 */
async function addClicked(pass: Pass, asked: ItemClick, refuse: Refuse) {
  const answer = takeInAnswer('click', foundKey(pass, asked.key, asked.except), asked.use && { harness: asked.use, hash: asked.useHash });
  if ('take' in answer) return takeIn(pass, asked.key, answer, asked.except, 'click');
  if ('wait' in answer) {
    pass.results.push({ item: foundCopies(pass, asked.key, asked.except)[0].name, outcome: 'held', differs: true, message: 'Copies differ. Choose which copy to use.' });
    return;
  }
  refuse(refusedAdd[answer.leave] ?? '', answer.leave === 'choice-changed' ? { chooseAgain: true } : {});
}

/**
 * Synchronize everything (library.ts FOUND, the rule's column): each found key it may take is taken in as a click on Add would
 * take it, and this same pass then applies it. A key it leaves stays found, its row saying why; one left for the settle window
 * brings the next pass soon (`settling`, as a copy missing just now does). Nothing is recorded about what it leaves.
 */
async function takeInByRule(pass: Pass) {
  for (const key of foundKeys(pass)) {
    const answer = takeInAnswer('rule', foundKey(pass, key), undefined, pass.settle), was = pass.library.items[key];
    if ('leave' in answer && answer.leave === 'settling') pass.settle!.settling = true;
    if (!('take' in answer)) continue;
    // A copy saved again while it is kept (its store refuses it, CK_CHANGED) is put back as it was and waits for the next pass;
    // the keys taken in before it stay taken in, each with its entry. Any other failure ends the pass, which says so.
    const before = was && structuredClone(was);
    try { await takeIn(pass, key, answer, [], 'rule'); }
    catch (error) {
      if (errorCode(error) !== 'CK_CHANGED') throw error;
      if (before) pass.library.items[key] = before; else delete pass.library.items[key];
      pass.settle!.settling = true;
    }
  }
}

/** The keys a managed harness has a copy of (its own, or one it has another way) that the library has no live item for. */
const foundKeys = (pass: Pass) => [...new Set([...pass.disk.byKey.keys(), ...(pass.disk.outside?.keys() ?? [])])]
  .filter(key => !pass.library.items[key] || pass.library.items[key].deleted).sort();

/**
 * Takes a found item into the library, On, from the copy the take-in table answered: the one content every harness holds, or
 * the copy the person chose. The other copies become versions as the pass writes over them. An item deleted from Central Knot
 * before is the same item again, its earlier versions with it (only a click comes here for one). `except`: harnesses a click
 * keeps it out of. History's entry is an Add's (the rule's says so), with the harnesses it was found in (`foundIn`: its Undo is
 * offered only while each still holds its copy, historyactions.ts takeInHeld; the rule's notice names them).
 */
async function takeIn(pass: Pass, key: string, answer: { take: FoundCopy; chosen: boolean }, except: HarnessId[], by: TakenBy) {
  const found = foundCopies(pass, key, except), source = found.find(entry => entry.tool === answer.take.harness)!;
  const item = pass.library.items[key] ?? newItem(key, source.name);
  Object.assign(item, { on: true, except: [...except], name: source.name } satisfies Partial<LibraryItem>);
  delete item.deleted;
  pass.library.items[key] = item;
  const from: Source = { how: answer.chosen ? 'chosen' : 'found', harness: source.tool };
  await setCurrent(pass.shelf, item, { hash: source.hash, at: versionAt(source.at), from }, pass.kind.contentOf(source));
  const winner = { tool: source.tool, hash: source.hash };
  const gaveWay = found.filter(entry => entry.hash !== source.hash).map(entry => ({ tool: entry.tool, hash: entry.hash }));
  const foundIn = found.map(entry => entry.tool);
  if (answer.chosen) pass.asked.set(key, { kind: 'chosen', winner, losers: gaveWay, foundIn });
  else pass.asked.set(key, { kind: 'on', cause: by === 'click' ? 'found' : 'sync-everything', winner, fill: 'written', foundIn });
}

/** Synchronize everything's one notice for a pass: how many it took in, by name, and the tools they were found in. */
function takenInNotice(taken: Pass['takenIn']): TakenInNotice {
  const from = [...new Set(taken.flatMap(entry => entry.foundIn))].sort(byToolOrder);
  return { kind: 'taken-in', items: taken.map(entry => entry.name), from, history: taken[0].history };
}

/** Makes an earlier version current: a new version (library.ts setCurrent), which the pass then applies like any other. */
async function makeCurrent(pass: Pass, item: LibraryItem, version: string, refuse: Refuse) {
  const content = item.versions.some(known => known.hash === version) ? await pass.kind.readVersion(pass.context, item.key, version) : undefined;
  if (!content) return refuse('That version is no longer in Central Knot’s store, so it can’t be made current.');
  if (version === item.hash) return refuse(`${item.name} is at that version already.`);
  const previous = item.hash;
  await setCurrent(pass.shelf, item, { hash: version, at: now(), from: { how: 'made-current' } }, content);
  pass.asked.set(item.key, { kind: 'current', previous, version, fill: 'written' });
}

/**
 * Pull (gitrepo.ts): the repo's content becomes the item's current version, "pulled from the Git repo", and the pass applies
 * it wherever the item is On. An item in the library keeps its On or Off. One new here (never in the library, deleted from
 * it, or only found in a harness) comes in On, each copy found here kept first as a copy that gave way to it. The repo's own
 * part for one harness (Claude Code's file, for an agent) is kept as that harness's own part, so a harness with no copy gets
 * it as the repo has it. Removed in the repo: deleted from Central Knot. Each is History's entry with `cause: 'pulled'`.
 */
async function pull(pass: Pass, key: string, brought: Pulled<unknown>) {
  const known = pass.library.items[key], live = known && !known.deleted ? known : undefined;
  if ('removed' in brought) {
    if (live) { live.deleted = { at: now() }; pass.asked.set(key, { kind: 'deleted', cause: 'pulled', fill: 'removed' }); }
    return;
  }
  const { name, content, own } = brought, hash = pass.kind.hashOf(content);
  const item = known ?? newItem(key, name);
  pass.library.items[key] = item;
  if (!live) {
    for (const copy of foundCopies(pass, key, [])) {
      await keepVersion(pass.shelf, item, { hash: copy.hash, at: versionAt(copy.at), from: { how: 'was-in', harness: copy.tool, replacedBy: hash } }, pass.kind.contentOf(copy));
    }
    Object.assign(item, { on: true, except: [] } satisfies Partial<LibraryItem>);
    delete item.deleted;
  }
  const ownChanged = own ? await pass.kind.keepOwn(pass.context, item, own.harness, own.text) : false;
  const previous = item.hash;
  if (hash !== item.hash) await setCurrent(pass.shelf, item, { hash, at: now(), from: { how: 'pulled' } }, content);
  // Only that harness's own part changed, where it doesn't have the item now: kept for when it does (where it has it, the
  // Git repo writes it there with an entry of its own: gitrepo.ts pullClaudeSettings, for agents).
  const hasIt = !!own && wantedIn(item, own.harness) && !!pass.disk.byKey.get(key)?.[own.harness];
  if (!live) pass.asked.set(key, { kind: 'on', cause: 'pulled', fill: 'written' });
  else if (hash !== previous) pass.asked.set(key, { kind: 'edit', cause: 'pulled', previous, version: hash, fill: 'written' });
  else if (ownChanged && !hasIt) pass.asked.set(key, { kind: 'edit', cause: 'pulled', version: hash });
  await saveIfChanged(pass);
}
