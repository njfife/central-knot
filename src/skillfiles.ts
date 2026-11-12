// A skill's folder in a tool, as Central Knot reads, writes and removes it. The skills kind (skills.ts) builds its reading of
// the managed tools from these, and nothing here decides anything: which copy is the item's, and what happens to it, is the
// library's (library.ts) and the pass's (librarypass.ts).
//
// - Where: each tool keeps its own skills in one folder (rootOf, its first skill root); some tools also read others
//   (`~/.agents/skills`, and OpenCode reads Claude Code's), which Central Knot never writes (skills.ts says what they mean).
// - What a copy is: a real folder directly in a skills folder, with a SKILL.md that can be read as a skill (discovery.ts
//   parseSkill) and no link or special file inside (share.ts readTree). Its content, and a version's, is the folder as
//   readTree hashes it: every file's bytes, the executable bit, empty folders; Finder's and editors' leftovers and a nested
//   .git are no part of it. Its time (folderTime) is the latest change among the folder and what is in it, so a file removed
//   inside counts.
// - What a copy is not: a folder whose SKILL.md is missing or can't be read, or with a link inside, is `unseen` (its why);
//   a link in a skills folder is no copy of Central Knot's, read as the copy it leads to (`links`).
// - Writing and removing, each checked: a copy is written over (swapFolder) or removed (removeFolder) only while it still
//   holds what was read, and the folder moved aside for it is named beside its target (`.ck-parked-*` with a note of where it
//   goes) until the step is done, so recoverFolders puts it back after a crash and a copy moved aside is never read as gone.
// Plugin parts (parts.ts) use swapFolder and removeFolder for the skills they place.
import { randomUUID } from 'node:crypto';
import { access, constants, lstat, mkdir, readFile, readdir, readlink, realpath, rename, rm, stat, unlink } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { loadProblems, parseSkill } from './discovery.ts';
import { configRoot, harnesses, writeRoot } from './harnesses.ts';
import { changedWhileSyncing, clearStaleStages, copyTree, errorCode, finishCopy, itemKey, landingOf, notCopied, placeCopy, readTree, removeTree, storeDirectory, writeDurably, type ShareContext, type Tree } from './share.ts';
import type { HarnessId, Skill } from './types.ts';
import { toolName } from './words.ts';

/** Where a tool keeps its own skills: the folder Central Knot writes copies into. */
export const rootOf = (context: ShareContext, tool: HarnessId) => writeRoot(harnesses[tool], context.home, context.overrides?.[tool]);
/** The other skills folders a tool reads besides its own (the shared ~/.agents/skills; for OpenCode, Claude Code's too). */
export const alsoReads = (context: ShareContext, tool: HarnessId) =>
  harnesses[tool].skillRoots(configRoot(harnesses[tool], context.home, context.overrides?.[tool]), context.home).slice(1);
/** The shared skills folder several tools read (Copilot, Codex, Pi, OpenCode), and other apps too. Central Knot never writes it. */
export const sharedFolder = (context: ShareContext) => join(context.home, '.agents/skills');

/**
 * Why a tool's own skills folder can't be written, if it can't: one that is a link, or the same folder as another tool's or
 * the shared one, is never written through, since a copy there would land in a folder Central Knot doesn't own.
 */
export async function rootProblem(context: ShareContext, tool: HarnessId): Promise<string | undefined> {
  const root = rootOf(context, tool), name = toolName(tool);
  try { if ((await lstat(root)).isSymbolicLink()) return `${name}’s skills folder is a link${await readlink(root).then(target => ` to ${target}`, () => '')}, so Central Knot does not write through it.`; }
  catch (error) { if (errorCode(error) !== 'ENOENT') return `${name}’s skills folder could not be checked.`; }
  // A folder not made yet still lands somewhere: through a linked parent, or where another tool's folder is.
  const real = await landingOf(root);
  if (!real) return `${name}’s skills folder could not be checked.`;
  const others = [...(Object.keys(harnesses) as HarnessId[]).filter(other => other !== tool).map(other => rootOf(context, other)), sharedFolder(context)];
  for (const other of others) if (await landingOf(other) === real) return `${name}’s skills folder is the same folder as ${other}, so Central Knot does not write there.`;
  return undefined;
}

/** Why a tool's own skills folder can't be written now, if it is there and can't: no copy in it can be written or removed. */
export async function lockedRoot(context: ShareContext, tool: HarnessId): Promise<string | undefined> {
  const root = rootOf(context, tool);
  const there = await stat(root).then(info => info.isDirectory(), () => false);
  if (!there || await access(root, constants.W_OK).then(() => true, () => false)) return undefined;
  return `${toolName(tool)}’s skills folder can’t be written, so Central Knot can’t change the skill there. Once the folder’s permissions let it, ${toolName(tool)} catches up when sync runs.`;
}

// ---------- Reading ----------

/** One copy of a skill: a real folder in a skills folder, its content's hash and time (library.ts HarnessCopy), and its SKILL.md. */
export interface SkillCopy {
  tool: HarnessId;
  /** The folder's name, which the item takes, and its key (share.ts itemKey). */
  name: string; key: string;
  hash: string;
  /** The latest change among the folder and what is in it (ms): folderTime. */
  at: number;
  directory: string;
  /** Its SKILL.md as each tool reads it (discovery.ts), for whether a tool would load it (share.ts targetFor) and for the page. */
  skill: Skill;
}

/** A skills folder as read: its copies, its links (each read as the copy it leads to, if it leads to one), and what can't be seen. */
export interface FolderRead {
  copies: SkillCopy[];
  links: { key: string; name: string; path: string; linkTo: string; copy?: SkillCopy }[];
  /** A link that leads nowhere, by key: where it led. A copy written there replaces it. */
  broken: Map<string, string>;
  /** Why a folder by that key can't be read as a copy for sure, by key; `*`: the whole skills folder. */
  unseen: Map<string, string>;
  /** Of those, the ones with a skill's SKILL.md that can't be copied as they are (a link inside, a file it can't read): rows of their own. */
  uncopied: Set<string>;
}

/** The latest change time (ms) among a folder and everything in it, Finder's and editors' leftovers and a nested .git left out. */
export async function folderTime(directory: string): Promise<number> {
  let latest = (await stat(directory)).mtimeMs;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || notCopied(entry.name, entry.isFile())) continue;
    const path = join(directory, entry.name);
    latest = Math.max(latest, entry.isDirectory() ? await folderTime(path) : (await lstat(path)).mtimeMs);
  }
  return latest;
}

/** Reads one folder as a copy, or why it can't be one for sure. `rootLabel` names the folder it is in, as the page shows it. */
export async function readCopy(tool: HarnessId, directory: string, rootLabel: string): Promise<SkillCopy | { unseen: string; isSkill?: true }> {
  const name = directory.split(sep).at(-1)!, where = `${toolName(tool)}’s copy`;
  try {
    const file = join(directory, 'SKILL.md'), info = await lstat(file).catch(() => undefined);
    if (!info) return { unseen: `${where} has no SKILL.md, so it is no skill just now. Nothing changes there until it has one.` };
    if (!info.isFile()) return { unseen: `${where}’s SKILL.md is not a plain file, so Central Knot leaves it as it is.` };
    const content = await readFile(file, 'utf8');
    let parsed;
    try { parsed = parseSkill(content, name); }
    catch (error) { return { unseen: `${where}’s SKILL.md can’t be read as a skill (${error instanceof Error ? error.message : 'its frontmatter'}). Nothing changes there until it can.` }; }
    const tree = await readTree(directory);
    if (tree.held) return { unseen: `${where} can’t be copied as it is: ${tree.held}`, isSkill: true };
    const real = await realpath(directory);
    const skill: Skill = { folder: name, ...parsed, path: file, directory, realDirectory: real, rootLabel, content, status: '', ...loadProblems(content, name) };
    return { tool, name, key: itemKey(name), hash: tree.hash, at: await folderTime(directory), directory, skill };
  } catch (error) {
    return { unseen: `${where} is there but could not be read${errorCode(error) === 'EACCES' ? ' (permission denied)' : ''}. Nothing changes there until it reads again.` };
  }
}

/**
 * Reads one skills folder as `tool` reads it: each entry a tool would load (no dot-folder where it skips them, no name it
 * reserves). Two entries whose names differ only by case (a case-sensitive disk) can't be told apart, so both are unseen.
 */
export async function readSkillsFolder(tool: HarnessId, folder: string, rootLabel: string): Promise<FolderRead> {
  const read: FolderRead = { copies: [], links: [], broken: new Map(), unseen: new Map(), uncopied: new Set() };
  let entries;
  try { entries = await readdir(folder, { withFileTypes: true }); }
  catch (error) {
    if (errorCode(error) !== 'ENOENT') read.unseen.set('*', `${toolName(tool)}’s skills folder ${folder} is there but could not be read. Nothing changes there until it reads again.`);
    return read;
  }
  const definition = harnesses[tool], seen = new Set<string>();
  for (const entry of entries.sort((first, second) => first.name.localeCompare(second.name))) {
    if ((entry.name.startsWith('.') && !definition.loadsDotFolders) || definition.reservedSkills.includes(entry.name)) continue;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const key = itemKey(entry.name), path = join(folder, entry.name);
    if (seen.has(key)) { read.unseen.set(key, `Two folders whose names differ only by case are in ${toolName(tool)}’s skills folder. Rename one so Central Knot can tell them apart.`); continue; }
    seen.add(key);
    if (entry.isSymbolicLink()) {
      const linkTo = await readlink(path).catch(() => '');
      const leads = await stat(path).then(info => info.isDirectory(), () => undefined);
      if (leads === undefined) { read.broken.set(key, linkTo); continue; }
      if (!leads) continue;
      const copy = await readCopy(tool, path, rootLabel);
      read.links.push({ key, name: entry.name, path, linkTo, ...('unseen' in copy ? {} : { copy }) });
      continue;
    }
    const copy = await readCopy(tool, path, rootLabel);
    if ('unseen' in copy) { read.unseen.set(key, copy.unseen); if (copy.isSkill) read.uncopied.add(key); } else read.copies.push(copy);
  }
  return read;
}

// ---------- Writing and removing ----------

/** Beside a skills folder, on the same volume, where nothing loads as a skill (Claude Code lists dot-folders inside its own). */
async function besideRoot(context: ShareContext, root: string): Promise<string> {
  const beside = await realpath(root).then(dirname, () => dirname(root));
  if (await access(beside, constants.W_OK).then(() => true, () => false)) return beside;
  const fallback = join(storeDirectory(context.home), 'staging');
  await mkdir(fallback, { recursive: true });
  return fallback;
}

/** A folder moved aside while a write or removal is under way, and the note beside it that says where it goes back. */
const PARKED = /^\.ck-parked-[0-9a-f-]{36}$/;
async function park(context: ShareContext, directory: string): Promise<{ parked: string; note: string }> {
  const parked = join(await besideRoot(context, dirname(directory)), `.ck-parked-${randomUUID()}`), note = `${parked}.json`;
  await writeDurably(note, JSON.stringify({ target: directory }));
  await rename(directory, parked);
  return { parked, note };
}
const done = (note: string) => rm(note, { force: true });

/** Where a folder's content is now, or none when it is gone or unreadable (a check, never a throw). */
const hashOf = (directory: string) => readTree(directory).then(tree => (tree.held ? undefined : tree.hash), () => undefined);

/**
 * Writes `source`'s folder over the copy at `target`, only while that copy still holds `expected`: the new one is staged and
 * checked, the copy is moved aside and checked there (an edit saved meanwhile is put back, CK_CHANGED), then the new one is put
 * in its place. A crash in between leaves the copy moved aside with its note, which recoverFolders puts back.
 */
export async function swapFolder(context: ShareContext, source: string, target: string, expected: string): Promise<void> {
  if ((await lstat(target)).isSymbolicLink()) throw Object.assign(new Error('That copy is a link.'), { code: 'CK_LINK' });
  if (await hashOf(target) !== expected) throw changedWhileSyncing();
  const tree = await readTree(source);
  const stage = join(await besideRoot(context, dirname(target)), `.ck-stage-${randomUUID()}`);
  await copyTree(source, stage, tree);
  try {
    if (await hashOf(stage) !== tree.hash) throw new Error('The staged copy did not match its source.');
    context.fault?.('before-rename');
    const { parked, note } = await park(context, target);
    if (await hashOf(parked) !== expected) { await rename(parked, target); await done(note); throw changedWhileSyncing(); }
    context.fault?.('mid-replace');
    try { await rename(stage, target); }
    catch (error) { await rename(parked, target).catch(() => undefined); await done(note); throw error; }
    await finishCopy(source, target);
    await removeTree(parked).catch(() => undefined);
    await done(note);
  } finally { await removeTree(stage).catch(() => undefined); }
}

/** Puts `source`'s folder at `target`, where nothing is (a link there that leads nowhere is removed first: it holds nothing). */
export async function placeFolder(context: ShareContext, tool: HarnessId, source: string, target: string, tree: Tree): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const broken = await lstat(target).then(info => info.isSymbolicLink(), () => false) && await stat(target).then(() => false, () => true);
  if (broken) await unlink(target);
  await placeCopy(context, source, { harness: tool, directory: target, limits: [] }, tree);
}

/**
 * Removes the copy at `directory` only while it still holds `expected`: it is moved aside and checked there, so an edit saved
 * meanwhile is put back untouched (CK_CHANGED). A crash in between leaves it moved aside with its note (recoverFolders).
 */
export async function removeFolder(context: ShareContext, directory: string, expected: string): Promise<void> {
  context.fault?.('before-remove');
  if ((await lstat(directory)).isSymbolicLink()) throw Object.assign(new Error('That copy is a link.'), { code: 'CK_LINK' });
  if (await hashOf(directory) !== expected) throw changedWhileSyncing();
  const { parked, note } = await park(context, directory);
  if (await hashOf(parked) !== expected) { await rename(parked, directory); await done(note); throw changedWhileSyncing(); }
  await removeTree(parked);
  await done(note);
}

/**
 * Finishes what a crash interrupted beside a tool's skills folder: a copy moved aside (`.ck-parked-*`) goes back where its
 * note says, if nothing is there; if something is (the write landed), it goes, since its content was kept before the write.
 * Stray staged folders go too. Only names Central Knot makes are touched.
 */
export async function recoverFolders(context: ShareContext, tool: HarnessId): Promise<void> {
  const root = rootOf(context, tool);
  const beside = [await realpath(root).then(dirname, () => dirname(root)), join(storeDirectory(context.home), 'staging')];
  for (const folder of new Set(beside)) {
    for (const name of (await readdir(folder).catch(() => [] as string[])).filter(entry => PARKED.test(entry))) {
      const parked = join(folder, name), note = `${parked}.json`;
      const target = await readFile(note, 'utf8').then(text => JSON.parse(text).target as string, () => undefined);
      if (!target || relative(root, target).startsWith('..')) continue;
      if (await lstat(target).then(() => true, () => false)) await removeTree(parked).catch(() => undefined);
      else await rename(parked, target).catch(() => undefined);
      await done(note);
    }
  }
  await clearStaleStages(context, [root]);
}
