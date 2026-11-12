// Central Knot's library: the model every kind of item follows. Pure: no files, no DOM. Agents use it today (agents.ts);
// skills and MCP servers still follow their own engines until they are moved onto it. A kind is carried by the pass in
// librarypass.ts, whose `Kind` is the contract a kind implements; this file is only the model.
//
// Central Knot holds each item itself, with its versions. A harness (Claude Code, Codex, …) is not where an item lives: it is
// somewhere an item is applied. Five ideas, and nothing else, describe an item:
//
//   item     What Central Knot holds (LibraryItem): one current version, and On or Off. On: applied to every managed
//            harness. Off: in no harness; the item, its versions and each harness's own part stay in Central Knot.
//   harness  A tool Central Knot manages in this home (presence.ts managedTools). An item's `except` names the harnesses
//            the person keeps it out of: the only thing stored per harness that a person chose.
//   apply    Putting the current version into a harness, or taking its copy out. `applied` remembers which version
//            Central Knot last put or saw in each harness.
//   version  One content the item has had, with when it was made and where it came from. Every version is kept until the
//            item is deleted. Only keepVersion and setCurrent add one.
//   found    Something a managed harness has that the library doesn't. It is no item state: a person takes it in.
//
// Content has two parts for agents and MCP servers: the shared part, which a version's hash names (an agent's name,
// description and prompt), and each harness's own part (the other fields of its file). The library keeps the latest own
// part per harness (`own`: its file as a pass last saw or wrote it), so Off then On, or Turn on after a copy was deleted by
// hand, writes the same file back, byte for byte. A skill's version is its whole folder.
//
// THE RULE. What happens in one harness follows from three contents: L, the item's current version; H, what the harness
// holds now; A, what was applied there last. `decide` is this table, one line per row:
//
//   item or harness     harness copy H                             what happens there
//   On                  H = L                                      nothing
//   On                  H = A and L moved on; or no copy, no A     L is written
//   On                  H changed, L = A                           H becomes the current version, from that harness
//   On                  H changed and L moved on                   the latest wins; the other is kept as a version
//   On                  a copy, no A                               kept as a version, then L is written
//   On                  no copy, after A                           it was deleted by hand: the item turns Off everywhere
//   Off, or kept out    H = A, or H = L                            removed
//   Off, or kept out    H changed, L = A                           H becomes the current version, then it is removed
//   Off, or kept out    H changed and L moved on                   the latest wins, the other is kept as a version; then removed
//   Off, or kept out    a copy, no A                               a found copy: left alone
//   Off, or kept out    no copy, after A                           nothing is applied there any more (forgotten)
//   either              held: it can't be given the item           nothing (its mark says why)
//   either              held: it has the item another way          nothing of Central Knot's goes there, and A is let go: when
//                                                                  the other way ends, L is written, never read as a deletion
//
// "H changed" is an edit made in that harness: it flows back into Central Knot whether the item is On or Off there. Of two
// edits the latest wins: an edit made on the current version (L = A) always counts, one made where L had moved on as well
// only when it is later than L. A copy with no time of its own (`at` absent: an MCP entry, whose time is its whole file's)
// can't be ordered: such an edit counts only when made on the current version, and of several the first harness wins (as
// equal times do); one made where L had moved on as well loses to L and is kept as a version. `plan` applies the table to
// every managed harness of one item at once and says what to keep, write and remove.
//
// "Held" has two reasons, both worked out at each look and never stored: it can't be given the item (a name it can't store, a
// folder it can't write), or it has the item another way (`anotherWay`: through a plugin; for skills, OpenCode reading Claude
// Code's folder, a link, or a copy in ~/.agents/skills that Central Knot doesn't own). Only the second lets A go, since
// Central Knot's copy is not what the harness has.
//
// A HARNESS MANAGED AGAIN (left out by the tool choice, or uninstalled, then back): the library wins there.
//
//   item there          the copy went meanwhile                    the copy was edited meanwhile, or is another item of that name
//   On                  L is written                               kept as a version ("was in Codex"), then L is written
//   Off, or kept out    nothing                                    kept as a version, then removed
//   deleted             nothing                                    a found copy: left alone
//
// Nothing turns Off because a tool was away, and a copy as Central Knot left it (a content the item holds) is written over
// or removed as any other, a deleted item's too. This is one step before the table (`managedAgain`): for every item that had
// something applied there, A becomes what the harness holds now (no copy: nothing), its content kept as a version first;
// a deleted item keeps no new content, so a copy it never had is left with nothing applied, which the table calls found.
// The table then does the rest, and later edits and deletions there count as any other. The pass takes that step once, for
// every item at once, the first time it sees the harness back with its folder there (librarypass.ts guardFolders), so it
// holds whichever pass comes first.
//
// Two promises hold the model together:
// - H unseen is never H gone. A copy the adapter can't see for sure (unreadable, half saved, inside the settle window,
//   its folder away) is `unseen`, and nothing happens in that harness. Only a copy that is really gone turns an item Off.
// - Version first, disk second. A content is stored and recorded as a version (keepVersion, setCurrent) before any harness
//   file is written over or removed. A crash in between leaves a version too many, never a content too few, and the next
//   pass finds H = A and finishes the write or the removal.
//
// Nothing else is stored. Whether a harness can't hold the item, has it another way (and, for MCP servers, waits) is a
// `held` copy, worked out at each look with its reason and shown as that harness's mark. A library item never waits for a
// choice: the copy question exists only when a found item whose copies differ is taken in.
//
// Still shaped for agents, to settle when skills and MCP servers come: `own` holds a harness's whole file by its hash, where
// an MCP entry's own part is a fragment of a shared file; `key` compares names as macOS compares file names.
//
// Worked examples, one per row of the table: tests/library.test.ts. The same on real files: tests/agents.test.ts.
import type { HarnessId } from './types.ts';
import { toolName } from './words.ts';

/** Every kind of item on the library. A new kind adds its name here first (librarypass.ts's header has the rest of the recipe). */
export type ItemKind = 'skill' | 'agent' | 'mcp';

/**
 * Where a version came from: taken in from a harness that had it (`found`, or `chosen` among copies that differed), edited
 * by hand in a harness (`edited`), a harness's copy that gave way to the current version (`was-in`), Pull (`pulled`), an
 * earlier version made current (`made-current`), or the record from before the library (`migrated`). `replacedBy`: on a
 * `was-in` copy, the version written over it, which its line on the page is compared with (absent in older records).
 */
export interface Source { how: 'found' | 'chosen' | 'edited' | 'was-in' | 'pulled' | 'made-current' | 'migrated'; harness?: HarnessId; replacedBy?: string }

/** One content an item has had. `at`: when it was made (a harness file's own time for a copy taken in; else the click's), shown beside it. */
export interface Version { hash: string; at: string; from: Source }

/**
 * A listed version's note, as the kind works it out (agents.ts changesOf) and its row says it (libraryrow.ts versionChange):
 * `changed`, the parts of it that differ from the version current before it; `differs`, for a copy that gave way (`was-in`),
 * the parts that differ from the version written over it. Each part by the kind's word for it ("prompt"). `first`: the first
 * version, taken alone. `none`: nothing to note (the copy chosen among several: its words say so). `unknown`: a content no
 * longer kept.
 */
export type VersionChange = { changed: string[] } | { differs: string[] } | 'first' | 'none' | 'unknown';

/** One item as Central Knot holds it. The same shape for every kind. */
export interface LibraryItem {
  kind: ItemKind;
  /** Its name as one key across harnesses (lower case, as macOS compares file names). */
  key: string;
  /** Its name as written, which its files in the harnesses take. */
  name: string;
  /**
   * The only item state a person sets: On (applied to every managed harness but `except`) or Off (in none). A deleted item
   * keeps it as it was, so Restore only lifts the tombstone (`deleted` comes first: wantedIn).
   */
  on: boolean;
  /** The current version: the content On applies. */
  hash: string;
  /** Every content it has had, in the order Central Knot took them, newest first (`listed` shows one per content, the current one first). */
  versions: Version[];
  /** The harnesses the person keeps it out of. */
  except: HarnessId[];
  /** A: the version Central Knot last put or saw in each harness. No entry: nothing applied there. */
  applied: Partial<Record<HarnessId, string>>;
  /** Each harness's own part as a pass last saw or wrote it, by the name the kind's store keeps it under. Stays after Off, for the next On. */
  own: Partial<Record<HarnessId, string>>;
  /** Deleted from Central Knot (a tombstone): in no harness, and a copy that turns up is found, never taken in by itself. */
  deleted?: { at: string };
}

export const newItem = (kind: ItemKind, key: string, name: string): LibraryItem =>
  ({ kind, key, name, on: false, hash: '', versions: [], except: [], applied: {}, own: {} });

/** Whether a record's value has an item's shape (a record is read from disk, so nothing about it is taken on trust). */
export function isLibraryItem(value: unknown): value is LibraryItem {
  const item = value as Partial<LibraryItem> | null;
  const text = (entry: unknown) => typeof entry === 'string';
  const texts = (map: unknown) => !!map && typeof map === 'object' && !Array.isArray(map) && Object.values(map).every(text);
  const version = (entry: Partial<Version> | null) => text(entry?.hash) && text(entry?.at) && text(entry?.from?.how);
  return !!item && typeof item === 'object' && text(item.key) && text(item.name) && typeof item.on === 'boolean' && text(item.hash)
    && Array.isArray(item.versions) && item.versions.every(version) && Array.isArray(item.except) && texts(item.applied) && texts(item.own)
    && (item.deleted === undefined || text(item.deleted?.at));
}

/** Where the current version is in `versions`: the newest entry that holds the current content (an earlier entry may hold it too). */
export const currentIndex = (item: Pick<LibraryItem, 'hash' | 'versions'>) => item.versions.findIndex(version => version.hash === item.hash);

/**
 * The versions as a person reads them, one per content: the current one first, then the others in the order Central Knot
 * took them, newest first, each content at its newest entry (an earlier entry with the same content, such as the one a
 * Make current went back to, is folded into it). Not by their times: a file can carry any time, and a copy kept as a
 * version may be taken after the current one. `versions` itself keeps every entry.
 */
export function listed(item: Pick<LibraryItem, 'hash' | 'versions'>): Version[] {
  const at = currentIndex(item), seen = new Set<string>();
  const ordered = at < 0 ? item.versions : [item.versions[at], ...item.versions.filter((_, index) => index !== at)];
  return ordered.filter(version => !seen.has(version.hash) && !!seen.add(version.hash));
}

/** Whether the item should be in this harness: On, not deleted, and not kept out of it. */
export const wantedIn = (item: Pick<LibraryItem, 'on' | 'deleted' | 'except'>, harness: HarnessId) =>
  item.on && !item.deleted && !item.except.includes(harness);

/** A version in words: "edited in Codex", "was in Copilot CLI", "made current again". */
export function sourceWords({ how, harness }: Source): string {
  const where = harness ? toolName(harness) : 'a harness';
  return { found: `found in ${where}`, chosen: `chosen from ${where}`, edited: `edited in ${where}`, 'was-in': `was in ${where}`,
    pulled: 'pulled from the Git repo', 'made-current': 'made current again', migrated: 'from before Central Knot kept versions' }[how];
}

// ---------- The rule ----------

/**
 * H: what a harness holds of an item now. `at`: when its copy was last changed (ms); absent for a copy with no time of its
 * own (an MCP entry, whose time is its whole file's), which "latest" can't order (latestEdit). Nothing of Central Knot's
 * happens in a harness whose copy is `unseen` (it can't be seen for sure) or `held` (it can't be given the item; with
 * `anotherWay`, it has the item another way: the header says which is which), and `why` says it on the page.
 */
export type HarnessCopy = { is: 'present'; hash: string; at?: number } | { is: 'absent' } | { is: 'unseen'; why: string }
  | { is: 'held'; why: string; anotherWay?: true };

/**
 * The table's results, one per row. `forget`: nothing of Central Knot's is there any more (a removal owed where the copy is
 * gone already, or a harness that has the item another way), so A is let go. `take-in` (L = A) and `latest-wins` (L moved on
 * too) are both an edit in that harness; they differ only in when the edit counts (latestEdit).
 */
export type Verdict = 'nothing' | 'write' | 'take-in' | 'latest-wins' | 'keep-then-write' | 'turn-off' | 'remove' | 'found' | 'forget';

/**
 * The rule for one harness (the table above). `wanted`: the item is On and this harness is not excepted (wantedIn).
 * `current` is L, `copy` is H, `applied` is A.
 */
export function decide(wanted: boolean, current: string, copy: HarnessCopy, applied: string | undefined): Verdict {
  if (copy.is === 'held' && copy.anotherWay) return applied === undefined ? 'nothing' : 'forget';
  if (copy.is === 'unseen' || copy.is === 'held') return 'nothing';
  if (!wanted) {
    if (copy.is === 'absent') return applied === undefined ? 'nothing' : 'forget';
    if (applied === undefined) return 'found';
    if (copy.hash === applied || copy.hash === current) return 'remove';
    return applied === current ? 'take-in' : 'latest-wins';
  }
  if (copy.is === 'absent') return applied === undefined ? 'write' : 'turn-off';
  if (copy.hash === current) return 'nothing';
  if (applied === undefined) return 'keep-then-write';
  if (copy.hash === applied) return 'write';
  return applied === current ? 'take-in' : 'latest-wins';
}

/** What a pass does for one item, in the order it is done: versions first (`takeIn`, `keep`), then the harnesses' files. */
export interface Plan {
  /** The harness whose changed copy becomes the current version. */
  takeIn?: HarnessId;
  /** The item turns Off: the harness where its copy was deleted by hand. */
  turnedOffBy?: HarnessId;
  /** Copies to keep as versions before they are written over or removed, each with where it came from. */
  keep: { harness: HarnessId; from: Source }[];
  /** Harnesses the current version is written to. */
  write: HarnessId[];
  /** Harnesses whose copy is removed. */
  remove: HarnessId[];
  /** Harnesses where a removal was owed and the copy is gone already: nothing is applied there any more. */
  forget: HarnessId[];
  /** Harnesses that hold the current version already. */
  current: HarnessId[];
  /** Harnesses with a copy Central Knot never applied, while the item is Off or kept out of them: left alone. */
  found: HarnessId[];
}

export type Copies = Partial<Record<HarnessId, HarnessCopy>>;

/**
 * Applies the rule to every managed harness of one item (`copies`: what each holds now, in the harnesses' order).
 * Two things concern the whole item, so they are settled first: which edit becomes the current version (latestEdit), and
 * whether a copy deleted by hand turns the item Off. Then each harness follows the table against the item as it will be:
 * there the harness taken in holds the current version, and every other edit has lost to it.
 */
export function plan(item: LibraryItem, copies: Copies): Plan {
  const harnesses = Object.keys(copies) as HarnessId[];
  const verdict = (state: LibraryItem, harness: HarnessId) => decide(wantedIn(state, harness), state.hash, copies[harness]!, state.applied[harness]);
  const takeIn = latestEdit(item, copies, new Map(harnesses.map(harness => [harness, verdict(item, harness)])));
  const turnedOffBy = harnesses.find(harness => verdict(item, harness) === 'turn-off');
  const taken = takeIn ? (copies[takeIn] as { hash: string }).hash : item.hash;
  const after: LibraryItem = { ...item, on: item.on && !turnedOffBy, hash: taken };
  const made: Plan = { takeIn, turnedOffBy, keep: [], write: [], remove: [], forget: [], current: [], found: [] };
  const known = new Set(item.versions.map(version => version.hash));
  for (const harness of harnesses) {
    const copy = copies[harness]!, does = verdict(after, harness), wanted = wantedIn(after, harness);
    const lost = does === 'take-in' || does === 'latest-wins';
    // A copy about to be written over or removed is kept first, unless the library has that content already.
    if (copy.is === 'present' && !known.has(copy.hash) && (lost || does === 'keep-then-write')) {
      made.keep.push({ harness, from: does === 'keep-then-write' ? { how: 'was-in', harness, replacedBy: taken } : { how: 'edited', harness } });
      known.add(copy.hash);
    }
    if (does === 'write' || does === 'keep-then-write' || (lost && wanted)) made.write.push(harness);
    else if (does === 'remove' || lost) made.remove.push(harness);
    else if (does === 'forget' || does === 'found') made[does].push(harness);
    else if (does === 'nothing' && copy.is === 'present' && copy.hash === after.hash && wanted) made.current.push(harness);
  }
  return made;
}

/**
 * The edit that becomes the current version, among the harnesses whose copy is one (`verdicts`): the latest. An edit made on
 * the current version (`take-in`) always counts; one made where the current version had moved on as well (`latest-wins`)
 * only when it is later than the current version. A copy with no time of its own is later than nothing: of several edits
 * that count, the first harness wins where none has a time (the sort keeps the harnesses' order).
 */
function latestEdit(item: LibraryItem, copies: Copies, verdicts: Map<HarnessId, Verdict>): HarnessId | undefined {
  const at = (harness: HarnessId) => (copies[harness] as { at?: number }).at ?? -Infinity;
  const currentSince = Date.parse(item.versions[currentIndex(item)]?.at ?? '') || 0;
  const counts = [...verdicts].filter(([harness, does]) => does === 'take-in' || (does === 'latest-wins' && at(harness) > currentSince));
  // Two copies with no time compare as NaN, which a sort takes as equal: they stay in the harnesses' order.
  return counts.map(([harness]) => harness).sort((first, second) => at(second) - at(first))[0];
}

/**
 * A harness managed again (the header's second table), for one item: the step before the table. Where something was applied,
 * A becomes what the harness holds now: its copy's content, or nothing where it has no copy of its own. Returns the version
 * to keep first when that content is not one of the item's ("was in Codex", given way to the current version); the caller
 * keeps it (keepVersion) before any harness file changes. A deleted item keeps no new content: a copy it never had is left
 * with nothing applied (a found copy). A copy that can't be seen leaves A as it is.
 */
export function managedAgain(item: LibraryItem, harness: HarnessId, copy: HarnessCopy): Version | undefined {
  if (item.applied[harness] === undefined || copy.is === 'unseen') return undefined;
  const holds = copy.is === 'present' && item.versions.some(version => version.hash === copy.hash);
  if (copy.is !== 'present' || (item.deleted && !holds)) { delete item.applied[harness]; return undefined; }
  item.applied[harness] = copy.hash;
  return holds ? undefined : { hash: copy.hash, at: versionAt(copy.at), from: { how: 'was-in', harness, replacedBy: item.hash } };
}

/** A version's time for a copy taken in: the copy's own time, or the time it is taken where it has none (an MCP entry). */
export const versionAt = (at: number | undefined) => new Date(at ?? Date.now()).toISOString();

// ---------- Versions ----------

/** Where a kind keeps its items: the adapter's store for one content, and its record's save. */
export interface Shelf<Content> {
  /** Stores a content under the item, by its hash. Storing the same content again changes nothing. */
  store(item: LibraryItem, hash: string, content: Content): Promise<void>;
  /** Saves the record that holds the item. */
  save(): Promise<void>;
}

/**
 * Keeps a content as a version of the item without making it current (a copy that gave way). Stored, recorded and saved
 * before it returns, so the caller may then write over or remove the file it came from. A content the item has already is
 * stored again (harmless) and not listed twice.
 */
export async function keepVersion<Content>(shelf: Shelf<Content>, item: LibraryItem, version: Version, content: Content): Promise<void> {
  await shelf.store(item, version.hash, content);
  if (!item.versions.some(known => known.hash === version.hash)) item.versions = [version, ...item.versions];
  await shelf.save();
}

/**
 * The one way an item's current version changes: an edit taken in, a found copy taken in, Pull, or an earlier version made
 * current. The content is stored, the version recorded and the record saved before it returns: only then may any harness
 * be written or removed. Always a new entry in `versions`, so the list says when each content was current.
 */
export async function setCurrent<Content>(shelf: Shelf<Content>, item: LibraryItem, version: Version, content: Content): Promise<void> {
  await shelf.store(item, version.hash, content);
  item.versions = [version, ...item.versions];
  item.hash = version.hash;
  await shelf.save();
}

// ---------- Carrying a plan out ----------

/**
 * What carryOut is given to act with, besides keeping contents (Shelf). The pass builds it for each item from the kind's
 * contract (librarypass.ts syncItem and Kind); no kind implements it itself. It only acts and answers: what is applied in each
 * harness (`applied`) is noted by carryOut alone, from what `write` and `remove` answer.
 */
export interface Hands<Content> extends Shelf<Content> {
  /** A copy `plan` saw present in a harness: its content, by hash, and when it was last changed (ms; absent: no time of its own). */
  copy(harness: HarnessId): { hash: string; at?: number; content: Content };
  /** Keeps each harness's own part as it is now (`own`), before anything is written or removed. */
  keepOwn(): Promise<void>;
  /** Tells History what is about to be done, before anything is saved (carryOut says why). */
  log(): Promise<void>;
  /** Writes the current version into one harness (its own part kept as written). True when the harness has it now. */
  write(harness: HarnessId): Promise<boolean>;
  /** Removes one harness's copy. True when it is gone. */
  remove(harness: HarnessId): Promise<boolean>;
}

/**
 * Carries out one item's plan in the model's order; the pass calls this for every item of every kind, and nothing else orders
 * these steps. The order holds for this item: a pass that carries out several saves the whole record each time (Shelf.save),
 * so another item's save can carry this one's click to disk before this item's History is told. The pass covers what that
 * leaves (librarypass.ts deletionsTold: a deleted item with no entry gets one).
 * - History first: an entry whose change never lands offers nothing (every action is worked out from the item as it is),
 *   while a change on record with no entry could leave a deleted item with no Restore.
 * - Version second: each content about to give way is kept, the edit taken in is made current, the item turns Off where a
 *   copy was deleted by hand, each harness's own part is kept, what each harness holds is noted, and the record is saved.
 * - Disk last: the writes, then the removals (a crash in between leaves the item in a harness too many, never too few). Each
 *   removal is saved at once: one not on record would read, after a crash, as a copy deleted by hand.
 */
export async function carryOut<Content>(item: LibraryItem, made: Plan, hands: Hands<Content>) {
  const versionOf = (harness: HarnessId, from: Source) => {
    const copy = hands.copy(harness);
    return [{ hash: copy.hash, at: versionAt(copy.at), from }, copy.content] as const;
  };
  await hands.log();
  for (const { harness, from } of made.keep) await keepVersion(hands, item, ...versionOf(harness, from));
  if (made.takeIn) await setCurrent(hands, item, ...versionOf(made.takeIn, { how: 'edited', harness: made.takeIn }));
  if (made.turnedOffBy) item.on = false;
  await hands.keepOwn();
  for (const harness of made.current) item.applied[harness] = item.hash;
  for (const harness of made.forget) delete item.applied[harness];
  await hands.save();
  for (const harness of made.write) if (await hands.write(harness)) item.applied[harness] = item.hash;
  for (const harness of made.remove) {
    if (!(await hands.remove(harness))) continue;
    delete item.applied[harness];
    await hands.save();
  }
}
