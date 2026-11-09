// A plugin's parts in a tool that can't take the plugin itself (Pi, or Codex and Copilot CLI where their plugin route is
// blocked here): its skills, MCP servers and agents written as ordinary items, through the same writers the Skills, MCP
// and Agents pages use (byte-exact skill copies, each tool's MCP format, each tool's agent format). Values go in as-is.
// What went in is recorded per plugin and tool (plugin-parts.json), so the items say where they came from, can be removed
// together, show when the plugin has changed, and every run can be undone from the content kept in Central Knot's store
// (skills in the Skills store, MCP servers in the MCP store, agent files beside them).
// Nothing is ever overwritten that these parts did not put there, and a part edited or managed since is left alone.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { agentText, fileFor, fromMarkdown, keyOf, readAgentRecord, safeName } from './agents.ts';
import { PLUGIN_ONLY, type PluginFiles } from './catalogdetail.ts';
import { loadProblems, parseSkill } from './discovery.ts';
import { configRoot, harnesses, writeRoot } from './harnesses.ts';
import { removeChecked, replaceCopy } from './manage.ts';
import { cannotHold, editEntry, fromJson, keep as keepServer, kept as keptServer, readMcpRecord, readTool, serverHash, type NeutralServer } from './mcp.ts';
import { partsSummary, partsTools, partWords } from './pluginstatus.ts';
import {
  errorCode, exists, importRevision, itemKey, placeCopy, readRecord, readTree, removeFileChecked, storeDirectory, storeFolder, targetFor, writeAccess, writeDurably, writeFileChecked, type ShareContext,
} from './share.ts';
import type { ActionReport, HarnessId, PartItem, PartPlan, PartsInstall } from './types.ts';
import { toolNames } from './words.ts';

// ---------- Record ----------

const recordPath = (home: string) => join(storeDirectory(home), 'plugin-parts.json');
const runPath = (home: string, run: string) => join(storeDirectory(home), 'plugin-parts-runs', `${run}.json`);
/** Agent files as written, by their bytes' hash (skills and MCP servers are kept in their own pages' stores). */
const agentTextPath = (home: string, hash: string) => join(storeDirectory(home), 'items', 'plugin-parts', 'agent', `${hash}.txt`);

/** One plugin's parts in one tool, as the record keys them. */
export const partsKey = (source: string, plugin: string, tool: HarnessId) => `${source}\u0000${plugin}\u0000${tool}`;
const keyOfInstall = (install: PartsInstall) => partsKey(install.source, install.plugin, install.tool);

export async function readParts(home: string): Promise<PartsInstall[]> {
  try {
    const parsed = JSON.parse(await readFile(recordPath(home), 'utf8'));
    return Array.isArray(parsed?.installs) ? parsed.installs : [];
  } catch { return []; }
}
/** Saves the record with `entry` in place of the plugin and tool `key` names (null: none). */
async function saveEntry(home: string, key: string, entry: PartsInstall | null) {
  const installs = (await readParts(home)).filter(install => keyOfInstall(install) !== key);
  if (entry) installs.push(entry);
  await mkdir(storeDirectory(home), { recursive: true });
  await writeDurably(recordPath(home), `${JSON.stringify({ installs }, null, 2)}\n`);
}

/** What one run changed, so its Undo can move back: the record entry before and after (null: none). */
interface PartsRun { key: string; before: PartsInstall | null; after: PartsInstall | null; undone?: boolean }

// ---------- What a plugin offers a tool ----------

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/** One part that can go in: what it is, and how to save its content into Central Knot's store before it is written. */
interface Ready extends PartItem { store: () => Promise<void> }

/**
 * A server that can't run as a separate item: it needs the plugin's own folder or settings (only Claude Code fills those
 * in), or runs a program or folder named relative to the plugin, which isn't copied (CD §5, Unsupported).
 */
function needsPlugin(raw: Record<string, unknown>): string | undefined {
  if (PLUGIN_ONLY.test(JSON.stringify(raw))) return 'It runs from the plugin’s own folder or settings, which only Claude Code fills in.';
  const relative = (value: unknown) => typeof value === 'string' && /^\.\.?([\\/]|$)/.test(value);
  if (relative(raw.cwd) || relative(raw.command) || (Array.isArray(raw.args) && raw.args.some(relative))) return 'It runs files from the plugin’s own folder, which aren’t copied.';
  return undefined;
}

/**
 * What a plugin's parts are for one tool: each one that can go in (with the hash it has), why each other part can't, and
 * the skills whose files couldn't be read now (an update keeps those as they are rather than reading them as dropped).
 */
async function partsFor(context: ShareContext, files: PluginFiles, tool: HarnessId): Promise<{ ready: Ready[]; plan: PartPlan[]; unread: Set<string> }> {
  const ready: Ready[] = [];
  const plan: PartPlan[] = [];
  const unread = new Set<string>();
  const name = toolNames[tool];
  for (const skill of files.skills) {
    let tree;
    try { tree = await readTree(skill.dir); } catch { unread.add(skill.name); plan.push({ kind: 'skill', name: skill.name, why: 'Its files couldn’t be read.' }); continue; }
    if (tree.held) { plan.push({ kind: 'skill', name: skill.name, why: tree.held }); continue; }
    const content = await readFile(join(skill.dir, 'SKILL.md'), 'utf8').catch(() => '');
    const facts = { ...parseSkill(content, skill.name), ...loadProblems(content, skill.name), folder: skill.name, path: join(skill.dir, 'SKILL.md'), directory: skill.dir, realDirectory: skill.dir, rootLabel: 'plugin', content, status: '' };
    const refused = targetFor(tool, join(writeRoot(harnesses[tool], context.home, context.overrides?.[tool]), skill.name), facts).skipped;
    if (refused) { plan.push({ kind: 'skill', name: skill.name, why: refused }); continue; }
    plan.push({ kind: 'skill', name: skill.name });
    const stored = tree;
    ready.push({ kind: 'skill', name: skill.name, hash: tree.hash, store: () => importRevision(context, itemKey(skill.name), skill.dir, stored) });
  }
  for (const [server, raw] of Object.entries(files.servers).sort(([first], [second]) => first.localeCompare(second))) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { plan.push({ kind: 'mcp', name: server, why: 'It isn’t a server entry.' }); continue; }
    const why = needsPlugin(raw as Record<string, unknown>);
    if (why) { plan.push({ kind: 'mcp', name: server, why }); continue; }
    const neutral = fromJson(server, tool, '', raw as Record<string, unknown>).server;
    const cannot = cannotHold(tool, neutral);
    if (cannot) { plan.push({ kind: 'mcp', name: server, why: cannot }); continue; }
    plan.push({ kind: 'mcp', name: server });
    ready.push({ kind: 'mcp', name: server, hash: serverHash(neutral), store: async () => { await keepServer(context, server, neutral); } });
  }
  for (const agent of files.agents) {
    if (tool === 'pi-cli') { plan.push({ kind: 'agent', name: agent.name, why: 'Pi has no agents.' }); continue; }
    if (!agent.whole) { plan.push({ kind: 'agent', name: agent.name, why: 'Its file is too large to read.' }); continue; }
    if (!safeName(agent.name)) { plan.push({ kind: 'agent', name: agent.name, why: 'Its name can’t be a file name.' }); continue; }
    const parsed = fromMarkdown(agent.name, agent.text);
    if (!parsed) { plan.push({ kind: 'agent', name: agent.name, why: 'Its front matter couldn’t be read.' }); continue; }
    if (tool === 'copilot-cli' && !parsed.description.trim()) { plan.push({ kind: 'agent', name: agent.name, why: `${name} doesn’t offer an agent with no description.` }); continue; }
    let text: string;
    try { text = agentText(tool, parsed); } catch { plan.push({ kind: 'agent', name: agent.name, why: `It can’t be written as a ${name} agent.` }); continue; }
    const fields = Object.keys(parsed.fields);
    plan.push({ kind: 'agent', name: agent.name, limit: fields.length ? `its ${fields.join(', ')} setting${fields.length > 1 ? 's stay' : ' stays'} with the plugin` : undefined });
    const hash = sha(text);
    ready.push({ kind: 'agent', name: agent.name, hash, store: async () => { if (!(await exists(agentTextPath(context.home, hash)))) await writeDurably(agentTextPath(context.home, hash), text); } });
  }
  return { ready, plan, unread };
}

/** The plan for each tool that can take parts, for the plugin's page: which parts would go in, and why each other one wouldn't. */
export async function planParts(context: ShareContext, files: PluginFiles, tools: HarnessId[]): Promise<Partial<Record<HarnessId, PartPlan[]>>> {
  const plans: Partial<Record<HarnessId, PartPlan[]>> = {};
  for (const tool of tools.filter(candidate => partsTools.includes(candidate))) plans[tool] = (await partsFor(context, files, tool)).plan;
  return plans;
}

/**
 * What a plugin's parts are, as content, the same for every tool: compared with the digest recorded at install, it tells
 * that the plugin's parts have changed since. Undefined while some of them can't be read (nothing is claimed either way).
 */
export async function partsDigest(files: PluginFiles): Promise<string | undefined> {
  const digest = createHash('sha256');
  for (const skill of files.skills) {
    try { digest.update(`skill\0${skill.name}\0${(await readTree(skill.dir)).hash}\n`); } catch { return undefined; }
  }
  if (files.serversUnread) return undefined;
  for (const [server, raw] of Object.entries(files.servers).sort(([first], [second]) => first.localeCompare(second))) digest.update(`mcp\0${server}\0${JSON.stringify(raw ?? null)}\n`);
  for (const agent of files.agents) digest.update(`agent\0${agent.name}\0${sha(agent.text)}\n`);
  return digest.digest('hex');
}

// ---------- What a tool holds now ----------

const skillDir = (context: ShareContext, tool: HarnessId, name: string) => join(writeRoot(harnesses[tool], context.home, context.overrides?.[tool]), name);

/**
 * A part as it is in the tool now, read fresh: `seen` is undefined when it isn't there and 'unreadable' when it can't be
 * read. For an MCP entry `seen` covers the tool's own settings on it too (a Codex `enabled = false`, a narrowed Copilot
 * `tools`), so an edit to those counts as an edit; `server` is its neutral hash, which an MCP write is checked against.
 */
async function onDisk(context: ShareContext, tool: HarnessId, item: Pick<PartItem, 'kind' | 'name'>): Promise<{ seen?: string; server?: string }> {
  if (item.kind === 'skill') {
    const dir = skillDir(context, tool, item.name);
    return (await exists(dir)) ? { seen: (await readTree(dir).catch(() => undefined))?.hash ?? 'unreadable' } : {};
  }
  if (item.kind === 'mcp') {
    const read = await readTool(context, tool);
    if (read.problem || read.invalid?.includes(item.name)) return { seen: 'unreadable' };
    const entry = read.entries.find(candidate => candidate.name === item.name);
    return entry ? { seen: sha(JSON.stringify([entry.hash, entry.extras])), server: entry.hash } : {};
  }
  const text = await readFile(fileFor(context, tool, item.name), 'utf8').catch(error => (errorCode(error) === 'ENOENT' ? undefined : null));
  return text === undefined ? {} : { seen: text === null ? 'unreadable' : sha(text) };
}

/** Whether the person manages an item now (sync then owns it), and whether the tool already reads a same-named skill anywhere. */
async function toolHolds(context: ShareContext, tool: HarnessId) {
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

// ---------- Writing ----------

/** Puts one part in from the content kept in the store, over what these parts left there (`replacing`) or where nothing is. */
async function put(context: ShareContext, tool: HarnessId, item: PartItem, replacing: { seen: string; server?: string } | undefined) {
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
    const problem = await editEntry(context, tool, item.name, replacing?.server, server);
    if (problem) throw new Error(problem);
    return;
  }
  const text = await readFile(agentTextPath(context.home, item.hash), 'utf8');
  const file = fileFor(context, tool, item.name);
  const now = replacing ? await readFile(file, 'utf8') : undefined;
  if (replacing && sha(now!) !== replacing.seen) throw Object.assign(new Error('It changed just now.'), { code: 'CK_CHANGED' });
  await writeFileChecked(file, text, now);
}

/** Takes one part out, only while it still is what these parts put there (`was`, as onDisk read it). */
async function take(context: ShareContext, tool: HarnessId, item: PartItem, was: { seen: string; server?: string }) {
  if (item.kind === 'skill') { await removeChecked(context, skillDir(context, tool, item.name), was.seen); return; }
  if (item.kind === 'mcp') { const problem = await editEntry(context, tool, item.name, was.server, undefined); if (problem) throw new Error(problem); return; }
  const file = fileFor(context, tool, item.name);
  const text = await readFile(file, 'utf8');
  if (sha(text) !== was.seen) throw Object.assign(new Error('It changed just now.'), { code: 'CK_CHANGED' });
  await removeFileChecked(file, text);
}

const plainReason = (error: unknown) => (errorCode(error) === 'CK_CHANGED' ? 'it changed just now, so it was left as it is' : error instanceof Error ? error.message.replace(/\.$/, '') : String(error));

/**
 * Moves one tool from the parts it holds (`from`) to the parts wanted (`to`). A part from `from` is replaced or removed only
 * while it still is what was put there (`seen`) and isn't managed; one edited, deleted or managed since is left as it is
 * and no longer counted as a part. A new part goes in only where the tool has nothing of that name. Returns the parts held
 * afterwards, notes on what was left alone, how many writes were made, and how many failed (a failed part keeps its old state).
 */
async function move(context: ShareContext, tool: HarnessId, from: PartItem[], to: PartItem[]): Promise<{ held: PartItem[]; notes: string[]; wrote: number; failed: number }> {
  const holds = await toolHolds(context, tool);
  const held: PartItem[] = [];
  const notes: string[] = [];
  let wrote = 0;
  let failed = 0;
  const same = (first: Pick<PartItem, 'kind' | 'name'>, second: Pick<PartItem, 'kind' | 'name'>) => first.kind === second.kind && first.name.toLowerCase() === second.name.toLowerCase();
  for (const each of [...from, ...to.filter(item => !from.some(old => same(old, item)))]) {
    const old = from.find(item => same(item, each));
    const want = to.find(item => same(item, each));
    const label = `the ${partWords[each.kind][0]} “${each.name}”`;
    const now = await onDisk(context, tool, each);
    try {
      if (old) {
        if (now.seen === undefined) { if (want) notes.push(`Left out ${label}: it was removed from ${toolNames[tool]} after it was installed.`); continue; }
        if (now.seen !== (old.seen ?? old.hash)) { notes.push(`Left ${label} as it is: it was changed after it was installed.`); continue; }
        if (holds.managed(each)) { notes.push(`Left ${label} as it is: it is managed now, so it belongs to its own page.`); continue; }
        if (!want) { await take(context, tool, old, { seen: now.seen, server: now.server }); wrote++; continue; }
        if (want.hash === old.hash) { held.push(old); continue; }
        await put(context, tool, want, { seen: now.seen, server: now.server });
      } else {
        if (!want) continue;
        if (now.seen !== undefined || (each.kind === 'skill' && holds.skillNamed(each.name))) { notes.push(`Left ${label}: ${toolNames[tool]} already has one of that name.`); continue; }
        await put(context, tool, want, undefined);
      }
      wrote++;
      held.push({ kind: want.kind, name: want.name, hash: want.hash, seen: (await onDisk(context, tool, want)).seen });
    } catch (error) {
      failed++;
      notes.push(`Couldn’t change ${label}: ${plainReason(error)}.`);
      if (old) held.push(old);
    }
  }
  return { held, notes, wrote, failed };
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
  const key = partsKey(target.source, target.plugin, tool);
  const before = (await readParts(context.home)).find(install => keyOfInstall(install) === key) ?? null;
  const { ready, plan, unread } = await partsFor(context, files, tool);
  if (!ready.length && !before) return report(tool, 'failed', `Nothing in it can go into ${toolNames[tool]}: ${plan.map(part => part.why).filter(Boolean)[0] ?? 'it has no skills, MCP servers or agents'}`);
  for (const part of ready) await part.store();
  // A part whose source can't be read now stays as it is, never read as dropped by the plugin.
  const unreadable = (before?.items ?? []).filter(item => (item.kind === 'skill' && unread.has(item.name)) || (item.kind === 'mcp' && files.serversUnread));
  const wanted: PartItem[] = [...ready.map(({ kind, name, hash }) => ({ kind, name, hash })), ...unreadable];
  const digest = await partsDigest(files);
  const entry = (items: PartItem[], current: boolean): PartsInstall | null => (items.length
    ? { source: target.source, marketName: target.marketName, plugin: target.plugin, version: current ? target.version : before?.version, tool, at: new Date().toISOString(), digest: (current ? digest : undefined) ?? before?.digest ?? '', items }
    : null);
  // On record first: everything this run may write, so a crash leaves nothing unclaimed.
  await saveEntry(context.home, key, entry([...(before?.items ?? []), ...wanted.filter(item => !before?.items.some(old => old.kind === item.kind && old.name === item.name))], false));
  const moved = await move(context, tool, before?.items ?? [], wanted);
  const after = entry(moved.held, !moved.failed);
  await saveEntry(context.home, key, after);
  const run = await saveRun(context, { key, before, after });
  const skipped = plan.filter(part => part.why).map(part => `${part.name}: ${part.why}`);
  const left = skipped.length ? ` Not installed: ${skipped.join('; ')}` : '';
  const changed = moved.wrote > 0 || before?.version !== after?.version;
  if (moved.failed || !moved.held.length) {
    const what = before && !moved.held.length && !moved.failed ? 'Parts removed: the plugin no longer has any that can go here.' : 'Not every part could be changed.';
    return report(tool, 'failed', `${what} ${moved.notes.join(' ')}${left}`.trim(), { run, changed });
  }
  return report(tool, 'installed', `${before ? 'Parts brought up to date' : 'Parts installed'}: ${partsSummary(moved.held, ', ')}. ${harnesses[tool].nextStep.replace(/^Written\. /, '')}${left}`, { run, changed, notes: moved.notes, updated: !!before });
}

/** Removes a plugin's parts from a tool: each one still as it was installed. Edited or managed parts stay. Undoable. */
export async function removeParts(context: ShareContext, target: Pick<PartsTarget, 'source' | 'plugin' | 'tool'>): Promise<ActionReport> {
  const { tool } = target;
  const access = await writeAccess(context);
  if (!access.allowed) return report(tool, 'failed', access.reason);
  const key = partsKey(target.source, target.plugin, tool);
  const before = (await readParts(context.home)).find(install => keyOfInstall(install) === key);
  if (!before) return report(tool, 'uninstalled', `No parts of it are in ${toolNames[tool]}.`);
  const moved = await move(context, tool, before.items, []);
  const after = moved.held.length ? { ...before, items: moved.held } : null;
  await saveEntry(context.home, key, after);
  const run = await saveRun(context, { key, before, after });
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
  if (past.undone) return report(tool, 'failed', 'That change was already undone.');
  const current = (await readParts(context.home)).find(install => keyOfInstall(install) === past.key) ?? null;
  const moved = await move(context, tool, current?.items ?? [], past.before?.items ?? []);
  const base = past.before ?? current;
  await saveEntry(context.home, past.key, base && moved.held.length ? { ...base, items: moved.held } : null);
  if (moved.failed) return report(tool, 'failed', [`Not everything was undone in ${toolNames[tool]}.`, ...moved.notes].join(' '));
  await writeDurably(runPath(context.home, run), `${JSON.stringify({ ...past, undone: true }, null, 2)}\n`);
  if (!moved.wrote) return report(tool, 'failed', ['Nothing was undone.', ...moved.notes].join(' '));
  const done = past.before ? `Parts put back in ${toolNames[tool]}: ${partsSummary(moved.held, ', ')}.` : `Parts removed from ${toolNames[tool]}.`;
  return report(tool, past.before ? 'installed' : 'uninstalled', done, { changed: true, notes: moved.notes });
}
