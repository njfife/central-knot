// Skills on Central Knot's library: the adapter for one kind. Read library.ts first (the model, and the one rule for an item
// in the library), then librarypass.ts (the pass, the same for every kind, and `Kind`, the contract a kind implements).
// This module is the skills' Kind (skillKind; its Merge of a source's version is merge.ts mergeSkill) and nothing the pass does itself:
// - what a tool holds of a skill (readDisk): its own copy, a folder in its own skills folder (skillfiles.ts), which is
//   Central Knot's to write and remove; and the ways it has a skill that are not Central Knot's (anotherWay): a link in its
//   folder, a copy in a folder it reads but Central Knot doesn't own (~/.agents/skills), another tool's folder it reads
//   (OpenCode reads Claude Code's) while the skill is really there, or a plugin; and for a tool that had it only through the
//   shared folder, whether that copy, or its link to it, went, or the folder can't be vouched for (lostShared, sharedListing:
//   library.ts THE SHARED FOLDER);
// - why a tool can't be given a skill (cannotTake): a name it reserves, or a shape it won't load (share.ts targetFor);
// - a tool's own switch for a skill (toolFacts, `loads`): read at each look (offIn: off where it keeps out every copy the tool
//   loads). A switch set in a tool, by a person or by Central Knot before the library, is left as it is and shown as a mark on
//   that tool's line. It is written by clearSwitch, its Undo switchBack, and takeOver, which carries it to the copy it makes
//   (takeOver is also the one that makes a copy outside Central Knot's its own); by the profiles migration, which releases one an
//   earlier profile set, once (profilemigrate.ts); and by a pass, which keeps Pi's inclusion of Central Knot's copy in step with
//   the copy (skillKind.follow: skillswitch.ts followCopy).
// Around the pass: applySkills and restoreSkill run it for skills (the page's clicks);
// skillsView is the Library's reading of skills (types.ts LibraryView); skillsForRepo is what the Git repo's Push sends. Elsewhere: the folders, skillfiles.ts; where things
// are kept and the migration from the earlier record, skillstore.ts and skillmigrate.ts; the row and its words,
// libraryrow.ts with librarypages.ts; History's sentences and actions, historyactions.ts.
import { randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, realpath, stat, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { inside, pathIn, pluginSkills } from './catalogdetail.ts';
import { appendHistory, readHistory, replaceHistory } from './history.ts';
import { isClearedSwitch, libraryAction, libraryEntry } from './historyactions.ts';
import { keepVersion, listed, noteAgainst, pendingEdits, plan, wantedIn } from './library.ts';
import type { LibraryItem, Version, VersionChange } from './library.ts';
import { copiesOf, foundCopies, lookFor, restore, runPass, takeInAnswers, unreadIn, unseenIn, type Disk, type Kind, type Look, type PassOptions, type Wanted } from './librarypass.ts';
import { libraryWords } from './libraryrow.ts';
import type { PluginCopy } from './marketplaces.ts';
import { comparableText } from './pluginstatus.ts';
import { installedPlugins, pluginHolds, SAFE_NAME, throughPlugins, type GivenByPlugin, type PluginContext, type PluginHold } from './plugins.ts';
import { takesPlugins } from './presence.ts';
import { destinationReloads } from './reload.ts';
import { errorCode, itemKey, landingOf, libraryGate, notCopied, plainError, readTree, shownText, syncGate, targetFor, writeAccess, type ShareContext, type Tree } from './share.ts';
import { alsoReads, folderTime, lockedRoot, placeFolder, readCopy, readShape, readSkillsFolder, recoverFolders, removeFolder,
  rootOf, rootProblem, sharedFolder, swapFolder, type FolderReads, type SkillCopy } from './skillfiles.ts';
import { openLibrary, readVersion, recordedSkills, saveLibrary, storeVersion, type SkillContent } from './skillstore.ts';
import { mergeSkill } from './merge.ts';
import { pluginLink } from './sourcelink.ts';
import { sourceFacts } from './sources.ts';
import { pluginsRecordHold } from './sourcestore.ts';
import { followCopy, isDisabled, piListWords, readKeptOverrides, readSwitchFile, setDisabled, switchFailure, type ListEdit, type SwitchFile } from './skillswitch.ts';
import { agentInPi, agentKind, applyAgents } from './agents.ts';
import { harnesses, isSkillEntry, toolConfigRoot } from './harnesses.ts';
import { displayPath } from './machine.ts';
import type {
  Change, DestinationResult, HarnessId, HistoryEvent, LibraryFacts, LibraryView, PassResult, PluginSkillRef, Skill, FileRead, SwitchTarget, SyncNotice, SyncView, ThroughPlugin, ToolCopy,
} from './types.ts';
import { andList, notManagedHere, throughPlugin, toolName } from './words.ts';

const iso = (ms: number) => new Date(ms).toISOString();
const nameOf = (tool: HarnessId) => toolName(tool);
/** A path as a sentence says it: under the real home from ~, under another home from "…", with `/` separators. */
export const pathWords = (context: Pick<ShareContext, 'home' | 'mode'>, path: string, platform = process.platform): string => {
  const slash = platform === 'win32' ? '\\' : '/';
  return path.startsWith(`${context.home}${slash}`)
    ? `${context.mode === 'actual' ? '~' : '…'}${displayPath(path.slice(context.home.length), platform)}`
    : displayPath(path, platform);
};
/** A skill's first line of body text, which the copy question quotes to tell copies apart. */
const bodyLine = (content: string) => content.replace(/^﻿?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '').split(/\r?\n/)
  .map(line => line.trim()).find(line => line && !line.startsWith('#')) ?? '';

// ---------- What the tools hold ----------

/**
 * A copy a tool has that is no copy of Central Knot's: how it has it (said on its line), and where; `throughShared`, its folder's
 * name in the shared skills folder, where it is the copy there or a link to it (library.ts THE SHARED FOLDER).
 */
interface Way { why: string; path: string; take?: 'link' | 'shared'; linkTo?: string; throughShared?: string }

/** What the managed tools hold of skills now (librarypass.ts Disk), and what the page and the held reasons read besides. */
export interface SkillDisk extends Disk<SkillCopy> {
  /** The copy each tool loads outside Central Knot's own folder; for Pi, its own link's copy even where a shared folder is the way (readAlsoRead). */
  outside: Map<string, Partial<Record<HarnessId, SkillCopy>>>;
  /** The ways each tool has a skill outside its own folder, by key: a link in its folder, a folder it reads that isn't Central Knot's. */
  ways: Map<string, Partial<Record<HarnessId, Way>>>;
  /** A tool that reads another managed tool's own skills folder (OpenCode reads Claude Code's), and whose. */
  readsFrom: Partial<Record<HarnessId, HarnessId>>;
  /** Skills whose folder in some tool can't be copied as it is (skillfiles.ts FolderRead uncopied), by key: each a row. */
  uncopied: Set<string>;
  /** What each tool's plugins bring, by key. */
  through: Map<HarnessId, Map<string, GivenByPlugin>>;
  /** Each skill's SKILL.md as a tool would load it: the current version's, else a copy's (whether a tool would load it). */
  shapes: Map<string, Skill>;
  /** Each tool's switch file, read once (skillswitch.ts). */
  switches: Map<HarnessId, SwitchFile>;
  /** The shared skills folder's folders by key, or why it can't be vouched for now (sharedListing). */
  sharedNow: Set<string> | string;
  /** Links in a tool's own folder that lead nowhere, by `tool:key`, each with its folder's name in the shared folder if it led there. */
  dangling: Map<string, string | undefined>;
  switchedOff: Map<string, HarnessId[]>;
  /** How a tool has the skill another way, if it does (library.ts held `anotherWay`), On or Off. */
  anotherWay(item: Wanted, tool: HarnessId): string | undefined;
  /** For an item linked to a plugin, in a tool that takes the plugin: plugins.ts pluginHolds, asked before every other reason. */
  linked(item: Wanted, tool: HarnessId): PluginHold | undefined;
  /** Why a tool can't be given the skill, if it can't. */
  cannotTake(item: Wanted, tool: HarnessId): string | undefined;
}
type SkillLook = Look<SkillContent, SkillCopy, SkillDisk>;

/** The label the page gives a tool's own skills folder ("Claude Code skills"). */
const ownLabel = (tool: HarnessId) => harnesses[tool].skillRoots('', '')[0].label;

/** Reads each managed tool's skills (one FolderReads map hashes each real folder once for this read): its own folder, the folders it also reads, its plugins and its switches. */
export async function readDisk(context: ShareContext, managed: HarnessId[]): Promise<SkillDisk> {
  const recorded = Object.values(await recordedSkills(context.home)), sharedAt = await landingOf(sharedFolder(context));
  const reads: FolderReads = new Map(); // local to this readDisk: never kept past its return
  const disk: SkillDisk = {
    byKey: new Map(), unseen: new Map(), uncopied: new Set(), locked: new Map(), problems: [], outside: new Map(), ways: new Map(), readsFrom: {},
    through: await throughPlugins(context, managed, 'skill'), shapes: new Map(), switches: new Map(), switchedOff: new Map(),
    sharedNow: new Set(), dangling: new Map(), holdsBack: new Map(),
    linked: await pluginHolds(context, managed),
    anotherWay: (item, tool) => anotherWay(disk, managed, item, tool)?.why,
    cannotTake: (item, tool) => cannotTake(context, disk, item, tool),
    held: (item, tool) => {
      const other = anotherWay(disk, managed, item, tool);
      if (other) return { why: other.why, anotherWay: true, ...(other.throughShared ? { throughShared: other.throughShared } : {}) };
      const why = disk.cannotTake(item, tool);
      return why ? { why } : undefined;
    },
    // A tool that won't take the skill (its shape, a name it reserves) keeps any copy it has.
    refuses: (item, tool) => disk.cannotTake(item, tool),
    lostShared: (item, tool) => lostShared(context, disk, item, tool),
    readers: (item, tool) => readers(context, disk, managed, item, tool),
  };
  const sound: HarnessId[] = [];
  for (const tool of managed) if (await readOwnFolder(context, disk, tool, sharedAt, reads)) sound.push(tool);
  // Where the links in the tools' own folders lead in the shared folder, there or not: folders it is known to hold.
  const linked = [...disk.dangling.values(), ...[...disk.ways.values()].flatMap(ways => Object.values(ways).map(way => way?.throughShared))];
  disk.sharedNow = await sharedListing(context, recorded, linked.filter((folder): folder is string => !!folder));
  if (typeof disk.sharedNow === 'string') disk.problems.push(disk.sharedNow);
  // While it can't be vouched for, a tool that reads it may have any skill through it: its own copies are unseen too, so nothing
  // is taken in from them, written over or removed (library.ts THE SHARED FOLDER). copyRead and the found copies read this.
  if (typeof disk.sharedNow === 'string') for (const [key, slot] of disk.byKey) for (const tool of managed) {
    if (!slot[tool] || !readsShared(context, tool)) continue;
    const at = `${tool}:${key}`, why = waitsForShared(context, tool);
    disk.unseen.set(at, why); disk.holdsBack!.set(at, why);
  }
  await readAlsoRead(context, disk, managed, sound, sharedAt, reads);
  // A skill's shape: its current version's SKILL.md where the library has it, else a copy's (readShape reads SKILL.md alone,
  // so a stored version whose SKILL.md reads still gives its shape if a companion file under .central-knot is unreadable or a link).
  for (const item of recorded) {
    const version = item.deleted ? undefined : await readVersion(context, item.key, item.hash);
    const shape = version && await readShape(version.directory);
    if (shape) disk.shapes.set(item.key, { ...shape, folder: item.name });
  }
  for (const [key, slot] of [...disk.byKey, ...disk.outside]) if (!disk.shapes.has(key)) disk.shapes.set(key, Object.values(slot).find(Boolean)!.skill);
  // The tools whose own switch keeps every copy they load out: for the rule (librarypass.ts Disk.switchedOff).
  for (const key of new Set([...disk.byKey.keys(), ...disk.outside.keys()])) {
    const off = managed.filter(tool => offIn(context, disk, key, tool));
    if (off.length) disk.switchedOff.set(key, off);
  }
  return disk;
}

/** Notes one tool's way to a skill, or its copy outside its own folder, unless that tool has one there already. */
const add = <T>(map: Map<string, Partial<Record<HarnessId, T>>>, key: string, tool: HarnessId, value: T) => { if (!map.get(key)?.[tool]) map.set(key, { ...map.get(key), [tool]: value }); };
/** A folder's copies and the copies its links lead to. */
const copiesIn = (read: Awaited<ReturnType<typeof readSkillsFolder>>) => [...read.copies, ...read.links.flatMap(link => (link.copy ? [link.copy] : []))];

/**
 * One tool's own skills folder: its copies (Central Knot's to write and remove), its links (a way it has a skill that isn't
 * Central Knot's), and what can't be read. A folder that is itself a link, or another's, is pinned: every skill in it is one
 * the tool has another way, and nothing is written there. True when the folder is sound (another tool's reader may use it).
 */
async function readOwnFolder(context: ShareContext, disk: SkillDisk, tool: HarnessId, sharedAt: string | undefined, reads: FolderReads): Promise<boolean> {
  const root = rootOf(context, tool), read = await readSkillsFolder(tool, root, ownLabel(tool), reads);
  for (const [key, why] of read.unseen) disk.unseen.set(`${tool}:${key}`, why);
  for (const key of read.uncopied) disk.uncopied.add(key);
  const pinned = await rootProblem(context, tool);
  if (pinned) {
    disk.locked.set(tool, { why: pinned });
    for (const copy of copiesIn(read)) {
      add(disk.ways, copy.key, tool, { why: `${nameOf(tool)} reads it in ${root}. ${pinned}`, path: copy.directory });
      add(disk.outside, copy.key, tool, copy);
    }
    return false;
  }
  const locked = await lockedRoot(context, tool);
  if (locked) disk.locked.set(tool, { why: locked });
  for (const copy of read.copies) add(disk.byKey, copy.key, tool, copy);
  for (const link of read.links) {
    const target = resolve(dirname(link.path), link.linkTo), to = pathWords(context, target), throughShared = await sharedName(target, sharedAt);
    const why = `${nameOf(tool)} has it through a link in its skills folder (to ${to}), which is not Central Knot’s copy.`;
    add(disk.ways, link.key, tool, { why, path: link.path, take: 'link', linkTo: link.linkTo, ...(throughShared ? { throughShared } : {}) });
    if (link.copy) add(disk.outside, link.key, tool, link.copy);
  }
  for (const [key, linkTo] of read.broken) disk.dangling.set(`${tool}:${key}`, await sharedName(resolve(root, linkTo), sharedAt));
  return true;
}

/** The name of `directory` in the shared skills folder (`sharedAt`, its landing), if it is one there. */
const sharedName = async (directory: string, sharedAt: string | undefined) =>
  (await landingOf(dirname(directory)) === sharedAt ? basename(directory) : undefined);

/**
 * The folders each tool also reads: another managed tool's own (`readsFrom`: its copies are that tool's), or one Central Knot
 * doesn't own, whose copies are ways the tool has a skill. A copy in ~/.agents/skills can be taken over, unless a tool's own
 * skills folder is that folder (the only copy it can have). Each tool's own switch file is read here too.
 */
async function readAlsoRead(context: ShareContext, disk: SkillDisk, managed: HarnessId[], sound: HarnessId[], shared: string | undefined, reads: FolderReads) {
  let sharedTakeable = true;
  for (const tool of managed) if (disk.locked.has(tool) && await landingOf(rootOf(context, tool)) === shared) sharedTakeable = false;
  for (const tool of managed) {
    const switches = await readSwitchFile(context, tool);
    disk.switches.set(tool, switches);
    for (const { path, label } of alsoReads(context, tool)) {
      const landing = await landingOf(path);
      const owner = [] as HarnessId[];
      for (const other of sound) if (other !== tool && landing === await landingOf(rootOf(context, other))) owner.push(other);
      if (owner.length) { disk.readsFrom[tool] = owner[0]; continue; }
      const take = landing === shared && sharedTakeable ? 'shared' as const : undefined;
      // Another tool's own folder that Central Knot doesn't manage (that tool left out, or not installed): what is there stays
      // as it is, an item Off included, and this tool still loads it.
      let away: HarnessId | undefined;
      for (const other of Object.keys(harnesses) as HarnessId[]) if (!away && other !== tool && !managed.includes(other) && landing === await landingOf(rootOf(context, other))) away = other;
      const why = away ? `${nameOf(tool)} loads the copy in ${nameOf(away)}’s skills folder (${pathWords(context, path)}), which Central Knot doesn’t manage here.`
        : `${nameOf(tool)} also reads a copy at ${pathWords(context, path)}, which is not Central Knot’s.`;
      for (const copy of copiesIn(await readSkillsFolder(tool, path, label, reads))) {
        // In the shared folder itself, or through a link in another tool's folder that leads there (OpenCode reads Claude Code's):
        // while that folder can't be vouched for, no way and no copy found (library.ts THE SHARED FOLDER).
        const throughShared = landing === shared ? copy.name : await sharedName(copy.skill.realDirectory, shared);
        if (throughShared && typeof disk.sharedNow === 'string') continue;
        // A copy its own switch keeps out is no way to the skill while the copy in its own folder is let in (Pi's list goes by
        // path): that one stays, rather than give way to one the tool doesn't load.
        const here = disk.byKey.get(copy.key)?.[tool];
        if (here && isDisabled(context, switches, switchTarget(copy)) && !isDisabled(context, switches, switchTarget(here))) continue;
        // This copy, not a link in the tool's own folder, is the way said and taken over: Central Knot's copy in place of
        // the link would be one too many while the tool still reads this one (library.ts), and go again. Pi loads such a skill
        // by the link's path, which it finds first (measured), so for Pi the link's copy stays the one its switch names.
        if (disk.ways.get(copy.key)?.[tool]?.take === 'link') { delete disk.ways.get(copy.key)![tool]; if (tool !== 'pi-cli') delete disk.outside.get(copy.key)![tool]; }
        add(disk.ways, copy.key, tool, { why, path: copy.directory, take, ...(throughShared ? { throughShared } : {}) });
        add(disk.outside, copy.key, tool, copy);
      }
    }
  }
}

/**
 * How a tool has a skill another way, if it does, in the order it is said: a plugin brings it; a link in its own folder, or a
 * copy in a folder it reads that Central Knot doesn't own; or the folder of another managed tool it reads, where the skill is
 * really there (wanted in that tool, which can be given it), or where a copy Central Knot didn't put stays. A reader of a
 * tool the skill is kept out of, whose copy there is Central Knot's and leaves this pass, has it no other way.
 */
function anotherWay(disk: SkillDisk, managed: HarnessId[], item: Wanted, tool: HarnessId, depth = 0): Pick<Way, 'why' | 'throughShared'> & { readsFrom?: HarnessId } | undefined {
  // A plugin's item, in a tool that takes the plugin, has no other way than the plugin (cannotTake says the rest).
  const linked = disk.linked(item, tool);
  if (linked) return linked.anotherWay ? { why: linked.why } : undefined;
  const given = pluginFor(disk, item.key, tool);
  if (given) return { why: throughPlugin(tool, given) };
  const way = disk.ways.get(item.key)?.[tool];
  if (way) return way;
  const source = disk.readsFrom[tool];
  if (!source || !managed.includes(source) || depth) return undefined;
  const there = toolName(source);
  const reallyThere = wantedIn(item, source) && !disk.locked.has(source) && !disk.cannotTake(item, source) && !anotherWay(disk, managed, item, source, depth + 1);
  // Said as it is now: a copy there, or (a found skill, say) the folder it will be in once it is on there;
  // for found rows, libraryrow.ts detailLine shortens this using readBy (who would read that folder per readers).
  if (reallyThere) return disk.byKey.get(item.key)?.[source]
    ? { readsFrom: source, why: `${nameOf(tool)} reads ${there}’s copy, in ${there}’s skills folder.` }
    : { why: `${nameOf(tool)} reads ${there}’s skills folder, so it gets the skill from there once it is on in ${there}.` };
  const left = !!disk.byKey.get(item.key)?.[source] && item.applied[source] === undefined;
  const leftThere = { why: `${nameOf(tool)} reads a copy in ${there}’s skills folder, which is not Central Knot’s.` };
  if (!wantedIn(item, source) && (left || unseenIn(disk, source, item.key))) return leftThere;
  return undefined;
}

/**
 * Managed tools that read `source`'s skills folder and would load `item` from there (can take its shape, no copy or way of
 * their own, not denied in their own settings), when `source` itself is managed, writable and can take a copy of its own.
 */
function readers(context: ShareContext, disk: SkillDisk, managed: HarnessId[], item: Wanted, source: HarnessId): HarnessId[] {
  if (!managed.includes(source) || disk.locked.has(source) || disk.cannotTake(item, source) || anotherWay(disk, managed, item, source, 1) || unseenIn(disk, source, item.key)) return [];
  const shape = disk.shapes.get(item.key);
  const target: SwitchTarget = { folder: item.name, name: shape && !shape.opencodeProblem ? shape.name : item.name, skillFile: join(rootOf(context, source), item.name, 'SKILL.md') };
  return managed.filter(tool => disk.readsFrom[tool] === source && !disk.byKey.get(item.key)?.[tool] && !unseenIn(disk, tool, item.key)
    && !disk.cannotTake(item, tool) && !disk.linked(item, tool) && !pluginFor(disk, item.key, tool) && !disk.ways.get(item.key)?.[tool]
    && !isDisabled(context, disk.switches.get(tool)!, target));
}

/**
 * The shared skills folder's folders by key when it can be vouched for; else why not (library.ts THE SHARED FOLDER), said once
 * among the problems: it can't be listed; or, of the folders it is known to hold (the record's, and those a link in a tool's own
 * folder leads to: `linked`), it is missing, or lists none of them (a volume not mounted, another folder in its place; and a
 * person who removed every one: the line names them, and the way out). Known to hold none, it is as it lists.
 */
async function sharedListing(context: ShareContext, recorded: LibraryItem[], linked: string[]): Promise<Set<string> | string> {
  const had = recorded.filter(item => !item.deleted && Object.keys(item.throughShared ?? {}).length);
  const known = new Map(had.flatMap(item => Object.values(item.throughShared!).map(folder => [itemKey(folder), item.name] as const)));
  for (const folder of linked) if (!known.has(itemKey(folder))) known.set(itemKey(folder), folder);
  const names = known.size ? ` (${andList([...new Set(known.values())])})` : '';
  const at = pathWords(context, sharedFolder(context));
  const why = (state: string, until: string) =>
    `The shared skills folder (${at}) ${state}, so Central Knot changes nothing for the skills tools read there${names} until ${until}.`;
  let listed: Set<string>;
  try { listed = new Set((await readdir(sharedFolder(context))).map(itemKey)); }
  catch (error) {
    if (errorCode(error) !== 'ENOENT') return why('can’t be read', 'it can be');
    const missing = why('isn’t there', 'it is back; a skill turned on meanwhile waits for it too (if you removed it, turn them off and remove any link into it)');
    return known.size ? missing : new Set();
  }
  const noneOfThem = known.size && ![...known.keys()].some(folder => listed.has(folder));
  return noneOfThem ? why('holds none of them', 'they are back (if you removed them, turn them off and remove any link to them)') : listed;
}

/** Whether a tool reads the shared skills folder itself (Copilot CLI, Codex, Pi and OpenCode do; Claude Code doesn't). */
const readsShared = (context: ShareContext, tool: HarnessId) => alsoReads(context, tool).some(root => root.path === sharedFolder(context));
/** Why a tool that may have a skill through the shared folder is unseen while that folder can't be vouched for. */
const waitsForShared = (context: ShareContext, tool: HarnessId) =>
  `${nameOf(tool)} waits for the shared skills folder (${pathWords(context, sharedFolder(context))}) to be back: nothing is written there until then.`;

/**
 * Disk.lostShared for skills, for a tool with no copy and no other way. While the shared folder can't be vouched
 * for: unseen where the tool may have had the skill through it (it reads that folder, holds a link that leads nowhere, or had it
 * so). Else, for a tool that had it so (`throughShared`): its folder not listed there, the copy was deleted (`copy`); still
 * there: a tool that reads the shared folder can't read it for sure, and a link that leads nowhere is there still (unseen); a tool
 * that doesn't read the shared folder (Claude Code) had it by a link, now gone (`link`).
 */
function lostShared(context: ShareContext, disk: SkillDisk, item: Wanted, tool: HarnessId): 'copy' | 'link' | { unseen: string } | undefined {
  const folder = item.throughShared?.[tool], dangling = disk.dangling.has(`${tool}:${item.key}`), reads = readsShared(context, tool);
  if (typeof disk.sharedNow === 'string') return folder || dangling || reads ? { unseen: waitsForShared(context, tool) } : undefined;
  if (!folder) return undefined;
  if (!disk.sharedNow.has(itemKey(folder))) return 'copy';
  if (!reads && !dangling) return 'link';
  return { unseen: `${nameOf(tool)} can’t reach its copy in the shared skills folder for sure just now. Nothing changes there until it can.` };
}

/**
 * The plugin a tool has this skill through, if it does: a plugin skill of that name is this one when its SKILL.md is the
 * skill's, or when the skill is linked to that plugin (`link`, as pluginrows.ts onOwnRow folds it: a version taken back in Pi,
 * library.ts TAKEN BACK); another one that only shares the name is not. Turned off there or not, as for every kind (plugins.ts
 * partsHolding).
 */
function pluginFor(disk: SkillDisk, key: string, tool: HarnessId, link?: string): ThroughPlugin | undefined {
  const given = disk.through.get(tool)?.get(key), shape = disk.shapes.get(key);
  if (!given) return undefined;
  const same = given.text !== undefined && !!shape && comparableText(given.text) === comparableText(shape.content);
  if (!same && link !== pluginLink(given.plugin, given.marketplace)) return undefined;
  const { text: _text, ...plugin } = given;
  return plugin;
}

/** Why a tool can't be given a skill (librarypass.ts Disk.held, without `anotherWay`): a plugin's item where the plugin isn't, its name, or its shape. */
function cannotTake(context: ShareContext, disk: SkillDisk, item: Wanted, tool: HarnessId): string | undefined {
  const linked = disk.linked(item, tool);
  if (linked && !linked.anotherWay) return linked.why;
  if (harnesses[tool].reservedSkills.includes(item.name)) return `${nameOf(tool)} reserves the name “${item.name}”.`;
  const shape = disk.shapes.get(item.key);
  return shape ? wontLoad(context, tool, item.name, shape) : undefined;
}

/**
 * Why a tool won't load a skill of this shape (its SKILL.md's frontmatter), if it won't: the one answer to "will this tool load
 * this content". The plan asks it of the current version (cannotTake, through Disk.refuses), and the pass asks it of what it
 * is about to write (skillKind.refusesToLoad, from librarypass.ts writeCopy), which may be an edit this same pass took in. A
 * give-back (librarypass.ts giveBackCopy) puts a tool's own copy back as it was and doesn't ask.
 */
function wontLoad(context: ShareContext, tool: HarnessId, name: string, shape: Skill): string | undefined {
  return targetFor(tool, join(rootOf(context, tool), name), { ...shape, folder: name }).skipped;
}

// ---------- The skills' Kind ----------

/** Skills as a kind of item (librarypass.ts Kind): one folder per skill in each tool's own skills folder. */
export const skillKind: Kind<SkillContent, SkillCopy, SkillDisk> = {
  kind: 'skill',
  // The item and its copy as the page names them (libraryrow.ts libraryWords); a tool's folder of them only the pass says.
  words: { item: libraryWords.skills.item, copy: libraryWords.skills.copy, folder: () => 'skills folder' },
  // History's skill entries were keyed by the skill's key alone before the library, and still are.
  historyPrefix: '',
  harnesses: tools => [...tools],
  folder: rootOf,
  open: (context, persist = false) => openLibrary(context, persist, readDisk),
  save: saveLibrary,
  store: (context, item, hash, content) => storeVersion(context, item.key, { directory: content.directory, hash }),
  readVersion,
  hashOf: content => content.hash,
  recover: recoverFolders,
  read: readDisk,
  contentOf: copy => ({ directory: copy.directory, hash: copy.hash }),
  // A skill's version is its whole folder: no tool keeps a part of its own.
  ownOf: () => undefined,
  keepOwn: async () => false,
  write: writeSkill,
  refusesToLoad: async (context, item, tool, content) => {
    const read = await readCopy(tool, content.directory, '');
    return 'unseen' in read ? undefined : wontLoad(context, tool, item.name, read.skill);
  },
  remove: async (context, _item, here) => {
    try { await removeFolder(context, here.directory, here.hash); return 'removed'; }
    catch (error) { if (!errorCode(error)) throw error; return errorCode(error) === 'CK_CHANGED' ? 'changed' : 'failed'; }
  },
  // Pi's skills list keeps step with Central Knot's copy there (skillswitch.ts followCopy). A list that can't take it leaves the
  // copy read as off in Pi, with Let Pi load it on its line.
  follow: (context, item, tool, placed) => followCopy(context, tool, { folder: item.name, name: item.name, skillFile: join(rootOf(context, tool), item.name, 'SKILL.md') }, placed)
    .catch(error => { if (!errorCode(error)) throw error; return undefined; }),
  historyAction: libraryAction,
  merge: mergeSkill,
};

/**
 * Writes a version into one tool's skills folder: over its copy (only while that holds what was read), or as a new folder
 * named after the skill. An error with no code (a crash) goes on as it is; any other is said, and the next pass tries again.
 */
async function writeSkill(context: ShareContext, item: LibraryItem, tool: HarnessId, here: SkillCopy | undefined, content: SkillContent) {
  const target = here?.directory ?? join(rootOf(context, tool), item.name);
  try {
    if (here) await swapFolder(context, content.directory, target, here.hash);
    else if (await placeFolder(context, tool, content.directory, target, await readTree(content.directory))) {
      return { said: 'in place of a link that led nowhere' };
    }
    return undefined;
  } catch (error) {
    if (!errorCode(error)) throw error;
    const changed = errorCode(error) === 'CK_CHANGED';
    return { stopped: changed ? `${nameOf(tool)}’s copy changed just now, so it stays until the next look.` : `Could not write ${nameOf(tool)}’s copy. ${plainError(error)}` };
  }
}

// ---------- The pass, for skills ----------

/** What Pull brings for one skill (gitrepo.ts): the repo's folder for it, or its removal. */
export type PulledSkill = { name: string; folder: string; hash: string } | { removed: true };
type SkillPassOptions = Omit<PassOptions<SkillContent>, 'pulled'> & { pulled?: Map<string, PulledSkill> };

/**
 * One pass over the skills (librarypass.ts runPass): the page's clicks in `changes`, then every skill brought into
 * line. A pass that can't finish (a copy changed while it was being kept) says so; the next pass reads again.
 */
export async function applySkills(context: ShareContext, tools: HarnessId[], changes: Change[], options: SkillPassOptions = {}): Promise<PassResult> {
  const pulled = options.pulled && new Map([...options.pulled].map(([key, brought]) =>
    [key, 'removed' in brought ? brought : { name: brought.name, content: { directory: brought.folder, hash: brought.hash } }] as const));
  try { return await runPass(skillKind, context, tools, changes, { ...options, pulled }); }
  catch (error) {
    if (!errorCode(error)) throw error;
    return { stopped: `That could not finish. ${errorCode(error) === 'CK_CHANGED' ? (error as Error).message : plainError(error)} Click Refresh to see where things stand.`, results: [], writes: 0, reloads: [] };
  }
}

/**
 * A History entry's action on a skill (librarypass.ts restore; historyactions.ts says which click it is). Clear the switch's
 * Undo is no click on the item: it sets that tool's own switch again (switchBack).
 */
export async function restoreSkill(context: ShareContext, tools: HarnessId[], eventId: string, version?: string): Promise<PassResult> {
  const past = (await readHistory(context)).find(event => event.id === eventId);
  if (past && !past.undoneBy && isClearedSwitch(past)) return switchBack(context, tools, past);
  return restore(skillKind, context, tools, eventId, version);
}

/**
 * Clear the switch's Undo: each tool's own switch has the skill off again, as before, with an entry of its own. A tool not
 * managed now (`tools`) is left as it is, as every Undo leaves one, and said; with no tool left to set, it is refused. The skills
 * record's own stop and the gate come before any write, as clearSwitch's do.
 */
async function switchBack(context: ShareContext, tools: HarnessId[], past: HistoryEvent): Promise<PassResult> {
  const stop = (stopped: string): PassResult => ({ stopped, results: [], writes: 0, reloads: [] });
  const recorded = past.switched!.filter(entry => entry.target), away = recorded.filter(entry => !tools.includes(entry.tool));
  const entries = recorded.filter(entry => tools.includes(entry.tool));
  if (!entries.length) return stop(away.map(entry => notManagedHere(entry.tool)).join(' '));
  const already = await Promise.all(entries.map(async ({ tool, target }) => isDisabled(context, await readSwitchFile(context, tool), target!)));
  if (already.every(Boolean)) return stop(`${andList(entries.map(entry => toolName(entry.tool)))}’s own switch has it off already. Nothing was changed.`);
  const { problem } = await (past.of === 'agent' ? agentKind : skillKind).open(context);
  if (problem) return stop(problem);
  const gate = await libraryGate(context, { start: true });
  if ('refused' in gate) return stop(gate.refused);
  for (const { tool, target, listEdit } of entries) {
    try { await setDisabled(context, tool, target!, true, listEdit); }
    catch (error) { return stop(`Could not set ${toolName(tool)}’s switch: ${switchFailure(error)}`); }
  }
  const event: HistoryEvent = { id: randomUUID(), at: new Date().toISOString(), key: past.key, of: past.of, item: past.item, kind: 'switched', cause: 'switch', switched: entries.map(({ listEdit: _edit, ...entry }) => ({ ...entry, disabled: true })), losers: [], orderProved: true };
  const history = await readHistory(context);
  for (const entry of history) if (entry.id === past.id) entry.undoneBy = event.id;
  await replaceHistory(context, [...history, event]);
  const results = entries.map(({ tool }): DestinationResult => ({ item: past.item, harness: tool, outcome: 'switched', disabled: true, message: `${toolName(tool)}’s own switch has it off again.` }));
  results.push(...away.map(({ tool }): DestinationResult => ({ item: past.item, harness: tool, outcome: 'held', message: notManagedHere(tool) })));
  return { results, writes: entries.length, made: [event.id], reloads: destinationReloads(results, past.of === 'agent' ? 'agent' : 'skill') };
}

// ---------- The two actions a Change can't carry ----------

/**
 * Clears a tool's own switch that turns a skill off there (the mark on its line), whoever set it, for a skill in Central Knot
 * or one found in a tool; or Pi's for an agent there (`of`: Pi takes an agent as a skill, agents.ts agentInPi). The switch goes
 * back to what it was before it was set where the tool kept that (Claude Code's override); History's `switched` entry says so,
 * with what it changed in Pi's list, and its Undo sets the switch again (switchBack). Ends with a pass on the item.
 * Its own refusals first; then the kind's record's own stop and the gate (share.ts libraryGate), entered only to write, so
 * nothing is written before either is known. `resume`: the click is a Resume.
 */
export async function clearSwitch(context: ShareContext, tools: HarnessId[], key: string, tool: HarnessId, resume = false, of: 'skill' | 'agent' = 'skill'): Promise<PassResult> {
  const stop = (stopped: string): PassResult => ({ stopped, results: [], writes: 0, reloads: [] });
  if (!tools.includes(tool)) return stop(`${toolName(tool)} isn’t managed here now. Nothing was changed.`);
  const { name, target, problem } = of === 'agent' ? await agentInPi(context, tools, key, tool) : await skillLoads(context, tools, key, tool);
  if (!target || !isDisabled(context, await readSwitchFile(context, tool), target)) return stop(`${toolName(tool)}’s own switch doesn’t turn ${name} off any more. Nothing was changed.`);
  if (problem) return stop(problem);
  const gate = await libraryGate(context, { start: true, resume });
  if ('refused' in gate) return stop(gate.refused);
  let listEdit: ListEdit | undefined;
  try { listEdit = (await setDisabled(context, tool, target, false, await overrideBefore(context, key, tool, target))).edit; }
  catch (error) { return stop(`Could not clear ${toolName(tool)}’s switch: ${switchFailure(error)}`); }
  const switched = { tool, disabled: false, target, ...(listEdit ? { listEdit } : {}) };
  const event: HistoryEvent = { id: randomUUID(), at: new Date().toISOString(), key: of === 'agent' ? `agent:${key}` : key, of, item: name, kind: 'switched', switched: [switched], losers: [], orderProved: true };
  await appendHistory(context, [event]);
  const done = await (of === 'agent' ? applyAgents : applySkills)(context, tools, [], { only: new Set([key]) });
  const cleared: DestinationResult = { item: name, harness: tool, outcome: 'switched', disabled: false, message: `${toolName(tool)} loads it again.` };
  return { ...done, results: [cleared, ...done.results], made: [event.id], reloads: destinationReloads([cleared, ...done.results], of) };
}

/**
 * What Claude Code's override for a skill held before its switch was set (say "name-only"), which clearing it puts back: as
 * skillswitch.ts keeps it, else as a Disable from 0.4.0-preview.1 recorded it only in its History entry.
 */
async function overrideBefore(context: ShareContext, key: string, tool: HarnessId, target: SwitchTarget): Promise<string | undefined> {
  const kept = (await readKeptOverrides(context))[target.folder];
  if (tool !== 'claude-cli' || kept !== undefined) return kept;
  let before: string | undefined;
  for (const event of await readHistory(context)) {
    if (event.kind !== 'switched' || event.key !== key) continue;
    for (const entry of event.switched ?? []) if (entry.tool === tool && entry.disabled && entry.target?.folder === target.folder) before = entry.before;
  }
  return before;
}

/**
 * Takes over a copy outside Central Knot's own that a tool has a skill in the library through: a link in its skills folder,
 * or a copy in ~/.agents/skills (never a folder that is the only one a tool can have, nor another tool's own folder). Its
 * content becomes a version first if the library doesn't hold it ("was in Codex"); then the link, or the shared copy, goes;
 * then History is told, and the pass gives each tool that read it the library's current version. A found skill is taken in
 * first, by its switch. Nothing puts a link or a shared copy back, so there is no Undo; the content stays a version. Its own
 * refusals first; then the gate (share.ts libraryGate), entered only to write. `resume`: the click is a Resume, which the gate
 * remembers before the copy goes, so the closing pass is never refused after it.
 */
export async function takeOver(context: ShareContext, tools: HarnessId[], key: string, tool: HarnessId, resume = false): Promise<PassResult> {
  const stop = (stopped: string): PassResult => ({ stopped, results: [], writes: 0, reloads: [] });
  if (!tools.includes(tool)) return stop(`${toolName(tool)} isn’t managed here now. Nothing was changed.`);
  const { look, live } = await lookFor(skillKind, context, tools);
  const item = live.find(entry => entry.key === key);
  if (!item) return stop('Turn it on first: Central Knot takes over a copy only of a skill it has.');
  const held = pluginsRecordHold(item, look.recorded);
  if (held) return stop(held);
  const way = look.disk.ways.get(key)?.[tool], copy = look.disk.outside.get(key)?.[tool];
  if (!way?.take || !copy) return stop(`${toolName(tool)} has no copy of ${item.name} for Central Knot to take over now. Nothing was changed.`);
  // Hash the folder about to go, not `copy`: when Pi also holds a link in its own folder, `disk.outside` keeps the link's copy while `way.path` is the shared folder.
  const tree = await readTree(way.path).catch(() => undefined);
  if (!tree || tree.held) return stop(tree?.held ?? `${toolName(tool)} has no copy of ${item.name} for Central Knot to take over now. Nothing was changed.`);
  const gate = await libraryGate(context, { start: true, resume });
  if ('refused' in gate) return stop(gate.refused);
  const treeAt = (await folderTime(way.path).catch(() => undefined))?.at ?? copy.at;
  const known = item.versions.some(version => version.hash === tree.hash);
  // Always sent through keepVersion, listed or not: restores missing stored bytes while library.ts keepVersion lists a hash at most once.
  const keep: Version = { hash: tree.hash, at: iso(treeAt), from: { how: 'was-in', harness: tool, replacedBy: item.hash } };
  const loser = { tool, hash: tree.hash, path: way.path, ...(way.linkTo ? { linkTo: way.linkTo } : {}) };
  // Each tool that read the copy, and whether its own switch had it off (whoever set it).
  const readers = look.managed.filter(each => look.disk.ways.get(key)?.[each]?.path === way.path);
  const heldOff = readers.flatMap(each => { const target = loadTarget(loadedCopy(look, key, each)); return target && isDisabled(context, look.disk.switches.get(each)!, target) ? [{ tool: each, target }] : []; });
  const result = await runTakeOver(context, look.managed, item, keep, way);
  if (result) return stop(result);
  // Told once it happened: a take-over has no Undo, so an entry must never claim one that didn't.
  const event: HistoryEvent = { id: randomUUID(), at: new Date().toISOString(), key, of: 'skill', item: item.name, kind: 'took-over', losers: [loser], orderProved: true };
  await appendHistory(context, [event]);
  // The copies it puts in the tools that read the copy taken over are the take-over's: its entry tells them (PassOptions told).
  const done = await applySkills(context, tools, [], { only: new Set([key]), told: true });
  // Central Knot's copy is off where the copy it replaced was: a switch that goes by the file's path names the new one. The
  // old copy's own entry stays as he wrote it (its folder is gone, so it names nothing); what Pi's list gains is said.
  const listSaid: string[] = [];
  for (const { tool: each, target } of heldOff) {
    const { edit } = await setDisabled(context, each, { ...target, folder: item.name, skillFile: join(rootOf(context, each), item.name, 'SKILL.md') }, true);
    if (edit) listSaid.push(piListWords(edit));
  }
  if (listSaid.length) { event.settingsChanged = listSaid; await replaceHistory(context, (await readHistory(context)).map(each => (each.id === event.id ? event : each))); }
  const said = way.take === 'link' ? `Replaced the link in ${toolName(tool)}’s skills folder with Central Knot’s copy.`
    : `Removed the copy at ${pathWords(context, way.path)}; other apps that read that folder won’t find it there.`;
  const reloads = done.reloads.filter(entry => !heldOff.some(each => each.tool === entry.tool));
  return { ...done, results: [{ item: item.name, harness: tool, outcome: 'written', message: [`${said}${!known ? ' It is kept as a version.' : ''}`, ...listSaid].join(' ') }, ...done.results], made: [event.id], reloads };
}

/**
 * Takes over one copy (takeOver): the version first (library.ts keepVersion), with what tools had through the shared folder let
 * go, then only the link or the shared copy goes, with the links in the `managed` tools' folders that lead to it (one left leading
 * nowhere would say the shared folder still held it: sharedListing). Why not, if it couldn't.
 */
async function runTakeOver(context: ShareContext, managed: HarnessId[], item: LibraryItem, keep: Version, way: Way): Promise<string | undefined> {
  const { library, problem } = await skillKind.open(context, true);
  const held = library.items[item.key];
  if (problem || !held) return problem ?? 'It changed since the page was read. Nothing was changed; read again.';
  const store = (item: LibraryItem, hash: string, content: SkillContent) => skillKind.store(context, item, hash, content);
  const shelf = { store, save: () => saveLibrary(context.home, library) };
  // Its own removal is no deletion by hand: what tools had through the folder it removes goes first, for every skill that names
  // it (a link of another name leads there too: library.ts THE SHARED FOLDER).
  const removed = way.take === 'shared' ? itemKey(basename(way.path)) : undefined;
  for (const each of Object.values(library.items)) {
    if (each === held || Object.values(each.throughShared ?? {}).some(folder => itemKey(folder) === removed)) delete each.throughShared;
  }
  await keepVersion(shelf, held, keep, { directory: way.path, hash: keep.hash });
  const at = await landingOf(way.path), links: string[] = [];
  for (const root of way.take === 'shared' ? managed.map(tool => rootOf(context, tool)) : []) for (const name of await readdir(root).catch(() => [] as string[])) {
    const path = join(root, name);
    if ((await lstat(path).catch(() => undefined))?.isSymbolicLink() && await landingOf(path) === at) links.push(path);
  }
  try {
    if (way.take === 'link') await unlink(way.path);
    else await removeFolder(context, way.path, keep.hash);
    for (const link of links) await unlink(link);
  } catch (error) { return `Could not take it over: ${plainError(error)}`; }
  return undefined;
}

// ---------- For the callers around a pass ----------

/** One version's folder, for the Library to show: its SKILL.md and the names of its other files; none when the store no longer has it. */
export async function skillVersion(context: ShareContext, key: string, hash: string): Promise<{ skill: string; files: string[] } | undefined> {
  const version = await readVersion(context, key, hash);
  if (!version) return undefined;
  const tree = await readTree(version.directory);
  return { skill: await readFile(join(version.directory, 'SKILL.md'), 'utf8').catch(() => ''), files: [...tree.files.keys()].filter(name => name !== 'SKILL.md').sort() };
}
/** Regular files under `directory` by name (no hashing; skips .git, editor noise, links and specials), SKILL.md first. */
async function listSkillFiles(directory: string): Promise<string[] | undefined> {
  const files: string[] = [];
  async function visit(current: string) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name === '.git' || notCopied(entry.name, entry.isFile())) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(displayPath(relative(directory, path)));
    }
  }
  try { await visit(directory); } catch { return undefined; }
  const rest = files.filter(name => name !== 'SKILL.md').sort();
  return files.includes('SKILL.md') ? ['SKILL.md', ...rest] : rest;
}
/** Lists a skill folder's regular files by name and reads one through share.ts shownText; refuses links, specials and unlisted names. */
async function readSkillFile(directory: string, file: string): Promise<FileRead | undefined> {
  const files = await listSkillFiles(directory);
  if (!files || !files.includes(file)) return undefined;
  const path = join(directory, file);
  const info = await lstat(path).catch(() => undefined);
  if (!info?.isFile()) return undefined;
  const shown = await shownText(path, info.size);
  return shown && { files, ...shown };
}
/** Resolves a found skill copy's real folder in `tool` (narrowed by `rootLabel` when given), following a top-level link in a skills folder. */
async function foundSkillFolder(context: ShareContext, key: string, tool: HarnessId, rootLabel?: string): Promise<string | undefined> {
  const definition = harnesses[tool];
  const roots = definition.skillRoots(toolConfigRoot(context, tool), context.home);
  for (const root of rootLabel ? roots.filter(each => each.label === rootLabel) : roots) {
    const entries = await readdir(root.path, { withFileTypes: true }).catch(() => undefined);
    if (!entries) continue;
    const matches = entries.filter(entry => isSkillEntry(definition, entry) && itemKey(entry.name) === key);
    if (matches.length !== 1) continue;
    const target = join(root.path, matches[0]!.name);
    if (!await stat(target).then(info => info.isDirectory(), () => false)) continue;
    const real = await realpath(target).catch(() => undefined);
    if (real && (await lstat(join(real, 'SKILL.md')).catch(() => undefined))?.isFile()) return real;
  }
  return undefined;
}
/** One regular file of a stored skill version, through readSkillFile. */
export async function skillVersionFile(context: ShareContext, key: string, hash: string, file: string): Promise<FileRead | undefined> {
  const version = await readVersion(context, key, hash);
  return version ? readSkillFile(version.directory, file) : undefined;
}
/** One regular file of a found skill copy in `tool` (narrowed by `rootLabel`), through readSkillFile. */
export async function skillFoundFile(context: ShareContext, key: string, tool: HarnessId, rootLabel: string | undefined, file: string): Promise<FileRead | undefined> {
  const folder = await foundSkillFolder(context, key, tool, rootLabel);
  return folder ? readSkillFile(folder, file) : undefined;
}
type MarketplaceLookup = (marketName: string, plugin: string, source?: string) => Promise<PluginCopy | undefined>;
/** Resolves a plugin skill's folder (installed or marketplace copy) through catalogdetail.ts pluginSkills; refuses parts leaving the plugin's root. */
async function pluginSkillFolder(context: PluginContext, ref: PluginSkillRef, marketplace?: MarketplaceLookup): Promise<{ directory: string; real: string } | undefined> {
  if (!SAFE_NAME.test(ref.marketName) || !SAFE_NAME.test(ref.plugin) || !ref.part || ref.part.includes('\0') || isAbsolute(ref.part)) return undefined;
  const installed = ref.from !== 'marketplace' && takesPlugins(ref.from)
    ? (await installedPlugins(context, ref.from).catch(() => [])).find(entry => entry.plugin === ref.plugin && entry.marketplace === ref.marketName) : undefined;
  const copy = ref.from === 'marketplace' ? await marketplace?.(ref.marketName, ref.plugin, ref.source)
    : installed?.state.state === 'installed' ? { folder: installed.state.path, root: installed.state.path, entry: installed.entry ?? {}, atMarketplaceRoot: !!installed.atMarketplaceRoot } : undefined;
  if (!copy || (ref.from === 'marketplace' && !(await inside(copy.root, copy.folder)))) return undefined;
  const listed = await pluginSkills(copy.folder, copy.entry, ref.from === 'marketplace' ? undefined : ref.from, copy.atMarketplaceRoot, copy.codexOnly);
  if (!listed.some(skill => skill.path === ref.part)) return undefined;
  const candidate = resolve(copy.folder, ref.part);
  if (!pathIn(copy.folder, candidate) || !(await inside(copy.folder, candidate))) return undefined;
  const real = await realpath(candidate).catch(() => undefined);
  return real && (await lstat(join(real, 'SKILL.md')).catch(() => undefined))?.isFile() ? { directory: candidate, real } : undefined;
}
/** One regular file of a plugin skill (installed copy in a tool, or its marketplace copy), through readSkillFile. */
export async function skillPluginFile(context: PluginContext, ref: PluginSkillRef, file: string, marketplace?: MarketplaceLookup): Promise<FileRead | undefined> {
  const found = await pluginSkillFolder(context, ref, marketplace);
  const read = found && await readSkillFile(found.real, file);
  return read ? { ...read, directory: found.directory } : undefined;
}

/**
 * What the Git repo holds for each skill in the library, On or Off (gitrepo.ts Push): its current version's folder, or the
 * edit a tool holds that no pass has taken in yet (it goes as a click's own pass would take it in; no tool is written); none
 * when the store no longer has it.
 */
export async function skillsForRepo(context: ShareContext, tools: HarnessId[]): Promise<{ item: LibraryItem; folder?: string }[]> {
  const { look, live } = await lookFor(skillKind, context, tools);
  return Promise.all(live.map(async item => {
    const takeIn = plan(item, copiesOf(look, item)).takeIn;
    const edit = takeIn ? look.disk.byKey.get(item.key)?.[takeIn] : undefined;
    return { item, folder: edit?.directory ?? (await readVersion(context, item.key, item.hash))?.directory };
  }));
}

// ---------- View ----------

/** The copy a tool loads a skill from, and how its own switch names it: its own folder's first, then the one it has another way, then the one in the folder it reads. */
function loadedCopy(look: SkillLook, key: string, tool: HarnessId): SkillCopy | undefined {
  const disk = look.disk, source = disk.readsFrom[tool];
  return disk.byKey.get(key)?.[tool] ?? disk.outside.get(key)?.[tool] ?? (source ? disk.byKey.get(key)?.[source] : undefined);
}
const loadTarget = (copy: SkillCopy | undefined) => copy && switchTarget(copy);
/** The copy in the skills folder of the managed tool `tool` reads (OpenCode reads Claude Code's): that tool's own, or its link's. */
const copyInRead = (disk: SkillDisk, key: string, tool: HarnessId) => {
  const source = disk.readsFrom[tool];
  return !source ? undefined : disk.byKey.get(key)?.[source] ?? (disk.ways.get(key)?.[source]?.take === 'link' ? disk.outside.get(key)?.[source] : undefined);
};
/** The skill a tool's switch is cleared for (clearSwitch): its name, in Central Knot or found in a tool, and the copy the tool loads. */
async function skillLoads(context: ShareContext, tools: HarnessId[], key: string, tool: HarnessId) {
  const { look, live, problem } = await lookFor(skillKind, context, tools);
  const name = live.find(entry => entry.key === key)?.name ?? foundCopies(look, key, [])[0]?.name ?? key;
  return { name, target: loadTarget(loadedCopy(look, key, tool)), problem };
}
/** How a tool's own switch names one copy of a skill. */
const switchTarget = (copy: SkillCopy): SwitchTarget => ({ folder: copy.name, name: copy.skill.name, skillFile: join(copy.directory, 'SKILL.md') });
/**
 * Whether a tool's own switch keeps out every copy of a skill it loads: its own and the one it has another way (Pi can have
 * both: its own folder's and the shared folder's of one name, and loads either), else the copy in the folder it reads.
 */
function offIn(context: ShareContext, disk: SkillDisk, key: string, tool: HarnessId): boolean {
  const source = disk.readsFrom[tool], own = [disk.byKey.get(key)?.[tool], disk.outside.get(key)?.[tool]].filter(copy => !!copy);
  const copies = own.length ? own : source && disk.byKey.get(key)?.[source] ? [disk.byKey.get(key)![source]!] : [];
  return copies.length > 0 && copies.every(copy => isDisabled(context, disk.switches.get(tool)!, switchTarget(copy)));
}

/** Each version's note (library.ts VersionChange): the files that differ, as agents.ts changesOf says it for an agent's fields. */
async function changesOf(context: ShareContext, item: LibraryItem): Promise<VersionChange[]> {
  const trees = new Map<string, Tree | undefined>();
  const treeOf = async (hash: string) => {
    if (!trees.has(hash)) { const version = await readVersion(context, item.key, hash); trees.set(hash, version && await readTree(version.directory).catch(() => undefined)); }
    return trees.get(hash);
  };
  const compare = async (version: Version, against: string) => {
    const [was, is] = await Promise.all([treeOf(against), treeOf(version.hash)]);
    return was && is ? changedFiles(was, is) : undefined;
  };
  return Promise.all(listed(item).map(async (version): Promise<VersionChange> => {
    const basis = noteAgainst(item, version);
    if (typeof basis === 'string') return basis;
    const files = await compare(version, basis.against);
    return !files ? 'unknown' : basis.how === 'differs' ? { differs: files } : { changed: files };
  }));
}

/** The files that differ between two versions of a skill, by name ("SKILL.md", "scripts/run.sh"), and empty folders by theirs. */
export function changedFiles(was: Tree, is: Tree): string[] {
  const names = new Set([...was.files.keys(), ...is.files.keys()]);
  const files = [...names].filter(name => {
    const before = was.files.get(name), after = is.files.get(name);
    return !before || !after || before.sha256 !== after.sha256 || (before.mode & 0o111 ? 1 : 0) !== (after.mode & 0o111 ? 1 : 0);
  });
  const folders = [...new Set([...was.directories, ...is.directories])].filter(name => was.directories.includes(name) !== is.directories.includes(name));
  return [...files, ...folders].sort();
}

/**
 * The Library's skill rows: every skill in the library (On, or Off: in Central Knot only) and every found one (in a managed
 * tool, not in the library). `library` gives the page and History each item as the library holds it, deleted ones too.
 */
export async function skillsView(context: ShareContext, tools: HarnessId[], notices: SyncNotice[] = []): Promise<LibraryView> {
  const { look, live, problem } = await lookFor(skillKind, context, tools);
  const { library, managed } = look;
  // A skill whose folder can't be copied as it is (a link inside, a file it can't read) is a row too, which says why.
  const keys = [...new Set([...look.disk.byKey.keys(), ...look.disk.outside.keys(), ...look.disk.uncopied, ...live.map(item => item.key)])].sort((first, second) => first.localeCompare(second));
  const items: LibraryFacts[] = [], fromSource = await sourceFacts(context, 'skill', library.items, item => copiesOf(look, item));
  for (const key of keys) items.push(await rowFacts(look, key, live.find(item => item.key === key), fromSource.get(key)));
  const gate = problem ? { state: 'stopped' as const, reason: problem } : await syncGate(context);
  const problems = problem ? [problem, ...look.disk.problems] : look.disk.problems;
  return { tools: managed, items, library: library.items, access: await writeAccess(context), gate, problems, unread: unreadIn(look.disk, managed), notices };
}

/** One copy as the page shows it (types.ts ToolCopy): the copy question quotes its first line of body text; Read both copies opens the Files view. */
const toolCopy = (copy: SkillCopy): ToolCopy => ({
  hash: copy.hash, directory: copy.directory, rootLabel: copy.skill.rootLabel, lines: copy.skill.content.split(/\r?\n/).length, modified: iso(copy.at),
  summary: bodyLine(copy.skill.content), writable: true, folder: copy.name, name: copy.skill.name,
});

/**
 * One skill's row: what each managed tool holds and, for a skill in the library, what the next pass does in each (`plan`, from
 * the same reading a pass makes: copiesOf) and why nothing can happen in one (`unseen`, `cannot`). Besides, what only skills
 * have: how a tool has it another way, which copies outside Central Knot's can be taken over, and each tool's own switch.
 * `fromSource`: the source it is from, as sources.ts sourceFacts says it.
 */
async function rowFacts(look: SkillLook, key: string, item: LibraryItem | undefined, fromSource: LibraryFacts['fromSource']): Promise<LibraryFacts> {
  const disk = look.disk, slot = disk.byKey.get(key) ?? {}, outside = disk.outside.get(key) ?? {};
  const entries = look.managed.flatMap(tool => (slot[tool] ? [slot[tool]!] : []));
  // A found skill has a copy somewhere: its own folder's, else one a tool has another way, else one that can't be read for sure.
  const first: SkillCopy | undefined = entries[0] ?? Object.values(outside).find(Boolean);
  const name = item?.name ?? first?.name ?? key;
  const copies: Partial<Record<HarnessId, ToolCopy>> = {};
  for (const copy of entries) copies[copy.tool] = toolCopy(copy);
  const copiesNow = item ? copiesOf(look, item) : undefined, made = item && copiesNow ? plan(item, copiesNow) : undefined;
  const facts: ToolFacts = { cannot: {}, unseen: {}, plugin: {}, anotherWay: {}, readsFrom: {}, readBy: {}, takeOver: {}, loads: {}, alsoLoads: {} };
  for (const tool of look.managed) toolFacts(look, { key, name, item, copiesNow, made, link: fromSource?.link }, tool, facts);
  const switchProblem = Object.fromEntries(Object.keys(facts.loads).flatMap(tool => { const problem = disk.switches.get(tool as HarnessId)?.problem; return problem ? [[tool, problem]] : []; }));
  // Its description is the current version's, else a copy's (readDisk's shapes).
  const description = disk.shapes.get(key)?.description ?? first?.skill.description ?? '';
  const edited = made ? pendingEdits(made) : [];
  const some = <T extends object>(field: string, value: T) => (Object.keys(value).length ? { [field]: value } : {});
  const folderHashes = Object.fromEntries([...entries, ...Object.values(outside).filter((copy): copy is SkillCopy => !!copy)].map(copy => [copy.skill.realDirectory, copy.hash]));
  return {
    key, name, description, copies, on: !!item?.on, except: item?.except ?? [], cannot: facts.cannot, edited,
    ...(made && item ? { plan: { ...made, keep: [...made.keep, ...(look.givingWay.get(key) ?? [])] }, versionChanges: await changesOf(look.context, item) }
      : { takeInAnswers: takeInAnswers(look, key), choiceBlocks: choiceBlocksOf(entries), ...some('folderHashes', folderHashes) }),
    ...some('plugin', facts.plugin), ...some('unseen', facts.unseen), ...some('anotherWay', facts.anotherWay),
    ...some('readsFrom', facts.readsFrom), ...some('readBy', facts.readBy), ...some('takeOver', facts.takeOver),
    ...some('loads', facts.loads), ...some('alsoLoads', facts.alsoLoads), ...some('switchedOff', Object.keys(facts.loads).filter(tool => facts.loads[tool as HarnessId]!.switchedOff)), ...some('switchProblem', switchProblem),
    ...(fromSource ? { fromSource } : {}),
  };
}

/** What a row says of each tool, filled in by toolFacts: one map per kind of fact, by tool. */
interface ToolFacts {
  cannot: LibraryFacts['cannot']; unseen: NonNullable<LibraryFacts['unseen']>; plugin: NonNullable<LibraryFacts['plugin']>;
  anotherWay: NonNullable<LibraryFacts['anotherWay']>; readsFrom: NonNullable<LibraryFacts['readsFrom']>; readBy: NonNullable<LibraryFacts['readBy']>;
  takeOver: NonNullable<LibraryFacts['takeOver']>; loads: NonNullable<LibraryFacts['loads']>; alsoLoads: NonNullable<LibraryFacts['alsoLoads']>;
}
type RowOf = { key: string; name: string; item: LibraryItem | undefined; copiesNow?: ReturnType<typeof copiesOf>; made?: ReturnType<typeof plan>; link?: string };

/**
 * One tool's facts on a skill's row: through a plugin, a copy that can't be read for sure, how it has the skill another way
 * (said On or Off), else why it can't be given it (as agents.ts rowFacts says it), a copy outside it can take over, and
 * what its own switch says.
 */
function toolFacts(look: SkillLook, row: RowOf, tool: HarnessId, facts: ToolFacts) {
  const { key, name, item, copiesNow, made, link } = row, disk = look.disk;
  const here = disk.byKey.get(key)?.[tool], outsideCopy = disk.outside.get(key)?.[tool], copy = copiesNow?.[tool];
  // A found skill is asked about as taking it in would leave it: On everywhere, nothing applied yet.
  const asIf: Wanted = item ?? { key, name, on: true, except: [], applied: {} };
  const given = pluginFor(disk, key, tool, link);
  if (given && !here) facts.plugin[tool] = given;
  const hidden = copy?.is === 'unseen' ? copy.why : !copiesNow ? unseenIn(disk, tool, key) : undefined;
  if (hidden) facts.unseen[tool] = hidden;
  // A plugin's part on there is what the tool loads. Turned off there, it loads none: a copy the tool has another way is what it
  // loads, and its line says that way (the pass's `held` still answers with the plugin: anotherWay).
  const pluginLoads = !!given && !given.off, outsideWay = disk.ways.get(key)?.[tool];
  const way = given?.off && !here && outsideWay?.why ? { why: outsideWay.why } : anotherWay(disk, look.managed, asIf, tool);
  const why = copy?.is === 'held' ? copy.why : (here ? undefined : disk.cannotTake(asIf, tool)) ?? disk.locked.get(tool)?.why;
  const touched = made?.write.includes(tool) || made?.remove.includes(tool);
  if (way) facts.anotherWay[tool] = `${way.why}${outsideCopy && movedOn(item, outsideCopy.hash) ? ` ${MOVED_ON}` : ''}`;
  else if (why && (copy?.is === 'held' || touched || (!copiesNow && !here))) facts.cannot[tool] = why;
  if (way?.readsFrom) facts.readsFrom[tool] = way.readsFrom;
  const readBy = readers(look.context, disk, look.managed, asIf, tool);
  if (readBy.length) facts.readBy[tool] = readBy;
  // Take over is for a skill in Central Knot: a found one is taken in first.
  if (item && !item.deleted && outsideWay?.take && outsideCopy) facts.takeOver[tool] = { kind: outsideWay.take, path: outsideWay.path };
  const loaded = pluginLoads && !here ? undefined : loadedCopy(look, key, tool), also = pluginLoads ? undefined : copyInRead(disk, key, tool);
  // The managed tool whose own folder holds a copy, by where it really is: a link's copy is the folder it leads to.
  const holder = (copy: SkillCopy) => { const at = look.managed.find(each => disk.byKey.get(key)?.[each]?.skill.realDirectory === copy.skill.realDirectory); return at ? { in: at } : {}; };
  if (loaded) facts.loads[tool] = { ...switchTarget(loaded), switchedOff: offIn(look.context, disk, key, tool), ...holder(loaded) };
  if (also && also !== loaded) facts.alsoLoads[tool] = holder(also);
}

/** A copy outside a tool's own folder that has moved on since the skill was taken in: neither its current version nor another of its versions. */
const movedOn = (item: LibraryItem | undefined, hash: string) => !!item && !item.deleted && item.hash !== hash && !item.versions.some(version => version.hash === hash);
const MOVED_ON = 'That copy differs from the current version, and isn’t one of its versions.';

/** Found, its copies differing: a copy another tool holding a different one wouldn't load is no choice for that tool. */
const choiceBlocksOf = (entries: SkillCopy[]) => Object.fromEntries(entries.map(chosen => [chosen.tool, entries.filter(other => other.hash !== chosen.hash)
  .flatMap(other => { const reason = targetFor(other.tool, other.directory, chosen.skill).skipped; return reason ? [{ tool: other.tool, reason }] : []; })]));

/** Where each tool keeps its skills, which other apps read that folder too, and why Central Knot doesn't write there, if it doesn't. */
export async function skillFolders(context: ShareContext, tools: HarnessId[]): Promise<SyncView['writes']> {
  const folderOf = async (tool: HarnessId) => ({ to: rootOf(context, tool), alsoReadBy: harnesses[tool].otherReaders, blocked: await rootProblem(context, tool) });
  return Object.fromEntries(await Promise.all(tools.map(async tool => [tool, await folderOf(tool)] as const)));
}

/** An edit's SKILL.md before and after, for History's "See the change": both are versions of the skill. */
export async function skillChange(context: ShareContext, eventId: string): Promise<{ before: string; after: string } | undefined> {
  const past = (await readHistory(context)).find(entry => entry.id === eventId);
  const entry = past && libraryEntry(past);
  if (!past?.previous || !past.winner?.hash || entry?.kind !== 'skills') return undefined;
  const text = (hash: string) => readVersion(context, entry.key, hash).then(version => version && readFile(join(version.directory, 'SKILL.md'), 'utf8').catch(() => undefined));
  const [before, after] = await Promise.all([text(past.previous), text(past.winner.hash)]);
  return before !== undefined && after !== undefined ? { before, after } : undefined;
}
