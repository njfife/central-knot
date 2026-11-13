// A plugin's parts in a tool that can't take the plugin itself (Pi, or Claude Code, Codex and Copilot CLI where their
// plugin route is blocked here, such as a desktop app with no CLI), or single parts of it in one that hasn't the plugin
// (Claude Code, which has no switch for one skill of a plugin): its skills, MCP servers and agents written as ordinary items, through the same writers the Skills, MCP
// and Agents pages use (byte-exact skill copies, each tool's MCP format, each tool's agent format). Values go in as-is.
// What went in is recorded per plugin and tool (plugin-parts.json), so the items say where they came from, can be removed
// together, show when the plugin has changed, and every run can be undone from the content kept in Central Knot's store
// (skills in the Skills store, MCP servers and agent files in this module's own folder).
// Nothing is ever overwritten that these parts did not put there, and a part edited or managed since is left alone.
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, readlink, rm, stat, unlink } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { isAbsolute, join, sep } from 'node:path';
import { agentText, fileFor, fromMarkdown, isAgentTool, keyOf, safeName } from './agentfiles.ts';
import { agentsOn } from './agents.ts';
import { PLUGIN_ONLY, type PluginFiles } from './catalogdetail.ts';
import { loadProblems, parseSkill } from './discovery.ts';
import { configRoot, harnesses, writeRoot } from './harnesses.ts';
import { removeFolder, rootProblem, swapFolder } from './skillfiles.ts';
import { skillsOn } from './skills.ts';
import { canonical, cannotHold, editEntry, fromJson, readTool, serverHash, type NeutralServer } from './mcp.ts';
import { serversOn } from './servers.ts';
import { partsSummary, partsTools, partWords, samePart } from './pluginstatus.ts';
import {
  changedWhileSyncing, errorCode, exists, importRevision, sha256, itemKey, partsRecordPath, placeCopy, readParts, readTree, removeFileChecked, storeDirectory, storedRevision, targetFor, writeAccess, writeDurably, writeFileChecked, type ShareContext,
} from './share.ts';
import type { ActionReport, HarnessId, PartItem, PartKind, PartPlan, PartRef, PartsInstall, PartsPick } from './types.ts';
import { sameSource } from './plugins.ts';
import { toolNames } from './words.ts';

// ---------- Record ----------

const recordPath = partsRecordPath;
const runPath = (home: string, run: string) => join(storeDirectory(home), 'plugin-parts-runs', `${run}.json`);
/** Agent files as written, by their bytes' hash (skills are kept in the Skills store). */
const agentTextPath = (home: string, hash: string) => join(storeDirectory(home), 'items', 'plugin-parts', 'agent', `${hash}.txt`);
/** A server part's shared part, by its hash; a part put in before these were kept here is in the MCP store of the time (`items/mcp/<name>/`). */
const serverPaths = (home: string, name: string, hash: string) =>
  [join(storeDirectory(home), 'items', 'plugin-parts', 'mcp', `${hash}.json`), join(storeDirectory(home), 'items', 'mcp', encodeURIComponent(name), `${hash}.json`)];
async function keptServer(home: string, name: string, hash: string): Promise<NeutralServer | undefined> {
  for (const path of serverPaths(home, name, hash)) { try { return JSON.parse(await readFile(path, 'utf8')) as NeutralServer; } catch { /* the next place */ } }
  return undefined;
}

/** Which plugin's parts in which tool: the marketplace as added (however its address was spelled), the plugin and the tool. */
type PartsOf = Pick<PartsInstall, 'source' | 'plugin' | 'tool'>;
const isFor = (install: PartsOf, target: PartsOf) => install.plugin === target.plugin && install.tool === target.tool && sameSource(install.source, target.source);

export { readParts };
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

/** "its timeout setting stays with the plugin": what a tool can't hold of a part, said once for agents and servers alike. */
const staysBehind = (fields: string[]) => (fields.length ? `its ${fields.join(', ')} setting${fields.length > 1 ? 's stay' : ' stays'} with the plugin` : undefined);

/** A part of the plugin that is there but can't be read now, as `partsFor` names it ('*': any part of that kind). */
const unreadKey = (kind: PartKind, name: string) => `${kind}\0${name}`;

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
  // An option's value counts too (`--config=./server.json`); a bare flag doesn't.
  const args = (Array.isArray(raw.args) ? raw.args.map(text) : []).map(arg => (arg?.startsWith('-') ? arg.split('=').slice(1).join('=') || undefined : arg))
    .filter((arg): arg is string => !!arg && !/^[a-z][\w+.-]*:/i.test(arg));
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
  const unread = new Set<string>([...files.unread.skills.map(skill => unreadKey('skill', skill)), ...files.unread.agents.map(agent => unreadKey('agent', agent))]);
  const name = toolNames[tool];
  for (const skill of files.skills) {
    let tree;
    try { tree = await readTree(skill.dir); } catch { unread.add(unreadKey('skill', skill.name)); plan.push({ kind: 'skill', name: skill.name, why: 'Its files couldn’t be read.' }); continue; }
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
    // Claude Code rewrites its MCP file while running, so its servers are written only with Write to Claude Code (MCP-02).
    if (tool === 'claude-cli') { plan.push({ kind: 'mcp', name: server, why: 'Claude Code’s MCP servers are added with “Write to Claude Code” on the MCP servers page, so parts leave them out.', wholeKind: true }); continue; }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { unread.add(unreadKey('mcp', server)); plan.push({ kind: 'mcp', name: server, why: 'It isn’t a server entry.' }); continue; }
    const why = await needsPlugin(raw as Record<string, unknown>, files.folder);
    if (why) { plan.push({ kind: 'mcp', name: server, why }); continue; }
    const { server: neutral, extras } = fromJson(server, tool, '', raw as Record<string, unknown>);
    const cannot = cannotHold(tool, neutral);
    if (cannot) { plan.push({ kind: 'mcp', name: server, why: cannot }); continue; }
    // Fields beyond the shared ones (a timeout, say) have no recorded form in another tool: said, as an agent's are.
    const own = Object.keys(extras);
    plan.push({ kind: 'mcp', name: server, limit: staysBehind(own) });
    const [path] = serverPaths(context.home, server, serverHash(neutral));
    ready.push({ kind: 'mcp', name: server, hash: serverHash(neutral), store: async () => { if (!(await exists(path))) { await mkdir(join(path, '..'), { recursive: true }); await writeDurably(path, `${JSON.stringify(neutral, null, 2)}\n`); } } });
  }
  for (const agent of files.agents) {
    if (tool === 'pi-cli') { plan.push({ kind: 'agent', name: agent.name, why: 'Pi has no agents.', wholeKind: true }); continue; }
    if (!agent.whole) { unread.add(unreadKey('agent', agent.name)); plan.push({ kind: 'agent', name: agent.name, why: 'Its file is too large to read.' }); continue; }
    if (!safeName(agent.name)) { plan.push({ kind: 'agent', name: agent.name, why: 'Its name can’t be a file name.' }); continue; }
    const parsed = fromMarkdown(agent.name, agent.text);
    if (!parsed) { unread.add(unreadKey('agent', agent.name)); plan.push({ kind: 'agent', name: agent.name, why: 'Its front matter couldn’t be read.' }); continue; }
    if (tool === 'copilot-cli' && !parsed.description.trim()) { plan.push({ kind: 'agent', name: agent.name, why: `${name} doesn’t offer an agent with no description.` }); continue; }
    let text: string;
    // A plugin's agents are Claude Code agents: Claude Code takes the file as it is, with every field.
    try { text = tool === 'claude-cli' ? agent.text : agentText(tool, parsed); } catch { plan.push({ kind: 'agent', name: agent.name, why: `It can’t be written as a ${name} agent.` }); continue; }
    const fields = tool === 'claude-cli' ? [] : Object.keys(parsed.fields);
    plan.push({ kind: 'agent', name: agent.name, limit: staysBehind(fields) });
    const hash = sha256(text);
    ready.push({ kind: 'agent', name: agent.name, hash, store: async () => { if (!(await exists(agentTextPath(context.home, hash)))) await writeDurably(agentTextPath(context.home, hash), text); } });
  }
  return { ready, plan, unread };
}

/**
 * The plan for each tool that can take parts, for the plugin's page: which parts would go in, and why each other one
 * wouldn't, including a name the tool already has from elsewhere (`installs`: this plugin's parts already there, which
 * are its own and no clash). A part the person turned off or removed there is `out`: it can go in, and stays out until chosen.
 */
export async function planParts(context: ShareContext, files: PluginFiles, tools: HarnessId[], installs: PartsInstall[]): Promise<Partial<Record<HarnessId, PartPlan[]>>> {
  const plans: Partial<Record<HarnessId, PartPlan[]>> = {};
  for (const tool of tools.filter(candidate => partsTools.includes(candidate))) {
    const ours = installs.find(install => install.tool === tool)?.items ?? [];
    const holds = await namesInUse(context, tool);
    const { plan, ready } = await partsFor(context, files, tool);
    const sentence = (why: string) => `${why[0]!.toUpperCase()}${why.slice(1)}.`;
    for (const part of plan) {
      if (part.why) continue;
      const own = ours.find(item => samePart(item, part));
      const now = await onDisk(context, tool, part);
      if (now.state === 'unreadable') { part.why = sentence(now.why); continue; }
      // A part of this plugin's already there follows the run's rules for it: changed or managed since means left.
      if (own && !own.removed && now.state === 'there') {
        const left = leftBecause(own, now, holds);
        // A changed skill is written through the skills folder, which may be a link or shared: the run would refuse it.
        const rewrite = part.kind === 'skill' && holds.skillRootProblem && ready.find(item => samePart(item, part))?.hash !== own.hash;
        if (left) part.why = sentence(left);
        else if (rewrite) part.why = holds.skillRootProblem;
        // Taking it out goes through the same folder: its switch says so before Apply all would fail.
        else if (part.kind === 'skill' && holds.skillRootProblem) part.fixed = holds.skillRootProblem;
        continue;
      }
      // Claimed by a run that stopped before writing it: the next run writes it.
      if (own && !own.removed && !own.seen) continue;
      const why = blocker(now, holds, part, tool);
      if (why) part.why = sentence(why);
      // Out by the person's choice (turned off here, or removed from the tool by hand): it stays out until turned on.
      else if (own) part.out = true;
      else if (now.state === 'absent' && now.brokenLink !== undefined) part.limit = [part.limit, `it would replace a broken link there${now.brokenLink ? `, which led to ${now.brokenLink}` : ''}`].filter(Boolean).join('; ');
    }
    plans[tool] = plan;
  }
  return plans;
}

/**
 * Whether a tool's parts, as recorded (`install`), are still what the plugin's parts for it are: nothing it holds or
 * would get has changed (a new agent doesn't make Pi's parts out of date, nor does a change to a part its record has as
 * out). Undefined while some of them can't be read (nothing is claimed either way). The record's digest identifies the
 * parts' content when it was taken, over the parts not out then; a part removed by hand since may no longer match that,
 * so a digest over every part counts too.
 */
export async function partsCurrent(context: ShareContext, files: PluginFiles, install: Pick<PartsInstall, 'tool' | 'digest' | 'items'>): Promise<boolean | undefined> {
  const { ready, unread } = await partsFor(context, files, install.tool);
  return isCurrent(install, ready, unread, files);
}
const isCurrent = (install: Pick<PartsInstall, 'digest' | 'items'>, ready: PartItem[], unread: Set<string>, files: PluginFiles) => {
  const now = digestOf(ready, unread, files, install.items);
  return now === undefined ? undefined : now === install.digest || digestOf(ready, unread, files, []) === install.digest;
};
/** `items`: the tool's record; a part it has as out by the person's choice is left out, so a change to it is no change to what the tool holds. */
const digestOf = (ready: PartItem[], unread: Set<string>, files: PluginFiles, items: PartItem[]) =>
  (unread.size || files.unread.servers ? undefined : sha256(JSON.stringify(ready.filter(part => !items.some(item => item.removed && samePart(item, part))).map(({ kind, name, hash }) => [kind, name, hash]))));

// ---------- What a tool holds now ----------

const skillDir = (context: ShareContext, tool: HarnessId, name: string) => join(writeRoot(harnesses[tool], context.home, context.overrides?.[tool]), name);
/** An agent part's file in a tool. Only tools with agents get agent parts (planParts), so any other tool is a bug, not a state. */
const agentFile = (context: ShareContext, tool: HarnessId, name: string) => {
  if (!isAgentTool(tool)) throw new Error(`${toolNames[tool]} has no agents.`);
  return fileFor(context, tool, name);
};

/**
 * A part as it is in the tool now, read fresh: absent, there but unreadable right now (with why), or there with `seen`, its fingerprint.
 * For an MCP entry `seen` covers the tool's own settings on it too (a narrowed Copilot `tools`, say), so an edit to those
 * counts as an edit; `neutralHash` is its neutral hash, which an MCP write is checked against. The tool's on/off key (Codex's,
 * Pi's and OpenCode's `enabled`, OpenCode's `disabled`) is left out: it is the part's switch (partswitch.ts), and a server turned off is not one the person edited.
 */
type OnDisk = { state: 'absent'; /** A link is in a skill's place whose target is gone (where it led): it holds nothing, so a part may take its place. */ brokenLink?: string }
  | { state: 'unreadable'; /** What is in its place and why it couldn't be read, to finish "Couldn't change the skill: …". */ why: string }
  | { state: 'there'; seen: string; neutralHash?: string };
async function onDisk(context: ShareContext, tool: HarnessId, item: Pick<PartItem, 'kind' | 'name'>): Promise<OnDisk> {
  const name = toolNames[tool];
  if (item.kind === 'skill') {
    const dir = skillDir(context, tool, item.name);
    const at = await lstat(dir).catch(() => undefined);
    if (!at) return { state: 'absent' };
    try { return { state: 'there', seen: (await readTree(dir)).hash }; }
    catch (error) {
      if (at.isSymbolicLink() && await leadsNowhere(dir)) return { state: 'absent', brokenLink: shown(context, await readlink(dir).catch(() => '')) };
      return { state: 'unreadable', why: whyUnread(name, shown(context, dir), at, error) };
    }
  }
  if (item.kind === 'mcp') {
    const read = await readTool(context, tool);
    if (read.problem) return { state: 'unreadable', why: `${name}’s settings file can’t be read right now (${read.problem.replace(/\.$/, '')})` };
    if (read.invalid?.includes(item.name)) return { state: 'unreadable', why: `${name}’s settings hold an entry of that name in a form Central Knot doesn’t read` };
    const entry = read.entries.find(candidate => candidate.name === item.name);
    if (!entry) return { state: 'absent' };
    const { enabled: _switch, ...settings } = entry.extras;
    // OpenCode's other on/off key, for an entry under `mcp.servers`.
    if (tool === 'opencode-cli') delete settings.disabled;
    return { state: 'there', seen: sha256(JSON.stringify([entry.hash, canonical(tool === 'codex-cli' || tool === 'pi-cli' || tool === 'opencode-cli' ? settings : entry.extras)])), neutralHash: entry.hash };
  }
  const file = agentFile(context, tool, item.name);
  try { return { state: 'there', seen: sha256(await readFile(file, 'utf8')) }; }
  catch (error) { return errorCode(error) === 'ENOENT' ? { state: 'absent' } : { state: 'unreadable', why: `its file in ${name} couldn’t be read (${shown(context, file)}: ${errorCode(error) ?? 'unknown error'})` }; }
}
/** A path as a person reads it: one in their own home folder starts with `~`. */
const shown = (context: ShareContext, path: string) => (context.realHome && path.startsWith(`${context.realHome}${sep}`) ? `~${path.slice(context.realHome.length)}` : path);
/** Whether a link's target is gone (and not merely out of reach: a target that can't be checked counts as there). */
const leadsNowhere = async (link: string) => stat(link).then(() => false, error => errorCode(error) === 'ENOENT');
/** Why a skill's place in a tool couldn't be read, naming what is there, where, the system's own error code, and what to do about it. */
function whyUnread(tool: string, dir: string, at: Stats, error: unknown): string {
  const code = errorCode(error) ?? 'unknown error';
  if (at.isSymbolicLink()) return `a link is in its place in ${tool} (${dir}), and what it leads to couldn’t be read (${code}); remove the link, then try again`;
  if (!at.isDirectory()) return `a file is in its place in ${tool} (${dir}), where its folder would go; move or delete it, then try again`;
  if (code === 'EACCES' || code === 'EPERM') return `this computer didn’t let Central Knot read its folder in ${tool} (${dir}: ${code}); allow that, then try again`;
  return `its folder in ${tool} couldn’t be read (${dir}: ${code}); Refresh, then try again`;
}
type There = Extract<OnDisk, { state: 'there' }>;

type NamesInUse = Awaited<ReturnType<typeof namesInUse>>;
/** Names in use around a tool: skill folders in any folder it reads, and items the person manages (sync then owns them). */
async function namesInUse(context: ShareContext, tool: HarnessId) {
  const roots = harnesses[tool].skillRoots(configRoot(harnesses[tool], context.home, context.overrides?.[tool]), context.home).map(root => root.path);
  const skillNames = new Set<string>();
  for (const root of roots) {
    for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
      // A link that leads nowhere is no skill of that name: the tool loads nothing from it.
      if (!entry.isSymbolicLink() || !(await leadsNowhere(join(root, entry.name)))) skillNames.add(entry.name.toLowerCase());
    }
  }
  const skills = await skillsOn(context);
  const servers = await serversOn(context);
  const agents = await agentsOn(context);
  return {
    /** Why this tool's own skills folder can't be written, if it can't (the Skills page's own rule). */
    skillRootProblem: await rootProblem(context, tool),
    skillNamed: (name: string) => skillNames.has(name.toLowerCase()),
    managed(item: Pick<PartItem, 'kind' | 'name'>): boolean {
      if (item.kind === 'skill') return skills.has(itemKey(item.name));
      if (item.kind === 'mcp') return servers.has(itemKey(item.name));
      return agents.has(keyOf(item.name));
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
 * Why a new part can't go in, if it can't, the same for the page's plan and for a run: its place can't be read right now (and why),
 * the tool already has one of that name (here or in another folder it reads), or one of that name is managed, so its own
 * page decides where it goes and it is never claimed as a part.
 */
function blocker(now: OnDisk, holds: NamesInUse, part: Pick<PartItem, 'kind' | 'name'>, tool: HarnessId): string | undefined {
  if (part.kind === 'skill' && holds.skillRootProblem) return holds.skillRootProblem.replace(/\.$/, '');
  if (now.state === 'unreadable') return now.why;
  if (now.state === 'there' || (part.kind === 'skill' && holds.skillNamed(part.name))) return `${toolNames[tool]} already has one of that name`;
  if (holds.managed(part)) return 'one of that name is managed, so its own page decides where it goes';
  return undefined;
}

/**
 * Why a part these parts put there is now the person's to keep, if it is, the same for the page's plan and for a run: it
 * was changed after it went in, or it is managed now (its own page then decides where it goes).
 */
function leftBecause(old: PartItem, now: There, holds: NamesInUse): string | undefined {
  if (!stillOurs(old, now)) return 'it was changed after it was installed';
  if (holds.managed(old)) return 'it is managed now, so it belongs to its own page';
  return undefined;
}

// ---------- Writing ----------

/** Puts one part in from the content kept in the store, over what these parts left there (`replacing`) or where nothing is. */
async function put(context: ShareContext, tool: HarnessId, item: PartItem, replacing: There | undefined) {
  if (item.kind === 'skill') {
    const source = storedRevision(context, itemKey(item.name), item.hash);
    if (!(await exists(source))) throw new Error('its kept copy is no longer in Central Knot’s store');
    const target = skillDir(context, tool, item.name);
    if (replacing) {
      // What is there is kept in this store first, for the parts' Undo, then replaced while it is still as read.
      await importRevision(context, itemKey(item.name), target, await readTree(target));
      await swapFolder(context, source, target, replacing.seen);
      return;
    }
    await mkdir(join(target, '..'), { recursive: true });
    await placeCopy(context, source, { harness: tool, directory: target, limits: [] }, await readTree(source));
    return;
  }
  if (item.kind === 'mcp') {
    const server = await keptServer(context.home, item.name, item.hash);
    if (!server) throw new Error('its kept copy is no longer in Central Knot’s store');
    // No extras given: an entry being replaced keeps the tool's own settings on it, and a new one gets the tool's defaults.
    const problem = await editEntry(context, tool, item.name, replacing?.neutralHash, server);
    if (problem) throw new Error(problem.stopped);
    return;
  }
  const text = await readFile(agentTextPath(context.home, item.hash), 'utf8');
  const file = agentFile(context, tool, item.name);
  const now = replacing ? await readFile(file, 'utf8') : undefined;
  if (replacing && sha256(now!) !== replacing.seen) throw changedWhileSyncing();
  await writeFileChecked(file, text, now);
}

/** Takes one part out, only while it still is what these parts put there (`was`, as onDisk read it). */
async function take(context: ShareContext, tool: HarnessId, item: PartItem, was: There) {
  if (item.kind === 'skill') { await removeFolder(context, skillDir(context, tool, item.name), was.seen); return; }
  if (item.kind === 'mcp') { const problem = await editEntry(context, tool, item.name, was.neutralHash, undefined); if (problem) throw new Error(problem.stopped); return; }
  const file = agentFile(context, tool, item.name);
  const text = await readFile(file, 'utf8');
  if (sha256(text) !== was.seen) throw changedWhileSyncing();
  await removeFileChecked(file, text);
}

const plainReason = (error: unknown) => (errorCode(error) === 'CK_CHANGED' ? 'it changed just now, so it was left as it is' : error instanceof Error ? error.message.replace(/\.$/, '') : String(error));

/**
 * What a move has done so far: the parts held, notes on what was left alone, what else it did, writes made and changes that failed, and the
 * parts already gone from the tool when it looked (`goneBefore`), so its Undo never puts back what the person had removed.
 */
interface Moved { held: PartItem[]; notes: string[]; /** What the run did that is worth telling but needs no attention (a broken link replaced), in a sentence each. */ said: string[]; /** Skills written in place of a broken link, by name. */ replaced: string[]; wrote: number; failed: number; goneBefore: PartItem[] }

/**
 * Moves one tool from the parts it holds (`from`) to the parts wanted (`to`), part by part (see `settle`). `restoring`: an
 * Undo; `on`: parts the person just turned on. Returns the parts held afterwards, notes on what was left alone, how many
 * writes were made, and how many failed (each keeps its old state).
 */
async function move(context: ShareContext, tool: HarnessId, from: PartItem[], to: PartItem[], { restoring = false, on = [] as PartRef[] } = {}): Promise<Moved> {
  const holds = await namesInUse(context, tool);
  const moved: Moved = { held: [], notes: [], said: [], replaced: [], wrote: 0, failed: 0, goneBefore: [] };
  for (const each of [...from, ...to.filter(item => !from.some(old => samePart(old, item)))]) {
    const old = from.find(item => samePart(item, each));
    try { await settle(context, tool, holds, old, to.find(item => samePart(item, each)), moved, { restoring, asked: on.some(ref => samePart(ref, each)) }); }
    catch (error) {
      moved.failed++;
      moved.notes.push(`Couldn’t change ${labelOf(old ?? each)}: ${plainReason(error)}.`);
      if (old) moved.held.push(old);
    }
  }
  return moved;
}

/** A record's items after a run: none when all that is left are parts that are out (nothing of the plugin's is in the tool). */
const stillHeld = (items: PartItem[]) => (items.some(item => !item.removed) ? items : []);

const labelOf = (part: Pick<PartItem, 'kind' | 'name'>) => `the ${partWords[part.kind][0]} “${part.name}”`;

/**
 * One part's move from what was put there (`old`) to what is wanted (`want`), the first rule that applies deciding:
 *  1. it is in, or is to go in, and its place can't be read right now: a failure, nothing changes, it stays on record (nothing
 *     can be said of what is there, not even that it is unchanged);
 *  2. it is wanted out (`want.removed`: turned off, or removed by the person before): a copy these parts put there and
 *     still theirs is taken out, and it stays on record as out;
 *  3. it is out (`old.removed`): it stays out, and on record, while the plugin still has it, whatever is in its place
 *     since, unless the person just turned it on (`asked`) or an Undo puts it back;
 *  4. new, claimed by a run that stopped before writing it, or turned on and not there: written where nothing blocks it
 *     (`blocker`), over a link that leads nowhere if one is in its place;
 *  5. removed by hand since it went in: left out, and remembered as out;
 *  6. edited since, or 7. managed since: left as it is, no longer a part (`leftBecause`);
 *  8. the plugin dropped it: removed; 9. unchanged: kept; 10. changed: replaced.
 * Rules 2, 8 and 10 (and 4, in an Undo) write through the tool's skills folder, so for a skill they fail while it is a link or shared
 * with another tool (as on the Skills page). A failure throws: `move` records it and keeps the part's old state.
 */
async function settle(context: ShareContext, tool: HarnessId, holds: NamesInUse, old: PartItem | undefined, want: PartItem | undefined, moved: Moved, { restoring, asked }: { restoring: boolean; asked: boolean }) {
  const part = (old ?? want)!;
  const label = labelOf(part);
  const ours = old && !old.removed ? old : undefined;
  // Rules 2 and 3 where nothing of these parts is in the tool: its place is not even read, so what sits there (the
  // person's own item, something unreadable) never fails the run or lets the part back in.
  // (One the plugin has dropped stays on record as out too: should the plugin bring it back, it doesn't come back unasked.)
  if (!ours && (!want || want.removed || (old?.removed && !restoring && !asked))) { const out = want ?? (restoring ? undefined : old); if (out) moved.held.push(outOf(out)); return; }
  const now = await onDisk(context, tool, part);
  const writeIn = async (replacing: There | undefined) => {
    // A part read from the plugin brings its content to the store first; one from the record (an Undo) is there already.
    if ('store' in want!) await (want as Ready).store();
    await put(context, tool, want!, replacing);
    moved.wrote++;
    const written = await onDisk(context, tool, want!);
    moved.held.push({ kind: want!.kind, name: want!.name, hash: want!.hash, ...(written.state === 'there' ? { seen: written.seen } : {}) });
  };
  const throughSkillsFolder = () => { if (part.kind === 'skill' && holds.skillRootProblem) throw new Error(holds.skillRootProblem); };
  if (now.state === 'unreadable') throw new Error(now.why);
  if (ours && want?.removed) {
    if (now.state === 'there') {
      const left = leftBecause(ours, now, holds);
      if (left) { moved.notes.push(`Left ${label} as it is: ${left}.`); return; }
      throughSkillsFolder();
      await take(context, tool, ours, now);
      moved.wrote++;
    // Gone already when this run looked: its Undo leaves it out.
    } else if (ours.seen) moved.goneBefore.push(ours);
    moved.held.push(outOf(want));
    return;
  }
  if (!ours || (now.state === 'absent' && (!ours.seen || asked))) {
    // Gone when this run looked (claimed but never written, or removed by hand): its Undo leaves it out.
    if (ours) moved.goneBefore.push(ours);
    // Not wanted now: nothing to take out, and nothing an Undo should write.
    if (!want) return;
    // An Undo putting a part back through a skills folder that became a link fails (retryable), never quietly skips it.
    if (restoring) throughSkillsFolder();
    const why = blocker(now, holds, part, tool);
    if (why) { moved.notes.push(`Didn’t put in ${label}: ${why}. Once that is sorted out, turn its switch on under “What it holds” on the plugin’s page, or use Update parts.`); return; }
    if (now.state === 'absent' && now.brokenLink !== undefined) { moved.said.push(await clearBrokenLink(context, tool, part.name, now.brokenLink)); moved.replaced.push(part.name); }
    await writeIn(undefined);
    return;
  }
  if (now.state === 'absent') {
    moved.goneBefore.push(ours);
    if (!want) return;
    moved.notes.push(`Left out ${label}: it was removed from ${toolNames[tool]} after it was installed.`);
    moved.held.push(outOf(want));
    return;
  }
  const left = leftBecause(ours, now, holds);
  if (left) { moved.notes.push(`Left ${label} as it is: ${left}.`); return; }
  if (!want) { throughSkillsFolder(); await take(context, tool, ours, now); moved.wrote++; return; }
  // Unchanged: kept, and a part claimed before it was written learns what it is on disk now.
  if (want.hash === ours.hash) { moved.held.push(ours.seen ? ours : { ...ours, seen: now.seen }); return; }
  throughSkillsFolder();
  await writeIn(now);
}

/** A part on record as out: by its kind, name and the hash it had, and nothing else of the item it was made from. */
const outOf = (item: PartItem): PartItem => ({ kind: item.kind, name: item.name, hash: item.hash, removed: true });

/**
 * Removes the link in a new skill's place whose target is gone, so the skill can go in, and says so. Only the link itself
 * goes, and only while it still leads nowhere.
 */
async function clearBrokenLink(context: ShareContext, tool: HarnessId, name: string, led: string): Promise<string> {
  const link = skillDir(context, tool, name);
  if (!(await lstat(link)).isSymbolicLink() || !(await leadsNowhere(link))) throw changedWhileSyncing();
  await unlink(link);
  return `A broken link named “${name}” in ${toolNames[tool]}’s skills folder was replaced${led ? ` (it led to ${led}, which isn’t there)` : ''}.`;
}

// ---------- Runs ----------

export type PartsTarget = PartsOf & { marketName: string; version?: string };

/** Keeps what one run changed so its Undo can move back, and returns the run's name. */
async function saveRun(context: ShareContext, run: PartsRun): Promise<string> {
  // Named by its target, so the earlier runs for the same plugin and tool (only the latest is ever offered) go.
  const prefix = sha256(JSON.stringify([run.target.source, run.target.plugin, run.target.tool])).slice(0, 16);
  const folder = join(storeDirectory(context.home), 'plugin-parts-runs');
  for (const old of await readdir(folder).catch(() => [] as string[])) if (old.startsWith(`${prefix}-`)) await rm(join(folder, old), { force: true });
  const name = `${prefix}-${randomUUID()}`;
  await writeDurably(runPath(context.home, name), `${JSON.stringify(run, null, 2)}\n`);
  return name;
}

/** The record as the run found it on disk: parts already gone are marked removed, so its Undo leaves them out. */
const asFound = (before: PartsInstall | null, moved: Moved): PartsInstall | null =>
  (before ? { ...before, items: before.items.map(item => (moved.goneBefore.some(gone => samePart(gone, item)) ? { ...item, removed: true as const } : item)) } : null);

const report = (tool: HarnessId, outcome: ActionReport['outcome'], message: string, more: { run?: string; changed?: boolean; notes?: string[]; updated?: boolean; replaced?: string[] } = {}): ActionReport =>
  ({ tool, outcome, message, runs: [], changed: !!more.changed, ...(more.run ? { partsRun: more.run } : {}), ...(more.notes?.length ? { notes: more.notes } : {}), ...(more.updated ? { partsUpdated: true } : {}), ...(more.replaced?.length ? { replacedLinks: more.replaced } : {}) });

/**
 * Installs a plugin's parts in a tool, or brings them up to date: parts still as they went in are replaced by the plugin's
 * current ones, new ones added, ones the plugin dropped removed. Edited, deleted or managed parts stay as they are; a part whose source can't be read now keeps
 * its installed copy. With `pick`, each part in `on` goes in (also one turned off or removed before) and each one in
 * `off` comes out and stays out. Unless `pick.rest`, only those parts change, and the first pick for a tool leaves the
 * plugin's other parts out too. The record names every part before anything is written, so a run that stops halfway still owns what it wrote.
 * A run with failures keeps the old version and digest, so the plugin still shows as changed. Undoable.
 */
export async function installParts(context: ShareContext, target: PartsTarget, files: PluginFiles, pick?: PartsPick): Promise<ActionReport> {
  const { tool } = target;
  if (!partsTools.includes(tool)) return report(tool, 'failed', `${toolNames[tool]} takes the plugin itself.`);
  const access = await writeAccess(context);
  if (!access.allowed) return report(tool, 'failed', access.reason);
  const before = await entryFor(context.home, target);
  const { ready, plan, unread } = await partsFor(context, files, tool);
  if (!ready.length && !before) return report(tool, 'failed', `Nothing in it can go into ${toolNames[tool]}. ${plan.map(part => part.why).filter(Boolean)[0] ?? 'It has no skills, MCP servers or agents.'}`);
  const held = before?.items ?? [];
  const whole = wholeChange(held, ready, unread, files);
  const change = pick ? pickedChange(held, ready, plan, pick, pick.rest ? whole : undefined) : whole;
  // Only single parts change: the others stay as they are, at the version they have.
  const only = !!pick && !pick.rest;
  const record = (items: PartItem[], version: string | undefined, contentDigest: string): PartsInstall | null => (items.length
    ? { source: target.source, marketName: target.marketName, plugin: target.plugin, version, tool, at: new Date().toISOString(), digest: contentDigest, items }
    : null);
  const previous = { version: before?.version, digest: before?.digest ?? '' };
  // Claimed first: every part this run may write is on record (as the plugin was), so a run that stops halfway still owns it.
  const claimed = [...held, ...[...change.aside, ...change.to].filter(item => !held.some(old => samePart(old, item)))];
  await saveEntry(context.home, target, record(claimed, previous.version, previous.digest));
  const moved = await move(context, tool, change.from, change.to, { on: pick?.on });
  moved.failed += change.cannot.length;
  moved.notes.push(...change.cannot);
  const items = stillHeld([...change.aside, ...moved.held]);
  const settled = settledAs(before, target.version, digestOf(ready, unread, files, items),
    { failed: moved.failed > 0, only, current: !!before && (isCurrent(before, ready, unread, files) === true || holdsNow(items, ready)) });
  const after = record(items, settled.version, settled.digest);
  await saveEntry(context.home, target, after);
  // A version change counts only while parts remain: a record that just went away is no change to undo.
  const changed = moved.wrote > 0 || (!!after && before?.version !== after.version);
  const run = changed ? await saveRun(context, { target: { source: target.source, plugin: target.plugin, tool: target.tool }, before: asFound(before, moved), after }) : undefined;
  const skipped = only ? [] : plan.filter(part => part.why).map(part => `${part.name}: ${part.why}`);
  const left = skipped.length ? ` Not installed: ${skipped.join('; ')}` : '';
  const { outcome, message } = installOutcome(tool, moved, items, !!before, only);
  const notes = outcome === 'failed' ? [] : moved.notes;
  // A run that failed partway says what it did change too: what the tool has now.
  const has = outcome === 'failed' && moved.wrote && items.some(item => !item.removed) ? ` ${toolNames[tool]} now has ${partsSummary(items.filter(item => !item.removed), ', ')}.` : '';
  return report(tool, outcome, [`${message}${outcome === 'failed' && moved.notes.length ? ` ${moved.notes.join(' ')}` : ''}${has}`, ...moved.said].join(' ') + left, { run, changed, notes, updated: outcome === 'installed' && !!before, replaced: moved.replaced });
}

/**
 * The version and digest a run leaves on record (`digest`: of the parts as they are now, undefined while some source
 * can't be read, which keeps the old one: once readable, the plugin may show as changed though nothing differs, and that
 * update writes nothing and only brings the record up to date).
 */
function settledAs(before: PartsInstall | null, version: string | undefined, digest: string | undefined, run: { failed: boolean; only: boolean; current: boolean }): { version: string | undefined; digest: string } {
  const previous = { version: before?.version, digest: before?.digest ?? '' };
  // A run with failures keeps the old ones, so the plugin still shows as changed. A first run has none: what it did put
  // in is at this version, and what failed is not on record, so the page still offers it.
  if (run.failed) return before ? previous : { version, digest: digest ?? '' };
  // A pick of single parts brings no other part up to date: unless what the tool holds is what the plugin has now
  // (`current`), the parts stay at the version they have, still out of date.
  if (run.only && before && !run.current) return previous;
  return { version, digest: digest ?? previous.digest };
}

/** Whether a record's items are the plugin's parts as they are now: each one held has its current content, and each part it has is held or out. */
const holdsNow = (items: PartItem[], ready: PartItem[]) => items.every(item => item.removed || ready.some(part => samePart(part, item) && part.hash === item.hash))
  && ready.every(part => items.some(item => samePart(item, part)));

/**
 * What one run moves: the parts it settles, from the state on record (`from`) to the state wanted (`to`); the record's
 * other items, carried as they are (`aside`); and parts it can't take up at all, each saying why (`cannot`).
 */
interface PartsChange { from: PartItem[]; to: PartItem[]; aside: PartItem[]; cannot: string[] }

/** The whole plugin: every part that can go in, and the installed copy of each one whose source can't be read now (never read as dropped). */
function wholeChange(held: PartItem[], ready: Ready[], unread: Set<string>, files: PluginFiles): PartsChange {
  const unreadable = held.filter(item => unread.has(unreadKey(item.kind, item.name)) || unread.has(unreadKey(item.kind, '*')) || (item.kind === 'mcp' && files.unread.servers));
  // Each ready part saves its content into the store only when it is about to be written (see settle's writeIn).
  return { from: held, to: [...ready, ...unreadable], aside: [], cannot: [] };
}

/**
 * Single parts, chosen (`pick`), beside the rest of the tool's parts: those move as the whole plugin's do (`rest`), or
 * stay as they are, and with no record yet are recorded as out, so a later update brings in only what was chosen. A part
 * turned on is wanted in (`settle` writes it even where the record has it out or it is gone from the tool); one turned
 * off is wanted out.
 */
function pickedChange(held: PartItem[], ready: Ready[], plan: PartPlan[], pick: PartsPick, rest: PartsChange | undefined): PartsChange {
  // Each part once, whatever the request repeats: one named both ways comes out.
  const once = (refs: PartRef[]) => refs.filter((ref, at) => refs.findIndex(other => samePart(other, ref)) === at);
  const off = once(pick.off), on = once(pick.on).filter(ref => !off.some(other => samePart(other, ref)));
  const picked = (item: Pick<PartItem, 'kind' | 'name'>) => [...on, ...off].some(ref => samePart(ref, item));
  const others = <T extends PartItem>(items: T[]) => items.filter(item => !picked(item));
  const change: PartsChange = rest ? { ...rest, from: others(rest.from), to: others(rest.to) }
    : { from: [], to: [], aside: [...others(held), ...(held.length ? [] : others(ready).map(outOf))], cannot: [] };
  for (const ref of on) {
    const want = ready.find(item => samePart(item, ref));
    const old = held.find(item => samePart(item, ref));
    if (want) change.to.push(want);
    else change.cannot.push(`Couldn’t add ${labelOf(ref)}: ${(plan.find(part => samePart(part, ref))?.why ?? 'The plugin no longer has it.').replace(/\.$/, '')}.`);
    if (old) (want ? change.from : change.aside).push(old);
  }
  for (const ref of off) {
    const old = held.find(item => samePart(item, ref));
    const known = old ?? ready.find(item => samePart(item, ref));
    if (!known) continue;
    if (old) change.from.push(old);
    change.to.push(outOf(known));
  }
  return change;
}

/**
 * What an install, update or pick comes to, in order: a part failed; nothing went in where nothing was before (each name
 * taken already); every part was deleted by hand since; the plugin no longer has any part for this tool; or installed
 * (brought up to date, or changed by a pick) with what is there now (`items`).
 */
function installOutcome(tool: HarnessId, moved: Moved, items: PartItem[], update: boolean, picked: boolean): { outcome: ActionReport['outcome']; message: string } {
  const name = toolNames[tool];
  if (moved.failed) return { outcome: 'failed', message: 'Not every part could be changed.' };
  if (!items.length && !update) return { outcome: 'failed', message: 'Nothing was installed.' };
  if (!items.length && (picked || !moved.wrote)) return { outcome: 'uninstalled', message: `None of its parts are in ${name} any more.` };
  if (!items.length) return { outcome: 'uninstalled', message: `Parts removed: the plugin no longer has any that can go into ${name}.` };
  const there = partsSummary(items.filter(item => !item.removed), ', ');
  const done = picked ? `Parts changed: ${name} now has ${there}` : `${update ? 'Parts brought up to date' : 'Parts installed'}: ${there}`;
  return { outcome: 'installed', message: `${done}. ${harnesses[tool].nextStep}` };
}

/** Removes a plugin's parts from a tool: each one still as it was installed. Edited or managed parts stay. Undoable. */
export async function removeParts(context: ShareContext, target: PartsOf): Promise<ActionReport> {
  const { tool } = target;
  const access = await writeAccess(context);
  if (!access.allowed) return report(tool, 'failed', access.reason);
  const before = await entryFor(context.home, target);
  if (!before) return report(tool, 'uninstalled', `No parts of it are in ${toolNames[tool]}.`);
  const moved = await move(context, tool, before.items, []);
  const items = stillHeld(moved.held);
  const after = items.length ? { ...before, items } : null;
  await saveEntry(context.home, target, after);
  const run = moved.wrote ? await saveRun(context, { target: { source: target.source, plugin: target.plugin, tool: target.tool }, before: asFound(before, moved), after }) : undefined;
  if (moved.failed) return report(tool, 'failed', [`Not every part could be removed from ${toolNames[tool]}.`, ...moved.notes].join(' '), { run, changed: moved.wrote > 0 });
  return report(tool, 'uninstalled', `Parts removed from ${toolNames[tool]}.`, { run, changed: moved.wrote > 0, notes: moved.notes });
}

/**
 * Undoes one parts run: the tool goes back to the parts it held before, from the content kept in the store. The record
 * keeps whatever is still there afterwards; an Undo with failures stays undoable, so it can be tried again.
 */
export async function undoParts(context: ShareContext, run: string): Promise<ActionReport | undefined> {
  if (!/^[0-9a-f]{16}-[0-9a-f-]{36}$/.test(run)) return undefined;
  let past: PartsRun;
  try { past = JSON.parse(await readFile(runPath(context.home, run), 'utf8')); } catch { return undefined; }
  const tool = past.target?.tool;
  if (!tool) return undefined;
  const access = await writeAccess(context);
  if (!access.allowed) return report(tool, 'failed', access.reason);
  const current = await entryFor(context.home, past.target);
  const moved = await move(context, tool, current?.items ?? [], past.before?.items ?? [], { restoring: true });
  const base = past.before ?? current;
  const items = stillHeld(moved.held);
  await saveEntry(context.home, past.target, base && items.length ? { ...base, items } : null);
  if (moved.failed) return report(tool, 'failed', [`Not everything was undone in ${toolNames[tool]}.`, ...moved.notes].join(' '));
  await rm(runPath(context.home, run), { force: true });
  // Nothing left to undo (every part was edited or removed since, or only the version changed): done, so it isn't offered again.
  if (!moved.wrote) {
    let message = 'Nothing was left to undo.';
    if (past.before?.version !== past.after?.version) message = `Its record is back to ${past.before?.version ? `version ${past.before.version}` : 'how it was'}; no file needed changing.`;
    return report(tool, past.before ? 'installed' : 'uninstalled', message, { notes: moved.notes });
  }
  const there = partsSummary(moved.held.filter(item => !item.removed), ', ');
  const done = past.before ? `${toolNames[tool]}’s parts are back as they were${there ? `: ${there}` : ''}.` : `Parts removed from ${toolNames[tool]}.`;
  return report(tool, past.before ? 'installed' : 'uninstalled', done, { changed: true, notes: moved.notes });
}
