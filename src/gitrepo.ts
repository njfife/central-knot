// A git repo as the home of the Managed set, on GitHub, GitLab or any git server. Central Knot keeps a clone in its own store and
// runs this computer's git, so the sign-in that already works for git here is the one used; Central Knot never asks for or keeps
// credentials. Pull brings the repo's changes into the tools through the same sync that spreads an edit, so History can undo
// them. Push commits the Managed set as it is on this computer. Nothing moves until one of them is clicked.
//
// The layout (everything else in the repo is left as it is):
//   skills/<folder>/…        a skill, byte for byte
//   mcp/<name>.json          one MCP server, in Claude Code's shape
//   agents/<name>.md         one agent, in Claude Code's format
//   instructions/base.md     the base instructions, once this build has them
//
// Three states decide what differs: the commit last pulled or pushed (the base), the repo's latest commit, and the Managed set
// here. A side that changed since the base is the one to bring across. When both changed, the repo's edit wins on Pull (yours is
// kept in History), except that an edit always beats a deletion, on either side.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { agentHash, agentText, agentTools, agentsView, applyAgents, fileFor, fromMarkdown, keepAgentVersion, keyOf, readAgents, safeName, type AgentEntry, type NeutralAgent } from './agents.ts';
import { parseSkill } from './discovery.ts';
import { harnesses } from './harnesses.ts';
import { applyChanges, deleteEverywhere, manageView, presentTools, readHistory, replaceCopy, replaceHistory } from './manage.ts';
import { applyMcp, cannotHold, editEntry, fromJson, jsonEntry, keepServerVersion, mcpView, readMcpRecord, readTool, serverHash, type NeutralServer } from './mcp.ts';
import { gitEnv, runGit, whyGitFailed } from './plugins.ts';
import { copyTree, errorCode, itemKey, sha256 as sha, placeCopy, plainError, readRecord, readTree, removeFileChecked, removeTree, saveRecord, storeDirectory, writeAccess, writeDurably, writeFileChecked, type ShareContext } from './share.ts';
import type { Change, DestinationResult, HarnessId, RepoChange, RepoCommit, RepoKind, RepoResult, RepoView, SkillFacts } from './types.ts';

/** The base instruction set (feedback/base-instructions): read for Push, applied on Pull. Without it, instructions/ is left alone. */
export interface BaseInstructions { read(): Promise<string | undefined>; apply(text: string | undefined): Promise<string | undefined> }

interface RepoState {
  url: string;
  branch: string;
  /** The commit this computer last pulled or pushed. None until the first Pull or Push. */
  base?: string;
  pulledAt?: string;
  pushedAt?: string;
  checkedAt?: string;
  /** Why the last check could not reach the repo. */
  problem?: string;
  /** Items the last Pull could not bring in, and why: Pull tries them again, and Push leaves them as the repo has them. */
  unfinished?: Record<string, string>;
}

const cloneFolder = (home: string) => join(storeDirectory(home), 'repo');
const statePath = (home: string) => join(storeDirectory(home), 'repo.json');

async function readState(home: string): Promise<RepoState | undefined> {
  try {
    const state = JSON.parse(await readFile(statePath(home), 'utf8'));
    return typeof state?.url === 'string' && typeof state.branch === 'string' ? state : undefined;
  } catch { return undefined; }
}
const saveState = (home: string, state: RepoState) => writeDurably(statePath(home), `${JSON.stringify(state, null, 2)}\n`);

/** One repo action at a time, whichever window or request asks: they share one clone. */
let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const next = chain.then(work, work);
  chain = next.catch(() => undefined);
  return next;
}

// ---------- Git ----------

/** Git in the clone. Line endings and file names are fixed in the clone's own settings when it is made (see connectRepo). */
const git = (dir: string, args: string[], timeoutMs?: number) => runGit(['-C', dir, ...args], timeoutMs);

/** Runs git in the clone and returns what it printed; throws the reason, in plain words, when git fails. */
async function gitOrThrow(dir: string, args: string[]): Promise<string> {
  const done = await git(dir, args);
  if (done.code !== 0) throw new Error(whyGitFailed(done.code, done.output, 'repo'));
  return done.output;
}

const commitOf = async (dir: string, ref: string) => {
  const done = await git(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  return done.code === 0 && done.output ? done.output.split('\n')[0] : undefined;
};

async function describeCommit(dir: string, id: string | undefined): Promise<RepoCommit | undefined> {
  if (!id) return undefined;
  const done = await git(dir, ['log', '-1', '--format=%H%x00%s%x00%cI', id]);
  if (done.code !== 0) return { id, subject: '', at: '' };
  const [full, subject, at] = done.output.split('\0');
  return { id: full, subject, at };
}

/** Each file of a commit or tree: its mode, blob and path. */
async function listTree(dir: string, treeish: string): Promise<{ mode: string; blob: string; path: string }[]> {
  const output = await gitOrThrow(dir, ['ls-tree', '-r', '-z', '--full-tree', treeish]);
  return output.split('\0').filter(Boolean).map(line => {
    const tab = line.indexOf('\t');
    const [mode, , blob] = line.slice(0, tab).split(' ');
    return { mode, blob, path: line.slice(tab + 1) };
  });
}

/** The bytes of several blobs, read in one `git cat-file --batch`, which is stopped if it hangs. */
function readBlobs(dir: string, blobs: string[]): Promise<Map<string, Buffer>> {
  const wanted = [...new Set(blobs)];
  if (!wanted.length) return Promise.resolve(new Map());
  return new Promise((done, fail) => {
    const child = spawn('git', ['-C', dir, 'cat-file', '--batch'], { env: gitEnv(), windowsHide: true, timeout: 60_000, killSignal: 'SIGKILL' });
    const chunks: Buffer[] = [];
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.on('error', fail);
    child.on('close', code => {
      if (code !== 0) { fail(new Error('git could not read the repo’s files.')); return; }
      const all = Buffer.concat(chunks);
      const found = new Map<string, Buffer>();
      let at = 0;
      for (const blob of wanted) {
        const end = all.indexOf(10, at);
        const header = all.subarray(at, end).toString('utf8').split(' ');
        if (header[1] !== 'blob') { at = end + 1; continue; }
        const size = Number(header[2]);
        found.set(blob, all.subarray(end + 1, end + 1 + size));
        at = end + 1 + size + 1;
      }
      done(found);
    });
    child.stdin.end(`${wanted.join('\n')}\n`);
  });
}

// ---------- Layout ----------

/** A name as a file name in the repo: characters no file name can hold are written as %XX. */
const toFile = (name: string) => name.replace(/[%/\\:*?"<>|\x00-\x1f]/g, ch => `%${ch.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()}`);
const fromFile = (file: string) => { try { return decodeURIComponent(file); } catch { return file; } };
/** Base text as the tools hold it: ending in a line break. */
const asLines = (text: string) => (text && !text.endsWith('\n') ? `${text}\n` : text);

/**
 * Keys are History's own (a skill's key, `mcp:<name>`, `agent:<key>`), so a row, its History events and its pull line up; the base
 * instructions are `instructions:base`.
 */
const BASE_KEY = 'instructions:base';
const serverKey = (name: string) => `mcp:${name}`;
const agentKey = (name: string) => `agent:${keyOf(name)}`;

/** An agent as the repo holds it: what every tool holds, and Claude Code's own settings (model, tools), which the repo carries too. */
const agentId = (agent: NeutralAgent) => sha(JSON.stringify([agentHash(agent), agent.fields]));

/** One item as one side has it. `id` is its identity: equal ids hold the same thing. */
export interface SideItem { key: string; kind: RepoKind; name: string; id: string; paths: string[]; folder?: string; problem?: string }
type Side = Map<string, SideItem>;

function parseServer(name: string, text: string): NeutralServer | undefined {
  try {
    const raw = JSON.parse(text.replace(/^﻿/, ''));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? fromJson(name, 'claude-cli', '', raw).server : undefined;
  } catch { return undefined; }
}

/** Why no tool would read this SKILL.md as a skill, if none would: its frontmatter is not YAML (discovery reads it the same way). */
function unreadableSkill(text: string, folder: string): string | undefined {
  try { parseSkill(text, folder); return undefined; } catch { return 'Its SKILL.md frontmatter isn’t valid YAML, so no tool would load it. A value with a colon in it needs quotes.'; }
}

/**
 * Reads the Managed set out of a commit or tree, in the layout above. A skill's identity is its files' paths, executable bits and
 * contents, as git holds them; a server's and an agent's is what every tool holds of them (the same ids sync uses).
 */
async function readSide(dir: string, treeish: string | undefined, withBase: boolean): Promise<Side> {
  const side: Side = new Map();
  if (!treeish) return side;
  const files = await listTree(dir, treeish);
  const skills = new Map<string, typeof files>();
  for (const file of files) {
    const parts = file.path.split('/');
    if (parts[0] === 'skills' && parts.length >= 3) skills.set(parts[1], [...(skills.get(parts[1]) ?? []), file]);
  }
  // Each skill's SKILL.md is read too: one no tool could load is said before Pull, never written to sit unread in a tool.
  const skillFiles = await readBlobs(dir, [...skills].flatMap(([folder, entries]) => entries.filter(file => file.path === `skills/${folder}/SKILL.md`).map(file => file.blob)));
  for (const [folder, entries] of skills) {
    const key = itemKey(folder);
    const skillFile = entries.find(file => file.path === `skills/${folder}/SKILL.md`);
    const lines = entries.map(file => `${file.path.slice(`skills/${folder}/`.length)}\0${file.mode === '100755' ? 'x' : '-'}\0${file.blob}`).sort();
    const link = entries.find(file => file.mode === '120000' || file.mode === '160000');
    const problem = link ? `It contains a ${link.mode === '120000' ? 'link' : 'submodule'} (${link.path}), which Central Knot does not put in your tools.`
      : !skillFile ? 'It has no SKILL.md.' : unreadableSkill(skillFiles.get(skillFile.blob)?.toString('utf8') ?? '', folder);
    side.set(key, { key, kind: 'skill', name: folder, folder, id: sha(lines.join('\n')), paths: entries.map(file => file.path), problem });
  }
  const parsed = files.filter(file => /^(mcp\/[^/]+\.json|agents\/[^/]+\.md)$/.test(file.path) || (withBase && file.path === 'instructions/base.md'));
  const blobs = await readBlobs(dir, parsed.map(file => file.blob));
  for (const file of parsed) {
    const text = blobs.get(file.blob)?.toString('utf8') ?? '';
    if (file.path.startsWith('mcp/')) {
      const name = fromFile(file.path.slice('mcp/'.length, -'.json'.length));
      const server = parseServer(name, text);
      side.set(serverKey(name), { key: serverKey(name), kind: 'mcp', name, id: server ? serverHash(server) : `unreadable:${file.blob}`, paths: [file.path], problem: server ? undefined : `${file.path} is not a JSON object describing a server.` });
    } else if (file.path.startsWith('agents/')) {
      const name = fromFile(file.path.slice('agents/'.length, -'.md'.length));
      let agent;
      try { agent = fromMarkdown(name, text); } catch { agent = undefined; }
      const problem = !agent ? `${file.path} has no frontmatter Claude Code can read.` : !safeName(name) ? 'Its name can’t be a file name in every tool.' : undefined;
      side.set(agentKey(name), { key: agentKey(name), kind: 'agent', name, id: agent ? agentId(agent) : `unreadable:${file.blob}`, paths: [file.path], problem });
    } else side.set(BASE_KEY, { key: BASE_KEY, kind: 'base', name: 'Base instructions', id: sha(asLines(text)), paths: [file.path] });
  }
  return side;
}

// ---------- The Managed set here, written into the clone ----------

/** Which tool Pull writes first, and whose copy stands for an item: Claude Code takes any skill or agent as written. (Sync's own
 * orders, in mcp.ts and agents.ts, rank copies for other reasons.) */
const preference: HarnessId[] = ['claude-cli', 'codex-cli', 'copilot-cli', 'pi-cli'];
const byPreference = (first: HarnessId, second: HarnessId) => preference.indexOf(first) - preference.indexOf(second);

/** Said when copies here differ and sync hasn't settled which is the item yet (Sync off, say): it waits rather than guess. */
const UNSETTLED = 'Its copies here differ and haven’t synced yet. Turn on Sync or use Sync once, then look again.';

/**
 * Which tool's copy stands for a Managed item here, by tool preference among the tools it syncs to: an edit waiting to spread when
 * there is exactly one (that is the newest content here), else the synced content (for an MCP server, not Claude Code's entry when
 * another has it: Claude Code's may still be waiting for Write now). `UNSETTLED` when edits waiting to spread disagree.
 */
function sourceTool(facts: SkillFacts, avoid: HarnessId[] = []): HarnessId | typeof UNSETTLED | undefined {
  const tools = (Object.keys(facts.copies) as HarnessId[]).filter(tool => !facts.off.includes(tool)).sort(byPreference);
  const edited = tools.filter(tool => facts.edited?.includes(tool));
  if (new Set(edited.map(tool => facts.copies[tool]!.hash)).size > 1) return UNSETTLED;
  if (edited.length) return edited[0];
  return tools.find(tool => !avoid.includes(tool)) ?? tools[0];
}

/** Managed items that can't go in the repo, with why: Push leaves the repo's copy of each as it is. */
type Unsent = Map<string, { item: SideItem; reason: string }>;
const unsendable = (unsent: Unsent, key: string, kind: RepoKind, name: string, reason: string) => unsent.set(key, { item: { key, kind, name, id: '', paths: [] }, reason });

async function writeSkills(dir: string, skills: SkillFacts[], unsent: Unsent) {
  // Only what the layout holds is replaced: a README beside the skills, or any other file in the repo, stays.
  for (const entry of await readdir(join(dir, 'skills'), { withFileTypes: true }).catch(() => [])) if (entry.isDirectory()) await removeTree(join(dir, 'skills', entry.name));
  for (const facts of skills.filter(skill => skill.managed)) {
    const tool = sourceTool(facts);
    if (tool === UNSETTLED) { unsendable(unsent, facts.key, 'skill', facts.name, UNSETTLED); continue; }
    const copy = tool && facts.copies[tool];
    if (!copy) continue;
    if (facts.held) { unsendable(unsent, facts.key, 'skill', copy.folder, facts.held); continue; }
    const tree = await readTree(copy.directory);
    if (tree.held) { unsendable(unsent, facts.key, 'skill', copy.folder, tree.held); continue; }
    await mkdir(join(dir, 'skills'), { recursive: true });
    await copyTree(copy.directory, join(dir, 'skills', copy.folder), tree);
  }
}

async function writeServers(context: ShareContext, dir: string, tools: HarnessId[], unsent: Unsent) {
  for (const entry of await readdir(join(dir, 'mcp'), { withFileTypes: true }).catch(() => [])) if (entry.isFile() && entry.name.endsWith('.json')) await rm(join(dir, 'mcp', entry.name), { force: true });
  const view = await mcpView(context, tools);
  const record = await readMcpRecord(context.home);
  const entries = new Map<string, NeutralServer>();
  for (const tool of view.tools) for (const entry of (await readTool(context, tool)).entries) entries.set(`${entry.tool}\0${entry.name}`, entry.server);
  for (const facts of view.servers.filter(server => server.managed)) {
    // The MCP view doesn't mark edits waiting to spread (skills and agents do); here they are: a recorded copy now holding other content.
    const copies = record.items[facts.name]?.copies ?? [];
    const edited = copies.filter(copy => !copy.status && facts.copies[copy.tool] && facts.copies[copy.tool]!.hash !== copy.hash).map(copy => copy.tool);
    const tool = sourceTool({ ...facts, edited }, ['claude-cli']);
    const server = tool && tool !== UNSETTLED ? entries.get(`${tool}\0${facts.name}`) : undefined;
    if (facts.held || !server) { unsendable(unsent, serverKey(facts.name), 'mcp', facts.name, facts.held ?? (tool === UNSETTLED ? UNSETTLED : 'No tool’s settings could be read for it just now.')); continue; }
    await writeDurably(join(dir, 'mcp', `${toFile(facts.name)}.json`), `${JSON.stringify(jsonEntry('claude-cli', server), null, 2)}\n`);
  }
}

async function writeAgents(context: ShareContext, dir: string, tools: HarnessId[], unsent: Unsent, baseId: string | undefined) {
  for (const entry of await readdir(join(dir, 'agents'), { withFileTypes: true }).catch(() => [])) if (entry.isFile() && entry.name.endsWith('.md')) await rm(join(dir, 'agents', entry.name), { force: true });
  const view = await agentsView(context, tools);
  const entries = new Map<string, AgentEntry>();
  for (const tool of view.tools) for (const entry of (await readAgents(context, tool)).entries) entries.set(`${entry.tool}\0${entry.key}`, entry);
  for (const facts of view.servers.filter(agent => agent.managed)) {
    const tool = sourceTool(facts);
    const entry = tool && tool !== UNSETTLED ? entries.get(`${tool}\0${facts.key}`) : undefined;
    if (facts.held || !entry) { unsendable(unsent, agentKey(facts.name), 'agent', facts.name, facts.held ?? (tool === UNSETTLED ? UNSETTLED : 'No tool’s file could be read for it just now.')); continue; }
    // Claude Code's own file goes as written, with its own settings (tools, model). Another tool's is put in Claude Code's format
    // over the repo's file, so the settings only Claude Code has stay as the repo has them.
    const path = `agents/${toFile(entry.name)}.md`;
    const inRepo = entry.tool === 'claude-cli' || !baseId ? undefined : (await readBlobs(dir, [`${baseId}:${path}`])).get(`${baseId}:${path}`)?.toString('utf8');
    await writeDurably(join(dir, path), entry.tool === 'claude-cli' ? entry.text : agentText('claude-cli', entry.agent, inRepo));
  }
}

/**
 * Writes the Managed set here into the clone's working tree (Central Knot's own copy; no tool reads it), replacing what the layout
 * holds there, and returns the managed items that can't go in the repo.
 */
async function writeManaged(context: ShareContext, dir: string, baseId: string | undefined, base?: BaseInstructions): Promise<Unsent> {
  const unsent: Unsent = new Map();
  const view = await manageView(context);
  await writeSkills(dir, view.skills, unsent);
  await writeServers(context, dir, view.tools, unsent);
  await writeAgents(context, dir, view.tools, unsent, baseId);
  if (base) {
    await rm(join(dir, 'instructions', 'base.md'), { force: true });
    const text = await base.read();
    if (text?.trim()) await writeDurably(join(dir, 'instructions', 'base.md'), text);
  }
  return unsent;
}

/** Stages the working tree as it is and returns its tree. Everything is taken, even what the repo's .gitignore names: content moves as-is. */
async function stageTree(dir: string): Promise<string> {
  await gitOrThrow(dir, ['add', '--all', '--force', '--', '.']);
  return (await gitOrThrow(dir, ['write-tree'])).trim();
}

// ---------- What differs ----------

interface Sides { base: Side; latest: Side; here: Side; latestId?: string; unsent: Unsent }

/** Writes the Managed set here into the clone, then reads all three sides: the base commit, the repo's latest, and here. */
async function stageSides(context: ShareContext, dir: string, state: RepoState, base?: BaseInstructions): Promise<Sides> {
  const unsent = await writeManaged(context, dir, state.base, base);
  const tree = await stageTree(dir);
  const latestId = await commitOf(dir, `refs/remotes/origin/${state.branch}`);
  const [atBase, latest, here] = await Promise.all([readSide(dir, state.base, !!base), readSide(dir, latestId, !!base), readSide(dir, tree, !!base)]);
  return { base: atBase, latest, here, latestId, unsent };
}

const same = (first?: SideItem, second?: SideItem) => first?.id === second?.id;
/** Whether the repo has a change to this item that hasn't come in yet: made since the base, or left by the last Pull. */
const repoChangeWaits = (sides: Pick<Sides, 'base' | 'latest'>, unfinished: Record<string, string>, key: string) => !same(sides.base.get(key), sides.latest.get(key)) || !!unfinished[key];
const changeFrom = (from?: SideItem, to?: SideItem): RepoChange['change'] => (!from ? 'added' : !to ? 'removed' : 'changed');

/**
 * Sorts what differs into what Pull brings in and what Push sends. `unfinished`: items the last Pull couldn't finish, offered to
 * Pull again while the repo still has what it had then.
 */
export function classify(sides: Pick<Sides, 'base' | 'latest' | 'here' | 'unsent'>, unfinished: Record<string, string> = {}): { incoming: RepoChange[]; outgoing: RepoChange[] } {
  const incoming: RepoChange[] = [];
  const outgoing: RepoChange[] = [];
  const { base, latest, here, unsent } = sides;
  for (const key of new Set([...base.keys(), ...latest.keys(), ...here.keys()])) {
    const [atBase, inRepo, atHere] = [base.get(key), latest.get(key), here.get(key)];
    // An item that can't be sent from here is listed among what goes out, below, with why. If the repo changed it too, that change
    // waits as well, listed coming in: Pull won't take it while this computer's copy can't be read, and keeps it for later.
    if (unsent.has(key)) {
      const { item, reason } = unsent.get(key)!;
      const shown = inRepo ?? atBase ?? item;
      if (repoChangeWaits(sides, unfinished, key)) incoming.push({ key, kind: shown.kind, name: shown.name, change: changeFrom(atBase, inRepo), held: reason });
      continue;
    }
    if (same(inRepo, atHere)) continue;
    const { kind, name } = (inRepo ?? atHere ?? atBase)!;
    const row = { key, kind, name };
    if (inRepo?.problem) incoming.push({ ...row, change: changeFrom(atHere, inRepo), held: inRepo.problem });
    // The last Pull couldn't finish it: the repo's version (as it is now, even if it changed again) is still what comes in.
    else if (unfinished[key]) incoming.push({ ...row, change: changeFrom(atHere, inRepo), held: unfinished[key], retry: true });
    else if (same(atHere, atBase)) incoming.push({ ...row, change: changeFrom(atBase, inRepo) });
    else if (same(inRepo, atBase)) outgoing.push({ ...row, change: changeFrom(atBase, atHere) });
    // Both changed. An edit beats a deletion: removed in the repo but edited here stays, and goes out with the next Push.
    else if (!inRepo) outgoing.push({ ...row, change: 'added', keptHere: true });
    // Removed here (or no longer Managed) but edited in the repo: the edit comes back. Otherwise the repo's edit wins.
    else incoming.push({ ...row, change: changeFrom(atBase, inRepo), alsoHere: atHere ? 'changed' : 'removed' });
  }
  for (const [key, { item, reason }] of unsent) if (!repoChangeWaits(sides, unfinished, key)) outgoing.push({ key, kind: item.kind, name: item.name, change: latest.has(key) ? 'changed' : 'added', held: reason });
  const order = (first: RepoChange, second: RepoChange) => first.kind.localeCompare(second.kind) || first.name.localeCompare(second.name);
  return { incoming: incoming.sort(order), outgoing: outgoing.sort(order) };
}

// ---------- View ----------

/** The connected repo's state and clone, or undefined when none is connected (or its clone is gone). */
async function openClone(context: ShareContext): Promise<{ state: RepoState; dir: string } | undefined> {
  const state = await readState(context.home);
  const dir = cloneFolder(context.home);
  if (!state) return undefined;
  try { if (!(await stat(join(dir, '.git'))).isDirectory()) return undefined; } catch { return undefined; }
  return { state, dir };
}

const PULL_FIRST = 'The repo has changes this computer doesn’t have yet. Pull them first, then push.';

async function buildView(context: ShareContext, base?: BaseInstructions): Promise<RepoView> {
  const access = await writeAccess(context);
  const found = await openClone(context);
  if (!found) return { connected: false, access, withBase: !!base };
  const { state, dir } = found;
  const sides = await stageSides(context, dir, state, base);
  // An unfinished item that is now the same here and in the repo (put right by hand, say) is finished.
  const settled = Object.keys(state.unfinished ?? {}).filter(key => !sides.unsent.has(key) && same(sides.latest.get(key), sides.here.get(key)));
  if (settled.length) {
    for (const key of settled) delete state.unfinished![key];
    await saveState(context.home, { ...state, unfinished: Object.keys(state.unfinished!).length ? state.unfinished : undefined });
  }
  const { incoming, outgoing } = classify(sides, state.unfinished);
  return {
    connected: true, access, withBase: !!base, url: state.url, branch: state.branch, base: await describeCommit(dir, state.base), latest: await describeCommit(dir, sides.latestId),
    pulledAt: state.pulledAt, pushedAt: state.pushedAt, checkedAt: state.checkedAt, problem: state.problem, incoming, outgoing,
    pushBlocked: sides.latestId !== state.base ? PULL_FIRST : undefined,
  };
}

/**
 * The repo as last checked, against the Managed set here now. `check` asks the repo for its latest commit first. It writes only
 * Central Knot's own clone (to compare), never a tool's files.
 */
export function repoView(context: ShareContext, options: { check?: boolean; base?: BaseInstructions } = {}): Promise<RepoView> {
  return exclusive(async () => {
    // A page's check gives up sooner than Pull's: a Pull or Push waiting behind it holds every other change in the app.
    if (options.check) await check(context, 20_000);
    return buildView(context, options.base);
  });
}

/** Asks the repo for its latest commit; a failure is kept to show, and changes nothing else. */
async function check(context: ShareContext, timeoutMs?: number): Promise<string | undefined> {
  const found = await openClone(context);
  if (!found || !(await writeAccess(context)).allowed) return undefined;
  const fetched = await git(found.dir, ['fetch', '--quiet', '--prune', 'origin'], timeoutMs);
  const problem = fetched.code === 0 ? undefined : whyGitFailed(fetched.code, fetched.output, 'repo');
  await saveState(context.home, { ...found.state, checkedAt: new Date().toISOString(), problem });
  return problem;
}

// ---------- Connect and disconnect ----------

/** A result that changed nothing, saying why, with the page's view as it stands. */
const refusal = async (context: ShareContext, reason: string, base?: BaseInstructions): Promise<RepoResult> => ({ stopped: reason, results: [], view: await buildView(context, base) });

/**
 * Clones the repo into Central Knot's store. Nothing is written to the tools: what the repo holds shows as changes to Pull.
 * `branch` empty means the repo's default branch (`main` for an empty repo).
 */
export function connectRepo(context: ShareContext, url: string, branch: string, options: { base?: BaseInstructions } = {}): Promise<RepoResult> {
  return exclusive(async () => {
    const access = await writeAccess(context);
    if (!access.allowed) return refusal(context, access.reason, options.base);
    const address = url.trim();
    const wanted = branch.trim();
    if (!address) return refusal(context, 'Enter the repo’s address: the one you would give `git clone`.', options.base);
    // An option-looking value would reach git as a flag: refused, like a branch name git itself would refuse.
    if (address.startsWith('-')) return refusal(context, 'That isn’t a repo address.', options.base);
    if (wanted && (wanted.startsWith('-') || (await runGit(['check-ref-format', '--branch', wanted], 10_000)).code !== 0)) return refusal(context, `“${wanted}” isn’t a branch name git accepts.`, options.base);
    if (await openClone(context)) return refusal(context, 'A repo is already connected. Disconnect it first.', options.base);
    const dir = cloneFolder(context.home);
    const stage = `${dir}.${randomUUID()}`;
    await mkdir(storeDirectory(context.home), { recursive: true });
    await removeTree(dir);
    const cloned = await runGit(['clone', '--quiet', '--no-recurse-submodules', '--', address, stage], 120_000);
    if (cloned.code !== 0) { await removeTree(stage); return refusal(context, whyGitFailed(cloned.code, cloned.output, 'repo'), options.base); }
    try {
      const empty = !(await commitOf(stage, 'HEAD'));
      const head = (await git(stage, ['symbolic-ref', '--short', 'HEAD'])).output.trim();
      const chosen = wanted || (empty ? 'main' : head) || 'main';
      if (!empty && !(await commitOf(stage, `refs/remotes/origin/${chosen}`))) { await removeTree(stage); return refusal(context, `That repo has no branch named “${chosen}”.`, options.base); }
      // The clone keeps line endings and file names exactly as written, whatever this computer's git settings say.
      for (const [name, value] of [['core.autocrlf', 'false'], ['core.precomposeunicode', 'true'], ['core.quotepath', 'false']]) await gitOrThrow(stage, ['config', name, value]);
      if (empty) await gitOrThrow(stage, ['symbolic-ref', 'HEAD', `refs/heads/${chosen}`]);
      else await gitOrThrow(stage, ['checkout', '--quiet', '--force', '-B', chosen, `refs/remotes/origin/${chosen}`]);
      await rename(stage, dir);
      await saveState(context.home, { url: address, branch: chosen, checkedAt: new Date().toISOString() });
    } catch (error) {
      await removeTree(stage);
      return refusal(context, error instanceof Error ? error.message : plainError(error), options.base);
    }
    return { results: [], view: await buildView(context, options.base) };
  });
}

/** Forgets the repo: its clone goes, and the tools and the repo itself stay exactly as they are. */
export function disconnectRepo(context: ShareContext, options: { base?: BaseInstructions } = {}): Promise<RepoResult> {
  return exclusive(async () => {
    const access = await writeAccess(context);
    if (!access.allowed) return refusal(context, access.reason, options.base);
    await rm(statePath(context.home), { force: true });
    await removeTree(cloneFolder(context.home));
    return { results: [], view: await buildView(context, options.base) };
  });
}

// ---------- Pull ----------

/** An item that didn't come in, and why (no tool named: it concerns the item, not one tool's copy). */
const notIn = (item: string, message: string): DestinationResult => ({ item, outcome: 'held', message });
/** Said when sync would not take the repo's version on (the reason is in the results beside it): Pull tries again next time. */
const notManaged = (change: RepoChange, tool: HarnessId) => notIn(change.name, `It is in ${harnesses[tool].name} now, but sync couldn’t make it Managed yet.`);
/** What a sync pass started by Pull may touch: with Sync off, this item alone (as Apply all does); with Sync on, undefined, an ordinary pass. */
type PassScope = (key: string) => Set<string> | undefined;
/**
 * Told what Pull wrote into the first tool before sync carried it on: what was there (`before`; none for an item no tool here had)
 * and what went in, so History can undo that copy too.
 */
type Wrote = (tool: HarnessId, before: string | undefined, after: string) => void;
/** A context whose passes decide at once: a copy Pull just removed is a deletion, with no settle window to wait out. */
const decidingAtOnce = (context: ShareContext): ShareContext => ({ ...context, settleMs: 0 });

/**
 * Puts the repo's version of one skill into one tool, then makes that copy the one every tool uses, as choosing a copy does: History
 * keeps each copy it replaced, and Undo puts them back. Removed in the repo: deleted everywhere it synced, with Restore in History.
 */
async function pullSkill(context: ShareContext, dir: string, change: RepoChange, item: SideItem | undefined, only: PassScope, wrote: Wrote): Promise<DestinationResult[]> {
  const view = await manageView(context);
  const facts = view.skills.find(skill => skill.key === change.key);
  if (!item) {
    if (!facts?.managed) return [];
    const done = await deleteEverywhere(decidingAtOnce(context), change.key);
    return done.stopped ? [notIn(change.name, done.stopped)] : done.results;
  }
  const source = join(dir, 'skills', item.folder!);
  const tree = await readTree(source);
  if (tree.held) return [notIn(change.name, tree.held)];
  const writer = [...view.tools].sort(byPreference).find(tool => !facts?.off.includes(tool) && !view.writes[tool]?.blocked && (!facts?.copies[tool] || facts.copies[tool]!.writable));
  if (!writer) return [notIn(change.name, 'No tool here can take it: each is turned off for it or can’t be written.')];
  const copy = facts?.copies[writer];
  try {
    if (copy && copy.hash !== tree.hash) await replaceCopy(context, change.key, source, copy.directory, copy.hash);
    else if (!copy) await placeCopy(context, source, { harness: writer, directory: join(view.writes[writer]!.to, item.folder!), limits: [] }, tree);
    if (!facts || copy) wrote(writer, copy?.hash, tree.hash);
  } catch (error) {
    return [notIn(change.name, errorCode(error) === 'CK_CHANGED' ? `${harnesses[writer].name}’s copy changed just now, so it was left as it is. Pull again.` : `Could not write ${harnesses[writer].name}’s copy: ${plainError(error)}`)];
  }
  const done = await applyChanges(decidingAtOnce(context), [{ key: change.key, managed: true, off: facts?.off ?? [], use: writer, useHash: tree.hash }], false, { only: only(change.key) });
  if (done.stopped) return [notIn(change.name, done.stopped)];
  return (await manageView(context)).skills.some(skill => skill.key === change.key && skill.managed) ? done.results : [...done.results, notManaged(change, writer)];
}

/** MCP servers: written to one tool other than Claude Code (which waits for Write now, MCP-02), then spread by sync. */
async function pullServer(context: ShareContext, dir: string, change: RepoChange, item: SideItem | undefined, only: PassScope, wrote: Wrote): Promise<DestinationResult[]> {
  const tools = presentTools(await context.read());
  const view = await mcpView(context, tools);
  const facts = view.servers.find(server => server.key === change.name);
  if (!item && !facts?.managed) return [];
  const server = item && parseServer(change.name, await readFile(join(dir, item.paths[0]), 'utf8'));
  if (item && !server) return [notIn(change.name, item.problem ?? 'It could not be read.')];
  const writer = view.tools.filter(tool => tool !== 'claude-cli').sort(byPreference).find(tool => !facts?.off.includes(tool) && (server ? !cannotHold(tool, server) : !!facts?.copies[tool]));
  if (!writer) return [notIn(change.name, server ? 'Copilot CLI, Codex or Pi (one that can hold this server) is needed to bring it in: Claude Code’s settings are written only with Write now.' : 'Remove it in Claude Code’s settings, or use Write now on MCP servers.')];
  const here = (await readTool(context, writer)).entries.find(entry => entry.name === change.name);
  if (here?.hash !== (server ? serverHash(server) : undefined)) {
    // What this tool had is kept first, so Undo can put it back.
    if (here) await keepServerVersion(context, change.name, here.server, here);
    const problem = await editEntry(context, writer, change.name, here?.hash, server);
    if (problem) return [notIn(change.name, problem)];
    // History accounts for this write when sync can't: a server no tool had (no facts), or this tool's own entry replaced (here).
    if (server && (!facts || here)) wrote(writer, here?.hash, serverHash(server));
  }
  const changes: Change[] = server ? [{ key: change.name, managed: true, off: facts?.off ?? [], use: writer, useHash: serverHash(server) }] : [];
  const done = await applyMcp(context, tools, changes, { only: only(change.name), settleMs: 0 });
  if (done.stopped) return [notIn(change.name, done.stopped)];
  return !server || (await mcpView(context, tools)).servers.some(entry => entry.key === change.name && entry.managed) ? done.results : [...done.results, notManaged(change, writer)];
}

/** Agents: the repo holds Claude Code's format, so Claude Code takes it as written (with its own settings); others get it one-way. */
async function pullAgent(context: ShareContext, dir: string, change: RepoChange, item: SideItem | undefined, only: PassScope, wrote: Wrote): Promise<DestinationResult[]> {
  const tools = presentTools(await context.read());
  const view = await agentsView(context, tools);
  const key = keyOf(change.name);
  const facts = view.servers.find(agent => agent.key === key);
  if (!item && !facts?.managed) return [];
  const writer = agentTools.filter(tool => view.tools.includes(tool)).sort(byPreference).find(tool => !facts?.off.includes(tool) && (item ? true : !!facts?.copies[tool]));
  if (!writer) return [notIn(change.name, 'No tool here takes agents.')];
  const existing = (await readAgents(context, writer)).entries.find(entry => entry.key === key);
  const text = item && await readFile(join(dir, item.paths[0]), 'utf8');
  const agent = text === undefined ? undefined : fromMarkdown(change.name, text);
  if (item && !agent) return [notIn(change.name, item.problem ?? 'It could not be read.')];
  try {
    if (!agent) { if (existing) await removeFileChecked(existing.file, existing.text); }
    else {
      const next = writer === 'claude-cli' ? text! : agentText(writer, agent, existing?.text);
      const file = existing?.file ?? fileFor(context, writer, change.name);
      if (existing?.text !== next) {
        // What this tool had is kept first, so Undo can put it back.
        if (existing) await keepAgentVersion(context, existing);
        await mkdir(dirname(file), { recursive: true });
        await writeFileChecked(file, next, existing?.text);
        // History accounts for this write when sync can't. An agent no tool had: Undo add matches the file's bytes. This tool's own
        // agent replaced: Undo restores the kept version by the agent's identity, which is what its store is keyed by.
        if (!facts) wrote(writer, undefined, sha(next));
        else if (existing && existing.hash !== agentHash(agent)) wrote(writer, existing.hash, agentHash(agent));
      }
    }
  } catch (error) {
    return [notIn(change.name, errorCode(error) === 'CK_CHANGED' ? `${harnesses[writer].name}’s file changed just now, so it was left as it is. Pull again.` : `Could not write ${harnesses[writer].name}’s file: ${plainError(error)}`)];
  }
  const changes: Change[] = agent ? [{ key, managed: true, off: facts?.off ?? [], use: writer, useHash: agentHash(agent) }] : [];
  const done = await applyAgents(context, tools, changes, { only: only(key), settleMs: 0 });
  if (done.stopped) return [notIn(change.name, done.stopped)];
  return !agent || (await agentsView(context, tools)).servers.some(entry => entry.key === key && entry.managed) ? done.results : [...done.results, notManaged(change, writer)];
}

async function pullBase(dir: string, change: RepoChange, item: SideItem | undefined, base: BaseInstructions | undefined): Promise<DestinationResult[]> {
  const failed = await base?.apply(item ? await readFile(join(dir, item.paths[0]), 'utf8') : undefined);
  return failed ? [notIn(change.name, failed)] : [{ item: change.name, outcome: 'written', message: 'Base instructions updated.' }];
}

interface FirstWrite { change: RepoChange; tool: HarnessId; before?: string; after: string }

/**
 * (Follow-up: this reaches into the engines' bookkeeping, the 'added' event's losers and a skill copy's `created`; an engine option
 * for "the caller placed this first copy" would let sync record it itself.)
 *
 * Says in History that Pull made these events (`made`: each pulled item's new events), so their Undo reads as undoing a pull, and
 * accounts for the copy Pull wrote into the first tool itself, which sync never saw being replaced:
 * - an item no tool here had: that copy joins its 'added' event (one is made if sync added no other copy), so Undo add takes every
 *   copy away, as it does after Apply all;
 * - an item whose first tool's copy Pull replaced: that copy joins the event sync made, or, when sync had nothing else to replace
 *   (the only tool with it), an edit event of its own, so Undo puts it back (its content was kept before the write).
 */
async function tellHistory(context: ShareContext, made: Set<string>, firstWrites: FirstWrite[]) {
  const history = (await readHistory(context.home)).map(event => (made.has(event.id) ? { ...event, via: 'repo' as const } : event));
  for (const { change, tool, before, after } of firstWrites) {
    const mine = history.filter(event => made.has(event.id) && event.key === change.key);
    if (before === undefined) {
      const added = mine.find(event => event.kind === 'added');
      if (added) added.losers.unshift({ tool, hash: after });
      else history.push({ id: randomUUID(), at: new Date().toISOString(), key: change.key, item: change.name, kind: 'added', losers: [{ tool, hash: after }], orderProved: true, via: 'repo' });
      // A skill's Undo add removes only copies its record says Central Knot made; this one was.
      if (change.kind === 'skill') {
        const { record } = await readRecord(context.home);
        const copy = record?.items[change.key]?.copies.find(entry => entry.harness === tool);
        if (record && copy) { copy.created = true; await saveRecord(context.home, record); }
      }
    } else if (before !== after) {
      const replaced = mine.find(event => event.kind === 'chosen');
      if (replaced) { if (!replaced.losers.some(loser => loser.tool === tool)) replaced.losers.push({ tool, hash: before }); }
      else if (!mine.length) history.push({ id: randomUUID(), at: new Date().toISOString(), key: change.key, item: change.name, kind: 'edit', winner: { tool, hash: after }, losers: [], previous: before, orderProved: true, via: 'repo' });
    }
  }
  await replaceHistory(context, history);
}

/** What Pull and Push both start from: a writable home, a connected repo checked just now, and the three sides compared. */
async function readyToMove(context: ShareContext, base: BaseInstructions | undefined): Promise<{ dir: string; state: RepoState; sides: Sides } | { refused: RepoResult }> {
  const access = await writeAccess(context);
  if (!access.allowed) return { refused: await refusal(context, access.reason, base) };
  const found = await openClone(context);
  if (!found) return { refused: await refusal(context, 'No repo is connected.', base) };
  const problem = await check(context);
  if (problem) return { refused: await refusal(context, problem, base) };
  const state = (await readState(context.home))!;
  return { dir: found.dir, state, sides: await stageSides(context, found.dir, state, base) };
}

/**
 * Brings the repo's latest commit into the tools: each item that changed there since the last pull, through sync, so History
 * records it with Undo. An item that can't come in is said, kept out of the next Push, and tried again by the next Pull.
 */
export function pullRepo(context: ShareContext, options: { base?: BaseInstructions; syncOn?: boolean } = {}): Promise<RepoResult> {
  return exclusive(async () => {
    const ready = await readyToMove(context, options.base);
    if ('refused' in ready) return ready.refused;
    const { dir, state, sides } = ready;
    if (!sides.latestId) return { results: [], view: await buildView(context, options.base), pulled: 0 };
    const todo = classify(sides, state.unfinished).incoming.filter(change => !change.held || change.retry);
    // The repo's latest commit, exactly, is what each item is copied from.
    await gitOrThrow(dir, ['checkout', '--quiet', '--force', '-B', state.branch, sides.latestId]);
    await gitOrThrow(dir, ['clean', '--quiet', '-ffdx']);
    const results: DestinationResult[] = [];
    const unfinished: Record<string, string> = {};
    // A repo change to an item this computer can't read right now isn't taken, and isn't lost: once the copy here reads again, it
    // comes in like any change the last Pull couldn't finish (and the repo's version wins over this computer's, as it would have).
    for (const [key, { reason }] of sides.unsent) if (repoChangeWaits(sides, state.unfinished ?? {}, key)) unfinished[key] = reason;
    // With Sync off, each pass runs for its one item alone, as Apply all does: nothing else spreads, and a deletion of an MCP server or
    // agent waits for Sync like any other (it shows here as unfinished until then; skills have their own Delete everywhere).
    const only: PassScope = key => (options.syncOn === false ? new Set([key]) : undefined);
    const firstWrites: FirstWrite[] = [];
    const made = new Set<string>();
    for (const change of todo) {
      const item = sides.latest.get(change.key);
      const wrote: Wrote = (tool, before, after) => firstWrites.push({ change, tool, before, after });
      const before = new Set((await readHistory(context.home)).map(event => event.id));
      let outcome: DestinationResult[];
      try {
        outcome = change.kind === 'skill' ? await pullSkill(context, dir, change, item, only, wrote)
          : change.kind === 'mcp' ? await pullServer(context, dir, change, item, only, wrote)
          : change.kind === 'agent' ? await pullAgent(context, dir, change, item, only, wrote)
          : await pullBase(dir, change, item, options.base);
      } catch (error) { outcome = [notIn(change.name, `It could not finish. ${plainError(error)}`)]; }
      // This item's own events: a full sync pass may also record another item's edit, which stays said as sync.
      for (const event of await readHistory(context.home)) if (!before.has(event.id) && event.key === change.key) made.add(event.id);
      const stuck = outcome.find(result => result.outcome === 'held' && !result.harness) ?? outcome.find(result => result.outcome === 'failed');
      if (stuck) unfinished[change.key] = stuck.message;
      results.push(...outcome);
    }
    await tellHistory(context, made, firstWrites);
    await saveState(context.home, { ...state, base: sides.latestId, pulledAt: new Date().toISOString(), unfinished: Object.keys(unfinished).length ? unfinished : undefined });
    return { results, view: await buildView(context, options.base), pulled: todo.length - Object.keys(unfinished).length };
  });
}

// ---------- Push ----------

/** Puts items back in the working tree exactly as the base commit has them, or takes out those the base doesn't have. */
async function keepAsBase(dir: string, items: { atBase?: SideItem; here?: SideItem }[], baseId: string | undefined) {
  // This computer's copy goes first, so a kept skill has exactly the base's files, none of this computer's extra ones.
  for (const { here } of items) {
    if (!here) continue;
    if (here.kind === 'skill') await removeTree(join(dir, 'skills', here.folder!));
    else for (const path of here.paths) await rm(join(dir, path), { force: true });
  }
  const paths = items.flatMap(({ atBase }) => atBase?.paths ?? []);
  if (!paths.length || !baseId) return;
  // A list in a file, not on the command line: a big Managed set would pass Windows' command-line limit.
  const list = join(dir, '.git', 'ck-keep-paths');
  await writeDurably(list, paths.join('\0'));
  try { await gitOrThrow(dir, ['checkout', '--quiet', baseId, `--pathspec-from-file=${list}`, '--pathspec-file-nul']); }
  finally { await rm(list, { force: true }); }
}

/** Who a commit is from: the git identity set up on this computer, else Central Knot itself. */
async function identity(dir: string): Promise<string[]> {
  const name = (await git(dir, ['config', 'user.name'])).output.trim();
  const email = (await git(dir, ['config', 'user.email'])).output.trim();
  return name && email ? [] : ['-c', `user.name=${name || 'Central Knot'}`, '-c', `user.email=${email || 'central-knot@localhost'}`];
}

/** A commit message naming what changed, short enough for a log line. */
function message(outgoing: RepoChange[], from: string): string {
  const names = outgoing.map(change => change.name);
  const listed = names.length > 4 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ');
  const noun = { skill: 'skill', mcp: 'MCP server', agent: 'agent', base: '' };
  return `Central Knot: update ${listed}\n\nFrom ${from}.\n\n${outgoing.map(change => `- ${change.change} ${noun[change.kind]} ${change.name}`.replace(/  +/g, ' ')).join('\n')}\n`;
}

/**
 * Commits the Managed set here on top of the repo's latest commit and pushes it. Only when this computer has every change the repo
 * has; otherwise Pull first. Only what changed here goes: every other item stays byte for byte as the repo has it (so a setting the
 * comparison doesn't count, like an agent's model, is never rewritten), and so do items that can't be brought here or weren't.
 */
export function pushRepo(context: ShareContext, options: { base?: BaseInstructions; from?: string } = {}): Promise<RepoResult> {
  return exclusive(async () => {
    const ready = await readyToMove(context, options.base);
    if ('refused' in ready) return ready.refused;
    const { dir, state, sides } = ready;
    if (sides.latestId !== state.base) return refusal(context, PULL_FIRST, options.base);
    const { outgoing } = classify(sides, state.unfinished);
    const sending = outgoing.filter(change => !change.held);
    if (!sending.length) return refusal(context, 'Nothing to push: the repo already has the Managed set as it is here.', options.base);
    const sent = new Set(sending.map(change => change.key));
    await keepAsBase(dir, [...new Set([...sides.base.keys(), ...sides.here.keys()])].filter(key => !sent.has(key)).map(key => ({ atBase: sides.base.get(key), here: sides.here.get(key) })), state.base);
    const tree = await stageTree(dir);
    const commit = (await gitOrThrow(dir, [...await identity(dir), 'commit-tree', tree, ...(state.base ? ['-p', state.base] : []), '-m', message(sending, options.from ?? hostname())])).trim();
    const pushed = await git(dir, ['push', '--quiet', 'origin', `${commit}:refs/heads/${state.branch}`], 120_000);
    if (pushed.code !== 0) {
      const text = pushed.output.toLowerCase();
      const why = /rejected|non-fast-forward|fetch first|stale info/.test(text) ? 'The repo changed just now. Pull, then push again.'
        : /read-only|403|denied|not allowed|protected branch|pre-receive hook declined/.test(text) ? 'The repo did not accept the push: your account may only be able to read it, or the branch is protected. Nothing changed here.'
          : whyGitFailed(pushed.code, pushed.output, 'repo');
      return refusal(context, why, options.base);
    }
    await gitOrThrow(dir, ['update-ref', `refs/heads/${state.branch}`, commit]);
    await gitOrThrow(dir, ['update-ref', `refs/remotes/origin/${state.branch}`, commit]);
    await gitOrThrow(dir, ['reset', '--quiet', '--hard', commit]);
    await saveState(context.home, { ...state, base: commit, pushedAt: new Date().toISOString() });
    return { results: [], view: await buildView(context, options.base), pushed: await describeCommit(dir, commit) };
  });
}
