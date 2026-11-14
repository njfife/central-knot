// Sources: a Git link the person gave, which skills are read from and which is never written. The model's table for it is
// library.ts's header (A SOURCE: sourceAnswers and fromSource); the pass carries it out in one step before its clicks
// (librarypass.ts fromSourceStep), through the skills' kind (skills.ts applySkills). This module owns what is around that step:
// - what was read at a source, decided in one place (readOf): each skill there and whether the source was read whole, from
//   what is at the link (holdsAt), by its files alone: a plugin or a marketplace (named and left for a later version), else a
//   SKILL.md in the link's own folder (one skill), else each folder inside it with one, else skills/<folder>/. Each skill is
//   its whole folder, byte for byte, without the repository's .git, named as its SKILL.md names it;
// - a link resolved (sourcelink.ts readLink; its branch, named or the default one, found among the repository's own: refsOf),
//   and fetched (plugins.ts copySource: the shallow copy marketplaces get, this computer's git and its sign-in, nothing asked
//   or kept); each source's last read is kept with its record (sourcestore.ts);
// - the clicks: Look (previewSource: what Add would do, name by name, before anything is kept), Add, Check now, Add on one name
//   the library holds deleted (bringBack) and Remove; and the Sources page's view (sourcesView).
// Kept elsewhere: the page (sourcespage.ts); the words of a source's History entries (historyactions.ts) and of its versions
// (library.ts originWords); the Git repo's refusal of a source (gitrepo.ts connectRepo, through sourcestore.ts sourceAt), as
// a source refuses that repo here (resolve). Only skills come from a source in this version: other files there are named
// (`later`), not read. A skill there that can't be read is "unreadable", with why, and is never taken to be gone.
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
import { itemKey, linkedSource, sourceAnswers, type LibraryItem } from './library.ts';
import type { SourceRead } from './librarypass.ts';
import { plural } from './model.ts';
import { copySource, gitFailure, runGit, sameSource } from './plugins.ts';
import { exists, readTree, removeTree, writeAccess, writeDurably, type ShareContext } from './share.ts';
import { applySkills, skillKind } from './skills.ts';
import type { SkillContent } from './skillstore.ts';
import { copyOf, lookOf, readSources, saveSources, sourcesFolder, stageOf, type SourceRecord } from './sourcestore.ts';
import { linkLabel, readLink, splitRef } from './sourcelink.ts';
import type { HarnessId, SourceFound, SourceHolds, SourceName, SourcePreview, SourceResult, SourcesView, SourceView } from './types.ts';

/** A link as resolved before it is fetched: what a source records of where it reads (its `ref` always a branch or tag's name). */
type Resolved = Pick<SourceRecord, 'link' | 'repository' | 'ref' | 'folder'>;
/** The source a link resolves to already, if one does: one repository however it is spelt, one branch, one folder. */
const twinOf = (sources: SourceRecord[], where: Resolved) =>
  sources.find(source => sameSource(source.repository, where.repository) && source.ref === where.ref && source.folder === where.folder);
/** The ids of the sources the home records: the set library.ts linkedTo reads links against. */
const recordedOf = (sources: SourceRecord[]) => new Set(sources.map(source => source.id));

// ---------- What is at a link ----------

/** One skill at a link, read from its folder (`folder`, from the repository's root): its content, or why it is unreadable. */
type SkillThere = { folder: string; folderName: string; key: string; name: string; files: string[]; hash: string; directory: string }
  | { folder: string; folderName: string; key: string; name?: string; files: string[]; unreadable: string };
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
 * doesn't name. Two skills with one name are both unreadable. `later`: what else is there that this version doesn't read.
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
  return { holds: 'skills', later, skills: skills.map(skill => (twice.has(skill.key) ? { ...skill, unreadable: `two skills here are named ${skill.name}, so neither is brought in` } : skill)) };
}

/** A name a skill's folder can take in every tool: no separator, not hidden, not too long. */
const usableName = (name: string) => !!name && name.length <= 200 && !/[/\\:\0]/.test(name) && !name.startsWith('.');

/** One skill's folder at a link: its name (its SKILL.md's, else its folder's, `folderName`), its files and its content, or why it is unreadable. */
async function skillAt(root: string, folder: string, folderName: string): Promise<SkillThere> {
  const directory = join(root, folder), file = join(directory, 'SKILL.md');
  const unreadable = (why: string, name?: string): SkillThere => ({ folder, folderName, key: itemKey(name ?? folderName), ...(name ? { name } : {}), files: [], unreadable: why });
  if (!(await lstat(file).then(info => info.isFile(), () => false))) return unreadable('its SKILL.md is not a plain file');
  let name: string;
  try { name = parseSkill(await readFile(file, 'utf8'), folderName).name.trim(); }
  catch (error) { return unreadable(`its SKILL.md can’t be read as a skill (${error instanceof Error ? error.message.replace(/\.$/, '') : 'its frontmatter'})`); }
  if (!usableName(name)) return unreadable(`its name “${name}” can’t be a folder’s name`, name);
  const tree = await readTree(directory);
  if (tree.held) return unreadable(`it can’t be copied as it is: ${tree.held.split('. ')[0].replace(/^It /, 'it ')}`, name);
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

/** Why a read of a link holds no skill that can be read, in words, each unreadable skill's reason with it; none when it holds one. Look refuses Add for it. */
function noSkillWhy(found: Holds, where: Resolved): string | undefined {
  if (found.holds === 'missing') return `The repository has no ${where.folder ? `folder ${where.folder}` : 'files'} on ${where.ref}: moved or deleted there.`;
  if (found.holds === 'plugin') return 'The link holds a plugin (a .claude-plugin or .codex-plugin folder). Plugins from a link come in a later version; nothing here is read.';
  if (found.holds === 'marketplace') return 'The link holds a marketplace. Add it on the Plugins page; plugins from a link come in a later version, so nothing here is read.';
  if (found.holds === 'empty') return `No skill at ${where.folder ? `the folder ${where.folder}` : 'its root'}: no SKILL.md there, in a folder inside it, or in skills/.`;
  const unread = found.skills.flatMap(skill => ('unreadable' in skill ? [`${skill.name ?? skill.folderName}: ${skill.unreadable}`] : []));
  return unread.length < found.skills.length ? undefined : `No skill there can be read. ${unread.join('. ')}.`;
}

/**
 * Why a read is not whole (library.ts A SOURCE: no name is gone, nothing turns Off), in words; none when it is whole. The one
 * place that decides it: there is no skill there that can be read (noSkillWhy), or some skill there is unreadable.
 */
function notWholeWhy(found: Holds, where: Resolved): string | undefined {
  const unread = found.skills.filter(skill => 'unreadable' in skill).length;
  return noSkillWhy(found, where) ?? (unread ? `${plural(unread, 'skill')} here can’t be read, so no skill is taken to be gone from it this time.` : undefined);
}

/**
 * What was read at a source, as the pass and the table are given it (the one place that decides it): each skill by key, with
 * its folder as its content or why it is unreadable, and whether the source was read whole (notWholeWhy).
 */
function readOf(source: SourceRecord, found: Holds, sources: SourceRecord[], bringBack?: ReadonlySet<string>): SourceRead<SkillContent> {
  const names: SourceRead<SkillContent>['names'] = new Map();
  for (const skill of found.skills) names.set(skill.key, 'unreadable' in skill ? { unreadable: skill.unreadable } : { name: skill.name, hash: skill.hash, content: { directory: skill.directory, hash: skill.hash } });
  return { id: source.id, link: source.link, commitAt: source.commitAt, whole: !notWholeWhy(found, source), names, recorded: recordedOf(sources), ...(bringBack ? { bringBack } : {}) };
}

/**
 * What each skill at a source, and each item linked to it, is to the library now: the table's own answer for it (library.ts
 * sourceAnswers, on the read as readOf gives it), or `unreadable` with why. The Sources page words each one.
 */
function namesOf(found: Holds, read: SourceRead<SkillContent>, items: Record<string, LibraryItem>, sources: SourceRecord[]): SourceName[] {
  return [...sourceAnswers(items, read, read.recorded)].map(([key, answer]): SourceName => {
    const skill = found.skills.find(each => each.key === key), item = items[key];
    const base = { key, ...(skill?.name ?? item?.name ? { name: skill?.name ?? item?.name } : {}), ...(skill ? { there: { folder: skill.folder, folderName: skill.folderName, files: skill.files } } : {}) };
    if (skill && 'unreadable' in skill) return { ...base, state: 'unreadable', why: skill.unreadable };
    const other = answer === 'another' ? sources.find(source => source.id === linkedSource(item, read.recorded))?.link : undefined;
    return { ...base, state: answer, ...(item && !item.deleted ? { on: item.on } : {}), ...(other ? { why: other } : {}) };
  });
}

/** The pass for one source's read: its step, which also decides the pass's scope (librarypass.ts fromSourceStep). */
async function runSource(context: ShareContext, tools: HarnessId[], source: SourceRecord, sources: SourceRecord[], bringBack?: ReadonlySet<string>) {
  const found = await holdsAt(copyOf(context.home, source.id), source.folder, repoName(source.repository));
  return { ...(await applySkills(context, tools, [], { source: readOf(source, found, sources, bringBack) })), notWhole: notWholeWhy(found, source) };
}

/** A repository's own name ("skill-deslop"), which names a skill at its root that its SKILL.md doesn't. */
const repoName = (repository: string) => basename(repository.replace(/\/+$/, '')).replace(/\.git$/, '') || 'skill';

// ---------- Fetching ----------

/**
 * The repository's branches and tags by name (to split a link's `/tree/` part: sourcelink.ts splitRef), and the branch its
 * default (HEAD) names, if it names one; or why it can't be read.
 */
async function refsOf(repository: string): Promise<{ refs: string[]; head?: string } | { problem: string }> {
  const listed = await runGit(['ls-remote', '--symref', '--quiet', '--', repository, 'HEAD', 'refs/heads/*', 'refs/tags/*'], 30_000);
  if (listed.code !== 0) return { problem: gitFailure(listed.code, listed.output, 'source').message };
  const lines = listed.output.split('\n'), head = lines.find(line => line.startsWith('ref: refs/heads/') && line.endsWith('\tHEAD'));
  const refs = lines.map(line => line.split('\t')[1] ?? '').filter(ref => /^refs\/(heads|tags)\//.test(ref) && !ref.endsWith('^{}')).map(ref => ref.replace(/^refs\/(heads|tags)\//, ''));
  return { refs, ...(head ? { head: head.slice('ref: refs/heads/'.length, -'\tHEAD'.length) } : {}) };
}

/**
 * A link, read and resolved to a repository, a branch or tag (the one the link names, else the default branch's name) and a
 * folder. Refused when it is no link, is the Git repo Pull and Push use, names a branch the repository hasn't, or names none
 * and the repository says no default branch.
 */
async function resolve(context: ShareContext, link: string): Promise<Resolved | { refused: string }> {
  const read = readLink(link);
  if ('refused' in read) return read;
  const repo = await connectedRepoAddress(context.home);
  if (repo && sameSource(repo, read.repository)) return { refused: 'That is the Git repo Pull and Push use here, so it can’t be a source too. A source is only ever read; that repo stays on the Git repo page.' };
  const listed = await refsOf(read.repository);
  if ('problem' in listed) return { refused: listed.problem };
  if (!read.rest) return listed.head ? { link: link.trim(), repository: read.repository, ref: listed.head, folder: '' }
    : { refused: 'The repository doesn’t say which branch is its default. Paste a link to the branch (…/tree/<branch>).' };
  const split = splitRef(read.rest, listed.refs);
  return split ? { link: link.trim(), repository: read.repository, ...split } : { refused: `The repository has no branch or tag named ${read.rest[0]}, or by any longer name this link starts with.` };
}

/** Fetches a source's branch into `target` (made whole or not at all), and reads its head: the commit and its time. */
async function fetchInto(where: Resolved, target: string): Promise<{ commit: string; commitAt: string } | { problem: string }> {
  await mkdir(join(target, '..'), { recursive: true });
  const problem = await copySource(where.repository, target, where.ref);
  if (problem) return { problem };
  const log = await runGit(['-C', target, 'log', '-1', '--format=%H%x00%cI'], 15_000);
  const [commit, at] = log.code === 0 ? log.output.split('\0') : [];
  if (!commit || !at) { await removeTree(target); return { problem: 'The repository has no commit to read on that branch yet.' }; }
  return { commit, commitAt: new Date(at).toISOString() };
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
  if (twinOf(sources, where)) return refuse('That link is a source already: its row is below.');
  await mkdir(sourcesFolder(context.home), { recursive: true });
  for (const name of await readdir(sourcesFolder(context.home))) if (name.startsWith('.look-')) await rm(join(sourcesFolder(context.home), name), { recursive: true, force: true });
  const token = randomUUID(), look = lookOf(context.home, token);
  const fetched = await fetchInto(where, look);
  if ('problem' in fetched) return refuse(fetched.problem);
  const resolved = { ...where, ...fetched };
  await writeDurably(`${look}.json`, JSON.stringify(resolved));
  const found = await holdsAt(look, resolved.folder, repoName(resolved.repository));
  const { library } = await skillKind.open(context);
  // Read as Add will record it: a source of this look's own id, among those the home records.
  const read = readOf({ ...resolved, id: token, readAt: '', addedAt: '' }, found, sources);
  const refused = noSkillWhy(found, resolved);
  return { ...foundOf(resolved, found, namesOf(found, read, library.items, sources)), token, ...(refused ? { refused } : {}) };
}

const foundOf = (source: Resolved & Partial<Pick<SourceRecord, 'commit' | 'commitAt'>>, found: Holds, names: SourceName[]): SourceFound => {
  const unread = notWholeWhy(found, source);
  return { link: source.link, repository: source.repository, ref: source.ref, folder: source.folder, commit: source.commit, commitAt: source.commitAt, holds: found.holds, names, later: found.later, ...(unread ? { unread } : {}) };
};

/** A click's answer: why it stopped, what the pass did, why the source wasn't read whole, and the page's view after. */
async function answer(context: ShareContext, done: Omit<SourceResult, 'view'> = {}): Promise<SourceResult> {
  const { stopped, sourced, results, notWhole } = done;
  return { ...(stopped ? { stopped } : {}), ...(sourced ? { sourced } : {}), ...(results ? { results } : {}), ...(notWhole ? { notWhole } : {}), view: await sourcesView(context) };
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
  const refused = noSkillWhy(await holdsAt(look, where.folder, repoName(where.repository)), where);
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
 * the queue's `turn`: a source removed meanwhile drops the fetch; a fetch that failed keeps the last read and is said on the
 * source's row (`problem`); any read fetched takes the last one's place, whole or not, so its row says why it isn't.
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
    if (problem || !source) { await removeTree(stage); return answer(context, { stopped: problem ?? 'That source was removed meanwhile. Nothing was changed.' }); }
    if ('problem' in fetched) {
      await saveSources(context.home, sources.map(each => (each.id === id ? { ...each, problem: fetched.problem } : each)));
      return answer(context, { stopped: `Couldn’t read ${linkLabel(source.link)}. ${fetched.problem}` });
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
 * The Sources page: each source with its last read, why that read isn't whole if it isn't, what the table says of each skill
 * there and of each item linked to it (namesOf), and why the last Check now couldn't fetch it, if it couldn't.
 */
export async function sourcesView(context: ShareContext): Promise<SourcesView> {
  const access = await writeAccess(context);
  const { sources, problem } = await readSources(context.home);
  const { library } = await skillKind.open(context);
  const views = await Promise.all(sources.map(async (source): Promise<SourceView> => {
    const { id, addedAt, readAt } = source, copy = copyOf(context.home, id);
    const there = await exists(copy);
    const found = there ? await holdsAt(copy, source.folder, repoName(source.repository)) : { holds: 'missing' as const, skills: [], later: [] };
    const { unread, ...read } = foundOf(source, found, namesOf(found, readOf(source, found, sources), library.items, sources));
    // With no last read kept there is nothing to say of one: the row says the copy is gone instead.
    const kept = there ? (unread ? { unread } : {}) : { copyGone: true as const };
    return { ...read, id, addedAt, readAt, ...(source.problem ? { problem: source.problem } : {}), ...kept };
  }));
  return { sources: views, access, ...(problem ? { problem } : {}) };
}
