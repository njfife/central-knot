// Sources: a Git link the person gave, which skills are read from and which is never written. The model's table for it is
// library.ts's header (A SOURCE: sourceAnswers and fromSource; what counts as changed here: changedHere); the pass carries it
// out in one step before its clicks (librarypass.ts fromSourceStep), through the skills' kind (skills.ts applySkills). This
// module owns what is around that step:
// - what was read at a source, decided in one place (readOf): each skill there and whether the source was read whole, from
//   what is at the link (holdsAt), by its files alone: a plugin or a marketplace (named and left for a later version), else a
//   SKILL.md in the link's own folder (one skill), else each folder inside it with one, else skills/<folder>/. Each skill is
//   its whole folder, byte for byte, without the repository's .git, named as its SKILL.md names it;
// - a link resolved (sourcelink.ts readLink; its branch, named or the default one, found among the repository's own: refsOf),
//   and fetched (plugins.ts copySource: the shallow copy marketplaces get, this computer's git and its sign-in, nothing asked
//   or kept); each source's last read is kept with its record (sourcestore.ts);
// - the clicks: Look (previewSource: what Add would do, name by name, before anything is kept), Add, Check now, Add on one name
//   the library holds deleted (bringBack), Replace, Merge and Keep mine on one whose version waits (replaceFromSource,
//   mergeFromSource, keepFromSource) and Remove;
// - the check once a day (checkDue: the rhythm is here, main.ts only calls it on its schedule's turn, with Automatic sync on);
// - what the table says, as the page shows it: the Sources page's view (sourcesView) and each linked item's row on Skills
//   (sourceFacts, which skills.ts skillsView asks), both from the same answers the pass carries out, with the tools read now;
//   and each item a source removed (sourceFacts `removed`: library.ts removedBy), which both pages read from the Skills view.
// Kept elsewhere: the page (sourcespage.ts); the words of a source's History entries (historyactions.ts) and of its versions
// (library.ts originWords); the Git repo's refusal of a source (gitrepo.ts connectRepo, through sourcestore.ts sourceAt), as
// a source refuses that repo here (theGitRepo, at Look and at Add). Only skills come from a source in this version: nothing
// else there is read. A skill there that can't be read is "unreadable", with why, and is never taken to be gone.
//
// Each click's own refusals come first; then, where it writes, it enters the gate for library writes (share.ts libraryGate):
// Add and Check now before they write the record and run the pass (which enters it too), Remove for Central Knot's own file
// alone (`ownFile`); Look, which writes only its own folder, asks it for that; Add, Replace and Merge on a row write nothing
// themselves (their passes enter).
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
import { changedHere, itemKey, linkedSource, removedBy, sourceAnswers, type Copies, type LibraryItem } from './library.ts';
import { copiesOf, lookFor, type SourceRead } from './librarypass.ts';
import { copySource, gitFailure, runGit, sameSource } from './plugins.ts';
import { exists, libraryGate, readTree, removeTree, writeAccess, writeDurably, type ShareContext } from './share.ts';
import { applySkills, skillKind } from './skills.ts';
import type { SkillContent } from './skillstore.ts';
import { copyOf, lookOf, readSources, saveSources, sourcesFolder, stageOf, type SourceRecord } from './sourcestore.ts';
import { linkLabel, readLink, splitRef } from './sourcelink.ts';
import type { HarnessId, LibraryFacts, SourceFound, SourceHolds, SourceName, SourcePreview, SourceResult, SourcesView, SourceView } from './types.ts';

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
interface Holds { holds: SourceHolds; skills: SkillThere[] }

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
 * doesn't name. Two skills with one name are both unreadable.
 */
async function holdsAt(root: string, folder: string, rootName: string): Promise<Holds> {
  const at = join(root, folder);
  if (!(await isFolder(at)) || !(await inside(root, at))) return { holds: 'missing', skills: [] };
  if (await present(join(at, '.claude-plugin/marketplace.json')) || await present(join(at, '.agents/plugins/marketplace.json'))) return { holds: 'marketplace', skills: [] };
  if (await present(join(at, '.claude-plugin')) || await present(join(at, '.codex-plugin'))) return { holds: 'plugin', skills: [] };
  const folders = await present(join(at, 'SKILL.md')) ? [folder] : (await withSkill(root, folder)).length ? await withSkill(root, folder) : await withSkill(root, join(folder, 'skills'));
  if (!folders.length) return { holds: 'empty', skills: [] };
  const skills = await Promise.all(folders.map(each => skillAt(root, each, each === '' ? rootName : basename(each))));
  const twice = new Set(skills.map(skill => skill.key).filter((key, index, keys) => keys.indexOf(key) !== index));
  return { holds: 'skills', skills: skills.map(skill => (twice.has(skill.key) ? { ...skill, unreadable: `two skills here are named ${skill.name}, so neither is brought in` } : skill)) };
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

/**
 * Why a read of a link can't be read as skills, in words, none when it can: the link's folder isn't in the read (moved or
 * deleted there; or, for a source's row, no read of it is kept here), a plugin or a marketplace, or no SKILL.md. Look refuses
 * Add for it, and a source's row says it; a skill there that can't be read says why on its own line (namesOf).
 */
function notSkillsWhy(found: Holds, where: Resolved): string | undefined {
  if (found.holds === 'missing') return `Nothing at ${where.folder ? `the folder ${where.folder}` : 'its root'} on ${where.ref} to read: moved or deleted there, or not read here yet.`;
  if (found.holds === 'plugin') return 'The link holds a plugin (a .claude-plugin or .codex-plugin folder). Plugins from a link come in a later version; nothing here is read.';
  if (found.holds === 'marketplace') return 'The link holds a marketplace. Add it on the Plugins page; plugins from a link come in a later version, so nothing here is read.';
  if (found.holds === 'empty') return `No skill at ${where.folder ? `the folder ${where.folder}` : 'its root'}: no SKILL.md there, in a folder inside it, or in skills/.`;
  return undefined;
}
/** Whether a read holds a skill that can be read; Look refuses Add when it holds none, and says why (notSkillsWhy, or each skill's line). */
const readable = (found: Holds) => found.skills.some(skill => !('unreadable' in skill));
/** Why Look refuses Add: nothing there can be read as a skill. */
const noSkillWhy = (found: Holds, where: Resolved) => notSkillsWhy(found, where) ?? (readable(found) ? undefined : 'No skill there can be read: each one’s line says why.');

/**
 * What was read at a source, as the pass and the table are given it (the one place that decides it): each skill by key, with
 * its folder as its content or why it is unreadable, and whether the source was read whole: it holds skills, and every one
 * there can be read (library.ts A SOURCE).
 */
function readOf(source: SourceRecord, found: Holds, sources: SourceRecord[], clicked: RowClick = {}): SourceRead<SkillContent> {
  const names: SourceRead<SkillContent>['names'] = new Map();
  for (const skill of found.skills) names.set(skill.key, 'unreadable' in skill ? { unreadable: skill.unreadable } : { name: skill.name, hash: skill.hash, content: { directory: skill.directory, hash: skill.hash } });
  return { id: source.id, link: source.link, commitAt: source.commitAt, whole: found.holds === 'skills' && found.skills.every(skill => !('unreadable' in skill)), names, recorded: recordedOf(sources), ...clicked };
}
/** A click on one name's row at a source: Add on one held deleted (`bringBack`), or Replace, Merge or Keep mine on one whose version waits (`replace`, `merge`, `keep`). */
type RowClick = Pick<SourceRead<SkillContent>, 'bringBack' | 'replace' | 'merge' | 'keep'>;

/** A source's last read as kept here (none kept reads as nothing at the link's folder: sourcestore.ts), and as the table reads it. */
async function lastRead(context: ShareContext, source: SourceRecord, sources: SourceRecord[], clicked?: RowClick) {
  const copy = copyOf(context.home, source.id);
  const found: Holds = await exists(copy) ? await holdsAt(copy, source.folder, repoName(source.repository)) : { holds: 'missing', skills: [] };
  return { found, read: readOf(source, found, sources, clicked) };
}

/**
 * The library's skills as the table reads them on the page: each item, and what each managed tool holds of it now, from the
 * look a pass makes (librarypass.ts lookFor, copiesOf), so a page says what the pass will answer.
 */
async function libraryNow(context: ShareContext, tools: readonly HarnessId[]) {
  const { look } = await lookFor(skillKind, context, tools);
  return { items: look.library.items, copies: (item: LibraryItem) => copiesOf(look, item) };
}

/**
 * What each skill at a source, and each item in Central Knot linked to it, is to the library now: the table's own answer for it
 * (library.ts sourceAnswers, on the read as readOf gives it), or `unreadable` with why. One skill there whose name can't be read
 * and whose folder's name no item has, beside the one linked item the read doesn't hold, is that item (its SKILL.md stopped
 * parsing): one line. A deleted item the
 * read doesn't hold is none of the source's business, and has no line. The Sources page words each one.
 */
function namesOf(found: Holds, read: SourceRead<SkillContent>, { items, copies }: Awaited<ReturnType<typeof libraryNow>>, sources: SourceRecord[]): SourceName[] {
  const answers = [...sourceAnswers(items, read, read.recorded, { copies })].filter(([key]) => found.skills.some(skill => skill.key === key) || !items[key]?.deleted);
  // A skill whose name can't be read is keyed by its folder's name; where no item has that name, it may be the one item missing.
  const absent = answers.filter(([key]) => !found.skills.some(skill => skill.key === key)), nameless = found.skills.filter(skill => 'unreadable' in skill && !skill.name && !items[skill.key]);
  const sameOne = absent.length === 1 && nameless.length === 1 ? { item: absent[0][0], skill: nameless[0].key } : undefined;
  return answers.filter(([key]) => key !== sameOne?.skill).map(([key, answer]): SourceName => {
    const skill = found.skills.find(each => each.key === (key === sameOne?.item ? sameOne.skill : key)), item = items[key];
    const name = key === sameOne?.item ? item?.name : skill?.name ?? item?.name;
    const base = { key, ...(name ? { name } : {}), ...(skill ? { there: { folder: skill.folder, folderName: skill.folderName, files: skill.files } } : {}) };
    const on = item && !item.deleted ? { on: item.on } : {};
    if (skill && 'unreadable' in skill) return { ...base, ...on, state: 'unreadable', why: skill.unreadable };
    const other = answer === 'another' ? sources.find(source => source.id === linkedSource(item, read.recorded))?.link : undefined;
    return { ...base, ...on, state: answer, ...(other ? { why: other } : {}) };
  });
}

/** The pass for one source's read: its step, which also decides the pass's scope (librarypass.ts fromSourceStep). */
async function runSource(context: ShareContext, tools: HarnessId[], source: SourceRecord, sources: SourceRecord[], clicked?: RowClick) {
  const { read } = await lastRead(context, source, sources, clicked);
  return { ...(await applySkills(context, tools, [], { source: read })), ...(read.whole ? {} : { notWhole: true as const }) };
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

/** Why a repository can't be a source: it is the Git repo Pull and Push use here (asked at Look, and again at Add, since Connect may come between). */
async function theGitRepo(context: ShareContext, repository: string): Promise<string | undefined> {
  const repo = await connectedRepoAddress(context.home);
  return repo && sameSource(repo, repository) ? 'That is the Git repo Pull and Push use here, so it can’t be a source too. A source is only ever read; that repo stays on the Git repo page.' : undefined;
}

/**
 * A link, read and resolved to a repository, a branch or tag (the one the link names, else the default branch's name) and a
 * folder. Refused when it is no link, is the Git repo Pull and Push use, names a branch the repository hasn't, or names none
 * and the repository says no default branch.
 */
async function resolve(context: ShareContext, link: string): Promise<Resolved | { refused: string }> {
  const read = readLink(link);
  if ('refused' in read) return read;
  const isRepo = await theGitRepo(context, read.repository);
  if (isRepo) return { refused: isRepo };
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
export async function previewSource(context: ShareContext, tools: HarnessId[], link: string): Promise<SourcePreview> {
  const refuse = (refused: string): SourcePreview => ({ refused, link });
  const gate = await libraryGate(context, { ownFile: true });
  if ('refused' in gate) return refuse(gate.refused);
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
  // Read as Add will record it: a source of this look's own id, among those the home records.
  const read = readOf({ ...resolved, id: token, readAt: '', addedAt: '' }, found, sources);
  const refused = noSkillWhy(found, resolved);
  return { ...foundOf(resolved, found, namesOf(found, read, await libraryNow(context, tools), sources)), token, ...(refused ? { refused } : {}) };
}

const foundOf = (source: Resolved & Partial<Pick<SourceRecord, 'commit' | 'commitAt'>>, found: Holds, names: SourceName[]): SourceFound => {
  const unread = notSkillsWhy(found, source);
  return { link: source.link, repository: source.repository, ref: source.ref, folder: source.folder, commit: source.commit, commitAt: source.commitAt, holds: found.holds, names, ...(unread ? { unread } : {}) };
};

/**
 * A click's answer: why it stopped, what the pass did, why the source wasn't read whole, and the page's view after. A `wait`
 * is told only where the source's row still says it once the pass is done: the plan after the step may give a tool's copy way
 * (a tool managed again) or take in the source's own text, and then nothing waits.
 */
async function answer(context: ShareContext, tools: HarnessId[], done: Omit<SourceResult, 'view'> = {}): Promise<SourceResult> {
  const { stopped, results, notWhole } = done, view = await sourcesView(context, tools);
  const waitsNow = new Set(view.sources.flatMap(source => source.names.filter(name => name.state === 'wait').map(name => name.key)));
  const sourced = done.sourced?.filter(entry => entry.answer !== 'wait' || waitsNow.has(itemKey(entry.name)));
  return { ...(stopped ? { stopped } : {}), ...(sourced ? { sourced } : {}), ...(results ? { results } : {}), ...(notWhole ? { notWhole } : {}), view };
}

/** Add: the look `token` read becomes a source, recorded first, then carried out by the pass: each skill there comes in Off. */
export async function addSource(context: ShareContext, tools: HarnessId[], token: string): Promise<SourceResult> {
  const look = /^[0-9a-f-]{36}$/.test(token) ? lookOf(context.home, token) : '';
  const where = look && await readFile(`${look}.json`, 'utf8').then(text => JSON.parse(text) as Resolved & { commit: string; commitAt: string }, () => undefined);
  if (!where || !(await exists(look))) return answer(context, tools, { stopped: 'That look at the link is no longer kept. Look at it again.' });
  const { sources, problem } = await readSources(context.home);
  if (problem) return answer(context, tools, { stopped: problem });
  if (twinOf(sources, where)) return answer(context, tools, { stopped: 'That link is a source already: its row is below.' });
  const isRepo = await theGitRepo(context, where.repository);
  if (isRepo) return answer(context, tools, { stopped: isRepo });
  const refused = noSkillWhy(await holdsAt(look, where.folder, repoName(where.repository)), where);
  if (refused) return answer(context, tools, { stopped: refused });
  const gate = await libraryGate(context, { start: true });
  if ('refused' in gate) return answer(context, tools, { stopped: gate.refused });
  const now = new Date().toISOString();
  const source: SourceRecord = { id: randomUUID(), link: where.link, repository: where.repository, ref: where.ref, folder: where.folder, commit: where.commit, commitAt: where.commitAt, readAt: now, addedAt: now };
  await rename(look, copyOf(context.home, source.id));
  await rm(`${look}.json`, { force: true });
  await saveSources(context.home, [...sources, source]);
  return answer(context, tools, await runSource(context, tools, source, [...sources, source]));
}

/**
 * Check now: the source read again, then its table carried out by the pass. The fetch runs now, outside the queue; the rest in
 * the queue's `turn`: a source removed meanwhile drops the fetch; a fetch that failed keeps the last read and is said on the
 * source's row (`problem`); any read fetched takes the last one's place, whole or not, so its row says why it isn't.
 */
export async function checkSource(context: ShareContext, toolsNow: () => Promise<HarnessId[]>, id: string, turn: <T>(work: () => Promise<T>) => Promise<T>): Promise<SourceResult> {
  const stop = async (stopped: string) => answer(context, await toolsNow(), { stopped });
  // Asked before the fetch, so a home that can't be written fetches nothing; entered in its turn, before anything is written.
  const asked = await libraryGate(context);
  if ('refused' in asked) return stop(asked.refused);
  const before = (await readSources(context.home)).sources.find(source => source.id === id);
  if (!before) return stop('That source is no longer recorded. Nothing was changed.');
  const stage = stageOf(context.home, randomUUID());
  const fetched = await fetchInto(before, stage);
  return turn(async () => {
    const { sources, problem } = await readSources(context.home), source = sources.find(each => each.id === id);
    if (problem || !source) { await removeTree(stage); return stop(problem ?? 'That source was removed meanwhile. Nothing was changed.'); }
    const gate = await libraryGate(context, { start: true });
    if ('refused' in gate) { await removeTree(stage); return stop(gate.refused); }
    if ('problem' in fetched) {
      await saveSources(context.home, sources.map(each => (each.id === id ? { ...each, problem: fetched.problem } : each)));
      return stop(`Couldn’t read ${linkLabel(source.link)}. ${fetched.problem}`);
    }
    await removeTree(copyOf(context.home, id));
    await rename(stage, copyOf(context.home, id));
    const read: SourceRecord = { ...source, commit: fetched.commit, commitAt: fetched.commitAt, readAt: new Date().toISOString() };
    delete read.problem;
    const now = sources.map(each => (each.id === id ? read : each)), tools = await toolsNow();
    await saveSources(context.home, now);
    return answer(context, tools, await runSource(context, tools, read, now));
  });
}

/**
 * A click on one name's row at a source, from the source's last read (no fetch): Add on a name the library holds deleted
 * brings it back Off (`bringBack`); Replace on one whose version waits makes the source's version current and keeps the one
 * the item had as a version (`replace`); Merge merges it into the current version (`merge`, library.ts MERGE), after a pass for
 * that item alone, which takes in an edit a tool holds: it is yours; Keep mine keeps the current version and the source's
 * as a version (`keep`, library.ts KEEP MINE). Each is then the table's own answer (library.ts fromSource), carried out by the pass.
 */
async function fromRow(context: ShareContext, tools: HarnessId[], id: string, clicked: RowClick): Promise<SourceResult> {
  const { sources, problem } = await readSources(context.home), source = sources.find(each => each.id === id);
  if (problem || !source) return answer(context, tools, { stopped: problem ?? 'That source is no longer recorded. Nothing was changed.' });
  if (!(await exists(copyOf(context.home, id)))) return answer(context, tools, { stopped: 'Its last read is no longer kept. Check it now first.' });
  const first = clicked.merge && await applySkills(context, tools, [], { only: new Set(clicked.merge) });
  if (first && first.stopped) return answer(context, tools, { stopped: first.stopped });
  return answer(context, tools, await runSource(context, tools, source, sources, clicked));
}
/** Add on one name the library holds deleted, at a source's row: it comes back Off, at the source's last read. */
export const bringBack = (context: ShareContext, tools: HarnessId[], id: string, key: string) => fromRow(context, tools, id, { bringBack: new Set([key]) });
/** Replace on one name whose version waits at a source's row: the source's version, as last read, becomes current. */
export const replaceFromSource = (context: ShareContext, tools: HarnessId[], id: string, key: string) => fromRow(context, tools, id, { replace: new Set([key]) });
/** Merge on one name whose version waits at a source's row: the source's version, as last read, merged into the current one. */
export const mergeFromSource = (context: ShareContext, tools: HarnessId[], id: string, key: string) => fromRow(context, tools, id, { merge: new Set([key]) });
/** Keep mine on one name whose version waits at a source's row: the current version stays, and the source's, as last read, no longer waits. */
export const keepFromSource = (context: ShareContext, tools: HarnessId[], id: string, key: string) => fromRow(context, tools, id, { keep: new Set([key]) });

/** Remove: the source is forgotten, with its last read. Each item it brought stays as it is, On or Off, with its versions, no longer linked. */
export async function removeSource(context: ShareContext, tools: HarnessId[], id: string): Promise<SourceResult> {
  const { sources, problem } = await readSources(context.home);
  if (problem) return answer(context, tools, { stopped: problem });
  if (!sources.some(source => source.id === id)) return answer(context, tools, { stopped: 'That source is no longer recorded. Nothing was changed.' });
  const gate = await libraryGate(context, { ownFile: true });
  if ('refused' in gate) return answer(context, tools, { stopped: gate.refused });
  await saveSources(context.home, sources.filter(source => source.id !== id));
  await removeTree(copyOf(context.home, id));
  return answer(context, tools);
}

// ---------- Once a day ----------

/** How often each source is read again by itself (the owner, 2026-11-14: "got sources can be checked once a day"), from its last read (SourceRecord readAt). */
export const SOURCE_CHECK_EVERY_MS = 24 * 60 * 60_000;
/** A source whose fetch failed keeps its last read and its time, so it is due at once again; it is tried by itself no sooner than this after. */
const TRY_AGAIN_MS = 60 * 60_000;
/** When each source (by id) was last tried by checkDue while the app runs: a failed fetch leaves no mark on its record. A restart forgets them. */
const triedAt = new Map<string, number>();

/**
 * The check once a day, on main.ts's schedule's turn (every few minutes, the first a minute after start, so a day passed while
 * the app was closed is caught up at launch): with Automatic sync on (`syncOn`; off, nothing is read by itself, as plugin
 * updates pause), each source whose last read is a day old or more, and that wasn't tried in the last hour, is checked as Check
 * now checks it (checkSource: the fetch outside the queue, the pass in its turn, with the pass's settle window). Answers what
 * each check did, for main.ts to log and tell the page.
 */
export async function checkDue(context: ShareContext, toolsNow: () => Promise<HarnessId[]>, turn: <T>(work: () => Promise<T>) => Promise<T>,
  { syncOn, now = Date.now() }: { syncOn: boolean; now?: number }): Promise<{ link: string; done: SourceResult }[]> {
  const { sources, problem } = syncOn ? await readSources(context.home) : { sources: [] };
  if (problem) return [];
  const due = sources.filter(source => now - Date.parse(source.readAt) >= SOURCE_CHECK_EVERY_MS && now - (triedAt.get(source.id) ?? -Infinity) >= TRY_AGAIN_MS);
  const checked: { link: string; done: SourceResult }[] = [];
  for (const source of due) {
    triedAt.set(source.id, now);
    checked.push({ link: source.link, done: await checkSource(context, toolsNow, source.id, turn) });
  }
  return checked;
}

// ---------- The page's view ----------

/**
 * The Sources page: each source with its last read, why that read isn't whole if it isn't, what the table says of each skill
 * there and of each item linked to it (namesOf), and why the last Check now couldn't fetch it, if it couldn't. Each item a
 * source removed is not here: the page reads it from the Skills view (sourceFacts), which every refresh of the home reads again.
 */
export async function sourcesView(context: ShareContext, tools: HarnessId[]): Promise<SourcesView> {
  const access = await writeAccess(context);
  const { sources, problem } = await readSources(context.home);
  const library = await libraryNow(context, tools);
  const views = await Promise.all(sources.map(async (source): Promise<SourceView> => {
    const { id, addedAt, readAt } = source, { found, read } = await lastRead(context, source, sources);
    return { ...foundOf(source, found, namesOf(found, read, library, sources)), id, addedAt, readAt, ...(source.problem ? { problem: source.problem } : {}) };
  }));
  return { sources: views, access, ...(problem ? { problem } : {}) };
}

/**
 * Each item linked to a source the home records, as its row on Skills says it (types.ts LibraryFacts fromSource): the source's
 * link, and whether that source's last read has a version that waits (the table's `wait`, from the same answers as the Sources
 * page), or else whether it is changed here (library.ts changedHere), so the source's next change will meet it; and each item
 * a source removed (`removed`: library.ts removedBy), with that source's link. `items` and `copies`: the Skills view's own look
 * (skills.ts skillsView).
 */
export async function sourceFacts(context: ShareContext, items: Record<string, LibraryItem>, copies: (item: LibraryItem) => Copies): Promise<Map<string, NonNullable<LibraryFacts['fromSource']>>> {
  const { sources } = await readSources(context.home), facts = new Map<string, NonNullable<LibraryFacts['fromSource']>>();
  const recorded = recordedOf(sources), reads = await Promise.all(sources.map(async source => (await lastRead(context, source, sources)).read));
  for (const [index, source] of sources.entries()) {
    const linked = Object.values(items).filter(item => !item.deleted && linkedSource(item, recorded) === source.id);
    if (!linked.length) continue;
    const answers = sourceAnswers(items, reads[index], recorded, { copies });
    for (const item of linked) {
      const waits = answers.get(item.key) === 'wait', nextWaits = !waits && changedHere(item, item.seen, copies(item));
      facts.set(item.key, { link: source.link, ...(waits ? { waits: true as const } : {}), ...(nextWaits ? { nextWaits: true as const } : {}) });
    }
  }
  for (const item of Object.values(items)) {
    const by = removedBy(item, reads);
    if (by) facts.set(item.key, { link: by.link, removed: true });
  }
  return facts;
}
