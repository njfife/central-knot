// Sources: a Git link the person gave, which skills are read from and which is never written. The model's table for it is
// library.ts's header (A SOURCE: fromSource); the pass carries it out in one step before its clicks (librarypass.ts
// fromSourceStep), through the skills' kind (skills.ts applySkills). This module owns what is around that step, in main:
// - each source's last whole read, kept with its record (sourcestore.ts: SourceRecord, and where things are kept), from which
//   the page's view and Add on one name are read without the network;
// - a link read (sourcelink.ts readLink; a branch with a slash is split by the repository's own branches and tags: refsOf) and
//   fetched (plugins.ts copySource: the shallow copy marketplaces get, this computer's git and its sign-in, nothing asked or kept);
// - what is at the link, from its files alone (holdsAt): a plugin or a marketplace (named and left for a later version), else a
//   SKILL.md in the link's own folder (one skill), else each folder inside it with one, else skills/<folder>/; each skill is its
//   whole folder, byte for byte, without the repository's .git, named as its SKILL.md names it;
// - the clicks: Look (previewSource: what Add would do, name by name, before anything is kept), Add, Check now, Add on one name
//   the library holds deleted (bringBack) and Remove; and the Sources page's view (sourcesView).
// Kept elsewhere: the page (sourcespage.ts); the words of a source's History entries (historyactions.ts) and of its versions
// (library.ts originWords). Only skills come from a source in this version: other files there are named (`later`), not read.
//
// A fetch can take a while, so it runs outside the queue main.ts keeps for every change: Look writes only its own folder
// (sources/.look-<token>); Check now fetches into a stage of its own and only in its turn (`turn`) swaps it in for the source's
// copy and runs the pass, so a source removed meanwhile, or another check, never meets a half-swapped copy.
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { inside } from './catalogdetail.ts';
import { parseSkill } from './discovery.ts';
import { connectedRepoAddress } from './gitrepo.ts';
import { fromSource, itemKey, linkedTo, type LibraryItem } from './library.ts';
import type { SourceRead } from './librarypass.ts';
import { plural } from './model.ts';
import { copySource, gitFailure, runGit, sameSource } from './plugins.ts';
import { exists, readTree, removeTree, writeAccess, writeDurably, type ShareContext } from './share.ts';
import { applySkills, skillKind } from './skills.ts';
import type { SkillContent } from './skillstore.ts';
import { copyOf, lookOf, readSources, saveSources, sourcesFolder, stageOf, type SourceRecord } from './sourcestore.ts';
import { linkLabel, readLink, splitRef } from './sourcelink.ts';
import type { HarnessId, SourceFound, SourceHolds, SourceName, SourcePreview, SourceResult, SourcesView, SourceView } from './types.ts';

/** A link as resolved: what a source records of where it reads. */
type Resolved = Pick<SourceRecord, 'link' | 'repository' | 'ref' | 'folder'>;
/** The source a link resolves to already, if one does: one repository however it is spelt, one branch, one folder. */
const twinOf = (sources: SourceRecord[], where: Resolved) =>
  sources.find(source => sameSource(source.repository, where.repository) && source.ref === where.ref && source.folder === where.folder);

// ---------- What is at a link ----------

/** One skill at a link, read from its folder (`folder`, from the repository's root): what the pass takes in, or why it can't be used. */
type SkillThere = { folder: string; folderName: string; key: string; name: string; files: string[]; hash: string; directory: string }
  | { folder: string; folderName: string; key: string; name?: string; files: string[]; unusable: string };
interface Holds { holds: SourceHolds; skills: SkillThere[]; later: string[] }

const present = (path: string) => lstat(path).then(() => true, () => false);
const isFolder = (path: string) => lstat(path).then(info => info.isDirectory(), () => false);
/** The folders in `folder` (none hidden, none a link) that hold a SKILL.md, from the repository's root. */
async function withSkill(root: string, folder: string): Promise<string[]> {
  const names = (await readdir(join(root, folder), { withFileTypes: true }).catch(() => [])).filter(entry => entry.isDirectory() && !entry.name.startsWith('.'));
  const found: string[] = [];
  for (const entry of names.sort((first, second) => first.name.localeCompare(second.name))) if (await present(join(root, folder, entry.name, 'SKILL.md'))) found.push(join(folder, entry.name));
  return found;
}

/**
 * What is at the link's `folder` in a copy (`root`), from its files alone, in the order the brief's recogniser asks: no folder
 * there (`missing`); a marketplace's or a plugin's own files (named, nothing read); else one skill, the folders inside with a
 * SKILL.md, or skills/<folder>/; else no skill (`empty`). `rootName` names a skill at the repository's root that its SKILL.md
 * doesn't name. Two skills with one name are neither used. `later`: what else is there that this version doesn't read.
 */
async function holdsAt(root: string, folder: string, rootName: string): Promise<Holds> {
  const at = join(root, folder);
  if (!(await isFolder(at)) || !(await inside(root, at))) return { holds: 'missing', skills: [], later: [] };
  const later = await laterThere(at);
  if (await present(join(at, '.claude-plugin/marketplace.json')) || await present(join(at, '.agents/plugins/marketplace.json'))) return { holds: 'marketplace', skills: [], later };
  if (await present(join(at, '.claude-plugin')) || await present(join(at, '.codex-plugin'))) return { holds: 'plugin', skills: [], later };
  const folders = await present(join(at, 'SKILL.md')) ? [folder] : (await withSkill(root, folder)).length ? await withSkill(root, folder) : await withSkill(root, join(folder, 'skills'));
  if (!folders.length) return { holds: 'empty', skills: [], later };
  const skills = await Promise.all(folders.map(each => skillAt(root, each, each === '' ? rootName : basename(each))));
  const twice = new Set(skills.map(skill => skill.key).filter((key, index, keys) => keys.indexOf(key) !== index));
  return { holds: 'skills', later, skills: skills.map(skill => (twice.has(skill.key) ? { ...skill, files: skill.files, unusable: `two skills here are named ${skill.name}, so neither is brought in` } : skill)) };
}

/** A name a skill's folder can take in every tool: no separator, not hidden, not too long. */
const usableName = (name: string) => !!name && name.length <= 200 && !/[/\\:\0]/.test(name) && !name.startsWith('.');

/** One skill's folder at a link: its name (its SKILL.md's, else its folder's, `folderName`), its files and its content, or why it can't be used. */
async function skillAt(root: string, folder: string, folderName: string): Promise<SkillThere> {
  const directory = join(root, folder), file = join(directory, 'SKILL.md');
  const unusable = (why: string, name?: string): SkillThere => ({ folder, folderName, key: itemKey(name ?? folderName), ...(name ? { name } : {}), files: [], unusable: why });
  if (!(await lstat(file).then(info => info.isFile(), () => false))) return unusable('its SKILL.md is not a plain file');
  let name: string;
  try { name = parseSkill(await readFile(file, 'utf8'), folderName).name.trim(); }
  catch (error) { return unusable(`its SKILL.md can’t be read as a skill (${error instanceof Error ? error.message.replace(/\.$/, '') : 'its frontmatter'})`); }
  if (!usableName(name)) return unusable(`its name “${name}” can’t be a folder’s name`, name);
  const tree = await readTree(directory);
  if (tree.held) return unusable(`it can’t be copied as it is: ${tree.held.split('. ')[0].replace(/^It /, 'it ')}`, name);
  return { folder, folderName, key: itemKey(name), name, files: [...tree.files.keys()].sort(), hash: tree.hash, directory };
}

/** What else a link's folder holds that this version doesn't read, in words. */
async function laterThere(at: string): Promise<string[]> {
  const later: string[] = [];
  const agents = (await readdir(join(at, 'agents')).catch(() => [] as string[])).filter(name => name.endsWith('.md'));
  if (agents.length) later.push(`${plural(agents.length, 'agent file')}: agents come in a later version`);
  if (await present(join(at, '.mcp.json')) || (await readdir(join(at, 'mcp')).catch(() => [] as string[])).some(name => name.endsWith('.json'))) later.push('MCP servers: they come in a later version');
  if (await present(join(at, 'instructions/base.md'))) later.push('base instructions: they come only from your own Git repo, by Pull');
  return later;
}

/** Why a read of a link brings nothing in (none when it holds a skill that can be used): Add says it before, Check now after. */
function cannotRead(found: Holds, where: Resolved): string | undefined {
  const folder = where.folder ? `the folder ${where.folder}` : 'its root';
  if (found.holds === 'missing') return `The repository has no ${where.folder ? `folder ${where.folder}` : 'files'} on ${where.ref}: moved or deleted there. Nothing changes until it is back.`;
  if (found.holds === 'plugin') return 'The link holds a plugin (a .claude-plugin or .codex-plugin folder). Plugins from a link come in a later version; nothing here is read.';
  if (found.holds === 'marketplace') return 'The link holds a marketplace. Add it on the Plugins page; plugins from a link come in a later version, so nothing here is read.';
  if (found.holds === 'empty') return `No skill at ${folder}: no SKILL.md there, in a folder inside it, or in skills/.`;
  return found.skills.some(skill => !('unusable' in skill)) ? undefined : 'No skill there can be used: each one says why.';
}

/** What each skill at a source is to the library now (types.ts SourceNameState), by the source's table (library.ts fromSource). */
function namesOf(found: Holds, items: Record<string, LibraryItem>, sources: SourceRecord[], id = ''): SourceName[] {
  const recorded = new Set(sources.map(source => source.id));
  return found.skills.map((skill): SourceName => {
    const base = { key: skill.key, folder: skill.folder, folderName: skill.folderName, files: skill.files, ...(skill.name ? { name: skill.name } : {}) };
    if ('unusable' in skill) return { ...base, state: 'unusable', why: skill.unusable };
    const item = items[skill.key], linked = linkedTo(item, id, recorded);
    if (item && !item.deleted && linked === 'this') return { ...base, state: 'in', on: item.on };
    const answer = fromSource(item, { hash: skill.hash, at: '' }, linked);
    const other = answer === 'another' ? sources.find(source => source.id === item?.source)?.link : undefined;
    return { ...base, state: answer === 'make' || answer === 'link' || answer === 'differs' || answer === 'another' ? answer : 'deleted', ...(other ? { why: other } : {}) };
  });
}

/** A source's read as the pass is given it (librarypass.ts SourceRead): each skill by key, with its folder as its content. */
function readOf(source: SourceRecord, found: Holds, sources: SourceRecord[], bringBack?: ReadonlySet<string>): SourceRead<SkillContent> {
  const names: SourceRead<SkillContent>['names'] = new Map();
  for (const skill of found.skills) names.set(skill.key, 'unusable' in skill ? { unreadable: skill.unusable } : { name: skill.name, hash: skill.hash, content: { directory: skill.directory, hash: skill.hash } });
  return { id: source.id, link: source.link, at: source.commitAt, names, recorded: new Set(sources.map(each => each.id)), ...(bringBack ? { bringBack } : {}) };
}

/** The pass for one source's read: its step, then the items it names and the items linked to it brought into line (`only`). */
async function runSource(context: ShareContext, tools: HarnessId[], source: SourceRecord, sources: SourceRecord[], bringBack?: ReadonlySet<string>) {
  const found = await holdsAt(copyOf(context.home, source.id), source.folder, repoName(source.repository));
  const read = readOf(source, found, sources, bringBack);
  const { library } = await skillKind.open(context);
  const linked = Object.values(library.items).filter(item => item.source === source.id).map(item => item.key);
  return applySkills(context, tools, [], { source: read, only: new Set([...read.names.keys(), ...linked]) });
}

/** A repository's own name ("skill-deslop"), which names a skill at its root that its SKILL.md doesn't. */
const repoName = (repository: string) => basename(repository.replace(/\/+$/, '')).replace(/\.git$/, '') || 'skill';

// ---------- Fetching ----------

/** The repository's branches and tags, by name (to split a link's `/tree/` part: sourcelink.ts splitRef), or why it can't be read. */
async function refsOf(repository: string): Promise<string[] | { problem: string }> {
  const listed = await runGit(['ls-remote', '--heads', '--tags', '--quiet', '--', repository], 30_000);
  if (listed.code !== 0) return { problem: gitFailure(listed.code, listed.output, 'source').message };
  return listed.output.split('\n').map(line => line.split('\t')[1] ?? '').filter(ref => ref && !ref.endsWith('^{}')).map(ref => ref.replace(/^refs\/(heads|tags)\//, ''));
}

/** A link, read and resolved: refused when it is no link, is the Git repo Pull and Push use, or names a branch the repository hasn't. */
async function resolve(context: ShareContext, link: string): Promise<Resolved | { refused: string }> {
  const read = readLink(link);
  if ('refused' in read) return read;
  const repo = await connectedRepoAddress(context.home);
  if (repo && sameSource(repo, read.repository)) return { refused: 'That is the Git repo Pull and Push use here, so it can’t be a source too. A source is only ever read; that repo stays on the Git repo page.' };
  if (!read.rest) return { link: link.trim(), repository: read.repository, ref: '', folder: '' };
  const refs = await refsOf(read.repository);
  if ('problem' in refs) return { refused: refs.problem };
  const split = splitRef(read.rest, refs);
  return split ? { link: link.trim(), repository: read.repository, ...split } : { refused: `The repository has no branch or tag named ${read.rest[0]}, or by any longer name this link starts with.` };
}

/** Fetches a source into `target` (made whole or not at all), and reads its head: the commit, its time, and the branch it is on. */
async function fetchInto(where: Resolved, target: string): Promise<{ commit: string; commitAt: string; ref: string } | { problem: string }> {
  await mkdir(join(target, '..'), { recursive: true });
  const problem = await copySource(where.repository, target, where.ref || undefined);
  if (problem) return { problem };
  const log = await runGit(['-C', target, 'log', '-1', '--format=%H%x00%cI'], 15_000);
  const [commit, at] = log.code === 0 ? log.output.split('\0') : [];
  if (!commit || !at) { await removeTree(target); return { problem: 'The repository has no commit to read on that branch yet.' }; }
  const branch = where.ref ? undefined : await runGit(['-C', target, 'symbolic-ref', '--quiet', '--short', 'HEAD'], 15_000);
  return { commit, commitAt: new Date(at).toISOString(), ref: where.ref || (branch?.code === 0 && branch.output) || 'HEAD' };
}

// ---------- The clicks ----------

/**
 * Look: reads a link and says what Add would do with each skill there, by the source's table, and what it won't bring in and
 * why; nothing is kept but the look's own copy, which Add takes (`token`) and the next look drops.
 */
export async function previewSource(context: ShareContext, link: string): Promise<SourcePreview> {
  const refuse = (refused: string): SourcePreview => ({ refused, link });
  const access = await writeAccess(context);
  if (!access.allowed) return refuse(access.reason);
  const { sources, problem } = await readSources(context.home);
  if (problem) return refuse(problem);
  const where = await resolve(context, link);
  if ('refused' in where) return refuse(where.refused);
  await mkdir(sourcesFolder(context.home), { recursive: true });
  for (const name of await readdir(sourcesFolder(context.home))) if (name.startsWith('.look-')) await rm(join(sourcesFolder(context.home), name), { recursive: true, force: true });
  const token = randomUUID(), look = lookOf(context.home, token);
  const fetched = await fetchInto(where, look);
  if ('problem' in fetched) return refuse(fetched.problem);
  const resolved: Resolved & typeof fetched = { ...where, ...fetched };
  if (twinOf(sources, resolved)) { await removeTree(look); return refuse('That link is a source already: its row is below.'); }
  await writeDurably(`${look}.json`, JSON.stringify(resolved));
  const found = await holdsAt(look, resolved.folder, repoName(resolved.repository));
  const { library } = await skillKind.open(context);
  const refused = cannotRead(found, resolved);
  return { ...foundOf(resolved, found, namesOf(found, library.items, sources)), token, ...(refused ? { refused } : {}) };
}

const foundOf = (source: Resolved & Partial<Pick<SourceRecord, 'commit' | 'commitAt'>>, found: Holds, names: SourceName[]): SourceFound =>
  ({ link: source.link, repository: source.repository, ref: source.ref, folder: source.folder, commit: source.commit, commitAt: source.commitAt, holds: found.holds, names, later: found.later });

/** A click's answer: why it stopped, what the pass did, and the page's view after. */
async function answer(context: ShareContext, done: { stopped?: string; sourced?: SourceResult['sourced']; results?: SourceResult['results'] } = {}): Promise<SourceResult> {
  return { ...(done.stopped ? { stopped: done.stopped } : {}), ...(done.sourced ? { sourced: done.sourced } : {}), ...(done.results ? { results: done.results } : {}), view: await sourcesView(context) };
}

/** Add: the look `token` read becomes a source, recorded first, then carried out by the pass: each skill there comes in Off. */
export async function addSource(context: ShareContext, tools: HarnessId[], token: string): Promise<SourceResult> {
  const access = await writeAccess(context);
  if (!access.allowed) return answer(context, { stopped: access.reason });
  const look = /^[0-9a-f-]{36}$/.test(token) ? lookOf(context.home, token) : '';
  const where = look && await readFile(`${look}.json`, 'utf8').then(text => JSON.parse(text) as Resolved & { commit: string; commitAt: string }, () => undefined);
  if (!where || !(await exists(look))) return answer(context, { stopped: 'That look at the link is no longer kept. Look at it again.' });
  const { sources, problem } = await readSources(context.home);
  if (problem) return answer(context, { stopped: problem });
  if (twinOf(sources, where)) return answer(context, { stopped: 'That link is a source already: its row is below.' });
  const refused = cannotRead(await holdsAt(look, where.folder, repoName(where.repository)), where);
  if (refused) return answer(context, { stopped: refused });
  const now = new Date().toISOString();
  const source: SourceRecord = { id: randomUUID(), link: where.link, repository: where.repository, ref: where.ref, folder: where.folder, commit: where.commit, commitAt: where.commitAt, readAt: now, addedAt: now };
  await rename(look, copyOf(context.home, source.id));
  await rm(`${look}.json`, { force: true });
  await saveSources(context.home, [...sources, source]);
  return answer(context, await runSource(context, tools, source, [...sources, source]));
}

/**
 * Check now: the source read again, then its table carried out by the pass. The fetch runs now, outside the queue; the rest in
 * the queue's `turn`: a source removed meanwhile drops the fetch, one that can't be read keeps its last read and says why on its
 * row, and a whole read takes the place of the last one before the pass.
 */
export async function checkSource(context: ShareContext, toolsNow: () => Promise<HarnessId[]>, id: string, turn: <T>(work: () => Promise<T>) => Promise<T>): Promise<SourceResult> {
  const access = await writeAccess(context);
  if (!access.allowed) return answer(context, { stopped: access.reason });
  const before = (await readSources(context.home)).sources.find(source => source.id === id);
  if (!before) return answer(context, { stopped: 'That source is no longer recorded. Nothing was changed.' });
  const stage = stageOf(context.home, randomUUID());
  const fetched = await fetchInto(before, stage);
  return turn(async () => {
    const { sources, problem } = await readSources(context.home), source = sources.find(each => each.id === id);
    const drop = () => removeTree(stage);
    if (problem || !source) { await drop(); return answer(context, { stopped: problem ?? 'That source was removed meanwhile. Nothing was changed.' }); }
    const why = 'problem' in fetched ? fetched.problem : cannotRead(await holdsAt(stage, source.folder, repoName(source.repository)), source);
    if (why || 'problem' in fetched) {
      await drop();
      await saveSources(context.home, sources.map(each => (each.id === id ? { ...each, problem: why } : each)));
      return answer(context, { stopped: `Couldn’t read ${linkLabel(source.link)}. ${why}` });
    }
    await removeTree(copyOf(context.home, id));
    await rename(stage, copyOf(context.home, id));
    const read: SourceRecord = { ...source, commit: fetched.commit, commitAt: fetched.commitAt, readAt: new Date().toISOString() };
    delete read.problem;
    const now = sources.map(each => (each.id === id ? read : each));
    await saveSources(context.home, now);
    return answer(context, await runSource(context, await toolsNow(), read, now));
  });
}

/** Add on one name the library holds deleted, at a source's row: it comes back Off, from the source's last read (no fetch). */
export async function bringBack(context: ShareContext, tools: HarnessId[], id: string, key: string): Promise<SourceResult> {
  const access = await writeAccess(context);
  if (!access.allowed) return answer(context, { stopped: access.reason });
  const { sources, problem } = await readSources(context.home), source = sources.find(each => each.id === id);
  if (problem || !source) return answer(context, { stopped: problem ?? 'That source is no longer recorded. Nothing was changed.' });
  if (!(await exists(copyOf(context.home, id)))) return answer(context, { stopped: 'Its last read is no longer kept. Check it now first.' });
  return answer(context, await runSource(context, tools, source, sources, new Set([key])));
}

/** Remove: the source is forgotten, with its last read. Each item it brought stays as it is, On or Off, with its versions, no longer linked. */
export async function removeSource(context: ShareContext, id: string): Promise<SourceResult> {
  const access = await writeAccess(context);
  if (!access.allowed) return answer(context, { stopped: access.reason });
  const { sources, problem } = await readSources(context.home);
  if (problem) return answer(context, { stopped: problem });
  if (!sources.some(source => source.id === id)) return answer(context, { stopped: 'That source is no longer recorded. Nothing was changed.' });
  await saveSources(context.home, sources.filter(source => source.id !== id));
  await removeTree(copyOf(context.home, id));
  return answer(context);
}

// ---------- The page's view ----------

/**
 * The Sources page: each source with its last read, what each skill there is to the library now (namesOf), and the items linked
 * to it that its last read doesn't name (it wasn't read whole, or its copy is gone), each still in Central Knot.
 */
export async function sourcesView(context: ShareContext): Promise<SourcesView> {
  const access = await writeAccess(context);
  const { sources, problem } = await readSources(context.home);
  const { library } = await skillKind.open(context);
  const views = await Promise.all(sources.map(async (source): Promise<SourceView> => {
    const { id, addedAt, readAt } = source, copy = copyOf(context.home, id);
    const there = await exists(copy);
    const found = there ? await holdsAt(copy, source.folder, repoName(source.repository)) : { holds: 'missing' as const, skills: [], later: [] };
    const names = namesOf(found, library.items, sources, id);
    const unnamed = Object.values(library.items).filter(item => item.source === id && !item.deleted && !names.some(name => name.key === item.key))
      .map((item): SourceName => ({ key: item.key, name: item.name, folder: '', folderName: item.name, files: [], state: 'in', on: item.on }));
    return { ...foundOf(source, found, [...names, ...unnamed]), id, addedAt, readAt, ...(source.problem ? { problem: source.problem } : {}), ...(there ? {} : { copyGone: true as const }) };
  }));
  return { sources: views, access, ...(problem ? { problem } : {}) };
}
