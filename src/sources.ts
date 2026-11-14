// Sources: a Git link the person gave, which items are read from and which is never written. The model's table for it is
// library.ts's header (A SOURCE: sourceAnswers and fromSource; what counts as changed here: changedHere); the pass carries it
// out in one step before its clicks (librarypass.ts fromSourceStep), one pass per kind a source brings. This module owns what
// is around that step:
// - the kinds a source brings, one table (sourceKinds: a SourceKind each, its Kind with Merge, its pass and its reader at a
//   link). Skills and agents are its entries in this version. Every run, click and view goes through it: runSource,
//   rowClick, namesOf, libraryNow, sourcesView and sourceFacts. To add a kind: its entry in sourceKinds, its reader in
//   atlink.ts (given what the kinds before it found), its Merge in merge.ts (the compiler names what an entry lacks), its view's
//   one call to sourceFacts, and the Sources page's words (sourcespage.ts, which words a line by its kind and a sentence about
//   every source by the kinds the view names, SourcesView `kinds`; its aside names the kinds still to come);
// - a link resolved (sourcelink.ts readLink; its branch, named or the default one, found among the repository's own: refsOf),
//   and fetched (plugins.ts copySource: the shallow copy marketplaces get, this computer's git and its sign-in, nothing asked
//   or kept); each source's last read is kept with its record (sourcestore.ts), and read once per click, and once per build
//   of the home's view (lastFound); what is at it, and each kind's read of it, is atlink.ts's (holdsAt, readOf: whether it was
//   read whole is decided there);
// - the clicks: Look (previewSource: what Add would do, name by name, before anything is kept), Add, Check now, a click on one
//   name's line in its kind (rowClick: Add on one the library holds deleted; Replace, Merge and Keep mine on one whose version
//   waits) and Remove;
// - the check once a day (checkDue: the rhythm is here, main.ts only calls it on its schedule's turn, with Automatic sync on);
// - what the table says, as the page shows it: the Sources page's view (sourcesView) and each linked item's row on its kind's
//   page (sourceFacts, which each kind's view asks), both from the same answers the pass carries out, with the tools read
//   now; and each item a source removed (sourceFacts `removed`: library.ts removedBy), which both pages read from its kind's view.
// Kept elsewhere: the page (sourcespage.ts); the words of a source's History entries (historyactions.ts) and of its versions
// (library.ts originWords); the Git repo's refusal of a source (gitrepo.ts connectRepo, through sourcestore.ts sourceAt), as
// a source refuses that repo here (theGitRepo, at Look and at Add).
//
// Each click's own refusals come first; then, where it writes, it enters the gate for library writes (share.ts libraryGate):
// Add and Check now before they write the record and run the pass (which enters it too), Remove for Central Knot's own file
// alone (`ownFile`); Look, which writes only its own folder, asks it for that; Add, Replace, Merge and Keep mine on a line write
// nothing themselves (their passes enter).
//
// A fetch can take a while, so it runs outside the queue main.ts keeps for every change: Look writes only its own folder
// (sources/.look-<token>); Check now fetches into a stage of its own and only in its turn (`turn`) swaps it in for the source's
// copy and runs the pass, so a source removed meanwhile, or another check, never meets a half-swapped copy.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { agentsAt, holdsAt, itemsOf, laterWhy, nothingToAddWhy, readOf, skillsAt, unreadWhy, type Holds, type ReaderAt, type RowClick } from './atlink.ts';
import type { SharedAgent } from './agentfiles.ts';
import { agentKind, applyAgents } from './agents.ts';
import { connectedRepoAddress } from './gitrepo.ts';
import { changedHere, itemKey, linkedSource, removedBy, sourceAnswers, type Copies, type ItemKind, type LibraryItem } from './library.ts';
import { copiesOf, lookFor, type PassOptions, type SourcedKind } from './librarypass.ts';
import { copySource, gitFailure, runGit, sameSource } from './plugins.ts';
import { itemId } from './profileplan.ts';
import { exists, libraryGate, removeTree, writeAccess, writeDurably, type ShareContext } from './share.ts';
import { applySkills, skillKind } from './skills.ts';
import type { SkillContent } from './skillstore.ts';
import { copyOf, lookOf, readSources, saveSources, sourcesFolder, stageOf, type SourceRecord } from './sourcestore.ts';
import { linkLabel, readLink, splitRef } from './sourcelink.ts';
import type { Change, DestinationResult, HarnessId, LibraryFacts, PassResult, SourceFound, SourceName, SourcePreview, SourceResult, SourceRowClick, SourcesView, SourceView } from './types.ts';

/** A link as resolved before it is fetched: what a source records of where it reads (its `ref` always a branch or tag's name). */
type Resolved = Pick<SourceRecord, 'link' | 'repository' | 'ref' | 'folder'>;
/** The source a link resolves to already, if one does: one repository however it is spelt, one branch, one folder. */
const twinOf = (sources: SourceRecord[], where: Resolved) =>
  sources.find(source => sameSource(source.repository, where.repository) && source.ref === where.ref && source.folder === where.folder);
/** The ids of the sources the home records: the set library.ts linkedTo reads links against. */
const recordedOf = (sources: SourceRecord[]) => new Set(sources.map(source => source.id));

// ---------- The kinds a source brings ----------

/**
 * One kind a source brings, as the table holds it: its Kind, which must have Merge (librarypass.ts SourcedKind); its pass
 * (`apply`, the one its page's clicks run), given one read of the source or the items a Merge asks for first; its reader at a
 * link (atlink.ts ReaderAt); and what a read with none of it says it found there (`noneThere`, after "No skill at its root:").
 */
export interface SourceKind<Content = unknown> {
  kind: SourcedKind<Content>;
  apply(context: ShareContext, tools: HarnessId[], changes: Change[], options: Pick<PassOptions<Content>, 'source' | 'only'>): Promise<PassResult>;
  at: ReaderAt<Content>;
  noneThere: string;
}
/**
 * Every kind a source brings, in the order a source's lines list them and its readers read (an agent's reader is given the
 * skills found). Made when asked, not as the module loads: a kind's module imports this one back (its view asks sourceFacts),
 * so its Kind may not be made yet then.
 */
const sourceKinds = (): readonly SourceKind[] => [skillSource(), agentSource()];
const skillSource = (): SourceKind<SkillContent> =>
  ({ kind: skillKind, apply: applySkills, at: skillsAt, noneThere: 'no SKILL.md there, in a folder inside it, or in skills/' });
const agentSource = (): SourceKind<SharedAgent> =>
  ({ kind: agentKind, apply: applyAgents, at: agentsAt, noneThere: 'no agent’s file there or in an agents folder' });

/**
 * A source's last read as kept here, what is at its link (none kept reads as nothing at the link's folder: sourcestore.ts):
 * read once per context that keeps its reads (ShareContext `reads`: one build of the home's view, where every kind's view asks).
 */
function lastFound(context: ShareContext, source: SourceRecord): Promise<Holds> {
  const read = async (): Promise<Holds> => {
    const copy = copyOf(context.home, source.id);
    return await exists(copy) ? holdsAt(copy, source.folder, source.repository, sourceKinds()) : { holds: 'missing', kinds: [] };
  };
  const key = `source:${source.id}:${source.commit}`;
  if (!context.reads) return read();
  if (!context.reads.has(key)) context.reads.set(key, read());
  return context.reads.get(key) as Promise<Holds>;
}

/**
 * One kind's library as the table reads it on the page: each item, and what each managed tool holds of it now, from the look
 * a pass makes (librarypass.ts lookFor, copiesOf), so a page says what the pass will answer.
 */
async function libraryNow(context: ShareContext, entry: SourceKind, tools: readonly HarnessId[]) {
  const { look } = await lookFor(entry.kind, context, tools);
  return { items: look.library.items, copies: (item: LibraryItem) => copiesOf(look, item) };
}
/** Every kind's library as the page reads it (libraryNow), in the table's order. */
const librariesNow = (context: ShareContext, tools: readonly HarnessId[]) =>
  Promise.all(sourceKinds().map(async entry => ({ entry, library: await libraryNow(context, entry, tools) })));

/**
 * What each item of one kind at a source, and each item of that kind in Central Knot linked to it, is to the library now: the
 * table's own answer for it (library.ts sourceAnswers, on the read as atlink.ts readOf gives it), or `unreadable` with why.
 * One item there whose name can't be read and whose folder's name no item has, beside the one linked item the read doesn't
 * hold, is that item (its file stopped parsing): one line. A deleted item the read doesn't hold is none of the source's
 * business, and has no line. The Sources page words each one.
 */
function namesOf(source: SourceRecord, found: Holds, entry: SourceKind, { items, copies }: Awaited<ReturnType<typeof libraryNow>>, sources: SourceRecord[]): SourceName[] {
  const there = itemsOf(found, entry), read = readOf(source, found, entry, recordedOf(sources)), kind = entry.kind.kind;
  const answers = [...sourceAnswers(items, read, read.recorded, { copies })].filter(([key]) => there.some(one => one.key === key) || !items[key]?.deleted);
  // An item whose name can't be read is keyed by its folder's name; where no item has that name, it may be the one item missing.
  const absent = answers.filter(([key]) => !there.some(one => one.key === key)), nameless = there.filter(one => 'unreadable' in one && !one.name && !items[one.key]);
  const sameOne = absent.length === 1 && nameless.length === 1 ? { item: absent[0][0], there: nameless[0].key } : undefined;
  return answers.filter(([key]) => key !== sameOne?.there).map(([key, answer]): SourceName => {
    const one = there.find(each => each.key === (key === sameOne?.item ? sameOne.there : key)), item = items[key];
    const name = key === sameOne?.item ? item?.name : one?.name ?? item?.name;
    const base = { kind, key, ...(name ? { name } : {}), ...(one ? { there: { folder: one.folder, folderName: one.folderName, files: one.files } } : {}) };
    const on = item && !item.deleted ? { on: item.on } : {};
    if (one && 'unreadable' in one) return { ...base, ...on, state: 'unreadable', why: one.unreadable };
    const other = answer === 'another' ? sources.find(each => each.id === linkedSource(item, read.recorded))?.link : undefined;
    return { ...base, ...on, state: answer, ...(other ? { why: other } : {}) };
  });
}
/** Every line of what is at a source, kind by kind in the table's order (namesOf). */
const linesOf = (source: SourceRecord, found: Holds, libraries: Awaited<ReturnType<typeof librariesNow>>, sources: SourceRecord[]) =>
  libraries.flatMap(({ entry, library }) => namesOf(source, found, entry, library, sources));

/**
 * The pass for one source's last read: one per kind in the table, each given its kind's read (a row's click only to its own
 * kind's), whose step also decides that pass's scope (librarypass.ts fromSourceStep). Answers what they did: each item a step
 * answered for, with its kind and the tools it was written to and taken out of (from that kind's own results, by its name),
 * every result, and whether any kind's read wasn't whole. A pass that stops stops the rest.
 */
async function runSource(context: ShareContext, tools: HarnessId[], source: SourceRecord, sources: SourceRecord[], clicked?: { kind: ItemKind; asked: RowClick }) {
  const found = await lastFound(context, source), done: Omit<SourceResult, 'view'> & { results: DestinationResult[] } = { results: [] };
  for (const entry of sourceKinds()) {
    const read = readOf(source, found, entry, recordedOf(sources), clicked?.kind === entry.kind.kind ? clicked.asked : {});
    const passed = await entry.apply(context, tools, [], { source: read });
    const toolsOf = (name: string, outcome: 'written' | 'removed') =>
      passed.results.filter(each => each.item === name && each.outcome === outcome && each.harness).map(each => each.harness!);
    const sourced = passed.sourced?.map(each => ({ ...each, kind: read.kind, written: toolsOf(each.name, 'written'), removed: toolsOf(each.name, 'removed') }));
    done.results.push(...passed.results);
    if (sourced) done.sourced = [...done.sourced ?? [], ...sourced];
    if (!read.whole) done.notWhole = true;
    if (passed.stopped) return { ...done, stopped: passed.stopped };
  }
  return done;
}

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
 * Look: reads a link and says what Add would do with each item there, by the source's table, and what it won't bring in and
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
  const found = await holdsAt(look, resolved.folder, resolved.repository, sourceKinds());
  // Read as Add will record it: a source of this look's own id, among those the home records.
  const names = linesOf({ ...resolved, id: token, readAt: '', addedAt: '' }, found, await librariesNow(context, tools), sources);
  const refused = nothingToAddWhy(found, resolved);
  return { ...foundOf(resolved, found, names), token, ...(refused ? { refused } : {}) };
}

const foundOf = (source: Resolved & Partial<Pick<SourceRecord, 'commit' | 'commitAt'>>, found: Holds, names: SourceName[]): SourceFound => {
  const unread = unreadWhy(found, source), later = laterWhy(found);
  return { link: source.link, repository: source.repository, ref: source.ref, folder: source.folder, commit: source.commit, commitAt: source.commitAt, holds: found.holds, names,
    ...(unread ? { unread } : {}), ...(later ? { later } : {}) };
};

/**
 * A click's answer: why it stopped, what the pass did, why the source wasn't read whole, and the page's view after. A `wait`
 * is told only where the source's row still says it, of that kind and key, once the pass is done: the plan after the step may
 * give a tool's copy way (a tool managed again) or take in the source's own text, and then nothing waits.
 */
async function answer(context: ShareContext, tools: HarnessId[], done: Omit<SourceResult, 'view'> = {}): Promise<SourceResult> {
  const { stopped, results, notWhole } = done, view = await sourcesView(context, tools);
  const waitsNow = new Set(view.sources.flatMap(source => source.names.filter(name => name.state === 'wait').map(name => itemId(name.kind, name.key))));
  const sourced = done.sourced?.filter(entry => entry.answer !== 'wait' || waitsNow.has(itemId(entry.kind, itemKey(entry.name))));
  return { ...(stopped ? { stopped } : {}), ...(sourced ? { sourced } : {}), ...(results ? { results } : {}), ...(notWhole ? { notWhole } : {}), view };
}

/** Add: the look `token` read becomes a source, recorded first, then carried out by the pass: each item there comes in Off. */
export async function addSource(context: ShareContext, tools: HarnessId[], token: string): Promise<SourceResult> {
  const look = /^[0-9a-f-]{36}$/.test(token) ? lookOf(context.home, token) : '';
  const where = look && await readFile(`${look}.json`, 'utf8').then(text => JSON.parse(text) as Resolved & { commit: string; commitAt: string }, () => undefined);
  if (!where || !(await exists(look))) return answer(context, tools, { stopped: 'That look at the link is no longer kept. Look at it again.' });
  const { sources, problem } = await readSources(context.home);
  if (problem) return answer(context, tools, { stopped: problem });
  if (twinOf(sources, where)) return answer(context, tools, { stopped: 'That link is a source already: its row is below.' });
  const isRepo = await theGitRepo(context, where.repository);
  if (isRepo) return answer(context, tools, { stopped: isRepo });
  const refused = nothingToAddWhy(await holdsAt(look, where.folder, where.repository, sourceKinds()), where);
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
 * A click on one name's line at a source, from the source's last read (no fetch), in its kind (types.ts SourceRowClick): Add
 * on a name the library holds deleted brings it back Off (`bringBack`); Replace on one whose version waits makes the source's
 * version current and keeps the one the item had as a version (`replace`); Merge merges it into the current version
 * (`merge`, library.ts MERGE), after a pass of its kind for that item alone, which takes in an edit a tool holds: it is yours;
 * Keep mine keeps the current version and the source's as a version (`keep`, library.ts KEEP MINE). Each is then the table's
 * own answer (library.ts fromSource), carried out by the source's passes (runSource). A kind no entry of the table has, or a
 * click no line has, as main.ts passes on whatever the page sent, is refused and changes nothing.
 */
export async function rowClick(context: ShareContext, tools: HarnessId[], id: string, kind: string, key: string, click: string): Promise<SourceResult> {
  const entry = sourceKinds().find(each => each.kind.kind === kind);
  const known = entry && ROW_CLICKS.includes(click as SourceRowClick);
  if (!known) return answer(context, tools, { stopped: `A source’s line has no click “${click}” for a “${kind}”, so nothing was changed.` });
  const { sources, problem } = await readSources(context.home), source = sources.find(each => each.id === id);
  if (problem || !source) return answer(context, tools, { stopped: problem ?? 'That source is no longer recorded. Nothing was changed.' });
  if (!(await exists(copyOf(context.home, id)))) return answer(context, tools, { stopped: 'Its last read is no longer kept. Check it now first.' });
  const first = click === 'merge' && await entry.apply(context, tools, [], { only: new Set([key]) });
  if (first && first.stopped) return answer(context, tools, { stopped: first.stopped });
  return answer(context, tools, await runSource(context, tools, source, sources, { kind: entry.kind.kind, asked: { [click]: new Set([key]) } }));
}
/** The clicks a source's line has (types.ts SourceRowClick), each a key set its kind's read carries (atlink.ts RowClick). */
const ROW_CLICKS: readonly SourceRowClick[] = ['bringBack', 'replace', 'merge', 'keep'];

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
 * The Sources page: each source with its last read, why that read isn't whole if it isn't, what the table says of each item
 * there and of each item linked to it, kind by kind (namesOf), and why the last Check now couldn't fetch it, if it couldn't.
 * Each item a source removed is not here: the page reads it from its kind's view (sourceFacts), which every refresh of the
 * home reads again.
 */
export async function sourcesView(context: ShareContext, tools: HarnessId[]): Promise<SourcesView> {
  const access = await writeAccess(context);
  const { sources, problem } = await readSources(context.home);
  const libraries = await librariesNow(context, tools);
  const views = await Promise.all(sources.map(async (source): Promise<SourceView> => {
    const { id, addedAt, readAt } = source, found = await lastFound(context, source);
    return { ...foundOf(source, found, linesOf(source, found, libraries, sources)), id, addedAt, readAt, ...(source.problem ? { problem: source.problem } : {}) };
  }));
  return { sources: views, kinds: sourceKinds().map(entry => entry.kind.kind), access, ...(problem ? { problem } : {}) };
}

/**
 * Each item of one kind linked to a source the home records, as its row on its kind's page says it (types.ts LibraryFacts
 * fromSource): the source's link, and whether that source's last read has a version that waits (the table's `wait`, from the
 * same answers as the Sources page), or else whether it is changed here (library.ts changedHere), so the source's next change
 * will meet it; and each item a source removed (`removed`: library.ts removedBy), with that source's link. `items` and
 * `copies`: the kind's view's own look (skills.ts skillsView and agents.ts agentsView ask it). A kind the table has no entry
 * for has no source.
 */
export async function sourceFacts(context: ShareContext, kind: ItemKind, items: Record<string, LibraryItem>, copies: (item: LibraryItem) => Copies) {
  const facts = new Map<string, NonNullable<LibraryFacts['fromSource']>>(), entry = sourceKinds().find(each => each.kind.kind === kind);
  if (!entry) return facts;
  const { sources } = await readSources(context.home), recorded = recordedOf(sources);
  const reads = await Promise.all(sources.map(async source => readOf(source, await lastFound(context, source), entry, recorded)));
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
    const by = removedBy(item, entry.kind.kind, reads);
    if (by) facts.set(item.key, { link: by.link, removed: true });
  }
  return facts;
}
