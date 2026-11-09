// A plugin's parts in a tool that can't take the plugin itself (Pi, or Codex and Copilot CLI where their plugin route is
// blocked here): its skills, MCP servers and agents written as ordinary items, through the same writers the Skills, MCP
// and Agents pages use (byte-exact skill copies, each tool's MCP format, each tool's agent format). Values go in as-is.
// What went in is recorded per plugin and tool (plugin-parts.json), so the items say where they came from, can be removed
// together, show when the plugin has changed, and every run can be undone from the content kept in Central Knot's store
// (skills in the Skills store, MCP servers in the MCP store, agent files beside them).
// Nothing is ever overwritten that these parts did not put there, and a part edited or managed since is left alone.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { agentText, fileFor, fromMarkdown, keyOf, readAgentRecord, safeName } from './agents.ts';
import { PLUGIN_ONLY, type PluginFiles } from './catalogdetail.ts';
import { loadProblems, parseSkill } from './discovery.ts';
import { configRoot, harnesses, writeRoot } from './harnesses.ts';
import { removeChecked, replaceCopy } from './manage.ts';
import { cannotHold, editEntry, fromJson, keep as keepServer, kept as keptServer, readMcpRecord, readTool, serverHash, type NeutralServer } from './mcp.ts';
import { partsSummary, partsTools, partWords } from './pluginstatus.ts';
import {
  errorCode, exists, importRevision, sha256, itemKey, placeCopy, readRecord, readTree, removeFileChecked, storeDirectory, storeFolder, targetFor, writeAccess, writeDurably, writeFileChecked, type ShareContext,
} from './share.ts';
import type { ActionReport, HarnessId, PartItem, PartPlan, PartsInstall } from './types.ts';
import { sameSource } from './plugins.ts';
import { toolNames } from './words.ts';

// ---------- Record ----------

const recordPath = (home: string) => join(storeDirectory(home), 'plugin-parts.json');
const runPath = (home: string, run: string) => join(storeDirectory(home), 'plugin-parts-runs', `${run}.json`);
/** Agent files as written, by their bytes' hash (skills and MCP servers are kept in their own pages' stores). */
const agentTextPath = (home: string, hash: string) => join(storeDirectory(home), 'items', 'plugin-parts', 'agent', `${hash}.txt`);

/** Which plugin's parts in which tool: the marketplace as added (however its address was spelled), the plugin and the tool. */
type PartsOf = Pick<PartsInstall, 'source' | 'plugin' | 'tool'>;
const isFor = (install: PartsOf, target: PartsOf) => install.plugin === target.plugin && install.tool === target.tool && sameSource(install.source, target.source);

export async function readParts(home: string): Promise<PartsInstall[]> {
  try {
    const parsed = JSON.parse(await readFile(recordPath(home), 'utf8'));
    return Array.isArray(parsed?.installs) ? parsed.installs : [];
  } catch { return []; }
}
/** The record's entry for one plugin's parts in one tool, if it has one. */
const entryFor = async (home: string, target: PartsOf) => (await readParts(home)).find(install => isFor(install, target)) ?? null;
/** Saves the record with `entry` in place of the one for `target` (null: none). */
async function saveEntry(home: string, target: PartsOf, entry: PartsInstall | null) {
  const installs = (await readParts(home)).filter(install => !isFor(install, target));
  if (entry) installs.push(entry);
  await mkdir(storeDirectory(home), { recursive: true });
  await writeDurably(recordPath(home), `${JSON.stringify({ installs }, null, 2)}\n`);
}

/** What one run changed, so its Undo can move back: the record entry before and after (null: none). */
interface PartsRun { target: PartsOf; before: PartsInstall | null; after: PartsInstall | null }

// ---------- What a plugin offers a tool ----------

/**
 * The same part, by each kind's own rule: skill folders ignore case (as macOS and Windows do), agents match as the Agents
 * page keys them, MCP servers are keys in a settings file and match exactly.
 */
const same = (first: Pick<PartItem, 'kind' | 'name'>, second: Pick<PartItem, 'kind' | 'name'>) => first.kind === second.kind
  && (first.kind === 'mcp' ? first.name === second.name : first.kind === 'agent' ? keyOf(first.name) === keyOf(second.name) : first.name.toLowerCase() === second.name.toLowerCase());
/** "its timeout setting stays with the plugin": what a tool can't hold of a part, said once for agents and servers alike. */
const staysBehind = (fields: string[]) => (fields.length ? `its ${fields.join(', ')} setting${fields.length > 1 ? 's stay' : ' stays'} with the plugin` : undefined);

/** One part that can go in: what it is, and how to save its content into Central Knot's store before it is written. */
interface Ready extends PartItem { store: () => Promise<void> }

/**
 * A server that can't run as a separate item: it needs the plugin's own folder or settings (only Claude Code fills those
 * in), or runs a program or folder named relative to the plugin, which isn't copied (CD §5, Unsupported).
 */
async function needsPlugin(raw: Record<string, unknown>, folder: string): Promise<string | undefined> {
  if (PLUGIN_ONLY.test(JSON.stringify(raw))) return 'It runs from the plugin’s own folder or settings, which only Claude Code fills in.';
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
  // Something in the plugin's folder: a path starting ./ or ../, or a relative name that is there. A program on PATH, a
  // package name or a URL is not.
  const inPlugin = async (value: string) => !isAbsolute(value) && (/^\.\.?([\\/]|$)/.test(value) || await exists(join(folder, value)));
  const command = text(raw.command);
  const cwd = text(raw.cwd);
  const args = (Array.isArray(raw.args) ? raw.args.map(text) : []).filter((arg): arg is string => !!arg && !arg.startsWith('-') && !/^[a-z][\w+.-]*:/i.test(arg));
  const relativeCommand = !!command && !isAbsolute(command) && (/[\\/]/.test(command) || await inPlugin(command));
  const pluginArg = (await Promise.all(args.map(inPlugin))).some(Boolean);
  if ((cwd !== undefined && !isAbsolute(cwd)) || relativeCommand || pluginArg) return 'It runs files from the plugin’s own folder, which aren’t copied.';
  return undefined;
}

/**
 * What a plugin's parts are for one tool: each one that can go in (with the hash it has), why each other part can't, and
 * the parts there that can't be read or parsed now, as `kind\0name` (an update keeps those as installed rather than
 * reading them as dropped).
 */
async function partsFor(context: ShareContext, files: PluginFiles, tool: HarnessId): Promise<{ ready: Ready[]; plan: PartPlan[]; unread: Set<string> }> {
  const ready: Ready[] = [];
  const plan: PartPlan[] = [];
  // Parts there in the plugin that can't be read now, as `kind\0name`.
  const unread = new Set<string>([...files.unread.skills.map(skill => `skill\0${skill}`), ...files.unread.agents.map(agent => `agent\0${agent}`)]);
  const name = toolNames[tool];
  for (const skill of files.skills) {
    let tree;
    try { tree = await readTree(skill.dir); } catch { unread.add(`skill\0${skill.name}`); plan.push({ kind: 'skill', name: skill.name, why: 'Its files couldn’t be read.' }); continue; }
    if (tree.held) { plan.push({ kind: 'skill', name: skill.name, why: tree.held }); continue; }
    const content = await readFile(join(skill.dir, 'SKILL.md'), 'utf8').catch(() => '');
    const facts = { ...parseSkill(content, skill.name), ...loadProblems(content, skill.name), folder: skill.name, path: join(skill.dir, 'SKILL.md'), directory: skill.dir, realDirectory: skill.dir, rootLabel: 'plugin', content, status: '' };
    const fit = targetFor(tool, skillDir(context, tool, skill.name), facts);
    if (fit.skipped) { plan.push({ kind: 'skill', name: skill.name, why: fit.skipped }); continue; }
    // What the tool does differently with it (Copilot ignores `paths`, say), in the Skills page's own words.
    const losses = fit.limits.filter(Boolean);
    plan.push({ kind: 'skill', name: skill.name, limit: losses.length ? losses.join(' ').replace(/\.$/, '') : undefined });
    const stored = tree;
    ready.push({ kind: 'skill', name: skill.name, hash: tree.hash, store: () => importRevision(context, itemKey(skill.name), skill.dir, stored) });
  }
  for (const [server, raw] of Object.entries(files.servers).sort(([first], [second]) => first.localeCompare(second))) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { unread.add(`mcp\0${server}`); plan.push({ kind: 'mcp', name: server, why: 'It isn’t a server entry.' }); continue; }
    const why = await needsPlugin(raw as Record<string, unknown>, files.folder);
    if (why) { plan.push({ kind: 'mcp', name: server, why }); continue; }
    const { server: neutral, extras } = fromJson(server, tool, '', raw as Record<string, unknown>);
    const cannot = cannotHold(tool, neutral);
    if (cannot) { plan.push({ kind: 'mcp', name: server, why: cannot }); continue; }
    // Fields beyond the shared ones (a timeout, say) have no recorded form in another tool: said, as an agent's are.
    const own = Object.keys(extras);
    plan.push({ kind: 'mcp', name: server, limit: staysBehind(own) });
    ready.push({ kind: 'mcp', name: server, hash: serverHash(neutral), store: async () => { await keepServer(context, server, neutral); } });
  }
  for (const agent of files.agents) {
    if (tool === 'pi-cli') { plan.push({ kind: 'agent', name: agent.name, why: 'Pi has no agents.' }); continue; }
    if (!agent.whole) { unread.add(`agent\0${agent.name}`); plan.push({ kind: 'agent', name: agent.name, why: 'Its file is too large to read.' }); continue; }
    if (!safeName(agent.name)) { plan.push({ kind: 'agent', name: agent.name, why: 'Its name can’t be a file name.' }); continue; }
    const parsed = fromMarkdown(agent.name, agent.text);
    if (!parsed) { unread.add(`agent\0${agent.name}`); plan.push({ kind: 'agent', name: agent.name, why: 'Its front matter couldn’t be read.' }); continue; }
    if (tool === 'copilot-cli' && !parsed.description.trim()) { plan.push({ kind: 'agent', name: agent.name, why: `${name} doesn’t offer an agent with no description.` }); continue; }
    let text: string;
    try { text = agentText(tool, parsed); } catch { plan.push({ kind: 'agent', name: agent.name, why: `It can’t be written as a ${name} agent.` }); continue; }
    const fields = Object.keys(parsed.fields);
    plan.push({ kind: 'agent', name: agent.name, limit: staysBehind(fields) });
    const hash = sha256(text);
    ready.push({ kind: 'agent', name: agent.name, hash, store: async () => { if (!(await exists(agentTextPath(context.home, hash)))) await writeDurably(agentTextPath(context.home, hash), text); } });
  }
  return { ready, plan, unread };
}

/**
 * The plan for each tool that can take parts, for the plugin's page: which parts would go in, and why each other one
 * wouldn't, including a name the tool already has from elsewhere (`installs`: this plugin's parts already there, which
 * are its own and no clash).
 */
export async function planParts(context: ShareContext, files: PluginFiles, tools: HarnessId[], installs: PartsInstall[]): Promise<Partial<Record<HarnessId, PartPlan[]>>> {
  const plans: Partial<Record<HarnessId, PartPlan[]>> = {};
  for (const tool of tools.filter(candidate => partsTools.includes(candidate))) {
    const ours = installs.find(install => install.tool === tool)?.items ?? [];
    const holds = await namesInUse(context, tool);
    const plan = (await partsFor(context, files, tool)).plan;
    for (const part of plan) {
      if (part.why || ours.some(item => same(item, part))) continue;
      const why = blocker(await onDisk(context, tool, part), holds, part, tool);
      if (why) part.why = `${why[0]!.toUpperCase()}${why.slice(1)}.`;
    }
    plans[tool] = plan;
  }
  return plans;
}

/**
 * What a plugin's parts are for one tool, as content: the parts that can go in there and their hashes. Compared with the
 * digest recorded at install, it tells that something this tool would get has changed (a new agent doesn't make Pi's
 * parts out of date). Undefined while some of them can't be read (nothing is claimed either way).
 */
export async function partsDigest(context: ShareContext, files: PluginFiles, tool: HarnessId): Promise<string | undefined> {
  const { ready, unread } = await partsFor(context, files, tool);
  return digestOf(ready, unread, files);
}
const digestOf = (ready: PartItem[], unread: Set<string>, files: PluginFiles) =>
  (unread.size || files.unread.servers ? undefined : sha256(JSON.stringify(ready.map(({ kind, name, hash }) => [kind, name, hash]))));

// ---------- What a tool holds now ----------

const skillDir = (context: ShareContext, tool: HarnessId, name: string) => join(writeRoot(harnesses[tool], context.home, context.overrides?.[tool]), name);

/**
 * A part as it is in the tool now, read fresh: absent, there but unreadable right now, or there with `seen`, its fingerprint.
 * For an MCP entry `seen` covers the tool's own settings on it too (a Codex `enabled = false`, a narrowed Copilot `tools`),
 * so an edit to those counts as an edit; `neutralHash` is its neutral hash, which an MCP write is checked against.
 */
type OnDisk = { state: 'absent' } | { state: 'unreadable' } | { state: 'there'; seen: string; neutralHash?: string };
async function onDisk(context: ShareContext, tool: HarnessId, item: Pick<PartItem, 'kind' | 'name'>): Promise<OnDisk> {
  if (item.kind === 'skill') {
    const dir = skillDir(context, tool, item.name);
    if (!(await exists(dir))) return { state: 'absent' };
    const tree = await readTree(dir).catch(() => undefined);
    return tree ? { state: 'there', seen: tree.hash } : { state: 'unreadable' };
  }
  if (item.kind === 'mcp') {
    const read = await readTool(context, tool);
    if (read.problem || read.invalid?.includes(item.name)) return { state: 'unreadable' };
    const entry = read.entries.find(candidate => candidate.name === item.name);
    return entry ? { state: 'there', seen: sha256(JSON.stringify([entry.hash, entry.extras])), neutralHash: entry.hash } : { state: 'absent' };
  }
  const text = await readFile(fileFor(context, tool, item.name), 'utf8').catch(error => (errorCode(error) === 'ENOENT' ? undefined : null));
  return text === undefined ? { state: 'absent' } : text === null ? { state: 'unreadable' } : { state: 'there', seen: sha256(text) };
}
type There = Extract<OnDisk, { state: 'there' }>;

/** Names in use around a tool: skill folders in any folder it reads, and items the person manages (sync then owns them). */
async function namesInUse(context: ShareContext, tool: HarnessId) {
  const roots = harnesses[tool].skillRoots(configRoot(harnesses[tool], context.home, context.overrides?.[tool]), context.home).map(root => root.path);
  const skillNames = new Set<string>();
  for (const root of roots) for (const entry of await readdir(root).catch(() => [] as string[])) skillNames.add(entry.toLowerCase());
  const sync = (await readRecord(context.home)).record;
  const mcpRecord = await readMcpRecord(context.home);
  const agentRecord = await readAgentRecord(context.home);
  return {
    skillNamed: (name: string) => skillNames.has(name.toLowerCase()),
    managed(item: Pick<PartItem, 'kind' | 'name'>): boolean {
      if (item.kind === 'skill') return sync?.items[itemKey(item.name)]?.state === 'shared';
      if (item.kind === 'mcp') return mcpRecord.items[item.name]?.state === 'shared';
      return agentRecord.items[keyOf(item.name)]?.state === 'shared';
    },
  };
}

/**
 * Whether a part on disk is still what these parts put there. A part recorded before it was written (a run that stopped
 * halfway) has no `seen` yet: then its content hash decides, which for an MCP entry is the neutral hash.
 */
const stillOurs = (old: PartItem, now: There) =>
  (old.seen ? now.seen === old.seen : old.kind === 'mcp' ? now.neutralHash === old.hash : now.seen === old.hash);

/**
 * Why a new part can't go in, if it can't, the same for the page's plan and for a run: its place can't be read right now,
 * the tool already has one of that name (here or in another folder it reads), or one of that name is managed, so its own
 * page decides where it goes and it is never claimed as a part.
 */
function blocker(now: OnDisk, holds: Awaited<ReturnType<typeof namesInUse>>, part: Pick<PartItem, 'kind' | 'name'>, tool: HarnessId): string | undefined {
  if (now.state === 'unreadable') return `its place in ${toolNames[tool]} can’t be read right now`;
  if (now.state === 'there' || (part.kind === 'skill' && holds.skillNamed(part.name))) return `${toolNames[tool]} already has one of that name`;
  if (holds.managed(part)) return 'one of that name is managed, so its own page decides where it goes';
  return undefined;
}

// ---------- Writing ----------

/** Puts one part in from the content kept in the store, over what these parts left there (`replacing`) or where nothing is. */
async function put(context: ShareContext, tool: HarnessId, item: PartItem, replacing: There | undefined) {
  if (item.kind === 'skill') {
    const source = join(storeDirectory(context.home), 'items', storeFolder(itemKey(item.name)), item.hash);
    if (!(await exists(source))) throw new Error('its kept copy is no longer in Central Knot’s store');
    const target = skillDir(context, tool, item.name);
    if (replacing) { await replaceCopy(context, itemKey(item.name), source, target, replacing.seen); return; }
    await mkdir(join(target, '..'), { recursive: true });
    await placeCopy(context, source, { harness: tool, directory: target, limits: [] }, await readTree(source));
    return;
  }
  if (item.kind === 'mcp') {
    const server = (await keptServer(context, item.name, item.hash))?.server as NeutralServer | undefined;
    if (!server) throw new Error('its kept copy is no longer in Central Knot’s store');
    // No extras given: an entry being replaced keeps the tool's own settings on it, and a new one gets the tool's defaults.
    const problem = await editEntry(context, tool, item.name, replacing?.neutralHash, server);
    if (problem) throw new Error(problem);
    return;
  }
  const text = await readFile(agentTextPath(context.home, item.hash), 'utf8');
  const file = fileFor(context, tool, item.name);
  const now = replacing ? await readFile(file, 'utf8') : undefined;
  if (replacing && sha256(now!) !== replacing.seen) throw Object.assign(new Error('It changed just now.'), { code: 'CK_CHANGED' });
  await writeFileChecked(file, text, now);
}

/** Takes one part out, only while it still is what these parts put there (`was`, as onDisk read it). */
async function take(context: ShareContext, tool: HarnessId, item: PartItem, was: There) {
  if (item.kind === 'skill') { await removeChecked(context, skillDir(context, tool, item.name), was.seen); return; }
  if (item.kind === 'mcp') { const problem = await editEntry(context, tool, item.name, was.neutralHash, undefined); if (problem) throw new Error(problem); return; }
  const file = fileFor(context, tool, item.name);
  const text = await readFile(file, 'utf8');
  if (sha256(text) !== was.seen) throw Object.assign(new Error('It changed just now.'), { code: 'CK_CHANGED' });
  await removeFileChecked(file, text);
}

const plainReason = (error: unknown) => (errorCode(error) === 'CK_CHANGED' ? 'it changed just now, so it was left as it is' : error instanceof Error ? error.message.replace(/\.$/, '') : String(error));

/**
 * Moves one tool from the parts it holds (`from`) to the parts wanted (`to`). A part from `from` is replaced or removed only
 * while it still is what was put there (`seen`) and isn't managed; one edited or managed since is left as it is and no
 * longer counted as a part. One the person removed stays out (`removed` on record, so later updates leave it out too). A
 * new part goes in only where the tool has nothing of that name and no item of that name is managed. Returns the parts
 * held afterwards, notes on what was left alone, how many writes were made, and how many failed (each keeps its old state).
 */
async function move(context: ShareContext, tool: HarnessId, from: PartItem[], to: PartItem[]): Promise<{ held: PartItem[]; notes: string[]; wrote: number; failed: number }> {
  const holds = await namesInUse(context, tool);
  const held: PartItem[] = [];
  const notes: string[] = [];
  let wrote = 0;
  let failed = 0;
  for (const each of [...from, ...to.filter(item => !from.some(old => same(old, item)))]) {
    const old = from.find(item => same(item, each));
    const listed = to.find(item => same(item, each));
    const label = `the ${partWords[each.kind][0]} “${each.name}”`;
    const now = await onDisk(context, tool, each);
    // Can't be read right now (a settings file with a syntax error): nothing is changed, and a part keeps its place on record.
    if (now.state === 'unreadable') { failed++; notes.push(`Couldn’t change ${label}: it can’t be read in ${toolNames[tool]} right now.`); if (old) held.push(old); continue; }
    // Removed by the person: it stays out while the plugin still has it, and is forgotten once the plugin drops it.
    if (old?.removed || listed?.removed) { if (listed && now.state === 'absent') held.push({ ...listed, removed: true }); continue; }
    const want = listed;
    try {
      // Claimed by a run that stopped before writing it: not the person's removal, so it is written now.
      const claimedOnly = old && !old.seen && now.state === 'absent';
      if (old && !claimedOnly) {
        if (now.state === 'absent') { if (want) { notes.push(`Left out ${label}: it was removed from ${toolNames[tool]} after it was installed.`); held.push({ ...want, removed: true }); } continue; }
        if (!stillOurs(old, now)) { notes.push(`Left ${label} as it is: it was changed after it was installed.`); continue; }
        if (holds.managed(each)) { notes.push(`Left ${label} as it is: it is managed now, so it belongs to its own page.`); continue; }
        if (!want) { await take(context, tool, old, now); wrote++; continue; }
        if (want.hash === old.hash) { held.push(old); continue; }
        await put(context, tool, want, now);
      } else {
        if (!want) continue;
        const why = blocker(now, holds, each, tool);
        if (why) { notes.push(`Left ${label}: ${why}.`); continue; }
        await put(context, tool, want, undefined);
      }
      wrote++;
      const written = await onDisk(context, tool, want);
      held.push({ kind: want.kind, name: want.name, hash: want.hash, ...(written.state === 'there' ? { seen: written.seen } : {}) });
    } catch (error) {
      failed++;
      notes.push(`Couldn’t change ${label}: ${plainReason(error)}.`);
      if (old) held.push(old);
    }
  }
  // Nothing of the parts left but what the person removed: no parts here any more.
  return { held: held.some(item => !item.removed) ? held : [], notes, wrote, failed };
}

// ---------- Runs ----------

export interface PartsTarget { source: string; marketName: string; plugin: string; version?: string; tool: HarnessId }

/** Keeps what one run changed so its Undo can move back, and returns the run's name. */
async function saveRun(context: ShareContext, run: PartsRun): Promise<string> {
  const name = randomUUID();
  await writeDurably(runPath(context.home, name), `${JSON.stringify(run, null, 2)}\n`);
  return name;
}

const report = (tool: HarnessId, outcome: ActionReport['outcome'], message: string, more: { run?: string; changed?: boolean; notes?: string[]; updated?: boolean } = {}): ActionReport =>
  ({ tool, outcome, message, runs: [], parts: true, changed: !!more.changed, ...(more.run ? { partsRun: more.run } : {}), ...(more.notes?.length ? { notes: more.notes } : {}), ...(more.updated ? { partsUpdated: true } : {}) });

/**
 * Installs a plugin's parts in a tool, or brings them up to date: unchanged parts are replaced, new ones added, ones the
 * plugin dropped removed. Edited, deleted or managed parts stay as they are; a part whose source can't be read now keeps
 * its installed copy. The record names every part before anything is written, so a run that stops halfway still owns
 * what it wrote. A run with failures keeps the old version and digest, so the plugin still shows as changed. Undoable.
 */
export async function installParts(context: ShareContext, target: PartsTarget, files: PluginFiles): Promise<ActionReport> {
  const { tool } = target;
  if (!partsTools.includes(tool)) return report(tool, 'failed', `${toolNames[tool]} takes the plugin itself.`);
  const access = await writeAccess(context);
  if (!access.allowed) return report(tool, 'failed', access.reason);
  const before = await entryFor(context.home, target);
  const { ready, plan, unread } = await partsFor(context, files, tool);
  if (!ready.length && !before) return report(tool, 'failed', `Nothing in it can go into ${toolNames[tool]}: ${plan.map(part => part.why).filter(Boolean)[0] ?? 'it has no skills, MCP servers or agents'}`);
  for (const part of ready) await part.store();
  // A part whose source can't be read now stays as it is, never read as dropped by the plugin.
  const unreadable = (before?.items ?? []).filter(item => unread.has(`${item.kind}\0${item.name}`) || unread.has(`${item.kind}\0*`) || (item.kind === 'mcp' && files.unread.servers));
  const wanted: PartItem[] = [...ready.map(({ kind, name, hash }) => ({ kind, name, hash })), ...unreadable];
  const digest = digestOf(ready, unread, files);
  const record = (items: PartItem[], version: string | undefined, contentDigest: string): PartsInstall | null => (items.length
    ? { source: target.source, marketName: target.marketName, plugin: target.plugin, version, tool, at: new Date().toISOString(), digest: contentDigest, items }
    : null);
  const previous = { version: before?.version, digest: before?.digest ?? '' };
  // Claimed first: every part this run may write is on record (as the plugin was), so a run that stops halfway still owns it.
  const claimed = [...(before?.items ?? []), ...wanted.filter(item => !before?.items.some(old => same(old, item)))];
  await saveEntry(context.home, target, record(claimed, previous.version, previous.digest));
  const moved = await move(context, tool, before?.items ?? [], wanted);
  // Settled: what is there now. With failures it keeps the plugin's old version and digest, so it still shows as changed.
  const after = moved.failed ? record(moved.held, previous.version, previous.digest) : record(moved.held, target.version, digest ?? previous.digest);
  await saveEntry(context.home, target, after);
  const changed = moved.wrote > 0 || before?.version !== after?.version;
  const run = changed ? await saveRun(context, { target, before, after }) : undefined;
  const skipped = plan.filter(part => part.why).map(part => `${part.name}: ${part.why}`);
  const left = skipped.length ? ` Not installed: ${skipped.join('; ')}` : '';
  if (moved.failed) return report(tool, 'failed', `Not every part could be changed. ${moved.notes.join(' ')}${left}`.trim(), { run, changed });
  // Nothing went in where nothing was before (each name taken already): a failure to read, not "parts removed".
  if (!moved.held.length && !before) return report(tool, 'failed', `Nothing was installed. ${moved.notes.join(' ')}${left}`.trim(), { run, changed });
  if (!moved.held.length) return report(tool, 'uninstalled', `Parts removed: the plugin no longer has any that can go into ${toolNames[tool]}.${left}`, { run, changed, notes: moved.notes });
  return report(tool, 'installed', `${before ? 'Parts brought up to date' : 'Parts installed'}: ${partsSummary(moved.held.filter(item => !item.removed), ', ')}. ${harnesses[tool].nextStep.replace(/^Written\. /, '')}${left}`, { run, changed, notes: moved.notes, updated: !!before });
}

/** Removes a plugin's parts from a tool: each one still as it was installed. Edited or managed parts stay. Undoable. */
export async function removeParts(context: ShareContext, target: Pick<PartsTarget, 'source' | 'plugin' | 'tool'>): Promise<ActionReport> {
  const { tool } = target;
  const access = await writeAccess(context);
  if (!access.allowed) return report(tool, 'failed', access.reason);
  const before = await entryFor(context.home, target);
  if (!before) return report(tool, 'uninstalled', `No parts of it are in ${toolNames[tool]}.`);
  const moved = await move(context, tool, before.items, []);
  const after = moved.held.length ? { ...before, items: moved.held } : null;
  await saveEntry(context.home, target, after);
  const run = moved.wrote ? await saveRun(context, { target, before, after }) : undefined;
  if (moved.failed) return report(tool, 'failed', [`Not every part could be removed from ${toolNames[tool]}.`, ...moved.notes].join(' '), { run, changed: moved.wrote > 0 });
  return report(tool, 'uninstalled', `Parts removed from ${toolNames[tool]}.`, { run, changed: moved.wrote > 0, notes: moved.notes });
}

/**
 * Undoes one parts run: the tool goes back to the parts it held before, from the content kept in the store. The record
 * keeps whatever is still there afterwards; an Undo with failures stays undoable, so it can be tried again.
 */
export async function undoParts(context: ShareContext, run: string): Promise<ActionReport | undefined> {
  if (!/^[0-9a-f-]{36}$/.test(run)) return undefined;
  let past: PartsRun;
  try { past = JSON.parse(await readFile(runPath(context.home, run), 'utf8')); } catch { return undefined; }
  const tool = (past.before ?? past.after)?.tool;
  if (!tool) return undefined;
  const access = await writeAccess(context);
  if (!access.allowed) return report(tool, 'failed', access.reason);
  const current = await entryFor(context.home, past.target);
  const moved = await move(context, tool, current?.items ?? [], past.before?.items ?? []);
  const base = past.before ?? current;
  await saveEntry(context.home, past.target, base && moved.held.length ? { ...base, items: moved.held } : null);
  if (moved.failed) return report(tool, 'failed', [`Not everything was undone in ${toolNames[tool]}.`, ...moved.notes].join(' '));
  await rm(runPath(context.home, run), { force: true });
  // Nothing left to undo (every part was edited or removed since, or only the version changed): done, so it isn't offered again.
  if (!moved.wrote) {
    let message = 'Nothing was left to undo.';
    if (past.before?.version !== past.after?.version) message = `Its record is back to ${past.before?.version ? `version ${past.before.version}` : 'how it was'}; no file needed changing.`;
    return report(tool, past.before ? 'installed' : 'uninstalled', message, { notes: moved.notes });
  }
  const done = past.before ? `Parts put back in ${toolNames[tool]}: ${partsSummary(moved.held.filter(item => !item.removed), ', ')}.` : `Parts removed from ${toolNames[tool]}.`;
  return report(tool, past.before ? 'installed' : 'uninstalled', done, { changed: true, notes: moved.notes });
}
