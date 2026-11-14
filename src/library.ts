// Central Knot's library: the model every kind of item follows. Pure: no files, no DOM. Skills (skills.ts), MCP servers
// (servers.ts) and agents (agents.ts) use it. A kind is carried by the pass in librarypass.ts, whose `Kind` is the contract a kind implements; this file is only the model.
//
// Central Knot holds each item itself, with its versions. A harness (Claude Code, Codex, …) is not where an item lives: it is
// somewhere an item is applied. Six ideas describe an item (what the pass adds about copies in harnesses is librarypass.ts's):
//
//   item     What Central Knot holds (LibraryItem): one current version, and On or Off. On: applied to every managed
//            harness. Off: in no harness; the item, its versions and each harness's own part stay in Central Knot.
//   harness  A tool Central Knot manages in this home: an installed tool whose Manage switch is on (presence.ts
//            managedTools). An item's `except` names the harnesses the person keeps it out of: the only thing stored per
//            harness that a person chose for one item.
//   apply    Putting the current version into a harness, or taking its copy out. `applied` remembers which version
//            Central Knot last put or saw in each harness.
//   version  One content the item has had, with when it was made and where it came from. Every version is kept while the
//            item is in Central Knot (a deleted skill's go after History's days: skillstore.ts pruneDeleted). After the
//            migrations from before the library, which build an item's versions at once, only keepVersion and setCurrent add one.
//   found    Something a managed harness has that the library doesn't. It is no item state: a click on Add takes it in, or
//            the home's standing rule, Synchronize everything (FOUND, below).
//   source   A place items are read from and never written: a Git link the person gave (sources.ts). What it holds comes in
//            Off and follows it by its own table (A SOURCE, below); an item linked to one says which (`source`, `seen`).
//
// Content has two parts for agents and MCP servers: the shared part, which a version's hash names (an agent's name,
// description and prompt), and each harness's own part (the other fields of its file). The library keeps the latest own
// part per harness (`own`: its file as a pass last saw or wrote it), so Off then On, or Turn on after a copy was deleted by
// hand, writes the same file back, byte for byte; an MCP entry comes back with the same values, name, place and own fields
// and lines (servers.ts), after the file's other servers. A skill's version is its whole folder.
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
//   either              a copy of its own, and it has the item     as Off there: Central Knot's copy (A) is removed, so the
//                       another way too                            item is never loaded twice (an edit in it taken in first);
//                                                                  a copy with no A is left alone, and its line says both ways
//
// One exception to "removed", an Undo's: where the click it undoes took a harness's own copy over, that copy is given back as
// the harness's own instead (no A), as before the click (librarypass.ts giveBackCopy, told by types.ts Change giveBack).
//
// "H changed" is an edit made in that harness: it flows back into Central Knot whether the item is On or Off there. Of two
// edits the latest wins: an edit made on the current version (L = A) always counts, one made where L had moved on as well
// only when it is later than L. A copy with no time of its own (`at` absent: an MCP entry, whose time is its whole file's)
// can't be ordered: such an edit counts only when made on the current version, and of several the first harness wins (as
// equal times do); one made where L had moved on as well loses to L and is kept as a version. Where no time decided, the plan
// says so (Plan orderProved), and History and the notice never call the edit taken in the latest. An edit that lost is kept as
// a version that was never current (Origin replacedBy). `plan` applies the table to every managed harness of one item at once
// and says what to keep, write and remove.
//
// "Held" has two reasons, both worked out at each look and never stored: it can't be given the item (a name it can't store, a
// folder it can't write), or it has the item another way (`anotherWay`, which only skills answer: through a plugin, OpenCode
// reading Claude Code's folder while the item is wanted there, a link, or a copy in ~/.agents/skills that Central Knot doesn't
// own; agents and MCP servers count a plugin that brings the item as a reason it can't be given it). Only the second lets A go,
// since Central Knot's copy is not what the harness has. The kind answers (librarypass.ts Disk.held, told where the item is
// wanted); tests/librarypass.test.ts has a reader on a toy kind. A harness can have the item another way and hold a copy of its
// own as well (a copy in ~/.agents/skills beside one in its own folder): that copy is `present` with `anotherWay` (the table's
// last row), and the harness is decided as one the item isn't wanted in (wantedHere).
//
// Other marks a harness's line can carry are a kind's own, worked out at each look from what it read and never stored, and
// they change nothing a pass does: for skills, a tool's own switch that turns the skill off there (skills.ts toolFacts, `loads`).
//
// A HARNESS THAT LEAVES (its Manage switch turned off: toolchoice.ts chooseTools; or uninstalled): Central Knot stops writing
// there, and nothing else changes. Its copies stay as they are, every item keeps its On or Off and its `applied` there, and only
// the harness's folder identity is let go (librarypass.ts forgetFolders), so its return is told apart. An item turned Off, or
// kept out of it, while it is away stays in that harness until the harness is back, and is removed there then (below: a copy
// as Central Knot left it). An edit made there meanwhile does not spread; a copy deleted there turns nothing Off.
//
// A HARNESS MANAGED AGAIN (its Manage switch turned on again, or uninstalled and back): the library wins there.
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
// holds whichever pass comes first. History says each content that gave way there, and each copy removed there (librarypass.ts
// cameBack and logItem); a harness managed for the first time is the table's "a copy, no A" row, told the same way.
//
// A SOURCE (sources.ts): a Git link the person gave, read on a click and never written. Each name read there, and each item
// linked to the source, meets the table in one step before the plan, all at once (`sourceAnswers`, a `fromSource` answer per
// name; librarypass.ts fromSourceStep carries them out, as it carries out Pull). S is the content at the source now; an item
// linked to the source holds which source (`source`) and the content last seen there (`seen`), and nothing else about it.
//
//   at the source                        the item                    what happens
//   a name the library has no item for   none                        the item is made, Off, its first version from the source
//   S = seen                             linked                      nothing
//   S changed                            current = seen              S becomes the current version; On or Off stays as it is
//   S changed                            current changed too         the later of the two is current, the other is kept as a
//                                                                    version
//   the name is gone, the source read    linked                      the item turns Off and its link is let go, so later reads
//     whole                                                          leave it as it is, turned back On or not, until the name
//                                                                    comes back unchanged (re-linked: "its current version this
//                                                                    same link's", below); then its going again turns it Off again
//   that skill can't be read, or the     linked                      nothing; the source's row says why
//     source wasn't read whole
//   a name the library has               not linked, same content    it is linked; nothing else changes
//   a name the library has               not linked, its current     linked again, and S becomes current: the link was removed
//                                        version this same link's,   and added again, or the name went and came back, and the
//                                        changed nothing since       item is as the link left it, On or Off
//   a name the library has               not linked and differs,     not brought in, said on the source's row; Add there
//                                        linked to another source,   brings a deleted one back, Off, as a new one comes
//                                        or deleted
//
// "Read whole": the source was fetched and holds at least one skill, and every skill there could be read (sources.ts readOf
// decides it, the one place). A source that holds no skill that can be read (its one skill deleted there, every skill
// unreadable, its folder gone, a plugin) is not read whole: no name is gone, and nothing turns Off.
//
// The step writes no harness: the plan after it applies the current version where the item is On, as for any new version, so
// an edit a harness holds that no pass has taken in yet meets S there (latest wins), and a dropped item's copies leave the
// harnesses as any Off item's do. Where that edit wins, S was kept, not made current: the table answered `update`, and the
// pass, once its plan is known, tells History and the click `keep` (librarypass.ts asTold, the second place that decides it).
// A source's time is its head commit's (`commitAt`: the copy is one commit deep): a later, unrelated commit there makes an
// older edit of the skill count as the latest. Within a second of the current version's time
// (the tie latestCopy uses) the current version stays and the source's is kept. Whether an item is linked is `linkedTo`'s
// alone: one linked to a source that is no longer recorded reads as not linked, so Remove lets go of every link at once.
//
// Two promises hold the model together:
// - H unseen is never H gone. A copy the adapter can't see for sure (unreadable, half saved, inside the settle window,
//   its folder away) is `unseen`, and nothing happens in that harness. Of what a harness holds, only a copy that is really
//   gone turns an item Off.
// - Version first, disk second. A content is stored and recorded as a version (keepVersion, setCurrent) before any harness
//   file is written over or removed. A crash in between leaves a version too many, never a content too few, and the next
//   pass finds H = A and finishes the write or the removal.
//
// Nothing else is stored. Whether a harness can't hold the item or has it another way is a `held` copy, worked out at each
// look with its reason and shown as that harness's mark. Whether its writes wait for a step of the person's own (Claude
// Code's MCP settings, until Write to Claude Code: librarypass.ts Disk.locked `waits`) is worked out at each look too, and
// changes no plan: the write or removal is left undone until that step, and A stays, so the next look still owes it. A library
// item never waits for a choice: the copy question exists only when a found item whose copies differ is taken in.
//
// Skills, agents and MCP servers are on it. A harness's own part (`own`) is kept by its text's hash: an agent's whole file, an
// MCP entry's own fields (a fragment of a settings file the harness shares with other things); a skill has none, its whole
// folder being shared. `key` compares names as macOS compares file names (itemKey), so two names in one harness that differ
// only by case can't be told apart: each kind makes both unseen.
//
// FOUND, AND WHAT TAKES IT IN. A key a managed harness has, with no live item for it in the library (none, or a tombstone), is
// found. Two things take it in, each as an Add does (On everywhere, from one copy; librarypass.ts takeIn): a click on its Add,
// and the home's standing rule, Synchronize everything (share.ts SyncRecord syncEverything), in the background pass and Sync
// once (librarypass.ts PassOptions background). `takeInAnswer` is this table: each column reads down to its first answer
// ("on": the next row decides).
//
//   what the key has                                 a click on Add                       Synchronize everything
//   no copy that can be read                         refused: no copy to take in          left found, quietly
//   a deleted item's copy still to leave a harness   no Add: History can restore it       left found
//     at a step of the person's own (Write to Claude Code)
//   the record holds it deleted                      on: its tombstone is lifted          left found, for good
//   a copy that is a plugin's part                   on                                   left found: its row keeps Add
//   a skill Convert to skill made from an agent      on                                   left found: its row keeps Add
//   every copy switched off by its tool's own switch on                                   left found: its row keeps Add
//   a copy whose own time is inside the settle       on                                   left for the next pass
//     window of the pass's clock
//   a copy chosen that is gone or changed since      refused: choose again                (the rule chooses none)
//   copies that differ, none chosen                  waits: the row asks which, the       left found, with the row's question
//                                                    latest preselected (latestCopy)      (first setup walks through these)
//   otherwise                                        taken in from the one content, or the copy chosen
//
// Not found at all, so in neither column: a copy of an item that is Off, or in a harness the item is kept out of (the table
// above: "a found copy, left alone"); a copy a harness has that can't be read (unseen); a copy in a harness not managed. A copy
// a harness has another way (a skill's link or ~/.agents/skills copy) is one it can be taken in from; that place is not
// written (Take over stays a click). Nothing about found copies is stored: the rule takes in what is found at each pass, so
// switching it on takes in everything found then. The page reads the same answers (each kind's view, through lookFor), with
// the settle window passed.
//
// Worked examples, one per row of each table: tests/library.test.ts. The same on real files: tests/agents.test.ts,
// tests/skills.test.ts, tests/servers.test.ts and, for A SOURCE, tests/sources.test.ts.
import { linkLabel } from './sourcelink.ts';
import type { HarnessId } from './types.ts';
import { toolName } from './words.ts';

/** Every kind of item on the library. A new kind adds its name here first (librarypass.ts's header has the rest of the recipe). */
export type ItemKind = 'skill' | 'agent' | 'mcp';

/**
 * Where a version came from: taken in from a harness that had it (`found`, or `chosen` among copies that differed), edited
 * by hand in a harness (`edited`), a harness's copy that gave way to the current version (`was-in`), Pull (`pulled`), read
 * at a source (`source`, with its `link` as given), an earlier version made current (`made-current`), or the record from
 * before the library (`migrated`). `replacedBy`: on a version that was never current, the version that took its place, which
 * its line on the page is compared with (noteAgainst): a `was-in` copy, an edit that lost to another (plan), or a source's
 * content an edit made here beat (librarypass.ts asTold). Absent in older records, where an edit that lost reads as current once.
 */
export interface Origin { how: 'found' | 'chosen' | 'edited' | 'was-in' | 'pulled' | 'source' | 'made-current' | 'migrated'; harness?: HarnessId; replacedBy?: string; link?: string }

/**
 * One content an item has had. `at`: when it was made (a harness file's own time for a copy taken in; a source's head commit's
 * for one read there; else the click's), shown beside it.
 */
export interface Version { hash: string; at: string; from: Origin }

/**
 * A listed version's note, against what noteAgainst says, as each kind compares the contents (agents.ts changesOf) and its row
 * says it (libraryrow.ts versionChange): `changed`, the parts of it that differ from the version current before it; `differs`,
 * for a version that was never current, the parts that differ from the version that took its place. Each part by the kind's
 * word for it ("prompt"). `first`: the first version, taken alone. `none`: nothing to note (the copy chosen among several: its
 * words say so). `unknown`: a content no longer kept.
 */
export type VersionChange = { changed: string[] } | { differs: string[] } | 'first' | 'none' | 'unknown';

/** One item as Central Knot holds it. The same shape for every kind. */
export interface LibraryItem {
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
  /** The source it is linked to (sources.ts SourceRecord `id`): linked only while that source is recorded (the header's A SOURCE). */
  source?: string;
  /** The content last seen at that source, which the next read compares with. Set and let go with `source`. */
  seen?: string;
}

/** An item's key, from its name as a harness writes it: one key across harnesses, compared as macOS compares file names (LibraryItem key). */
export const itemKey = (name: string) => name.normalize('NFC').toLowerCase();

export const newItem = (key: string, name: string): LibraryItem =>
  ({ key, name, on: false, hash: '', versions: [], except: [], applied: {}, own: {} });

/** Whether a record's value has an item's shape (a record is read from disk, so nothing about it is taken on trust). */
export function isLibraryItem(value: unknown): value is LibraryItem {
  const item = value as Partial<LibraryItem> | null;
  const text = (entry: unknown) => typeof entry === 'string';
  const texts = (map: unknown) => !!map && typeof map === 'object' && !Array.isArray(map) && Object.values(map).every(text);
  const version = (entry: Partial<Version> | null) => text(entry?.hash) && text(entry?.at) && text(entry?.from?.how);
  return !!item && typeof item === 'object' && text(item.key) && text(item.name) && typeof item.on === 'boolean' && text(item.hash)
    && Array.isArray(item.versions) && item.versions.every(version) && Array.isArray(item.except) && texts(item.applied) && texts(item.own)
    && (item.deleted === undefined || text(item.deleted?.at)) && (item.source === undefined || text(item.source)) && (item.seen === undefined || text(item.seen));
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

/**
 * Whether a version was never the item's current version: a copy that gave way (`was-in`), or one the version that took its
 * place beat (`replacedBy`). The one place this is decided.
 */
export const neverCurrent = (from: Origin) => from.how === 'was-in' || from.replacedBy !== undefined;

/**
 * What a listed version's note (VersionChange) compares it with, for every kind (each kind's changesOf compares the contents):
 * a version that was never current, the version that took its place (`differs`); any other, the version current before it
 * (`changed`), passing over versions that were never current. With none, it is the first version, unless copies were taken in
 * with it (`none`: the copy chosen, or Pull's over copies found here, each of which a `was-in` names).
 */
export function noteAgainst(item: Pick<LibraryItem, 'versions'>, version: Version): { how: 'changed' | 'differs'; against: string } | 'first' | 'none' {
  if (version.from.replacedBy) return { how: 'differs', against: version.from.replacedBy };
  const before = item.versions.slice(item.versions.indexOf(version) + 1).find(older => !neverCurrent(older.from));
  if (before) return { how: 'changed', against: before.hash };
  const takenWith = version.from.how === 'chosen' || item.versions.some(other => other.from.how === 'was-in' && other.from.replacedBy === version.hash);
  return takenWith ? 'none' : 'first';
}

/** Whether the item should be in this harness: On, not deleted, and not kept out of it. */
export const wantedIn = (item: Pick<LibraryItem, 'on' | 'deleted' | 'except'>, harness: HarnessId) =>
  item.on && !item.deleted && !item.except.includes(harness);

/** A version in words: "edited in Codex", "was in Copilot CLI", "from github.com/owner/repo", "made current again". */
export function originWords({ how, harness, link }: Origin): string {
  const where = harness ? toolName(harness) : 'a harness';
  return { found: `found in ${where}`, chosen: `chosen from ${where}`, edited: `edited in ${where}`, 'was-in': `was in ${where}`,
    pulled: 'pulled from the Git repo', source: `from ${link ? linkLabel(link) : 'a source'}`, 'made-current': 'made current again', migrated: 'from before Central Knot kept versions' }[how];
}
/** A version named in a sentence: "the version edited in Codex", "the version that was in Copilot CLI". */
export const theVersion = (from: Origin) => `the version ${from.how === 'was-in' ? 'that ' : ''}${originWords(from)}`;

// ---------- The rule ----------

/**
 * H: what a harness holds of an item now. `at`: when its copy was last changed (ms); absent for a copy with no time of its
 * own (an MCP entry, whose time is its whole file's), which "latest" can't order (latestEdit). Nothing of Central Knot's
 * happens in a harness whose copy is `unseen` (it can't be seen for sure) or `held` (it can't be given the item; with
 * `anotherWay`, it has the item another way: the header says which is which), and `why` says it on the page.
 */
export type HarnessCopy = { is: 'present'; hash: string; at?: number; anotherWay?: string } | { is: 'absent' } | { is: 'unseen'; why: string }
  | { is: 'held'; why: string; anotherWay?: true };

/**
 * Whether the item should be in this harness's own folder: wanted there (wantedIn), and the harness doesn't have it another
 * way as well as its own copy (`anotherWay` on a present copy: the table's last row), where its own copy is one too many.
 */
export const wantedHere = (wanted: boolean, copy: HarnessCopy) => wanted && !(copy.is === 'present' && copy.anotherWay);

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
  if (!wantedHere(wanted, copy)) {
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
  /**
   * Whether times prove the edit taken in came after every other edit beside it (latestEdit). False where they can't: two edits'
   * times are equal or missing, so the harnesses' order decided, or an edit with no time lost to the rule beside it. True where
   * no edit is taken in.
   */
  orderProved: boolean;
  /** The item turns Off: the harness where its copy was deleted by hand. */
  turnedOffBy?: HarnessId;
  /** Copies to keep as versions before they are written over or removed, each with where it came from. */
  keep: { harness: HarnessId; from: Origin }[];
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
  const { takeIn, orderProved } = latestEdit(item, copies, new Map(harnesses.map(harness => [harness, verdict(item, harness)])));
  const turnedOffBy = harnesses.find(harness => verdict(item, harness) === 'turn-off');
  const taken = takeIn ? (copies[takeIn] as { hash: string }).hash : item.hash;
  const after: LibraryItem = { ...item, on: item.on && !turnedOffBy, hash: taken };
  const made: Plan = { takeIn, orderProved, turnedOffBy, keep: [], write: [], remove: [], forget: [], current: [], found: [] };
  const known = new Set(item.versions.map(version => version.hash));
  for (const harness of harnesses) {
    const copy = copies[harness]!, does = verdict(after, harness), wanted = wantedHere(wantedIn(after, harness), copy);
    const lost = does === 'take-in' || does === 'latest-wins';
    // A copy about to be written over or removed is kept first, unless the library has that content already. Either way it
    // was never current: the version taken in, or the current one, took its place.
    if (copy.is === 'present' && !known.has(copy.hash) && (lost || does === 'keep-then-write')) {
      made.keep.push({ harness, from: { how: does === 'keep-then-write' ? 'was-in' : 'edited', harness, replacedBy: taken } });
      known.add(copy.hash);
    }
    if (does === 'write' || does === 'keep-then-write' || (lost && wanted)) made.write.push(harness);
    else if (does === 'remove' || lost) made.remove.push(harness);
    else if (does === 'forget' || does === 'found') made[does].push(harness);
    else if (does === 'nothing' && copy.is === 'present' && copy.hash === after.hash && wanted) made.current.push(harness);
  }
  return made;
}

/** The harnesses whose copy holds an edit no pass has taken in yet, by a plan: the one it takes in, and those it keeps as versions. */
export const pendingEdits = (made: Plan): HarnessId[] => [...(made.takeIn ? [made.takeIn] : []), ...made.keep.filter(kept => kept.from.how === 'edited').map(kept => kept.harness)];
/** The harnesses whose copy holds a change no pass has taken in yet: an edit (pendingEdits), or the copy deleted by hand that turns the item Off. */
export const pendingChanges = (made: Plan): HarnessId[] => [...pendingEdits(made), ...(made.turnedOffBy ? [made.turnedOffBy] : [])];

/**
 * The edit that becomes the current version (`takeIn`), among the harnesses whose copy is one (`verdicts`): the latest. An edit
 * made on the current version (`take-in`) always counts; one made where the current version had moved on as well (`latest-wins`)
 * only when it is later than the current version. A copy with no time of its own is later than nothing: of several edits
 * that count, the first harness wins where none has a time (the sort keeps the harnesses' order), as where two times are equal.
 * `orderProved` says which decided (Plan orderProved), here where it is decided: a time, only where the next edit that counts
 * is earlier by its time and every edit that lost to the rule had a time (so it was earlier than the current version).
 */
function latestEdit(item: LibraryItem, copies: Copies, verdicts: Map<HarnessId, Verdict>): Pick<Plan, 'takeIn' | 'orderProved'> {
  const timeOf = (harness: HarnessId) => (copies[harness] as { at?: number }).at, at = (harness: HarnessId) => timeOf(harness) ?? -Infinity;
  const currentSince = Date.parse(item.versions[currentIndex(item)]?.at ?? '') || 0;
  const edits = [...verdicts].filter(([, does]) => does === 'take-in' || does === 'latest-wins');
  const counts = (harness: HarnessId, does: Verdict) => does === 'take-in' || at(harness) > currentSince;
  // Two copies with no time compare as NaN, which a sort takes as equal: they stay in the harnesses' order.
  const [takeIn, next] = edits.filter(([harness, does]) => counts(harness, does)).map(([harness]) => harness).sort((first, second) => at(second) - at(first));
  const lostUntimed = edits.some(([harness, does]) => !counts(harness, does) && timeOf(harness) === undefined);
  const beforeIt = !next || (timeOf(next) !== undefined && at(takeIn) > at(next));
  return { takeIn, orderProved: !takeIn || (beforeIt && !lostUntimed) };
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

// ---------- A source ----------

/** What a source holds of one name now: its content and the source's head commit's time, gone (the source read whole), or unreadable. */
export type AtSource = { hash: string; commitAt: string } | 'gone' | 'unreadable';
/**
 * Whom an item is linked to, as one source sees it: that source (`this`), another one still recorded (`another`), none; or
 * none now, but its current version is one this same link gave and nothing has changed it since (`once`: the link was
 * removed and added again).
 */
export type LinkedTo = 'this' | 'another' | 'once' | 'none';
/** The source an item is linked to, among those the home records now (`recorded`, by id); none for one no longer recorded. */
export const linkedSource = (item: Pick<LibraryItem, 'source'> | undefined, recorded: ReadonlySet<string>) =>
  (item?.source && recorded.has(item.source) ? item.source : undefined);
/** The one reader of whom an item is linked to (LinkedTo), as the source `id`, read from `link`, sees it. */
export function linkedTo(item: LibraryItem | undefined, { id, link }: { id: string; link: string }, recorded: ReadonlySet<string>): LinkedTo {
  const at = linkedSource(item, recorded);
  if (at) return at === id ? 'this' : 'another';
  const current = item?.versions[currentIndex(item)];
  return current?.from.how === 'source' && current.from.link === link ? 'once' : 'none';
}
/**
 * The header's A SOURCE table's answer for one name, a row each: the item is made (`make`: Off; a deleted one brought back by
 * Add, `bringBack`), linked (`link`), S becomes current (`update`; already current, only `seen` moves on), S is kept as a version
 * (`keep`), the item turns Off and is let go (`drop`), or `nothing`. A name the library has that is not brought in says why:
 * its content differs (`differs`), it is another source's (`another`), or it is deleted (`deleted`).
 */
export type SourceAnswer = 'make' | 'link' | 'update' | 'keep' | 'drop' | 'nothing' | 'differs' | 'another' | 'deleted';

/** The header's A SOURCE table for one name: `item` is the library's for its key (deleted or not), `here` what the source holds. */
export function fromSource(item: LibraryItem | undefined, here: AtSource, linked: LinkedTo, bringBack = false): SourceAnswer {
  if (here === 'unreadable') return 'nothing';
  if (here === 'gone') return item && !item.deleted && linked === 'this' ? 'drop' : 'nothing';
  if (!item) return 'make';
  if (item.deleted) return bringBack ? 'make' : 'deleted';
  if (linked === 'another') return 'another';
  if (linked === 'none') return here.hash === item.hash ? 'link' : 'differs';
  if (linked === 'once') return here.hash === item.hash ? 'link' : 'update';
  if (here.hash === item.seen) return 'nothing';
  if (item.hash === item.seen || here.hash === item.hash) return 'update';
  // Both changed: the later wins, the source's time being its head commit's; a tie keeps the current version.
  const current = Date.parse(item.versions[currentIndex(item)]?.at ?? '') || 0;
  return Date.parse(here.commitAt) - current >= TIE_MS ? 'update' : 'keep';
}

/**
 * One read of a source as its table reads it (sources.ts readOf makes it, the one place that decides what was read): the
 * source, its head commit's time, each name there by key with its content's hash or why it can't be read, and whether it was
 * read whole (the header).
 */
export interface SourceSeen { id: string; link: string; commitAt: string; whole: boolean; names: Map<string, { hash: string } | { unreadable: string }> }

/**
 * The table for one read, all at once: an answer for each name it holds and each item linked to the source (`items`: the
 * library's, deleted ones too), by key. `recorded`: the sources the home records now. `bringBack`: keys held deleted that a
 * click on Add on the source's row brings back. The pass carries these out (librarypass.ts fromSourceStep), and the Sources
 * page says them (sources.ts sourcesView); their keys are the pass's scope.
 */
export function sourceAnswers(items: Record<string, LibraryItem>, read: SourceSeen, recorded: ReadonlySet<string>, bringBack?: ReadonlySet<string>): Map<string, SourceAnswer> {
  const linked = Object.values(items).filter(item => linkedTo(item, read, recorded) === 'this').map(item => item.key);
  return new Map([...new Set([...read.names.keys(), ...linked])].map(key => {
    const entry = read.names.get(key);
    const here: AtSource = !entry ? (read.whole ? 'gone' : 'unreadable') : 'hash' in entry ? { hash: entry.hash, commitAt: read.commitAt } : 'unreadable';
    return [key, fromSource(items[key], here, linkedTo(items[key], read, recorded), bringBack?.has(key))];
  }));
}

// ---------- Found ----------

/** One copy a found key has in a managed harness, as the take-in table reads it. */
export interface FoundCopy {
  harness: HarnessId; hash: string;
  /** When it was last changed (ms); absent where a copy has no time of its own (an MCP entry). */
  at?: number;
  /** A plugin's part (parts.ts): the plugin put it in that harness. */
  part?: true;
  /** That harness's own switch turns it off there (skillswitch.ts, mcpswitch.ts). */
  off?: true;
}
/** What the take-in table is told of a found key. */
export interface FoundKey {
  /** Its copies that can be read for sure, in the harnesses' order (librarypass.ts foundCopies). */
  copies: FoundCopy[];
  /** The record holds it deleted (a tombstone). */
  deleted: boolean;
  /** Convert to skill made it from an agent (agentskill.ts): spread, it would reach the tools that hold the agent. */
  converted: boolean;
  /** A deleted item's copy still waits to leave a harness, at a step of the person's own (Write to Claude Code). */
  leaving: boolean;
}
/** Who asks to take a found key in: a click on its Add, or Synchronize everything. */
export type TakenBy = 'click' | 'rule';
/** Why a found key is left found (the header's FOUND table, one per row). */
export type LeftFound = 'no-copy' | 'leaving' | 'deleted' | 'part' | 'converted' | 'switched-off' | 'settling' | 'choice-changed';
/**
 * The table's answer: take it in from this copy (`chosen`: the person chose it among copies that differ), wait for a choice of
 * copy (`latest`: the content changed last, which the question preselects: latestCopy), or leave it found.
 */
export type TakeInAnswer = { take: FoundCopy; chosen: boolean } | { wait: 'choice'; latest?: string } | { leave: LeftFound };

/**
 * The header's FOUND table, for one found key. `chosen`: the copy a click chose where copies differ, as the page saw it.
 * `settle`: the pass's clock and its settle window; the page's look has none (the window counts as passed).
 */
export function takeInAnswer(by: TakenBy, found: FoundKey, chosen?: { harness: HarnessId; hash?: string }, settle?: { clock: number; ms: number }): TakeInAnswer {
  const rule = by === 'rule', { copies } = found;
  if (!copies.length) return { leave: 'no-copy' };
  if (found.leaving) return { leave: 'leaving' };
  if (rule && found.deleted) return { leave: 'deleted' };
  if (rule && copies.some(copy => copy.part)) return { leave: 'part' };
  if (rule && found.converted) return { leave: 'converted' };
  if (rule && copies.every(copy => copy.off)) return { leave: 'switched-off' };
  if (rule && settle && copies.some(copy => copy.at !== undefined && Math.abs(settle.clock - copy.at) < settle.ms)) return { leave: 'settling' };
  const pick = chosen && copies.find(copy => copy.harness === chosen.harness);
  if (!rule && chosen && (!pick || (chosen.hash !== undefined && pick.hash !== chosen.hash))) return { leave: 'choice-changed' };
  const differ = new Set(copies.map(copy => copy.hash)).size > 1;
  if (differ && !pick) { const latest = latestCopy(copies); return { wait: 'choice', ...(latest ? { latest } : {}) }; }
  return { take: pick ?? copies[0], chosen: differ };
}

/**
 * Of a found key's copies that differ, the content changed last (its hash), which the copy question preselects (its main
 * button) and first setup's "Use the latest for the rest" takes; none where it can't be told. A content was made when its
 * earliest copy was changed, so a copy that only carries it (written later) doesn't make it newer. None when a copy has no
 * time of its own (an MCP entry, whose time is its whole file's: "no dates to go by"), or the last two contents were changed
 * less than a second apart (a tie: some file systems, and copies made by unpacking or copying, keep a file's time only to
 * the second).
 * Known weakness: a copy Central Knot wrote carries the time of that write, not of the edit it holds; one written into a tool
 * that was behind, alone with its content, reads as changed then.
 * Not `plan`'s "latest wins", which is for an item already in the library: there two edits made in harnesses are ordered by
 * their times, a copy with no time counts as earlier than any, and a tie goes to the first harness (latestEdit); here a tie,
 * or a copy with no time, is no latest, and the person chooses.
 */
export function latestCopy(copies: readonly Pick<FoundCopy, 'hash' | 'at'>[]): string | undefined {
  const made = new Map<string, number>();
  for (const { hash, at } of copies) {
    if (at === undefined) return undefined;
    made.set(hash, Math.min(made.get(hash) ?? Infinity, at));
  }
  const [last, before] = [...made].sort(([, first], [, second]) => second - first);
  return last && before && last[1] - before[1] >= TIE_MS ? last[0] : undefined;
}
/** Two contents changed less than this apart are a tie for latestCopy (no latest) and for a source's version (fromSource: the current one stays). */
const TIE_MS = 1000;

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
  /**
   * Removes one harness's copy. True when it is gone; or, for an Undo that gives the harness its own copy back instead
   * (librarypass.ts giveBackCopy), true when that copy is there.
   */
  remove(harness: HarnessId): Promise<boolean>;
}

/**
 * Carries out one item's plan in the model's order; the pass calls this for every item of every kind, and nothing else orders
 * these steps. Answers the harnesses whose write or removal was held (left undone this time: the next pass tries again), so
 * the pass can take them out of what History was told first (librarypass.ts untell). The order holds for this item: a pass that carries out several saves the whole record each time (Shelf.save),
 * so another item's save can carry this one's click to disk before this item's History is told. The pass covers what that
 * leaves (librarypass.ts deletionsTold: a deleted item with no entry gets one).
 * - History first: an entry whose change never lands offers nothing (every action is worked out from the item as it is),
 *   while a change on record with no entry could leave a deleted item with no Restore.
 * - Version second: each content about to give way is kept, the edit taken in is made current, the item turns Off where a
 *   copy was deleted by hand, each harness's own part is kept, what each harness holds is noted, and the record is saved.
 * - Disk last: the writes, then the removals (a crash in between leaves the item in a harness too many, never too few). Each
 *   removal is saved at once: one not on record would read, after a crash, as a copy deleted by hand.
 */
export async function carryOut<Content>(item: LibraryItem, made: Plan, hands: Hands<Content>): Promise<HarnessId[]> {
  const versionOf = (harness: HarnessId, from: Origin) => {
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
  const held: HarnessId[] = [];
  for (const harness of made.write) if (await hands.write(harness)) item.applied[harness] = item.hash; else held.push(harness);
  for (const harness of made.remove) {
    if (!(await hands.remove(harness))) { held.push(harness); continue; }
    delete item.applied[harness];
    await hands.save();
  }
  return held;
}
