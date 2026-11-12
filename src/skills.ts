// Skills on Central Knot's library: the adapter for one kind. Read library.ts first (the model, and the one rule for an item
// in the library), then librarypass.ts (the pass, the same for every kind, and `Kind`, the contract a kind implements).
// This module is the skills' Kind (skillKind) and nothing the pass does itself:
// - what a tool holds of a skill (readDisk): its own copy, a folder in its own skills folder (skillfiles.ts), which is
//   Central Knot's to write and remove; and the ways it has a skill that are not Central Knot's (anotherWay): a link in its
//   folder, a copy in a folder it reads but Central Knot doesn't own (~/.agents/skills), another tool's folder it reads
//   (OpenCode reads Claude Code's) while the skill is really there, or a plugin;
// - why a tool can't be given a skill (cannotTake): a name it reserves, a shape it won't load (share.ts targetFor), or a
//   skill converted from one of its agents;
// - a tool's own switch for a skill (toolFacts, `loads`): read at each look and never written by a pass. A switch set in a tool,
//   by a person, a profile or Central Knot before the library, is left as it is and shown as a mark on that tool's line;
//   clearSwitch is the one action that writes it, and takeOver the one that makes a copy outside Central Knot's its own.
// Around the pass: applySkills and restoreSkill run it for skills (the page's clicks through librarypass.ts itemClick);
// skillsView is the Skills page's reading (types.ts LibraryView), which profiles read through profileplan.ts profileSkills;
// skillsForRepo is what the Git repo's Push sends. Elsewhere: the folders, skillfiles.ts; where things
// are kept and the migration from the earlier record, skillstore.ts and skillmigrate.ts; the row and its words,
// libraryrow.ts with librarypages.ts; History's sentences and actions, historyactions.ts.
import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { appendHistory, readHistory, replaceHistory } from './history.ts';
import { libraryAction, libraryEntry } from './historyactions.ts';
import { listed, plan, wantedIn } from './library.ts';
import type { LibraryItem, Version, VersionChange } from './library.ts';
import { copiesOf, differ, forgetFolders, foundCopies, itemClick, lookFor, restore, runPass, unseenIn, type Disk, type Kind, type Look, type PassOptions, type Wanted } from './librarypass.ts';
import { libraryWords } from './libraryrow.ts';
import { comparableText } from './pluginstatus.ts';
import { throughPlugins, type GivenByPlugin } from './plugins.ts';
import { errorCode, itemKey, landingOf, plainError, readTree, syncGate, targetFor, writeAccess, type ShareContext, type Tree } from './share.ts';
import { alsoReads, lockedRoot, placeFolder, readCopy, readSkillsFolder, recoverFolders, removeFolder, rootOf, rootProblem, sharedFolder, swapFolder, type SkillCopy } from './skillfiles.ts';
import { openLibrary, readConverted, readVersion, recordedSkills, saveLibrary, storeVersion, type ConvertedFrom, type SkillContent } from './skillstore.ts';
import { isDisabled, readKeptOverrides, readSwitchFile, setDisabled, switchFailure, type SwitchFile } from './skillswitch.ts';
import { harnesses } from './harnesses.ts';
import type { Change, DestinationResult, HarnessId, HistoryEvent, LibraryFacts, LibraryView, PassResult, Skill, SwitchTarget, SyncNotice, SyncView, ThroughPlugin, ToolCopy } from './types.ts';
import { andList, throughPlugin, toolName } from './words.ts';

const iso = (ms: number) => new Date(ms).toISOString();
const nameOf = (tool: HarnessId) => toolName(tool);
/** A path as a sentence says it, as the page shows paths (app.ts shownPath): inside the real home from ~, inside another home from "…". */
const pathWords = (context: ShareContext, path: string) =>
  (path.startsWith(`${context.home}/`) ? `${context.mode === 'actual' ? '~' : '…'}${path.slice(context.home.length)}` : path);
/** A skill's first line of body text, which the copy question quotes to tell copies apart. */
const bodyLine = (content: string) => content.replace(/^﻿?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '').split(/\r?\n/)
  .map(line => line.trim()).find(line => line && !line.startsWith('#')) ?? '';

// ---------- What the tools hold ----------

/** A copy a tool has that is no copy of Central Knot's: how it has it (said on its line), and where. */
interface Way { why: string; path: string; take?: 'link' | 'shared'; linkTo?: string }

/** What the managed tools hold of skills now (librarypass.ts Disk), and what the page and the held reasons read besides. */
export interface SkillDisk extends Disk<SkillCopy> {
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
  /** Skills Convert to skill made, by key: the agent each came from, and its tool, which never gets it back by itself. */
  converted: Map<string, ConvertedFrom>;
  /** How a tool has the skill another way, if it does (library.ts held `anotherWay`), On or Off. */
  anotherWay(item: Wanted, tool: HarnessId): string | undefined;
  /** Why a tool can't be given the skill, if it can't. */
  cannotTake(item: Wanted, tool: HarnessId): string | undefined;
}
type SkillLook = Look<SkillContent, SkillCopy, SkillDisk>;

/** The label the page gives a tool's own skills folder ("Claude Code skills"). */
const ownLabel = (tool: HarnessId) => harnesses[tool].skillRoots('', '')[0].label;

/** Reads each managed tool's skills: its own folder, the folders it also reads, its plugins and its switches. */
export async function readDisk(context: ShareContext, managed: HarnessId[]): Promise<SkillDisk> {
  const disk: SkillDisk = {
    byKey: new Map(), unseen: new Map(), uncopied: new Set(), locked: new Map(), problems: [], outside: new Map(), ways: new Map(), readsFrom: {},
    through: await throughPlugins(context, managed, 'skill', itemKey), shapes: new Map(), switches: new Map(), converted: new Map(),
    anotherWay: (item, tool) => anotherWay(disk, managed, item, tool),
    cannotTake: (item, tool) => cannotTake(context, disk, item, tool),
    held: (item, tool) => {
      const other = disk.anotherWay(item, tool);
      if (other) return { why: other, anotherWay: true };
      const why = disk.cannotTake(item, tool);
      return why ? { why } : undefined;
    },
    // A tool that won't take the skill (its shape, a name it reserves, the agent it was converted from) keeps any copy it has.
    refuses: (item, tool) => disk.cannotTake(item, tool),
  };
  const sound: HarnessId[] = [];
  for (const tool of managed) if (await readOwnFolder(context, disk, tool)) sound.push(tool);
  await readAlsoRead(context, disk, managed, sound);
  for (const [key, from] of Object.entries(await readConverted(context.home))) disk.converted.set(key, from);
  // A skill's shape: its current version's SKILL.md where the library has it, else a copy's.
  for (const item of Object.values(await recordedSkills(context.home))) {
    const version = item.deleted ? undefined : await readVersion(context, item.key, item.hash);
    const copy = version && await readCopy('claude-cli', version.directory, '');
    if (copy && !('unseen' in copy)) disk.shapes.set(item.key, { ...copy.skill, folder: item.name });
  }
  for (const [key, slot] of [...disk.byKey, ...disk.outside]) if (!disk.shapes.has(key)) disk.shapes.set(key, Object.values(slot).find(Boolean)!.skill);
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
async function readOwnFolder(context: ShareContext, disk: SkillDisk, tool: HarnessId): Promise<boolean> {
  const root = rootOf(context, tool), read = await readSkillsFolder(tool, root, ownLabel(tool));
  for (const [key, why] of read.unseen) disk.unseen.set(`${tool}:${key}`, why);
  for (const key of read.uncopied) disk.uncopied.add(key);
  const pinned = await rootProblem(context, tool);
  if (pinned) {
    disk.locked.set(tool, pinned);
    for (const copy of copiesIn(read)) {
      add(disk.ways, copy.key, tool, { why: `${nameOf(tool)} reads it in ${root}. ${pinned}`, path: copy.directory });
      add(disk.outside, copy.key, tool, copy);
    }
    return false;
  }
  const locked = await lockedRoot(context, tool);
  if (locked) disk.locked.set(tool, locked);
  for (const copy of read.copies) add(disk.byKey, copy.key, tool, copy);
  for (const link of read.links) {
    const to = pathWords(context, resolve(dirname(link.path), link.linkTo));
    const why = `${nameOf(tool)} has it through a link in its skills folder (to ${to}), which is not Central Knot’s copy.`;
    add(disk.ways, link.key, tool, { why, path: link.path, take: 'link', linkTo: link.linkTo });
    if (link.copy) add(disk.outside, link.key, tool, link.copy);
  }
  return true;
}

/**
 * The folders each tool also reads: another managed tool's own (`readsFrom`: its copies are that tool's), or one Central Knot
 * doesn't own, whose copies are ways the tool has a skill. A copy in ~/.agents/skills can be taken over, unless a tool's own
 * skills folder is that folder (the only copy it can have). Each tool's own switch file is read here too.
 */
async function readAlsoRead(context: ShareContext, disk: SkillDisk, managed: HarnessId[], sound: HarnessId[]) {
  const shared = await landingOf(sharedFolder(context));
  let sharedTakeable = true;
  for (const tool of managed) if (disk.locked.has(tool) && await landingOf(rootOf(context, tool)) === shared) sharedTakeable = false;
  for (const tool of managed) {
    for (const { path, label } of alsoReads(context, tool)) {
      const landing = await landingOf(path);
      const owner = [] as HarnessId[];
      for (const other of sound) if (other !== tool && landing === await landingOf(rootOf(context, other))) owner.push(other);
      if (owner.length) { disk.readsFrom[tool] = owner[0]; continue; }
      const take = landing === shared && sharedTakeable ? 'shared' as const : undefined;
      const why = `${nameOf(tool)} also reads a copy at ${pathWords(context, path)}, which is not Central Knot’s.`;
      for (const copy of copiesIn(await readSkillsFolder(tool, path, label))) {
        // This copy, not a link in the tool's own folder, is the way said and taken over: Central Knot's copy in place of
        // the link would be one too many while the tool still reads this one (library.ts), and go again.
        if (disk.ways.get(copy.key)?.[tool]?.take === 'link') { delete disk.ways.get(copy.key)![tool]; delete disk.outside.get(copy.key)![tool]; }
        add(disk.ways, copy.key, tool, { why, path: copy.directory, take });
        add(disk.outside, copy.key, tool, copy);
      }
    }
    disk.switches.set(tool, await readSwitchFile(context, tool));
  }
}

/**
 * How a tool has a skill another way, if it does, in the order it is said: a plugin brings it; a link in its own folder, or a
 * copy in a folder it reads that Central Knot doesn't own; or the folder of another managed tool it reads, where the skill is
 * really there (wanted in that tool, which can be given it), or where a copy Central Knot didn't put stays. A reader of a
 * tool the skill is kept out of, whose copy there is Central Knot's and leaves this pass, has it no other way.
 */
function anotherWay(disk: SkillDisk, managed: HarnessId[], item: Wanted, tool: HarnessId, depth = 0): string | undefined {
  const given = pluginFor(disk, item.key, tool);
  if (given) return throughPlugin(tool, given);
  const way = disk.ways.get(item.key)?.[tool];
  if (way) return way.why;
  const source = disk.readsFrom[tool];
  if (!source || !managed.includes(source) || depth) return undefined;
  const there = toolName(source);
  const reallyThere = wantedIn(item, source) && !disk.locked.has(source) && !disk.cannotTake(item, source) && !anotherWay(disk, managed, item, source, depth + 1);
  // Said as it is now: a copy there, or (a found skill, say) the folder it will be in once it is on there.
  if (reallyThere) return disk.byKey.get(item.key)?.[source] ? `${nameOf(tool)} reads ${there}’s copy, in ${there}’s skills folder.`
    : `${nameOf(tool)} reads ${there}’s skills folder, so it gets the skill from there once it is on in ${there}.`;
  const left = !!disk.byKey.get(item.key)?.[source] && item.applied[source] === undefined;
  if (!wantedIn(item, source) && (left || unseenIn(disk, source, item.key))) return `${nameOf(tool)} reads a copy in ${there}’s skills folder, which is not Central Knot’s.`;
  return undefined;
}

/**
 * The plugin a tool has this skill through, if it does: a plugin skill of that name is this one when Central Knot installed it
 * elsewhere as that plugin's part, or when its SKILL.md is the skill's; another one that only shares the name is not.
 */
function pluginFor(disk: SkillDisk, key: string, tool: HarnessId): ThroughPlugin | undefined {
  const given = disk.through.get(tool)?.get(key), shape = disk.shapes.get(key);
  if (!given || !(given.asParts || (given.text !== undefined && shape && comparableText(given.text) === comparableText(shape.content)))) return undefined;
  const { asParts: _asParts, text: _text, ...plugin } = given;
  return plugin;
}

/** Why a tool can't be given a skill (librarypass.ts Disk.held, without `anotherWay`): its name, its shape, or where it came from. */
function cannotTake(context: ShareContext, disk: SkillDisk, item: Wanted, tool: HarnessId): string | undefined {
  if (harnesses[tool].reservedSkills.includes(item.name)) return `${nameOf(tool)} reserves the name “${item.name}”.`;
  const converted = disk.converted.get(item.key);
  if (converted?.origin === tool) return `Converted from ${nameOf(tool)}’s agent “${converted.agent}”, so it is not placed back there; ${nameOf(tool)} keeps the agent.`;
  const shape = disk.shapes.get(item.key);
  return shape ? targetFor(tool, join(rootOf(context, tool), item.name), { ...shape, folder: item.name }).skipped : undefined;
}

// ---------- The skills' Kind ----------

/** Skills as a kind of item (librarypass.ts Kind): one folder per skill in each tool's own skills folder. */
export const skillKind: Kind<SkillContent, SkillCopy, SkillDisk> = {
  kind: 'skill',
  // The item and its copy as the page names them (libraryrow.ts libraryWords); a tool's folder of them only the pass says.
  words: { item: libraryWords.skills.item, copy: libraryWords.skills.copy, folder: 'skills folder' },
  // History's skill entries were keyed by the skill's key alone before the library, and still are.
  historyPrefix: '',
  harnesses: tools => [...tools],
  folder: rootOf,
  pathOf: (context, tool, name) => join(rootOf(context, tool), name),
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
  remove: async (context, _item, here) => {
    try { await removeFolder(context, here.directory, here.hash); return 'removed'; }
    catch (error) { if (!errorCode(error)) throw error; return errorCode(error) === 'CK_CHANGED' ? 'changed' : 'failed'; }
  },
  historyAction: libraryAction,
};

/**
 * Writes a version into one tool's skills folder: over its copy (only while that holds what was read), or as a new folder
 * named after the skill. An error with no code (a crash) goes on as it is; any other is said, and the next pass tries again.
 */
async function writeSkill(context: ShareContext, item: LibraryItem, tool: HarnessId, here: SkillCopy | undefined, content: SkillContent) {
  const target = here?.directory ?? join(rootOf(context, tool), item.name);
  // A version this tool won't load (an edit taken in by this same pass) is never written there; the copy it has stays.
  const read = await readCopy(tool, content.directory, '');
  const refused = 'unseen' in read ? undefined : targetFor(tool, target, { ...read.skill, folder: item.name }).skipped;
  if (refused) return { stopped: refused };
  try {
    if (here) await swapFolder(context, content.directory, target, here.hash);
    else await placeFolder(context, tool, content.directory, target, await readTree(content.directory));
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
 * One pass over the skills (librarypass.ts runPass): the page's clicks in `changes` (itemClick), then every skill brought into
 * line. A pass that can't finish (a copy changed while it was being kept) says so; the next pass reads again.
 */
export async function applySkills(context: ShareContext, tools: HarnessId[], changes: Change[], options: SkillPassOptions = {}): Promise<PassResult> {
  const pulled = options.pulled && new Map([...options.pulled].map(([key, brought]) =>
    [key, 'removed' in brought ? brought : { name: brought.name, content: { directory: brought.folder, hash: brought.hash } }] as const));
  try { return await runPass(skillKind, context, tools, changes.map(itemClick), { ...options, pulled }); }
  catch (error) {
    if (!errorCode(error)) throw error;
    return { stopped: `That could not finish. ${errorCode(error) === 'CK_CHANGED' ? (error as Error).message : plainError(error)} Click Refresh to see where things stand.`, results: [], writes: 0 };
  }
}

/**
 * A History entry's action on a skill (librarypass.ts restore; historyactions.ts says which click it is). Clear the switch's
 * Undo is no click on the item: it sets that tool's own switch again (switchBack).
 */
export async function restoreSkill(context: ShareContext, tools: HarnessId[], eventId: string, version?: string): Promise<PassResult> {
  const past = (await readHistory(context)).find(event => event.id === eventId);
  if (past?.kind === 'switched' && past.cause !== 'switch' && !past.undoneBy && past.switched?.every(entry => !entry.disabled)) return switchBack(context, past);
  return restore(skillKind, context, tools, eventId, version);
}

/** Clear the switch's Undo: each tool's own switch has the skill off again, as before, with an entry of its own. */
async function switchBack(context: ShareContext, past: HistoryEvent): Promise<PassResult> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason, results: [], writes: 0 };
  const entries = past.switched!.filter(entry => entry.target);
  const already = await Promise.all(entries.map(async ({ tool, target }) => isDisabled(context, await readSwitchFile(context, tool), target!)));
  if (already.every(Boolean)) return { stopped: `${andList(entries.map(entry => toolName(entry.tool)))}’s own switch has it off already. Nothing was changed.`, results: [], writes: 0 };
  for (const { tool, target } of entries) {
    try { await setDisabled(context, tool, target!, true); }
    catch (error) { return { stopped: `Could not set ${toolName(tool)}’s switch: ${switchFailure(error)}`, results: [], writes: 0 }; }
  }
  const event: HistoryEvent = { id: randomUUID(), at: new Date().toISOString(), key: past.key, item: past.item, kind: 'switched', cause: 'switch', switched: entries.map(entry => ({ ...entry, disabled: true })), losers: [], orderProved: true };
  const history = await readHistory(context);
  for (const entry of history) if (entry.id === past.id) entry.undoneBy = event.id;
  await replaceHistory(context, [...history, event]);
  const results = entries.map(({ tool }): DestinationResult => ({ item: past.item, harness: tool, outcome: 'switched', disabled: true, message: `${toolName(tool)}’s own switch has it off again.` }));
  return { results, writes: entries.length, made: [event.id] };
}

/**
 * The tool choice (toolchoice.ts) lets go of the skills folders of the tools it leaves out at once (librarypass.ts
 * forgetFolders), so a tool managed again is told apart whether or not a pass runs before it is back.
 */
export const forgetSkillFolders = (context: ShareContext, managed: readonly HarnessId[]) => forgetFolders(skillKind, context, managed);

// ---------- The two actions a Change can't carry ----------

/**
 * Clears a tool's own switch that turns a skill off there (the mark on its line), whoever set it, for a skill in Central Knot
 * or one found in a tool. The switch goes back to
 * what it was before it was set where the tool kept that (Claude Code's override); History's `switched` entry says so, which
 * a profile's Undo reads (profileplan.ts changedSince). There is no Undo: setting it again is the tool's own business. Ends
 * with a pass on the skill.
 */
export async function clearSwitch(context: ShareContext, tools: HarnessId[], key: string, tool: HarnessId): Promise<PassResult> {
  const stop = (stopped: string): PassResult => ({ stopped, results: [], writes: 0 });
  const access = await writeAccess(context);
  if (!access.allowed) return stop(access.reason);
  const { look, live } = await lookFor(skillKind, context, tools);
  // A skill in Central Knot, or one found in a tool: either can have a tool's switch set.
  const name = live.find(entry => entry.key === key)?.name ?? foundCopies(look, key, [])[0]?.name ?? key;
  const target = loadTarget(look, key, name, tool);
  if (!target || !isDisabled(context, look.disk.switches.get(tool)!, target)) return stop(`${toolName(tool)}’s own switch doesn’t turn ${name} off any more. Nothing was changed.`);
  try { await setDisabled(context, tool, target, false, await overrideBefore(context, key, tool, target)); }
  catch (error) { return stop(`Could not clear ${toolName(tool)}’s switch: ${switchFailure(error)}`); }
  const event: HistoryEvent = { id: randomUUID(), at: new Date().toISOString(), key, item: name, kind: 'switched', switched: [{ tool, disabled: false, target }], losers: [], orderProved: true };
  await appendHistory(context, [event]);
  const done = await applySkills(context, tools, [], { only: new Set([key]) });
  const cleared: DestinationResult = { item: name, harness: tool, outcome: 'switched', disabled: false, message: `${toolName(tool)} loads it again from its next session.` };
  return { ...done, results: [cleared, ...done.results], made: [event.id] };
}

/**
 * What Claude Code's override for a skill held before its switch was set (say "name-only"), which clearing it puts back: as
 * skillswitch.ts keeps it, else as a Disable from 0.4.0-preview.1 recorded it only in its History entry (a profile's switch
 * that came after it replaced nothing).
 */
async function overrideBefore(context: ShareContext, key: string, tool: HarnessId, target: SwitchTarget): Promise<string | undefined> {
  const kept = (await readKeptOverrides(context))[target.folder];
  if (tool !== 'claude-cli' || kept !== undefined) return kept;
  let before: string | undefined;
  for (const event of await readHistory(context)) {
    if (event.kind === 'profile' && event.profile?.flips.some(flip => flip.tool === tool && flip.disabled && flip.item === `skill:${key}`)) before = undefined;
    if (event.kind !== 'switched' || event.key !== key) continue;
    for (const entry of event.switched ?? []) if (entry.tool === tool && entry.disabled && entry.target?.folder === target.folder) before = entry.before;
  }
  return before;
}

/**
 * Takes over a copy outside Central Knot's own that a tool has a skill in the library through: a link in its skills folder,
 * or a copy in ~/.agents/skills (never a folder that is the only one a tool can have, nor another tool's own folder). Its
 * content becomes a version first if the library doesn't hold it ("was in Codex"); History is told; then the link, or the
 * shared copy, goes, and the pass gives each tool that read it the library's current version. A found skill is taken in
 * first, by its switch. Nothing puts a link or a shared copy back, so there is no Undo; the content stays a version.
 */
export async function takeOver(context: ShareContext, tools: HarnessId[], key: string, tool: HarnessId): Promise<PassResult> {
  const stop = (stopped: string): PassResult => ({ stopped, results: [], writes: 0 });
  const access = await writeAccess(context);
  if (!access.allowed) return stop(access.reason);
  const gate = await syncGate(context);
  if (gate.state === 'stopped') return stop(gate.reason);
  const { look, live } = await lookFor(skillKind, context, tools);
  const item = live.find(entry => entry.key === key);
  if (!item) return stop('Turn it on first: Central Knot takes over a copy only of a skill it has.');
  const way = look.disk.ways.get(key)?.[tool], copy = look.disk.outside.get(key)?.[tool];
  if (!way?.take || !copy) return stop(`${toolName(tool)} has no copy of ${item.name} for Central Knot to take over now. Nothing was changed.`);
  const known = item.versions.some(version => version.hash === copy.hash);
  const keep: Version | undefined = known ? undefined : { hash: copy.hash, at: iso(copy.at), from: { how: 'was-in', harness: tool, replacedBy: item.hash } };
  const loser = { tool, hash: copy.hash, path: way.path, ...(way.linkTo ? { linkTo: way.linkTo } : {}) };
  // Each tool that read the copy, and whether its own switch had it off (a profile's hold, or the person's).
  const readers = look.managed.filter(each => look.disk.ways.get(key)?.[each]?.path === way.path);
  const heldOff = readers.flatMap(each => { const target = loadTarget(look, key, item.name, each); return target && isDisabled(context, look.disk.switches.get(each)!, target) ? [{ tool: each, target }] : []; });
  const result = await runTakeOver(context, item, keep, way);
  if (result) return stop(result);
  // Told once it happened: a take-over has no Undo, so an entry must never claim one that didn't.
  const event: HistoryEvent = { id: randomUUID(), at: new Date().toISOString(), key, item: item.name, kind: 'took-over', losers: [loser], orderProved: true };
  await appendHistory(context, [event]);
  const done = await applySkills(context, tools, [], { only: new Set([key]) });
  // Central Knot's copy is off where the copy it replaced was: a switch that goes by the file's path names the new one.
  for (const { tool: each, target } of heldOff) {
    await setDisabled(context, each, target, false);
    await setDisabled(context, each, { ...target, folder: item.name, skillFile: join(rootOf(context, each), item.name, 'SKILL.md') }, true);
  }
  const said = way.take === 'link' ? `Replaced the link in ${toolName(tool)}’s skills folder with Central Knot’s copy.`
    : `Removed the copy at ${pathWords(context, way.path)}; other apps that read that folder won’t find it there.`;
  return { ...done, results: [{ item: item.name, harness: tool, outcome: 'written', message: `${said}${keep ? ' It is kept as a version.' : ''}` }, ...done.results], made: [event.id] };
}

/** Takes over one copy (takeOver): the version first, then only the link (as a link) or the shared copy goes. Why not, if it couldn't. */
async function runTakeOver(context: ShareContext, item: LibraryItem, keep: Version | undefined, way: Way): Promise<string | undefined> {
  const { library, problem } = await skillKind.open(context, true);
  const held = library.items[item.key];
  if (problem || !held) return problem ?? 'It changed since the page was read. Nothing was changed; read again.';
  if (keep) {
    await skillKind.store(context, held, keep.hash, { directory: way.path, hash: keep.hash });
    if (!held.versions.some(version => version.hash === keep.hash)) held.versions = [keep, ...held.versions];
    await saveLibrary(context.home, library);
  }
  try {
    if (way.take === 'link') await unlink(way.path);
    else await removeFolder(context, way.path, keep?.hash ?? (await readTree(way.path)).hash);
  } catch (error) { return `Could not take it over: ${plainError(error)}`; }
  return undefined;
}

// ---------- For the callers around a pass ----------

/** One version's folder, for the Skills page to show: its SKILL.md and the names of its other files; none when the store no longer has it. */
export async function skillVersion(context: ShareContext, key: string, hash: string): Promise<{ skill: string; files: string[] } | undefined> {
  const version = await readVersion(context, key, hash);
  if (!version) return undefined;
  const tree = await readTree(version.directory);
  return { skill: await readFile(join(version.directory, 'SKILL.md'), 'utf8').catch(() => ''), files: [...tree.files.keys()].filter(name => name !== 'SKILL.md').sort() };
}

/** The skills that are On in the library, by key (plugin parts ask which skills Central Knot keeps in step: parts.ts). */
export async function skillsOn(context: ShareContext): Promise<Map<string, LibraryItem>> {
  const { library } = await skillKind.open(context);
  return new Map(Object.values(library.items).filter(item => item.on && !item.deleted).map(item => [item.key, item]));
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

/** The folder a tool loads a skill from, own copy first, then the one it has another way, and how its switch names it there. */
function loadTarget(look: SkillLook, key: string, name: string, tool: HarnessId): SwitchTarget | undefined {
  const disk = look.disk, source = disk.readsFrom[tool];
  const copy = disk.byKey.get(key)?.[tool] ?? disk.outside.get(key)?.[tool] ?? (source ? disk.byKey.get(key)?.[source] : undefined);
  return copy && { folder: copy.name, name: copy.skill.name, skillFile: join(copy.directory, 'SKILL.md') };
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
    if (version.from.replacedBy) { const files = await compare(version, version.from.replacedBy); return files ? { differs: files } : 'unknown'; }
    const before = item.versions.slice(item.versions.indexOf(version) + 1).find(older => older.from.how !== 'was-in');
    if (before) { const files = await compare(version, before.hash); return files ? { changed: files } : 'unknown'; }
    const takenWith = version.from.how === 'chosen' || item.versions.some(other => other.from.replacedBy === version.hash);
    return takenWith ? 'none' : 'first';
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
 * The Skills page's rows: every skill in the library (On, or Off: in Central Knot only) and every found one (in a managed
 * tool, not in the library). `library` gives the page and History each item as the library holds it, deleted ones too.
 */
export async function skillsView(context: ShareContext, tools: HarnessId[], notices: SyncNotice[] = []): Promise<LibraryView> {
  const { look, live, problem } = await lookFor(skillKind, context, tools);
  const { library, managed } = look;
  // A skill whose folder can't be copied as it is (a link inside, a file it can't read) is a row too, which says why.
  const keys = [...new Set([...look.disk.byKey.keys(), ...look.disk.outside.keys(), ...look.disk.uncopied, ...live.map(item => item.key)])].sort((first, second) => first.localeCompare(second));
  const items: LibraryFacts[] = [];
  for (const key of keys) items.push(await rowFacts(look, key, live.find(item => item.key === key)));
  const gate = problem ? { state: 'stopped' as const, reason: problem } : await syncGate(context);
  const problems = problem ? [problem, ...look.disk.problems] : look.disk.problems;
  return { tools: managed, items, library: library.items, access: await writeAccess(context), gate, problems, notices };
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
 */
async function rowFacts(look: SkillLook, key: string, item: LibraryItem | undefined): Promise<LibraryFacts> {
  const disk = look.disk, slot = disk.byKey.get(key) ?? {}, outside = disk.outside.get(key) ?? {};
  const entries = look.managed.flatMap(tool => (slot[tool] ? [slot[tool]!] : []));
  // A found skill has a copy somewhere: its own folder's, else one a tool has another way, else one that can't be read for sure.
  const first: SkillCopy | undefined = entries[0] ?? Object.values(outside).find(Boolean);
  const name = item?.name ?? first?.name ?? key;
  const copies: Partial<Record<HarnessId, ToolCopy>> = {};
  for (const copy of entries) copies[copy.tool] = toolCopy(copy);
  const copiesNow = item ? copiesOf(look, item) : undefined, made = item && copiesNow ? plan(item, copiesNow) : undefined;
  const facts: ToolFacts = { cannot: {}, unseen: {}, plugin: {}, anotherWay: {}, takeOver: {}, loads: {} };
  for (const tool of look.managed) toolFacts(look, { key, name, item, copiesNow, made }, tool, facts);
  const switchProblem = Object.fromEntries(Object.keys(facts.loads).flatMap(tool => { const problem = disk.switches.get(tool as HarnessId)?.problem; return problem ? [[tool, problem]] : []; }));
  // Its description is the current version's, else a copy's (readDisk's shapes).
  const description = disk.shapes.get(key)?.description ?? first?.skill.description ?? '';
  const edited = made ? [made.takeIn, ...made.keep.filter(kept => kept.from.how === 'edited').map(kept => kept.harness)].filter(tool => tool !== undefined) : [];
  const converted = disk.converted.get(key);
  const some = <T extends object>(field: string, value: T) => (Object.keys(value).length ? { [field]: value } : {});
  return {
    key, name, description, copies, on: !!item?.on, except: item?.except ?? [], cannot: facts.cannot, edited,
    ...(made && item ? { plan: { ...made, keep: [...made.keep, ...(look.givingWay.get(key) ?? [])] }, versionChanges: await changesOf(look.context, item) }
      : { differs: differ(foundCopies(look, key, [])), choiceBlocks: choiceBlocksOf(entries) }),
    ...some('plugin', facts.plugin), ...some('unseen', facts.unseen), ...some('anotherWay', facts.anotherWay), ...some('takeOver', facts.takeOver),
    ...some('loads', facts.loads), ...some('switchProblem', switchProblem),
    ...(converted ? { converted: { agent: converted.agent, origin: converted.origin, losses: converted.losses } } : {}),
  };
}

/** What a row says of each tool, filled in by toolFacts: one map per kind of fact, by tool. */
interface ToolFacts {
  cannot: LibraryFacts['cannot']; unseen: NonNullable<LibraryFacts['unseen']>; plugin: NonNullable<LibraryFacts['plugin']>;
  anotherWay: NonNullable<LibraryFacts['anotherWay']>; takeOver: NonNullable<LibraryFacts['takeOver']>; loads: NonNullable<LibraryFacts['loads']>;
}
type RowOf = { key: string; name: string; item: LibraryItem | undefined; copiesNow?: ReturnType<typeof copiesOf>; made?: ReturnType<typeof plan> };

/**
 * One tool's facts on a skill's row: through a plugin, a copy that can't be read for sure, how it has the skill another way
 * (said On or Off), else why it can't be given it (as agents.ts rowFacts says it), a copy outside it can take over, and
 * what its own switch says.
 */
function toolFacts(look: SkillLook, row: RowOf, tool: HarnessId, facts: ToolFacts) {
  const { key, name, item, copiesNow, made } = row, disk = look.disk;
  const here = disk.byKey.get(key)?.[tool], outsideCopy = disk.outside.get(key)?.[tool], copy = copiesNow?.[tool];
  // A found skill is asked about as taking it in would leave it: On everywhere, nothing applied yet.
  const asIf: Wanted = item ?? { key, name, on: true, except: [], applied: {} };
  const given = pluginFor(disk, key, tool);
  if (given && !here) facts.plugin[tool] = given;
  const hidden = copy?.is === 'unseen' ? copy.why : !copiesNow ? unseenIn(disk, tool, key) : undefined;
  if (hidden) facts.unseen[tool] = hidden;
  const way = disk.anotherWay(asIf, tool);
  const why = copy?.is === 'held' ? copy.why : (here ? undefined : disk.cannotTake(asIf, tool)) ?? disk.locked.get(tool);
  const touched = made?.write.includes(tool) || made?.remove.includes(tool);
  if (way) facts.anotherWay[tool] = `${way}${outsideCopy && movedOn(item, outsideCopy.hash) ? ` ${MOVED_ON}` : ''}`;
  else if (why && (copy?.is === 'held' || touched || (!copiesNow && !here))) facts.cannot[tool] = why;
  // Take over is for a skill in Central Knot: a found one is taken in first.
  const outsideWay = disk.ways.get(key)?.[tool];
  if (item && !item.deleted && outsideWay?.take && outsideCopy) facts.takeOver[tool] = { kind: outsideWay.take, path: outsideWay.path };
  const target = given && !here ? undefined : loadTarget(look, key, name, tool);
  if (target) facts.loads[tool] = { ...target, off: isDisabled(look.context, disk.switches.get(tool)!, target) };
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
