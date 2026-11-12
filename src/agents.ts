// Agents on Central Knot's library: the adapter for one kind. Read library.ts first: it holds the model, the one rule for an
// item in the library (decide, plan) and the order a plan is carried out in (carryOut). This module decides what can be seen
// of an agent in each managed harness (H: copiesOf, with the guards), which copy a found agent is taken in from (takeIn,
// foundCopies) and what Pull brings (pull); it carries the library's answer out by checked writes and removals (share.ts),
// so a save that lands meanwhile is never lost. In the order a pass runs (applyAgents):
//
//   lookAt         each managed harness's agent files (readDisk; a file that can't be read for sure is unseen, never missing),
//                  then the guards: a harness not managed, a folder moved, made again or gone (forgetUnmanaged, guardFolders)
//   pull, click    what Pull brings, and what the person asked (On, Off, a harness kept out, a version made current, Delete,
//                  Restore, a found agent taken in), recorded on the item
//   syncItem       the library's plan for the item (from copiesOf), carried out by carryOut
//   logItem        History's entries for it, written with the record, before any file changes
//
// agentsView is the same reading (lookAt, copiesOf, plan) for the Agents page, so a mark says what a pass will do;
// restoreAgent runs a History entry's action, which is always one of the clicks above (historyactions.ts). Elsewhere: where
// each thing is kept on disk, agentstore.ts; the harnesses' file formats, agentfiles.ts; an agent's row and the clicks its
// controls send, agentrow.ts; Convert to skill, agentskill.ts; the Git repo's Push and Pull, gitrepo.ts (agentsForRepo, pull).
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { agentHash, agentText, agentsFolder, fileFor, isAgentTool, keyOf, nameProblem, readAgents, type AgentEntry, type SharedAgent } from './agentfiles.ts';
import { agentShelf, fileTextFor, keepOwn, openLibrary, readVersion, saveLibrary, type AgentLibrary, type FolderSeen } from './agentstore.ts';
import { agentAction } from './historyactions.ts';
import { carryOut, keepVersion, newItem, plan, setCurrent, wantedIn } from './library.ts';
import type { Copies, HarnessCopy, LibraryItem, Plan, Shelf, Source } from './library.ts';
import { appendHistory, readHistory, replaceHistory } from './manage.ts';
import { throughPlugins } from './plugins.ts';
import type { AgentTool } from './presence.ts';
import { errorCode, exists, newRecord, readRecord, recoverParked, remember, removeFileChecked, saveRecord, syncGate, writeAccess, writeFileChecked } from './share.ts';
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
    const locked = `${nameOf(tool)}’s agents folder can’t be written, so Central Knot can’t change the agent there. Let it write there (the folder’s permissions) and it does at the next look, or keep the agent out of ${nameOf(tool)}.`;
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

/** Why a harness with no copy can't be given one, if it can't. Worked out at each look and never stored. */
function cannotHold(through: ThroughPlugins, item: Pick<LibraryItem, 'key' | 'name'>, tool: HarnessId): string | undefined {
  const given = through.get(tool)?.get(item.key);
  if (given) return throughPlugin(tool, given, 'agent');
  const why = nameProblem(item.name);
  return why && `${nameOf(tool)} can’t store this name (${why}). Rename the agent to use it there.`;
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

/** Reads the managed harnesses once for `items`, with the guards applied to them (forgetUnmanaged, guardFolders). */
async function lookAt(context: ShareContext, managed: AgentTool[], library: AgentLibrary, items: LibraryItem[], settle?: Look['settle']): Promise<Look> {
  const look: Look = { context, managed, library, disk: await readDisk(context, managed), through: await agentsThroughPlugins(context, managed), foldersNow: {}, settle };
  forgetUnmanaged(items, managed);
  await guardFolders(look, items);
  return look;
}

/**
 * A harness Central Knot doesn't manage now (uninstalled, or left out by the tool choice: toolchoice.ts) changes nothing: what
 * was applied there is forgotten, so when it is managed again the library wins there, and a copy that differs, or one deleted
 * meanwhile, is never read as an edit or a deletion by hand.
 */
function forgetUnmanaged(items: LibraryItem[], managed: readonly HarnessId[]) {
  for (const item of items) for (const tool of Object.keys(item.applied) as HarnessId[]) if (!managed.includes(tool)) delete item.applied[tool];
}

/**
 * "H unknown is never H gone" for a whole folder. A harness's agents folder that is somewhere else than at the last full pass
 * (its config root moved), was made again since (a reset or reinstall, or back after being away), or is gone for longer than
 * the settle window: what was applied there is forgotten, so the agent is written there afresh and never read as deleted by
 * hand. A folder that is gone is unseen inside the settle window, and afterwards for an agent whose removal it still owes,
 * which waits for the folder.
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
    if (!was) continue;
    const moved = was.path !== path;
    if (moved) forget(items);
    else if ('away' in was || was.ino !== here.ino || was.birth !== here.birth) forget(items.filter(item => !look.disk.byKey.get(item.key)?.[tool]));
  }
}

/**
 * H for each managed harness (library.ts HarnessCopy): the one place that says what a harness holds of an agent, read by a
 * pass and by the page. `unknown`, so that nothing happens there: a file that can't be read for sure, a folder away inside the
 * settle window, and a copy missing for less than the settle window (an editor's save moves the file away for a moment).
 * `held`: a harness the agent should be in that can't be given a copy (cannotHold, or its folder can't be written).
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
  const wanted = wantedIn(item, tool), cannot = wanted ? cannotHold(look.through, item, tool) ?? look.disk.locked.get(tool) : undefined;
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
  const first = firstSeenMissingAt.get(path) ?? look.settle.clock;
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

/** A click's History entry, begun when the click is recorded and finished with the harnesses its plan writes or removes (`fill`: which of them it names). */
type ClickEntry = Pick<HistoryEvent, 'kind' | 'cause' | 'winner' | 'only' | 'version' | 'previous'> & { losers?: HistoryEvent['losers']; fill?: 'written' | 'removed' };
/** What Pull brings for one agent (gitrepo.ts): its shared part, and the repo's whole file, which is Claude Code's own part. */
export interface Pulled { agent: SharedAgent; claudeFile: string }
interface Pass extends Look {
  shelf: Shelf<SharedAgent>;
  /** The record as last saved, to save it again only when it changed. */
  saved: string;
  /** The click on each agent this pass, as the History entry it becomes. */
  clicked: Map<string, ClickEntry>;
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
  const look = await lookAt(context, managed, library, Object.values(library.items).filter(item => inScope(item.key)), settle);
  const pass: Pass = {
    ...look, shelf: agentShelf(context, () => saveIfChanged(pass)), saved, clicked: new Map(), results: [], notices: [], writes: 0, made: [],
  };
  for (const [key, brought] of options.pulled ?? []) await pull(pass, key, brought);
  for (const change of changes) await click(pass, change);
  for (const item of Object.values(library.items)) if (inScope(item.key)) await syncItem(pass, item);
  // Folder identities are kept only by a full pass: a click with Sync off skips other agents, so they must still see a reset.
  if (!options.only) library.folders = { ...library.folders, ...pass.foldersNow };
  await saveIfChanged(pass);
  return { results: pass.results, writes: pass.writes, notices: pass.notices, settling: settle.settling, made: pass.made };
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
  const hashBefore = item.hash, copies = copiesOf(pass, item), made = plan(item, copies);
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
    log: () => appendHistory(pass.context, logItem(pass, item, made, hashBefore, slot)),
    write: harness => writeCopy(pass, item, harness as AgentTool, slot[harness as AgentTool]),
    remove: harness => removeCopy(pass, item, fileIn(harness)),
  });
}

/** Writes the current version into one harness. What stops it is said, not stored: the next pass tries again. */
async function writeCopy(pass: Pass, item: LibraryItem, tool: AgentTool, here: AgentEntry | undefined) {
  const held = (message: string) => { pass.results.push({ item: item.name, harness: tool, outcome: 'held', message }); };
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
  await keepOwn(pass.context, item, tool, text);
  pass.writes++;
  firstSeenMissingAt.delete(path);
  const message = `${here ? 'Now has the current version' : 'Added'}. Start a new session to use it.`;
  pass.results.push({ item: item.name, harness: tool, outcome: 'written', replaced: here ? true : undefined, message });
}

/** Removes one harness's copy, only while it still holds what was read (its content and its own part are kept already). */
async function removeCopy(pass: Pass, item: LibraryItem, here: AgentEntry) {
  pass.context.fault?.('before-remove');
  try { await removeFileChecked(here.file, here.text); }
  catch (error) {
    // A save that landed between the read and the removal stays; the next pass keeps it as a version and removes it then.
    const changed = errorCode(error) === 'CK_CHANGED', where = nameOf(here.tool);
    const message = changed ? `${where}’s copy changed just now, so it stays until the next look.` : `Could not remove ${where}’s copy yet. Central Knot will try again.`;
    pass.results.push({ item: item.name, harness: here.tool, outcome: changed ? 'held' : 'failed', message });
    return;
  }
  delete item.applied[here.tool];
  pass.writes++;
  pass.results.push({ item: item.name, harness: here.tool, outcome: 'removed', message: 'Removed. Central Knot keeps it.' });
}

/**
 * History's entries for one agent's pass: the click's own (with the harnesses its plan writes or removes), an edit taken in,
 * and a copy deleted by hand that turned it Off. The last two are also notices, since no one asked for them. A harness whose
 * file can't be changed this time is said in the pass's results, and the next pass finishes it.
 */
function logItem(pass: Pass, item: LibraryItem, made: Plan, hashBefore: string, slot: Slot): HistoryEvent[] {
  const key = `agent:${item.key}`, events: HistoryEvent[] = [];
  const did = { written: made.write, removed: made.remove };
  const log = (fields: Omit<HistoryEvent, 'id' | 'at' | 'key' | 'item' | 'orderProved'>) => {
    const event: HistoryEvent = { id: randomUUID(), at: now(), key, item: item.name, orderProved: true, ...fields };
    events.push(event);
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
    const tookIn = entry.kind === 'chosen' || entry.cause === 'found';
    if (!tookIn) pass.made.push(id);
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
    const id = log({ kind: 'off', cause: 'deleted-by-hand', winner: { tool: made.turnedOffBy, hash: item.hash }, losers: held(did.removed) });
    notice('deleted', made.turnedOffBy, did.removed, id);
  }
  return events;
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
  // A copy is chosen only when a found agent is taken in: one in the library is at its current version in every harness.
  else if (change.use) refuse(`${name} is in Central Knot already, so there is no copy to choose. Make one of its versions current instead.`);
  else turn(pass, item, change);
}

/** The switches: the agent On or Off, or one harness kept out or let in. */
function turn(pass: Pass, item: LibraryItem, change: Change) {
  const was = { on: item.on, except: item.except };
  Object.assign(item, { on: change.managed, except: [...change.off] } satisfies Partial<LibraryItem>);
  const out = item.except.find(tool => !was.except.includes(tool)), back = was.except.find(tool => !item.except.includes(tool));
  if (was.on !== item.on) pass.clicked.set(item.key, item.on ? { kind: 'on', cause: 'switch', fill: 'written' } : { kind: 'off', cause: 'switch', fill: 'removed' });
  else if (out) pass.clicked.set(item.key, { kind: 'off', cause: 'switch', only: out, fill: 'removed' });
  else if (back) pass.clicked.set(item.key, { kind: 'on', cause: 'switch', only: back, fill: 'written' });
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
  pass.clicked.set(item.key, differs ? { kind: 'chosen', winner, losers: gaveWay } : { kind: 'on', cause: 'found', winner, fill: 'written' });
}

/**
 * Pull (gitrepo.ts): the repo's content becomes the agent's current version, "pulled from the Git repo", and the pass applies
 * it wherever the agent is On. An agent in the library keeps its On or Off. One new here (never in the library, deleted from
 * it, or only found in a harness) comes in On, each copy found here kept as a version first. The repo's file is Claude
 * Code's own part, so a Claude Code with no file gets it as the repo has it.
 */
async function pull(pass: Pass, key: string, { agent, claudeFile }: Pulled) {
  const item = pass.library.items[key] ?? newItem('agent', key, agent.name), known = !!item.hash && !item.deleted;
  pass.library.items[key] = item;
  if (!known) {
    for (const copy of foundCopies(pass, key, [])) await keepVersion(pass.shelf, item, { hash: copy.hash, at: iso(copy.at), from: { how: 'found', harness: copy.tool } }, copy.agent);
    Object.assign(item, { on: true, except: [] } satisfies Partial<LibraryItem>);
    delete item.deleted;
  }
  await keepOwn(pass.context, item, 'claude-cli', claudeFile);
  const hash = agentHash(agent), previous = item.hash;
  if (hash !== item.hash) await setCurrent(pass.shelf, item, { hash, at: now(), from: { how: 'pulled' } }, agent);
  if (!known) pass.clicked.set(key, { kind: 'on', cause: 'pulled', fill: 'written' });
  else if (hash !== previous) pass.clicked.set(key, { kind: 'edit', previous, fill: 'written' });
  await saveIfChanged(pass);
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

/** The tool choice's forgetting (toolchoice.ts), at once, so it holds whether or not a pass runs before the tool is back: forgetUnmanaged. */
export async function forgetAgentCopies(context: ShareContext, managed: readonly HarnessId[]) {
  const { library, problem } = await openLibrary(context, true);
  if (problem) return;
  forgetUnmanaged(Object.values(library.items), managed);
  await saveLibrary(context.home, library);
}

/** The agents that are On in the library, by key (plugin parts ask which agents Central Knot keeps in step: parts.ts). */
export async function agentsOn(context: ShareContext): Promise<Map<string, LibraryItem>> {
  const { library } = await openLibrary(context);
  return new Map(Object.values(library.items).filter(item => item.on && !item.deleted).map(item => [item.key, item]));
}

/**
 * What the Git repo holds for each agent in the library, On or Off (gitrepo.ts Push): its current version (none when the store
 * no longer has it) and, where Central Knot has one, Claude Code's file for it: Claude Code's own file when it holds the current
 * version, else the file the library kept for Claude Code with that version written into it.
 */
export async function agentsForRepo(context: ShareContext, tools: HarnessId[]): Promise<{ item: LibraryItem; agent?: SharedAgent; claudeFile?: string }[]> {
  const { library } = await openLibrary(context);
  const claude = tools.includes('claude-cli') ? (await readAgents(context, 'claude-cli')).entries : [];
  return Promise.all(Object.values(library.items).filter(item => !item.deleted).map(async item => {
    const agent = await readVersion(context, item.key, item.hash);
    const here = claude.find(entry => entry.key === item.key && entry.hash === item.hash);
    const claudeFile = here?.text ?? (agent && item.own['claude-cli'] ? await fileTextFor(context, item, 'claude-cli', agent) : undefined);
    return { item, agent, claudeFile };
  }));
}

// ---------- View ----------

/**
 * The Agents page's rows: every agent in the library (On, or Off: in Central Knot only) and every found one (in a managed
 * harness, not in the library). `managed` on a row is On; `off` the harnesses it is kept out of. `library` gives the page and
 * History each item as the library holds it, deleted ones too.
 */
export async function agentsView(context: ShareContext, tools: HarnessId[], notices: SyncNotice[] = []): Promise<McpView> {
  const managed = tools.filter(isAgentTool);
  const { library, problem } = await openLibrary(context);
  const live = Object.values(library.items).filter(item => !item.deleted);
  const look = await lookAt(context, managed, library, live);
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
  const held = item ? copiesOf(look, item) : undefined, made = item && held ? plan(item, held) : undefined;
  for (const tool of look.managed) {
    const copy = held?.[tool], locked = look.disk.locked.get(tool);
    if (copy?.is === 'unknown') unseen[tool] = copy.why;
    if (copy?.is === 'held') cannot[tool] = copy.why;
    // A copy the plan writes over or removes, in a folder that can't be written: said, so the mark never promises it.
    if (locked && (made?.write.includes(tool) || made?.remove.includes(tool))) cannot[tool] = locked;
    if (held) continue;
    // A found agent: what can't be seen, and where it couldn't be given a copy once taken in.
    const hidden = unseenIn(look.disk, tool, key), why = slot[tool] ? undefined : cannotHold(look.through, { key, name }, tool);
    if (hidden) unseen[tool] = hidden;
    if (why) cannot[tool] = why;
  }
  // The edits the next pass handles: the one that becomes the current version, and any that give way to it.
  const edited = made ? [made.takeIn, ...made.keep.filter(kept => kept.from.how === 'edited').map(kept => kept.harness)].filter(tool => tool !== undefined) : [];
  return {
    key, name, description: current?.description ?? '', copies, extra: [], managed: !!item?.on, off: item?.except ?? [], cannot, choiceBlocks: {}, edited,
    ...(made ? { plan: made } : { differs: differ(foundCopies(look, key, [])) }),
    ...(Object.keys(plugin).length ? { plugin } : {}), ...(Object.keys(unseen).length ? { unseen } : {}),
  };
}
