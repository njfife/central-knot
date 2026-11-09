// A plugin's parts in a tool that can't take the plugin itself (Pi, or Codex and Copilot CLI where their plugin route is
// blocked here): its skills, MCP servers and agents written as ordinary items, through the same writers the Skills, MCP
// and Agents pages use (byte-exact skill copies, each tool's MCP format, each tool's agent format). Values go in as-is.
// What went in is recorded per plugin and tool (plugin-parts.json), so the items say where they came from, can be removed
// together, show when the plugin's parts have changed, and every run can be undone from the content kept in the store.
// Nothing is ever overwritten that these parts did not put there, and a part edited or managed since is left alone.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { readAgentRecord, readAgents, agentText, fileFor, fromMarkdown, safeName } from './agents.ts';
import type { PluginFiles } from './catalogdetail.ts';
import { codexProblem, copilotProblem, parseSkill, piProblem } from './discovery.ts';
import { configRoot, harnesses, writeRoot } from './harnesses.ts';
import { removeChecked, replaceCopy } from './manage.ts';
import { cannotHold, editEntry, fromJson, readMcpRecord, readTool, serverHash, type NeutralServer } from './mcp.ts';
import {
  copyTree, errorCode, exists, itemKey, placeCopy, readRecord, readTree, removeFileChecked, storeDirectory, targetFor, writeAccess, writeDurably, writeFileChecked, type ShareContext,
} from './share.ts';
import type { ActionReport, HarnessId, PartItem, PartKind, PartsInstall, PartPlan, Skill } from './types.ts';
import { partsTools } from './pluginstatus.ts';
import { toolNames } from './words.ts';

export { partsTools } from './pluginstatus.ts';

// ---------- Record and kept content ----------

const recordPath = (home: string) => join(storeDirectory(home), 'plugin-parts.json');
const runPath = (home: string, run: string) => join(storeDirectory(home), 'plugin-parts-runs', `${run}.json`);
const keptPath = (home: string, kind: PartKind, hash: string) => join(storeDirectory(home), 'items', 'plugin-parts', kind, hash);

/** One plugin's parts in one tool, as the record keys them. */
export const partsKey = (source: string, plugin: string, tool: HarnessId) => `${source}\u0000${plugin}\u0000${tool}`;

export async function readParts(home: string): Promise<PartsInstall[]> {
  try {
    const parsed = JSON.parse(await readFile(recordPath(home), 'utf8'));
    return Array.isArray(parsed?.installs) ? parsed.installs : [];
  } catch { return []; }
}
const saveParts = async (home: string, installs: PartsInstall[]) => {
  await mkdir(storeDirectory(home), { recursive: true });
  await writeDurably(recordPath(home), `${JSON.stringify({ installs }, null, 2)}\n`);
};

/** What one run changed, so its Undo can move back: the record entry before and after (null: none). */
interface PartsRun { key: string; before: PartsInstall | null; after: PartsInstall | null; undone?: boolean }

// ---------- What a plugin offers a tool ----------

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
/** Needs the plugin's own folder or install-time settings, which only Claude Code fills in (TRN-01, Unsupported). */
const PLUGIN_ONLY = /\$\{(CLAUDE_PLUGIN_ROOT|user_config\.)/;

/** One part ready to go in: its kind, name, the hash it will have in the tool, and how to put it there. */
interface Ready extends PartItem { label: string; limit?: string; keep: () => Promise<void> }

/** A Skill as the Skills page reads one, for the same loadability rules (share.targetFor). */
function skillFacts(folder: string, directory: string, content: string): Skill {
  const parsed = parseSkill(content, folder);
  return {
    ...parsed, folder, path: join(directory, 'SKILL.md'), directory, realDirectory: directory, rootLabel: 'plugin', content, status: '',
    copilotProblem: copilotProblem(content, folder), codexProblem: codexProblem(content, folder), piProblem: piProblem(content),
  };
}

/**
 * What a plugin's parts are for one tool: each one that can go in (with the hash it will have there), and why each other
 * part can't. `digest` identifies the parts' content, so a later read can tell the plugin's parts have changed.
 */
async function partsFor(context: ShareContext, files: PluginFiles, tool: HarnessId): Promise<{ ready: Ready[]; plan: PartPlan[]; digest: string }> {
  const ready: Ready[] = [];
  const plan: PartPlan[] = [];
  const digest = createHash('sha256');
  const name = toolNames[tool];
  for (const skill of files.skills) {
    let tree;
    try { tree = await readTree(skill.dir); } catch { plan.push({ kind: 'skill', name: skill.name, why: 'Its files couldn’t be read.' }); continue; }
    digest.update(`skill\0${skill.name}\0${tree.hash}\n`);
    if (tree.held) { plan.push({ kind: 'skill', name: skill.name, why: tree.held }); continue; }
    const content = await readFile(join(skill.dir, 'SKILL.md'), 'utf8').catch(() => '');
    const refused = targetFor(tool, join(writeRoot(harnesses[tool], context.home, context.overrides?.[tool]), skill.name), skillFacts(skill.name, skill.dir, content)).skipped;
    if (refused) { plan.push({ kind: 'skill', name: skill.name, why: refused }); continue; }
    const hash = tree.hash;
    plan.push({ kind: 'skill', name: skill.name });
    ready.push({ kind: 'skill', name: skill.name, hash, label: skill.name, keep: async () => {
      const target = keptPath(context.home, 'skill', hash);
      if (await exists(target)) return;
      await mkdir(join(target, '..'), { recursive: true });
      const stage = `${target}.${randomUUID()}.tmp`;
      await copyTree(skill.dir, stage, tree);
      await rename(stage, target).catch(async error => { if (!(await exists(target))) throw error; });
    } });
  }
  for (const [server, raw] of Object.entries(files.servers).sort(([first], [second]) => first.localeCompare(second))) {
    const text = JSON.stringify(raw ?? null);
    digest.update(`mcp\0${server}\0${text}\n`);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { plan.push({ kind: 'mcp', name: server, why: 'It isn’t a server entry.' }); continue; }
    if (PLUGIN_ONLY.test(text)) { plan.push({ kind: 'mcp', name: server, why: 'It runs from the plugin’s own folder or settings, which only Claude Code fills in.' }); continue; }
    const neutral = fromJson(server, tool, '', raw as Record<string, unknown>).server;
    const cannot = cannotHold(tool, neutral);
    if (cannot) { plan.push({ kind: 'mcp', name: server, why: cannot }); continue; }
    const hash = serverHash(neutral);
    plan.push({ kind: 'mcp', name: server });
    ready.push({ kind: 'mcp', name: server, hash, label: server, keep: () => keepServer(context, hash, neutral) });
  }
  for (const agent of files.agents) {
    digest.update(`agent\0${agent.name}\0${sha(agent.text)}\n`);
    if (tool === 'pi-cli') { plan.push({ kind: 'agent', name: agent.name, why: 'Pi has no agents.' }); continue; }
    if (!agent.whole) { plan.push({ kind: 'agent', name: agent.name, why: 'Its file is too large to read.' }); continue; }
    if (!safeName(agent.name)) { plan.push({ kind: 'agent', name: agent.name, why: 'Its name can’t be a file name.' }); continue; }
    const parsed = fromMarkdown(agent.name, agent.text);
    if (!parsed) { plan.push({ kind: 'agent', name: agent.name, why: 'Its front matter couldn’t be read.' }); continue; }
    if (tool === 'copilot-cli' && !parsed.description.trim()) { plan.push({ kind: 'agent', name: agent.name, why: `${name} doesn’t offer an agent with no description.` }); continue; }
    let text: string;
    try { text = agentText(tool, parsed); } catch { plan.push({ kind: 'agent', name: agent.name, why: `It can’t be written as a ${name} agent.` }); continue; }
    const fields = Object.keys(parsed.fields);
    const limit = fields.length ? `its ${fields.join(', ')} setting${fields.length > 1 ? 's' : ''} stay${fields.length > 1 ? '' : 's'} with the plugin` : undefined;
    const hash = sha(text);
    plan.push({ kind: 'agent', name: agent.name, limit });
    ready.push({ kind: 'agent', name: agent.name, hash, label: agent.name, limit, keep: () => keepText(context, hash, text) });
  }
  return { ready, plan, digest: digest.digest('hex') };
}

async function keepServer(context: ShareContext, hash: string, server: NeutralServer) {
  const path = `${keptPath(context.home, 'mcp', hash)}.json`;
  if (!(await exists(path))) await writeDurably(path, `${JSON.stringify(server, null, 2)}\n`);
}
async function keepText(context: ShareContext, hash: string, text: string) {
  const path = `${keptPath(context.home, 'agent', hash)}.txt`;
  if (!(await exists(path))) await writeDurably(path, text);
}

/** The plan for each tool, for the plugin's page: which parts would go in, and why each other one wouldn't. */
export async function planParts(context: ShareContext, files: PluginFiles, tools: HarnessId[]): Promise<Partial<Record<HarnessId, PartPlan[]>>> {
  const plans: Partial<Record<HarnessId, PartPlan[]>> = {};
  for (const tool of tools.filter(candidate => partsTools.includes(candidate))) plans[tool] = (await partsFor(context, files, tool)).plan;
  return plans;
}

/** The digest of a plugin's parts for a tool now, to compare with what was installed (an update shows as out of date). */
export const partsDigest = async (context: ShareContext, files: PluginFiles, tool: HarnessId) => (await partsFor(context, files, tool)).digest;

// ---------- What a tool holds now ----------

/** Each part's current hash in the tool (undefined: not there), and whether it is managed (sync then owns it). */
async function lookup(context: ShareContext, tool: HarnessId) {
  const skillRoot = writeRoot(harnesses[tool], context.home, context.overrides?.[tool]);
  const roots = harnesses[tool].skillRoots(configRoot(harnesses[tool], context.home, context.overrides?.[tool]), context.home).map(root => root.path);
  const taken = new Set<string>();
  for (const root of roots) for (const entry of await readdir(root).catch(() => [] as string[])) taken.add(entry.toLowerCase());
  const mcp = await readTool(context, tool);
  const agents = tool === 'pi-cli' ? undefined : await readAgents(context, tool);
  const sync = (await readRecord(context.home)).record;
  const mcpRecord = await readMcpRecord(context.home);
  const agentRecord = await readAgentRecord(context.home);
  return {
    mcpProblem: mcp.problem,
    async hash(item: Pick<PartItem, 'kind' | 'name'>): Promise<string | undefined> {
      if (item.kind === 'skill') { const dir = join(skillRoot, item.name); return (await exists(dir)) ? (await readTree(dir).catch(() => undefined))?.hash ?? 'unreadable' : undefined; }
      if (item.kind === 'mcp') return mcp.entries.find(entry => entry.name === item.name)?.hash ?? (mcp.invalid?.includes(item.name) ? 'unreadable' : undefined);
      const file = fileFor(context, tool, item.name);
      return (await readFile(file, 'utf8').then(sha, () => undefined)) ?? (agents?.unreadable.has(item.name.toLowerCase()) ? 'unreadable' : undefined);
    },
    /** A same-named item the tool reads that isn't at this part's own place (a skill in the shared .agents folder). */
    elsewhere: (item: Pick<PartItem, 'kind' | 'name'>) => item.kind === 'skill' && taken.has(item.name.toLowerCase()),
    managed(item: Pick<PartItem, 'kind' | 'name'>): boolean {
      if (item.kind === 'skill') return sync?.items[itemKey(item.name)]?.state === 'shared';
      if (item.kind === 'mcp') return mcpRecord.items[item.name]?.state === 'shared';
      return agentRecord.items[item.name.normalize('NFC').toLowerCase()]?.state === 'shared';
    },
  };
}

// ---------- Writing ----------

const kindWord: Record<PartKind, string> = { skill: 'skill', mcp: 'MCP server', agent: 'agent' };

/** Puts one part in (replacing `expected`, the hash these parts left there, or nothing) from the content kept in the store. */
async function put(context: ShareContext, tool: HarnessId, item: PartItem, expected: string | undefined) {
  if (item.kind === 'skill') {
    const source = keptPath(context.home, 'skill', item.hash);
    const target = join(writeRoot(harnesses[tool], context.home, context.overrides?.[tool]), item.name);
    if (expected) { await replaceCopy(context, itemKey(item.name), source, target, expected); return; }
    await mkdir(join(target, '..'), { recursive: true });
    await placeCopy(context, source, { harness: tool, directory: target, limits: [] }, await readTree(source));
    return;
  }
  if (item.kind === 'mcp') {
    const server = JSON.parse(await readFile(`${keptPath(context.home, 'mcp', item.hash)}.json`, 'utf8')) as NeutralServer;
    const problem = await editEntry(context, tool, item.name, expected, server, {});
    if (problem) throw new Error(problem);
    return;
  }
  const text = await readFile(`${keptPath(context.home, 'agent', item.hash)}.txt`, 'utf8');
  const file = fileFor(context, tool, item.name);
  await writeFileChecked(file, text, expected ? await readFile(file, 'utf8') : undefined);
}

/** Takes one part out, only while it still holds what these parts put there. */
async function take(context: ShareContext, tool: HarnessId, item: PartItem) {
  if (item.kind === 'skill') { await removeChecked(context, join(writeRoot(harnesses[tool], context.home, context.overrides?.[tool]), item.name), item.hash); return; }
  if (item.kind === 'mcp') { const problem = await editEntry(context, tool, item.name, item.hash, undefined); if (problem) throw new Error(problem); return; }
  const file = fileFor(context, tool, item.name);
  const text = await readFile(file, 'utf8');
  if (sha(text) !== item.hash) throw Object.assign(new Error('It changed just now.'), { code: 'CK_CHANGED' });
  await removeFileChecked(file, text);
}

const plainReason = (error: unknown) => (errorCode(error) === 'CK_CHANGED' ? 'it changed just now, so it was left as it is' : error instanceof Error ? error.message.replace(/\.$/, '') : String(error));

/**
 * Moves one tool from the parts it holds (`from`) to the parts wanted (`to`). A part from `from` is replaced or removed only
 * while it still holds what was put there and is not managed; one edited or managed since is left as it is and no longer
 * counted as a part. A new part goes in only where the tool has nothing of that name. Returns the parts held afterwards.
 */
async function move(context: ShareContext, tool: HarnessId, from: PartItem[], to: PartItem[]): Promise<{ held: PartItem[]; notes: string[]; wrote: number }> {
  const now = await lookup(context, tool);
  const held: PartItem[] = [];
  const notes: string[] = [];
  let wrote = 0;
  const same = (first: Pick<PartItem, 'kind' | 'name'>, second: Pick<PartItem, 'kind' | 'name'>) => first.kind === second.kind && first.name.toLowerCase() === second.name.toLowerCase();
  const names = [...from, ...to.filter(item => !from.some(old => same(old, item)))];
  for (const each of names) {
    const old = from.find(item => same(item, each));
    const want = to.find(item => same(item, each));
    const label = `the ${kindWord[each.kind]} “${each.name}”`;
    if (each.kind === 'mcp' && now.mcpProblem) { notes.push(`Left ${label}: ${now.mcpProblem}`); if (old) held.push(old); continue; }
    const current = await now.hash(each);
    try {
      if (old && current !== undefined) {
        if (current !== old.hash) { notes.push(`Left ${label} as it is: it was changed after it was installed.`); continue; }
        if (now.managed(each)) { notes.push(`Left ${label} as it is: it is managed now, so it belongs to the Skills, MCP or Agents page.`); continue; }
        if (!want) { await take(context, tool, old); wrote++; continue; }
        if (want.hash !== old.hash) { await put(context, tool, want, old.hash); wrote++; }
        held.push(want);
        continue;
      }
      if (!want) continue;
      if (current !== undefined || now.elsewhere(want)) { notes.push(`Left ${label}: ${toolNames[tool]} already has one of that name.`); continue; }
      await put(context, tool, want, undefined);
      wrote++;
      held.push(want);
    } catch (error) {
      notes.push(`Couldn’t change ${label}: ${plainReason(error)}.`);
      if (old && current === old.hash) held.push(old);
    }
  }
  return { held, notes, wrote };
}

// ---------- Runs ----------

export interface PartsTarget { source: string; marketName: string; plugin: string; version?: string; tool: HarnessId }

const count = (items: PartItem[]) => {
  const by = (kind: PartKind, one: string, many: string) => { const n = items.filter(item => item.kind === kind).length; return n ? `${n} ${n === 1 ? one : many}` : ''; };
  return [by('skill', 'skill', 'skills'), by('mcp', 'MCP server', 'MCP servers'), by('agent', 'agent', 'agents')].filter(Boolean).join(', ');
};

/** Saves the record with `entry` in place of this plugin and tool's (null: none), and the run that did it. */
async function finish(context: ShareContext, key: string, before: PartsInstall | null, entry: PartsInstall | null): Promise<string> {
  const installs = (await readParts(context.home)).filter(install => partsKey(install.source, install.plugin, install.tool) !== key);
  if (entry) installs.push(entry);
  await saveParts(context.home, installs);
  const run = randomUUID();
  await writeDurably(runPath(context.home, run), `${JSON.stringify({ key, before, after: entry } satisfies PartsRun, null, 2)}\n`);
  return run;
}

const report = (tool: HarnessId, outcome: ActionReport['outcome'], message: string, more: { run?: string; changed?: boolean; notes?: string[] } = {}): ActionReport =>
  ({ tool, outcome, message, runs: [], parts: true, changed: !!more.changed, ...(more.run ? { partsRun: more.run } : {}), ...(more.notes?.length ? { notes: more.notes } : {}) });

/**
 * Installs a plugin's parts in a tool, or brings them up to date: unchanged parts are replaced, new ones added, ones the
 * plugin dropped removed. Edited or managed parts stay as they are. The run can be undone.
 */
export async function installParts(context: ShareContext, target: PartsTarget, files: PluginFiles): Promise<ActionReport> {
  const { tool } = target;
  if (!partsTools.includes(tool)) return report(tool, 'failed', `${toolNames[tool]} takes the plugin itself.`);
  const access = await writeAccess(context);
  if (!access.allowed) return report(tool, 'failed', access.reason);
  const key = partsKey(target.source, target.plugin, tool);
  const before = (await readParts(context.home)).find(install => partsKey(install.source, install.plugin, install.tool) === key) ?? null;
  const { ready, plan, digest } = await partsFor(context, files, tool);
  if (!ready.length && !before) return report(tool, 'failed', `Nothing in it can go into ${toolNames[tool]}: ${plan.map(part => part.why).filter(Boolean)[0] ?? 'it has no skills, MCP servers or agents'}`);
  for (const part of ready) await part.keep();
  const wanted = ready.map(({ kind, name, hash }) => ({ kind, name, hash }));
  const moved = await move(context, tool, before?.items ?? [], wanted);
  const entry: PartsInstall | null = moved.held.length ? { source: target.source, marketName: target.marketName, plugin: target.plugin, version: target.version, tool, at: new Date().toISOString(), digest, items: moved.held } : null;
  const run = await finish(context, key, before, entry);
  const skipped = plan.filter(part => part.why).map(part => `${part.name}: ${part.why}`);
  const left = skipped.length ? ` Not installed: ${skipped.join('; ')}` : '';
  if (!moved.held.length) return report(tool, 'failed', `No part went in. ${moved.notes.join(' ')}${left}`.trim(), { run, changed: moved.wrote > 0 });
  const verb = before ? 'Parts brought up to date' : 'Parts installed';
  return report(tool, 'installed', `${verb}: ${count(moved.held)}. ${harnesses[tool].nextStep.replace(/^Written\. /, '')}${left}`, { run, changed: moved.wrote > 0, notes: moved.notes });
}

/** Removes a plugin's parts from a tool: each one still as it was installed. Edited or managed parts stay. The run can be undone. */
export async function removeParts(context: ShareContext, target: Pick<PartsTarget, 'source' | 'plugin' | 'tool'>): Promise<ActionReport> {
  const { tool } = target;
  const access = await writeAccess(context);
  if (!access.allowed) return report(tool, 'failed', access.reason);
  const key = partsKey(target.source, target.plugin, tool);
  const before = (await readParts(context.home)).find(install => partsKey(install.source, install.plugin, install.tool) === key);
  if (!before) return report(tool, 'uninstalled', `No parts of it are in ${toolNames[tool]}.`);
  const moved = await move(context, tool, before.items, []);
  const run = await finish(context, key, before, moved.held.length ? { ...before, items: moved.held } : null);
  if (moved.held.length) return report(tool, 'failed', [`Not every part could be removed from ${toolNames[tool]}.`, ...moved.notes].join(' '), { run, changed: moved.wrote > 0 });
  return report(tool, 'uninstalled', `Parts removed from ${toolNames[tool]}.`, { run, changed: moved.wrote > 0, notes: moved.notes });
}

/** Undoes one parts run: the tool goes back to the parts it held before, from the content kept in the store. */
export async function undoParts(context: ShareContext, run: string): Promise<ActionReport | undefined> {
  if (!/^[0-9a-f-]{36}$/.test(run)) return undefined;
  let past: PartsRun;
  try { past = JSON.parse(await readFile(runPath(context.home, run), 'utf8')); } catch { return undefined; }
  const tool = (past.before ?? past.after)?.tool;
  if (!tool) return undefined;
  const access = await writeAccess(context);
  if (!access.allowed) return report(tool, 'failed', access.reason);
  if (past.undone) return report(tool, 'failed', 'That change was already undone.');
  const current = (await readParts(context.home)).find(install => partsKey(install.source, install.plugin, install.tool) === past.key) ?? null;
  const moved = await move(context, tool, current?.items ?? [], past.before?.items ?? []);
  const entry = past.before && moved.held.length ? { ...past.before, items: moved.held } : null;
  await finish(context, past.key, current, entry);
  await writeDurably(runPath(context.home, run), `${JSON.stringify({ ...past, undone: true }, null, 2)}\n`);
  const done = past.before ? `Parts put back in ${toolNames[tool]}: ${count(moved.held)}.` : `Parts removed from ${toolNames[tool]}.`;
  return report(tool, past.before ? 'installed' : 'uninstalled', done, { changed: moved.wrote > 0, notes: moved.notes });
}
