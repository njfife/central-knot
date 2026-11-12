// Agents on Central Knot's library: the adapter for one kind. Read library.ts first: it holds the model, the one rule for an
// item in the library (decide, plan) and the order a plan is carried out in (carryOut). This module decides what can be seen
// of an agent in each managed harness (H: copiesOf, with the guards), which copy a found agent is taken in from (takeIn,
// foundCopies) and what Pull brings (pull); it carries the library's answer out by checked writes and removals (share.ts),
// so a save that lands meanwhile is never lost. In the order a pass runs (applyAgents):
//
//   lookAt         each managed harness's agent files (readDisk; a file that can't be read for sure is unseen, never missing)
//   deletionsTold  a deleted agent that History has no standing entry for gets one, so it always has its Restore
//   pull, click    what Pull brings, and what the person asked (On, Off, a harness kept out, a version made current, Delete,
//                  Restore, a found agent taken in), recorded on the item
//   guardFolders   on the items as the clicks left them: a harness managed again, a folder moved, made again or gone
//   syncItem       the library's plan for the item (from copiesOf), carried out by carryOut: History first (logItem), then
//                  versions and the record, then each harness's file
//   keepFolders    the folder identities the next pass compares with
//
// agentsView is the same reading (lookAt, guardFolders, copiesOf, plan) for the Agents page, so a mark says what a pass will do;
// restoreAgent runs a History entry's action, which is always one of the clicks above (historyactions.ts). Elsewhere: where
// each thing is kept on disk, agentstore.ts; the harnesses' file formats, agentfiles.ts; an agent's row and the clicks its
// controls send, agentrow.ts; Convert to skill, agentskill.ts; the Git repo's Push and Pull, gitrepo.ts (agentsForRepo, pull).
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { agentHash, agentText, agentsFolder, changedFields, fileFor, isAgentTool, keyOf, nameProblem, readAgents, type AgentEntry, type SharedAgent, type VersionChange } from './agentfiles.ts';
import { agentShelf, fileTextFor, keepOwn, openLibrary, readVersion, saveLibrary, type AgentLibrary, type FolderSeen } from './agentstore.ts';
import { agentAction } from './historyactions.ts';
import { carryOut, keepVersion, listed, newItem, plan, setCurrent, wantedIn } from './library.ts';
import type { Copies, HarnessCopy, LibraryItem, Plan, Shelf, Source, Version } from './library.ts';
import { appendHistory, historyCutoff, readHistory, replaceHistory } from './manage.ts';
import { throughPlugins } from './plugins.ts';
import type { AgentTool } from './presence.ts';
import { errorCode, exists, newRecord, sha256, readRecord, recoverParked, remember, removeFileChecked, saveRecord, syncGate, writeAccess, writeFileChecked } from './share.ts';
import type { ShareContext } from './share.ts';
import type { Change, DestinationResult, HarnessId, HistoryEvent, McpResult, McpView, SkillFacts, SyncNotice, ThroughPlugin, ToolCopy } from './types.ts';
import { throughPlugin, toolName } from './words.ts';

const iso = (ms: number) => new Date(ms).toISOString();
const now = () => new Date().toISOString();
const nameOf = (tool: HarnessId) => toolName(tool);

// ---------- What the harnesses hold ----------

type Slot = Partial<Record<AgentTool, AgentEntry>>;
/** The managed harnesses' agent files now, by agent then harness, and what can't be seen for sure. */
interface Disk {
  byKey: Map<string, Slot>;
  /** Why an agent's copy in a harness can't be seen for sure, by `harness:key` (`harness:*`: its whole folder). */
  unseen: Map<string, string>;
  /** Why a harness's agents folder can't be written now, so no copy there can be written or removed. */
  locked: Map<HarnessId, string>;
  problems: string[];
}

async function readDisk(context: ShareContext, managed: AgentTool[]): Promise<Disk> {
  const disk: Disk = { byKey: new Map(), unseen: new Map(), locked: new Map(), problems: [] };
  for (const tool of managed) {
    const read = await readAgents(context, tool), folder = agentsFolder(context, tool);
    disk.problems.push(...read.problems);
    const locked = `${nameOf(tool)}’s agents folder can’t be written, so Central Knot can’t change the agent there. `
      + `Once the folder’s permissions let it, ${nameOf(tool)} catches up when sync runs.`;
    if (await exists(folder) && await access(folder, constants.W_OK).then(() => false, () => true)) disk.locked.set(tool, locked);
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

/**
 * Why a harness can't take the agent, if it can't: the one place that decides it, worked out at each look and never stored.
 * Where it has no copy: a plugin brings the agent there, or its name can't be stored there. Where it has one, or none: its
 * agents folder can't be written. Read by a pass (copyIn: a held copy where it has none) and by the page (rowFacts: also
 * where the plan writes over or removes its copy). An edit in a folder that can't be written is still read and taken in;
 * only the writes and removals there wait, and writeCopy and removeCopy say so when they fail.
 */
function cannotTake(look: Look, item: Pick<LibraryItem, 'key' | 'name'>, tool: HarnessId, hasCopy: boolean): string | undefined {
  const given = hasCopy ? undefined : look.through.get(tool)?.get(item.key);
  if (given) return throughPlugin(tool, given, 'agent');
  const why = hasCopy ? undefined : nameProblem(item.name);
  // Where to rename it: a tool that has it.
  const holder = look.managed.find(other => look.disk.byKey.get(item.key)?.[other]);
  if (why) return `${nameOf(tool)} can’t store this name (${why}). Rename it ${holder ? `in ${nameOf(holder)} ` : ''}to use it there.`;
  return look.disk.locked.get(tool);
}

/**
 * What one pass, or one look of the Agents page, read once: the managed harnesses' agent files, what their plugins bring,
 * each agents folder as it is now, and (`settle`) the settle window's clock. Only a pass has that clock: the page's look
 * reads the window as passed and records nothing, so its marks say what the pass will do once the window has passed.
 */
interface Look {
  context: ShareContext; managed: AgentTool[]; library: AgentLibrary; disk: Disk; through: ThroughPlugins;
  foldersNow: AgentLibrary['folders'];
  /** How long a copy must stay missing before it counts as deleted by hand, the clock it is measured on, and whether a copy is inside it now. */
  settle?: { clock: number; ms: number; settling: boolean };
}

/** Reads the managed harnesses once. The guards come after (guardFolders), once a pass's clicks are on its items. */
async function lookAt(context: ShareContext, managed: AgentTool[], library: AgentLibrary, settle?: Look['settle']): Promise<Look> {
  return { context, managed, library, disk: await readDisk(context, managed), through: await agentsThroughPlugins(context, managed), foldersNow: {}, settle };
}

/**
 * "H unknown is never H gone" for a whole folder, run on `items` as a pass's clicks left them. When a tool comes back (managed
 * again after it was uninstalled or left out by the tool choice, so its folder's identity was let go: keepFolders), what was
 * applied there is forgotten for every agent in the library wanted there, whichever pass sees it first: each is written there
 * afresh, and a copy that went while the tool was out is never read as deleted by hand. An agent not wanted there keeps it:
 * a copy Central Knot put there is still its own to remove. A folder somewhere else than at the last full pass (its config
 * root moved), made again since (a reset or reinstall, or back after being away), or gone for longer than the settle window
 * has what was applied there forgotten for the pass's items (a click's pass leaves the identity for the next full pass). A
 * folder that is gone is unseen inside the settle window, and afterwards for an agent whose removal it still owes, which
 * waits for the folder.
 */
async function guardFolders(look: Look, items: LibraryItem[]) {
  for (const tool of look.managed) {
    const path = agentsFolder(look.context, tool), was = look.library.folders[tool];
    const info = await stat(path).catch(() => undefined);
    const here: FolderSeen = info?.isDirectory() ? { path, ino: info.ino, birth: Math.round(info.birthtimeMs) } : { path, away: true };
    look.foldersNow[tool] = here;
    const forget = (which: LibraryItem[]) => { for (const item of which) delete item.applied[tool]; };
    if ('away' in here) {
      const applied = items.filter(item => item.applied[tool] !== undefined);
      if (!applied.length) continue;
      const waiting = stillSettling(look, path);
      if (waiting) look.disk.unseen.set(`${tool}:*`, `${nameOf(tool)}’s agents folder isn’t there just now. If it stays away, Central Knot writes it afresh.`);
      if (waiting) continue;
      forget(applied.filter(item => wantedIn(item, tool)));
      const owed = `${nameOf(tool)}’s agents folder isn’t there. Its copy is removed once the folder is back.`;
      for (const item of applied.filter(item => !wantedIn(item, tool))) look.disk.unseen.set(`${tool}:${item.key}`, owed);
      continue;
    }
    seenAgain(look, path);
    // Every agent, not only the pass's own: a click's pass notes the folder (keepFolders), so the next pass can't tell.
    if (!was) { forget(Object.values(look.library.items).filter(item => wantedIn(item, tool))); continue; }
    const moved = was.path !== path;
    if (moved) forget(items);
    else if ('away' in was || was.ino !== here.ino || was.birth !== here.birth) forget(items.filter(item => !look.disk.byKey.get(item.key)?.[tool]));
  }
}

/**
 * H for each managed harness (library.ts HarnessCopy): the one place that says what a harness holds of an agent, read by a
 * pass and by the page. `unknown`, so that nothing happens there: a file that can't be read for sure, a folder away inside the
 * settle window, and a copy missing for less than the settle window (an editor's save moves the file away for a moment).
 * `held`: a harness the agent should be in that can't be given a copy (cannotTake).
 */
function copiesOf(look: Look, item: LibraryItem): Copies {
  const slot = look.disk.byKey.get(item.key) ?? {};
  return Object.fromEntries(look.managed.map(tool => [tool, copyIn(look, item, tool, slot[tool])]));
}
function copyIn(look: Look, item: LibraryItem, tool: AgentTool, here: AgentEntry | undefined): HarnessCopy {
  const unseen = unseenIn(look.disk, tool, item.key);
  if (unseen) return { is: 'unknown', why: unseen };
  const path = here?.file ?? fileFor(look.context, tool, item.name);
  if (here) { seenAgain(look, path); return { is: 'present', hash: here.hash, at: here.at }; }
  const wanted = wantedIn(item, tool), cannot = wanted ? cannotTake(look, item, tool, false) : undefined;
  if (cannot) return { is: 'held', why: cannot };
  const missing = `${nameOf(tool)}’s file for it is missing just now. If it stays missing, the agent turns off everywhere.`;
  if (wanted && item.applied[tool] !== undefined && stillSettling(look, path)) return { is: 'unknown', why: missing };
  seenAgain(look, path);
  return { is: 'absent' };
}

/** When each file or folder was first seen missing, kept while the app runs (the settle window). A restart forgets them, which only delays an Off. */
const firstSeenMissingAt = new Map<string, number>();
/** Whether something missing at `path` may still be a save in progress. Only a pass keeps the clock (Look `settle`). */
function stillSettling(look: Look, path: string): boolean {
  if (!look.settle) return false;
  // A clock that went back (the system's, or a test's) restarts the window rather than holding it open.
  const first = Math.min(firstSeenMissingAt.get(path) ?? look.settle.clock, look.settle.clock);
  firstSeenMissingAt.set(path, first);
  if (look.settle.clock - first >= look.settle.ms) return false;
  look.settle.settling = true;
  return true;
}
const seenAgain = (look: Look, path: string) => { if (look.settle) firstSeenMissingAt.delete(path); };

/**
 * The copies a found agent is taken in from: one per managed harness that has it, can be read and isn't kept out (`off`).
 * Where they differ, the person chooses which one every harness takes (the copy question): the switch asks, and takeIn waits.
 */
function foundCopies(look: Look, key: string, off: readonly HarnessId[]): AgentEntry[] {
  const slot = look.disk.byKey.get(key) ?? {};
  return look.managed.flatMap(tool => (slot[tool] && !off.includes(tool) && !unseenIn(look.disk, tool, key) ? [slot[tool]!] : []));
}
const differ = (copies: AgentEntry[]) => new Set(copies.map(entry => entry.hash)).size > 1;

// ---------- A pass ----------

/**
 * What was asked of a pass for one agent (a click, or what Pull brings), as the History entry it becomes: begun when it is
 * recorded, finished with the harnesses its plan writes or removes (`fill`: which of them it names).
 */
type Asked = Pick<HistoryEvent, 'kind' | 'cause' | 'winner' | 'only' | 'version' | 'previous'> & { losers?: HistoryEvent['losers']; fill?: 'written' | 'removed' };
/** What Pull brings for one agent (gitrepo.ts): its shared part and the repo's whole file (Claude Code's own part), or its removal. */
export type Pulled = { agent: SharedAgent; claudeFile: string } | { removed: true };
interface Pass extends Look {
  shelf: Shelf<SharedAgent>;
  /** The record as last saved, to save it again only when it changed. */
  saved: string;
  /** What was asked of this pass for each agent (a click, or Pull), as the History entry it becomes. */
  asked: Map<string, Asked>;
  results: DestinationResult[]; notices: SyncNotice[]; writes: number; made: string[];
}
/** What may be asked of a pass besides its clicks. */
export interface PassOptions {
  /** With Automatic sync off, a click's pass concerns the agents it names and nothing else spreads (SYN-03). */
  only?: Set<string>;
  /** An explicit Resume, for a record this app has no memory of. */
  resume?: boolean;
  /** What Pull brings, by agent (gitrepo.ts): each becomes that agent's current version before the pass (pull). */
  pulled?: Map<string, Pulled>;
  /** The settle window and its clock; tests pass their own. */
  settleMs?: number; now?: number;
}

/** One pass: the clicks in `changes`, then every agent in the library brought into line with its harnesses (library.ts plan). */
export async function applyAgents(context: ShareContext, tools: HarnessId[], changes: Change[], options: PassOptions = {}): Promise<McpResult> {
  const refused = await refusal(context, changes.length > 0 || !!options.pulled?.size, options.resume);
  if (refused) return refused;
  const { library, problem } = await openLibrary(context, true);
  if (problem) return { stopped: problem, results: [], writes: 0 };
  const managed = tools.filter(isAgentTool);
  // A write or removal a crash interrupted is finished first, so a file moved aside is never read as deleted.
  for (const tool of managed) await recoverParked(agentsFolder(context, tool));
  const saved = JSON.stringify(library);
  const inScope = (key: string) => !options.only || options.only.has(key) || changes.some(change => change.key === key);
  const settle = { clock: options.now ?? Date.now(), ms: options.settleMs ?? context.settleMs ?? 2000, settling: false };
  const look = await lookAt(context, managed, library, settle);
  const pass: Pass = {
    ...look, shelf: agentShelf(context, () => saveIfChanged(pass)), saved, asked: new Map(), results: [], notices: [], writes: 0, made: [],
  };
  await deletionsTold(pass);
  for (const [key, brought] of options.pulled ?? []) await pull(pass, key, brought);
  for (const change of changes) await click(pass, change);
  const items = Object.values(library.items).filter(item => inScope(item.key));
  await guardFolders(pass, items);
  for (const item of items) await syncItem(pass, item);
  keepFolders(library, pass.foldersNow, managed, !options.only);
  await saveIfChanged(pass);
  return { results: pass.results, writes: pass.writes, notices: pass.notices, settling: settle.settling, made: pass.made };
}

/**
 * The folder identities a pass leaves on the record (guardFolders reads them): those of harnesses no longer managed are let
 * go, so one managed again is told apart; one seen for the first time (a tool back: guardFolders has just let go what was
 * applied there for every agent wanted there) is noted by any pass; and a full pass moves every identity on. A click's pass with Sync off moves no
 * known one on: the agents it leaves alone must still see a reset at the next full pass.
 */
function keepFolders(library: AgentLibrary, now: AgentLibrary['folders'], managed: readonly HarnessId[], full: boolean) {
  const still = Object.fromEntries(Object.entries(library.folders).filter(([tool]) => managed.includes(tool as HarnessId)));
  library.folders = full ? { ...still, ...now } : { ...now, ...still };
}

/** Saves the record when it is not as last saved: before any harness file changes (syncItem), and when the pass ends. */
async function saveIfChanged(pass: Pass) {
  const text = JSON.stringify(pass.library);
  if (text === pass.saved) return;
  await saveLibrary(pass.context.home, pass.library);
  pass.saved = text;
}

/**
 * Why nothing may be written right now, if so: a preview-only home, another build's record, or one that needs Resume. A home
 * with no sync record yet gets one when something is asked of the pass (`asked`: a click, or what Pull brings); else it has nothing to do.
 */
async function refusal(context: ShareContext, asked: boolean, resume = false): Promise<McpResult | undefined> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason, results: [], writes: 0 };
  const gate = await syncGate(context);
  if (gate.state === 'stopped' || (gate.state === 'needs-resume' && !resume)) return { stopped: gate.reason, results: [], writes: 0 };
  let { record: syncRecord } = await readRecord(context.home);
  if (!syncRecord && !asked) return { results: [], writes: 0 };
  if (!syncRecord) { syncRecord = newRecord(context); await saveRecord(context.home, syncRecord); }
  if (gate.state !== 'ready') await remember(context, syncRecord.generation);
  return undefined;
}

/** Brings one agent into line with its harnesses: the library's plan, carried out in the library's order (carryOut). */
async function syncItem(pass: Pass, item: LibraryItem) {
  const slot = pass.disk.byKey.get(item.key) ?? {};
  const fileIn = (harness: HarnessId) => slot[harness as AgentTool]!;
  const copies = copiesOf(pass, item), made = plan(item, copies);
  await carryOut(item, made, {
    ...pass.shelf,
    copy: harness => { const here = fileIn(harness); return { hash: here.hash, at: here.at, content: here.agent }; },
    // Each harness's file as seen now is its own part (the click on the item is recorded already).
    keepOwn: async () => {
      for (const harness of pass.managed) {
        const here = slot[harness];
        if (here && copies[harness]?.is === 'present' && item.own[harness] !== here.bytes) await keepOwn(pass.context, item, harness, here.text);
      }
    },
    log: () => appendHistory(pass.context, logItem(pass, item, made, slot)),
    write: harness => writeCopy(pass, item, harness as AgentTool, slot[harness as AgentTool]),
    remove: harness => removeCopy(pass, item, fileIn(harness)),
  });
}

/**
 * Writes the current version into one harness, and keeps what it wrote as that harness's own part. True when it is there
 * (carryOut notes it as applied). What stops it is said, not stored: the next pass tries again.
 */
async function writeCopy(pass: Pass, item: LibraryItem, tool: AgentTool, here: AgentEntry | undefined): Promise<boolean> {
  const stopped = (message: string) => { pass.results.push({ item: item.name, harness: tool, outcome: 'held', message }); return false; };
  const agent = await readVersion(pass.context, item.key, item.hash);
  if (!agent) return stopped('This version is no longer in Central Knot’s store, so it can’t be written.');
  let text: string;
  // A harness with a file keeps every other byte of it; one without gets back the file it had, or a new one.
  try { text = here ? agentText(tool, agent, here.text) : await fileTextFor(pass.context, item, tool, agent); }
  catch { return stopped('This file could not be updated without changing other parts of it.'); }
  const path = here?.file ?? fileFor(pass.context, tool, item.name);
  pass.context.fault?.('before-rename');
  try { await writeFileChecked(path, text, here?.text); }
  catch (error) { return stopped(errorCode(error).startsWith('CK_') ? (error as Error).message : `Could not write ${nameOf(tool)}’s copy.`); }
  await keepOwn(pass.context, item, tool, text);
  pass.writes++;
  firstSeenMissingAt.delete(path);
  const message = `${here ? 'Now has the current version' : 'Added'}. Start a new session to use it.`;
  pass.results.push({ item: item.name, harness: tool, outcome: 'written', replaced: here ? true : undefined, message });
  return true;
}

/**
 * Removes one harness's copy, only while it still holds what was read (its content and its own part are kept already). True
 * when it is gone (carryOut notes that and saves at once).
 */
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
  pass.writes++;
  pass.results.push({ item: item.name, harness: here.tool, outcome: 'removed', message: 'Removed. Central Knot keeps it.' });
  return true;
}

/**
 * A deleted agent always has its Restore. carryOut tells History first for its own item, but a pass saves the whole record,
 * so another agent's save in the same pass can carry a Delete to disk before that Delete's entry is told; a crash then would
 * leave the agent with no row and no Restore. So each pass, before any click, gives every agent deleted within History's
 * days that has no standing `deleted` entry (one not undone) that entry, dated when it was deleted.
 */
async function deletionsTold(pass: Pass) {
  const cutoff = historyCutoff(pass.context);
  const recent = Object.values(pass.library.items).filter(item => item.deleted && Date.parse(item.deleted.at) >= cutoff);
  if (!recent.length) return;
  const told = new Set((await readHistory(pass.context)).filter(event => event.kind === 'deleted' && !event.undoneBy).map(event => event.key));
  const untold = recent.filter(item => !told.has(`agent:${item.key}`));
  await appendHistory(pass.context, untold.map(item => ({
    id: randomUUID(), at: item.deleted!.at, key: `agent:${item.key}`, item: item.name, kind: 'deleted', losers: [], orderProved: true })));
}

/**
 * History's entries for one agent's pass, made before anything of it is saved (carryOut): what was asked (with the harnesses
 * its plan writes or removes), an edit taken in, and a copy deleted by hand that turned it Off. The last two are also notices,
 * since no one asked for them. A harness whose file can't be changed this time is said in the pass's results, and the next
 * pass finishes it.
 */
function logItem(pass: Pass, item: LibraryItem, made: Plan, slot: Slot): HistoryEvent[] {
  // The item as it is before the plan is carried out: the edit taken in is current only after this is told.
  const taken = made.takeIn ? slot[made.takeIn as AgentTool]!.hash : item.hash;
  const key = `agent:${item.key}`, events: HistoryEvent[] = [];
  // What the plan will change: not in a harness whose folder can't be written, so no entry or notice claims it.
  const can = (tools: HarnessId[]) => tools.filter(tool => !pass.disk.locked.has(tool));
  const did = { written: can(made.write), removed: can(made.remove) };
  const log = (fields: Omit<HistoryEvent, 'id' | 'at' | 'key' | 'item' | 'orderProved'>) => {
    const event: HistoryEvent = { id: randomUUID(), at: now(), key, item: item.name, orderProved: true, ...fields };
    events.push(event);
    return event.id;
  };
  const notice = (kind: SyncNotice['kind'], winner: HarnessId, losers: HarnessId[], history: string) =>
    pass.notices.push({ key, item: item.name, kind, winner, losers, orderProved: true, history });
  /** Each of these harnesses with what it held before the pass. */
  const before = (tools: HarnessId[]) => tools.map(tool => ({ tool, hash: slot[tool as AgentTool]?.hash ?? '' }));
  const asked = pass.asked.get(item.key);
  if (asked) {
    const { fill, ...entry } = asked;
    const id = log({ ...entry, losers: entry.losers ?? (fill ? before(did[fill]) : []) });
    // A found agent taken in has no click that puts things back as they were, so it is not offered as the click's Undo.
    const tookIn = entry.kind === 'chosen' || entry.cause === 'found';
    if (!tookIn) pass.made.push(id);
    pass.asked.delete(item.key);
  }
  if (made.takeIn) {
    // The copies edited as well, which gave way to the latest edit: each is a version, and History can make it current.
    const others = made.keep.filter(kept => kept.from.how === 'edited').map(kept => kept.harness);
    const kind = others.length ? 'conflict' : 'edit';
    const losers = before([...new Set([...others, ...did.written])]);
    const id = log({ kind, winner: { tool: made.takeIn, hash: taken }, previous: item.hash, losers });
    notice(kind, made.takeIn, others.length ? others : did.written, id);
  }
  if (made.turnedOffBy) {
    const id = log({ kind: 'off', cause: 'deleted-by-hand', winner: { tool: made.turnedOffBy, hash: taken }, losers: before(did.removed) });
    notice('deleted', made.turnedOffBy, did.removed, id);
  }
  // Edits no pass had taken in that give way to the current version (Pull, Make current): each is a version, offered back here.
  const gaveWay = made.takeIn ? [] : made.keep.filter(kept => kept.from.how === 'edited').map(kept => kept.harness);
  if (gaveWay.length) log({ kind: 'kept-edit', losers: before(gaveWay) });
  return events;
}

// ---------- Clicks ----------

type Refuse = (message: string, more?: Partial<DestinationResult>) => void;

/**
 * One click on an agent, recorded on its item (types.ts Change: `managed` is On, `off` the harnesses it is kept out of); the
 * same pass then applies it. A click that can't be taken is said in the results (`unchanged`) and changes nothing.
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
    pass.asked.set(known.key, { kind: 'restored', fill: 'written' });
  } else if (!item) {
    if (change.managed) await takeIn(pass, change, known, refuse);
  } else if (change.deleted) {
    item.deleted = { at: now() };
    pass.asked.set(item.key, { kind: 'deleted', fill: 'removed' });
  } else if (change.version) await makeCurrent(pass, item, change.version, refuse);
  // A copy is chosen only when a found agent is taken in: one in the library is at its current version in every harness.
  else if (change.use) refuse(`${name} is in Central Knot already, so there is no copy to choose. Make one of its versions current instead.`);
  else turn(pass, item, change);
}

/** The switches: the agent On or Off, or one harness kept out or let in. */
function turn(pass: Pass, item: LibraryItem, change: Change) {
  const was = { on: item.on, except: item.except };
  Object.assign(item, { on: change.managed, except: [...change.off] } satisfies Partial<LibraryItem>);
  const out = item.except.find(tool => !was.except.includes(tool)), back = was.except.find(tool => !item.except.includes(tool));
  if (was.on !== item.on) pass.asked.set(item.key, item.on ? { kind: 'on', cause: 'switch', fill: 'written' } : { kind: 'off', cause: 'switch', fill: 'removed' });
  else if (out) pass.asked.set(item.key, { kind: 'off', cause: 'switch', only: out, fill: 'removed' });
  else if (back) pass.asked.set(item.key, { kind: 'on', cause: 'switch', only: back, fill: 'written' });
}

/**
 * Takes a found agent into the library, On: the copy every harness gets is the one they all hold, or, where they differ, the
 * one the person chose (`use`); with no choice made yet, it waits for one. The other copies become versions as the pass
 * writes over them. An agent deleted from Central Knot before is the same item again, its earlier versions with it.
 */
async function takeIn(pass: Pass, change: Change, tombstone: LibraryItem | undefined, refuse: Refuse) {
  const found = foundCopies(pass, change.key, change.off);
  if (!found.length) return refuse('No tool has a copy of it to take in any more.');
  const chosen = change.use && change.use !== 'separate' ? found.find(entry => entry.tool === change.use) : undefined;
  const changedSince = change.use && (!chosen || (change.useHash && chosen.hash !== change.useHash));
  if (changedSince) return refuse('The copy you chose changed since you chose it. Nothing was changed; choose again.', { chooseAgain: true });
  const differs = differ(found);
  if (differs && !chosen) {
    pass.results.push({ item: found[0].name, outcome: 'held', differs: true, message: 'Copies differ. Choose which copy to use.' });
    return;
  }
  const source = chosen ?? found[0];
  const item = tombstone ?? newItem('agent', change.key, source.name);
  Object.assign(item, { on: true, except: [...change.off], name: source.name } satisfies Partial<LibraryItem>);
  delete item.deleted;
  pass.library.items[item.key] = item;
  const from: Source = { how: differs ? 'chosen' : 'found', harness: source.tool };
  await setCurrent(pass.shelf, item, { hash: source.hash, at: iso(source.at), from }, source.agent);
  const winner = { tool: source.tool, hash: source.hash };
  const gaveWay = found.filter(entry => entry.hash !== source.hash).map(entry => ({ tool: entry.tool, hash: entry.hash }));
  pass.asked.set(item.key, differs ? { kind: 'chosen', winner, losers: gaveWay } : { kind: 'on', cause: 'found', winner, fill: 'written' });
}

/**
 * Pull (gitrepo.ts): the repo's content becomes the agent's current version, "pulled from the Git repo", and the pass applies
 * it wherever the agent is On. An agent in the library keeps its On or Off. One new here (never in the library, deleted from
 * it, or only found in a harness) comes in On, each copy found here kept first as a copy that gave way to it. The repo's file is Claude
 * Code's own part, so a Claude Code with no file gets it as the repo has it. Removed in the repo: deleted from Central Knot.
 * Each is History's entry with `cause: 'pulled'`.
 */
async function pull(pass: Pass, key: string, brought: Pulled) {
  const known = pass.library.items[key], live = known && !known.deleted ? known : undefined;
  if ('removed' in brought) {
    if (live) { live.deleted = { at: now() }; pass.asked.set(key, { kind: 'deleted', cause: 'pulled', fill: 'removed' }); }
    return;
  }
  const { agent, claudeFile } = brought;
  const item = known ?? newItem('agent', key, agent.name);
  pass.library.items[key] = item;
  if (!live) {
    const replacedBy = agentHash(agent);
    for (const copy of foundCopies(pass, key, [])) await keepVersion(pass.shelf, item, { hash: copy.hash, at: iso(copy.at), from: { how: 'was-in', harness: copy.tool, replacedBy } }, copy.agent);
    Object.assign(item, { on: true, except: [] } satisfies Partial<LibraryItem>);
    delete item.deleted;
  }
  const settingsChanged = item.own['claude-cli'] !== sha256(claudeFile);
  await keepOwn(pass.context, item, 'claude-cli', claudeFile);
  const hash = agentHash(agent), previous = item.hash;
  if (hash !== item.hash) await setCurrent(pass.shelf, item, { hash, at: now(), from: { how: 'pulled' } }, agent);
  // Only Claude Code's own settings changed, where Claude Code doesn't have the agent now: kept for when it does (where it
  // has it, gitrepo.ts pullClaudeSettings writes them, with an entry of its own).
  const claudeHasIt = wantedIn(item, 'claude-cli') && !!pass.disk.byKey.get(key)?.['claude-cli'];
  if (!live) pass.asked.set(key, { kind: 'on', cause: 'pulled', fill: 'written' });
  else if (hash !== previous) pass.asked.set(key, { kind: 'edit', cause: 'pulled', previous, version: hash, fill: 'written' });
  else if (settingsChanged && !claudeHasIt) pass.asked.set(key, { kind: 'edit', cause: 'pulled', version: hash });
  await saveIfChanged(pass);
}

/** Makes an earlier version current: a new version (library.ts setCurrent), which the pass then applies like any other. */
async function makeCurrent(pass: Pass, item: LibraryItem, version: string, refuse: Refuse) {
  const agent = item.versions.some(known => known.hash === version) ? await readVersion(pass.context, item.key, version) : undefined;
  if (!agent) return refuse('That version is no longer in Central Knot’s store, so it can’t be made current.');
  if (version === item.hash) return refuse(`${item.name} is at that version already.`);
  const previous = item.hash;
  await setCurrent(pass.shelf, item, { hash: version, at: now(), from: { how: 'made-current' } }, agent);
  pass.asked.set(item.key, { kind: 'current', previous, version, fill: 'written' });
}

/**
 * A History entry's action on an agent. historyactions.ts says which click it is, from the entry and the agent as it is now;
 * that click runs like any other, and the entry is marked done by the entry the click makes. `version`: one of the entry's
 * version choices instead of its own action.
 */
export async function restoreAgent(context: ShareContext, tools: HarnessId[], eventId: string, version?: string): Promise<McpResult> {
  const past = (await readHistory(context)).find(entry => entry.id === eventId);
  const key = past?.key.replace(/^agent:/, '') ?? '';
  const { library, problem } = await openLibrary(context);
  if (problem) return { stopped: problem, results: [], writes: 0 };
  const action = past && agentAction(past, library.items[key], version);
  if (!action) return { stopped: 'That change has nothing left to undo: the agent is as that would leave it.', results: [], writes: 0 };
  const done = await applyAgents(context, tools, [action.change], { only: new Set([key]) });
  // One of an entry's version choices ("Use Codex’s") leaves the entry open: its other choices still stand.
  if (!done.made?.length || version) return done;
  const history = await readHistory(context);
  const entry = history.find(event => event.id === eventId);
  if (entry) { entry.undoneBy = done.made[0]; await replaceHistory(context, history); }
  return done;
}

// ---------- For the callers around a pass ----------

/** One version's content, for the Agents page to show: undefined when the store no longer has it. */
export const agentVersion = (context: ShareContext, key: string, hash: string) => readVersion(context, key, hash);

/**
 * The tool choice (toolchoice.ts) lets go of the folders of the harnesses it leaves out at once (keepFolders), so a harness
 * managed again is told apart whether or not a pass runs before it is back (guardFolders).
 */
export async function forgetAgentFolders(context: ShareContext, managed: readonly HarnessId[]) {
  const { library, problem } = await openLibrary(context, true);
  if (problem) return;
  keepFolders(library, {}, managed, true);
  await saveLibrary(context.home, library);
}

/** The agents that are On in the library, by key (plugin parts ask which agents Central Knot keeps in step: parts.ts). */
export async function agentsOn(context: ShareContext): Promise<Map<string, LibraryItem>> {
  const { library } = await openLibrary(context);
  return new Map(Object.values(library.items).filter(item => item.on && !item.deleted).map(item => [item.key, item]));
}

/**
 * What the Git repo holds for each agent in the library, On or Off (gitrepo.ts Push): its current version, or the edit a tool
 * holds that no pass has taken in yet (it goes as a click's own pass would take it in; no tool is written), none when the
 * store no longer has it; and, where Central Knot has one, Claude Code's file for it: Claude Code's own file when it holds
 * that version, else the file the library kept for Claude Code with that version written into it.
 */
export async function agentsForRepo(context: ShareContext, tools: HarnessId[]): Promise<{ item: LibraryItem; agent?: SharedAgent; claudeFile?: string }[]> {
  const { library } = await openLibrary(context);
  const live = Object.values(library.items).filter(item => !item.deleted);
  const look = await lookAt(context, tools.filter(isAgentTool), library);
  await guardFolders(look, live);
  return Promise.all(live.map(async item => {
    const slot = look.disk.byKey.get(item.key) ?? {}, takeIn = plan(item, copiesOf(look, item)).takeIn as AgentTool | undefined;
    const edit = takeIn ? slot[takeIn] : undefined, hash = edit?.hash ?? item.hash;
    const agent = edit?.agent ?? await readVersion(context, item.key, item.hash);
    const kept = agent && item.own['claude-cli'] ? await fileTextFor(context, { ...item, hash }, 'claude-cli', agent) : undefined;
    return { item, agent, claudeFile: slot['claude-cli']?.hash === hash ? slot['claude-cli'].text : kept };
  }));
}

// ---------- View ----------

/**
 * Each listed version's note (agentfiles.ts VersionChange). A copy that gave way is compared with the version written over
 * it. Any other is compared with the version taken before it, passing over copies that gave way, which were never current;
 * with none, it is the first version, unless copies were taken in with it (the chosen one, or Pull's over copies found here).
 */
async function changesOf(context: ShareContext, item: LibraryItem): Promise<VersionChange[]> {
  const compare = async (version: Version, against: string) => {
    const [was, is] = await Promise.all([readVersion(context, item.key, against), readVersion(context, item.key, version.hash)]);
    return was && is ? changedFields(was, is) : undefined;
  };
  return Promise.all(listed(item).map(async (version): Promise<VersionChange> => {
    if (version.from.replacedBy) { const fields = await compare(version, version.from.replacedBy); return fields ? { differs: fields } : 'unknown'; }
    const before = item.versions.slice(item.versions.indexOf(version) + 1).find(older => older.from.how !== 'was-in');
    if (before) { const fields = await compare(version, before.hash); return fields ? { changed: fields } : 'unknown'; }
    const takenWith = version.from.how === 'chosen' || item.versions.some(other => other.from.replacedBy === version.hash);
    return takenWith ? 'none' : 'first';
  }));
}

/**
 * The Agents page's rows: every agent in the library (On, or Off: in Central Knot only) and every found one (in a managed
 * harness, not in the library). `managed` on a row is On; `off` the harnesses it is kept out of. `library` gives the page and
 * History each item as the library holds it, deleted ones too.
 */
export async function agentsView(context: ShareContext, tools: HarnessId[], notices: SyncNotice[] = []): Promise<McpView> {
  const managed = tools.filter(isAgentTool);
  const { library, problem } = await openLibrary(context);
  const live = Object.values(library.items).filter(item => !item.deleted);
  // The page's look forgets in memory what a pass would; it never saves.
  const look = await lookAt(context, managed, library);
  await guardFolders(look, live);
  const keys = [...new Set([...look.disk.byKey.keys(), ...live.map(item => item.key)])].sort((first, second) => first.localeCompare(second));
  const agents: SkillFacts[] = [];
  for (const key of keys) agents.push(await rowFacts(look, key, live.find(item => item.key === key)));
  const gate = problem ? { state: 'stopped' as const, reason: problem } : await syncGate(context);
  const problems = problem ? [problem, ...look.disk.problems] : look.disk.problems;
  return { tools: managed, servers: agents, library: library.items, claudePending: [], access: await writeAccess(context), gate, problems, notices };
}

/**
 * One agent's row: what each managed harness holds and, for an agent in the library, what the next pass does in each
 * (`plan`, from the same reading a pass makes: copiesOf) and why nothing can happen in one (`unseen`, `cannot`). A found
 * agent's row says whether its copies differ, so its switch asks which one to take in.
 */
async function rowFacts(look: Look, key: string, item: LibraryItem | undefined): Promise<SkillFacts> {
  const slot = look.disk.byKey.get(key) ?? {};
  const entries = look.managed.flatMap(tool => (slot[tool] ? [slot[tool]!] : []));
  const name = item?.name ?? entries[0].name;
  const current = item ? await readVersion(look.context, key, item.hash) : entries[0].agent;
  const copies: Partial<Record<HarnessId, ToolCopy>> = {};
  for (const { tool, hash, file, agent, at, name: folder } of entries) {
    const lines = agent.prompt.split('\n').length, ownFields = Object.keys(agent.fields);
    const { description: summary, prompt } = agent;
    copies[tool] = { hash, directory: file, rootLabel: nameOf(tool), lines, modified: iso(at), summary, prompt, writable: true, folder, ownFields };
  }
  const cannot: SkillFacts['cannot'] = {}, plugin: NonNullable<SkillFacts['plugin']> = {}, unseen: NonNullable<SkillFacts['unseen']> = {};
  for (const tool of look.managed) { const given = look.through.get(tool)?.get(key); if (given && !slot[tool]) plugin[tool] = given; }
  const copiesNow = item ? copiesOf(look, item) : undefined, made = item && copiesNow ? plan(item, copiesNow) : undefined;
  const tombstone = item ? undefined : look.library.items[key];
  for (const tool of look.managed) {
    const copy = copiesNow?.[tool], touched = made?.write.includes(tool) || made?.remove.includes(tool);
    if (copy?.is === 'unknown') unseen[tool] = copy.why;
    // Why it can't take the agent (cannotTake): a held copy says it; so does a copy the plan writes over or removes, and a
    // harness a found agent would go to once taken in.
    const why = copy?.is === 'held' ? copy.why : cannotTake(look, { key, name }, tool, !!slot[tool]);
    if (why && (copy?.is === 'held' || touched || (!copiesNow && !slot[tool]))) cannot[tool] = why;
    if (copiesNow) continue;
    // A found agent: what can't be seen there. One deleted from Central Knot whose copy there is still owed a removal says so.
    const owed = tombstone?.applied[tool] !== undefined && slot[tool] && look.disk.locked.get(tool);
    const removedLater = `Central Knot removes this copy once it can write in ${nameOf(tool)}’s agents folder.`;
    const hidden = unseenIn(look.disk, tool, key) ?? (owed ? removedLater : undefined);
    if (hidden) unseen[tool] = hidden;
  }
  // The edits the next pass handles: the one that becomes the current version, and any that give way to it.
  const edited = made ? [made.takeIn, ...made.keep.filter(kept => kept.from.how === 'edited').map(kept => kept.harness)].filter(tool => tool !== undefined) : [];
  return {
    key, name, description: current?.description ?? '', copies, extra: [], managed: !!item?.on, off: item?.except ?? [], cannot, choiceBlocks: {}, edited,
    ...(made && item ? { plan: made, versionChanges: await changesOf(look.context, item) } : { differs: differ(foundCopies(look, key, [])) }),
    ...(Object.keys(plugin).length ? { plugin } : {}), ...(Object.keys(unseen).length ? { unseen } : {}),
  };
}
