// Agents on Central Knot's library: the adapter for one kind. Read library.ts first: it holds the model and the one rule.
// This module reads what each managed harness holds of an agent (H), asks the library what to do (plan), and carries the
// answer out. It decides nothing itself. In the order a pass runs (applyAgents):
//
//   readDisk       each managed harness's agent files; a file that can't be read for sure is `unseen`, never missing
//   guardFolders   a folder that moved or was made again: what was applied there is forgotten, so nothing reads as deleted
//   click          what the person asked (On, Off, a harness kept out, a version made current, Delete, Restore, a found
//                  agent taken in), recorded on the item
//   syncItem       the library's plan for the item, carried out: versions first, then each harness's file, by checked
//                  writes and removals (share.ts), so a save that lands meanwhile is never lost
//   logItem        History's entries for what was done
//
// agentsView is the same reading for the Agents page; restoreAgent runs a History entry's action, which is always one of
// the clicks above (historyactions.ts). Elsewhere: where each thing is kept on disk, agentstore.ts; the harnesses' file
// formats, agentfiles.ts; an agent's row and the clicks its controls send, agentrow.ts; Convert to skill, agentskill.ts.
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { agentText, agentsFolder, fileFor, isAgentTool, keyOf, readAgents, safeName, type AgentEntry, type SharedAgent } from './agentfiles.ts';
import { agentShelf, fileTextFor, keepOwn, openLibrary, readVersion, saveLibrary, type AgentLibrary, type FolderSeen } from './agentstore.ts';
import { harnesses } from './harnesses.ts';
import { agentAction } from './historyactions.ts';
import { decide, keepVersion, newItem, plan, setCurrent, wantedIn } from './library.ts';
import type { Copies, LibraryItem, Plan, Shelf, Source } from './library.ts';
import { appendHistory, readHistory, replaceHistory } from './manage.ts';
import { throughPlugins } from './plugins.ts';
import type { AgentTool } from './presence.ts';
import { errorCode, newRecord, readRecord, recoverParked, remember, removeFileChecked, saveRecord, syncGate, writeAccess, writeFileChecked } from './share.ts';
import type { ShareContext } from './share.ts';
import type { Change, DestinationResult, HarnessId, HistoryEvent, McpResult, McpView, SkillFacts, SyncNotice, ThroughPlugin, ToolCopy } from './types.ts';
import { throughPlugin } from './words.ts';

const iso = (ms: number) => new Date(ms).toISOString();
const now = () => new Date().toISOString();
const nameOf = (tool: HarnessId) => harnesses[tool].name;

// ---------- What the harnesses hold ----------

type Slot = Partial<Record<AgentTool, AgentEntry>>;
/** The managed harnesses' agent files now, by agent then harness, and what can't be seen for sure. */
interface Disk {
  byKey: Map<string, Slot>;
  /** The harnesses whose agents folder is there. */
  folders: Set<HarnessId>;
  /** Why an agent's copy in a harness can't be seen for sure, by `harness:key` (`harness:*`: its whole folder). */
  unseen: Map<string, string>;
  problems: string[];
}

async function readDisk(context: ShareContext, managed: AgentTool[]): Promise<Disk> {
  const disk: Disk = { byKey: new Map(), folders: new Set(), unseen: new Map(), problems: [] };
  for (const tool of managed) {
    const read = await readAgents(context, tool);
    disk.problems.push(...read.problems);
    if (read.folderExists) disk.folders.add(tool);
    for (const key of read.unreadable.keys()) {
      const what = key === '*' ? 'agents folder' : 'file for this agent';
      disk.unseen.set(`${tool}:${key}`, `${nameOf(tool)}’s ${what} is there but could not be read. Nothing changes there until it reads again.`);
    }
    for (const entry of read.entries) {
      const slot = disk.byKey.get(entry.key) ?? {};
      // Two files whose names differ only by case (a case-sensitive disk): which is which can't be told.
      const twice = `Two files whose names differ only by case are in ${nameOf(tool)}. Rename one so Central Knot can tell them apart.`;
      if (slot[tool]) disk.unseen.set(`${tool}:${entry.key}`, twice);
      slot[tool] = entry;
      disk.byKey.set(entry.key, slot);
    }
  }
  return disk;
}
const unseenIn = (disk: Disk, tool: HarnessId, key: string) => disk.unseen.get(`${tool}:${key}`) ?? disk.unseen.get(`${tool}:*`);

type ThroughPlugins = Map<HarnessId, Map<string, ThroughPlugin>>;
/**
 * The agents each harness has through its installed plugins, by key: such a harness gets no file of its own beside the
 * plugin's. Only an agent Central Knot installed elsewhere as that plugin's part counts: a name alone could be another agent.
 */
async function agentsThroughPlugins(context: ShareContext, tools: HarnessId[]): Promise<ThroughPlugins> {
  const found: ThroughPlugins = new Map();
  for (const [tool, given] of await throughPlugins(context, tools, 'agent', keyOf)) {
    const asParts = [...given].flatMap(([key, { asParts: isPart, text: _text, ...plugin }]) => (isPart ? [[key, plugin] as const] : []));
    found.set(tool, new Map(asParts));
  }
  return found;
}

/** Why a harness with no copy can't be given one, if it can't. Worked out at each look and never stored. */
function cannotHold(through: ThroughPlugins, item: Pick<LibraryItem, 'key' | 'name'>, tool: HarnessId): string | undefined {
  const given = through.get(tool)?.get(item.key);
  if (given) return throughPlugin(tool, given, 'agent');
  return safeName(item.name) ? undefined : 'This name can’t be a file name here.';
}

// ---------- A pass ----------

/** A click's History entry, begun when the click is recorded and finished once its files are written (`fill`: which of them it names). */
type ClickEntry = Pick<HistoryEvent, 'kind' | 'winner' | 'only' | 'version' | 'previous'> & { losers?: HistoryEvent['losers']; fill?: 'written' | 'removed' };
interface Pass {
  context: ShareContext; managed: AgentTool[]; library: AgentLibrary; disk: Disk; through: ThroughPlugins;
  shelf: Shelf<SharedAgent>;
  /** The record as last saved, to save it again only when it changed. */
  saved: string;
  /** The settle window: how long a copy must stay missing before it counts as deleted by hand, and the clock it is measured on. */
  clock: number; settleMs: number;
  /** Agents whose new content Pull wrote into one harness: the version taken in says "pulled". */
  pulled: Set<string>;
  foldersNow: AgentLibrary['folders'];
  /** The click on each agent this pass, as the History entry it becomes. */
  clicked: Map<string, ClickEntry>;
  results: DestinationResult[]; events: HistoryEvent[]; notices: SyncNotice[]; writes: number; made: string[]; settling: boolean;
}
/** What may be asked of a pass besides its clicks. */
export interface PassOptions {
  /** With Automatic sync off, a click's pass concerns the agents it names and nothing else spreads (SYN-03). */
  only?: Set<string>;
  /** An explicit Resume, for a record this app has no memory of. */
  resume?: boolean;
  /** Agents whose new content Pull just wrote into one harness (gitrepo.ts). */
  pulled?: Set<string>;
  /** The settle window and its clock; tests pass their own. */
  settleMs?: number; now?: number;
}

/** When each file was first seen missing, kept while the app runs (the settle window). A restart forgets them, which only delays an Off. */
const firstSeenMissingAt = new Map<string, number>();

/** One pass: the clicks in `changes`, then every agent in the library brought into line with its harnesses (library.ts plan). */
export async function applyAgents(context: ShareContext, tools: HarnessId[], changes: Change[], options: PassOptions = {}): Promise<McpResult> {
  const refused = await refusal(context, changes.length > 0, options.resume);
  if (refused) return refused;
  const { library, problem } = await openLibrary(context, true);
  if (problem) return { stopped: problem, results: [], writes: 0 };
  const managed = tools.filter(isAgentTool);
  // A write or removal a crash interrupted is finished first, so a file moved aside is never read as deleted.
  for (const tool of managed) await recoverParked(agentsFolder(context, tool));
  const pass: Pass = {
    context, managed, library, disk: await readDisk(context, managed), through: await agentsThroughPlugins(context, managed),
    shelf: agentShelf(context, () => saveIfChanged(pass)), saved: JSON.stringify(library),
    clock: options.now ?? Date.now(), settleMs: options.settleMs ?? context.settleMs ?? 2000, pulled: options.pulled ?? new Set(),
    foldersNow: {}, clicked: new Map(), results: [], events: [], notices: [], writes: 0, made: [], settling: false,
  };
  const inScope = (key: string) => !options.only || options.only.has(key) || changes.some(change => change.key === key);
  await guardFolders(pass, Object.values(library.items).filter(item => inScope(item.key)));
  for (const change of changes) await click(pass, change);
  for (const item of Object.values(library.items)) if (inScope(item.key)) await syncItem(pass, item);
  // Folder identities are kept only by a full pass: a click with Sync off skips other agents, so they must still see a reset.
  if (!options.only) library.folders = { ...library.folders, ...pass.foldersNow };
  await saveIfChanged(pass);
  await appendHistory(context, pass.events);
  return { results: pass.results, writes: pass.writes, notices: pass.notices, settling: pass.settling, made: pass.made };
}

/** Saves the record when it is not as last saved: before any harness file changes (syncItem), and when the pass ends. */
async function saveIfChanged(pass: Pass) {
  const text = JSON.stringify(pass.library);
  if (text === pass.saved) return;
  await saveLibrary(pass.context.home, pass.library);
  pass.saved = text;
}

/** Why nothing may be written right now, if so: a preview-only home, another build's record, or one that needs Resume. */
async function refusal(context: ShareContext, hasChanges: boolean, resume = false): Promise<McpResult | undefined> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason, results: [], writes: 0 };
  const gate = await syncGate(context);
  if (gate.state === 'stopped' || (gate.state === 'needs-resume' && !resume)) return { stopped: gate.reason, results: [], writes: 0 };
  let { record: syncRecord } = await readRecord(context.home);
  if (!syncRecord && !hasChanges) return { results: [], writes: 0 };
  if (!syncRecord) { syncRecord = newRecord(context); await saveRecord(context.home, syncRecord); }
  if (gate.state !== 'ready') await remember(context, syncRecord.generation);
  return undefined;
}

/**
 * "H unknown is never H gone" for a whole folder. A harness's agents folder that is somewhere else than at the last full pass
 * (its config root moved), or that was made again since (a reset or reinstall, or back after being away): what was applied
 * there is forgotten, so a copy missing from it is written again and never read as deleted by hand.
 */
async function guardFolders(pass: Pass, items: LibraryItem[]) {
  for (const tool of pass.managed) {
    const path = agentsFolder(pass.context, tool), was = pass.library.folders[tool];
    const info = await stat(path).catch(() => undefined);
    const here: FolderSeen = info ? { path, ino: info.ino, birth: Math.round(info.birthtimeMs) } : { path, away: true };
    pass.foldersNow[tool] = here;
    if (!was) continue;
    const moved = was.path !== path;
    const remade = !moved && !('away' in here) && ('away' in was || was.ino !== here.ino || was.birth !== here.birth);
    if (!moved && !remade) continue;
    for (const item of items) if (moved || !pass.disk.byKey.get(item.key)?.[tool]) delete item.applied[tool];
  }
}

/**
 * H for each managed harness (library.ts HarnessCopy). `unknown`, so that nothing happens there: a file that can't be read
 * for sure, a folder that is away where a copy was applied, and a copy missing for less than the settle window (an editor's
 * save moves the file away for a moment).
 */
function copiesOf(pass: Pass, item: LibraryItem): Copies {
  const slot = pass.disk.byKey.get(item.key) ?? {};
  const copies: Copies = {};
  for (const tool of pass.managed) {
    const here = slot[tool], applied = item.applied[tool] !== undefined;
    const path = here?.file ?? fileFor(pass.context, tool, item.name);
    const hidden = unseenIn(pass.disk, tool, item.key) || (!pass.disk.folders.has(tool) && applied);
    if (hidden) copies[tool] = { is: 'unknown' };
    else if (here) copies[tool] = { is: 'present', hash: here.hash, at: here.at };
    else copies[tool] = applied && wantedIn(item, tool) && stillSettling(pass, path) ? { is: 'unknown' } : { is: 'absent' };
    if (copies[tool]!.is !== 'unknown') firstSeenMissingAt.delete(path);
  }
  return copies;
}
function stillSettling(pass: Pass, path: string): boolean {
  const first = firstSeenMissingAt.get(path) ?? pass.clock;
  firstSeenMissingAt.set(path, first);
  if (pass.clock - first >= pass.settleMs) return false;
  pass.settling = true;
  return true;
}

/** Brings one agent into line with its harnesses: the library's plan, carried out versions first, files second. */
async function syncItem(pass: Pass, item: LibraryItem) {
  const slot = pass.disk.byKey.get(item.key) ?? {};
  const fileIn = (harness: HarnessId) => slot[harness as AgentTool]!;
  const hashBefore = item.hash;
  const made = plan(item, copiesOf(pass, item));
  // Version first: each content about to give way is kept, the edit taken in is current, and each file about to go is kept
  // as its harness's own part. The item is saved as it will be (the click on it included) before any file changes.
  for (const { harness, from } of made.keep) {
    const here = fileIn(harness);
    await keepVersion(pass.shelf, item, { hash: here.hash, at: iso(here.at), from }, here.agent);
  }
  if (made.takeIn) {
    const edit = fileIn(made.takeIn);
    const from: Source = pass.pulled.has(item.key) ? { how: 'pulled' } : { how: 'edited', harness: edit.tool };
    await setCurrent(pass.shelf, item, { hash: edit.hash, at: iso(edit.at), from }, edit.agent);
  }
  if (made.turnedOffBy) item.on = false;
  for (const harness of made.remove) await keepOwn(pass.context, item, fileIn(harness));
  for (const harness of made.current) item.applied[harness] = item.hash;
  for (const harness of made.forget) delete item.applied[harness];
  await saveIfChanged(pass);
  // Disk second.
  const written: HarnessId[] = [], removed: HarnessId[] = [];
  for (const harness of made.write) if (await writeCopy(pass, item, harness as AgentTool, slot[harness as AgentTool])) written.push(harness);
  for (const harness of made.remove) if (await removeCopy(pass, item, fileIn(harness))) removed.push(harness);
  logItem(pass, item, made, hashBefore, slot, { written, removed });
}

/** Writes the current version into one harness. True when it is there. What stops it is said, not stored: the next pass tries again. */
async function writeCopy(pass: Pass, item: LibraryItem, tool: AgentTool, here: AgentEntry | undefined): Promise<boolean> {
  const held = (message: string) => { pass.results.push({ item: item.name, harness: tool, outcome: 'held', message }); return false; };
  // A harness that can't be given a copy is passed over without a word: its mark on the page says why, at every look.
  if (!here && cannotHold(pass.through, item, tool)) return false;
  const agent = await readVersion(pass.context, item.key, item.hash);
  if (!agent) return held('This version is no longer in Central Knot’s store, so it can’t be written.');
  let text: string;
  // A harness with a file keeps every other byte of it; one without gets back the file it had, or a new one.
  try { text = here ? agentText(tool, agent, here.text) : await fileTextFor(pass.context, item, tool, agent); }
  catch { return held('This file could not be updated without changing other parts of it.'); }
  const path = here?.file ?? fileFor(pass.context, tool, item.name);
  pass.context.fault?.('before-rename');
  try { await writeFileChecked(path, text, here?.text); }
  catch (error) { return held(errorCode(error).startsWith('CK_') ? (error as Error).message : `Could not write ${nameOf(tool)}’s copy.`); }
  item.applied[tool] = item.hash;
  pass.writes++;
  firstSeenMissingAt.delete(path);
  const message = `${here ? 'Now has the current version' : 'Added'}. Start a new session to use it.`;
  pass.results.push({ item: item.name, harness: tool, outcome: 'written', replaced: here ? true : undefined, message });
  return true;
}

/** Removes one harness's copy, only while it still holds what was read (its content and its own part are kept already). */
async function removeCopy(pass: Pass, item: LibraryItem, here: AgentEntry): Promise<boolean> {
  pass.context.fault?.('before-remove');
  try { await removeFileChecked(here.file, here.text); }
  catch (error) {
    // A save that landed between the read and the removal stays; the next pass keeps it as a version and removes it then.
    const changed = errorCode(error) === 'CK_CHANGED', where = nameOf(here.tool);
    const message = changed ? `${where}’s copy changed just now, so it stays until the next look.` : `Could not remove ${where}’s copy yet. Central Knot will try again.`;
    pass.results.push({ item: item.name, harness: here.tool, outcome: changed ? 'held' : 'failed', message });
    return false;
  }
  delete item.applied[here.tool];
  pass.writes++;
  pass.results.push({ item: item.name, harness: here.tool, outcome: 'removed', message: 'Removed. Central Knot keeps it.' });
  return true;
}

/**
 * History's entries for one agent's pass: the click's own (finished with the harnesses it wrote or removed), an edit taken
 * in, and a copy deleted by hand that turned it Off. The last two are also notices, since no one asked for them.
 */
function logItem(pass: Pass, item: LibraryItem, made: Plan, hashBefore: string, slot: Slot, did: { written: HarnessId[]; removed: HarnessId[] }) {
  const key = `agent:${item.key}`;
  const log = (fields: Omit<HistoryEvent, 'id' | 'at' | 'key' | 'item' | 'orderProved'>) => {
    const event: HistoryEvent = { id: randomUUID(), at: now(), key, item: item.name, orderProved: true, ...fields };
    pass.events.push(event);
    return event.id;
  };
  const notice = (kind: SyncNotice['kind'], winner: HarnessId, losers: HarnessId[], history: string) =>
    pass.notices.push({ key, item: item.name, kind, winner, losers, orderProved: true, history });
  /** Each of these harnesses with what it held before the pass. */
  const held = (tools: HarnessId[]) => tools.map(tool => ({ tool, hash: slot[tool as AgentTool]?.hash ?? '' }));
  const asked = pass.clicked.get(item.key);
  if (asked) {
    const { fill, ...entry } = asked;
    const id = log({ ...entry, losers: entry.losers ?? (fill ? held(did[fill]) : []) });
    // A found agent taken in has no click that puts things back as they were, so it is not offered as the click's Undo.
    if (!entry.winner) pass.made.push(id);
    pass.clicked.delete(item.key);
  }
  if (made.takeIn) {
    // The copies edited as well, which gave way to the latest edit: each is a version, and History can make it current.
    const others = made.keep.filter(kept => kept.from.how === 'edited').map(kept => kept.harness);
    const kind = others.length ? 'conflict' : 'edit';
    const losers = held([...new Set([...others, ...did.written])]);
    const id = log({ kind, winner: { tool: made.takeIn, hash: item.hash }, previous: hashBefore, losers });
    notice(kind, made.takeIn, others.length ? others : did.written, id);
  }
  if (made.turnedOffBy) {
    const id = log({ kind: 'off', winner: { tool: made.turnedOffBy, hash: item.hash }, losers: held(did.removed) });
    notice('deleted', made.turnedOffBy, did.removed, id);
  }
}

// ---------- Clicks ----------

type Refuse = (message: string, more?: Partial<DestinationResult>) => void;

/**
 * One click on an agent, recorded on its item (types.ts Change: `managed` is On, `off` the harnesses it is kept out of); the
 * same pass then applies it. A click that can't be taken is a `held` result and changes nothing.
 */
async function click(pass: Pass, change: Change) {
  const known = pass.library.items[change.key];
  const item = known && !known.deleted ? known : undefined;
  const name = known?.name ?? change.key;
  const refuse: Refuse = (message, more = {}) => { pass.results.push({ item: name, outcome: 'held', unchanged: true, message, ...more }); };
  const stale = change.seenManaged !== undefined && !!item?.on !== change.seenManaged;
  if (stale) return refuse(`${name} changed since the page was read. Nothing was changed; read again.`);
  if (change.deleted === false) {
    if (!known?.deleted) return;
    delete known.deleted;
    pass.clicked.set(known.key, { kind: 'restored', fill: 'written' });
  } else if (!item) {
    if (change.managed) await takeIn(pass, change, known, refuse);
  } else if (change.deleted) {
    item.deleted = { at: now() };
    pass.clicked.set(item.key, { kind: 'deleted', fill: 'removed' });
  } else if (change.version) await makeCurrent(pass, item, change.version, refuse);
  else turn(pass, item, change);
}

/** The switches: the agent On or Off, or one harness kept out or let in. */
function turn(pass: Pass, item: LibraryItem, change: Change) {
  const was = { on: item.on, except: item.except };
  Object.assign(item, { on: change.managed, except: [...change.off] } satisfies Partial<LibraryItem>);
  const out = item.except.find(tool => !was.except.includes(tool)), back = was.except.find(tool => !item.except.includes(tool));
  if (was.on !== item.on) pass.clicked.set(item.key, item.on ? { kind: 'on', fill: 'written' } : { kind: 'off', fill: 'removed' });
  else if (out) pass.clicked.set(item.key, { kind: 'off', only: out, fill: 'removed' });
  else if (back) pass.clicked.set(item.key, { kind: 'on', only: back, fill: 'written' });
}

/**
 * Takes a found agent into the library, On: the copy every harness gets is the one they all hold, or, where they differ, the
 * one the person chose (`use`); with no choice made yet, it waits for one. The other copies become versions as the pass
 * writes over them. An agent deleted from Central Knot before is the same item again, its earlier versions with it.
 */
async function takeIn(pass: Pass, change: Change, tombstone: LibraryItem | undefined, refuse: Refuse) {
  const slot = pass.disk.byKey.get(change.key) ?? {};
  const seen = (tool: AgentTool) => slot[tool] && !change.off.includes(tool) && !unseenIn(pass.disk, tool, change.key);
  const found = pass.managed.flatMap(tool => (seen(tool) ? [slot[tool]!] : []));
  if (!found.length) return refuse('No harness has a copy of it to take in any more.');
  const chosen = change.use && change.use !== 'separate' ? slot[change.use as AgentTool] : undefined;
  const changedSince = change.use && (!chosen || (change.useHash && chosen.hash !== change.useHash));
  if (changedSince) return refuse('The copy you chose changed since you chose it. Nothing was changed; choose again.', { chooseAgain: true });
  const differ = new Set(found.map(entry => entry.hash)).size > 1;
  if (differ && !chosen) {
    pass.results.push({ item: found[0].name, outcome: 'held', differs: true, message: 'Copies differ. Choose which copy to use.' });
    return;
  }
  const source = chosen ?? found[0];
  const item = tombstone ?? newItem('agent', change.key, source.name);
  Object.assign(item, { on: true, except: [...change.off], name: source.name } satisfies Partial<LibraryItem>);
  delete item.deleted;
  pass.library.items[item.key] = item;
  const from: Source = pass.pulled.has(item.key) ? { how: 'pulled' } : { how: differ ? 'chosen' : 'found', harness: source.tool };
  await setCurrent(pass.shelf, item, { hash: source.hash, at: iso(source.at), from }, source.agent);
  const winner = { tool: source.tool, hash: source.hash };
  const gaveWay = found.filter(entry => entry.hash !== source.hash).map(entry => ({ tool: entry.tool, hash: entry.hash }));
  pass.clicked.set(item.key, differ ? { kind: 'chosen', winner, losers: gaveWay } : { kind: 'on', winner, fill: 'written' });
}

/** Makes an earlier version current: a new version (library.ts setCurrent), which the pass then applies like any other. */
async function makeCurrent(pass: Pass, item: LibraryItem, version: string, refuse: Refuse) {
  const agent = item.versions.some(known => known.hash === version) ? await readVersion(pass.context, item.key, version) : undefined;
  if (!agent) return refuse('That version is no longer in Central Knot’s store, so it can’t be made current.');
  if (version === item.hash) return refuse(`${item.name} is at that version already.`);
  const previous = item.hash;
  await setCurrent(pass.shelf, item, { hash: version, at: now(), from: { how: 'made-current' } }, agent);
  pass.clicked.set(item.key, { kind: 'current', previous, version, fill: 'written' });
}

/**
 * A History entry's action on an agent. historyactions.ts says which click it is, from the entry and the agent as it is now;
 * that click runs like any other, and the entry is marked done by the entry the click makes.
 */
export async function restoreAgent(context: ShareContext, tools: HarnessId[], eventId: string, version?: string): Promise<McpResult> {
  const past = (await readHistory(context)).find(entry => entry.id === eventId);
  const key = past?.key.replace(/^agent:/, '') ?? '';
  const { library, problem } = await openLibrary(context);
  if (problem) return { stopped: problem, results: [], writes: 0 };
  const action = past && agentAction(past, library.items[key], version);
  if (!action) return { stopped: 'That change has nothing left to undo: the agent is as that would leave it.', results: [], writes: 0 };
  const done = await applyAgents(context, tools, [action.change], { only: new Set([key]) });
  if (!done.made?.length) return done;
  const history = await readHistory(context);
  const entry = history.find(event => event.id === eventId);
  if (entry) { entry.undoneBy = done.made[0]; await replaceHistory(context, history); }
  return done;
}

// ---------- For the callers around a pass ----------

/**
 * Keeps one harness's file as a version of its agent, and as that harness's own part, before something other than a pass
 * writes over it (Pull, gitrepo.ts). An agent that is not in the library has nothing to be kept under.
 */
export async function keepAgentCopy(context: ShareContext, entry: AgentEntry) {
  const { library } = await openLibrary(context, true);
  const item = library.items[entry.key];
  if (!item) return;
  await keepOwn(context, item, entry);
  const shelf = agentShelf(context, () => saveLibrary(context.home, library));
  await keepVersion(shelf, item, { hash: entry.hash, at: iso(entry.at), from: { how: 'was-in', harness: entry.tool } }, entry.agent);
}

/** One version's content, for the Agents page to show: undefined when the store no longer has it. */
export const agentVersion = (context: ShareContext, key: string, hash: string) => readVersion(context, key, hash);

/**
 * Forgets what was applied in harnesses Central Knot no longer manages (toolchoice.ts). A harness managed again later starts
 * as one never applied to: the library wins there, and a copy that differs is kept as a version first.
 */
export async function forgetAgentCopies(context: ShareContext, managed: readonly HarnessId[]) {
  const { library, problem } = await openLibrary(context, true);
  if (problem) return;
  for (const item of Object.values(library.items)) {
    for (const tool of Object.keys(item.applied) as HarnessId[]) if (!managed.includes(tool)) delete item.applied[tool];
  }
  await saveLibrary(context.home, library);
}

/** The agents that are On in the library, by key (the Git repo and plugin parts ask which agents Central Knot keeps in step). */
export async function agentsOn(context: ShareContext): Promise<Map<string, LibraryItem>> {
  const { library } = await openLibrary(context);
  return new Map(Object.values(library.items).filter(item => item.on && !item.deleted).map(item => [item.key, item]));
}

// ---------- View ----------

/**
 * The Agents page's rows: every agent in the library (On, or Off: in Central Knot only) and every found one (in a managed
 * harness, not in the library). `managed` on a row is On; `off` the harnesses it is kept out of. `library` gives the page and
 * History each item as the library holds it, deleted ones too.
 */
export async function agentsView(context: ShareContext, tools: HarnessId[], notices: SyncNotice[] = []): Promise<McpView> {
  const managed = tools.filter(isAgentTool);
  const disk = await readDisk(context, managed);
  const { library, problem } = await openLibrary(context);
  const through = await agentsThroughPlugins(context, managed);
  const live = Object.values(library.items).filter(item => !item.deleted);
  const keys = [...new Set([...disk.byKey.keys(), ...live.map(item => item.key)])].sort((first, second) => first.localeCompare(second));
  const agents: SkillFacts[] = [];
  for (const key of keys) agents.push(await rowFacts(context, managed, disk, through, key, live.find(item => item.key === key)));
  const gate = problem ? { state: 'stopped' as const, reason: problem } : await syncGate(context);
  const problems = problem ? [problem, ...disk.problems] : disk.problems;
  return { tools: managed, servers: agents, library: library.items, claudePending: [], access: await writeAccess(context), gate, problems, notices };
}

/** One agent's row: what each managed harness holds, and for a harness without a copy, why it can't be given one. */
async function rowFacts(context: ShareContext, managed: AgentTool[], disk: Disk, through: ThroughPlugins, key: string, item: LibraryItem | undefined): Promise<SkillFacts> {
  const slot = disk.byKey.get(key) ?? {};
  const entries = managed.flatMap(tool => (slot[tool] ? [slot[tool]!] : []));
  const name = item?.name ?? entries[0].name;
  const current = item ? await readVersion(context, key, item.hash) : entries[0].agent;
  const copies: Partial<Record<HarnessId, ToolCopy>> = {};
  for (const { tool, hash, file, agent, at, name: folder } of entries) {
    const lines = agent.prompt.split('\n').length, ownFields = Object.keys(agent.fields);
    copies[tool] = { hash, directory: file, rootLabel: nameOf(tool), lines, modified: iso(at), summary: agent.description, prompt: agent.prompt, writable: true, folder, ownFields };
  }
  const cannot: SkillFacts['cannot'] = {}, plugin: NonNullable<SkillFacts['plugin']> = {}, unseen: NonNullable<SkillFacts['unseen']> = {};
  for (const tool of managed) {
    const hidden = unseenIn(disk, tool, key), given = through.get(tool)?.get(key);
    if (hidden) unseen[tool] = hidden;
    if (slot[tool]) continue;
    if (given) plugin[tool] = given;
    const why = cannotHold(through, { key, name }, tool);
    if (why) cannot[tool] = why;
  }
  // An edit made in a harness that the next pass takes in.
  const takenInNext = ({ tool, hash, at }: AgentEntry) =>
    !!item && ['take-in', 'latest-wins'].includes(decide(wantedIn(item, tool), item.hash, { is: 'present', hash, at }, item.applied[tool]));
  return {
    key, name, description: current?.description ?? '', copies, extra: [], managed: !!item?.on, off: item?.except ?? [], cannot, choiceBlocks: {},
    edited: entries.filter(takenInNext).map(entry => entry.tool),
    ...(Object.keys(plugin).length ? { plugin } : {}), ...(Object.keys(unseen).length ? { unseen } : {}),
  };
}
