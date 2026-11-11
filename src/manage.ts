// Managing skills across tools: what each tool has, and applying the person's choices.
// A managed skill keeps one copy in every tool it syncs to. An unmanaged skill is left alone.
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, readlink, realpath, rename, stat, symlink, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DAY_MS, defaultHistoryDays } from './model.ts';
import { deletedSince, keptOff, offTools } from './historyrules.ts';
import { configRoot, harnessIds, harnesses, writeRoot } from './harnesses.ts';
import { managedTools, presentTools } from './presence.ts';
import {
  FORMAT_VERSION, changedWhileSyncing, clearStaleStages, storedRevision, landingOf, copyTree, errorCode, exists, finishCopy, giveFileTime, importRevision, itemKey, newRecord, placeCopy, plainError, readRecord, readTree, stillOwned,
  remember, removeTree, saveRecord, stagingFolder, storeDirectory, storeFolder, syncGate, syncsHere, targetFor, writeAccess, writeDurably, type RecordItem, type ShareContext, type SyncRecord,
} from './share.ts';
import { parseSkill } from './discovery.ts';
import { isDisabled, readKeptOverrides, readSwitchFile, setDisabled, switchFailure, unverifiedBuild, type SwitchTarget } from './skillswitch.ts';
import { REPLACE_ACTION, andList, problemText, throughPlugin, toolName } from './words.ts';
import { notPutBack } from './outsidewords.ts';
import { throughPlugins } from './plugins.ts';
import { comparableText } from './pluginstatus.ts';
import { ALREADY_AS_IT_WAS, type SwitchRecord } from './types.ts';
import type { ApplyResult, Change, DestinationResult, HarnessId, HistoryEvent, HistoryPrune, ManageView, Outside, RestoreHow, Skill, SkillFacts, Snapshot, SyncNotice, ToolCopy, TookOver } from './types.ts';
import { byKey } from './roworder.ts';
import { undoChoice as undoChoiceWith } from './choiceundo.ts';


const bodyLine = (content: string) => content.replace(/^﻿?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '').split(/\r?\n/).map(line => line.trim()).find(line => line && !line.startsWith('#')) ?? '';

interface Location { tool: HarnessId; copy: ToolCopy }
type Loser = HistoryEvent['losers'][number];
interface Gathered { facts: SkillFacts; skills: Partial<Record<HarnessId, Skill[]>>; locations: Location[]; /** Tools that read this skill in another present tool's own folder, and whose folder: so with or without a copy of their own. */ reads: Partial<Record<HarnessId, HarnessId>> }

/** Reads every skill in every managed tool once. A copy that cannot be read makes the skill held, never the whole page. */
async function gather(context: ShareContext, snapshots: Snapshot[], record?: SyncRecord): Promise<Map<string, Gathered>> {
  const tools = managedTools(snapshots, record?.tools);
  const problems = new Map(await Promise.all(tools.map(async tool => [tool, await rootProblem(context, tool)] as const)));
  const map = new Map<string, Gathered>();
  // Each present tool's own skills folder, managed or not. A skill another tool reads there (OpenCode reads Claude Code's folder)
  // is the owner's copy: shown for the reader, but never a location of its own, so it blocks no choice and is never called older.
  const owners = new Map(presentTools(snapshots).map(tool => [rootOf(context, tool), tool] as const));
  const pinned = await pinnedShared(context, tools, problems);
  for (const snapshot of snapshots) {
    if (!tools.includes(snapshot.harness)) continue;
    for (const skill of snapshot.skills) {
      const key = itemKey(skill.folder);
      let entry = map.get(key);
      if (!entry) {
        const recorded = record?.items[key];
        entry = { facts: { key, name: skill.folder, description: skill.description, copies: {}, extra: [], managed: recorded?.state === 'shared', off: recorded?.off ?? [], cannot: {}, separate: recorded?.separate === true, choiceBlocks: {} }, skills: {}, locations: [], reads: {} };
        map.set(key, entry);
      }
      entry.facts.description ||= skill.description;
      (entry.skills[snapshot.harness] ??= []).push(skill);
      try {
        const tree = await readTree(skill.directory);
        if (tree.held) entry.facts.held ??= tree.held;
        const info = await stat(join(skill.directory, 'SKILL.md'));
        const owner = owners.get(dirname(skill.directory));
        const readsFrom = owner && owner !== snapshot.harness ? owner : undefined;
        const copy: ToolCopy = {
          hash: tree.hash, directory: skill.directory, rootLabel: skill.rootLabel, lines: skill.content.split(/\r?\n/).length, modified: info.mtime.toISOString(),
          summary: bodyLine(skill.content).slice(0, 140), folder: skill.folder, name: skill.name, writable: !readsFrom && await writable(context, snapshot.harness, skill.directory, problems),
          ...(readsFrom ? { readsFrom } : {}),
        };
        if (!copy.writable && !readsFrom) { const outside = await outsideOf(context, snapshot.harness, skill.directory, problems, pinned); if (outside) copy.outside = outside; }
        if (readsFrom) entry.reads[snapshot.harness] = readsFrom; else entry.locations.push({ tool: snapshot.harness, copy });
        if (!entry.facts.copies[snapshot.harness]) entry.facts.copies[snapshot.harness] = copy;
        else if (!readsFrom) entry.facts.extra.push({ ...copy, tool: snapshot.harness });
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
      try {
        await lstat(directory);
        // A link that leads nowhere is no skill and holds nothing: a copy written there replaces it, and the page says so.
        const broken = await brokenLink(directory);
        if (broken !== undefined) (entry.facts.brokenLink ??= {})[tool] = broken;
        else entry.facts.cannot[tool] = `${definition.name} already has something at ${directory} that is not a readable skill.`;
      } catch (error) { if (errorCode(error) !== 'ENOENT') entry.facts.cannot[tool] = `${directory} could not be checked.`; }
    }
    for (const tool of Object.keys(entry.facts.copies) as HarnessId[]) entry.facts.choiceBlocks[tool] = blocksFor(entry, tool);
  }
  // A tool that has the skill through one of its plugins needs no copy of its own, and gets none: the row says where it
  // comes from instead. The plugin's skill of that name (the skill's folder, or the name its SKILL.md gives) is this skill
  // when Central Knot installed it elsewhere as that plugin's part, or when its SKILL.md is the same; another skill that
  // only shares the name stays an ordinary skill.
  for (const [tool, given] of await throughPlugins(context, tools, 'skill', itemKey)) {
    for (const entry of map.values()) {
      if (entry.facts.copies[tool]) continue;
      const copies = Object.values(entry.skills).flat();
      const same = (text?: string) => text !== undefined && copies.some(skill => comparableText(skill.content) === comparableText(text));
      const found = [entry.facts.key, ...copies.map(skill => itemKey(skill.name))].map(name => given.get(name)).find(plugin => plugin && (plugin.asParts || same(plugin.text)));
      if (!found) continue;
      const { asParts: _asParts, text: _text, ...plugin } = found;
      (entry.facts.plugin ??= {})[tool] = plugin;
      entry.facts.cannot[tool] = throughPlugin(tool, plugin);
    }
  }
  // Each tool's own switch (Disable): read and parsed once, then asked about every copy there. Why a tool can't take a new
  // Disable (its settings file) applies to a copy it is about to get, too; so does the note on an unverified build.
  const switches = new Map(await Promise.all(tools.map(async tool => [tool, await readSwitchFile(context, tool)] as const)));
  // With no CLI, the version is the one of the tool its desktop app carries.
  const versionOf = (tool: HarnessId) => { const snapshot = snapshots.find(found => found.harness === tool); return snapshot?.probe.version ?? snapshot?.app?.carriedVersion; };
  const unverified = new Map(tools.map(tool => [tool, unverifiedBuild(tool, versionOf(tool))] as const));
  for (const entry of map.values()) {
    for (const tool of tools) {
      if (entry.facts.cannot[tool]) continue;
      const problem = switches.get(tool)!.problem;
      if (problem) (entry.facts.switchProblem ??= {})[tool] = problem;
      if (unverified.get(tool)) (entry.facts.disableNote ??= {})[tool] = unverified.get(tool)!;
      // A tool without a copy is asked too, about the copy it would get: a switch left from an earlier removal still holds there.
      const target = switchTarget(entry, tool) ?? { folder: entry.facts.name, name: Object.values(entry.skills).flat()[0]?.name ?? entry.facts.name, skillFile: join(ownCopyDir(context, tool, entry.facts.name), 'SKILL.md') };
      if (isDisabled(context, switches.get(tool)!, target)) (entry.facts.disabled ??= []).push(tool);
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

/** A tool's own copy: not one it only reads in another tool's folder. */
const ownCopy = (entry: Gathered | undefined, tool: HarnessId) => (entry?.facts.copies[tool]?.readsFrom ? undefined : entry?.facts.copies[tool]);

/** The tool among `tools` whose own skills folder this tool reads too (OpenCode reads Claude Code's), if there is one. */
function readsFolderOf(context: ShareContext, tool: HarnessId, tools: HarnessId[]): HarnessId | undefined {
  const read = harnesses[tool].skillRoots(configRoot(harnesses[tool], context.home, context.overrides?.[tool]), context.home).slice(1).map(root => root.path);
  return tools.find(other => other !== tool && read.includes(rootOf(context, other)));
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

/**
 * Why a copy background sync never writes was left as it is, said by what it is: one the person can hand over (a link, the shared
 * folder's copy), one Manage must leave (the only copy a tool can have), or one inside a skills folder that is itself a link.
 */
function untouched(tool: HarnessId, copy: ToolCopy, what: string, name: string): string {
  const where = `${harnesses[tool].name} ${what} at ${copy.directory}`;
  if (copy.outside?.pinned) return `${where}. ${copy.outside.pinned}`;
  if (copy.outside) return `${where}. Central Knot changes it only when you ask: open ${name} on the Skills page and use ${REPLACE_ACTION}.`;
  return `${where}, inside a skills folder that is a link or another tool’s folder, so Central Knot does not change it.`;
}

/** What stops every tool from using one tool's copy: differing copies Central Knot does not change, and tools with a copy that could not load this one. */
function blocksFor(entry: Gathered, source: HarnessId, takeOver = true): { tool: HarnessId; reason: string }[] {
  const chosen = entry.facts.copies[source]!;
  const skill = skillAt(entry, source);
  const blocks: { tool: HarnessId; reason: string }[] = [];
  for (const location of entry.locations) {
    // A copy outside Central Knot's own (a link, the shared folder's) is taken over along with the choice the page sends.
    if (location.copy.hash === chosen.hash || location.copy.writable || (takeOver && location.copy.outside && !location.copy.outside.pinned)) continue;
    blocks.push({ tool: location.tool, reason: untouched(location.tool, location.copy, 'also reads a different copy', entry.facts.name) });
  }
  for (const tool of Object.keys(entry.facts.copies) as HarnessId[]) {
    if (tool === source || !skill || entry.facts.copies[tool]!.hash === chosen.hash) continue;
    const refused = targetFor(tool, entry.facts.copies[tool]!.directory, skill).skipped;
    if (refused) blocks.push({ tool, reason: `${harnesses[tool].name} could not load ${harnesses[source].name}'s copy: ${refused}` });
  }
  return blocks;
}

/** Why a choice cannot be carried out for the tools it syncs to, if it cannot. */
function choiceProblem(entry: Gathered, use: HarnessId, hash: string | undefined, syncing: HarnessId[], takeOver = true): Pick<DestinationResult, 'message' | 'chooseAgain'> | undefined {
  const copy = entry.facts.copies[use];
  if (!copy) return { message: `The copy you chose in ${harnesses[use].name} is gone. Nothing was changed; choose again.`, chooseAgain: true };
  if (hash !== undefined && copy.hash !== hash) return { message: `The copy you chose in ${harnesses[use].name} has changed since you chose it. Nothing was changed; choose again.`, chooseAgain: true };
  const block = (takeOver ? entry.facts.choiceBlocks[use] : blocksFor(entry, use, false))?.find(entry => syncing.includes(entry.tool));
  return block ? { message: `${block.reason} Nothing was changed.` } : undefined;
}

const rootOf = (context: ShareContext, tool: HarnessId) => writeRoot(harnesses[tool], context.home, context.overrides?.[tool]);
/** The shared skills folder several tools read (Copilot, Codex, Pi, OpenCode), and other apps too. */
export const sharedFolder = (context: ShareContext) => join(context.home, '.agents/skills');
/** Whether a tool reads the shared ~/.agents/skills folder besides its own. */
const readsShared = (context: ShareContext, tool: HarnessId) => harnesses[tool].skillRoots(configRoot(harnesses[tool], context.home, context.overrides?.[tool]), context.home).slice(1).some(root => sameDir(root.path, sharedFolder(context)));
/** The tool a shared copy's History entry names: the first present tool that reads the shared folder. */
const sharedReader = (context: ShareContext, tools: HarnessId[]) => tools.find(tool => readsShared(context, tool)) ?? tools[0] ?? 'copilot-cli';
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
/** Now, as this home's context tells it (tests set it). */
export const clock = (context: ShareContext) => context.now?.() ?? Date.now();

/** The fixed tie-break when order is unknown (D-04): each location ranks by its highest-ordered reader in SPEC §5.1, then by path. */
const surfaceRank: Record<HarnessId, number> = { 'copilot-cli': 0, 'claude-cli': 1, 'codex-cli': 2, 'pi-cli': 3, 'opencode-cli': 4 };
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
const ownRoots = (context: ShareContext, tool: HarnessId) => [rootOf(context, tool), sharedFolder(context)];

/** A deletion is inferred only from a reachable folder (DEL-01): the folder the copy sat in still exists. */
async function folderExists(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory(); } catch { return false; }
}


const historyPath = (home: string) => join(storeDirectory(home), 'history.json');

/** Writes History as given (for marking an event undone alongside a new one). */
export async function replaceHistory(context: ShareContext, events: HistoryEvent[]) {
  await saveHistory(context, events);
}

/** Adds events to the shared History (used by MCP sync too), with the same moving aside of an unreadable file. */
export async function appendHistory(context: ShareContext, events: HistoryEvent[]) {
  if (events.length) await saveHistory(context, [...await readHistory(context), ...events]);
}

/** The item's deletion, unless it has been managed again since: a re-shared item keeps its old deletion record, which no longer stands. */
const standingDeletion = (item: RecordItem) => (item.state !== 'shared' ? item.deleted : undefined);

/** The oldest moment History keeps (STO-04): the days chosen in Settings back from now. */
const historyCutoff = (context: ShareContext) => clock(context) - (context.historyDays ?? defaultHistoryDays) * DAY_MS;

/**
 * History, newest last, without events older than the window, except an Off that something can still bring back (keptOff). The
 * day window is the only other retention rule (there is no event cap), and applying it on every read means that once the window
 * shortens, no home's History offers what it can no longer restore. Unreadable history reads as empty; sync never depends on it.
 */
export async function readHistory(context: ShareContext): Promise<HistoryEvent[]> {
  let events: HistoryEvent[];
  try { const parsed = JSON.parse(await readFile(historyPath(context.home), 'utf8')); events = Array.isArray(parsed?.events) ? parsed.events : []; } catch { return []; }
  const cutoff = historyCutoff(context);
  // An Off kept past the window keeps every later entry of its item too: they say which of its tools it still holds.
  const since = new Map<string, number>();
  events.forEach((entry, index) => { if (!since.has(entry.key) && keptOff(entry, events, cutoff)) since.set(entry.key, index); });
  return events.filter((entry, index) => Date.parse(entry.at) >= cutoff || index >= (since.get(entry.key) ?? Infinity));
}

/** Skills a plugin's parts installed, or a saved parts run can put back (plugin-parts.json and plugin-parts-runs): their kept copies are in this store. */
async function partsSkills(home: string): Promise<{ name: string; hash: string }[]> {
  const texts: string[] = [];
  const read = (file: string) => readFile(file, 'utf8').then(text => { texts.push(text); }, () => undefined);
  await read(join(storeDirectory(home), 'plugin-parts.json'));
  const runs = join(storeDirectory(home), 'plugin-parts-runs');
  for (const file of await readdir(runs).catch(() => [] as string[])) if (file.endsWith('.json')) await read(join(runs, file));
  const skills: { name: string; hash: string }[] = [];
  for (const text of texts) {
    let parsed: { installs?: unknown[]; before?: unknown; after?: unknown };
    try { parsed = JSON.parse(text); } catch { continue; }
    for (const install of [...(Array.isArray(parsed?.installs) ? parsed.installs : []), parsed?.before, parsed?.after] as { items?: unknown }[]) {
      for (const item of Array.isArray(install?.items) ? install.items : []) if (item?.kind === 'skill' && typeof item.name === 'string' && typeof item.hash === 'string') skills.push(item);
    }
  }
  return skills;
}

/**
 * Store revisions no record, copy, retained History event or plugin parts point at any more are removed (STO-04). Never a current revision.
 * A deletion older than the window has left History, so its content goes too. The deletion record itself stays in sync.json,
 * so a stale replica still can't bring the item back. A copy still marked 'removing' is that stale replica: removing it needs
 * only its hash, not the stored content.
 */
async function pruneStore(context: ShareContext, events: HistoryEvent[]) {
  const { record } = await readRecord(context.home);
  if (!record) return;
  const keep = new Map<string, Set<string>>();
  const hold = (key: string, hash?: string) => { if (!hash) return; let set = keep.get(key); if (!set) { set = new Set(); keep.set(key, set); } set.add(hash); };
  const cutoff = historyCutoff(context);
  for (const [key, item] of Object.entries(record.items)) {
    const deletion = standingDeletion(item);
    const expired = !!deletion && Date.parse(deletion.at) < cutoff;
    if (!expired) { hold(key, item.hash); hold(key, item.deleted?.hash); }
    hold(key, item.use?.hash);
    for (const copy of item.copies) if (!expired || copy.status !== 'removing') hold(key, copy.hash);
    for (const entry of item.displaced ?? []) hold(key, entry.hash);
  }
  for (const entry of events) { hold(entry.key, entry.winner?.hash); hold(entry.key, entry.previous); for (const loser of entry.losers) hold(entry.key, loser.hash); }
  for (const item of await partsSkills(context.home)) hold(itemKey(item.name), item.hash);
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

/** Writes History. History that cannot be read, or is not History, is moved aside, never overwritten: it may be recoverable by hand. */
async function writeHistory(home: string, events: HistoryEvent[]) {
  let sound = true;
  try { sound = Array.isArray(JSON.parse(await readFile(historyPath(home), 'utf8'))?.events); } catch (error) { sound = errorCode(error) === 'ENOENT'; }
  if (!sound) await rename(historyPath(home), join(storeDirectory(home), `history.unreadable-${Date.now()}.json`)).catch(() => undefined);
  await writeDurably(historyPath(home), `${JSON.stringify({ events }, null, 2)}\n`);
}

/**
 * Every History write (skills, MCP servers, agents, deletes and restores) goes through here. `events` come from readHistory, so
 * they are already inside the window. After writing, the store frees what only expired History and deletions kept, so any
 * home's next History write applies a window shortened elsewhere. That cleanup runs only in a home this build syncs and may write.
 */
async function saveHistory(context: ShareContext, events: HistoryEvent[]) {
  await writeHistory(context.home, events);
  if (await syncsHere(context)) await pruneStore(context, events);
}

/**
 * Applies a shortened window to this home at once (Settings): History loses what is now older, and the store frees what only
 * that kept. Only in a home this build syncs and may write ('done'). Elsewhere the next History write there applies it: this
 * build's once it syncs the home ('later'), or, in a preview-only home or one another build syncs, that copy's ('elsewhere').
 */
export async function pruneHistory(context: ShareContext): Promise<Exclude<HistoryPrune, 'no-home' | 'failed'>> {
  if (!(await syncsHere(context))) {
    const { record } = await readRecord(context.home);
    return (await writeAccess(context)).allowed && (!record || record.owner === context.build) ? 'later' : 'elsewhere';
  }
  const events = await readHistory(context);
  await writeHistory(context.home, events);
  await pruneStore(context, events);
  return 'done';
}


/**
 * Why a tool's own skills folder cannot be written, if it cannot. A folder that is a link, or that is the same folder as another
 * tool's or the shared .agents folder, is never written through: a copy there would land in a folder Central Knot does not own.
 */
export async function rootProblem(context: ShareContext, tool: HarnessId): Promise<string | undefined> {
  const root = rootOf(context, tool);
  const name = harnesses[tool].name;
  try { if ((await lstat(root)).isSymbolicLink()) return `${name}'s skills folder is a link${await readlink(root).then(target => ` to ${target}`, () => '')}, so Central Knot does not write through it.`; }
  catch (error) { if (errorCode(error) !== 'ENOENT') return `${name}'s skills folder could not be checked.`; }
  // A folder not made yet still lands somewhere: through a linked parent, or where another tool's folder is.
  const real = await landingOf(root);
  if (!real) return `${name}'s skills folder could not be checked.`;
  const others = [...(Object.keys(harnesses) as HarnessId[]).filter(other => other !== tool).map(other => rootOf(context, other)), sharedFolder(context)];
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

/**
 * Why the shared folder's copies stay where they are when a skill is managed: a present tool's own skills folder is that very
 * folder (a link to it), so a copy there is the only one that tool can have. Undefined when no tool's folder is.
 */
async function pinnedShared(context: ShareContext, tools: HarnessId[], problems: Map<HarnessId, string | undefined>): Promise<{ text: string; tool: HarnessId } | undefined> {
  const shared = await landingOf(sharedFolder(context));
  if (!shared) return undefined;
  for (const tool of tools) {
    if (problems.get(tool) && await landingOf(rootOf(context, tool)) === shared) return { text: `${toolName(tool)}’s skills folder is that same folder, so the copy there is the only one ${toolName(tool)} can have.`, tool };
  }
  return undefined;
}

/**
 * A copy Central Knot does not write in the background but takes over when the person asks: a link directly in the tool's own
 * skills folder (when that folder itself is sound), or a copy in the shared ~/.agents/skills folder. Anything else (a copy
 * reached through a skills folder that is itself a link) is never taken over.
 */
async function outsideOf(context: ShareContext, tool: HarnessId, directory: string, problems: Map<HarnessId, string | undefined>, pinned?: { text: string; tool: HarnessId }): Promise<Outside | undefined> {
  let linkTo: string | undefined;
  try { if ((await lstat(directory)).isSymbolicLink()) linkTo = await readlink(directory); } catch { return undefined; }
  if (sameDir(dirname(directory), sharedFolder(context))) return { kind: 'shared', ...(linkTo !== undefined ? { linkTo } : {}), ...(pinned ? { pinned: pinned.text, pinnedBy: pinned.tool } : {}) };
  if (linkTo !== undefined && !problems.get(tool) && sameDir(dirname(directory), rootOf(context, tool))) return { kind: 'link', linkTo };
  return undefined;
}

/** Where a link at `path` led, when it is a link that leads nowhere; undefined otherwise. */
async function brokenLink(path: string): Promise<string | undefined> {
  try { if (!(await lstat(path)).isSymbolicLink()) return undefined; } catch { return undefined; }
  try { await stat(path); return undefined; } catch (error) { return errorCode(error) === 'ENOENT' ? readlink(path).catch(() => '') : undefined; }
}

/** A broken link where a copy is about to go is removed first (only the link: it leads nowhere). Returns where it led, if there was one. */
async function clearBrokenLink(path: string): Promise<string | undefined> {
  const led = await brokenLink(path);
  if (led !== undefined) await unlink(path);
  return led;
}

/** Removes a link, and only the link: never what it leads to. Refused when the link changed since it was read. */
async function unlinkChecked(path: string, linkTo: string) {
  const info = await lstat(path);
  if (!info.isSymbolicLink() || await readlink(path) !== linkTo) throw changedWhileSyncing();
  await unlink(path);
}

/**
 * The page's view of a home. Reads only; writes nothing. `caughtUp` and `notices` are what passes did since the page last
 * read. `snapshots` is the read of the home the rest of the page was built from, so every page shows the same tools;
 * without it the home is read now.
 */
export async function manageView(context: ShareContext, { caughtUp = [], notices = [], snapshots: given }: { caughtUp?: DestinationResult[]; notices?: SyncNotice[]; snapshots?: Snapshot[] } = {}): Promise<ManageView> {
  const snapshots = given ?? await context.read();
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
  // A managed skill with links or a shared copy again after a take-over removed them (an installer put them back): the page says they are back.
  const tookOver = new Set((await readHistory(context)).filter(event => event.kind === 'took-over' && !event.undoneBy).map(event => event.key));
  for (const [key, entry] of gathered) {
    if (record?.items[key]?.state === 'shared' && tookOver.has(key) && entry.locations.some(location => location.copy.outside && !location.copy.outside.pinned)) entry.facts.outsideBack = true;
  }
  const skills = [...gathered.values()].map(entry => entry.facts).sort(byKey);
  const tools = managedTools(snapshots, record?.tools);
  const writes = Object.fromEntries(await Promise.all(tools.map(async tool => [tool, { to: rootOf(context, tool), alsoReadBy: harnesses[tool].otherReaders, blocked: await rootProblem(context, tool) }] as const)));
  const history = await readHistory(context), keyOf = (event: HistoryEvent) => (event.key.includes(':') ? undefined : event.key);
  for (const [key, removed] of heldOffFacts(history, new Set(gathered.keys()), keyOf)) Object.assign(gathered.get(key)!.facts, removed);
  const gone = goneFacts(history, new Set(gathered.keys()), keyOf);
  return { tools, writes, skills, gone, access: await writeAccess(context), gate: await syncGate(context), caughtUp, notices };
}

/**
 * Each item's open removals, by key (`keyOf` reads an event's item key for one kind; undefined: another kind's event): the
 * latest first, each with the tools it hasn't put back yet. A deletion that stands since ends the ones before it: the item was
 * deleted, not turned off.
 */
function openRemovals(events: HistoryEvent[], keyOf: (event: HistoryEvent) => string | undefined): Map<string, { event: HistoryEvent; tools: HarnessId[] }[]> {
  const open = new Map<string, { event: HistoryEvent; tools: HarnessId[] }[]>();
  for (const event of events) {
    const key = keyOf(event);
    if (key === undefined || event.kind !== 'removed' || event.undoneBy || deletedSince(event, events)) continue;
    const tools = event.turnedOff ? offTools(event, events) : event.losers.map(loser => loser.tool).filter(tool => !event.restoredTools?.includes(tool));
    if (tools.length) open.set(key, [{ event, tools }, ...(open.get(key) ?? [])]);
  }
  return open;
}

/**
 * Items no tool has a copy of any more that History can put back: for each, its latest removal still open, which shows it
 * switched Off (a deletion leaves no row). One that turned it off stands until it is turned on again or deleted; a removal by
 * hand, for History's days. `here` are the keys some tool has now.
 */
export function goneFacts(events: HistoryEvent[], here: Set<string>, keyOf: (event: HistoryEvent) => string | undefined): SkillFacts[] {
  return [...openRemovals(events, keyOf)].filter(([key]) => !here.has(key)).map(([key, list]) => {
    const latest = list[0].event;
    // A removal puts it back where it took it from; each other tool's own latest removal, still open, puts that tool's copy back too.
    const covered = new Set(list[0].tools);
    const also = list.slice(1).filter(older => { const more = older.tools.filter(tool => !covered.has(tool)); for (const tool of more) covered.add(tool); return more.length > 0; }).map(older => older.event.id);
    return { key, name: latest.item, description: '', copies: {}, extra: [], managed: false, off: [], cannot: {}, choiceBlocks: {},
      gone: { history: latest.id, at: latest.at, ...(also.length ? { also } : {}), ...(latest.turnedOff ? { turnedOff: true as const } : {}) }, ...heldOffOf(list) };
  });
}

/** Each tool an item's open Off removals hold (Rule A), with the latest that holds it: what turning it on puts back (SkillFacts.heldOff). */
function heldOffOf(list: { event: HistoryEvent; tools: HarnessId[] }[]): Pick<SkillFacts, 'heldOff'> {
  const heldOff: NonNullable<SkillFacts['heldOff']> = [];
  for (const { event, tools } of list) if (event.turnedOff) for (const tool of tools) if (!heldOff.some(entry => entry.tool === tool)) heldOff.push({ tool, history: event.id });
  return heldOff.length ? { heldOff } : {};
}

/** The open Off removals of each item some tool still has a copy of (SkillFacts.heldOff), by key. */
export function heldOffFacts(events: HistoryEvent[], here: Set<string>, keyOf: (event: HistoryEvent) => string | undefined): Map<string, Pick<SkillFacts, 'heldOff'>> {
  return new Map([...openRemovals(events, keyOf)].filter(([key]) => here.has(key)).map(([key, list]) => [key, heldOffOf(list)] as const).filter(([, facts]) => facts.heldOff));
}

/**
 * Moves a different copy aside and puts the chosen one in its place. The replaced bytes are kept in the store first. `expected` is the
 * content the pass decided to replace: a copy holding anything else (an edit made meanwhile) is never replaced.
 */
export async function replaceCopy(context: ShareContext, key: string, source: string, target: string, expected?: string): Promise<string> {
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
export async function removeChecked(context: ShareContext, directory: string, expected: string) {
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
export function displace(item: RecordItem, tool: HarnessId, hash: string, removal?: { folder: string; stoppedSync: boolean }) {
  item.displaced ??= [];
  // A removal is per tool: two tools' identical copies are two removals, so each is on record.
  if (!item.displaced.some(entry => entry.hash === hash && (!removal || entry.tool === tool))) item.displaced.push({ tool, hash, ...(removal ? { removal } : {}) });
}

/**
 * `observeOnly` (Sync off, SYN-03): read and keep the ordering evidence, write nothing. `only`: write only these skills, so an
 * explicit click with Sync off does exactly what it is about and no background spreading rides along.
 */
export interface PassOptions { observeOnly?: boolean; only?: Set<string> }

/**
 * Records the person's choices, then brings every managed skill into line: a copy goes to each tool it syncs to and lacks,
 * and for differing copies the chosen copy replaces the others. No changes means a catch-up pass.
 */
export async function applyChanges(context: ShareContext, changes: Change[], resume = false, options: PassOptions = {}): Promise<ApplyResult> {
  try { return await runApply(context, changes, resume, options); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith('fault:')) throw error;
    // Another build took over syncing while this ran (stillOwned): said as it is, with nothing to refresh away.
    if (errorCode(error) === 'CK_TAKEN') return { stopped: plainError(error), results: [], harnessWrites: 0 };
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
  const tools = managedTools(snapshots, record?.tools);
  const gathered = await gather(context, snapshots, record);
  // A crash between these steps leaves an intact record this build can resume.
  if (!record) { record = newRecord(context); await saveRecord(context.home, record); }
  if (gate.state !== 'ready') await remember(context, record.generation);
  // The record is saved only when it changed: catch-up runs on every read, and a read that finds nothing to do writes nothing.
  let saved = JSON.stringify(record);
  const save = async () => { const text = JSON.stringify(record); if (text !== saved) { await saveRecord(context.home, record!); saved = text; } };
  // Asked before each item, so a pass that another build took over from writes nothing more; a pass with nothing to do
  // runs through its items in no time and asks once.
  let ownedAt = 0;
  const owned = async () => { if (Date.now() - ownedAt < 200) return; await stillOwned(context.home, context.build); ownedAt = Date.now(); };

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
  // Skills this change turns Managed: the copies it creates for them are told in History as 'added', so they can be undone.
  const newlyManaged = new Set<string>();
  // Tools a managed skill syncs to again after this change (out of `off`): the copies it creates there are told as 'added'
  // too, marked `rejoined`, so their Undo takes them out and stops syncing there, and the skill stays managed.
  const rejoined = new Map<string, HarnessId[]>();
  // Changes taken (not held): the only ones that remove copies or flip switches after the sync loop. For each managed removal,
  // the tools it stops syncing to and their sync records (put back if a removal doesn't happen), and whether it takes the last copies.
  const taken = new Map<string, { stoppedSync: HarnessId[]; records: RecordItem['copies']; lastCopies: boolean }>();
  const added = new Map<string, { name: string; hash: string; copies: { tool: HarnessId; hash: string }[] }>();
  // Skills whose copies outside Central Knot's own the person asked to take over (Manage, Replace with managed copies).
  const takeOvers = new Set<string>();
  // Skills this run was asked to change: only these may start from a copy background sync never writes.
  const asked = new Set(changes.map(change => change.key));
  for (const change of changes) {
    const entry = gathered.get(change.key);
    if (!entry) continue;
    // A change made from an older read of the page is refused when the skill changed since: a deletion spread meanwhile must not be undone.
    const before = record.items[change.key];
    if (change.seenManaged !== undefined && (before?.state === 'shared') !== change.seenManaged) {
      results.push({ item: entry.facts.name, outcome: 'held', unchanged: true, message: `${entry.facts.name} changed since the page was read${before?.deleted ? ' (it was deleted)' : ''}. Nothing was changed; read again.` });
      continue;
    }
    // The copy a tool reads in another managed tool's folder is that tool's: choosing it chooses the owner's. With the owner
    // left out, it stays the reader's choice, and the reader gets a copy of its own from it.
    const owner = change.use && change.use !== 'separate' ? entry.facts.copies[change.use]?.readsFrom : undefined;
    if (owner && tools.includes(owner)) change.use = owner;
    // A choice that cannot be carried out changes nothing at all: not even Managed.
    if (change.use && change.use !== 'separate') {
      const syncing = tools.filter(tool => !change.off.includes(tool) && !entry.facts.cannot[tool]);
      const problem = choiceProblem(entry, change.use, change.useHash, syncing, !!change.takeOver);
      if (problem) { results.push({ item: entry.facts.name, outcome: 'held', unchanged: true, ...problem }); continue; }
    }
    // Removing the very copy chosen for every tool would leave the choice nothing to copy from: refused, changing nothing.
    if (change.use && change.use !== 'separate' && change.remove?.includes(change.use)) {
      results.push({ item: entry.facts.name, harness: change.use, outcome: 'held', message: `You chose ${toolName(change.use)}’s copy and also asked to remove it there. Keep that copy, or choose another. Nothing was changed.` });
      continue;
    }
    // A Disable that can't be carried out changes nothing either: otherwise the copy would arrive enabled.
    const cantDisable = change.disable?.find(tool => entry.facts.switchProblem?.[tool]);
    if (cantDisable) {
      results.push({ item: entry.facts.name, harness: cantDisable, outcome: 'held', message: `Disable isn’t available in ${toolName(cantDisable)}: ${problemText(entry.facts.switchProblem![cantDisable]!)} Nothing was changed.` });
      continue;
    }
    const item: RecordItem = record.items[change.key] ?? { name: entry.facts.name, hash: '', state: 'dont-share', startId: '', observedAt: new Date().toISOString(), copies: [] };
    const wasSynced = item.state === 'shared';
    if (change.managed && change.use !== 'separate' && item.state !== 'shared') {
      newlyManaged.add(change.key);
      // Managed afresh: what it synced before (say, before a deletion) is no baseline for the copies it has now.
      item.hash = '';
    }
    const wasOff = item.off ?? [];
    if (item.state === 'shared' && change.managed && change.use !== 'separate') rejoined.set(change.key, wasOff.filter(tool => !change.off.includes(tool)));
    item.state = change.managed && change.use !== 'separate' ? 'shared' : 'dont-share';
    // A managed skill removed from a tool stops syncing there, or the next pass would put it back.
    const removing = item.state === 'shared' ? (change.remove ?? []).filter(tool => harnesses[tool]) : [];
    item.off = [...new Set([...change.off, ...removing])].filter(tool => harnesses[tool]);
    // Tools this removal stops syncing to: not ones already off, or turned off in this same change (Restore leaves those off).
    const stopping = removing.filter(tool => !wasOff.includes(tool) && !change.off.includes(tool));
    // The last copies: once removed, no tool the skill still syncs to has one (a copy in a tool whose box is off doesn't count).
    const lastCopies = removing.length > 0 && !(Object.keys(entry.facts.copies) as HarnessId[]).some(tool => !item.off!.includes(tool));
    taken.set(change.key, { stoppedSync: stopping, records: item.copies.filter(copy => stopping.includes(copy.harness)), lastCopies });
    // A copy is tracked only while the skill syncs to its tool: one removed while off, or while unmanaged, is no deletion later.
    item.copies = item.state === 'shared' ? item.copies.filter(copy => !item.off!.includes(copy.harness)) : [];
    // Removing a managed skill's every copy leaves nothing to sync: it is unmanaged (Restore manages it again).
    if (lastCopies) { item.state = 'dont-share'; item.copies = []; }
    item.separate = change.use === 'separate' ? true : change.managed ? undefined : item.separate;
    if (item.state !== 'shared') delete item.keptOwn;
    // The choice is on record before any copy is replaced, so a crash part-way finishes it at the next pass instead of losing it.
    // Whether it was synced already is kept with it: a pass that finishes it after a crash can't tell any more.
    if (change.use && change.use !== 'separate') item.use = { tool: change.use, hash: entry.facts.copies[change.use]!.hash, ...(wasSynced ? { wasSynced: true as const } : {}) };
    else if (!change.managed || change.use === 'separate') delete item.use;
    record.items[change.key] = item;
    if (change.takeOver && item.state === 'shared') takeOvers.add(change.key);
  }
  await save();
  if (!options.observeOnly) await clearStaleStages(context, [...tools.map(tool => rootOf(context, tool)), sharedFolder(context)]);

  let writes = 0;
  let settling = false;
  // A skills folder that was deleted and made again since the last pass (a reset or reinstall, even with the app closed) has a new
  // identity: its missing copies are put back, never read as deletions. Skills deleted inside the same folder are real deletions.
  const resetRoots = new Set<string>();
  const roots = [...new Set([...tools.map(tool => rootOf(context, tool)), sharedFolder(context)])];
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
  const tookOver = new Map<string, TookOver>();
  // Each skill's 'chosen' entry this pass, by key.
  const chosenIds = new Map<string, string>();
  // Copies a take-over removed for a tool the same change removes ("key\0tool"), its link or the shared copy it read only there:
  // that tool's Remove, finished by removeCopies.
  const removedByTakeOver = new Map<string, { copy: ToolCopy; linkTo?: string }>();

  /**
   * Takes over a skill's copies outside Central Knot's own, because the person asked (never in a background pass). Each link in a
   * tool it syncs to becomes a real copy; each tool it syncs to that read the shared copy gets one of its own; then the shared copy
   * is removed. Everything taken is kept in the store first and told in a 'took-over' event, whose Undo puts it back. A link is
   * removed as a link, never followed; the shared copy goes only as its own step, after every tool that needs it has its own.
   */
  const takeOver = async (key: string, entry: Gathered, item: RecordItem, syncing: HarnessId[]): Promise<'held' | undefined> => {
    const outside = entry.locations.filter(location => location.copy.outside && !location.copy.outside.pinned);
    if (!outside.length) return undefined;
    // Sorted once, as they were read: a link replaced below is no longer outside.
    const links = outside.filter(location => location.copy.outside!.kind === 'link').map(location => ({ location, linkTo: location.copy.outside!.linkTo! }));
    const sharedOnes = outside.filter(location => location.copy.outside!.kind === 'shared').map(location => ({ location, linkTo: location.copy.outside!.linkTo }));
    const name = entry.facts.name;
    const shared = sharedFolder(context);
    const wanted = (tool: HarnessId) => syncing.includes(tool) && !entry.facts.cannot[tool];
    // What every copy becomes: the chosen copy; for a skill already managed, its synced content; otherwise the one content all copies hold.
    let seed: string | undefined;
    const chosen = item.use && entry.facts.copies[item.use.tool];
    if (chosen) seed = chosen.directory;
    else if (item.hash && !newlyManaged.has(key)) {
      seed = entry.locations.find(location => location.copy.hash === item.hash)?.copy.directory;
      if (!seed && await exists(storedRevision(context, key, item.hash))) seed = storedRevision(context, key, item.hash);
    } else {
      const candidates = entry.locations.filter(location => wanted(location.tool) || location.copy.outside);
      if (new Set(candidates.map(location => location.copy.hash)).size > 1) { results.push({ item: name, outcome: 'held', message: 'Copies differ. Choose which copy to use.' }); return 'held'; }
      seed = candidates[0]?.copy.directory;
    }
    if (!seed) { results.push({ item: name, outcome: 'held', message: 'Its synced content is no longer in Central Knot’s store, so its other copies were left as they are.' }); return 'held'; }
    let tree;
    try { tree = await readTree(seed); await importRevision(context, key, seed, tree); }
    catch (error) { results.push({ item: name, outcome: 'failed', message: `Could not read the copy to start from. ${plainError(error)}` }); return 'held'; }
    const kept = storedRevision(context, key, tree.hash);
    const told: TookOver = { links: [], shared: [], placed: [], ...(newlyManaged.has(key) ? { managedNow: true } : {}) };
    const becomeOwn = (location: Location) => { Object.assign(location.copy, { hash: tree.hash, writable: true }); delete location.copy.outside; };
    // 1. A link in a tool it syncs to: the link goes (only the link) and a real copy takes its place.
    for (const { location, linkTo } of links.filter(candidate => wanted(candidate.location.tool))) {
      const { tool } = location;
      const path = location.copy.directory;
      const late = await rootProblem(context, tool);
      if (late) { results.push({ item: name, harness: tool, outcome: 'held', message: late }); continue; }
      try {
        if (location.copy.hash !== tree.hash) await importRevision(context, key, path, await readTree(path));
        await unlinkChecked(path, linkTo);
        try { await placeCopy(context, kept, { harness: tool, directory: path, limits: [] }, tree); }
        catch (error) { await symlink(linkTo, path).catch(() => undefined); throw error; }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('fault:')) throw error;
        results.push({ item: name, harness: tool, outcome: errorCode(error) === 'CK_CHANGED' ? 'held' : 'failed', message: `Could not replace the link in ${toolName(tool)}’s skills folder. ${plainError(error)}` });
        continue;
      }
      writes++;
      told.links.push({ tool, path, linkTo, hash: location.copy.hash, placed: tree.hash });
      becomeOwn(location);
      results.push({ item: name, harness: tool, outcome: 'written', tookOver: 'link', message: `Replaced the link in ${toolName(tool)}’s skills folder (it led to ${linkTo}) with a copy of its own. ${harnesses[tool].nextStep}` });
    }
    const removing = new Set(changes.find(change => change.key === key)?.remove ?? []);
    // 2. The shared copy: each tool it syncs to that read it there gets its own first; then it goes, unless one could not.
    const readers = tools.filter(tool => readsShared(context, tool));
    for (const path of [...new Set(sharedOnes.map(candidate => candidate.location.copy.directory))]) {
      const { location: here, linkTo } = sharedOnes.find(candidate => candidate.location.copy.directory === path)!;
      let keep: string | undefined;
      for (const reader of readers.filter(wanted)) {
        if (entry.locations.some(location => location.tool === reader && location.copy.writable)) continue;
        // It reads the folder of a tool this pass gives a copy (OpenCode reads Claude Code's): that copy is the one it will read.
        const owner = readsFolderOf(context, reader, tools);
        if (owner && wanted(owner)) continue;
        const problem = await rootProblem(context, reader);
        if (problem) { keep = problem; break; }
        const directory = ownCopyDir(context, reader, here.copy.folder);
        try {
          await mkdir(dirname(directory), { recursive: true });
          await clearBrokenLink(directory);
          await placeCopy(context, kept, { harness: reader, directory, limits: [] }, tree);
        } catch (error) {
          if (error instanceof Error && error.message.startsWith('fault:')) throw error;
          keep = `${toolName(reader)} could not get a copy of its own: ${plainError(error)}`;
          break;
        }
        writes++;
        told.placed.push({ tool: reader, path: directory, hash: tree.hash });
        const copy: ToolCopy = { ...here.copy, directory, hash: tree.hash, writable: true, rootLabel: harnesses[reader].skillRoots(configRoot(harnesses[reader], context.home, context.overrides?.[reader]), context.home)[0].label };
        delete copy.outside;
        entry.locations.push({ tool: reader, copy });
        entry.facts.copies[reader] = copy;
        item.copies = [...item.copies.filter(known => !sameDir(known.directory, directory)), { harness: reader, directory, hash: tree.hash, created: true, status: 'written' }];
        results.push({ item: name, harness: reader, outcome: 'written', tookOver: 'placed', message: `${toolName(reader)} read it in ${shared}; it has a copy of its own now. ${harnesses[reader].nextStep}` });
      }
      if (keep) { results.push({ item: name, outcome: 'held', message: `The copy in ${shared} stays: ${keep}` }); continue; }
      try {
        if (here.copy.hash !== tree.hash) await importRevision(context, key, path, await readTree(path));
        if (linkTo !== undefined) await unlinkChecked(path, linkTo); else await removeChecked(context, path, here.copy.hash);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('fault:')) throw error;
        results.push({ item: name, outcome: errorCode(error) === 'CK_CHANGED' ? 'held' : 'failed', message: `Could not remove the copy in ${shared}. ${plainError(error)}` });
        continue;
      }
      writes++;
      told.shared.push({ path, hash: here.copy.hash, ...(linkTo !== undefined ? { linkTo } : {}) });
      entry.locations = entry.locations.filter(location => !sameDir(location.copy.directory, path));
      entry.facts.extra = entry.facts.extra.filter(extra => !sameDir(extra.directory, path));
      const lost: HarnessId[] = [];
      for (const tool of Object.keys(entry.facts.copies) as HarnessId[]) {
        if (!sameDir(entry.facts.copies[tool]!.directory, path)) continue;
        const own = entry.locations.find(location => location.tool === tool);
        if (own) entry.facts.copies[tool] = own.copy;
        else {
          if (removing.has(tool)) removedByTakeOver.set(`${key}\0${tool}`, { copy: entry.facts.copies[tool]! });
          delete entry.facts.copies[tool];
          lost.push(tool);
        }
      }
      results.push({ item: name, outcome: 'removed', tookOver: 'shared', folder: shared, message: `Removed the copy in ${shared}; History keeps it. Other apps that read that folder won’t find it there.${lost.length ? ` ${andList(lost.map(toolName))} ${lost.length > 1 ? 'aren’t' : 'isn’t'} ticked and read it only there, so ${lost.length > 1 ? 'they no longer have' : 'it no longer has'} it.` : ''}` });
    }
    // 3. A link in a tool left out that now leads nowhere (it led to the shared copy) goes too, as a link. In a tool this same
    // change removes, that is the Remove done: its 'removed' event names it (removeCopies), not the take-over, whose Undo
    // must not bring back a link the person asked to go.
    for (const { location, linkTo } of links.filter(candidate => !wanted(candidate.location.tool))) {
      if ((await brokenLink(location.copy.directory)) === undefined) continue;
      try { await unlinkChecked(location.copy.directory, linkTo); } catch { continue; }
      writes++;
      entry.locations = entry.locations.filter(other => other !== location);
      if (entry.facts.copies[location.tool]?.directory === location.copy.directory) delete entry.facts.copies[location.tool];
      if (removing.has(location.tool)) { removedByTakeOver.set(`${key}\0${location.tool}`, { copy: location.copy, linkTo }); continue; }
      told.links.push({ tool: location.tool, path: location.copy.directory, linkTo, hash: location.copy.hash });
      results.push({ item: name, harness: location.tool, outcome: 'removed', tookOver: 'link', message: `${toolName(location.tool)} isn’t ticked; its link led to the removed copy, so the link was removed too.` });
    }
    if (told.links.length || told.shared.length || told.placed.length) tookOver.set(key, told);
    // A recorded choice names a copy that now holds the same content somewhere Central Knot keeps it.
    if (item.use) {
      const holder = entry.locations.find(location => wanted(location.tool) && location.copy.writable && location.copy.hash === tree.hash);
      if (holder) item.use = { tool: holder.tool, hash: tree.hash };
    }
    await save();
    return undefined;
  };

  // The events the asked changes made, for their Undo: what sync did alongside (an edit spreading, a deletion) is never among them.
  const made: string[] = [];
  const chosenNow = new Set(changes.filter(change => change.use && change.use !== 'separate').map(change => change.key));
  for (const [key, entry] of gathered) {
    // Taken over by another build meanwhile: nothing more is written, starting with this item.
    await owned();
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
    // Asked for: the copies outside Central Knot's own become ordinary ones first (links replaced, the shared copy removed).
    if (takeOvers.has(key) && !options.observeOnly && await takeOver(key, entry, item, syncing) === 'held') { skip(); continue; }
    // No tool it syncs to holds it, but one reads the copy of a tool that is left out (OpenCode reads Claude Code's): that
    // copy becomes the reader's own, to start from. The owner's is no longer kept in sync, and this pass may remove it.
    // The same for a reader whose copy was chosen over the others: it needs a copy of its own to be chosen from.
    const chosenReader = item.use && syncing.includes(item.use.tool) && !entry.locations.some(location => location.tool === item.use!.tool) ? item.use.tool : undefined;
    if (!options.observeOnly && (chosenReader || !entry.locations.some(location => syncing.includes(location.tool)))) {
      for (const tool of chosenReader ? [chosenReader] : syncing) {
        const read = entry.facts.copies[tool];
        // A reader that had a copy of its own on record deleted it: that is a deletion, never made good from here.
        if (!read?.readsFrom || entry.facts.cannot[tool] || item.copies.some(copy => copy.harness === tool) || await rootProblem(context, tool)) continue;
        const directory = ownCopyDir(context, tool, read.folder);
        try {
          await mkdir(dirname(directory), { recursive: true });
          await placeCopy(context, read.directory, { harness: tool, directory, limits: [] }, await readTree(read.directory));
        } catch (error) {
          if (error instanceof Error && error.message.startsWith('fault:')) throw error;
          results.push({ item: name, harness: tool, outcome: 'failed', message: `Could not copy to ${harnesses[tool].name}. ${plainError(error)}` });
          continue;
        }
        const { readsFrom, ...copy } = { ...read, directory, writable: true };
        entry.facts.copies[tool] = copy;
        entry.locations.push({ tool, copy });
        // On record as one Central Knot made, so an Undo that takes added copies out again can remove it.
        item.copies.push({ harness: tool, directory, hash: copy.hash, created: true, status: 'written' });
        writes++;
        // Newly managed, or syncing here again: this copy is one the change added, so its Undo takes it out again.
        if (newlyManaged.has(key) || rejoined.get(key)?.includes(tool)) added.set(key, { name, hash: copy.hash, copies: [...(added.get(key)?.copies ?? []), { tool, hash: copy.hash }] });
        results.push({ item: name, harness: tool, outcome: 'written', message: `${harnesses[tool].name} read ${harnesses[readsFrom!].name}’s copy, which is left out here, so it has a copy of its own now. ${harnesses[tool].nextStep}` });
        break;
      }
    }
    const locations = entry.locations.filter(location => syncing.includes(location.tool) && !entry.facts.cannot[location.tool]);
    const chosen = item.use?.tool;
    const choiceWasSynced = !!item.use?.wasSynced;
    if (item.use) {
      // A choice recorded before a crash is finished only if it still holds.
      const problem = choiceProblem(entry, item.use.tool, item.use.hash, syncing.filter(tool => !entry.facts.cannot[tool]));
      if (problem) { results.push({ item: name, outcome: 'held', ...problem }); delete item.use; continue; }
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
        results.push({ item: entry.facts.name, harness: copy.harness, outcome: 'held', message: `${harnesses[copy.harness].name}'s copy moved to ${found.copy.directory}, where Automatic sync does not write, so edits can't reach it there. Move it back to ${rootOf(context, copy.harness)}, or use ${REPLACE_ACTION} on the Skills page, to keep it syncing.` });
        item.copies = item.copies.filter(other => other !== copy);
        continue;
      }
      if (found) copy.directory = found.copy.directory;
    }
    // A copy an Undo of a choice left as its tool's own stays so until that tool's copy is on record again (chosen, or the
    // same as the rest) or gone. An edit there doesn't end it: taken back, the copy is still the tool's own, never just behind.
    for (const tool of Object.keys(item.keptOwn ?? {}) as HarnessId[]) if (!entry.facts.copies[tool] || item.copies.some(copy => copy.harness === tool)) delete item.keptOwn![tool];
    if (item.keptOwn && !Object.keys(item.keptOwn).length) delete item.keptOwn;
    // An unrecorded copy holding the synced content, or an earlier revision of this skill from the store (a folder switched back,
    // a copy that once failed to update), is this skill's copy, just behind: adopt it rather than call it a collision.
    if (item.hash) for (const location of locations) {
      if (item.copies.some(copy => copy.directory === location.copy.directory) || !location.copy.writable || item.keptOwn?.[location.tool] === location.copy.hash) continue;
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
    const followed = item.hash ? locations.filter(location => recorded.has(location.copy.directory) || location.copy.writable) : locations;
    // Asked for by the person, with no copy sync follows (only copies it never writes, say a skill managed again after a deletion):
    // those copies are where it starts from, as on first Manage, never "nothing to start from".
    const active = !followed.length && asked.has(key) ? locations : followed;
    for (const location of locations.filter(candidate => !active.includes(candidate) && candidate.copy.hash !== item.hash)) {
      results.push({ item: name, harness: location.tool, outcome: 'held', message: untouched(location.tool, location.copy, 'also reads an older copy', name) });
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
      // With Sync off, a click writes only what it is about: a pending edit or deletion of this skill waits for Sync.
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
            // Spread by sync, not asked for on this skill: a copy outside Central Knot's own stays, and the page offers to remove it.
            if (!location.copy.writable) { results.push({ item: name, harness: location.tool, outcome: 'held', message: location.copy.outside && !location.copy.outside.pinned ? `${harnesses[location.tool].name} still reads a copy at ${location.copy.directory}. To remove it too, open ${name} on the Skills page and use Delete everywhere.` : untouched(location.tool, location.copy, 'still reads a copy', name) }); continue; }
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
          item.copies = [...leftover, ...item.copies.filter(copy => copy.status === 'written' && !entry.locations.some(location => location.copy.directory === copy.directory) && !deletions.some(gone => gone.directory === copy.directory)).map(copy => ({ ...copy, status: 'removing' as const }))];
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
        results.push({ item: name, outcome: 'held', differs: true, message: 'Copies differ. Choose which copy to use.' });
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
      const chosenLosers: { tool: HarnessId; hash: string; editedAt?: string }[] = [];
      if (winner) {
        source = winner.copy;
        sourceTool = winner.tool;
        for (const location of active) {
          if (location.copy.hash === source.hash) { inSync.add(location.copy.directory); continue; }
          const late = await rootProblem(context, location.tool);
          const refusal = late ?? (location.copy.writable ? undefined : untouched(location.tool, location.copy, 'reads a copy', name));
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
          results.push({ item: name, harness: location.tool, outcome: 'written', replaced: true, message: `Now has ${harnesses[sourceTool].name}'s edit. The replaced copy is kept in History. ${harnesses[location.tool].nextStep}` });
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
          const refusal = late ?? (location.copy.writable ? undefined : untouched(location.tool, location.copy, 'reads an older copy', name));
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
          results.push({ item: name, harness: location.tool, outcome: 'written', caughtUp: true, message: `Caught up. ${harnesses[location.tool].nextStep}` });
        }
      } else if (hashes.size > 1) {
        if (!chosen) { results.push({ item: name, outcome: 'held', differs: true, message: 'Copies differ. Choose which copy to use.' }); continue; }
        source = entry.facts.copies[chosen]!;
        sourceTool = chosen;
        for (const location of active) {
          if (location.copy.hash === source.hash) { inSync.add(location.copy.directory); continue; }
          // Checked again just before writing: a folder can become a link after the page was read.
          const late = await rootProblem(context, location.tool);
          if (late) { results.push({ item: name, harness: location.tool, outcome: 'held', message: late }); continue; }
          if (!location.copy.writable) {
            results.push({ item: name, harness: location.tool, outcome: 'held', message: untouched(location.tool, location.copy, 'also reads a different copy', name) });
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
          chosenLosers.push({ tool: location.tool, hash: location.copy.hash, editedAt: location.copy.modified });
          results.push({ item: name, harness: location.tool, outcome: 'written', replaced: true, message: `Now uses ${harnesses[chosen].name}'s copy. The replaced copy is kept in Central Knot's store. ${harnesses[location.tool].nextStep}` });
        }
      } else for (const location of active) inSync.add(location.copy.directory);
      delete item.use;
      if (chosen) delete item.keptOwn;
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
      if (chosenLosers.length) { const id = event({ key, item: name, kind: 'chosen', winner: { tool: sourceTool, hash: target }, losers: chosenLosers, orderProved: true, previous: baselineBefore || undefined, ...(choiceWasSynced ? { wasSynced: true } : {}) }); chosenIds.set(key, id); if (chosenNow.has(key)) made.push(id); }
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
        // It reads the folder of a tool this pass keeps in sync (OpenCode reads Claude Code's): the copy there is the one it
        // reads, and one of its own would only be a second. Where that tool is left out of this skill or can't hold it,
        // the reader gets its own.
        const owner = readsFolderOf(context, tool, tools);
        if (owner && syncing.includes(owner) && !entry.facts.cannot[owner]) continue;
        const directory = ownCopyDir(context, tool, entry.facts.name);
        const refused = (sourceSkill && targetFor(tool, directory, sourceSkill).skipped) || await rootProblem(context, tool);
        if (refused) { results.push({ item: name, harness: tool, outcome: 'held', message: refused }); continue; }
        const intent = { harness: tool, directory, hash: tree.hash, created: true, status: 'pending' as const };
        item.copies = [...item.copies.filter(known => known.directory !== directory), intent];
        await save();
        let led: string | undefined;
        try { await mkdir(dirname(directory), { recursive: true }); led = await clearBrokenLink(directory); await placeCopy(context, source.directory, { harness: tool, directory, limits: [] }, tree); }
        catch (error) {
          item.copies = item.copies.filter(known => known !== intent);
          if (error instanceof Error && error.message.startsWith('fault:')) throw error;
          results.push({ item: name, harness: tool, outcome: 'failed', message: `Could not copy to ${harnesses[tool].name}. ${plainError(error)}` });
          continue;
        }
        context.fault?.('after-rename');
        (intent as { status: string }).status = 'written';
        if (newlyManaged.has(key) || rejoined.get(key)?.includes(tool)) { const told = added.get(key) ?? { name, hash: tree.hash, copies: [] }; told.copies.push({ tool, hash: tree.hash }); added.set(key, told); }
        writes++;
        if (resetRoots.has(dirname(directory))) putBack.add(tool);
        results.push({ item: name, harness: tool, outcome: 'written', message: `Written. ${harnesses[tool].nextStep}${led === undefined ? '' : ` It replaced a broken link there${led ? ` (it led to ${led})` : ''}.`}` });
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('fault:')) throw error;
      results.push({ item: name, outcome: 'failed', message: plainError(error) });
    }
  }
  const addedIds = new Map([...added].map(([key, told]) => [key, event({ key, item: told.name, kind: 'added', losers: told.copies, orderProved: true, previous: told.hash, ...(newlyManaged.has(key) ? {} : { rejoined: true }) })]));
  made.push(...addedIds.values());
  // A choice and the copies its own pass added are one change: the choice names them, so its Undo takes out those and no others.
  for (const [key, id] of chosenIds) { const chosen = events.find(entry => entry.id === id)!; if (addedIds.has(key)) chosen.addedId = addedIds.get(key); }
  for (const [key, told] of tookOver) {
    if (told.managedNow && addedIds.has(key)) told.addedId = addedIds.get(key);
    // Every content it took is a loser, so the store keeps it for Undo.
    const losers = [...told.links.map(link => ({ tool: link.tool, hash: link.hash })), ...told.shared.map(copy => ({ tool: sharedReader(context, tools), hash: copy.hash }))];
    const id = event({ key, item: gathered.get(key)?.facts.name ?? key, kind: 'took-over', tookOver: told, losers, orderProved: true, previous: told.placed[0]?.hash ?? told.links.find(link => link.placed)?.placed });
    // One that came with new copies is undone with them (restoring 'added' undoes it too); on its own it is one of the click's entries.
    if (!told.addedId) made.push(id);
  }
  /**
   * Removes the named tools' copies of one skill (Remove), each kept in the store first, as one 'removed' event for Restore.
   * A removal that doesn't happen leaves the copy syncing as before: back in sync, with its sync record, so it never quietly
   * stops updating.
   */
  const removeCopies = async (change: Change, entry: Gathered, item: RecordItem) => {
    const { stoppedSync, records, lastCopies } = taken.get(change.key)!;
    const name = entry.facts.name;
    const removed: HistoryEvent['losers'] = [];
    const keepSyncing = async (tool: HarnessId) => {
      if (!stoppedSync.includes(tool)) return;
      // A copy stays after all, so a skill these removals were to unmanage stays managed.
      if (lastCopies) item.state = 'shared';
      item.off = (item.off ?? []).filter(other => other !== tool);
      item.copies.push(...records.filter(copy => copy.harness === tool));
      await save();
    };
    // One folder is one copy, however many tools read it (the shared folder's): removed once, and every tool that read it counts.
    const removedPaths = new Set<string>();
    const removing = new Set(change.remove ?? []);
    const removedFrom = new Set<HarnessId>();
    // What was removed for a tool besides an ordinary copy (its link), said in its line.
    const how = new Map<HarnessId, string>();
    const linkGone = (tool: HarnessId, linkTo: string) => how.set(tool, ` It was a link to ${linkTo}; only the link was removed.`);
    for (const tool of change.remove ?? []) {
      if (entry.facts.copies[tool]) continue;
      // Its link, or the shared copy it read only there, went with the take-over this change also asked for: that was this
      // Remove. Restore puts the link back, or gives the tool its own copy (the shared one stays the take-over's); neither gets a
      // sync record, since sync wrote neither.
      const gone = removedByTakeOver.get(`${change.key}\0${tool}`);
      if (gone) {
        removed.push({ tool, hash: gone.copy.hash, folder: gone.copy.folder, ...(gone.linkTo !== undefined ? { path: gone.copy.directory, linkTo: gone.linkTo } : {}) });
        removedFrom.add(tool);
        if (gone.linkTo !== undefined) linkGone(tool, gone.linkTo);
        continue;
      }
      // Gone since the page was read: nothing to remove, so that tool syncs as before.
      await keepSyncing(tool);
    }
    // Each tool's copy, and for Delete everywhere the other copies it reads (Copilot's in the shared folder). Links go first, each as
    // a link, so none is left leading to a copy already removed.
    const work = (change.remove ?? []).flatMap(tool => {
      const main = entry.facts.copies[tool];
      return main ? [main, ...(change.everywhere ? entry.facts.extra.filter(extra => extra.tool === tool && !extra.readsFrom) : [])].map(copy => ({ tool, copy, main: copy === main })) : [];
    }).sort((first, second) => Number(first.copy.outside?.kind !== 'link') - Number(second.copy.outside?.kind !== 'link'));
    for (const { tool, copy, main } of work) {
      if (removedPaths.has(copy.directory)) { removedFrom.add(tool); continue; }
      const outside = copy.outside;
      // The shared folder's copy is read by other tools too: removing it for one tool alone would take it from them as well.
      // Delete everywhere takes it from all of them, as its confirming click says.
      const alsoReading = outside?.kind === 'shared' && !change.everywhere ? tools.filter(other => other !== tool && !removing.has(other) && [entry.facts.copies[other], ...entry.facts.extra.filter(extra => extra.tool === other)].some(found => found && sameDir(found.directory, copy.directory))) : [];
      const refusal = copy.writable ? await rootProblem(context, tool)
        : copy.readsFrom ? `${toolName(tool)} reads ${toolName(copy.readsFrom)}’s copy. Disable it in ${toolName(tool)} to stop it loading there, or remove it from ${toolName(copy.readsFrom)}.`
        : alsoReading.length ? `${toolName(tool)} reads it in ${dirname(copy.directory)}, which ${andList(alsoReading.map(toolName))} ${alsoReading.length > 1 ? 'read' : 'reads'} too. Disable it in ${toolName(tool)}, or use Delete everywhere.`
        : outside?.kind === 'link' ? await rootProblem(context, tool)
        : outside ? undefined
        : `${toolName(tool)} reads it at ${copy.directory}, inside a skills folder that is a link or another tool’s folder, so Central Knot does not change it.`;
      if (refusal) { if (main) { await keepSyncing(tool); results.push({ item: name, harness: tool, outcome: 'held', message: refusal }); } continue; }
      try {
        // Kept in the store and on record first (as a removal, so a crash before History still recovers it as one).
        await importRevision(context, change.key, copy.directory, await readTree(copy.directory));
        displace(item, tool, copy.hash, { folder: copy.folder, stoppedSync: stoppedSync.includes(tool) });
        await save();
        // A link goes as a link: what it leads to is never touched by removing it.
        if (outside?.linkTo !== undefined) await unlinkChecked(copy.directory, outside.linkTo); else await removeChecked(context, copy.directory, copy.hash);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('fault:')) throw error;
        if (item.displaced) item.displaced = item.displaced.filter(kept => !(kept.hash === copy.hash && kept.tool === tool));
        if (main) await keepSyncing(tool);
        results.push({ item: name, harness: tool, outcome: errorCode(error) === 'CK_CHANGED' ? 'held' : 'failed', message: errorCode(error) === 'CK_CHANGED' ? `${toolName(tool)}’s copy changed just now, so it was kept.` : `Could not remove ${toolName(tool)}’s copy: ${plainError(error)}` });
        continue;
      }
      writes++;
      removedPaths.add(copy.directory);
      removedFrom.add(tool);
      // Managed: the content last synced to it goes along, so Restore can put its sync record back. Not for a link: sync never writes one.
      const synced = main && outside?.linkTo === undefined ? records.find(record => record.harness === tool)?.hash : undefined;
      removed.push({ tool, hash: copy.hash, folder: copy.folder, ...(synced ? { synced } : {}), ...(outside ? { path: copy.directory } : {}), ...(outside?.linkTo !== undefined ? { linkTo: outside.linkTo } : {}) });
      if (outside?.kind === 'shared') results.push({ item: name, outcome: 'removed', tookOver: 'shared', folder: dirname(copy.directory), message: `Removed the ${outside.linkTo !== undefined ? 'link' : 'copy'} in ${dirname(copy.directory)}, which other apps may read too. Restore it from History.` });
      else if (outside) linkGone(tool, outside.linkTo!);
    }
    for (const tool of (change.remove ?? []).filter(candidate => removedFrom.has(candidate))) {
      // Its own copy is gone; a copy it reads in another tool's folder still loads there, and only Disable stops that.
      const still = entry.reads[tool];
      // And the other way: a tool that read this copy, and got none of its own in this pass, no longer has the skill.
      const lost = tools.filter(other => entry.facts.copies[other]?.readsFrom === tool && !item.copies.some(copy => copy.harness === other && copy.status === 'written'));
      // A copy it still reads in the shared folder (only Remove for one tool leaves that): it still has the skill from there.
      const left = change.everywhere ? undefined : entry.facts.extra.find(extra => extra.tool === tool && !removedPaths.has(extra.directory));
      results.push({ item: name, harness: tool, outcome: 'removed', message: `Removed from ${toolName(tool)}.${how.get(tool) ?? ''} Restore it from History.${still ? ` ${toolName(tool)} still reads ${toolName(still)}’s copy; Disable it in ${toolName(tool)} to stop it loading there.` : ''}${left ? ` ${toolName(tool)} still reads the copy in ${dirname(left.directory)}.` : ''}${lost.length ? ` ${lost.map(toolName).join(' and ')} read this copy, so ${lost.length > 1 ? 'they no longer have' : 'it no longer has'} the skill.` : ''}` });
    }
    // Delete everywhere: a tool not asked about that read only the removed copies (its skills folder is a link to the shared
    // folder) no longer has the skill either, and the result names it with the others.
    if (change.everywhere && removedPaths.size) {
      for (const tool of tools.filter(other => !removing.has(other))) {
        const its = [entry.facts.copies[tool], ...entry.facts.extra.filter(extra => extra.tool === tool)].filter((copy): copy is ToolCopy => !!copy && !copy.readsFrom);
        if (!its.some(copy => removedPaths.has(copy.directory))) continue;
        const left = [];
        for (const copy of its) if (!removedPaths.has(copy.directory) && await exists(copy.directory)) left.push(copy);
        if (left.length) continue;
        results.push({ item: name, harness: tool, outcome: 'removed', message: `Removed from ${toolName(tool)} too: it read the copy in ${dirname([...removedPaths].find(path => its.some(copy => copy.directory === path))!)}. Restore it from History.` });
      }
    }
    if (removed.length) made.push(event({ key: change.key, item: name, kind: 'removed', losers: removed, orderProved: true, stoppedSync: stoppedSync.filter(tool => removed.some(gone => gone.tool === tool)), ...(lastCopies && item.state !== 'shared' ? { unmanaged: true } : {}), ...(change.turnOff ? { turnedOff: true as const } : {}) }));
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
      try { flipped = await setDisabled(context, tool, target, disabled, disabled ? undefined : await overrideBeforeDisable(context, change.key, tool, target)); }
      catch (error) {
        results.push({ item: name, harness: tool, outcome: 'failed', message: `Could not ${disabled ? 'disable' : 'enable'} it in ${toolName(tool)}: ${switchFailure(error)}` });
        continue;
      }
      if (!flipped.changed) continue;
      // The target is kept, so Undo reverses this very entry even if the copy is gone by then.
      switched.push({ tool, disabled, target, ...(flipped.previous ? { before: flipped.previous } : {}) });
      results.push({ item: name, harness: tool, outcome: 'switched', disabled, message: disabled ? `Disabled in ${toolName(tool)}: the copy stays, and ${toolName(tool)} doesn’t load it from its next session.` : `Enabled again in ${toolName(tool)} from its next session.` });
    }
    if (switched.length) made.push(event({ key: change.key, item: name, kind: 'switched', switched, losers: [], orderProved: true }));
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
      await owned();
      // A click with Sync off writes only what it is about: no earlier deletion finishes alongside it.
      if (options.only && !options.only.has(key)) continue;
      // A copy a deletion could not remove is retried while it still holds what it held; changed or gone, it is let go.
      // A folder made again since (a reset or reinstall) holds a new install: the old deletion has no say over it.
      // A skill put back by hand in another tool since is wanted again: the old deletion stops.
      if (deletedNow.has(key)) continue;
      const readded = gathered.get(key)?.locations.some(location => !item.off?.includes(location.tool) && !item.copies.some(copy => sameDir(copy.directory, location.copy.directory)));
      for (const copy of item.copies.filter(entry => entry.status === 'removing')) {
        const elsewhere = !ownRoots(context, copy.harness).some(root => sameDir(dirname(copy.directory), root));
        if (resetRoots.has(dirname(copy.directory)) || readded || elsewhere) { item.copies = item.copies.filter(entry => entry !== copy); continue; }
        try {
          if ((await readTree(copy.directory)).hash === copy.hash) { await removeChecked(context, copy.directory, copy.hash); writes++; results.push({ item: item.name, harness: copy.harness, outcome: 'removed', message: 'Removed now, finishing an earlier deletion.' }); }
          item.copies = item.copies.filter(entry => entry !== copy);
        } catch (error) {
          if (errorCode(error) === 'ENOENT' && await folderExists(dirname(copy.directory))) item.copies = item.copies.filter(entry => entry !== copy);
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
            results.push({ item: item.name, harness: copy.harness, outcome: 'written', message: `Written. ${harnesses[copy.harness].nextStep}` });
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
    const gone = standingDeletion(item);
    event(gone
      ? { key: left.key, item: item.name, kind: 'deleted', winner: { tool: gone.tool, hash: gone.hash }, losers: [{ tool: left.tool, hash: left.hash }], orderProved: false, previous: gone.hash }
      : { key: left.key, item: item.name, kind: 'edit', winner: { tool: left.tool, hash: item.hash }, losers: [{ tool: left.tool, hash: left.hash }], orderProved: false, previous: left.hash });
  }
  await save();
  if (events.length) await saveHistory(context, [...await readHistory(context), ...events]);
  // Now that History names it, displaced content needs no other hold. Content displaced this pass that no event names stays on record.
  let cleared = false;
  for (const [key, item] of Object.entries(record.items)) {
    if (!item.displaced?.length) continue;
    const left = item.displaced.filter(entry => !named(key, entry.hash));
    if (left.length !== item.displaced.length) { cleared = true; if (left.length) item.displaced = left; else delete item.displaced; }
  }
  if (cleared) await save();
  return { results, harnessWrites: writes, notices, settling, made };
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
export async function restoreFromHistory(context: ShareContext, eventId: string, resume = false, how?: RestoreHow): Promise<ApplyResult> {
  try {
    const start = await explicitStart(context, resume);
    if (start.stopped || !start.record) return { stopped: start.stopped, results: [], harnessWrites: 0 };
    const record = start.record;
    const history = await readHistory(context);
    const past = history.find(entry => entry.id === eventId);
    // A take-over made in the same click as these new copies is undone with them: its Undo undoes both.
    const alongside = past?.kind === 'added' ? tookOverWith(history, past) : undefined;
    if (alongside) return await undoTookOver(context, record, history, alongside);
    if (past?.kind === 'added') return await undoAdded(context, record, history, past);
    if (past?.kind === 'took-over') return await undoTookOver(context, record, history, past);
    if (past?.kind === 'switched') return await undoSwitched(context, history, past);
    if (past?.kind === 'removed') return await restoreRemoved(context, record, history, past);
    if (past?.kind === 'chosen' && how && 'narrow' in how) return await undoChoice(context, record, history, past);
    // A chosen loser must be one this event can put back.
    const use = how && 'use' in how ? how.use : undefined;
    const hash = past && (use ? restorableChoices(past).find(entry => entry.hash === use)?.hash : restorableHash(past));
    const item = past && record.items[past.key];
    if (!past || !hash || !item) return { stopped: 'That change can’t be restored.', results: [], harnessWrites: 0 };
    if (past.undoneBy) return { stopped: 'That change was already undone.', results: [], harnessWrites: 0 };
    if (past.kind !== 'deleted' && item.state !== 'shared') return { stopped: `${item.name} was deleted since. Restore the deletion from History instead.`, results: [], harnessWrites: 0 };
    const kept = storedRevision(context, past.key, hash);
    let tree;
    try { tree = await readTree(kept); } catch { return { stopped: 'The kept content is no longer in Central Knot’s store, so it can’t be restored.', results: [], harnessWrites: 0 }; }
    const snapshots = await context.read();
    const tools = managedTools(snapshots, record.tools);
    const results: DestinationResult[] = [];
    let writes = 0;
    let entry = (await gather(context, snapshots, record)).get(past.key);
    // A skill deleted earlier whose name is managed again with other content: restoring the old one would replace the new one.
    if (past.kind === 'deleted' && item.state === 'shared' && item.hash !== hash) return { stopped: `“${item.name}” is managed again with other content. Restoring the old one would replace it; delete or rename the new one first.`, results: [], harnessWrites: 0 };
    // A skill deleted earlier whose name is now taken by a different skill: never overwrite the new one.
    if (item.state !== 'shared') {
      const taken = Object.entries(entry?.facts.copies ?? {}).find(([, copy]) => copy && copy.hash !== tree.hash);
      if (taken) return { stopped: `A different “${item.name}” is in ${harnesses[taken[0] as HarnessId].name} now. Rename or remove it, then restore.`, results: [], harnessWrites: 0 };
    }
    // A deletion that removed the shared copy a tool can have no other of (its skills folder is the shared folder): that copy
    // goes back as it was, so the tool has the skill again; only after the refusals above, so a refused Restore writes nothing.
    // Links and a shared copy a tool could do without stay gone: each tool gets its own copy, as Manage gives it, and the result
    // says so.
    const outsideLost = past.kind === 'deleted' ? past.losers.filter(loser => loser.path) : [];
    if (outsideLost.length) {
      const problems = new Map(await Promise.all(tools.map(async tool => [tool, await rootProblem(context, tool)] as const)));
      const pinned = await pinnedShared(context, tools, problems);
      const inShared = (loser: Loser) => sameDir(dirname(loser.path!), sharedFolder(context));
      const pinnedCopies = pinned ? outsideLost.filter(loser => loser.linkTo === undefined && inShared(loser)) : [];
      for (const loser of pinnedCopies) {
        const put = await putBackExact(context, past.key, item.name, loser);
        if (put.outcome === 'written') writes++;
        results.push({ item: item.name, outcome: put.outcome, folder: dirname(loser.path!), message: put.outcome === 'written' ? `Put the shared copy back in ${dirname(loser.path!)}, the only copy ${toolName(pinned!.tool)} can have.` : put.message });
      }
      const left = outsideLost.filter(loser => !pinnedCopies.includes(loser));
      if (left.length) results.push({ item: item.name, outcome: 'stayed', message: notPutBack(left.filter(loser => !inShared(loser)).length, left.filter(inShared).length) });
      if (writes) entry = (await gather(context, await context.read(), record)).get(past.key);
    }
    const before = item.state === 'shared' ? item.hash : undefined;
    // The intent is on record first: a crash part-way leaves unfinished copies, never what reads as a deletion.
    for (const copy of item.copies) copy.status = 'pending';
    await saveRecord(context.home, record);
    const replaced: { tool: HarnessId; hash: string }[] = [];
    const copies: RecordItem['copies'] = [];
    for (const tool of tools.filter(candidate => !item.off?.includes(candidate))) {
      if (entry?.facts.cannot[tool]) continue;
      // It reads the restored content where Central Knot doesn't write (the shared copy just put back): it has it again.
      const reading = ownCopy(entry, tool);
      if (reading && !reading.writable && reading.hash === tree.hash) { results.push({ item: item.name, harness: tool, outcome: 'written', message: `${toolName(tool)} has it again: it reads the shared copy.` }); continue; }
      const late = await rootProblem(context, tool);
      if (late) { results.push({ item: item.name, harness: tool, outcome: 'held', message: late }); continue; }
      // A tool that reads the folder of one restored here (OpenCode reads Claude Code's) reads the restored copy: none of its own is made.
      const owner = readsFolderOf(context, tool, tools);
      const here = ownCopy(entry, tool);
      if (!here && owner && !item.off?.includes(owner) && !entry?.facts.cannot[owner]) continue;
      if (here) {
        if (!here.writable) { results.push({ item: item.name, harness: tool, outcome: 'held', message: untouched(tool, here, 'reads a copy', item.name) }); continue; }
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
    await saveHistory(context, [...history, { id, at: new Date(clock(context)).toISOString(), key: past.key, item: item.name, kind: 'restored', winner: { tool: replaced[0]?.tool ?? 'claude-cli', hash: tree.hash }, losers: replaced, orderProved: true, previous: before }]);
    if (item.displaced) { item.displaced = item.displaced.filter(entry => !replaced.some(gone => gone.hash === entry.hash)); if (!item.displaced.length) delete item.displaced; await saveRecord(context.home, record); }
    return { results, harnessWrites: writes };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('fault:')) throw error;
    return { stopped: `That could not finish. ${plainError(error)} Click Refresh to see where things stand.`, results: [], harnessWrites: 0 };
  }
}

/**
 * Undo of a change that made new copies: each copy it added goes again, but only while it is exactly what was written (an
 * edit since keeps it), and its content stays in the store. A skill the change made managed is then unmanaged as before; a
 * tool whose copy had to stay keeps syncing, so nothing is left half-managed. One that was managed already (`rejoined`)
 * stays managed and stops syncing to those tools again.
 */
async function undoAdded(context: ShareContext, record: SyncRecord, history: HistoryEvent[], past: HistoryEvent, withChoice = false): Promise<ApplyResult> {
  if (past.undoneBy) return { stopped: 'That change was already undone.', results: [], harnessWrites: 0 };
  const item = record.items[past.key];
  // Taken out with a choice's Undo, it may be finishing one that left the skill not synced already.
  if (!item || (item.state !== 'shared' && !withChoice)) return { stopped: `${past.item} is not managed any more, so there is nothing to undo here.`, results: [], harnessWrites: 0 };
  const entry = (await gather(context, await context.read(), record)).get(past.key);
  const results: DestinationResult[] = [];
  const kept: HarnessId[] = [];
  // A copy that couldn't go, not one edited since: the entry stays open, so History's Undo can take it out later.
  let open = false;
  let writes = 0;
  for (const loser of past.losers) {
    const recorded = item.copies.find(copy => copy.harness === loser.tool && copy.created);
    // Off the record (a choice's Undo that stopped part-way settled the skill), the copy is the one still holding what was added.
    const here = recorded ? entry?.locations.find(location => location.tool === loser.tool && sameDir(location.copy.directory, recorded.directory))
      : withChoice ? entry?.locations.find(location => location.tool === loser.tool && location.copy.hash === loser.hash) : undefined;
    if (!here) { results.push({ item: item.name, harness: loser.tool, outcome: 'stayed', message: `${harnesses[loser.tool].name}'s copy is already gone.` }); continue; }
    if (here.copy.hash !== loser.hash) { kept.push(loser.tool); results.push({ item: item.name, harness: loser.tool, outcome: 'held', message: `${harnesses[loser.tool].name}'s copy was edited since, so it stays.` }); continue; }
    if (!here.copy.writable) { open = true; kept.push(loser.tool); results.push({ item: item.name, harness: loser.tool, outcome: 'held', message: untouched(loser.tool, here.copy, 'reads it', item.name) }); continue; }
    const late = await rootProblem(context, loser.tool);
    if (late) { open = true; kept.push(loser.tool); results.push({ item: item.name, harness: loser.tool, outcome: 'held', message: late }); continue; }
    try {
      await importRevision(context, past.key, here.copy.directory, await readTree(here.copy.directory));
      await removeChecked(context, here.copy.directory, loser.hash);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('fault:')) throw error;
      kept.push(loser.tool);
      if (errorCode(error) !== 'CK_CHANGED') open = true;
      results.push({ item: item.name, harness: loser.tool, outcome: errorCode(error) === 'CK_CHANGED' ? 'held' : 'failed', message: errorCode(error) === 'CK_CHANGED' ? `${harnesses[loser.tool].name}'s copy changed just now, so it stays.` : `Could not remove ${harnesses[loser.tool].name}'s copy: ${plainError(error)}` });
      continue;
    }
    item.copies = item.copies.filter(copy => copy !== recorded);
    writes++;
    results.push({ item: item.name, harness: loser.tool, outcome: 'removed', message: 'Removed the copy it added.' });
  }
  if (!kept.length && !past.rejoined) { item.state = 'dont-share'; delete item.use; item.copies = []; }
  else item.off = [...new Set([...(item.off ?? []), ...past.losers.map(loser => loser.tool).filter(tool => !kept.includes(tool))])];
  await saveRecord(context.home, record);
  if (!open) past.undoneBy = randomUUID();
  await saveHistory(context, history);
  return { results, harnessWrites: writes };
}

/** The take-over that came with a click's new copies, while neither is undone. */
const tookOverWith = (history: HistoryEvent[], added: HistoryEvent) => (added.undoneBy ? undefined : history.find(entry => entry.kind === 'took-over' && !entry.undoneBy && entry.tookOver?.addedId === added.id));

/**
 * Undo of a take-over: the shared copy goes back where it was (as a link, if it was one), each real copy that replaced a link is
 * a link again, and the copies made for tools that read the shared one are removed. All or nothing: if any of those copies was
 * edited since, or something else is where one goes back, nothing is written. When the same click started syncing the
 * skill, its new copies go too and the skill is unmanaged again, as it was.
 */
async function undoTookOver(context: ShareContext, record: SyncRecord, history: HistoryEvent[], past: HistoryEvent): Promise<ApplyResult> {
  const stop = (stopped: string): ApplyResult => ({ stopped, results: [], harnessWrites: 0 });
  const refuse = (why: string, earlier = false): ApplyResult => ({ ...stop(`${why}, so nothing was undone.${earlier ? ' History can still put an earlier version back.' : ''}`), refused: why });
  if (past.undoneBy) return stop('That change was already undone.');
  const told = past.tookOver;
  const item = record.items[past.key];
  if (!told || !item) return stop('That change can’t be undone.');
  const holds = async (path: string): Promise<string | undefined> => { try { return (await readTree(path)).hash; } catch { return undefined; } };
  const free = async (path: string) => { try { await lstat(path); return false; } catch (error) { return errorCode(error) === 'ENOENT'; } };
  // Check everything first.
  for (const copy of told.shared) {
    if (await free(copy.path)) { try { await readTree(storedRevision(context, past.key, copy.hash)); } catch { return stop('The copy that was in the shared folder is no longer in Central Knot’s store, so it can’t be put back.'); } continue; }
    if (await holds(copy.path) !== copy.hash) return refuse(`Something else is at ${copy.path} now`);
  }
  for (const link of told.links) {
    if (await free(link.path)) continue;
    if ((await lstat(link.path)).isSymbolicLink()) { if (await readlink(link.path) === link.linkTo) continue; return refuse(`${link.path} is another link now`); }
    if (!link.placed || await holds(link.path) !== link.placed) return refuse(`${toolName(link.tool)}’s copy of ${past.item} was edited since`, true);
  }
  for (const copy of told.placed) {
    if (!(await free(copy.path)) && await holds(copy.path) !== copy.hash) return refuse(`${toolName(copy.tool)}’s copy of ${past.item} was edited since`, true);
  }
  // The copies the same Manage added go with it: if one was edited since, the skill would stay managed, so nothing is undone.
  const added = told.addedId ? history.find(entry => entry.id === told.addedId && !entry.undoneBy) : undefined;
  for (const loser of added?.losers ?? []) {
    const recorded = item.copies.find(copy => copy.harness === loser.tool && copy.created);
    if (recorded && !(await free(recorded.directory)) && await holds(recorded.directory) !== loser.hash) return refuse(`${toolName(loser.tool)}’s new copy of ${past.item} was edited since`, true);
  }
  const results: DestinationResult[] = [];
  let writes = 0;
  for (const copy of told.shared) {
    if (!(await free(copy.path))) continue;
    await mkdir(dirname(copy.path), { recursive: true });
    if (copy.linkTo !== undefined) await symlink(copy.linkTo, copy.path);
    else { const kept = storedRevision(context, past.key, copy.hash); await placeCopy(context, kept, { harness: sharedReader(context, harnessIds), directory: copy.path, limits: [] }, await readTree(kept)); }
    writes++;
    results.push({ item: past.item, outcome: 'written', tookOver: 'shared', folder: dirname(copy.path), message: `Put the copy back in ${dirname(copy.path)}.` });
  }
  for (const link of told.links) {
    const isLink = !(await free(link.path)) && (await lstat(link.path)).isSymbolicLink();
    if (isLink) continue;
    if (!(await free(link.path))) await removeChecked(context, link.path, link.placed!);
    await symlink(link.linkTo, link.path);
    writes++;
    results.push({ item: past.item, harness: link.tool, outcome: 'written', tookOver: 'link', message: `${toolName(link.tool)}’s skills folder has its link back (to ${link.linkTo}).` });
  }
  for (const copy of told.placed) {
    if (await free(copy.path)) continue;
    await removeChecked(context, copy.path, copy.hash);
    writes++;
    results.push({ item: past.item, harness: copy.tool, outcome: 'removed', tookOver: 'placed', message: `Removed ${toolName(copy.tool)}’s own copy; it reads the one in ${sharedFolder(context)} again.` });
  }
  // The copies Central Knot now follows no longer include these: they are a link or gone again.
  const back = [...told.links.map(link => link.path), ...told.placed.map(copy => copy.path)];
  item.copies = item.copies.filter(copy => !back.some(path => sameDir(path, copy.directory)));
  past.undoneBy = randomUUID();
  // Its added copies go with it only while the skill is managed; unmanaged since, they are ordinary copies now and stay.
  if (added && item.state === 'shared') {
    const removed = await undoAdded(context, record, history, added);
    return { ...removed, results: [...results, ...removed.results], harnessWrites: writes + removed.harnessWrites };
  }
  if (told.managedNow && item.state === 'shared') { item.state = 'dont-share'; delete item.use; item.copies = []; }
  await saveRecord(context.home, record);
  await saveHistory(context, history);
  return { results, harnessWrites: writes };
}

/**
 * Undo of Disable or Enable: each switch entry the event changed goes back (named as it was, so this works even if the copy is
 * gone), a Claude Code override to what it held before. A tool already back as it was needs nothing. A new 'switched' event records
 * what was flipped, and its own Undo flips it again.
 */
async function undoSwitched(context: ShareContext, history: HistoryEvent[], past: HistoryEvent): Promise<ApplyResult> {
  if (past.undoneBy) return { stopped: 'That change was already undone.', results: [], harnessWrites: 0 };
  const results: DestinationResult[] = [];
  const back: SwitchRecord[] = [];
  let pending = false;
  for (const { tool, disabled, before, target } of past.switched ?? []) {
    if (!target) continue;
    let flipped: { changed: boolean; previous?: string };
    try { flipped = await setDisabled(context, tool, target, !disabled, before); }
    catch (error) { pending = true; results.push({ item: past.item, harness: tool, outcome: 'failed', message: `Could not change it in ${toolName(tool)}: ${switchFailure(error)}` }); continue; }
    if (!flipped.changed) { results.push({ item: past.item, harness: tool, outcome: 'stayed', message: `${toolName(tool)} has it ${disabled ? 'enabled' : 'disabled'} already.` }); continue; }
    back.push({ tool, disabled: !disabled, target, ...(flipped.previous ? { before: flipped.previous } : {}) });
    results.push({ item: past.item, harness: tool, outcome: 'switched', disabled: !disabled, message: `${disabled ? 'Enabled' : 'Disabled'} again in ${toolName(tool)}.` });
  }
  if (pending && !back.length) return { stopped: results.find(result => result.outcome === 'failed')!.message, results, harnessWrites: 0 };
  // Done once nothing is left to retry. The new event exists only when something flipped, so "Undo again" always has one to use.
  const id = back.length ? randomUUID() : undefined;
  if (!pending) past.undoneBy = id ?? ALREADY_AS_IT_WAS;
  await saveHistory(context, [...history, ...(id ? [{ id, at: new Date(clock(context)).toISOString(), key: past.key, item: past.item, kind: 'switched' as const, switched: back, losers: [], orderProved: true }] : [])]);
  return { results, harnessWrites: 0 };
}

/**
 * Puts a removed copy outside the tool's own folder, or a link, back exactly where and as it was: the link with its own text, or
 * the copy from the store. Already there counts as back ('stayed'); something else there stays ('held').
 */
async function putBackExact(context: ShareContext, key: string, name: string, loser: Loser): Promise<DestinationResult> {
  const path = loser.path ?? ownCopyDir(context, loser.tool, loser.folder ?? name);
  let there: { link?: string; hash?: string } | undefined;
  try { const info = await lstat(path); there = info.isSymbolicLink() ? { link: await readlink(path) } : { hash: await readTree(path).then(tree => tree.hash, () => undefined) }; } catch { /* free */ }
  if (there && (loser.linkTo !== undefined ? there.link === loser.linkTo : there.hash === loser.hash)) return { item: name, harness: loser.tool, outcome: 'stayed', message: `${path} is back already.` };
  if (there) return { item: name, harness: loser.tool, outcome: 'held', message: `Something else is at ${path} now. It stays.` };
  try {
    await mkdir(dirname(path), { recursive: true });
    if (loser.linkTo !== undefined) await symlink(loser.linkTo, path);
    else { const kept = storedRevision(context, key, loser.hash); await placeCopy(context, kept, { harness: loser.tool, directory: path, limits: [] }, await readTree(kept)); }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('fault:')) throw error;
    return { item: name, harness: loser.tool, outcome: 'failed', message: errorCode(error) === 'ENOENT' ? 'The kept copy is no longer in Central Knot’s store.' : `Could not put ${path} back: ${plainError(error)}` };
  }
  return { item: name, harness: loser.tool, outcome: 'written', message: loser.linkTo !== undefined ? `Put the link back at ${path}.` : `Put the copy back in ${dirname(path)}.` };
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
  // A link or a copy outside the tool's own folder is looked at on every try, and is back only when it is there itself.
  const exact = (loser: Loser) => !!loser.path || loser.linkTo !== undefined;
  const exactBack = new Set<Loser>();
  let writes = 0;
  for (const loser of past.losers.filter(gone => !back.has(gone.tool) || exact(gone))) {
    // A copy outside the tool's own folder, or a link: put back exactly where and as it was.
    if (exact(loser)) {
      const put = await putBackExact(context, past.key, item.name, loser);
      results.push(put);
      if (put.outcome === 'written') writes++;
      if (put.outcome === 'written' || put.outcome === 'stayed') { back.add(loser.tool); exactBack.add(loser); }
      continue;
    }
    if (back.has(loser.tool)) continue;
    // Its own copy: one it reads in another tool's folder is not the copy that was removed.
    const here = ownCopy(entry, loser.tool);
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
  const done = past.losers.every(loser => (exact(loser) ? exactBack.has(loser) : back.has(loser.tool)));
  if (done) {
    const id = randomUUID();
    past.undoneBy = id;
    delete past.restoredTools;
    // Every tool put back is a loser of the restore, so its History row names them all.
    const losers = past.losers.map(({ tool, hash }) => ({ tool, hash }));
    await saveHistory(context, [...history, { id, at: new Date(clock(context)).toISOString(), key: past.key, item: item.name, kind: 'restored', losers, orderProved: true }]);
  } else {
    past.restoredTools = [...back];
    await saveHistory(context, history);
  }
  return { results, harnessWrites: writes };
}

/**
 * A Claude Code override (say "name-only") that 0.4.0-preview.1 recorded only in History, for an Enable to put back: the Skills
 * page's and a profile's alike. Undefined when the store keeps a value for the folder (setDisabled uses that), or the latest
 * Disable on record replaced nothing. A profile turning the skill off counts as a Disable too: it keeps what it replaced in the
 * store, so an older value in History is no longer the one to put back.
 */
export async function overrideBeforeDisable(context: ShareContext, key: string, tool: HarnessId, target: SwitchTarget): Promise<string | undefined> {
  if (tool !== 'claude-cli' || (await readKeptOverrides(context))[target.folder] !== undefined) return undefined;
  let before: string | undefined;
  for (const event of await readHistory(context)) {
    if (event.kind === 'profile' && event.profile?.flips.some(flip => flip.tool === tool && flip.disabled && flip.item === `skill:${key}`)) before = undefined;
    if (event.kind !== 'switched' || event.key !== key) continue;
    for (const entry of event.switched ?? []) if (entry.tool === tool && entry.disabled && entry.target?.folder === target.folder) before = entry.before;
  }
  return before;
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
 * Undo of a copy choice, right after it (choiceundo.ts): each replaced copy goes back in its own tool, the copies the choice's
 * pass added go again (with a take-over made with them), and the skill is synced or not as it was before the choice.
 */
async function undoChoice(context: ShareContext, record: SyncRecord, history: HistoryEvent[], chosen: HistoryEvent): Promise<ApplyResult> {
  const item = record.items[chosen.key];
  // Not synced any more, unless it is a choice whose Undo stopped part-way and is being finished.
  if (!item || (item.state !== 'shared' && !chosen.restoredTools)) return { stopped: `${chosen.item} is not managed any more, so there is nothing to undo here.`, results: [], harnessWrites: 0 };
  const entry = (await gather(context, await context.read(), record)).get(chosen.key);
  const copy = (tool: HarnessId) => entry?.facts.copies[tool];
  const undone = await undoChoiceWith(history, chosen, {
    name: item.name,
    noun: 'copy',
    wrote: tool => copy(tool)?.hash === chosen.winner?.hash,
    cantPutBack: async (tool, own) => {
      if (!copy(tool)!.writable) return untouched(tool, copy(tool)!, `reads ${item.name}`, item.name);
      try { await readTree(storedRevision(context, chosen.key, own)); } catch { return 'The replaced copy is no longer in Central Knot’s store, so it can’t be put back.'; }
      return rootProblem(context, tool);
    },
    addedAsIs: (tool, hash) => !copy(tool) || copy(tool)!.hash === hash,
    takeOutAdded: async added => {
      // A take-over that came with those copies (the copies outside Central Knot's own) goes back with them.
      const alongside = tookOverWith(history, added);
      const out = alongside ? await undoTookOver(context, record, history, alongside) : await undoAdded(context, record, history, added, true);
      return { results: out.results, writes: out.harnessWrites, stopped: out.stopped };
    },
    putBack: async (tool, own) => {
      try { await replaceCopy(context, chosen.key, storedRevision(context, chosen.key, own), copy(tool)!.directory, chosen.winner!.hash); }
      catch (error) { if (error instanceof Error && error.message.startsWith('fault:')) throw error; return plainError(error); }
      await giveFileTime(join(copy(tool)!.directory, 'SKILL.md'), chosen.losers.find(loser => loser.tool === tool)?.editedAt);
      return undefined;
    },
    nextStep: tool => harnesses[tool].nextStep,
    settle: async (synced, back) => {
      delete item.use;
      delete item.keptOwn;
      if (!synced) { item.state = 'dont-share'; item.copies = []; await saveRecord(context.home, record); return; }
      // Synced before, and still: one turned off since a part-way Undo is left as it is.
      if (item.state !== 'shared') { await saveRecord(context.home, record); return; }
      // A Finish undo after the synced content moved on leaves it where the passes since took it.
      if (item.hash === chosen.winner?.hash) item.hash = synced;
      for (const [tool, here] of Object.entries(entry?.facts.copies ?? {}) as [HarnessId, ToolCopy][]) {
        if (here.readsFrom || item.off?.includes(tool)) continue;
        const now = back.get(tool) ?? here.hash;
        // Put back holding the synced content: on record with it. Holding anything else: that tool's own copy, off the record
        // and never adopted as this skill's copy just behind (its content is in the store), so the pass holds for a choice.
        if (now === synced) { if (back.has(tool)) for (const known of item.copies) if (known.harness === tool) Object.assign(known, { hash: synced, status: 'written' }); continue; }
        item.copies = item.copies.filter(known => known.harness !== tool);
        (item.keptOwn ??= {})[tool] = now;
      }
      await saveRecord(context.home, record);
    },
    saveHistory: () => saveHistory(context, history),
  });
  return { results: undone.results, harnessWrites: undone.writes, stopped: undone.stopped };
}

/** What an edit changed, for "See change": the skill's SKILL.md before and after, from Central Knot's store. */
export async function eventChange(context: ShareContext, eventId: string): Promise<{ before: string; after: string } | undefined> {
  const past = (await readHistory(context)).find(entry => entry.id === eventId);
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
    const lost: Loser[] = [];
    const leftover: RecordItem['copies'] = [];
    let writes = 0;
    const own = new Map(item.copies.map(copy => [copy.directory, copy.hash]));
    // Links first: each is removed as a link before the copy it may lead to (the shared one) goes as its own step.
    const order = (location: Location) => (location.copy.outside?.kind === 'link' ? 0 : location.copy.outside ? 1 : 2);
    const candidates = entry.locations.filter(candidate => !item.off?.includes(candidate.tool)).sort((first, second) => order(first) - order(second));
    // One folder is one copy, however many tools read it (the shared folder's): it is removed once, and said once.
    const done = new Set<string>();
    const real = new Map(await Promise.all(candidates.map(async candidate => [candidate.copy.directory, await realpath(candidate.copy.directory).catch(() => candidate.copy.directory)] as const)));
    // Folders removed so far, as they really are: a copy reached through a linked skills folder that was one of them is gone with it.
    const gone = new Set<string>();
    for (const location of candidates) {
      const path = location.copy.directory;
      if (done.has(path) || (!location.copy.outside?.linkTo && gone.has(real.get(path)!))) continue;
      done.add(path);
      const outside = location.copy.outside;
      // Only the skill's own copies: recorded ones, or one identical to its synced content. A different copy that was never synced stays.
      if (!own.has(path) && location.copy.hash !== item.hash) { results.push({ item: item.name, harness: location.tool, outcome: 'held', message: `${harnesses[location.tool].name} has a different “${item.name}” that was never synced. It stays.` }); continue; }
      if (!location.copy.writable && !outside) {
        const why = await rootProblem(context, location.tool);
        results.push({ item: item.name, harness: location.tool, outcome: 'held', message: `${harnesses[location.tool].name} reads a copy at ${path}, inside a skills folder that is a link or another tool’s folder. Central Knot does not change what is in it.${why ? ` ${why}` : ''}` });
        continue;
      }
      const late = outside ? (outside.kind === 'link' ? await rootProblem(context, location.tool) : undefined) : await rootProblem(context, location.tool);
      if (late) { results.push({ item: item.name, harness: location.tool, outcome: 'held', message: late }); continue; }
      // An edit not yet spread is the newest content: Restore prefers it. A copy only behind is an older revision, already kept.
      const newest = location.copy.hash === item.hash || location.copy.hash !== own.get(path);
      try {
        await importRevision(context, key, path, await readTree(path));
        // On record before it goes, so a crash or a failure later in this action never lets it be pruned.
        if (newest) { displace(item, location.tool, location.copy.hash); await saveRecord(context.home, record); }
        // A link goes as a link: what it leads to is never touched by removing it.
        if (outside?.linkTo !== undefined) await unlinkChecked(path, outside.linkTo); else await removeChecked(context, path, location.copy.hash);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('fault:')) throw error;
        if (errorCode(error) === 'CK_CHANGED') { results.push({ item: item.name, harness: location.tool, outcome: 'held', message: `${harnesses[location.tool].name}'s copy changed just now, so it was kept. Use Delete everywhere again to remove it.` }); continue; }
        // A copy outside Central Knot's own is never retried in the background: the person asks again.
        if (outside) { results.push({ item: item.name, harness: location.tool, outcome: 'failed', message: `Could not remove ${path}: ${plainError(error)}` }); continue; }
        // One copy that can't go never stops the rest: it is retried by later passes while it is unchanged.
        leftover.push({ harness: location.tool, directory: path, hash: location.copy.hash, created: false, status: 'removing' });
        results.push({ item: item.name, harness: location.tool, outcome: 'failed', message: `Could not remove ${harnesses[location.tool].name}'s copy yet: ${plainError(error)} Central Knot will try again.` });
        continue;
      }
      writes++;
      // A link or the shared copy says where it was, so Restore can put back the shared copy a tool can have no other of.
      if (newest) lost.push({ tool: location.tool, hash: location.copy.hash, ...(outside ? { path } : {}), ...(outside?.linkTo !== undefined ? { linkTo: outside.linkTo } : {}) });
      if (outside?.linkTo === undefined) gone.add(real.get(path)!);
      results.push({ item: item.name, ...(outside?.kind === 'shared' ? { tookOver: 'shared' as const, folder: dirname(path) } : { harness: location.tool }), ...(outside?.kind === 'link' ? { tookOver: 'link' as const } : {}), outcome: 'removed', message: outside?.kind === 'shared' ? `Removed the ${outside.linkTo !== undefined ? 'link' : 'copy'} in ${dirname(path)}, which other apps may read too. Restore it from History.`
        : outside ? `Removed the link in ${harnesses[location.tool].name}’s skills folder (it led to ${outside.linkTo}); what it led to was not touched. Restore it from History.` : 'Deleted. Restore it from History.' });
    }
    // Nothing went at all: nothing is deleted, and the skill stays as it was, so a later Manage or Delete still finds it.
    if (!writes && !leftover.length) return { stopped: results.find(result => result.outcome !== 'removed')?.message ?? 'Nothing could be removed.', results, harnessWrites: 0 };
    const hash = item.hash || lost[0]?.hash || '';
    item.copies = [...leftover, ...item.copies.filter(copy => copy.status === 'written' && !entry.locations.some(location => location.copy.directory === copy.directory)).map(copy => ({ ...copy, status: 'removing' as const }))];
    item.state = 'dont-share';
    delete item.keptOwn;
    item.deleted = { at: new Date(clock(context)).toISOString(), tool: lost[0]?.tool ?? 'claude-cli', hash };
    await saveRecord(context.home, record);
    // History first, then the hold is dropped: a crash between leaves the hold, never content no one can restore.
    await saveHistory(context, [...await readHistory(context), { id: randomUUID(), at: new Date(clock(context)).toISOString(), key, item: item.name, kind: 'deleted', losers: lost, orderProved: true, previous: hash }]);
    if (item.displaced) { item.displaced = item.displaced.filter(entry => !lost.some(gone => gone.hash === entry.hash) && entry.hash !== hash); if (!item.displaced.length) delete item.displaced; await saveRecord(context.home, record); }
    return { results, harnessWrites: writes };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('fault:')) throw error;
    return { stopped: `That could not finish. ${plainError(error)} Click Refresh to see where things stand.`, results: [], harnessWrites: 0 };
  }
}
