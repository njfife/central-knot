// Agents on Central Knot's library: the adapter for one kind. Read library.ts first (the model, and the one rule for an item
// in the library), then librarypass.ts (the pass, the same for every kind, and `Kind`, the contract a kind implements).
// This module is the agents' `Kind` (agentKind) and nothing the pass does itself: where each harness keeps its agents (one
// file per agent in its agents folder), how a file is read and written in each harness's format (agentfiles.ts), a
// harness's own part (the rest of its file: agentstore.ts keepOwn), and why a harness can't take an agent (agentHeld, and
// cannotTake for the page).
// Writes and removals are checked (share.ts), so a save that lands meanwhile is never lost.
//
// Around the pass: applyAgents and restoreAgent run it for agents (the page's clicks through librarypass.ts itemClick);
// agentsView is the Agents page's reading (types.ts LibraryView: lookFor, copiesOf, plan), so a mark says what a pass will
// do; agentsForRepo is what the Git repo's Push sends. Elsewhere: where each thing is kept on disk, agentstore.ts; the
// harnesses' file formats, agentfiles.ts; an agent's row, the clicks its controls send and its words, libraryrow.ts (the
// same row for every kind on the library) with librarykinds.ts; History's sentences and actions for agents,
// historyactions.ts; Convert to skill, agentskill.ts; the Git repo's Push and Pull, gitrepo.ts (agentsForRepo, and Pull
// through applyAgents).
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { agentHash, agentText, agentsFolder, changedFields, fileFor, isAgentTool, keyOf, nameProblem, readAgents, type AgentEntry, type SharedAgent } from './agentfiles.ts';
import { fileTextFor, keepOwn, openLibrary, readVersion, saveLibrary, storeVersion } from './agentstore.ts';
import { agentAction } from './historyactions.ts';
import { listed, plan } from './library.ts';
import type { LibraryItem, Version, VersionChange } from './library.ts';
import { copiesOf, differ, forgetFolders, foundCopies, itemClick, lookFor, restore, runPass, unseenIn, type Disk, type Kind, type Look, type PassOptions, type Wanted } from './librarypass.ts';
import { throughPlugins } from './plugins.ts';
import type { AgentTool } from './presence.ts';
import { errorCode, exists, recoverParked, removeFileChecked, syncGate, writeAccess, writeFileChecked } from './share.ts';
import type { ShareContext } from './share.ts';
import type { Change, HarnessId, LibraryFacts, LibraryView, PassResult, SyncNotice, ThroughPlugin, ToolCopy } from './types.ts';
import { throughPlugin, toolName } from './words.ts';

const iso = (ms: number) => new Date(ms).toISOString();
const nameOf = (tool: HarnessId) => toolName(tool);

// ---------- What the harnesses hold ----------

type ThroughPlugins = Map<HarnessId, Map<string, ThroughPlugin>>;
/** The managed harnesses' agent files now (librarypass.ts Disk), and what each harness's plugins bring, which the page shows. */
interface AgentDisk extends Disk<AgentEntry> { through: ThroughPlugins }
type AgentLook = Look<SharedAgent, AgentEntry, AgentDisk>;

/** Reads each managed harness's agents folder (`managed`: the harnesses that hold agents, agentKind.harnesses). */
async function readDisk(context: ShareContext, managed: HarnessId[]): Promise<AgentDisk> {
  const disk: AgentDisk = {
    byKey: new Map(), unseen: new Map(), locked: new Map(), problems: [], through: await agentsThroughPlugins(context, managed),
    held: (item, tool) => { const why = agentHeld(disk, managed, item, tool); return why ? { why } : undefined; },
  };
  for (const tool of managed as AgentTool[]) {
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
 * Why a harness with no copy can't be given the agent, for an agent's own reasons (Disk.held): a plugin brings the agent
 * there, or its name can't be stored there. Worked out at each look and never stored. A plugin that brings the agent is "has
 * it another way" in the model's terms (library.ts); agents still hold it as can't-take, so nothing they do changes.
 */
function agentHeld(disk: AgentDisk, managed: HarnessId[], item: Wanted, tool: HarnessId): string | undefined {
  const given = disk.through.get(tool)?.get(item.key);
  if (given) return throughPlugin(tool, given, 'agent');
  const why = nameProblem(item.name);
  // Where to rename it: a tool that has it.
  const holder = managed.find(other => disk.byKey.get(item.key)?.[other]);
  return why && `${nameOf(tool)} can’t store this name (${why}). Rename it ${holder ? `in ${nameOf(holder)} ` : ''}to use it there.`;
}
/**
 * Why a harness can't take the agent, as the page says it (rowFacts): agentHeld where it has no copy, else (or then) its agents
 * folder can't be written. A pass reads the same: Disk.held, and the folder's lock, which it adds itself (librarypass.ts
 * copyIn). An edit in a folder that can't be written is still read and taken in; only the writes and removals there wait.
 */
function cannotTake(disk: AgentDisk, managed: HarnessId[], item: Wanted, tool: HarnessId, hasCopy: boolean): string | undefined {
  return (hasCopy ? undefined : agentHeld(disk, managed, item, tool)) ?? disk.locked.get(tool);
}

// ---------- The agents' Kind ----------

/** Agents as a kind of item (librarypass.ts Kind): one file per agent in each harness's agents folder. */
export const agentKind: Kind<SharedAgent, AgentEntry, AgentDisk> = {
  kind: 'agent',
  words: { item: 'agent', copy: 'file', folder: 'agents folder' },
  historyPrefix: 'agent:',
  harnesses: tools => tools.filter(isAgentTool),
  folder: agentsFolder,
  pathOf: (context, tool, name) => fileFor(context, tool as AgentTool, name),
  open: openLibrary,
  save: saveLibrary,
  store: (context, item, hash, agent) => storeVersion(context, item.key, hash, agent),
  readVersion,
  hashOf: agentHash,
  recover: (context, tool) => recoverParked(agentsFolder(context, tool)),
  read: readDisk,
  contentOf: entry => entry.agent,
  // A harness's own part is its whole file: a version writes only the name, description and prompt into it.
  ownOf: entry => entry.text,
  keepOwn,
  write: writeAgent,
  remove: async (context, _item, here) => {
    context.fault?.('before-remove');
    try { await removeFileChecked(here.file, here.text); return 'removed'; }
    catch (error) { return errorCode(error) === 'CK_CHANGED' ? 'changed' : 'failed'; }
  },
  historyAction: agentAction,
};

/**
 * Writes a version into one harness's agents folder: a harness with a file keeps every other byte of it; one without gets
 * back the file it had (the kept own part), or a new one. Keeps what it wrote as that harness's own part.
 */
async function writeAgent(context: ShareContext, item: LibraryItem, harness: HarnessId, here: AgentEntry | undefined, agent: SharedAgent) {
  const tool = harness as AgentTool;
  let text: string;
  try { text = here ? agentText(tool, agent, here.text) : await fileTextFor(context, item, tool, agent); }
  catch { return { stopped: 'This file could not be updated without changing other parts of it.' }; }
  const path = here?.file ?? fileFor(context, tool, item.name);
  context.fault?.('before-rename');
  try { await writeFileChecked(path, text, here?.text); }
  catch (error) { return { stopped: errorCode(error).startsWith('CK_') ? (error as Error).message : `Could not write ${nameOf(tool)}’s copy.` }; }
  await keepOwn(context, item, tool, text);
  return undefined;
}

// ---------- The pass, for agents ----------

/** What Pull brings for one agent (gitrepo.ts): its shared part and the repo's whole file (Claude Code's own part), or its removal. */
export type PulledAgent = { agent: SharedAgent; claudeFile: string } | { removed: true };
type AgentPassOptions = Omit<PassOptions<SharedAgent>, 'pulled'> & { pulled?: Map<string, PulledAgent> };

/** One pass over the agents (librarypass.ts runPass): the page's clicks in `changes` (itemClick), then every agent brought into line. */
export function applyAgents(context: ShareContext, tools: HarnessId[], changes: Change[], options: AgentPassOptions = {}): Promise<PassResult> {
  // The repo's file is Claude Code's own part of the agent.
  const own = (claudeFile: string) => ({ harness: 'claude-cli' as const, text: claudeFile });
  const pulled = options.pulled && new Map([...options.pulled].map(([key, brought]) =>
    [key, 'removed' in brought ? brought : { name: brought.agent.name, content: brought.agent, own: own(brought.claudeFile) }] as const));
  return runPass(agentKind, context, tools, changes.map(itemClick), { ...options, pulled });
}

/** A History entry's action on an agent (librarypass.ts restore; historyactions.ts says which click it is). */
export const restoreAgent = (context: ShareContext, tools: HarnessId[], eventId: string, version?: string) => restore(agentKind, context, tools, eventId, version);

// ---------- For the callers around a pass ----------

/** One version's content, for the Agents page to show: undefined when the store no longer has it. */
export const agentVersion = (context: ShareContext, key: string, hash: string) => readVersion(context, key, hash);

/**
 * The tool choice (toolchoice.ts) lets go of the agents folders of the harnesses it leaves out at once (librarypass.ts
 * forgetFolders), so a harness managed again is told apart whether or not a pass runs before it is back.
 */
export const forgetAgentFolders = (context: ShareContext, managed: readonly HarnessId[]) => forgetFolders(agentKind, context, managed);

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
type ForRepo = { item: LibraryItem; agent?: SharedAgent; claudeFile?: string };
export async function agentsForRepo(context: ShareContext, tools: HarnessId[]): Promise<ForRepo[]> {
  const { look, live } = await lookFor(agentKind, context, tools);
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
 * Each listed version's note (library.ts VersionChange). A copy that gave way is compared with the version written over
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
 * harness, not in the library). `library` gives the page and History each item as the library holds it, deleted ones too.
 */
export async function agentsView(context: ShareContext, tools: HarnessId[], notices: SyncNotice[] = []): Promise<LibraryView> {
  // The page's look applies the guards in memory, as a pass would; it never saves.
  const { look, live, problem } = await lookFor(agentKind, context, tools);
  const { library, managed } = look;
  const keys = [...new Set([...look.disk.byKey.keys(), ...live.map(item => item.key)])].sort((first, second) => first.localeCompare(second));
  const items: LibraryFacts[] = [];
  for (const key of keys) items.push(await rowFacts(look, key, live.find(item => item.key === key)));
  const gate = problem ? { state: 'stopped' as const, reason: problem } : await syncGate(context);
  const problems = problem ? [problem, ...look.disk.problems] : look.disk.problems;
  return { tools: managed, items, library: library.items, access: await writeAccess(context), gate, problems, notices };
}

/**
 * One agent's row: what each managed harness holds and, for an agent in the library, what the next pass does in each
 * (`plan`, from the same reading a pass makes: copiesOf) and why nothing can happen in one (`unseen`, `cannot`). A found
 * agent's row says whether its copies differ, so its switch asks which one to take in.
 */
async function rowFacts(look: AgentLook, key: string, item: LibraryItem | undefined): Promise<LibraryFacts> {
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
  const cannot: LibraryFacts['cannot'] = {}, plugin: NonNullable<LibraryFacts['plugin']> = {}, unseen: NonNullable<LibraryFacts['unseen']> = {};
  for (const tool of look.managed) { const given = look.disk.through.get(tool)?.get(key); if (given && !slot[tool]) plugin[tool] = given; }
  const copiesNow = item ? copiesOf(look, item) : undefined, made = item && copiesNow ? plan(item, copiesNow) : undefined;
  const tombstone = item ? undefined : look.library.items[key];
  for (const tool of look.managed) {
    const copy = copiesNow?.[tool], touched = made?.write.includes(tool) || made?.remove.includes(tool);
    if (copy?.is === 'unseen') unseen[tool] = copy.why;
    // Why it can't take the agent (cannotTake): a held copy says it; so does a copy the plan writes over or removes, and a
    // harness a found agent would go to once taken in.
    // A found agent is asked about as taking it in would leave it: On everywhere.
    const why = copy?.is === 'held' ? copy.why : cannotTake(look.disk, look.managed, item ?? { key, name, on: true, except: [] }, tool, !!slot[tool]);
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
    key, name, description: current?.description ?? '', copies, on: !!item?.on, except: item?.except ?? [], cannot, edited,
    // The copies a harness managed again gives way with are kept before the plan, by the pass (librarypass.ts cameBack): said with it.
    ...(made && item ? { plan: { ...made, keep: [...made.keep, ...(look.givingWay.get(key) ?? [])] }, versionChanges: await changesOf(look.context, item) }
      : { differs: differ(foundCopies(look, key, [])) }),
    ...(Object.keys(plugin).length ? { plugin } : {}), ...(Object.keys(unseen).length ? { unseen } : {}),
  };
}
