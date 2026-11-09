// Managing skills across tools: what each tool has, and applying the person's choices.
// A managed skill keeps one copy in every tool it syncs to. An unmanaged skill is left alone.
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { harnesses, writeRoot } from './harnesses.ts';
import {
  FORMAT_VERSION, clearStaleStages, landingOf, copyTree, errorCode, exists, finishCopy, importRevision, itemKey, placeCopy, plainError, readRecord, readTree,
  remember, removeTree, saveRecord, stagingFolder, storeDirectory, storeFolder, syncGate, targetFor, writeAccess, writeDurably, type RecordItem, type ShareContext, type SyncRecord,
} from './share.ts';
import { parseSkill } from './discovery.ts';
import { isDisabled, readSwitchFile, setDisabled, switchFailure, unverifiedBuild, type SwitchTarget } from './skillswitch.ts';
import { problemText, toolName } from './words.ts';
import { ALREADY_AS_IT_WAS, type SwitchRecord } from './types.ts';
import type { ApplyResult, Change, DestinationResult, HarnessId, HistoryEvent, ManageView, Skill, SkillFacts, Snapshot, SyncNotice, ToolCopy } from './types.ts';

/** Tools shown as columns: those installed or holding skills. */
export const presentTools = (snapshots: Snapshot[]) => snapshots.filter(snapshot => snapshot.detection !== 'Not found' || snapshot.skills.length > 0).map(snapshot => snapshot.harness);

const bodyLine = (content: string) => content.replace(/^﻿?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '').split(/\r?\n/).map(line => line.trim()).find(line => line && !line.startsWith('#')) ?? '';

interface Location { tool: HarnessId; copy: ToolCopy }
interface Gathered { facts: SkillFacts; skills: Partial<Record<HarnessId, Skill[]>>; locations: Location[] }

/** Reads every skill in every present tool once. A copy that cannot be read makes the skill held, never the whole page. */
async function gather(context: ShareContext, snapshots: Snapshot[], record?: SyncRecord): Promise<Map<string, Gathered>> {
  const tools = presentTools(snapshots);
  const problems = new Map(await Promise.all(tools.map(async tool => [tool, await rootProblem(context, tool)] as const)));
  const map = new Map<string, Gathered>();
  for (const snapshot of snapshots) {
    if (!tools.includes(snapshot.harness)) continue;
    for (const skill of snapshot.skills) {
      const key = itemKey(skill.folder);
      let entry = map.get(key);
      if (!entry) {
        const recorded = record?.items[key];
        entry = { facts: { key, name: skill.folder, description: skill.description, copies: {}, extra: [], managed: recorded?.state === 'shared', off: recorded?.off ?? [], cannot: {}, separate: recorded?.separate === true, choiceBlocks: {} }, skills: {}, locations: [] };
        map.set(key, entry);
      }
      entry.facts.description ||= skill.description;
      (entry.skills[snapshot.harness] ??= []).push(skill);
      try {
        const tree = await readTree(skill.directory);
        if (tree.held) entry.facts.held ??= tree.held;
        const info = await stat(join(skill.directory, 'SKILL.md'));
        const copy: ToolCopy = {
          hash: tree.hash, directory: skill.directory, rootLabel: skill.rootLabel, lines: skill.content.split(/\r?\n/).length, modified: info.mtime.toISOString(),
          summary: bodyLine(skill.content).slice(0, 140), folder: skill.folder, writable: await writable(context, snapshot.harness, skill.directory, problems),
        };
        entry.locations.push({ tool: snapshot.harness, copy });
        if (!entry.facts.copies[snapshot.harness]) entry.facts.copies[snapshot.harness] = copy;
        else entry.facts.extra.push({ ...copy, tool: snapshot.harness });
        // A copy the tool itself will not load is as good as none.
        const refused = targetFor(snapshot.harness, skill.directory, skill).skipped;
        if (refused) entry.facts.cannot[snapshot.harness] = refused;
      } catch (error) {
        entry.facts.held ??= `${harnesses[snapshot.harness].name}'s copy could not be read completely${errorCode(error) === 'EACCES' ? ' (permission denied)' : ''}.`;
      }
    }
  }
  for (const entry of map.values()) {
    const source = Object.values(entry.skills).flat()[0]!;
    for (const tool of tools) {
      if (entry.facts.copies[tool]) continue;
      const snapshot = snapshots.find(item => item.harness === tool)!;
      const definition = harnesses[tool];
      const directory = ownCopyDir(context, tool, source.folder);
      if (snapshot.discovery === 'restricted' || snapshot.discovery === 'failed') { entry.facts.cannot[tool] = `${definition.name}'s folder could not be read.`; continue; }
      const problem = problems.get(tool);
      if (problem) { entry.facts.cannot[tool] = problem; continue; }
      if (definition.reservedSkills.includes(source.folder)) { entry.facts.cannot[tool] = `${definition.name} reserves the name “${source.folder}”.`; continue; }
      const skipped = targetFor(tool, directory, source).skipped;
      if (skipped) { entry.facts.cannot[tool] = skipped; continue; }
      try { await lstat(directory); entry.facts.cannot[tool] = `${definition.name} already has something at ${directory} that is not a readable skill.`; }
      catch (error) { if (errorCode(error) !== 'ENOENT') entry.facts.cannot[tool] = `${directory} could not be checked.`; }
    }
    for (const tool of Object.keys(entry.facts.copies) as HarnessId[]) entry.facts.choiceBlocks[tool] = blocksFor(entry, tool);
  }
  // Each tool's own switch (Disable): read and parsed once, then asked about every copy there. Why a tool can't take a new
  // Disable (its settings file, or a build older than the one verified) applies to a copy it is about to get, too.
  const switches = new Map(await Promise.all(tools.map(async tool => [tool, await readSwitchFile(context, tool)] as const)));
  const unverified = new Map(tools.map(tool => [tool, unverifiedBuild(tool, snapshots.find(snapshot => snapshot.harness === tool)?.probe.version)] as const));
  for (const entry of map.values()) {
    for (const tool of tools) {
      if (entry.facts.cannot[tool]) continue;
      const problem = switches.get(tool)!.problem;
      if (problem) (entry.facts.switchProblem ??= {})[tool] = problem;
      if (unverified.get(tool)) (entry.facts.disableUnverified ??= {})[tool] = unverified.get(tool)!;
      if (entry.facts.copies[tool] && isDisabled(context, switches.get(tool)!, switchTarget(entry, tool)!)) (entry.facts.disabled ??= []).push(tool);
    }
  }
  // A skill converted from an agent never goes back to the agent's own tool on its own (AGT-03): only an explicit request could.
  const converted = await readConverted(context.home);
  for (const [key, entry] of map) {
    const from = Object.hasOwn(converted, key) ? converted[key] : undefined;
    if (!from || entry.facts.copies[from.origin]) continue;
    entry.facts.converted = { agent: from.agent, origin: from.origin, losses: from.losses };
    entry.facts.cannot[from.origin] = `Converted from ${harnesses[from.origin].name}’s agent “${from.agent}”, so it is not placed back there; ${harnesses[from.origin].name} keeps the agent.`;
  }
  return map;
}

/** Skills made by Convert to skill (AGT-02), with where they came from: kept beside the sync record. */
export interface ConvertedFrom { agent: string; origin: HarnessId; at: string; losses: string[] }
const convertedPath = (home: string) => join(storeDirectory(home), 'converted.json');
export async function readConverted(home: string): Promise<Record<string, ConvertedFrom>> {
  // A null-prototype map: a skill named “constructor” or “__proto__” is a key like any other, never a built-in.
  try { return Object.assign(Object.create(null), JSON.parse(await readFile(convertedPath(home), 'utf8'))); } catch { return Object.create(null); }
}
export async function recordConverted(home: string, key: string, from: ConvertedFrom) {
  const all = await readConverted(home);
  all[key] = from;
  await mkdir(storeDirectory(home), { recursive: true });
  await writeDurably(convertedPath(home), `${JSON.stringify(all, null, 2)}\n`);
}

/** The skill as found at a tool's main copy. */
const skillAt = (entry: Gathered, tool: HarnessId) => entry.skills[tool]?.find(skill => skill.directory === entry.facts.copies[tool]?.directory);

/** How a tool's switch names the copy it had when this pass read it. Undefined when it had none. */
function switchTarget(entry: Gathered, tool: HarnessId): SwitchTarget | undefined {
  const copy = entry.facts.copies[tool];
  return copy && { folder: copy.folder, name: skillAt(entry, tool)?.name ?? copy.folder, skillFile: join(copy.directory, 'SKILL.md') };
}

/**
 * How a tool's switch names its copy as it is on disk now: after this pass replaced it (a chosen copy may carry another name)
 * or wrote it into the tool's own folder. Undefined when the tool has no copy there.
 */
async function liveSwitchTarget(context: ShareContext, entry: Gathered, tool: HarnessId): Promise<SwitchTarget | undefined> {
  const folder = entry.facts.copies[tool]?.folder ?? entry.facts.name;
  const skillFile = join(entry.facts.copies[tool]?.directory ?? ownCopyDir(context, tool, folder), 'SKILL.md');
  let content: string;
  try { content = await readFile(skillFile, 'utf8'); } catch { return undefined; }
  // Named by the same rule discovery uses for the page (parseSkill), so the switch written is the one the page reads back.
  try { return { folder, name: parseSkill(content, folder).name, skillFile }; } catch { return { folder, name: folder, skillFile }; }
}

/** What stops every tool from using one tool's copy: differing copies Central Knot does not change, and tools with a copy that could not load this one. */
function blocksFor(entry: Gathered, source: HarnessId): { tool: HarnessId; reason: string }[] {
  const chosen = entry.facts.copies[source]!;
  const skill = skillAt(entry, source);
  const blocks: { tool: HarnessId; reason: string }[] = [];
  for (const location of entry.locations) {
    if (location.copy.hash === chosen.hash || location.copy.writable) continue;
    blocks.push({ tool: location.tool, reason: `${harnesses[location.tool].name} also reads a different copy at ${location.copy.directory}, which Central Knot does not change.` });
  }
  for (const tool of Object.keys(entry.facts.copies) as HarnessId[]) {
    if (tool === source || !skill || entry.facts.copies[tool]!.hash === chosen.hash) continue;
    const refused = targetFor(tool, entry.facts.copies[tool]!.directory, skill).skipped;
    if (refused) blocks.push({ tool, reason: `${harnesses[tool].name} could not load ${harnesses[source].name}'s copy: ${refused}` });
  }
  return blocks;
}

/** Why a choice cannot be carried out for the tools it syncs to, if it cannot. */
function choiceProblem(entry: Gathered, use: HarnessId, hash: string | undefined, syncing: HarnessId[]): string | undefined {
  const copy = entry.facts.copies[use];
  if (!copy) return `The copy you chose in ${harnesses[use].name} is gone. Nothing was changed; choose again.`;
  if (hash !== undefined && copy.hash !== hash) return `The copy you chose in ${harnesses[use].name} has changed since you chose it. Nothing was changed; choose again.`;
  const block = entry.facts.choiceBlocks[use]?.find(entry => syncing.includes(entry.tool));
  return block ? `${block.reason} Nothing was changed.` : undefined;
}

const rootOf = (context: ShareContext, tool: HarnessId) => writeRoot(harnesses[tool], context.home, context.overrides?.[tool]);
/** Where a tool's own copy of a skill goes: its folder in the tool's own skills folder. */
const ownCopyDir = (context: ShareContext, tool: HarnessId, folder: string) => join(rootOf(context, tool), folder);

// ---------- Two-way sync: evidence, ordering and History ----------

/**
 * Observation intervals per copy (CON-04), kept while the app runs: when a copy was last read at the baseline, when a change there
 * was first read, and since when a recorded copy has been missing. Ordinary sync state, not a journal; a restart forgets it, which
 * only makes order unknown, never wrong.
 */
interface Seen { verifiedAt?: number; changed?: string; firstSeen?: number; missingSince?: number }
const evidence = new Map<string, Seen>();
const mark = (directory: string) => { let seen = evidence.get(directory); if (!seen) { seen = {}; evidence.set(directory, seen); } return seen; };
const clock = (context: ShareContext) => context.now?.() ?? Date.now();

/** The fixed tie-break when order is unknown (D-04): each location ranks by its highest-ordered reader in SPEC §5.1, then by path. */
const surfaceRank: Record<HarnessId, number> = { 'copilot-cli': 0, 'claude-cli': 1, 'codex-cli': 2, 'pi-cli': 3 };
const byRank = (first: Location, second: Location) => surfaceRank[first.tool] - surfaceRank[second.tool] || first.copy.directory.localeCompare(second.copy.directory);

/** Revision A is proved older than B when B's location was still read at the baseline after A's change was already seen. */
const provedOlder = (older: Location, newer: Location) => (evidence.get(newer.copy.directory)?.verifiedAt ?? -Infinity) >= (evidence.get(older.copy.directory)?.firstSeen ?? Infinity);

/** The newest revision the evidence proves; otherwise the tie-break among those not proved older. */
function newest(candidates: Location[]): { winner: Location; proved: boolean } {
  const remaining = candidates.filter(candidate => !candidates.some(other => other !== candidate && other.copy.hash !== candidate.copy.hash && provedOlder(candidate, other)));
  const hashes = new Set(remaining.map(candidate => candidate.copy.hash));
  return { winner: [...remaining].sort(byRank)[0] ?? [...candidates].sort(byRank)[0], proved: hashes.size === 1 };
}

/** Same folder? Case-folded where the disk ignores case, so a case-only rename is the same copy. */
const sameDir = (first: string, second: string) => (process.platform === 'linux' ? first === second : first.toLowerCase() === second.toLowerCase());
/** The folders a tool reads skills from that a recorded copy may sit in. */
const ownRoots = (context: ShareContext, tool: HarnessId) => [rootOf(context, tool), join(context.home, '.agents/skills')];

/** A deletion is inferred only from a reachable folder (DEL-01): the folder the copy sat in still exists. */
async function folderExists(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory(); } catch { return false; }
}


const historyPath = (home: string) => join(storeDirectory(home), 'history.json');

/** History, newest last. Unreadable history reads as empty; sync never depends on it. */
/** Adds events to the shared History (used by MCP sync too), with the same retention and moving aside of an unreadable file. */
/** Writes History as given (for marking an event undone alongside a new one). */
export async function replaceHistory(context: ShareContext, events: HistoryEvent[]) {
  await saveHistory(context.home, events, clock(context));
}

export async function appendHistory(context: ShareContext, events: HistoryEvent[]) {
  if (events.length) await saveHistory(context.home, [...await readHistory(context.home), ...events], clock(context));
}

export async function readHistory(home: string): Promise<HistoryEvent[]> {
  try { const parsed = JSON.parse(await readFile(historyPath(home), 'utf8')); return Array.isArray(parsed?.events) ? parsed.events : []; } catch { return []; }
}

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Store revisions no record, copy or retained History event points at any more are removed (STO-04). Never a current revision. */
async function pruneStore(context: ShareContext, record: SyncRecord, events: HistoryEvent[]) {
  const keep = new Map<string, Set<string>>();
  const hold = (key: string, hash?: string) => { if (!hash) return; let set = keep.get(key); if (!set) { set = new Set(); keep.set(key, set); } set.add(hash); };
  for (const [key, item] of Object.entries(record.items)) { hold(key, item.hash); hold(key, item.deleted?.hash); hold(key, item.use?.hash); for (const copy of item.copies) hold(key, copy.hash); for (const entry of item.displaced ?? []) hold(key, entry.hash); }
  for (const entry of events) { hold(entry.key, entry.winner?.hash); hold(entry.key, entry.previous); for (const loser of entry.losers) hold(entry.key, loser.hash); }
  // History moved aside because it could not be read may still be recovered by hand: nothing it mentions is pruned.
  const mentioned = new Set<string>();
  try {
    for (const file of await readdir(storeDirectory(context.home))) {
      if (file.startsWith('history.unreadable-')) for (const hash of (await readFile(join(storeDirectory(context.home), file), 'utf8')).match(/[0-9a-f]{64}/g) ?? []) mentioned.add(hash);
    }
  } catch { return; }
  for (const key of Object.keys(record.items)) {
    const folder = join(storeDirectory(context.home), 'items', storeFolder(key));
    let revisions: string[];
    try { revisions = await readdir(folder); } catch { continue; }
    for (const revision of revisions) if (/^[0-9a-f]{64}$/.test(revision) && !keep.get(key)?.has(revision) && !mentioned.has(revision)) await removeTree(join(folder, revision)).catch(() => undefined);
  }
}

async function saveHistory(home: string, events: HistoryEvent[], now = Date.now()) {
  // History that cannot be read, or is not History, is moved aside, never overwritten: it may be recoverable by hand.
  let sound = true;
  try { sound = Array.isArray(JSON.parse(await readFile(historyPath(home), 'utf8'))?.events); } catch (error) { sound = errorCode(error) === 'ENOENT'; }
  if (!sound) await rename(historyPath(home), join(storeDirectory(home), `history.unreadable-${Date.now()}.json`)).catch(() => undefined);
  // Retention (STO-04): events older than 30 days leave History; deletion records stay in sync.json, so nothing stale revives.
  const cutoff = now - RETENTION_MS;
  events = events.filter(entry => Date.parse(entry.at) >= cutoff);
  await writeDurably(historyPath(home), `${JSON.stringify({ events: events.slice(-1000) }, null, 2)}\n`);
}

const storedRevision = (context: ShareContext, key: string, hash: string) => join(storeDirectory(context.home), 'items', storeFolder(key), hash);

/**
 * Why a tool's own skills folder cannot be written, if it cannot. A folder that is a link, or that is the same folder as another
 * tool's or the shared .agents folder, is never written through: a copy there would land in a folder Central Knot does not own.
 */
export async function rootProblem(context: ShareContext, tool: HarnessId): Promise<string | undefined> {
  const root = rootOf(context, tool);
  const name = harnesses[tool].name;
  try { if ((await lstat(root)).isSymbolicLink()) return `${name}'s skills folder is a link, so Central Knot does not write through it.`; }
  catch (error) { if (errorCode(error) !== 'ENOENT') return `${name}'s skills folder could not be checked.`; }
  // A folder not made yet still lands somewhere: through a linked parent, or where another tool's folder is.
  const real = await landingOf(root);
  if (!real) return `${name}'s skills folder could not be checked.`;
  const others = [...(Object.keys(harnesses) as HarnessId[]).filter(other => other !== tool).map(other => rootOf(context, other)), join(context.home, '.agents/skills')];
  for (const other of others) {
    if (await landingOf(other) === real) return `${name}'s skills folder is the same folder as ${other}, so Central Knot does not write there.`;
  }
  return undefined;
}


/** Only a real folder directly in the tool's own skills folder is written: never through a link, never a shared folder. */
async function writable(context: ShareContext, tool: HarnessId, directory: string, problems: Map<HarnessId, string | undefined>): Promise<boolean> {
  if (problems.get(tool)) return false;
  try {
    if ((await lstat(directory)).isSymbolicLink()) return false;
    const own = await realpath(rootOf(context, tool));
    return (await realpath(dirname(directory))) === own;
  } catch { return false; }
}

/** The page's view of a home. Reads only; writes nothing. */
export async function manageView(context: ShareContext, caughtUp: DestinationResult[] = [], notices: SyncNotice[] = []): Promise<ManageView> {
  const snapshots = await context.read();
  const { record } = await readRecord(context.home);
  const gathered = await gather(context, snapshots, record);
  // Edits waiting to spread (Sync off, or a pass still settling): the page shows them as pending, not as a choice to make.
  for (const [key, entry] of gathered) {
    const item = record?.items[key];
    if (item?.state !== 'shared' || !item.hash) continue;
    const recorded = new Set(item.copies.filter(copy => copy.status === 'written').map(copy => copy.directory));
    const edited = entry.locations.filter(location => recorded.has(location.copy.directory) && location.copy.hash !== item.hash).map(location => location.tool);
    if (edited.length) entry.facts.edited = [...new Set(edited)];
  }
  const skills = [...gathered.values()].map(entry => entry.facts).sort((first, second) => first.key.replace(/^\./, '').localeCompare(second.key.replace(/^\./, '')));
  const tools = presentTools(snapshots);
  const writes = Object.fromEntries(await Promise.all(tools.map(async tool => [tool, { to: rootOf(context, tool), alsoReadBy: harnesses[tool].otherReaders, blocked: await rootProblem(context, tool) }] as const)));
  return { tools, writes, skills, access: await writeAccess(context), gate: await syncGate(context), caughtUp, notices };
}

/** A copy changed between being read and being replaced: it is left as it is, for the next pass to see as an edit. */
const changedWhileSyncing = () => Object.assign(new Error('It changed while syncing, so it was left as it is. The next pass looks at it again.'), { code: 'CK_CHANGED' });

/**
 * Moves a different copy aside and puts the chosen one in its place. The replaced bytes are kept in the store first. `expected` is the
 * content the pass decided to replace: a copy holding anything else (an edit made meanwhile) is never replaced.
 */
async function replaceCopy(context: ShareContext, key: string, source: string, target: string, expected?: string): Promise<string> {
  if ((await lstat(target)).isSymbolicLink()) throw Object.assign(new Error('That copy is a link.'), { code: 'CK_LINK' });
  const old = await readTree(target);
  if (expected !== undefined && old.hash !== expected) throw changedWhileSyncing();
  await importRevision(context, key, target, old);
  const tree = await readTree(source);
  const folder = await stagingFolder(context, dirname(target));
  const stage = join(folder, `.ck-stage-${randomUUID()}`);
  const parked = join(folder, `.ck-stage-${randomUUID()}`);
  await copyTree(source, stage, tree);
  if ((await readTree(stage)).hash !== tree.hash) { await removeTree(stage); throw new Error('The staged copy did not match its source.'); }
  context.fault?.('before-replace');
  await rename(target, parked);
  // Saved into the copy after it was read and kept: put it back untouched, so that work is never lost.
  let parkedHash: string | undefined;
  try { parkedHash = (await readTree(parked)).hash; } catch { /* checked below */ }
  if (parkedHash !== old.hash) {
    await rename(parked, target).catch(async () => { if (parkedHash) await importRevision(context, key, parked, await readTree(parked)); });
    await removeTree(stage).catch(() => undefined);
    throw changedWhileSyncing();
  }
  context.fault?.('mid-replace');
  try { await rename(stage, target); }
  catch (error) { await rename(parked, target).catch(() => undefined); await removeTree(stage).catch(() => undefined); throw error; }
  await finishCopy(source, target);
  await removeTree(parked).catch(() => undefined);
  // What actually went in: the source as it was at this moment, which may be newer than when the pass first read it.
  return tree.hash;
}

/**
 * Removes a copy only if it still holds `expected`: it is moved aside first and checked there, so an edit saved meanwhile is put
 * back untouched instead of removed.
 */
async function removeChecked(context: ShareContext, directory: string, expected: string) {
  context.fault?.('before-remove');
  if ((await readTree(directory)).hash !== expected) throw changedWhileSyncing();
  const parked = join(await stagingFolder(context, dirname(directory)), `.ck-stage-${randomUUID()}`);
  await rename(directory, parked);
  let hash: string | undefined;
  try { hash = (await readTree(parked)).hash; } catch { /* checked below */ }
  if (hash !== expected) { await rename(parked, directory); throw changedWhileSyncing(); }
  await removeTree(parked);
}

/** Puts content about to be overwritten or removed on record first (see RecordItem.displaced). */
function displace(item: RecordItem, tool: HarnessId, hash: string, removal?: { folder: string; stoppedSync: boolean }) {
  item.displaced ??= [];
  // A removal is per tool: two tools' identical copies are two removals, so each is on record.
  if (!item.displaced.some(entry => entry.hash === hash && (!removal || entry.tool === tool))) item.displaced.push({ tool, hash, ...(removal ? { removal } : {}) });
}

/**
 * Records the person's choices, then brings every managed skill into line: a copy goes to each tool it syncs to and lacks,
 * and for differing copies the chosen copy replaces the others. No changes means a catch-up pass.
 */
/**
 * `observeOnly` (Sync off, SYN-03): read and keep the ordering evidence, write nothing. `only`: write only these skills, so an
 * explicit Apply all with Sync off does exactly what it shows and no background spreading rides along.
 */
export interface PassOptions { observeOnly?: boolean; only?: Set<string> }

export async function applyChanges(context: ShareContext, changes: Change[], resume = false, options: PassOptions = {}): Promise<ApplyResult> {
  try { return await runApply(context, changes, resume, options); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith('fault:')) throw error;
    return { stopped: `That could not finish. ${plainError(error)} Click Refresh to see where things stand.`, results: [], harnessWrites: 0 }; }
}

async function runApply(context: ShareContext, changes: Change[], resume: boolean, options: PassOptions): Promise<ApplyResult> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason, results: [], harnessWrites: 0 };
  const gate = await syncGate(context);
  if (gate.state === 'stopped') return { stopped: gate.reason, results: [], harnessWrites: 0 };
  if (gate.state === 'needs-resume' && !resume) return { stopped: gate.reason, results: [], harnessWrites: 0 };
  let record = (await readRecord(context.home)).record;
  if (!record && !changes.length) return { results: [], harnessWrites: 0 };

  const snapshots = await context.read();
  const tools = presentTools(snapshots);
  const gathered = await gather(context, snapshots, record);
  // A crash between these steps leaves an intact record this build can resume.
  if (!record) { record = { formatVersion: FORMAT_VERSION, generation: randomUUID(), owner: context.build, items: Object.create(null) }; await saveRecord(context.home, record); }
  if (gate.state !== 'ready') await remember(context, record.generation);
  // The record is saved only when it changed: catch-up runs on every read, and a read that finds nothing to do writes nothing.
  let saved = JSON.stringify(record);
  const save = async () => { const text = JSON.stringify(record); if (text !== saved) { await saveRecord(context.home, record!); saved = text; } };

  const results: DestinationResult[] = [];
  // Content displaced by an earlier pass that stopped before History named it (a crash, a failure part-way): named this pass.
  const carried = Object.entries(record.items).flatMap(([key, item]) => (item.displaced ?? []).map(entry => ({ key, ...entry })));
  // A missing copy is a deletion only when its tool's folder could be read and the copy's folder is really gone (DEL-01).
  // A folder that is there but was not read as a skill (unreadable, or its SKILL.md broken for now) is held, never deleted.
  const readable = new Map(snapshots.map(snapshot => [snapshot.harness, snapshot.discovery !== 'restricted' && snapshot.discovery !== 'failed']));
  const presence = async (copy: { harness: HarnessId; directory: string }): Promise<'gone' | 'unreadable' | 'unknown'> => {
    if (!readable.get(copy.harness) || !(await folderExists(dirname(copy.directory)))) return 'unknown';
    try { await lstat(copy.directory); return 'unreadable'; } catch (error) { return errorCode(error) === 'ENOENT' ? 'gone' : 'unknown'; }
  };
  // Skills this Apply all turns Managed: the copies it creates for them are told in History as 'added', so they can be undone.
  const newlyManaged = new Set<string>();
  // Changes taken (not held): the only ones that remove copies or flip switches after the sync loop. For each managed removal,
  // the tools it stops syncing to and their sync records (put back if a removal doesn't happen), and whether it takes the last copies.
  const taken = new Map<string, { stoppedSync: HarnessId[]; records: RecordItem['copies']; lastCopies: boolean }>();
  const added = new Map<string, { name: string; hash: string; copies: { tool: HarnessId; hash: string }[] }>();
  for (const change of changes) {
    const entry = gathered.get(change.key);
    if (!entry) continue;
    // A change made from an older read of the page is refused when the skill changed since: a deletion spread meanwhile must not be undone.
    const before = record.items[change.key];
    if (change.seenManaged !== undefined && (before?.state === 'shared') !== change.seenManaged) {
      results.push({ item: entry.facts.name, outcome: 'held', message: `${entry.facts.name} changed since the page was read${before?.deleted ? ' (it was deleted)' : ''}. Nothing was changed; read again.` });
      continue;
    }
    // A choice that cannot be carried out changes nothing at all: not even Managed.
    if (change.use && change.use !== 'separate') {
      const syncing = tools.filter(tool => !change.off.includes(tool) && !entry.facts.cannot[tool]);
      const problem = choiceProblem(entry, change.use, change.useHash, syncing);
      if (problem) { results.push({ item: entry.facts.name, outcome: 'held', message: problem }); continue; }
    }
    // Removing the very copy chosen for every tool would leave the choice nothing to copy from: refused, changing nothing.
    if (change.use && change.use !== 'separate' && change.remove?.includes(change.use)) {
      results.push({ item: entry.facts.name, harness: change.use, outcome: 'held', message: `You chose ${toolName(change.use)}’s copy and also asked to remove it there. Keep that copy, or choose another. Nothing was changed.` });
      continue;
    }
    // A Disable that can't be carried out changes nothing either: otherwise the copy would arrive enabled.
    const cantDisable = change.disable?.find(tool => entry.facts.switchProblem?.[tool] || entry.facts.disableUnverified?.[tool]);
    if (cantDisable) {
      const why = entry.facts.switchProblem?.[cantDisable] ? problemText(entry.facts.switchProblem[cantDisable]!) : entry.facts.disableUnverified![cantDisable]!;
      results.push({ item: entry.facts.name, harness: cantDisable, outcome: 'held', message: `Disable isn’t available in ${toolName(cantDisable)}: ${why} Nothing was changed.` });
      continue;
    }
    const item: RecordItem = record.items[change.key] ?? { name: entry.facts.name, hash: '', state: 'dont-share', startId: '', observedAt: new Date().toISOString(), copies: [] };
    if (change.managed && change.use !== 'separate' && item.state !== 'shared') newlyManaged.add(change.key);
    const wasOff = item.off ?? [];
    item.state = change.managed && change.use !== 'separate' ? 'shared' : 'dont-share';
    // A managed skill removed from a tool stops syncing there, or the next pass would put it back.
    const removing = item.state === 'shared' ? (change.remove ?? []).filter(tool => harnesses[tool]) : [];
    item.off = [...new Set([...change.off, ...removing])].filter(tool => harnesses[tool]);
    const stopping = removing.filter(tool => !wasOff.includes(tool));
    const lastCopies = removing.length > 0 && (Object.keys(entry.facts.copies) as HarnessId[]).every(tool => removing.includes(tool));
    taken.set(change.key, { stoppedSync: stopping, records: item.copies.filter(copy => stopping.includes(copy.harness)), lastCopies });
    // A copy is tracked only while the skill syncs to its tool: one removed while off, or while unmanaged, is no deletion later.
    item.copies = item.state === 'shared' ? item.copies.filter(copy => !item.off!.includes(copy.harness)) : [];
    // Removing a managed skill's every copy leaves nothing to sync: it is unmanaged (Restore manages it again).
    if (lastCopies) { item.state = 'dont-share'; item.copies = []; }
    item.separate = change.use === 'separate' ? true : change.managed ? undefined : item.separate;
    // The choice is on record before any copy is replaced, so a crash part-way finishes it at the next pass instead of losing it.
    if (change.use && change.use !== 'separate') item.use = { tool: change.use, hash: entry.facts.copies[change.use]!.hash };
    else if (!change.managed || change.use === 'separate') delete item.use;
    record.items[change.key] = item;
  }
  await save();
  if (!options.observeOnly) await clearStaleStages(context, tools.map(tool => writeRoot(harnesses[tool], context.home, context.overrides?.[tool])));

  let writes = 0;
  let settling = false;
  // A skills folder that was deleted and made again since the last pass (a reset or reinstall, even with the app closed) has a new
  // identity: its missing copies are put back, never read as deletions. Skills deleted inside the same folder are real deletions.
  const resetRoots = new Set<string>();
  const roots = [...new Set([...tools.map(tool => rootOf(context, tool)), join(context.home, '.agents/skills')])];
  const identities = new Map<string, { ino: number; birth: number }>();
  for (const root of roots) {
    try { const info = await stat(root); if (info.isDirectory()) identities.set(root, { ino: info.ino, birth: Math.round(info.birthtimeMs) }); } catch { /* unreachable */ }
    const before = record.roots?.[root];
    const now = identities.get(root);
    if (before && now && (before.ino !== now.ino || before.birth !== now.birth)) resetRoots.add(root);
  }
  const putBack = new Set<HarnessId>();
  // Skills whose deletion ran in this pass: this pass's listing still shows the copies it just removed.
  const deletedNow = new Set<string>();
  const notices: SyncNotice[] = [];
  const events: HistoryEvent[] = [];
  const event = (fields: Omit<HistoryEvent, 'id' | 'at'>) => { const made = { id: randomUUID(), at: new Date(clock(context)).toISOString(), ...fields }; events.push(made); return made.id; };
  for (const [key, entry] of gathered) {
    const item = record.items[key];
    if (item?.state !== 'shared') continue;
    // A skill this pass leaves alone keeps its folders' old identity on record, so a reset there is still seen next time.
    // A skill this pass leaves alone forgets its copies in folders made again (they are adopted or put back once it is handled),
    // so the folder's new identity can be kept; and no missing time of its copies outlives this pass.
    const skip = () => {
      for (const copy of item.copies) delete mark(copy.directory).missingSince;
      item.copies = item.copies.filter(copy => !resetRoots.has(dirname(copy.directory)));
    };
    if (options.only && !options.only.has(key)) { skip(); continue; }
    const name = entry.facts.name;
    if (entry.facts.held) { skip(); results.push({ item: name, outcome: 'held', message: entry.facts.held }); continue; }
    const syncing = tools.filter(tool => !item.off?.includes(tool));
    const locations = entry.locations.filter(location => syncing.includes(location.tool) && !entry.facts.cannot[location.tool]);
    const chosen = item.use?.tool;
    if (item.use) {
      // A choice recorded before a crash is finished only if it still holds.
      const problem = choiceProblem(entry, item.use.tool, item.use.hash, syncing.filter(tool => !entry.facts.cannot[tool]));
      if (problem) { results.push({ item: name, outcome: 'held', message: problem }); delete item.use; continue; }
    }
    // ---- Two-way: once a skill has a synced baseline, edits and deletions spread on their own (8b) ----
    // A copy is tracked only in its tool's current folders: one left behind by a moved CLAUDE_CONFIG_DIR, COPILOT_HOME or CODEX_HOME
    // is let go, never read as a deletion. A recorded copy found under another spelling (a case-only rename) is the same copy.
    item.copies = item.copies.filter(copy => ownRoots(context, copy.harness).some(root => sameDir(dirname(copy.directory), root)));
    for (const copy of item.copies) {
      const found = entry.locations.find(location => location.tool === copy.harness && sameDir(location.copy.directory, copy.directory))
        ?? entry.locations.find(location => location.tool === copy.harness && sameDir(dirname(location.copy.directory), dirname(copy.directory)) && !item.copies.some(other => sameDir(other.directory, location.copy.directory)))
        // Moved into another folder the same tool reads (for example into ~/.agents/skills) with the same content: the same copy, not a deletion.
        ?? entry.locations.find(location => location.tool === copy.harness && location.copy.hash === copy.hash && !item.copies.some(other => sameDir(other.directory, location.copy.directory)));
      // Moved into a folder Central Knot does not change (the shared .agents folder): followed no further, and said so, since later
      // edits can't reach it there. Moving it back into the tool's own folder makes it sync again.
      if (found && !found.copy.writable && !sameDir(dirname(found.copy.directory), dirname(copy.directory))) {
        results.push({ item: entry.facts.name, harness: copy.harness, outcome: 'held', message: `${harnesses[copy.harness].name}'s copy moved to ${found.copy.directory}, which Central Knot does not change, so edits can't reach it there. Move it back to ${rootOf(context, copy.harness)} to keep it syncing.` });
        item.copies = item.copies.filter(other => other !== copy);
        continue;
      }
      if (found) copy.directory = found.copy.directory;
    }
    // An unrecorded copy holding the synced content, or an earlier revision of this skill from the store (a folder switched back,
    // a copy that once failed to update), is this skill's copy, just behind: adopt it rather than call it a collision.
    if (item.hash) for (const location of locations) {
      if (item.copies.some(copy => copy.directory === location.copy.directory) || !location.copy.writable) continue;
      if (location.copy.hash === item.hash || await exists(storedRevision(context, key, location.copy.hash))) item.copies.push({ harness: location.tool, directory: location.copy.directory, hash: location.copy.hash, created: false, status: 'written' });
    }
    // Each recorded copy remembers the content last seen or written there: a copy that differs from that was edited; one that
    // still matches it but not the synced content is only behind, and is caught up, never treated as an edit.
    // A folder that was reset and refilled (say, from an older backup) holds old copies: an earlier revision there is behind, not an edit.
    for (const copy of item.copies) {
      if (copy.status !== 'written' || !resetRoots.has(dirname(copy.directory))) continue;
      const here = entry.locations.find(location => location.copy.directory === copy.directory);
      if (here && here.copy.hash !== copy.hash && await exists(storedRevision(context, key, here.copy.hash))) copy.hash = here.copy.hash;
    }
    const recordedHash = new Map(item.copies.filter(copy => copy.status === 'written').map(copy => [copy.directory, copy.hash]));
    const recorded = new Set(recordedHash.keys());
    // Once synced, a read-only copy outside the record (a link, or the shared .agents folder) is reported, never followed: it could not take the edit, so it must not win later.
    const active = item.hash ? locations.filter(location => recorded.has(location.copy.directory) || location.copy.writable) : locations;
    for (const location of locations.filter(candidate => !active.includes(candidate) && candidate.copy.hash !== item.hash)) {
      results.push({ item: name, harness: location.tool, outcome: 'held', message: `${harnesses[location.tool].name} also reads an older copy at ${location.copy.directory}, which Central Knot does not change.` });
    }
    let winner: Location | undefined;
    let story: { kind: 'edit' | 'conflict' | 'kept-edit'; orderProved: boolean; competitors: HarnessId[]; deleted: HarnessId[] } | undefined;
    if (item.hash && !chosen) {
      const baseline = item.hash;
      const now = clock(context);
      for (const location of active) {
        if (!recorded.has(location.copy.directory)) continue;
        const seen = mark(location.copy.directory);
        delete seen.missingSince;
        if (location.copy.hash === recordedHash.get(location.copy.directory)) { seen.verifiedAt = now; delete seen.changed; delete seen.firstSeen; }
        else if (seen.changed !== location.copy.hash) { seen.changed = location.copy.hash; seen.firstSeen = now; }
      }
      // A recorded copy missing from a reachable folder is a deletion once it stays missing past the settle window (DEL-01).
      // A folder that was deleted and made again (a reset or reinstall, even while the app was closed) is no deletion: its copies are put back.
      const deletions: { tool: HarnessId; directory: string }[] = [];
      let waiting = false;
      let unreadable: HarnessId | undefined;
      for (const copy of item.copies) {
        if (copy.status !== 'written' || !syncing.includes(copy.harness) || entry.locations.some(location => location.copy.directory === copy.directory)) continue;
        if (resetRoots.has(dirname(copy.directory))) continue;
        const state = await presence(copy);
        if (state === 'unreadable') unreadable ??= copy.harness;
        if (state !== 'gone') { delete mark(copy.directory).missingSince; continue; }
        const seen = mark(copy.directory);
        seen.missingSince ??= now;
        if (now - seen.missingSince >= (context.settleMs ?? 2000)) deletions.push({ tool: copy.harness, directory: copy.directory }); else waiting = true;
      }
      if (resetRoots.size) item.copies = item.copies.filter(copy => !resetRoots.has(dirname(copy.directory)) || entry.locations.some(location => location.copy.directory === copy.directory));
      // A copy still on disk that could not be read as a skill: nothing about this skill is decided until it reads again.
      if (unreadable) { skip(); results.push({ item: name, harness: unreadable, outcome: 'held', message: `${harnesses[unreadable].name}'s copy is there but could not be read as a skill right now. Nothing is changed until it reads again.` }); continue; }
      // Never act on a copy that may have just gone: wait until every missing copy has settled, then decide once.
      if (waiting) { settling = true; continue; }
      // Sync off: the evidence above is kept, so order can be proved later; nothing is written now.
      if (options.observeOnly) continue;
      const changed = active.filter(location => recorded.has(location.copy.directory) && location.copy.hash !== recordedHash.get(location.copy.directory));
      // With Sync off, Apply all writes only what it shows: a pending edit or deletion of this skill waits for Sync.
      if (options.only && (changed.length || deletions.length)) { results.push({ item: name, outcome: 'held', message: `An edit or deletion of ${name} is waiting for sync. Turn automatic sync on, or use Sync once.` }); continue; }
      if (deletions.length) {
        const deletedSeen = Math.min(...deletions.map(gone => evidence.get(gone.directory)!.missingSince!));
        const deletedVerified = Math.max(...deletions.map(gone => evidence.get(gone.directory)?.verifiedAt ?? -Infinity));
        // An edit is proved older than the deletion when the deleted copy was still at the baseline after the edit was seen.
        const live = changed.filter(location => !(deletedVerified >= (evidence.get(location.copy.directory)?.firstSeen ?? Infinity)));
        if (!live.length) {
          const leftover: RecordItem['copies'] = [];
          const removed: HarnessId[] = [];
          const lost: { tool: HarnessId; hash: string }[] = [];
          for (const location of active) {
            // Only the skill's own copies go: recorded ones, or one identical to it. A different copy that was never synced stays.
            if (!recorded.has(location.copy.directory) && location.copy.hash !== baseline) {
              results.push({ item: name, harness: location.tool, outcome: 'held', message: `${harnesses[location.tool].name} has a different “${name}” that was never synced. It stays.` });
              continue;
            }
            if (!location.copy.writable) { results.push({ item: name, harness: location.tool, outcome: 'held', message: `${harnesses[location.tool].name} also reads a copy at ${location.copy.directory}, which Central Knot does not change. Remove it yourself to finish deleting ${name}.` }); continue; }
            const late = await rootProblem(context, location.tool);
            if (late) { results.push({ item: name, harness: location.tool, outcome: 'held', message: late }); continue; }
            try {
              // Content that only existed here goes to the store first, so the deletion can be undone (CON-02).
              if (location.copy.hash !== baseline) {
                await importRevision(context, key, location.copy.directory, await readTree(location.copy.directory));
                // Only an edit is content the deletion took; a behind copy is an older revision already kept.
                if (location.copy.hash !== recordedHash.get(location.copy.directory)) { lost.push({ tool: location.tool, hash: location.copy.hash }); displace(item, location.tool, location.copy.hash); await save(); }
              }
              await removeChecked(context, location.copy.directory, location.copy.hash);
            } catch (error) {
              if (error instanceof Error && error.message.startsWith('fault:')) throw error;
              // Edited just now: that edit is kept where it is, as a copy Central Knot no longer manages.
              if (errorCode(error) === 'CK_CHANGED') {
                if (lost.at(-1)?.hash === location.copy.hash) lost.pop();
                results.push({ item: name, harness: location.tool, outcome: 'held', message: `${harnesses[location.tool].name}'s copy was edited just as the deletion spread, so it was kept as it is.` });
                continue;
              }
              // One copy that can't go (a locked file, a read-only folder) never stops the rest: it is retried while it is unchanged.
              leftover.push({ harness: location.tool, directory: location.copy.directory, hash: location.copy.hash, created: false, status: 'removing' });
              results.push({ item: name, harness: location.tool, outcome: 'failed', message: `Could not remove ${harnesses[location.tool].name}'s copy yet: ${plainError(error)} Central Knot will try again.` });
              continue;
            }
            writes++;
            removed.push(location.tool);
            results.push({ item: name, harness: location.tool, outcome: 'removed', message: `Deleted in ${harnesses[deletions[0].tool].name}, so removed here too. Restore it from History.` });
          }
          const id = event({ key, item: name, kind: 'deleted', winner: { tool: deletions[0].tool, hash: baseline }, losers: lost, orderProved: true, previous: baseline });
          notices.push({ key, item: name, kind: 'deleted', winner: deletions[0].tool, losers: removed, orderProved: true, history: id });
          item.copies = leftover;
          item.state = 'dont-share';
          item.deleted = { at: new Date(now).toISOString(), tool: deletions[0].tool, hash: baseline };
          deletedNow.add(key);
          continue;
        }
        // The edit is kept over the deletion; with order unknown, Delete everywhere stays on offer (D-04).
        const pick = newest(live);
        const provedNewer = live.every(location => (evidence.get(location.copy.directory)?.verifiedAt ?? -Infinity) >= deletedSeen);
        winner = pick.winner;
        item.copies = item.copies.filter(copy => !deletions.some(gone => gone.directory === copy.directory));
        for (const gone of deletions) evidence.delete(gone.directory);
        story = { kind: 'kept-edit', orderProved: provedNewer && pick.proved, competitors: [], deleted: deletions.map(gone => gone.tool) };
      } else if (changed.length) {
        const pick = newest(changed);
        winner = pick.winner;
        const competing = new Set(changed.map(location => location.copy.hash)).size > 1;
        story = { kind: competing ? 'conflict' : 'edit', orderProved: !competing || pick.proved, competitors: changed.filter(location => location.copy.hash !== pick.winner.copy.hash).map(location => location.tool), deleted: [] };
      }
      // A writable copy outside the record that differs is a same-name collision, never an edit: it needs a choice.
      if (winner && active.some(location => !recorded.has(location.copy.directory) && location.copy.hash !== winner!.copy.hash && location.copy.hash !== baseline)) {
        results.push({ item: name, outcome: 'held', message: 'Copies differ. Choose which copy to use.' });
        continue;
      }
    }
    if (options.observeOnly) continue;
    if (!active.length) { results.push({ item: name, outcome: 'held', message: 'No tool it syncs to has a copy to start from.' }); continue; }
    const hashes = new Set(active.map(location => location.copy.hash));
    const baselineBefore = item.hash;
    try {
      let source = active[0].copy;
      let sourceTool = active[0].tool;
      const replaced: HarnessId[] = [];
      const losers: { tool: HarnessId; hash: string }[] = [];
      // Copies that end this pass holding the source's content; only these stay on record.
      const inSync = new Set<string>();
      // The content each replace actually wrote, which can be newer than what this pass first read at the source.
      const written = new Map<string, string>();
      const chosenLosers: { tool: HarnessId; hash: string }[] = [];
      if (winner) {
        source = winner.copy;
        sourceTool = winner.tool;
        for (const location of active) {
          if (location.copy.hash === source.hash) { inSync.add(location.copy.directory); continue; }
          const late = await rootProblem(context, location.tool);
          const refusal = late ?? (location.copy.writable ? undefined : `${harnesses[location.tool].name} reads a copy at ${location.copy.directory}, which Central Knot does not change.`);
          if (refusal) { results.push({ item: name, harness: location.tool, outcome: 'held', message: refusal }); continue; }
          // The intent is on record first: a crash mid-replace then reads as an unfinished copy, never as a deletion.
          const known = item.copies.find(copy => copy.directory === location.copy.directory);
          if (known) known.status = 'pending';
          displace(item, location.tool, location.copy.hash);
          await save();
          try { written.set(location.copy.directory, await replaceCopy(context, key, source.directory, location.copy.directory, location.copy.hash)); }
          catch (error) {
            if (error instanceof Error && error.message.startsWith('fault:')) throw error;
            // Not replaced: its content is still on disk, so it is not displaced.
            if (item.displaced) item.displaced = item.displaced.filter(entry => entry.hash !== location.copy.hash);
            results.push({ item: name, harness: location.tool, outcome: errorCode(error) === 'CK_CHANGED' ? 'held' : 'failed', message: `Could not update ${harnesses[location.tool].name}'s copy. ${plainError(error)}` });
            continue;
          }
          writes++;
          inSync.add(location.copy.directory);
          replaced.push(location.tool);
          losers.push({ tool: location.tool, hash: location.copy.hash });
          results.push({ item: name, harness: location.tool, outcome: 'written', message: `Now has ${harnesses[sourceTool].name}'s edit. The replaced copy is kept in History. ${harnesses[location.tool].nextStep}` });
        }
      } else if ((hashes.size > 1 || !hashes.has(item.hash)) && item.hash && !chosen && active.every(location => location.copy.hash === item.hash || location.copy.hash === recordedHash.get(location.copy.directory))
        && (active.some(location => location.copy.hash === item.hash) || await exists(storedRevision(context, key, item.hash)))) {
        // Copies that are only behind (a write that failed, a folder switched back, every folder restored from an older backup)
        // catch up to the synced content, quietly, from the store when no tool holds it.
        const holder = active.find(location => location.copy.hash === item.hash);
        source = holder?.copy ?? { ...active[0].copy, directory: storedRevision(context, key, item.hash), hash: item.hash };
        sourceTool = holder?.tool ?? active[0].tool;
        for (const location of active) {
          if (location.copy.hash === item.hash) { inSync.add(location.copy.directory); continue; }
          const late = await rootProblem(context, location.tool);
          const refusal = late ?? (location.copy.writable ? undefined : `${harnesses[location.tool].name} reads an older copy at ${location.copy.directory}, which Central Knot does not change.`);
          if (refusal) { results.push({ item: name, harness: location.tool, outcome: 'held', message: refusal }); continue; }
          const known = item.copies.find(copy => copy.directory === location.copy.directory);
          if (known) { known.status = 'pending'; await save(); }
          try { written.set(location.copy.directory, await replaceCopy(context, key, source.directory, location.copy.directory, location.copy.hash)); }
          catch (error) {
            if (error instanceof Error && error.message.startsWith('fault:')) throw error;
            // Not replaced: its content is still on disk, so it is not displaced.
            if (item.displaced) item.displaced = item.displaced.filter(entry => entry.hash !== location.copy.hash);
            results.push({ item: name, harness: location.tool, outcome: errorCode(error) === 'CK_CHANGED' ? 'held' : 'failed', message: `Could not update ${harnesses[location.tool].name}'s copy. ${plainError(error)}` });
            continue;
          }
          writes++;
          inSync.add(location.copy.directory);
          results.push({ item: name, harness: location.tool, outcome: 'written', message: `Caught up. ${harnesses[location.tool].nextStep}` });
        }
      } else if (hashes.size > 1) {
        if (!chosen) { results.push({ item: name, outcome: 'held', message: 'Copies differ. Choose which copy to use.' }); continue; }
        source = entry.facts.copies[chosen]!;
        sourceTool = chosen;
        for (const location of active) {
          if (location.copy.hash === source.hash) { inSync.add(location.copy.directory); continue; }
          // Checked again just before writing: a folder can become a link after the page was read.
          const late = await rootProblem(context, location.tool);
          if (late) { results.push({ item: name, harness: location.tool, outcome: 'held', message: late }); continue; }
          if (!location.copy.writable) {
            results.push({ item: name, harness: location.tool, outcome: 'held', message: `${harnesses[location.tool].name} also reads a different copy at ${location.copy.directory}, which is a link or a folder other tools share. Central Knot does not change it; change or remove it yourself.` });
            continue;
          }
          displace(item, location.tool, location.copy.hash);
          await save();
          try { written.set(location.copy.directory, await replaceCopy(context, key, source.directory, location.copy.directory, location.copy.hash)); }
          catch (error) {
            if (error instanceof Error && error.message.startsWith('fault:')) throw error;
            // Not replaced: its content is still on disk, so it is not displaced.
            if (item.displaced) item.displaced = item.displaced.filter(entry => entry.hash !== location.copy.hash);
            results.push({ item: name, harness: location.tool, outcome: errorCode(error) === 'CK_CHANGED' ? 'held' : 'failed', message: `Could not update ${harnesses[location.tool].name}'s copy. ${plainError(error)}` });
            continue;
          }
          writes++;
          inSync.add(location.copy.directory);
          chosenLosers.push({ tool: location.tool, hash: location.copy.hash });
          results.push({ item: name, harness: location.tool, outcome: 'written', message: `Now uses ${harnesses[chosen].name}'s copy. The replaced copy is kept in Central Knot's store. ${harnesses[location.tool].nextStep}` });
        }
      } else for (const location of active) inSync.add(location.copy.directory);
      delete item.use;
      // The synced content is what the pass decided on (the source as first read), kept in the store from wherever it still is.
      const target = source.hash;
      for (const from of [source.directory, ...[...written].filter(([, hash]) => hash === target).map(([directory]) => directory)]) {
        try { const held = await readTree(from); if (held.hash === target) { await importRevision(context, key, from, held); break; } } catch { /* try the next */ }
      }
      const tree = await readTree(source.directory);
      item.hash = target;
      // Only copies holding the new content stay on record. One that could not be updated is let go, so it can never win back as an "edit".
      // Every copy stays on record with the content it holds now: updated ones with the new content, ones that could not be updated
      // with their old content, so they are behind (caught up later), never mistaken for an edit.
      for (const location of active) {
        const now = written.get(location.copy.directory) ?? (inSync.has(location.copy.directory) ? target : location.copy.hash);
        const known = item.copies.find(copy => copy.directory === location.copy.directory);
        if (known) { known.status = 'written'; known.hash = now; }
        else if (inSync.has(location.copy.directory)) item.copies.push({ harness: location.tool, directory: location.copy.directory, hash: now, created: false, status: 'written' });
      }
      // What sync did on its own goes to History once, after it happened (CON-02).
      // A chosen copy that replaced others is History too, so its replaced content stays recoverable (and is never pruned).
      if (chosenLosers.length) event({ key, item: name, kind: 'chosen', winner: { tool: sourceTool, hash: target }, losers: chosenLosers, orderProved: true, previous: baselineBefore || undefined });
      // An edit that changed the synced content is History even when no copy could be written yet (a failed write caught up later),
      // so the version it replaces stays restorable and is never pruned.
      if (story && (replaced.length || story.deleted.length || (baselineBefore && baselineBefore !== target))) {
        // Every overwritten copy is named, including a competing edit that lost while a deletion raced, so none is pruned.
        const id = event({ key, item: name, kind: story.kind, winner: { tool: sourceTool, hash: target }, losers: story.kind === 'kept-edit' ? [...story.deleted.map(tool => ({ tool, hash: baselineBefore })), ...losers] : losers, orderProved: story.orderProved, previous: baselineBefore });
        if (replaced.length || story.deleted.length) notices.push({ key, item: name, kind: story.kind, winner: sourceTool, losers: story.kind === 'conflict' ? story.competitors : story.kind === 'kept-edit' ? story.deleted : replaced, orderProved: story.orderProved, history: id });
      }
      const sourceSkill = entry.skills[sourceTool]?.find(skill => skill.directory === source.directory);
      for (const tool of syncing.filter(entryTool => !entry.locations.some(location => location.tool === entryTool))) {
        if (entry.facts.cannot[tool]) continue;
        const directory = ownCopyDir(context, tool, entry.facts.name);
        const refused = (sourceSkill && targetFor(tool, directory, sourceSkill).skipped) || await rootProblem(context, tool);
        if (refused) { results.push({ item: name, harness: tool, outcome: 'held', message: refused }); continue; }
        const intent = { harness: tool, directory, hash: tree.hash, created: true, status: 'pending' as const };
        item.copies = [...item.copies.filter(known => known.directory !== directory), intent];
        await save();
        try { await mkdir(dirname(directory), { recursive: true }); await placeCopy(context, source.directory, { harness: tool, directory, limits: [] }, tree); }
        catch (error) {
          item.copies = item.copies.filter(known => known !== intent);
          if (error instanceof Error && error.message.startsWith('fault:')) throw error;
          results.push({ item: name, harness: tool, outcome: 'failed', message: `Could not copy to ${harnesses[tool].name}. ${plainError(error)}` });
          continue;
        }
        context.fault?.('after-rename');
        (intent as { status: string }).status = 'written';
        if (newlyManaged.has(key)) { const told = added.get(key) ?? { name, hash: tree.hash, copies: [] }; told.copies.push({ tool, hash: tree.hash }); added.set(key, told); }
        writes++;
        if (resetRoots.has(dirname(directory))) putBack.add(tool);
        results.push({ item: name, harness: tool, outcome: 'written', message: harnesses[tool].nextStep });
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('fault:')) throw error;
      results.push({ item: name, outcome: 'failed', message: plainError(error) });
    }
  }
  for (const [key, told] of added) event({ key, item: told.name, kind: 'added', losers: told.copies, orderProved: true, previous: told.hash });
  /**
   * Removes the named tools' copies of one skill (Remove), each kept in the store first, as one 'removed' event for Restore.
   * A removal that doesn't happen leaves the copy syncing as before: back in sync, with its sync record, so it never quietly
   * stops updating.
   */
  const removeCopies = async (change: Change, entry: Gathered, item: RecordItem) => {
    const { stoppedSync, records, lastCopies } = taken.get(change.key)!;
    const name = entry.facts.name;
    const removed: NonNullable<HistoryEvent['losers']> = [];
    const keepSyncing = async (tool: HarnessId) => {
      if (!stoppedSync.includes(tool)) return;
      // A copy stays after all, so a skill these removals were to unmanage stays managed.
      if (lastCopies) item.state = 'shared';
      item.off = (item.off ?? []).filter(other => other !== tool);
      item.copies.push(...records.filter(copy => copy.harness === tool));
      await save();
    };
    for (const tool of change.remove ?? []) {
      const copy = entry.facts.copies[tool];
      if (!copy) continue;
      const refusal = (copy.writable ? undefined : `${toolName(tool)} reads it at ${copy.directory}, which Central Knot does not change. Remove it there yourself.`) ?? await rootProblem(context, tool);
      if (refusal) { await keepSyncing(tool); results.push({ item: name, harness: tool, outcome: 'held', message: refusal }); continue; }
      try {
        // Kept in the store and on record first (as a removal, so a crash before History still recovers it as one).
        await importRevision(context, change.key, copy.directory, await readTree(copy.directory));
        displace(item, tool, copy.hash, { folder: copy.folder, stoppedSync: stoppedSync.includes(tool) });
        await save();
        await removeChecked(context, copy.directory, copy.hash);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('fault:')) throw error;
        if (item.displaced) item.displaced = item.displaced.filter(kept => !(kept.hash === copy.hash && kept.tool === tool));
        await keepSyncing(tool);
        results.push({ item: name, harness: tool, outcome: errorCode(error) === 'CK_CHANGED' ? 'held' : 'failed', message: errorCode(error) === 'CK_CHANGED' ? `${toolName(tool)}’s copy changed just now, so it was kept.` : `Could not remove ${toolName(tool)}’s copy: ${plainError(error)}` });
        continue;
      }
      writes++;
      // Managed: the content last synced to it goes along, so Restore can put its sync record back.
      const synced = records.find(record => record.harness === tool)?.hash;
      removed.push({ tool, hash: copy.hash, folder: copy.folder, ...(synced ? { synced } : {}) });
      results.push({ item: name, harness: tool, outcome: 'removed', message: `Removed from ${toolName(tool)}. Restore it from History.` });
    }
    if (removed.length) event({ key: change.key, item: name, kind: 'removed', losers: removed, orderProved: true, stoppedSync: stoppedSync.filter(tool => removed.some(gone => gone.tool === tool)), ...(lastCopies && item.state !== 'shared' ? { unmanaged: true } : {}) });
  };

  /**
   * Flips the named tools' switches for one skill (Disable, Enable), as one 'switched' event for Undo. Only the tools the change
   * names: a switch flipped in another tool meanwhile is that tool's own, and stays.
   */
  const flipSwitches = async (change: Change, entry: Gathered) => {
    const name = entry.facts.name;
    const switched: SwitchRecord[] = [];
    for (const [tool, disabled] of [...(change.disable ?? []).map(tool => [tool, true] as const), ...(change.enable ?? []).map(tool => [tool, false] as const)]) {
      if (!tools.includes(tool) || change.remove?.includes(tool)) continue;
      // Named as the copy is now: one this pass wrote or replaced may carry another name.
      const target = await liveSwitchTarget(context, entry, tool);
      if (!target) { if (disabled) results.push({ item: name, harness: tool, outcome: 'held', message: `${toolName(tool)} has no copy to disable.` }); continue; }
      let flipped: { changed: boolean; previous?: string };
      try { flipped = await setDisabled(context, tool, target, disabled); }
      catch (error) {
        results.push({ item: name, harness: tool, outcome: 'failed', message: `Could not ${disabled ? 'disable' : 'enable'} it in ${toolName(tool)}: ${switchFailure(error)}` });
        continue;
      }
      if (!flipped.changed) continue;
      // The target is kept, so Undo reverses this very entry even if the copy is gone by then.
      switched.push({ tool, disabled, target, ...(flipped.previous ? { before: flipped.previous } : {}) });
      results.push({ item: name, harness: tool, outcome: 'switched', disabled, message: disabled ? `Disabled in ${toolName(tool)}: the copy stays, and ${toolName(tool)} doesn’t load it from its next session.` : `Enabled again in ${toolName(tool)} from its next session.` });
    }
    if (switched.length) event({ key: change.key, item: name, kind: 'switched', switched, losers: [], orderProved: true });
  };

  // Per-tool removals and switches, explicit only: after the sync above, so a copy written just now can be disabled too.
  if (!options.observeOnly) for (const change of changes) {
    const entry = gathered.get(change.key);
    const item = record.items[change.key];
    if (!entry || !item || !taken.has(change.key)) continue;
    await removeCopies(change, entry, item);
    await flipSwitches(change, entry);
  }
  if (!options.observeOnly) {
    const now = clock(context);
    for (const [key, item] of Object.entries(record.items)) {
      // Apply all with Sync off writes only what it shows: no earlier deletion finishes alongside it.
      if (options.only && !options.only.has(key)) continue;
      // A copy a deletion could not remove is retried while it still holds what it held; changed or gone, it is let go.
      // A folder made again since (a reset or reinstall) holds a new install: the old deletion has no say over it.
      // A skill put back by hand in another tool since is wanted again: the old deletion stops.
      if (deletedNow.has(key)) continue;
      const readded = gathered.get(key)?.locations.some(location => !item.copies.some(copy => sameDir(copy.directory, location.copy.directory)));
      for (const copy of item.copies.filter(entry => entry.status === 'removing')) {
        if (resetRoots.has(dirname(copy.directory)) || readded) { item.copies = item.copies.filter(entry => entry !== copy); continue; }
        try {
          if ((await readTree(copy.directory)).hash === copy.hash) { await removeChecked(context, copy.directory, copy.hash); writes++; results.push({ item: item.name, harness: copy.harness, outcome: 'removed', message: 'Removed now, finishing an earlier deletion.' }); }
          item.copies = item.copies.filter(entry => entry !== copy);
        } catch (error) {
          if (errorCode(error) === 'ENOENT') item.copies = item.copies.filter(entry => entry !== copy);
        }
      }
      // A managed skill gone from every tool at once (an uninstaller, or while the app was closed) is a deletion once settled,
      // never a hidden managed record that later acts on a new install (D-37).
      if (item.state !== 'shared' || gathered.has(key)) continue;
      const recordedCopies = item.copies.filter(copy => copy.status === 'written' && !item.off?.includes(copy.harness) && tools.includes(copy.harness));
      if (!recordedCopies.length) continue;
      // Folders made again empty (a reset): the skill is put back from the store, never read as deleted everywhere.
      const reset = recordedCopies.filter(copy => resetRoots.has(dirname(copy.directory)));
      if (reset.length) {
        const kept = storedRevision(context, key, item.hash);
        let tree;
        try { tree = await readTree(kept); } catch { results.push({ item: item.name, outcome: 'held', message: 'Its folders were made again empty, and its synced content is no longer in the store to put back.' }); continue; }
        for (const copy of reset) {
          const refused = await rootProblem(context, copy.harness);
          if (refused) { results.push({ item: item.name, harness: copy.harness, outcome: 'held', message: refused }); continue; }
          try {
            copy.status = 'pending';
            await save();
            await mkdir(dirname(copy.directory), { recursive: true });
            await placeCopy(context, kept, { harness: copy.harness, directory: copy.directory, limits: [] }, tree);
            copy.status = 'written';
            copy.hash = tree.hash;
            writes++;
            putBack.add(copy.harness);
            results.push({ item: item.name, harness: copy.harness, outcome: 'written', message: harnesses[copy.harness].nextStep });
          } catch (error) {
            if (error instanceof Error && error.message.startsWith('fault:')) throw error;
            results.push({ item: item.name, harness: copy.harness, outcome: 'failed', message: `Could not put it back in ${harnesses[copy.harness].name}. ${plainError(error)}` });
          }
        }
        continue;
      }
      let ready = true;
      for (const copy of recordedCopies) {
        if ((await presence(copy)) !== 'gone') { ready = false; delete mark(copy.directory).missingSince; continue; }
        const seen = mark(copy.directory);
        seen.missingSince ??= now;
        if (now - seen.missingSince < (context.settleMs ?? 2000)) { ready = false; settling = true; }
      }
      if (!ready) continue;
      const id = event({ key, item: item.name, kind: 'deleted', winner: { tool: recordedCopies[0].harness, hash: item.hash }, losers: [], orderProved: false, previous: item.hash });
      notices.push({ key, item: item.name, kind: 'deleted', winner: recordedCopies[0].harness, losers: [], orderProved: false, history: id });
      item.copies = [];
      item.state = 'dont-share';
      item.deleted = { at: new Date(now).toISOString(), tool: recordedCopies[0].harness, hash: item.hash };
    }
  }
  // A pending copy from a crash that is not on disk was never made.
  for (const item of Object.values(record.items)) for (const copy of [...item.copies]) {
    if (copy.status !== 'pending') continue;
    if (await exists(copy.directory)) copy.status = 'written'; else item.copies = item.copies.filter(other => other !== copy);
  }
  for (const tool of putBack) notices.push({ key: '', item: '', kind: 'reset', winner: tool, losers: [], orderProved: true, history: '' });
  // Identities as they stand after this pass, so a folder this pass created is not a "reset" next time.
  if (!options.observeOnly) {
    record.roots = { ...record.roots };
    for (const root of roots) {
      try { const info = await stat(root); if (info.isDirectory()) record.roots[root] = { ino: info.ino, birth: Math.round(info.birthtimeMs) }; } catch { /* unreachable */ }
    }
  }
  // Displaced content no event of this pass names (left by a pass that stopped part-way) gets its own History entry, so it can be put back.
  const named = (key: string, hash: string) => events.some(made => made.key === key && (made.previous === hash || made.winner?.hash === hash || made.losers.some(loser => loser.hash === hash)));
  for (const left of carried) {
    const item = record.items[left.key];
    if (!item || named(left.key, left.hash)) continue;
    // A per-tool removal stopped before History named it: recovered as that removal, so Restore puts it back where it was.
    if (left.removal) { event({ key: left.key, item: item.name, kind: 'removed', losers: [{ tool: left.tool, hash: left.hash, folder: left.removal.folder }], orderProved: true, stoppedSync: left.removal.stoppedSync ? [left.tool] : [] }); continue; }
    const gone = item.state !== 'shared' && item.deleted;
    event(gone
      ? { key: left.key, item: item.name, kind: 'deleted', winner: { tool: item.deleted!.tool, hash: item.deleted!.hash }, losers: [{ tool: left.tool, hash: left.hash }], orderProved: false, previous: item.deleted!.hash }
      : { key: left.key, item: item.name, kind: 'edit', winner: { tool: left.tool, hash: item.hash }, losers: [{ tool: left.tool, hash: left.hash }], orderProved: false, previous: left.hash });
  }
  await save();
  if (events.length) {
    await saveHistory(context.home, [...await readHistory(context.home), ...events], clock(context));
    await pruneStore(context, record, await readHistory(context.home));
  }
  // Now that History names it, displaced content needs no other hold. Content displaced this pass that no event names stays on record.
  let cleared = false;
  for (const [key, item] of Object.entries(record.items)) {
    if (!item.displaced?.length) continue;
    const left = item.displaced.filter(entry => !named(key, entry.hash));
    if (left.length !== item.displaced.length) { cleared = true; if (left.length) item.displaced = left; else delete item.displaced; }
  }
  if (cleared) await save();
  return { results, harnessWrites: writes, notices, settling };
}


// ---------- Explicit History actions: Restore and Delete everywhere ----------

/** Guards shared by explicit actions: they write exactly what they show, but only where writing is allowed and the record is ours. */
async function explicitStart(context: ShareContext, resume: boolean): Promise<{ stopped?: string; record?: SyncRecord }> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason };
  const gate = await syncGate(context);
  if (gate.state === 'stopped' || (gate.state === 'needs-resume' && !resume)) return { stopped: gate.reason };
  const { record } = await readRecord(context.home);
  if (!record) return { stopped: 'Nothing is on record yet, so there is nothing to restore.' };
  if (gate.state !== 'ready') await remember(context, record.generation);
  return { record };
}

/** The content an event's Undo or Restore puts back: what a deletion removed, or the losing side of an edit (CON-02). */
export function restorableHash(event: HistoryEvent): string | undefined {
  // A deletion puts back the newest content it removed: an edit that only existed in one tool beats the older synced copy.
  if (event.kind === 'deleted') return event.losers.find(loser => loser.hash !== event.previous)?.hash ?? event.previous ?? event.winner?.hash;
  if (event.kind === 'edit' || event.kind === 'restored') return event.previous;
  if (event.kind === 'chosen') return event.losers[0]?.hash;
  if (event.kind === 'conflict') return event.losers.find(loser => loser.hash !== event.previous && loser.hash !== event.winner?.hash)?.hash ?? event.previous;
  // An edit kept over a deletion: what it overwrote (a competing edit) can be put back; the deletion itself is Delete everywhere.
  if (event.kind === 'kept-edit') return restorableChoices(event)[0]?.hash;
  return undefined;
}

/** Every overwritten edit an event can put back, one per content: each competing edit that lost, not the synced content before. */
export function restorableChoices(event: HistoryEvent): { tool: HarnessId; hash: string }[] {
  if (event.kind !== 'conflict' && event.kind !== 'kept-edit') return [];
  const seen = new Set<string>();
  return event.losers.filter(loser => loser.hash && loser.hash !== event.previous && loser.hash !== event.winner?.hash && !seen.has(loser.hash) && seen.add(loser.hash));
}

/** Restore or Undo from History: a new revision with the kept content, written to every tool the skill syncs to (DEL-03). */
export async function restoreFromHistory(context: ShareContext, eventId: string, resume = false, choice?: string): Promise<ApplyResult> {
  try {
    const start = await explicitStart(context, resume);
    if (start.stopped || !start.record) return { stopped: start.stopped, results: [], harnessWrites: 0 };
    const record = start.record;
    const history = await readHistory(context.home);
    const past = history.find(entry => entry.id === eventId);
    if (past?.kind === 'added') return await undoAdded(context, record, history, past);
    if (past?.kind === 'switched') return await undoSwitched(context, history, past);
    if (past?.kind === 'removed') return await restoreRemoved(context, record, history, past);
    if (past?.kind === 'chosen' && choice === 'narrow') return await undoChoice(context, record, history, past);
    // A chosen loser must be one this event can put back.
    const hash = past && (choice ? restorableChoices(past).find(entry => entry.hash === choice)?.hash : restorableHash(past));
    const item = past && record.items[past.key];
    if (!past || !hash || !item) return { stopped: 'That change can’t be restored.', results: [], harnessWrites: 0 };
    if (past.undoneBy) return { stopped: 'That change was already undone.', results: [], harnessWrites: 0 };
    if (past.kind !== 'deleted' && item.state !== 'shared') return { stopped: `${item.name} was deleted since. Restore the deletion from History instead.`, results: [], harnessWrites: 0 };
    const kept = storedRevision(context, past.key, hash);
    let tree;
    try { tree = await readTree(kept); } catch { return { stopped: 'The kept content is no longer in Central Knot’s store, so it can’t be restored.', results: [], harnessWrites: 0 }; }
    const snapshots = await context.read();
    const tools = presentTools(snapshots);
    const entry = (await gather(context, snapshots, record)).get(past.key);
    // A skill deleted earlier whose name is managed again with other content: restoring the old one would replace the new one.
    if (past.kind === 'deleted' && item.state === 'shared' && item.hash !== hash) return { stopped: `“${item.name}” is managed again with other content. Restoring the old one would replace it; delete or rename the new one first.`, results: [], harnessWrites: 0 };
    // A skill deleted earlier whose name is now taken by a different skill: never overwrite the new one.
    if (item.state !== 'shared') {
      const taken = Object.entries(entry?.facts.copies ?? {}).find(([, copy]) => copy && copy.hash !== tree.hash);
      if (taken) return { stopped: `A different “${item.name}” is in ${harnesses[taken[0] as HarnessId].name} now. Rename or remove it, then restore.`, results: [], harnessWrites: 0 };
    }
    const before = item.state === 'shared' ? item.hash : undefined;
    // The intent is on record first: a crash part-way leaves unfinished copies, never what reads as a deletion.
    for (const copy of item.copies) copy.status = 'pending';
    await saveRecord(context.home, record);
    const results: DestinationResult[] = [];
    const replaced: { tool: HarnessId; hash: string }[] = [];
    const copies: RecordItem['copies'] = [];
    let writes = 0;
    for (const tool of tools.filter(candidate => !item.off?.includes(candidate))) {
      if (entry?.facts.cannot[tool]) continue;
      const late = await rootProblem(context, tool);
      if (late) { results.push({ item: item.name, harness: tool, outcome: 'held', message: late }); continue; }
      const here = entry?.facts.copies[tool];
      if (here) {
        if (!here.writable) { results.push({ item: item.name, harness: tool, outcome: 'held', message: `${harnesses[tool].name} reads a copy at ${here.directory}, which Central Knot does not change.` }); continue; }
        if (here.hash !== tree.hash) {
          displace(item, tool, here.hash);
          await saveRecord(context.home, record);
          await replaceCopy(context, past.key, kept, here.directory, here.hash);
          writes++;
          replaced.push({ tool, hash: here.hash });
        }
        copies.push({ harness: tool, directory: here.directory, hash: tree.hash, created: false, status: 'written' });
      } else {
        const directory = ownCopyDir(context, tool, item.name);
        await placeStored(context, past.key, hash, tool, item.name);
        writes++;
        copies.push({ harness: tool, directory, hash: tree.hash, created: true, status: 'written' });
      }
      results.push({ item: item.name, harness: tool, outcome: 'written', message: `Restored. ${harnesses[tool].nextStep}` });
    }
    item.state = 'shared';
    item.hash = tree.hash;
    item.copies = copies;
    delete item.deleted;
    delete item.use;
    await saveRecord(context.home, record);
    const id = randomUUID();
    past.undoneBy = id;
    await saveHistory(context.home, [...history, { id, at: new Date(clock(context)).toISOString(), key: past.key, item: item.name, kind: 'restored', winner: { tool: replaced[0]?.tool ?? 'claude-cli', hash: tree.hash }, losers: replaced, orderProved: true, previous: before }], clock(context));
    if (item.displaced) { item.displaced = item.displaced.filter(entry => !replaced.some(gone => gone.hash === entry.hash)); if (!item.displaced.length) delete item.displaced; await saveRecord(context.home, record); }
    return { results, harnessWrites: writes };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('fault:')) throw error;
    return { stopped: `That could not finish. ${plainError(error)} Click Refresh to see where things stand.`, results: [], harnessWrites: 0 };
  }
}

/**
 * Undo of an Apply all that made new copies: each copy it added goes again, but only while it is exactly what was written (an
 * edit since keeps it), and its content stays in the store. The skill is then unmanaged as before; a tool whose copy had to stay
 * keeps syncing, so nothing is left half-managed.
 */
async function undoAdded(context: ShareContext, record: SyncRecord, history: HistoryEvent[], past: HistoryEvent): Promise<ApplyResult> {
  if (past.undoneBy) return { stopped: 'That change was already undone.', results: [], harnessWrites: 0 };
  const item = record.items[past.key];
  if (!item || item.state !== 'shared') return { stopped: `${past.item} is not managed any more, so there is nothing to undo here.`, results: [], harnessWrites: 0 };
  const entry = (await gather(context, await context.read(), record)).get(past.key);
  const results: DestinationResult[] = [];
  const kept: HarnessId[] = [];
  let writes = 0;
  for (const loser of past.losers) {
    const recorded = item.copies.find(copy => copy.harness === loser.tool && copy.created);
    const here = recorded && entry?.locations.find(location => location.tool === loser.tool && sameDir(location.copy.directory, recorded.directory));
    if (!recorded || !here) { results.push({ item: item.name, harness: loser.tool, outcome: 'stayed', message: `${harnesses[loser.tool].name}'s copy is already gone.` }); continue; }
    if (here.copy.hash !== loser.hash) { kept.push(loser.tool); results.push({ item: item.name, harness: loser.tool, outcome: 'held', message: `${harnesses[loser.tool].name}'s copy was edited since, so it stays.` }); continue; }
    if (!here.copy.writable) { kept.push(loser.tool); results.push({ item: item.name, harness: loser.tool, outcome: 'held', message: `${harnesses[loser.tool].name} reads it at ${here.copy.directory}, which Central Knot does not change.` }); continue; }
    const late = await rootProblem(context, loser.tool);
    if (late) { kept.push(loser.tool); results.push({ item: item.name, harness: loser.tool, outcome: 'held', message: late }); continue; }
    try {
      await importRevision(context, past.key, here.copy.directory, await readTree(here.copy.directory));
      await removeChecked(context, here.copy.directory, loser.hash);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('fault:')) throw error;
      kept.push(loser.tool);
      results.push({ item: item.name, harness: loser.tool, outcome: errorCode(error) === 'CK_CHANGED' ? 'held' : 'failed', message: errorCode(error) === 'CK_CHANGED' ? `${harnesses[loser.tool].name}'s copy changed just now, so it stays.` : `Could not remove ${harnesses[loser.tool].name}'s copy: ${plainError(error)}` });
      continue;
    }
    item.copies = item.copies.filter(copy => copy !== recorded);
    writes++;
    results.push({ item: item.name, harness: loser.tool, outcome: 'removed', message: 'Removed the copy Apply all added.' });
  }
  if (!kept.length) { item.state = 'dont-share'; delete item.use; item.copies = []; }
  else item.off = [...new Set([...(item.off ?? []), ...past.losers.map(loser => loser.tool).filter(tool => !kept.includes(tool))])];
  await saveRecord(context.home, record);
  past.undoneBy = randomUUID();
  await saveHistory(context.home, history, clock(context));
  return { results, harnessWrites: writes };
}

/**
 * Undo of Disable or Enable: each switch entry the event changed goes back (named as it was, so this works even if the copy is
 * gone), a Claude Code override to what it held before. A tool already back as it was needs nothing. On a build older than the
 * one verified, no new Disable is written: that tool stays as it is and the event stays undoable. A new 'switched' event records
 * what was flipped, and its own Undo flips it again.
 */
async function undoSwitched(context: ShareContext, history: HistoryEvent[], past: HistoryEvent): Promise<ApplyResult> {
  if (past.undoneBy) return { stopped: 'That change was already undone.', results: [], harnessWrites: 0 };
  const snapshots = await context.read();
  const results: DestinationResult[] = [];
  const back: SwitchRecord[] = [];
  let pending = false;
  for (const { tool, disabled, before, target } of past.switched ?? []) {
    const unverified = !disabled && unverifiedBuild(tool, snapshots.find(snapshot => snapshot.harness === tool)?.probe.version);
    if (unverified) { pending = true; results.push({ item: past.item, harness: tool, outcome: 'held', message: unverified }); continue; }
    let flipped: { changed: boolean; previous?: string };
    try { flipped = await setDisabled(context, tool, target, !disabled, before); }
    catch (error) { pending = true; results.push({ item: past.item, harness: tool, outcome: 'failed', message: `Could not change it in ${toolName(tool)}: ${switchFailure(error)}` }); continue; }
    if (!flipped.changed) { results.push({ item: past.item, harness: tool, outcome: 'stayed', message: `${toolName(tool)} has it ${disabled ? 'enabled' : 'disabled'} already.` }); continue; }
    back.push({ tool, disabled: !disabled, target, ...(flipped.previous ? { before: flipped.previous } : {}) });
    results.push({ item: past.item, harness: tool, outcome: 'switched', disabled: !disabled, message: `${disabled ? 'Enabled' : 'Disabled'} again in ${toolName(tool)}.` });
  }
  if (pending && !back.length) return { stopped: results.find(result => result.outcome === 'failed' || result.outcome === 'held')!.message, results, harnessWrites: 0 };
  // Done once nothing is left to retry. The new event exists only when something flipped, so "Undo again" always has one to use.
  const id = back.length ? randomUUID() : undefined;
  if (!pending) past.undoneBy = id ?? ALREADY_AS_IT_WAS;
  await saveHistory(context.home, [...history, ...(id ? [{ id, at: new Date(clock(context)).toISOString(), key: past.key, item: past.item, kind: 'switched' as const, switched: back, losers: [], orderProved: true }] : [])], clock(context));
  return { results, harnessWrites: 0 };
}

/**
 * Restore of a removal: each removed copy goes back in its own tool under its own folder name, from the store, unless that tool
 * has a different copy by now. A copy already back (put back by hand) counts as back. A managed skill syncs there again, and the
 * next pass catches the copy up if it is behind. Tools put back are remembered on the event, so a retry does only the rest; when
 * every one is back the removal is done, with one 'restored' event naming them all.
 */
async function restoreRemoved(context: ShareContext, record: SyncRecord, history: HistoryEvent[], past: HistoryEvent): Promise<ApplyResult> {
  if (past.undoneBy) return { stopped: 'That copy was already put back.', results: [], harnessWrites: 0 };
  const item = record.items[past.key];
  if (!item) return { stopped: 'That change can’t be restored.', results: [], harnessWrites: 0 };
  const entry = (await gather(context, await context.read(), record)).get(past.key);
  const results: DestinationResult[] = [];
  const back = new Set(past.restoredTools ?? []);
  let writes = 0;
  for (const loser of past.losers.filter(gone => !back.has(gone.tool))) {
    const here = entry?.facts.copies[loser.tool];
    if (here) {
      if (here.hash === loser.hash) { back.add(loser.tool); results.push({ item: item.name, harness: loser.tool, outcome: 'stayed', message: `${toolName(loser.tool)} has it back already.` }); }
      else results.push({ item: item.name, harness: loser.tool, outcome: 'held', message: `${toolName(loser.tool)} has a different “${item.name}” now. It stays.` });
      continue;
    }
    const late = await rootProblem(context, loser.tool);
    if (late) { results.push({ item: item.name, harness: loser.tool, outcome: 'held', message: late }); continue; }
    try { await placeStored(context, past.key, loser.hash, loser.tool, loser.folder ?? item.name); }
    catch (error) {
      if (error instanceof Error && error.message.startsWith('fault:')) throw error;
      results.push({ item: item.name, harness: loser.tool, outcome: 'failed', message: errorCode(error) === 'ENOENT' ? 'The kept copy is no longer in Central Knot’s store.' : `Could not put it back in ${toolName(loser.tool)}: ${plainError(error)}` });
      continue;
    }
    writes++;
    back.add(loser.tool);
    results.push({ item: item.name, harness: loser.tool, outcome: 'written', message: `Put back. ${harnesses[loser.tool].nextStep}` });
  }
  if (!results.some(result => result.outcome === 'written' || result.outcome === 'stayed')) return { stopped: results[0]?.message ?? 'Nothing could be put back.', results, harnessWrites: 0 };
  // A removal that unmanaged the skill (its last copies) manages it again; a managed one syncs to each tool put back, with the
  // copy's sync record back too, so an edit the copy held before its removal spreads as an edit instead of being caught up over.
  if (past.unmanaged && item.state !== 'shared') { item.state = 'shared'; item.copies = []; }
  if (item.state === 'shared' && past.stoppedSync?.length) {
    item.off = (item.off ?? []).filter(tool => !(past.stoppedSync!.includes(tool) && back.has(tool)));
    for (const loser of past.losers.filter(gone => back.has(gone.tool) && gone.synced && past.stoppedSync!.includes(gone.tool))) {
      const directory = ownCopyDir(context, loser.tool, loser.folder ?? item.name);
      if (!item.copies.some(copy => sameDir(copy.directory, directory))) item.copies.push({ harness: loser.tool, directory, hash: loser.synced!, created: false, status: 'written' });
    }
  }
  await saveRecord(context.home, record);
  const done = past.losers.every(loser => back.has(loser.tool));
  if (done) {
    const id = randomUUID();
    past.undoneBy = id;
    delete past.restoredTools;
    // Every tool put back is a loser of the restore, so its History row names them all.
    const losers = past.losers.map(({ tool, hash }) => ({ tool, hash }));
    await saveHistory(context.home, [...history, { id, at: new Date(clock(context)).toISOString(), key: past.key, item: item.name, kind: 'restored', losers, orderProved: true }], clock(context));
  } else {
    past.restoredTools = [...back];
    await saveHistory(context.home, history, clock(context));
  }
  return { results, harnessWrites: writes };
}

/** Puts a stored revision of a skill into a tool's own skills folder under `folder`; nothing may be there yet. */
async function placeStored(context: ShareContext, key: string, hash: string, tool: HarnessId, folder: string) {
  const kept = storedRevision(context, key, hash);
  const tree = await readTree(kept);
  const directory = ownCopyDir(context, tool, folder);
  await mkdir(dirname(directory), { recursive: true });
  await placeCopy(context, kept, { harness: tool, directory, limits: [] }, tree);
}

/**
 * Undo of a copy choice, right after Apply all: each replaced copy goes back in its own tool only, the copies the choice added are
 * removed, and the skill is unmanaged again, so it shows Copies differ as before. All or nothing: if any of those copies changed
 * since, nothing is written and History's wider Undo stays available.
 */
async function undoChoice(context: ShareContext, record: SyncRecord, history: HistoryEvent[], chosen: HistoryEvent): Promise<ApplyResult> {
  const stop = (stopped: string): ApplyResult => ({ stopped, results: [], harnessWrites: 0 });
  if (chosen.undoneBy) return stop('That choice was already undone.');
  const item = record.items[chosen.key];
  if (!item || item.state !== 'shared' || !chosen.winner) return stop(`${chosen.item} is not managed any more, so there is nothing to undo here.`);
  const added = history.find(entry => entry.kind === 'added' && entry.key === chosen.key && !entry.undoneBy && Math.abs(Date.parse(entry.at) - Date.parse(chosen.at)) < 60_000);
  const entry = (await gather(context, await context.read(), record)).get(chosen.key);
  // Check everything first: every replaced tool still holds the chosen copy, its old copy is in the store, and added copies are unchanged.
  for (const loser of chosen.losers) {
    const here = entry?.facts.copies[loser.tool];
    if (!here || here.hash !== chosen.winner.hash) return stop(`${harnesses[loser.tool].name}’s copy of ${item.name} changed since, so nothing was undone here. History can still put an earlier version back.`);
    if (!here.writable) return stop(`${harnesses[loser.tool].name} reads ${item.name} at ${here.directory}, which Central Knot does not change.`);
    try { await readTree(storedRevision(context, chosen.key, loser.hash)); } catch { return stop('The replaced copy is no longer in Central Knot’s store, so it can’t be put back.'); }
    const late = await rootProblem(context, loser.tool);
    if (late) return stop(late);
  }
  for (const loser of added?.losers ?? []) {
    const here = entry?.facts.copies[loser.tool];
    if (here && here.hash !== loser.hash) return stop(`${harnesses[loser.tool].name}’s new copy of ${item.name} was edited since, so nothing was undone here.`);
  }
  const results: DestinationResult[] = [];
  let writes = 0;
  if (added) {
    const removed = await undoAdded(context, record, history, added);
    if (removed.stopped) return removed;
    results.push(...removed.results);
    writes += removed.harnessWrites;
  }
  for (const loser of chosen.losers) {
    const here = entry!.facts.copies[loser.tool]!;
    try { await replaceCopy(context, chosen.key, storedRevision(context, chosen.key, loser.hash), here.directory, chosen.winner.hash); }
    catch (error) {
      if (error instanceof Error && error.message.startsWith('fault:')) throw error;
      results.push({ item: item.name, harness: loser.tool, outcome: 'failed', message: `Could not put ${harnesses[loser.tool].name}’s copy back: ${plainError(error)}` });
      continue;
    }
    writes++;
    results.push({ item: item.name, harness: loser.tool, outcome: 'written', message: `Its own copy is back. ${harnesses[loser.tool].nextStep}` });
  }
  // Unmanaged again: every tool keeps the copy it now has, and the row shows Copies differ.
  item.state = 'dont-share';
  delete item.use;
  item.copies = [];
  await saveRecord(context.home, record);
  chosen.undoneBy = randomUUID();
  await saveHistory(context.home, history, clock(context));
  return { results, harnessWrites: writes };
}

/** What an edit changed, for "See change": the skill's SKILL.md before and after, from Central Knot's store. */
export async function eventChange(context: ShareContext, eventId: string): Promise<{ before: string; after: string } | undefined> {
  const past = (await readHistory(context.home)).find(entry => entry.id === eventId);
  if (!past || !past.previous || !past.winner?.hash || past.key.includes(':')) return undefined;
  try {
    const [before, after] = await Promise.all([past.previous, past.winner.hash].map(hash => readFile(join(storedRevision(context, past.key, hash), 'SKILL.md'), 'utf8')));
    return { before, after };
  } catch { return undefined; }
}

/** Delete everywhere: removes a managed skill from every tool it syncs to, keeping its content for Restore (D-04's offer, DEL-02). */
export async function deleteEverywhere(context: ShareContext, key: string, resume = false): Promise<ApplyResult> {
  try {
    const start = await explicitStart(context, resume);
    if (start.stopped || !start.record) return { stopped: start.stopped, results: [], harnessWrites: 0 };
    const record = start.record;
    const item = record.items[key];
    const snapshots = await context.read();
    const entry = (await gather(context, snapshots, record)).get(key);
    if (!item || !entry) return { stopped: 'That skill is not there any more.', results: [], harnessWrites: 0 };
    const results: DestinationResult[] = [];
    const lost: { tool: HarnessId; hash: string }[] = [];
    const leftover: RecordItem['copies'] = [];
    let writes = 0;
    const own = new Map(item.copies.map(copy => [copy.directory, copy.hash]));
    for (const location of entry.locations.filter(candidate => !item.off?.includes(candidate.tool))) {
      // Only the skill's own copies: recorded ones, or one identical to its synced content. A different copy that was never synced stays.
      if (!own.has(location.copy.directory) && location.copy.hash !== item.hash) { results.push({ item: item.name, harness: location.tool, outcome: 'held', message: `${harnesses[location.tool].name} has a different “${item.name}” that was never synced. It stays.` }); continue; }
      if (!location.copy.writable) { results.push({ item: item.name, harness: location.tool, outcome: 'held', message: `${harnesses[location.tool].name} reads a copy at ${location.copy.directory}, which Central Knot does not change. Remove it yourself.` }); continue; }
      const late = await rootProblem(context, location.tool);
      if (late) { results.push({ item: item.name, harness: location.tool, outcome: 'held', message: late }); continue; }
      // An edit not yet spread is the newest content: Restore prefers it. A copy only behind is an older revision, already kept.
      const newest = location.copy.hash === item.hash || location.copy.hash !== own.get(location.copy.directory);
      try {
        await importRevision(context, key, location.copy.directory, await readTree(location.copy.directory));
        // On record before it goes, so a crash or a failure later in this action never lets it be pruned.
        if (newest) { displace(item, location.tool, location.copy.hash); await saveRecord(context.home, record); }
        await removeChecked(context, location.copy.directory, location.copy.hash);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('fault:')) throw error;
        if (errorCode(error) === 'CK_CHANGED') { results.push({ item: item.name, harness: location.tool, outcome: 'held', message: `${harnesses[location.tool].name}'s copy changed just now, so it was kept. Delete it there yourself, or use Delete everywhere again.` }); continue; }
        // One copy that can't go never stops the rest: it is retried by later passes while it is unchanged.
        leftover.push({ harness: location.tool, directory: location.copy.directory, hash: location.copy.hash, created: false, status: 'removing' });
        results.push({ item: item.name, harness: location.tool, outcome: 'failed', message: `Could not remove ${harnesses[location.tool].name}'s copy yet: ${plainError(error)} Central Knot will try again.` });
        continue;
      }
      writes++;
      if (newest) lost.push({ tool: location.tool, hash: location.copy.hash });
      results.push({ item: item.name, harness: location.tool, outcome: 'removed', message: 'Deleted. Restore it from History.' });
    }
    const hash = item.hash || lost[0]?.hash || '';
    item.copies = leftover;
    item.state = 'dont-share';
    item.deleted = { at: new Date(clock(context)).toISOString(), tool: lost[0]?.tool ?? 'claude-cli', hash };
    await saveRecord(context.home, record);
    // History first, then the hold is dropped: a crash between leaves the hold, never content no one can restore.
    await saveHistory(context.home, [...await readHistory(context.home), { id: randomUUID(), at: new Date(clock(context)).toISOString(), key, item: item.name, kind: 'deleted', losers: lost, orderProved: true, previous: hash }], clock(context));
    if (item.displaced) { item.displaced = item.displaced.filter(entry => !lost.some(gone => gone.hash === entry.hash) && entry.hash !== hash); if (!item.displaced.length) delete item.displaced; await saveRecord(context.home, record); }
    return { results, harnessWrites: writes };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('fault:')) throw error;
    return { stopped: `That could not finish. ${plainError(error)} Click Refresh to see where things stand.`, results: [], harnessWrites: 0 };
  }
}
