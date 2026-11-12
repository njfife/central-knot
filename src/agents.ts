// Agents on Central Knot's library: the adapter for one kind. Read library.ts first: it holds the model and the one rule.
// This module reads what each managed harness holds of an agent (H), asks the library what to do (plan), and carries the
// answer out. It decides nothing itself. In the order a pass runs:
//
//   readDisk        each managed harness's agent files; a file that can't be read for sure is `unseen`, never missing
//   guardFolders    a folder that moved or was made again: what was applied there is forgotten, so nothing reads as deleted
//   click           what the person asked (On, Off, a harness kept out, a version made current, Delete, Restore, a found
//                   agent taken in), recorded on the item
//   syncItem        the library's plan for the item, carried out: versions first, then each harness's file, by checked
//                   writes and removals (share.ts), so a save that lands meanwhile is never lost
//
// agentsView is the same reading for the Agents page; restoreAgent runs a History entry's action, which is always one of
// the clicks above (historyactions.ts). Where each thing is kept on disk: agentstore.ts. The harnesses' file formats:
// agentfiles.ts.
import { randomUUID } from 'node:crypto';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { agentText, agentsFolder, fileFor, isAgentTool, keyOf, readAgents, safeName, type AgentEntry, type SharedAgent } from './agentfiles.ts';
import { agentShelf, fileTextFor, keepOwn, openLibrary, readVersion, saveLibrary, type AgentLibrary, type FolderSeen } from './agentstore.ts';
import { harnesses, writeRoot } from './harnesses.ts';
import { agentAction } from './historyactions.ts';
import { decide, keepVersion, newItem, plan, setCurrent, wantedIn, type Copies, type LibraryItem, type Plan, type Shelf, type Source } from './library.ts';
import { appendHistory, readConverted, readHistory, recordConverted, replaceHistory } from './manage.ts';
import { throughPlugins } from './plugins.ts';
import { agentTools, type AgentTool } from './presence.ts';
import { errorCode, newRecord, readRecord, recoverParked, remember, removeFileChecked, saveRecord, syncGate, writeAccess, writeFileChecked, type ShareContext } from './share.ts';
import type { Change, DestinationResult, HarnessId, HistoryEvent, McpResult, McpView, SkillFacts, SyncNotice, ThroughPlugin, ToolCopy } from './types.ts';
import { throughPlugin } from './words.ts';

const iso = (ms: number) => new Date(ms).toISOString();
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
    for (const key of read.unreadable.keys()) disk.unseen.set(`${tool}:${key}`, `${nameOf(tool)}’s ${key === '*' ? 'agents folder' : 'file for this agent'} is there but could not be read. Nothing changes there until it reads again.`);
    for (const entry of read.entries) {
      const slot = disk.byKey.get(entry.key) ?? {};
      // Two files whose names differ only by case (a case-sensitive disk): which is which can't be told.
      if (slot[tool]) disk.unseen.set(`${tool}:${entry.key}`, `Two files whose names differ only by case are in ${nameOf(tool)}. Rename one so Central Knot can tell them apart.`);
      slot[tool] = entry;
      disk.byKey.set(entry.key, slot);
    }
  }
  return disk;
}
const unseenIn = (disk: Disk, tool: HarnessId, key: string) => disk.unseen.get(`${tool}:${key}`) ?? disk.unseen.get(`${tool}:*`);

/**
 * The agents each harness has through its installed plugins, by key: such a harness gets no file of its own beside the
 * plugin's. Only an agent Central Knot installed elsewhere as that plugin's part counts: a name alone could be another agent.
 */
async function agentsThroughPlugins(context: ShareContext, tools: HarnessId[]): Promise<Map<HarnessId, Map<string, ThroughPlugin>>> {
  const all = await throughPlugins(context, tools, 'agent', keyOf);
  return new Map([...all].map(([tool, given]) => [tool, new Map([...given].flatMap(([key, { asParts, text: _text, ...plugin }]) => (asParts ? [[key, plugin] as const] : [])))]));
}

// ---------- A pass ----------

/** A click's History entry, begun when the click is recorded and finished once its files are written (`fill`: which of them it names). */
type ClickEntry = Omit<HistoryEvent, 'id' | 'at' | 'key' | 'item' | 'losers' | 'orderProved'> & { losers?: HistoryEvent['losers']; fill?: 'written' | 'removed' };
interface Pass {
  context: ShareContext; managed: AgentTool[]; library: AgentLibrary; disk: Disk; shelf: Shelf<SharedAgent>;
  /** The record as last saved, to save it again only when it changed. */
  saved: string;
  through: Awaited<ReturnType<typeof agentsThroughPlugins>>;
  /** The settle window: how long a copy must stay missing before it counts as deleted by hand, and the clock it is measured on. */
  now: number; settleMs: number;
  pulled: Set<string>;
  foldersNow: AgentLibrary['folders'];
  clicked: Map<string, ClickEntry>;
  results: DestinationResult[]; events: HistoryEvent[]; notices: SyncNotice[]; writes: number; made: string[]; settling: boolean;
}

/** When each file was first seen missing, kept while the app runs (the settle window). A restart forgets them, which only delays an Off. */
const firstSeenMissingAt = new Map<string, number>();

/**
 * One pass: the clicks in `changes`, then every agent in the library brought into line with its harnesses (library.ts plan).
 * `only`: with Automatic sync off, a click's pass concerns the agents it names and nothing else spreads (SYN-03).
 * `pulled`: agents whose new content Pull just wrote into one harness (gitrepo.ts), so the version taken in says so.
 */
export async function applyAgents(context: ShareContext, tools: HarnessId[], changes: Change[], options: { settleMs?: number; now?: number; only?: Set<string>; resume?: boolean; pulled?: Set<string> } = {}): Promise<McpResult> {
  const refused = await refusal(context, changes.length > 0, options.resume);
  if (refused) return refused;
  const { library, problem } = await openLibrary(context, true);
  if (problem) return { stopped: problem, results: [], writes: 0 };
  const managed = tools.filter(isAgentTool);
  // A write or removal a crash interrupted is finished first, so a file moved aside is never read as deleted.
  for (const tool of managed) await recoverParked(agentsFolder(context, tool));
  const pass: Pass = { context, managed, library, disk: await readDisk(context, managed), saved: JSON.stringify(library), shelf: agentShelf(context, () => saveIfChanged(pass)), through: await agentsThroughPlugins(context, managed),
    now: options.now ?? Date.now(), settleMs: options.settleMs ?? context.settleMs ?? 2000, pulled: options.pulled ?? new Set(),
    foldersNow: {}, clicked: new Map(), results: [], events: [], notices: [], writes: 0, made: [], settling: false };
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
  const now = JSON.stringify(pass.library);
  if (now === pass.saved) return;
  await saveLibrary(pass.context.home, pass.library);
  pass.saved = now;
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
    const now: FolderSeen = info ? { path, ino: info.ino, birth: Math.round(info.birthtimeMs) } : { path, away: true };
    pass.foldersNow[tool] = now;
    if (!was || 'away' in now) continue;
    const moved = was.path !== path, remade = 'away' in was || was.ino !== now.ino || was.birth !== now.birth;
    for (const item of items) if (moved || (remade && !pass.disk.byKey.get(item.key)?.[tool])) delete item.applied[tool];
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
    if (unseenIn(pass.disk, tool, item.key) || (!pass.disk.folders.has(tool) && applied)) copies[tool] = { is: 'unknown' };
    else if (here) copies[tool] = { is: 'present', hash: here.hash, at: here.at };
    else copies[tool] = applied && wantedIn(item, tool) && stillSettling(pass, path) ? { is: 'unknown' } : { is: 'absent' };
    if (copies[tool]!.is !== 'unknown') firstSeenMissingAt.delete(path);
  }
  return copies;
}
function stillSettling(pass: Pass, path: string): boolean {
  const first = firstSeenMissingAt.get(path) ?? pass.now;
  firstSeenMissingAt.set(path, first);
  if (pass.now - first >= pass.settleMs) return false;
  pass.settling = true;
  return true;
}

/** Brings one agent into line with its harnesses: the library's plan, carried out versions first, files second. */
async function syncItem(pass: Pass, item: LibraryItem) {
  const slot = pass.disk.byKey.get(item.key) ?? {};
  const hashBefore = item.hash;
  const made = plan(item, copiesOf(pass, item));
  // Version first: each content about to give way is kept, the edit taken in is current, and each file about to go is kept
  // as its harness's own part. The item is saved as it will be (the click on it included) before any file changes.
  for (const { harness, from } of made.keep) { const here = slot[harness as AgentTool]!; await keepVersion(pass.shelf, item, { hash: here.hash, at: iso(here.at), from }, here.agent); }
  const edit = made.takeIn ? slot[made.takeIn as AgentTool]! : undefined;
  if (edit) { await setCurrent(pass.shelf, item, { hash: edit.hash, at: iso(edit.at), from: pass.pulled.has(item.key) ? { how: 'pulled' } : { how: 'edited', harness: edit.tool } }, edit.agent); item.applied[edit.tool] = edit.hash; }
  if (made.turnedOffBy) item.on = false;
  for (const harness of made.remove) await keepOwn(pass.context, item, slot[harness as AgentTool]!);
  for (const harness of made.current) item.applied[harness] = item.hash;
  for (const harness of made.forget) delete item.applied[harness];
  await saveIfChanged(pass);
  // Disk second.
  const written: HarnessId[] = [], removed: HarnessId[] = [];
  for (const harness of made.write) if (await writeCopy(pass, item, harness as AgentTool, slot[harness as AgentTool])) written.push(harness);
  for (const harness of made.remove) if (await removeCopy(pass, item, slot[harness as AgentTool]!)) removed.push(harness);
  logItem(pass, item, made, hashBefore, slot, { written, removed });
}

/** Why a harness with no copy can't be given one, if it can't. Worked out at each pass and never stored. */
function cannotHold(through: Pass['through'], item: Pick<LibraryItem, 'key' | 'name'>, tool: HarnessId): string | undefined {
  const given = through.get(tool)?.get(item.key);
  if (given) return throughPlugin(tool, given, 'agent');
  return safeName(item.name) ? undefined : 'This name can’t be a file name here.';
}

/** Writes the current version into one harness. True when it is there. What stops it is said, not stored: the next pass tries again. */
async function writeCopy(pass: Pass, item: LibraryItem, tool: AgentTool, here: AgentEntry | undefined): Promise<boolean> {
  const held = (message: string) => { pass.results.push({ item: item.name, harness: tool, outcome: 'held', message }); return false; };
  const cannot = here ? undefined : cannotHold(pass.through, item, tool);
  if (cannot) return held(cannot);
  const agent = await readVersion(pass.context, item.key, item.hash);
  if (!agent) return held('This version is no longer in Central Knot’s store, so it can’t be written.');
  let text: string;
  // A harness with a file keeps every other byte of it; one without gets back the file it had, or a new one.
  try { text = here ? agentText(tool, agent, here.text) : await fileTextFor(pass.context, item, tool, agent); } catch { return held('This file could not be updated without changing other parts of it.'); }
  const path = here?.file ?? fileFor(pass.context, tool, item.name);
  pass.context.fault?.('before-rename');
  try { await writeFileChecked(path, text, here?.text); }
  catch (error) { return held(errorCode(error).startsWith('CK_') ? (error as Error).message : `Could not write ${nameOf(tool)}’s copy.`); }
  item.applied[tool] = item.hash;
  pass.writes++;
  firstSeenMissingAt.delete(path);
  pass.results.push({ item: item.name, harness: tool, outcome: 'written', replaced: here ? true : undefined, message: `${here ? 'Now has the current version' : 'Added'}. Start a new session to use it.` });
  return true;
}

/** Removes one harness's copy, only while it still holds what was read (its content and its own part are kept already). */
async function removeCopy(pass: Pass, item: LibraryItem, here: AgentEntry): Promise<boolean> {
  pass.context.fault?.('before-remove');
  try { await removeFileChecked(here.file, here.text); }
  catch (error) {
    const changed = errorCode(error) === 'CK_CHANGED';
    pass.results.push({ item: item.name, harness: here.tool, outcome: changed ? 'held' : 'failed', message: changed ? `${nameOf(here.tool)}’s copy changed just now, so it stays until the next look.` : `Could not remove ${nameOf(here.tool)}’s copy yet. Central Knot will try again.` });
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
  const log = (fields: Omit<HistoryEvent, 'id' | 'at' | 'key' | 'item' | 'orderProved'>) => {
    const event: HistoryEvent = { id: randomUUID(), at: new Date().toISOString(), key: `agent:${item.key}`, item: item.name, orderProved: true, ...fields };
    pass.events.push(event);
    return event.id;
  };
  const notice = (kind: SyncNotice['kind'], winner: HarnessId, losers: HarnessId[], history: string) => pass.notices.push({ key: `agent:${item.key}`, item: item.name, kind, winner, losers, orderProved: true, history });
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
    const id = log({ kind, winner: { tool: made.takeIn, hash: item.hash }, previous: hashBefore, losers: held([...new Set([...others, ...did.written])]) });
    notice(kind, made.takeIn, others.length ? others : did.written, id);
  }
  if (made.turnedOffBy) notice('deleted', made.turnedOffBy, did.removed, log({ kind: 'off', winner: { tool: made.turnedOffBy, hash: item.hash }, losers: held(did.removed) }));
}

// ---------- Clicks ----------

/**
 * One click on an agent, recorded on its item (types.ts Change: `managed` is On, `off` the harnesses it is kept out of); the
 * same pass then applies it. A click that can't be taken is a `held` result and changes nothing.
 */
async function click(pass: Pass, change: Change) {
  const known = pass.library.items[change.key];
  const item = known && !known.deleted ? known : undefined;
  const held = (message: string, more: Partial<DestinationResult> = {}) => { pass.results.push({ item: known?.name ?? change.key, outcome: 'held', unchanged: true, message, ...more }); };
  if (change.seenManaged !== undefined && !!item?.on !== change.seenManaged) return held(`${known?.name ?? change.key} changed since the page was read. Nothing was changed; read again.`);
  if (change.deleted === false) { if (known?.deleted) { delete known.deleted; pass.clicked.set(known.key, { kind: 'restored', fill: 'written' }); } return; }
  if (!item) { if (change.managed) await takeIn(pass, change, known, held); return; }
  if (change.deleted) { item.deleted = { at: new Date().toISOString() }; pass.clicked.set(item.key, { kind: 'deleted', fill: 'removed' }); return; }
  if (change.version) return makeCurrent(pass, item, change.version, held);
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
async function takeIn(pass: Pass, change: Change, tombstone: LibraryItem | undefined, held: (message: string, more?: Partial<DestinationResult>) => void) {
  const slot = pass.disk.byKey.get(change.key) ?? {};
  const found = pass.managed.flatMap(tool => (slot[tool] && !change.off.includes(tool) && !unseenIn(pass.disk, tool, change.key) ? [slot[tool]!] : []));
  if (!found.length) return held('No harness has a copy of it to take in any more.');
  const chosen = change.use && change.use !== 'separate' ? slot[change.use as AgentTool] : undefined;
  if (change.use && (!chosen || (change.useHash && chosen.hash !== change.useHash))) return held('The copy you chose changed since you chose it. Nothing was changed; choose again.', { chooseAgain: true });
  const differ = new Set(found.map(entry => entry.hash)).size > 1;
  if (differ && !chosen) { pass.results.push({ item: found[0].name, outcome: 'held', differs: true, message: 'Copies differ. Choose which copy to use.' }); return; }
  const source = chosen ?? found[0];
  const item = Object.assign(tombstone ?? newItem('agent', change.key, source.name), { on: true, except: [...change.off], name: source.name } satisfies Partial<LibraryItem>);
  delete item.deleted;
  pass.library.items[item.key] = item;
  const from: Source = pass.pulled.has(item.key) ? { how: 'pulled' } : { how: differ ? 'chosen' : 'found', harness: source.tool };
  await setCurrent(pass.shelf, item, { hash: source.hash, at: iso(source.at), from }, source.agent);
  const winner = { tool: source.tool, hash: source.hash };
  const gaveWay = found.filter(entry => entry.hash !== source.hash).map(entry => ({ tool: entry.tool, hash: entry.hash }));
  pass.clicked.set(item.key, differ ? { kind: 'chosen', winner, losers: gaveWay } : { kind: 'on', winner, fill: 'written' });
}

/** Makes an earlier version current: a new version (library.ts setCurrent), which the pass then applies like any other. */
async function makeCurrent(pass: Pass, item: LibraryItem, version: string, held: (message: string) => void) {
  const agent = item.versions.some(known => known.hash === version) ? await readVersion(pass.context, item.key, version) : undefined;
  if (!agent) return held('That version is no longer in Central Knot’s store, so it can’t be made current.');
  if (version === item.hash) return held(`${item.name} is at that version already.`);
  const previous = item.hash;
  await setCurrent(pass.shelf, item, { hash: version, at: new Date().toISOString(), from: { how: 'made-current' } }, agent);
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
  if (done.made?.length) {
    const history = await readHistory(context);
    const entry = history.find(event => event.id === eventId);
    if (entry) { entry.undoneBy = done.made[0]; await replaceHistory(context, history); }
  }
  return done;
}

/**
 * Keeps one harness's file as a version of its agent, and as that harness's own part, before something other than a pass
 * writes over it (Pull, gitrepo.ts). An agent that is not in the library has nothing to be kept under.
 */
export async function keepAgentCopy(context: ShareContext, entry: AgentEntry) {
  const { library } = await openLibrary(context, true);
  const item = library.items[entry.key];
  if (!item) return;
  await keepOwn(context, item, entry);
  await keepVersion(agentShelf(context, () => saveLibrary(context.home, library)), item, { hash: entry.hash, at: iso(entry.at), from: { how: 'was-in', harness: entry.tool } }, entry.agent);
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
  for (const item of Object.values(library.items)) for (const tool of Object.keys(item.applied) as HarnessId[]) if (!managed.includes(tool)) delete item.applied[tool];
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
  const agents: SkillFacts[] = [];
  for (const key of [...new Set([...disk.byKey.keys(), ...live.map(item => item.key)])].sort((first, second) => first.localeCompare(second))) {
    agents.push(await rowFacts(context, managed, disk, through, key, live.find(item => item.key === key)));
  }
  return { tools: managed, servers: agents, library: library.items, claudePending: [], access: await writeAccess(context), gate: problem ? { state: 'stopped', reason: problem } : await syncGate(context),
    problems: problem ? [problem, ...disk.problems] : disk.problems, notices };
}

/** One agent's row: what each managed harness holds, and for a harness without a copy, why it can't be given one. */
async function rowFacts(context: ShareContext, managed: AgentTool[], disk: Disk, through: Pass['through'], key: string, item: LibraryItem | undefined): Promise<SkillFacts> {
  const slot = disk.byKey.get(key) ?? {};
  const entries = managed.flatMap(tool => (slot[tool] ? [slot[tool]!] : []));
  const name = item?.name ?? entries[0].name;
  const current = item ? await readVersion(context, key, item.hash) : entries[0].agent;
  const copies: Partial<Record<HarnessId, ToolCopy>> = {};
  for (const entry of entries) {
    copies[entry.tool] = { hash: entry.hash, directory: entry.file, rootLabel: nameOf(entry.tool), lines: entry.agent.prompt.split('\n').length, modified: iso(entry.at), summary: entry.agent.description,
      prompt: entry.agent.prompt, writable: true, folder: entry.name, ownFields: Object.keys(entry.agent.fields) };
  }
  const cannot: Partial<Record<HarnessId, string>> = {}, plugin: Partial<Record<HarnessId, ThroughPlugin>> = {}, unseen: Partial<Record<HarnessId, string>> = {};
  for (const tool of managed) {
    const hidden = unseenIn(disk, tool, key), given = through.get(tool)?.get(key);
    if (hidden) unseen[tool] = hidden;
    if (slot[tool]) continue;
    if (given) plugin[tool] = given;
    const why = cannotHold(through, { key, name }, tool);
    if (why) cannot[tool] = why;
  }
  // An edit made in a harness that the next pass takes in.
  const edited = item ? entries.filter(entry => ['take-in', 'latest-wins'].includes(decide(wantedIn(item, entry.tool), item.hash, { is: 'present', hash: entry.hash, at: entry.at }, item.applied[entry.tool]))).map(entry => entry.tool) : [];
  return { key, name, description: current?.description ?? '', copies, extra: [], managed: !!item?.on, off: item?.except ?? [], cannot, ...(Object.keys(plugin).length ? { plugin } : {}),
    ...(Object.keys(unseen).length ? { unseen } : {}), edited, choiceBlocks: {} };
}

// ---------- Convert to skill ----------

/** What an agent has that a skill never does (AGT-02): said on the converted skill, never "agent installed". */
export const conversionLosses = ['its own isolated context', 'tool restrictions', 'model selection', 'being picked as an agent (it is invoked as a skill)'];

/**
 * Convert to skill (AGT-02): a one-time snapshot of an agent as an ordinary skill, for Pi, which has no native agents. It is written
 * to Pi's own skills folder (no root the agent's tool reads, AGT-03) and where it came from is recorded, so it is never placed back
 * in that tool automatically. Skill edits never write to any agent. The caller then manages it like any skill.
 */
export async function convertAgentToSkill(context: ShareContext, tools: HarnessId[], key: string): Promise<{ stopped?: string; skill?: string; origin?: HarnessId }> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason };
  if (!tools.includes('pi-cli')) return { stopped: 'Pi is not in this home, so there is nowhere to convert to.' };
  const slot = (await readDisk(context, tools.filter(isAgentTool))).byKey.get(key);
  // The copy with the most of the agent: Claude Code's first, as the fullest format.
  const origin = agentTools.find(tool => slot?.[tool]);
  const entry = origin ? slot![origin]! : undefined;
  if (!entry || !origin) return { stopped: 'That agent is not there any more.' };
  if (!entry.agent.description.trim()) return { stopped: `Pi skips a skill with no description, and “${entry.name}” has none. Add one to the agent first.` };
  if (!safeName(entry.name)) return { stopped: 'This agent’s name can’t be a folder name.' };
  const folder = join(writeRoot(harnesses['pi-cli'], context.home, context.overrides?.['pi-cli']), entry.name);
  try { await stat(folder); return { stopped: `Pi already has a skill named “${entry.name}”. Nothing was written.` }; } catch { /* free */ }
  if ((await readConverted(context.home))[entry.name.toLowerCase()]) return { stopped: `“${entry.name}” was converted before.` };
  const text = `---\nname: ${JSON.stringify(entry.name)}\ndescription: ${JSON.stringify(entry.agent.description)}\n---\n\n${entry.agent.prompt.replace(/^\s+/, '')}${entry.agent.prompt.endsWith('\n') ? '' : '\n'}`;
  await mkdir(folder, { recursive: true });
  await writeFileChecked(join(folder, 'SKILL.md'), text, undefined);
  await recordConverted(context.home, entry.name.toLowerCase(), { agent: entry.name, origin, at: new Date().toISOString(), losses: [...conversionLosses, ...Object.keys(entry.agent.fields).map(field => `“${field}”`)] });
  return { skill: entry.name.toLowerCase(), origin };
}
