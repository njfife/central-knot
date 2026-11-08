// Managing skills across tools: what each tool has, and applying the person's choices.
// A managed skill keeps one copy in every tool it syncs to. An unmanaged skill is left alone.
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { harnesses, writeRoot } from './harnesses.ts';
import {
  FORMAT_VERSION, clearStaleStages, landingOf, copyTree, errorCode, exists, finishCopy, importRevision, itemKey, placeCopy, plainError, readRecord, readTree,
  remember, removeTree, saveRecord, stagingFolder, storeDirectory, storeFolder, syncGate, targetFor, writeAccess, writeDurably, type RecordItem, type ShareContext, type SyncRecord,
} from './share.ts';
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
      const directory = join(writeRoot(definition, context.home, context.overrides?.[tool]), source.folder);
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
  return map;
}

/** The skill as found at a tool's main copy. */
const skillAt = (entry: Gathered, tool: HarnessId) => entry.skills[tool]?.find(skill => skill.directory === entry.facts.copies[tool]?.directory);

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
const surfaceRank: Record<HarnessId, number> = { 'copilot-cli': 0, 'claude-cli': 1, 'codex-cli': 2 };
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

/** A deletion is inferred only from a reachable root (DEL-01): the tool's skills folder exists and can be listed. */
async function reachable(context: ShareContext, tool: HarnessId): Promise<boolean> {
  try { return (await stat(rootOf(context, tool))).isDirectory(); } catch { return false; }
}

const historyPath = (home: string) => join(storeDirectory(home), 'history.json');

/** History, newest last. Unreadable history reads as empty; sync never depends on it. */
export async function readHistory(home: string): Promise<HistoryEvent[]> {
  try { const parsed = JSON.parse(await readFile(historyPath(home), 'utf8')); return Array.isArray(parsed?.events) ? parsed.events : []; } catch { return []; }
}

async function saveHistory(home: string, events: HistoryEvent[]) {
  // History that cannot be read is moved aside, never overwritten: it may be recoverable by hand.
  try { JSON.parse(await readFile(historyPath(home), 'utf8')); }
  catch (error) { if (errorCode(error) !== 'ENOENT') await rename(historyPath(home), join(storeDirectory(home), `history.unreadable-${Date.now()}.json`)).catch(() => undefined); }
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

/** Moves a different copy aside and puts the chosen one in its place. The replaced bytes are kept in the store first. */
async function replaceCopy(context: ShareContext, key: string, source: string, target: string) {
  if ((await lstat(target)).isSymbolicLink()) throw Object.assign(new Error('That copy is a link.'), { code: 'CK_LINK' });
  const old = await readTree(target);
  await importRevision(context, key, target, old);
  const tree = await readTree(source);
  const folder = await stagingFolder(context, dirname(target));
  const stage = join(folder, `.ck-stage-${randomUUID()}`);
  const parked = join(folder, `.ck-stage-${randomUUID()}`);
  await copyTree(source, stage, tree);
  if ((await readTree(stage)).hash !== tree.hash) { await removeTree(stage); throw new Error('The staged copy did not match its source.'); }
  context.fault?.('before-replace');
  await rename(target, parked);
  context.fault?.('mid-replace');
  try { await rename(stage, target); }
  catch (error) { await rename(parked, target).catch(() => undefined); await removeTree(stage).catch(() => undefined); throw error; }
  await finishCopy(source, target);
  await removeTree(parked).catch(() => undefined);
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
    return { stopped: `That could not finish. ${plainError(error)} Read again to see where things stand.`, results: [], harnessWrites: 0 }; }
}

async function runApply(context: ShareContext, changes: Change[], resume: boolean, options: PassOptions): Promise<ApplyResult> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason, results: [], harnessWrites: 0 };
  const gate = await syncGate(context);
  if (gate.state === 'stopped') return { stopped: gate.reason, results: [], harnessWrites: 0 };
  if (gate.state === 'needs-resume' && !resume) return { stopped: gate.reason, results: [], harnessWrites: 0 };
  let record = (await readRecord(context.home)).record;
  if (!record && !changes.length) return { results: [], harnessWrites: 0 };
  if (options.observeOnly && !record) return { results: [], harnessWrites: 0 };

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
    const item: RecordItem = record.items[change.key] ?? { name: entry.facts.name, hash: '', state: 'dont-share', startId: '', observedAt: new Date().toISOString(), copies: [] };
    item.state = change.managed && change.use !== 'separate' ? 'shared' : 'dont-share';
    item.off = change.off.filter(tool => harnesses[tool]);
    // A copy is tracked only while the skill syncs to its tool: one removed while off, or while unmanaged, is no deletion later.
    item.copies = item.state === 'shared' ? item.copies.filter(copy => !item.off!.includes(copy.harness)) : [];
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
  // A tool whose skills folder lost every managed skill at once (two or more) was reset or reinstalled: put them back, never delete them everywhere.
  const wiped = new Set<HarnessId>();
  if (!options.observeOnly) for (const tool of tools) {
    const mine = [...gathered].flatMap(([key2, entry2]) => {
      const item2 = record!.items[key2];
      if (item2?.state !== 'shared' || item2.off?.includes(tool)) return [];
      return item2.copies.filter(copy => copy.harness === tool && copy.status === 'written').map(copy => entry2.locations.some(location => sameDir(location.copy.directory, copy.directory)));
    });
    if (mine.length >= 2 && mine.every(present => !present) && await reachable(context, tool)) wiped.add(tool);
  }
  const notices: SyncNotice[] = [];
  const events: HistoryEvent[] = [];
  const event = (fields: Omit<HistoryEvent, 'id' | 'at'>) => { const made = { id: randomUUID(), at: new Date(clock(context)).toISOString(), ...fields }; events.push(made); return made.id; };
  for (const [key, entry] of gathered) {
    const item = record.items[key];
    if (item?.state !== 'shared') continue;
    if (options.only && !options.only.has(key)) continue;
    const name = entry.facts.name;
    if (entry.facts.held) { results.push({ item: name, outcome: 'held', message: entry.facts.held }); continue; }
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
        ?? entry.locations.find(location => location.tool === copy.harness && sameDir(dirname(location.copy.directory), dirname(copy.directory)) && !item.copies.some(other => sameDir(other.directory, location.copy.directory)));
      if (found) copy.directory = found.copy.directory;
    }
    const recorded = new Set(item.copies.filter(copy => copy.status === 'written').map(copy => copy.directory));
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
        if (location.copy.hash === baseline) { seen.verifiedAt = now; delete seen.changed; delete seen.firstSeen; }
        else if (seen.changed !== location.copy.hash) { seen.changed = location.copy.hash; seen.firstSeen = now; }
      }
      // A recorded copy missing from a reachable folder is a deletion once it stays missing past the settle window (DEL-01).
      // A tool that lost every managed skill at once was reset, not edited: its copies are put back instead (see `wiped`).
      const deletions: { tool: HarnessId; directory: string }[] = [];
      let waiting = false;
      for (const copy of item.copies) {
        if (copy.status !== 'written' || !syncing.includes(copy.harness) || entry.locations.some(location => location.copy.directory === copy.directory)) continue;
        if (wiped.has(copy.harness) || !(await reachable(context, copy.harness))) continue;
        const seen = mark(copy.directory);
        seen.missingSince ??= now;
        if (now - seen.missingSince >= (context.settleMs ?? 2000)) deletions.push({ tool: copy.harness, directory: copy.directory }); else waiting = true;
      }
      if (wiped.size) item.copies = item.copies.filter(copy => !wiped.has(copy.harness) || entry.locations.some(location => location.copy.directory === copy.directory));
      // Never act on a copy that may have just gone: wait until every missing copy has settled, then decide once.
      if (waiting) { settling = true; continue; }
      // Sync off: the evidence above is kept, so order can be proved later; nothing is written now.
      if (options.observeOnly) continue;
      const changed = active.filter(location => recorded.has(location.copy.directory) && location.copy.hash !== baseline);
      if (deletions.length) {
        const deletedSeen = Math.min(...deletions.map(gone => evidence.get(gone.directory)!.missingSince!));
        const deletedVerified = Math.max(...deletions.map(gone => evidence.get(gone.directory)?.verifiedAt ?? -Infinity));
        // An edit is proved older than the deletion when the deleted copy was still at the baseline after the edit was seen.
        const live = changed.filter(location => !(deletedVerified >= (evidence.get(location.copy.directory)?.firstSeen ?? Infinity)));
        if (!live.length) {
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
            // Content that only existed here goes to the store first, so the deletion can be undone (CON-02).
            if (location.copy.hash !== baseline) { await importRevision(context, key, location.copy.directory, await readTree(location.copy.directory)); lost.push({ tool: location.tool, hash: location.copy.hash }); }
            await removeTree(location.copy.directory);
            writes++;
            removed.push(location.tool);
            results.push({ item: name, harness: location.tool, outcome: 'removed', message: `Deleted in ${harnesses[deletions[0].tool].name}, so removed here too. Restore it from History.` });
          }
          const id = event({ key, item: name, kind: 'deleted', winner: { tool: deletions[0].tool, hash: baseline }, losers: lost, orderProved: true, previous: baseline });
          notices.push({ key, item: name, kind: 'deleted', winner: deletions[0].tool, losers: removed, orderProved: true, history: id });
          item.copies = [];
          item.state = 'dont-share';
          item.deleted = { at: new Date(now).toISOString(), tool: deletions[0].tool, hash: baseline };
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
          if (known) { known.status = 'pending'; await save(); }
          try { await replaceCopy(context, key, source.directory, location.copy.directory); }
          catch (error) {
            if (error instanceof Error && error.message.startsWith('fault:')) throw error;
            results.push({ item: name, harness: location.tool, outcome: 'failed', message: `Could not update ${harnesses[location.tool].name}'s copy. ${plainError(error)}` });
            continue;
          }
          writes++;
          inSync.add(location.copy.directory);
          replaced.push(location.tool);
          losers.push({ tool: location.tool, hash: location.copy.hash });
          results.push({ item: name, harness: location.tool, outcome: 'written', message: `Now has ${harnesses[sourceTool].name}'s edit. The replaced copy is kept in History. ${harnesses[location.tool].nextStep}` });
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
          await replaceCopy(context, key, source.directory, location.copy.directory);
          writes++;
          inSync.add(location.copy.directory);
          results.push({ item: name, harness: location.tool, outcome: 'written', message: `Now uses ${harnesses[chosen].name}'s copy. The replaced copy is kept in Central Knot's store. ${harnesses[location.tool].nextStep}` });
        }
      } else for (const location of active) inSync.add(location.copy.directory);
      delete item.use;
      const tree = await readTree(source.directory);
      await importRevision(context, key, source.directory, tree);
      item.hash = tree.hash;
      // Only copies holding the new content stay on record. One that could not be updated is let go, so it can never win back as an "edit".
      item.copies = item.copies.filter(copy => !active.some(location => location.copy.directory === copy.directory) || inSync.has(copy.directory));
      for (const copy of item.copies) if (inSync.has(copy.directory)) { copy.status = 'written'; copy.hash = tree.hash; }
      for (const location of active) {
        if (inSync.has(location.copy.directory) && !item.copies.some(known => known.directory === location.copy.directory)) item.copies.push({ harness: location.tool, directory: location.copy.directory, hash: tree.hash, created: false, status: 'written' });
      }
      // What sync did on its own goes to History once, after it happened (CON-02).
      if (story && (replaced.length || story.deleted.length)) {
        const id = event({ key, item: name, kind: story.kind, winner: { tool: sourceTool, hash: tree.hash }, losers: story.kind === 'kept-edit' ? story.deleted.map(tool => ({ tool, hash: baselineBefore })) : losers, orderProved: story.orderProved, previous: baselineBefore });
        notices.push({ key, item: name, kind: story.kind, winner: sourceTool, losers: story.kind === 'conflict' ? story.competitors : story.kind === 'kept-edit' ? story.deleted : replaced, orderProved: story.orderProved, history: id });
      }
      const sourceSkill = entry.skills[sourceTool]?.find(skill => skill.directory === source.directory);
      for (const tool of syncing.filter(entryTool => !entry.locations.some(location => location.tool === entryTool))) {
        if (entry.facts.cannot[tool]) continue;
        const directory = join(writeRoot(harnesses[tool], context.home, context.overrides?.[tool]), entry.facts.name);
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
        writes++;
        results.push({ item: name, harness: tool, outcome: 'written', message: harnesses[tool].nextStep });
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('fault:')) throw error;
      results.push({ item: name, outcome: 'failed', message: plainError(error) });
    }
  }
  // A pending copy from a crash that is not on disk was never made.
  for (const item of Object.values(record.items)) for (const copy of [...item.copies]) {
    if (copy.status !== 'pending') continue;
    if (await exists(copy.directory)) copy.status = 'written'; else item.copies = item.copies.filter(other => other !== copy);
  }
  for (const tool of wiped) notices.push({ key: '', item: '', kind: 'reset', winner: tool, losers: [], orderProved: true, history: '' });
  await save();
  if (events.length) await saveHistory(context.home, [...await readHistory(context.home), ...events]);
  return { results, harnessWrites: writes, notices, settling };
}

void readFile;

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
  if (event.kind === 'conflict') return event.losers.find(loser => loser.hash !== event.previous && loser.hash !== event.winner?.hash)?.hash ?? event.previous;
  return undefined;
}

/** Restore or Undo from History: a new revision with the kept content, written to every tool the skill syncs to (DEL-03). */
export async function restoreFromHistory(context: ShareContext, eventId: string, resume = false): Promise<ApplyResult> {
  try {
    const start = await explicitStart(context, resume);
    if (start.stopped || !start.record) return { stopped: start.stopped, results: [], harnessWrites: 0 };
    const record = start.record;
    const history = await readHistory(context.home);
    const past = history.find(entry => entry.id === eventId);
    const hash = past && restorableHash(past);
    const item = past && record.items[past.key];
    if (!past || !hash || !item) return { stopped: 'That change can’t be restored.', results: [], harnessWrites: 0 };
    if (past.undoneBy) return { stopped: 'That change was already undone.', results: [], harnessWrites: 0 };
    const kept = storedRevision(context, past.key, hash);
    let tree;
    try { tree = await readTree(kept); } catch { return { stopped: 'The kept content is no longer in Central Knot’s store, so it can’t be restored.', results: [], harnessWrites: 0 }; }
    const snapshots = await context.read();
    const tools = presentTools(snapshots);
    const entry = (await gather(context, snapshots, record)).get(past.key);
    // A skill deleted earlier whose name is now taken by a different skill: never overwrite the new one.
    if (item.state !== 'shared') {
      const taken = Object.entries(entry?.facts.copies ?? {}).find(([, copy]) => copy && copy.hash !== tree.hash);
      if (taken) return { stopped: `A different “${item.name}” is in ${harnesses[taken[0] as HarnessId].name} now. Rename or remove it, then restore.`, results: [], harnessWrites: 0 };
    }
    const before = item.state === 'shared' ? item.hash : undefined;
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
        if (here.hash !== tree.hash) { await replaceCopy(context, past.key, kept, here.directory); writes++; replaced.push({ tool, hash: here.hash }); }
        copies.push({ harness: tool, directory: here.directory, hash: tree.hash, created: false, status: 'written' });
      } else {
        const directory = join(rootOf(context, tool), item.name);
        await mkdir(dirname(directory), { recursive: true });
        await placeCopy(context, kept, { harness: tool, directory, limits: [] }, tree);
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
    await saveHistory(context.home, [...history, { id, at: new Date(clock(context)).toISOString(), key: past.key, item: item.name, kind: 'restored', winner: { tool: replaced[0]?.tool ?? 'claude-cli', hash: tree.hash }, losers: replaced, orderProved: true, previous: before }]);
    return { results, harnessWrites: writes };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('fault:')) throw error;
    return { stopped: `That could not finish. ${plainError(error)} Read again to see where things stand.`, results: [], harnessWrites: 0 };
  }
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
    let writes = 0;
    for (const location of entry.locations.filter(candidate => !item.off?.includes(candidate.tool))) {
      if (!location.copy.writable) { results.push({ item: item.name, harness: location.tool, outcome: 'held', message: `${harnesses[location.tool].name} reads a copy at ${location.copy.directory}, which Central Knot does not change. Remove it yourself.` }); continue; }
      const late = await rootProblem(context, location.tool);
      if (late) { results.push({ item: item.name, harness: location.tool, outcome: 'held', message: late }); continue; }
      await importRevision(context, key, location.copy.directory, await readTree(location.copy.directory));
      await removeTree(location.copy.directory);
      writes++;
      lost.push({ tool: location.tool, hash: location.copy.hash });
      results.push({ item: item.name, harness: location.tool, outcome: 'removed', message: 'Deleted. Restore it from History.' });
    }
    const hash = item.hash || lost[0]?.hash || '';
    item.copies = [];
    item.state = 'dont-share';
    item.deleted = { at: new Date(clock(context)).toISOString(), tool: lost[0]?.tool ?? 'claude-cli', hash };
    await saveRecord(context.home, record);
    await saveHistory(context.home, [...await readHistory(context.home), { id: randomUUID(), at: new Date(clock(context)).toISOString(), key, item: item.name, kind: 'deleted', losers: lost, orderProved: true, previous: hash }]);
    return { results, harnessWrites: writes };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('fault:')) throw error;
    return { stopped: `That could not finish. ${plainError(error)} Read again to see where things stand.`, results: [], harnessWrites: 0 };
  }
}
