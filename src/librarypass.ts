// The pass: the library's model (library.ts) carried out on real files, the same for every kind of item. A kind (agents.ts
// today) implements `Kind`, below, and nothing else: where a harness keeps it, how a copy is read, written and removed in
// that harness's format, a harness's own part, and its record and store. Everything here is the same for every kind:
//
//   lookAt         each managed harness's copies, read once through the kind (Disk); a copy that can't be read for sure is
//                  unseen, never missing
//   deletionsTold  a deleted item that History has no standing entry for gets one, so it always has its Restore
//   pull, click    what Pull brings, and what the person asked (On, Off, a harness kept out, a version made current, Delete,
//                  Restore, a found item taken in), recorded on the item
//   guardFolders   on the items as the clicks left them: a harness managed again (library.ts managedAgain, for every item at
//                  once), a folder moved, made again or gone
//   syncItem       the library's plan for the item (copiesOf, plan), carried out by carryOut: History first (logItem), then
//                  versions and the record, then each harness's copy (writeCopy, removeCopy, through the kind)
//   keepFolders    the folder identities the next pass compares with
//
// Also here: the page's look (lookFor: the same reading, guards applied in memory, nothing saved), so a mark says what a pass
// will do; a History entry's action (restore), which is always one of the clicks above; and the tool choice letting folders
// go (forgetFolders). What a kind's page shows, and how the Git repo reads it, stay with the kind (agents.ts agentsView,
// agentsForRepo). History's sentences and actions for a kind's entries are its own (historyactions.ts for agents).
//
// Words: a `Kind` is what one kind implements (below); its `Disk` is what it read of the managed harnesses now; a `Look` is
// one pass's or one page's reading (the Disk with the record, the folders and the settle clock); a `Shelf` (library.ts)
// stores a version's content and saves the record; `Hands` (library.ts) is what carryOut is given to act with, which
// syncItem builds from the Kind. An `ItemClick` is what a person asked of one item (On, kept out, a version, Delete). A copy
// that can't be seen for sure is `unseen` (Disk.unseen says why); a `held` copy is one nothing of Central Knot's goes to
// (Disk.held, and a folder that can't be written: Disk.locked). A pass answers with a types.ts PassResult; a result in it
// with `outcome: 'held'` (types.ts DestinationResult, the app's word for an action not done this time) is not a held copy.
//
// Where the library meets the app's types, which the skills and MCP engines share and name for themselves: a click comes
// as a types.ts Change and itemClick makes it an ItemClick (`managed` is On); a kind's page view is a types.ts LibraryView,
// which the page reads through itemrow.ts kindSource.
//
// To put another kind on the library (agents are the worked example; the compiler names a member `Kind` lacks):
// - its name in library.ts ItemKind, and one object implementing `Kind`, like agents.ts agentKind. A kind with no part of
//   its own per tool has `ownOf` answer undefined and `keepOwn` false;
// - its callers: runPass for its passes (the page's clicks through itemClick), restore for History's actions, lookFor for
//   its page, and forgetFolders from toolchoice.ts chooseTools.
// Outside the contract, one place each:
// - its page's rows: what each says and the clicks it sends (agents.ts agentsView gives a LibraryView; its words in
//   libraryrow.ts libraryWords and its entry in librarykinds.ts libraryKinds; matrix.ts draws them);
// - History's sentences and actions for its entries (historyactions.ts for agents; historypage.ts asks it);
// - the app's wiring: main.ts (its passes, in the background and on a click through the `changes` sanitizer; its view; a
//   History action sent on by its key's prefix), preload.ts (the page's calls), types.ts HomeView (its LibraryView in the
//   home's), itemrow.ts kindSource (where every page reads it), app.ts (its page: the call it sends, where its result is kept).
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { carryOut, keepVersion, managedAgain, newItem, plan, setCurrent, versionAt, wantedIn } from './library.ts';
import type { Copies, HarnessCopy, ItemKind, LibraryItem, Plan, Shelf, Source, Version } from './library.ts';
import { appendHistory, historyCutoff, readHistory, replaceHistory } from './manage.ts';
import { newRecord, readRecord, remember, saveRecord, syncGate, writeAccess } from './share.ts';
import type { ShareContext } from './share.ts';
import type { Change, DestinationResult, HarnessId, HistoryEvent, PassResult, SyncNotice } from './types.ts';
import { toolName } from './words.ts';

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
  /** Why a harness's folder can't be written now: no copy there can be written or removed (its copies are still read). */
  locked: Map<HarnessId, string>;
  /** What could not be read, in words for the page. */
  problems: string[];
  /**
   * Why a harness the item is wanted in, with no copy of its own, is held (library.ts HarnessCopy), for the kind's own
   * reasons: it can't be given one (a name it can't store), or it has it another way (`anotherWay`: through a plugin, or a
   * tool that reads another's folder while the item is in that one). Undefined when it can be given it. `item` is as this
   * pass's clicks left it, so library.ts wantedIn says where else it is wanted; what the other harnesses hold is this Disk's
   * (byKey, unseen). A folder that can't be written is `locked`, which the pass adds itself. Worked out at each look, never stored.
   */
  held(item: Wanted, harness: HarnessId): { why: string; anotherWay?: true } | undefined;
}
/** An item as Disk.held is told of it: its name, and where it is wanted (library.ts wantedIn). */
export type Wanted = Pick<LibraryItem, 'key' | 'name' | 'on' | 'except' | 'deleted'>;

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
  pathOf(context: ShareContext, harness: HarnessId, name: string): string;
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
   * part kept; else as the copy the harness last had (its kept own part), or a new one. Keeps what it wrote as that harness's
   * own part. Answers why it could not be written, if it couldn't (the next pass tries again).
   */
  write(context: ShareContext, item: LibraryItem, harness: HarnessId, here: Entry | undefined, content: Content): Promise<{ stopped: string } | undefined>;
  /** Removes one harness's copy, only while it is as read: `changed` when a save landed meanwhile. */
  remove(context: ShareContext, item: LibraryItem, here: Entry): Promise<'removed' | 'changed' | 'failed'>;
  /** A History entry's action as the click it is, from the entry and the item now; undefined when it has nothing left to do. */
  historyAction(entry: HistoryEvent, item: LibraryItem | undefined, version?: string): { click: ItemClick } | undefined;
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
}

/**
 * The page's click (types.ts Change, which the skills and MCP engines share) as the library's: the one place the two meet.
 * `managed` is On, `off` the harnesses it is kept out of; a Change's fields for the other engines are left behind.
 */
export function itemClick(change: Change): ItemClick {
  const { key, managed: on, off, seenManaged: seenOn, useHash, version, deleted } = change;
  return { key, on, except: [...off], seenOn, use: change.use === 'separate' ? undefined : change.use, useHash, version, deleted };
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
    const info = await stat(path).catch(() => undefined);
    const here: FolderSeen = info?.isDirectory() ? { path, ino: info.ino, birth: Math.round(info.birthtimeMs) } : { path, away: true };
    const forget = (which: LibraryItem[]) => { for (const item of which) delete item.applied[tool]; };
    if ('away' in here) {
      const backWithoutFolder = !was && Object.values(look.library.items).some(item => item.applied[tool] !== undefined);
      if (!backWithoutFolder) look.foldersNow[tool] = here;
      const applied = items.filter(item => item.applied[tool] !== undefined);
      if (!applied.length) continue;
      const where = `${toolName(tool)}’s ${look.kind.words.folder}`;
      if (stillSettling(look, path)) { look.disk.unseen.set(`${tool}:*`, `${where} isn’t there just now. If it stays away, Central Knot writes it afresh.`); continue; }
      forget(applied.filter(item => wantedIn(item, tool)));
      const owed = `${where} isn’t there. Its copy is removed once the folder is back.`;
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
  if (here) { seenAgain(look, path); return { is: 'present', hash: here.hash, at: here.at }; }
  const wanted = wantedIn(item, tool), locked = look.disk.locked.get(tool);
  const held = wanted ? look.disk.held(item, tool) ?? (locked ? { why: locked } : undefined) : undefined;
  if (held) return { is: 'held', ...held };
  const { copy, item: noun } = look.kind.words;
  const missing = `${toolName(tool)}’s ${copy} for it is missing just now. If it stays missing, the ${noun} turns off everywhere.`;
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
 * The copies a found item is taken in from: one per managed harness that has it, can be read and isn't kept out (`off`).
 * Where they differ, the person chooses which one every harness takes (the copy question): the switch asks, and takeIn waits.
 */
export function foundCopies<E extends Seen>(look: Look<unknown, E, Disk<E>>, key: string, off: readonly HarnessId[]): E[] {
  const slot = look.disk.byKey.get(key) ?? {};
  return look.managed.flatMap(tool => (slot[tool] && !off.includes(tool) && !unseenIn(look.disk, tool, key) ? [slot[tool]!] : []));
}
export const differ = (copies: Seen[]) => new Set(copies.map(entry => entry.hash)).size > 1;

// ---------- A pass ----------

/**
 * What was asked of a pass for one item (a click, or what Pull brings), as the History entry it becomes: begun when it is
 * recorded, finished with the harnesses its plan writes or removes (`fill`: which of them it names).
 */
type Asked = Pick<HistoryEvent, 'kind' | 'cause' | 'winner' | 'only' | 'version' | 'previous'> & { losers?: HistoryEvent['losers']; fill?: 'written' | 'removed' };
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
  /** The settle window and its clock; tests pass their own. */
  settleMs?: number; now?: number;
}

/** One pass of a kind: the `clicks`, then every item in its library brought into line with its harnesses (library.ts plan). */
export async function runPass<C, E extends Seen, D extends Disk<E>>(
  kind: Kind<C, E, D>, context: ShareContext, tools: readonly HarnessId[], clicks: ItemClick[], options: PassOptions<C> = {},
): Promise<PassResult> {
  const refused = await refusal(context, clicks.length > 0 || !!options.pulled?.size, options.resume);
  if (refused) return refused;
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
  const pass: Pass = { ...look, shelf: { store, save: () => saveIfChanged(pass) }, saved, asked: new Map(), results: [], notices: [], writes: 0, made: [] };
  await deletionsTold(pass);
  for (const [key, brought] of options.pulled ?? []) await pull(pass, key, brought);
  for (const asked of clicks) await click(pass, asked);
  const items = Object.values(library.items).filter(item => inScope(item.key));
  await guardFolders(pass, items, pass.shelf);
  for (const item of items) await syncItem(pass, item);
  keepFolders(library, pass.foldersNow, managed, !options.only);
  await saveIfChanged(pass);
  return { results: pass.results, writes: pass.writes, notices: pass.notices, settling: settle.settling, made: pass.made };
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
  keepFolders(library, {}, managed, true);
  await kind.save(context.home, library);
}

/** Saves the record when it is not as last saved: before any harness file changes (syncItem), and when the pass ends. */
async function saveIfChanged(pass: Pass) {
  const text = JSON.stringify(pass.library);
  if (text === pass.saved) return;
  await pass.kind.save(pass.context.home, pass.library);
  pass.saved = text;
}

/**
 * Why nothing may be written right now, if so: a preview-only home, another build's record, or one that needs Resume. A home
 * with no sync record yet gets one when something is asked of the pass (`asked`: a click, or what Pull brings); else it has nothing to do.
 */
async function refusal(context: ShareContext, asked: boolean, resume = false): Promise<PassResult | undefined> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason, results: [], writes: 0 };
  const gate = await syncGate(context);
  if (gate.state === 'stopped' || (gate.state === 'needs-resume' && !resume)) return { stopped: gate.reason, results: [], writes: 0 };
  let { record: syncRecord } = await readRecord(context.home);
  if (!syncRecord && !asked) return { results: [], writes: 0 };
  if (!syncRecord) { syncRecord = newRecord(context); await saveRecord(context.home, syncRecord); }
  if (gate.state !== 'ready') await remember(context, syncRecord.generation);
  return undefined;
}

/** Brings one item into line with its harnesses: the library's plan, carried out in the library's order (carryOut). */
async function syncItem(pass: Pass, item: LibraryItem) {
  const { kind, context } = pass, slot = pass.disk.byKey.get(item.key) ?? {};
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
    write: harness => writeCopy(pass, item, harness, slot[harness]),
    remove: harness => removeCopy(pass, item, slot[harness]!),
  });
}

/** Writes the current version into one harness (Kind.write). True when it is there (carryOut notes it as applied). */
async function writeCopy(pass: Pass, item: LibraryItem, tool: HarnessId, here: Seen | undefined): Promise<boolean> {
  const stopped = (message: string) => { pass.results.push({ item: item.name, harness: tool, outcome: 'held', message }); return false; };
  const content = await pass.kind.readVersion(pass.context, item.key, item.hash);
  if (!content) return stopped('This version is no longer in Central Knot’s store, so it can’t be written.');
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
  const told = new Set((await readHistory(pass.context)).filter(event => event.kind === 'deleted' && !event.undoneBy).map(event => event.key));
  const untold = recent.filter(item => !told.has(`${prefix}${item.key}`));
  await appendHistory(pass.context, untold.map(item => ({
    id: randomUUID(), at: item.deleted!.at, key: `${prefix}${item.key}`, item: item.name, kind: 'deleted', losers: [], orderProved: true })));
}

/**
 * History's entries for one item's pass, made before anything of it is saved (carryOut): what was asked (with the harnesses
 * its plan writes or removes), an edit taken in, and a copy deleted by hand that turned it Off. The last two are also notices,
 * since no one asked for them. A harness whose copy can't be changed this time is said in the pass's results, and the next
 * pass finishes it. A copy a harness managed again gives way with has its entry from cameBack, which may concern an item
 * outside this pass.
 */
function logItem(pass: Pass, item: LibraryItem, made: Plan, slot: Partial<Record<HarnessId, Seen>>): HistoryEvent[] {
  // The item as it is before the plan is carried out: the edit taken in is current only after this is told.
  const taken = made.takeIn ? slot[made.takeIn]!.hash : item.hash;
  const key = `${pass.kind.historyPrefix}${item.key}`, events: HistoryEvent[] = [];
  // What the plan will change: not in a harness whose folder can't be written, so no entry or notice claims it.
  const can = (tools: HarnessId[]) => tools.filter(tool => !pass.disk.locked.has(tool));
  const did = { written: can(made.write), removed: can(made.remove) };
  const log = (fields: Omit<HistoryEvent, 'id' | 'at' | 'key' | 'item' | 'orderProved'>) => {
    const event: HistoryEvent = { id: randomUUID(), at: now(), key, item: item.name, orderProved: true, ...fields };
    events.push(event);
    return event.id;
  };
  const notice = (kind: SyncNotice['kind'], winner: HarnessId, losers: HarnessId[], history: string) =>
    pass.notices.push({ key, item: item.name, kind, winner, losers, orderProved: true, history });
  /** Each of these harnesses with what it held before the pass. */
  const before = (tools: HarnessId[]) => tools.map(tool => ({ tool, hash: slot[tool]?.hash ?? '' }));
  const asked = pass.asked.get(item.key);
  if (asked) {
    const { fill, ...entry } = asked;
    const id = log({ ...entry, losers: entry.losers ?? (fill ? before(did[fill]) : []) });
    // A found item taken in has no click that puts things back as they were, so it is not offered as the click's Undo.
    const tookIn = entry.kind === 'chosen' || entry.cause === 'found';
    if (!tookIn) pass.made.push(id);
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
  return events;
}

/**
 * A History entry's action (Kind.historyAction says which click it is, from the entry and the item as it is now); that click
 * runs like any other, and the entry is marked done by the entry the click makes. `version`: one of the entry's version
 * choices instead of its own action.
 */
export async function restore<C, E extends Seen, D extends Disk<E>>(
  kind: Kind<C, E, D>, context: ShareContext, tools: readonly HarnessId[], eventId: string, version?: string,
): Promise<PassResult> {
  const past = (await readHistory(context)).find(entry => entry.id === eventId);
  const key = past?.key.slice(kind.historyPrefix.length) ?? '';
  const { library, problem } = await kind.open(context);
  if (problem) return { stopped: problem, results: [], writes: 0 };
  const action = past && kind.historyAction(past, library.items[key], version);
  if (!action) return { stopped: `That change has nothing left to undo: the ${kind.words.item} is as that would leave it.`, results: [], writes: 0 };
  const done = await runPass(kind, context, tools, [action.click], { only: new Set([key]) });
  // One of an entry's version choices ("Use Codex’s") leaves the entry open: its other choices still stand.
  if (!done.made?.length || version) return done;
  const history = await readHistory(context);
  const entry = history.find(event => event.id === eventId);
  if (entry) { entry.undoneBy = done.made[0]; await replaceHistory(context, history); }
  return done;
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
  if (asked.deleted === false) {
    if (!known?.deleted) return;
    delete known.deleted;
    pass.asked.set(known.key, { kind: 'restored', fill: 'written' });
  } else if (!item) {
    if (asked.on) await takeIn(pass, asked, known, refuse);
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

/**
 * Takes a found item into the library, On: the copy every harness gets is the one they all hold, or, where they differ, the
 * one the person chose (`use`); with no choice made yet, it waits for one. The other copies become versions as the pass
 * writes over them. An item deleted from Central Knot before is the same item again, its earlier versions with it.
 */
async function takeIn(pass: Pass, asked: ItemClick, tombstone: LibraryItem | undefined, refuse: Refuse) {
  const found = foundCopies(pass, asked.key, asked.except);
  if (!found.length) return refuse('No tool has a copy of it to take in any more.');
  const chosen = asked.use ? found.find(entry => entry.tool === asked.use) : undefined;
  const changedSince = asked.use && (!chosen || (asked.useHash && chosen.hash !== asked.useHash));
  if (changedSince) return refuse('The copy you chose changed since you chose it. Nothing was changed; choose again.', { chooseAgain: true });
  const differs = differ(found);
  if (differs && !chosen) {
    pass.results.push({ item: found[0].name, outcome: 'held', differs: true, message: 'Copies differ. Choose which copy to use.' });
    return;
  }
  const source = chosen ?? found[0];
  const item = tombstone ?? newItem(pass.kind.kind, asked.key, source.name);
  Object.assign(item, { on: true, except: [...asked.except], name: source.name } satisfies Partial<LibraryItem>);
  delete item.deleted;
  pass.library.items[item.key] = item;
  const from: Source = { how: differs ? 'chosen' : 'found', harness: source.tool };
  await setCurrent(pass.shelf, item, { hash: source.hash, at: versionAt(source.at), from }, pass.kind.contentOf(source));
  const winner = { tool: source.tool, hash: source.hash };
  const gaveWay = found.filter(entry => entry.hash !== source.hash).map(entry => ({ tool: entry.tool, hash: entry.hash }));
  pass.asked.set(item.key, differs ? { kind: 'chosen', winner, losers: gaveWay } : { kind: 'on', cause: 'found', winner, fill: 'written' });
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
  const item = known ?? newItem(pass.kind.kind, key, name);
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
