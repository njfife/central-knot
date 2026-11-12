// Central Knot's library: the model every kind of item follows. Pure: no files, no DOM. Agents use it today (agents.ts);
// skills and MCP servers still follow their own engines until they are moved onto it.
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
// part per harness (`own`), so Off then On writes the same file back, byte for byte. A skill's version is its whole folder.
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
//   Off, or excepted    H = A                                      removed
//   Off, or excepted    H changed                                  kept as a version, then removed
//   Off, or excepted    a copy, no A                               a found copy: left alone
//
// `plan` applies the table to every managed harness of one item at once and says what to keep, write and remove.
//
// Two promises hold the model together:
// - H unknown is never H gone. A copy the adapter can't see for sure (unreadable, half saved, inside the settle window,
//   its folder away) is `unknown`, and nothing happens in that harness. Only a copy that is really gone turns an item Off.
// - Version first, disk second. A content is stored and recorded as a version (keepVersion, setCurrent) before any harness
//   file is written over or removed. A crash in between leaves a version too many, never a content too few, and the next
//   pass finds H = A and finishes the write or the removal.
//
// Nothing else is stored. Whether a harness is waiting, can't hold the item or has it another way is worked out at each
// pass and shown as that harness's mark. A library item never waits for a choice: the copy question exists only when a
// found item whose copies differ is taken in.
import type { HarnessId } from './types.ts';
import { toolName } from './words.ts';

export type ItemKind = 'skill' | 'agent' | 'mcp';

/**
 * Where a version came from: taken in from a harness that had it (`found`, or `chosen` among copies that differed), edited
 * by hand in a harness (`edited`), a harness's copy that gave way to the current version (`was-in`), Pull (`pulled`), an
 * earlier version made current (`made-current`), or the record from before the library (`migrated`).
 */
export interface Source { how: 'found' | 'chosen' | 'edited' | 'was-in' | 'pulled' | 'made-current' | 'migrated'; harness?: HarnessId }

/** One content an item has had. `at`: when it was made (a harness file's own time for a copy taken in; else the click's). */
export interface Version { hash: string; at: string; from: Source }

/** One item as Central Knot holds it. The same shape for every kind. */
export interface LibraryItem {
  kind: ItemKind;
  /** Its name as one key across harnesses (lower case, as macOS compares file names). */
  key: string;
  /** Its name as written, which its files in the harnesses take. */
  name: string;
  /** The only item state: On (applied to every managed harness but `except`) or Off (in none). */
  on: boolean;
  /** The current version: the content On applies. */
  hash: string;
  /** Every content it has had, newest first. */
  versions: Version[];
  /** The harnesses the person keeps it out of. */
  except: HarnessId[];
  /** A: the version Central Knot last put or saw in each harness. No entry: nothing applied there. */
  applied: Partial<Record<HarnessId, string>>;
  /** Each harness's own part as last seen, by the name the kind's store keeps it under. Stays after Off, for the next On. */
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

/** H: what a harness holds of an item now. `at`: when its file was last changed (ms). `unknown`: it can't be seen for sure. */
export type HarnessCopy = { is: 'present'; hash: string; at: number } | { is: 'absent' } | { is: 'unknown' };

/** The table's results, one per row, and two with nothing left to do: `forget` (a removal that is already done). */
export type Verdict = 'nothing' | 'write' | 'take-in' | 'latest-wins' | 'keep-then-write' | 'turn-off'
  | 'remove' | 'keep-then-remove' | 'found' | 'forget';

/**
 * The rule for one harness (the table above). `wanted`: the item is On and this harness is not excepted (wantedIn).
 * `current` is L, `copy` is H, `applied` is A.
 */
export function decide(wanted: boolean, current: string, copy: HarnessCopy, applied: string | undefined): Verdict {
  if (copy.is === 'unknown') return 'nothing';
  if (!wanted) {
    if (copy.is === 'absent') return applied === undefined ? 'nothing' : 'forget';
    if (applied === undefined) return 'found';
    return copy.hash === applied ? 'remove' : 'keep-then-remove';
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
 * Two things concern the whole item, so they are settled first: which changed copy becomes the current version (the latest
 * one; with equal times, the first harness), and whether a copy deleted by hand turns the item Off. Then each harness
 * follows the table against the item as it will be.
 */
export function plan(item: LibraryItem, copies: Copies): Plan {
  const harnesses = Object.keys(copies) as HarnessId[];
  const verdict = (state: LibraryItem, harness: HarnessId) => decide(wantedIn(state, harness), state.hash, copies[harness]!, state.applied[harness]);
  const takeIn = latestEdit(item, copies, harnesses.filter(harness => ['take-in', 'latest-wins'].includes(verdict(item, harness))));
  const turnedOffBy = harnesses.find(harness => verdict(item, harness) === 'turn-off');
  const taken = takeIn ? (copies[takeIn] as { hash: string }).hash : item.hash;
  const applied = takeIn ? { ...item.applied, [takeIn]: taken } : item.applied;
  const after: LibraryItem = { ...item, on: item.on && !turnedOffBy, hash: taken, applied };
  const made: Plan = { takeIn, turnedOffBy, keep: [], write: [], remove: [], forget: [], current: [], found: [] };
  const known = new Set([taken, ...item.versions.map(version => version.hash)]);
  for (const harness of harnesses) {
    const copy = copies[harness]!, does = verdict(after, harness);
    // A copy about to be written over or removed is kept first, unless the library has that content already.
    const lost = does === 'take-in' || does === 'latest-wins';
    if (copy.is === 'present' && !known.has(copy.hash) && (lost || does === 'keep-then-write' || does === 'keep-then-remove')) {
      made.keep.push({ harness, from: { how: does === 'keep-then-write' ? 'was-in' : 'edited', harness } });
      known.add(copy.hash);
    }
    if (does === 'write' || does === 'keep-then-write' || lost) made.write.push(harness);
    else if (does === 'remove' || does === 'keep-then-remove') made.remove.push(harness);
    else if (does === 'forget' || does === 'found') made[does].push(harness);
    else if (does === 'nothing' && copy.is === 'present' && copy.hash === after.hash && wantedIn(after, harness)) made.current.push(harness);
  }
  return made;
}

/**
 * Among the harnesses whose copy was edited, the one whose copy becomes the current version: the latest edit. A copy edited
 * where the current version had moved on as well (both changed) only counts when it is later than the current version.
 */
function latestEdit(item: LibraryItem, copies: Copies, edited: HarnessId[]): HarnessId | undefined {
  const at = (harness: HarnessId) => (copies[harness] as { at: number }).at;
  const currentSince = Date.parse(item.versions[currentIndex(item)]?.at ?? '') || 0;
  const candidates = edited.filter(harness => item.applied[harness] === item.hash || at(harness) > currentSince);
  return candidates.sort((first, second) => at(second) - at(first))[0];
}

// ---------- Versions ----------

/** Where a kind keeps its items: the adapter's store for one content, and its record's save. */
export interface Shelf<Content> {
  /** Stores a content under the item, by its hash. Storing the same content again changes nothing. */
  store(item: LibraryItem, hash: string, content: Content): Promise<void>;
  /** Saves the record that holds the item. */
  save(): Promise<void>;
}

/** The versions with one more, newest first (by when each was made; the new one first among equals). */
const withVersion = (item: LibraryItem, version: Version) =>
  [version, ...item.versions].sort((first, second) => Date.parse(second.at) - Date.parse(first.at));

/**
 * Keeps a content as a version of the item without making it current (a copy that gave way). Stored, recorded and saved
 * before it returns, so the caller may then write over or remove the file it came from. A content the item has already is
 * stored again (harmless) and not listed twice.
 */
export async function keepVersion<Content>(shelf: Shelf<Content>, item: LibraryItem, version: Version, content: Content): Promise<void> {
  await shelf.store(item, version.hash, content);
  if (!item.versions.some(known => known.hash === version.hash)) item.versions = withVersion(item, version);
  await shelf.save();
}

/**
 * The one way an item's current version changes: an edit taken in, a found copy taken in, Pull, or an earlier version made
 * current. The content is stored, the version recorded and the record saved before it returns: only then may any harness
 * be written or removed. Always a new entry in `versions`, so the list says when each content was current.
 */
export async function setCurrent<Content>(shelf: Shelf<Content>, item: LibraryItem, version: Version, content: Content): Promise<void> {
  await shelf.store(item, version.hash, content);
  item.versions = withVersion(item, version);
  item.hash = version.hash;
  await shelf.save();
}
