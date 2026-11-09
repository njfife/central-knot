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
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { agentHash, agentText, agentTools, agentsView, applyAgents, fileFor, fromMarkdown, readAgents } from './agents.ts';
import { parseSkill } from './discovery.ts';
import { harnesses } from './harnesses.ts';
import { applyChanges, deleteEverywhere, manageView, presentTools, readHistory, replaceCopy, replaceHistory } from './manage.ts';
import { applyMcp, editEntry, fromJson, mcpTools, mcpView, readTool, serverHash, type NeutralServer } from './mcp.ts';
import { gitEnv, run, whyGitFailed } from './plugins.ts';
import { copyTree, errorCode, itemKey, placeCopy, plainError, readRecord, readTree, removeFileChecked, removeTree, saveRecord, storeDirectory, writeAccess, writeDurably, writeFileChecked, type ShareContext } from './share.ts';
import type { Change, DestinationResult, HarnessId, RepoChange, RepoCommit, RepoKind, RepoResult, RepoView } from './types.ts';

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
  held?: Record<string, string>;
}

const repoFolder = (home: string) => join(storeDirectory(home), 'repo');
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

const git = (dir: string, args: string[], timeoutMs = 60_000) =>
  run('git', ['-C', dir, '-c', 'core.hooksPath=/dev/null', '-c', 'core.autocrlf=false', '-c', 'core.quotePath=false', ...args], { env: gitEnv(), timeoutMs });

async function must(dir: string, args: string[]): Promise<string> {
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
  const output = await must(dir, ['ls-tree', '-r', '-z', '--full-tree', treeish]);
  return output.split('\0').filter(Boolean).map(line => {
    const tab = line.indexOf('\t');
    const [mode, , blob] = line.slice(0, tab).split(' ');
    return { mode, blob, path: line.slice(tab + 1) };
  });
}

/** The bytes of several blobs, read in one `git cat-file --batch`. */
function readBlobs(dir: string, blobs: string[]): Promise<Map<string, Buffer>> {
  const wanted = [...new Set(blobs)];
  if (!wanted.length) return Promise.resolve(new Map());
  return new Promise((done, fail) => {
    const child = spawn('git', ['-C', dir, 'cat-file', '--batch'], { env: gitEnv(), windowsHide: true });
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
const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
/** Base text as the tools hold it: ending in a line break. */
const asLines = (text: string) => (text && !text.endsWith('\n') ? `${text}\n` : text);

/** One item as one side has it. `id` is its identity: equal ids hold the same thing. */
export interface SideItem { key: string; kind: RepoKind; name: string; id: string; paths: string[]; folder?: string; problem?: string }
type Side = Map<string, SideItem>;

/** MCP servers in the repo are written in Claude Code's shape, the one people paste. */
function serverJson(server: NeutralServer): string {
  const entry = { type: server.transport, command: server.command, args: server.args, env: server.env, cwd: server.cwd, url: server.url, headers: server.headers };
  return `${JSON.stringify(Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined)), null, 2)}\n`;
}

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

/** Reads the Managed set out of a commit or tree, in the layout above. */
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
    const key = `skill:${itemKey(folder)}`;
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
      const name = fromFile(file.path.slice(4, -5));
      const server = parseServer(name, text);
      side.set(`mcp:${name}`, { key: `mcp:${name}`, kind: 'mcp', name, id: server ? serverHash(server) : `unreadable:${file.blob}`, paths: [file.path], problem: server ? undefined : `${file.path} is not a JSON object describing a server.` });
    } else if (file.path.startsWith('agents/')) {
      const name = fromFile(file.path.slice(7, -3));
      let agent;
      try { agent = fromMarkdown(name, text); } catch { agent = undefined; }
      const key = `agent:${name.normalize('NFC').toLowerCase()}`;
      side.set(key, { key, kind: 'agent', name, id: agent ? agentHash(agent) : `unreadable:${file.blob}`, paths: [file.path], problem: agent ? undefined : `${file.path} has no frontmatter Claude Code can read.` });
    } else side.set('base', { key: 'base', kind: 'base', name: 'Base instructions', id: sha(asLines(text)), paths: [file.path] });
  }
  return side;
}

/** Prefers the tools that take any skill or agent as written. */
const preference: HarnessId[] = ['claude-cli', 'codex-cli', 'copilot-cli', 'pi-cli'];
const byPreference = (first: HarnessId, second: HarnessId) => preference.indexOf(first) - preference.indexOf(second);
/** The hash most copies hold: the synced content, not a copy still waiting to catch up. */
function commonHash(hashes: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const hash of hashes) counts.set(hash, (counts.get(hash) ?? 0) + 1);
  return [...counts].sort((first, second) => second[1] - first[1])[0]?.[0];
}

/**
 * Writes the Managed set here into the clone's working tree, replacing what the layout holds there. Returns the managed items
 * that can't go in the repo, with why.
 */
async function exportManaged(context: ShareContext, dir: string, base?: BaseInstructions): Promise<Map<string, { item: SideItem; reason: string }>> {
  const unsent = new Map<string, { item: SideItem; reason: string }>();
  // Only what the layout holds goes: a README beside the skills, or any other file in the repo, stays.
  for (const entry of await readdir(join(dir, 'skills'), { withFileTypes: true }).catch(() => [])) if (entry.isDirectory()) await removeTree(join(dir, 'skills', entry.name));
  for (const [folder, suffix] of [['mcp', '.json'], ['agents', '.md']]) {
    for (const entry of await readdir(join(dir, folder), { withFileTypes: true }).catch(() => [])) if (entry.isFile() && entry.name.endsWith(suffix)) await rm(join(dir, folder, entry.name), { force: true });
  }
  if (base) await rm(join(dir, 'instructions', 'base.md'), { force: true });
  const view = await manageView(context);
  for (const facts of view.skills.filter(skill => skill.managed)) {
    const tools = (Object.keys(facts.copies) as HarnessId[]).sort(byPreference);
    const tool = tools.find(candidate => !facts.edited?.includes(candidate)) ?? tools[0];
    const copy = tool && facts.copies[tool];
    if (!copy) continue;
    const item: SideItem = { key: `skill:${facts.key}`, kind: 'skill', name: copy.folder, id: '', paths: [] };
    if (facts.held) { unsent.set(item.key, { item, reason: facts.held }); continue; }
    const tree = await readTree(copy.directory);
    if (tree.held) { unsent.set(item.key, { item, reason: tree.held }); continue; }
    await mkdir(join(dir, 'skills'), { recursive: true });
    await copyTree(copy.directory, join(dir, 'skills', copy.folder), tree);
  }
  const mcp = await mcpView(context, view.tools);
  const servers = new Map<string, NeutralServer>();
  for (const tool of mcp.tools) for (const entry of (await readTool(context, tool)).entries) servers.set(`${entry.name}\0${entry.hash}`, entry.server);
  for (const facts of mcp.servers.filter(server => server.managed && !server.held)) {
    // Claude Code's copy may still be waiting for Write now: the others say what the server is.
    const hashes = Object.entries(facts.copies).filter(([tool]) => tool !== 'claude-cli').map(([, copy]) => copy!.hash);
    const hash = commonHash(hashes) ?? facts.copies['claude-cli']?.hash;
    const server = hash && servers.get(`${facts.name}\0${hash}`);
    if (!server) continue;
    await writeDurably(join(dir, 'mcp', `${toFile(facts.name)}.json`), serverJson(server));
  }
  const agents = await agentsView(context, view.tools);
  const entries = (await Promise.all(agents.tools.map(tool => readAgents(context, tool)))).flatMap(read => read.entries);
  for (const facts of agents.servers.filter(agent => agent.managed && !agent.held)) {
    const mine = entries.filter(entry => entry.key === facts.key);
    const hash = commonHash(mine.map(entry => entry.hash));
    // Claude Code's own file when it holds the synced content: its own settings (tools, model) go along as written.
    const entry = mine.find(candidate => candidate.tool === 'claude-cli' && candidate.hash === hash) ?? mine.find(candidate => candidate.hash === hash);
    if (!entry) continue;
    await writeDurably(join(dir, 'agents', `${toFile(entry.name)}.md`), entry.tool === 'claude-cli' ? entry.text : agentText('claude-cli', entry.agent));
  }
  const text = await base?.read();
  if (text?.trim()) await writeDurably(join(dir, 'instructions', 'base.md'), text);
  return unsent;
}

/** Stages the working tree as it is and returns its tree. Everything is taken, even what the repo's .gitignore names: content moves as-is. */
async function stageTree(dir: string): Promise<string> {
  await must(dir, ['add', '--all', '--force', '--', '.']);
  return (await must(dir, ['write-tree'])).trim();
}

// ---------- What differs ----------

interface Sides { base: Side; latest: Side; here: Side; latestId?: string; unsent: Map<string, { item: SideItem; reason: string }> }

async function readSides(context: ShareContext, dir: string, state: RepoState, base?: BaseInstructions): Promise<Sides> {
  const unsent = await exportManaged(context, dir, base);
  const tree = await stageTree(dir);
  const latestId = await commitOf(dir, `refs/remotes/origin/${state.branch}`);
  const [baseSide, latest, here] = await Promise.all([readSide(dir, state.base, !!base), readSide(dir, latestId, !!base), readSide(dir, tree, !!base)]);
  return { base: baseSide, latest, here, latestId, unsent };
}

const same = (first?: SideItem, second?: SideItem) => first?.id === second?.id;
const changeFrom = (from?: SideItem, to?: SideItem): RepoChange['change'] => (!from ? 'added' : !to ? 'removed' : 'changed');

/** Sorts what differs into what Pull brings in and what Push sends. */
export function classify(sides: Pick<Sides, 'base' | 'latest' | 'here' | 'unsent'>, heldAtPull: Record<string, string> = {}): { incoming: RepoChange[]; outgoing: RepoChange[] } {
  const incoming: RepoChange[] = [];
  const outgoing: RepoChange[] = [];
  const { base, latest, here, unsent } = sides;
  for (const key of new Set([...base.keys(), ...latest.keys(), ...here.keys()])) {
    const [b, t, o] = [base.get(key), latest.get(key), here.get(key)];
    if (same(t, o)) continue;
    const { kind, name } = (t ?? o ?? b)!;
    const row = { key, kind, name };
    if (unsent.has(key)) continue;
    if (t?.problem) incoming.push({ ...row, change: changeFrom(o, t), held: t.problem });
    else if (heldAtPull[key] && same(b, t)) incoming.push({ ...row, change: changeFrom(o, t), held: heldAtPull[key] });
    else if (same(o, b)) incoming.push({ ...row, change: changeFrom(b, t) });
    else if (same(t, b)) outgoing.push({ ...row, change: changeFrom(b, o) });
    // Both changed. An edit beats a deletion: removed in the repo but edited here stays, and goes out with the next Push.
    else if (!t) outgoing.push({ ...row, change: 'added', keptHere: true });
    // Removed here (or no longer Managed) but edited in the repo: the edit comes back. Otherwise the repo's edit wins.
    else incoming.push({ ...row, change: changeFrom(b, t), alsoHere: o ? 'changed' : 'removed' });
  }
  for (const [key, { item, reason }] of unsent) outgoing.push({ key, kind: item.kind, name: item.name, change: latest.has(key) ? 'changed' : 'added', held: reason });
  const order = (first: RepoChange, second: RepoChange) => first.kind.localeCompare(second.kind) || first.name.localeCompare(second.name);
  return { incoming: incoming.sort(order), outgoing: outgoing.sort(order) };
}

// ---------- View ----------

async function connected(context: ShareContext): Promise<{ state: RepoState; dir: string } | undefined> {
  const state = await readState(context.home);
  const dir = repoFolder(context.home);
  if (!state) return undefined;
  try { if (!(await stat(join(dir, '.git'))).isDirectory()) return undefined; } catch { return undefined; }
  return { state, dir };
}

async function buildView(context: ShareContext, base?: BaseInstructions): Promise<RepoView> {
  const access = await writeAccess(context);
  const found = await connected(context);
  if (!found) return { connected: false, access, withBase: !!base };
  const { state, dir } = found;
  const sides = await readSides(context, dir, state, base);
  const { incoming, outgoing } = classify(sides, state.held);
  const pushBlocked = sides.latestId !== state.base ? 'The repo has changes this computer doesn’t have yet. Pull them first, then push.' : undefined;
  return {
    connected: true, access, withBase: !!base, url: state.url, branch: state.branch, base: await describeCommit(dir, state.base), latest: await describeCommit(dir, sides.latestId),
    pulledAt: state.pulledAt, pushedAt: state.pushedAt, checkedAt: state.checkedAt, problem: state.problem, incoming, outgoing, pushBlocked,
  };
}

/** The repo as last checked, against the Managed set here now. `check` asks the repo for its latest commit first. */
export function repoView(context: ShareContext, options: { check?: boolean; base?: BaseInstructions } = {}): Promise<RepoView> {
  return exclusive(async () => {
    if (options.check) await check(context);
    return buildView(context, options.base);
  });
}

/** Asks the repo for its latest commit; a failure is kept to show, and changes nothing else. */
async function check(context: ShareContext): Promise<string | undefined> {
  const found = await connected(context);
  if (!found || !(await writeAccess(context)).allowed) return undefined;
  const fetched = await git(found.dir, ['fetch', '--quiet', '--prune', 'origin']);
  const problem = fetched.code === 0 ? undefined : whyGitFailed(fetched.code, fetched.output, 'repo');
  await saveState(context.home, { ...found.state, checkedAt: new Date().toISOString(), problem });
  return problem;
}

// ---------- Connect and disconnect ----------

const stopped = async (context: ShareContext, reason: string, base?: BaseInstructions): Promise<RepoResult> => ({ stopped: reason, results: [], view: await buildView(context, base) });

/**
 * Clones the repo into Central Knot's store. Nothing is written to the tools: what the repo holds shows as changes to Pull.
 * `branch` empty means the repo's default branch (`main` for an empty repo).
 */
export function connectRepo(context: ShareContext, url: string, branch: string, options: { base?: BaseInstructions } = {}): Promise<RepoResult> {
  return exclusive(async () => {
    const access = await writeAccess(context);
    if (!access.allowed) return stopped(context, access.reason, options.base);
    const address = url.trim();
    const wanted = branch.trim();
    if (!address) return stopped(context, 'Enter the repo’s address: the one you would give `git clone`.', options.base);
    // An option-looking value would reach git as a flag: refused, like a branch name git itself would refuse.
    if (address.startsWith('-')) return stopped(context, 'That isn’t a repo address.', options.base);
    if (wanted && (wanted.startsWith('-') || (await run('git', ['check-ref-format', '--branch', wanted], { env: gitEnv(), timeoutMs: 10_000 })).code !== 0)) return stopped(context, `“${wanted}” isn’t a branch name git accepts.`, options.base);
    if (await connected(context)) return stopped(context, 'A repo is already connected. Disconnect it first.', options.base);
    const dir = repoFolder(context.home);
    const stage = `${dir}.${randomUUID()}`;
    await mkdir(storeDirectory(context.home), { recursive: true });
    await removeTree(dir);
    const cloned = await run('git', ['-c', 'core.hooksPath=/dev/null', 'clone', '--quiet', '--no-recurse-submodules', '--', address, stage], { env: gitEnv(), timeoutMs: 120_000 });
    if (cloned.code !== 0) { await removeTree(stage); return stopped(context, whyGitFailed(cloned.code, cloned.output, 'repo'), options.base); }
    try {
      const empty = !(await commitOf(stage, 'HEAD'));
      const head = (await git(stage, ['symbolic-ref', '--short', 'HEAD'])).output.trim();
      const chosen = wanted || (empty ? 'main' : head) || 'main';
      if (!empty && !(await commitOf(stage, `refs/remotes/origin/${chosen}`))) { await removeTree(stage); return stopped(context, `That repo has no branch named “${chosen}”.`, options.base); }
      // Never moved by a pull or push: the clone's own settings hold the line endings and file names exactly as written.
      for (const [name, value] of [['core.autocrlf', 'false'], ['core.precomposeunicode', 'true'], ['core.quotepath', 'false']]) await must(stage, ['config', name, value]);
      if (empty) await must(stage, ['symbolic-ref', 'HEAD', `refs/heads/${chosen}`]);
      else await must(stage, ['checkout', '--quiet', '--force', '-B', chosen, `refs/remotes/origin/${chosen}`]);
      await rename(stage, dir);
      await saveState(context.home, { url: address, branch: chosen, checkedAt: new Date().toISOString() });
    } catch (error) {
      await removeTree(stage);
      return stopped(context, error instanceof Error ? error.message : plainError(error), options.base);
    }
    return { results: [], view: await buildView(context, options.base) };
  });
}

/** Forgets the repo: its clone goes, and the tools and the repo itself stay exactly as they are. */
export function disconnectRepo(context: ShareContext, options: { base?: BaseInstructions } = {}): Promise<RepoResult> {
  return exclusive(async () => {
    const access = await writeAccess(context);
    if (!access.allowed) return stopped(context, access.reason, options.base);
    await rm(statePath(context.home), { force: true });
    await removeTree(repoFolder(context.home));
    return { results: [], view: await buildView(context, options.base) };
  });
}

// ---------- Pull ----------

const held = (item: string, message: string): DestinationResult => ({ item, outcome: 'held', message });
/** Said when sync would not take the repo's version on (the reason is in the results beside it): Pull tries again next time. */
const notManaged = (change: RepoChange, tool: HarnessId) => held(change.name, `It is in ${harnesses[tool].name} now, but sync couldn’t make it Managed yet.`);
/** With Sync off, the items a pass may touch. */
type Only = (key: string) => Set<string> | undefined;
/** Told when Pull put an item no tool here had into its first tool, so its Undo takes that copy away too. */
type Placed = (tool: HarnessId, hash: string) => void;
/** Passes started by Pull decide at once: a copy Pull just removed is a deletion, with no settle window to wait out. */
const now = (context: ShareContext): ShareContext => ({ ...context, settleMs: 0 });

/**
 * Puts the repo's version of one skill into one tool, then makes that copy the one every tool uses, as choosing a copy does: History
 * keeps each copy it replaced, and Undo puts them back. Removed in the repo: deleted everywhere it synced, with Restore in History.
 */
async function pullSkill(context: ShareContext, dir: string, change: RepoChange, item: SideItem | undefined, only: Only, placed: Placed): Promise<DestinationResult[]> {
  const key = change.key.slice('skill:'.length);
  const view = await manageView(context);
  const facts = view.skills.find(skill => skill.key === key);
  if (!item) {
    if (!facts?.managed) return [];
    const done = await deleteEverywhere(now(context), key);
    return done.stopped ? [held(change.name, done.stopped)] : done.results;
  }
  const source = join(dir, 'skills', item.folder!);
  const tree = await readTree(source);
  if (tree.held) return [held(change.name, tree.held)];
  const writer = [...view.tools].sort(byPreference).find(tool => !facts?.off.includes(tool) && !view.writes[tool]?.blocked && (!facts?.copies[tool] || facts.copies[tool]!.writable));
  if (!writer) return [held(change.name, 'No tool here can take it: each is turned off for it or can’t be written.')];
  const copy = facts?.copies[writer];
  try {
    if (copy && copy.hash !== tree.hash) await replaceCopy(context, key, source, copy.directory, copy.hash);
    else if (!copy) await placeCopy(context, source, { harness: writer, directory: join(view.writes[writer]!.to, item.folder!), limits: [] }, tree);
    if (!facts) placed(writer, tree.hash);
  } catch (error) {
    return [held(change.name, errorCode(error) === 'CK_CHANGED' ? `${harnesses[writer].name}’s copy changed just now, so it was left as it is. Pull again.` : `Could not write ${harnesses[writer].name}’s copy: ${plainError(error)}`)];
  }
  const done = await applyChanges(now(context), [{ key, managed: true, off: facts?.off ?? [], use: writer, useHash: tree.hash }], false, { only: only(key) });
  if (done.stopped) return [held(change.name, done.stopped)];
  return (await manageView(context)).skills.some(skill => skill.key === key && skill.managed) ? done.results : [...done.results, notManaged(change, writer)];
}

/** MCP servers: written to one tool other than Claude Code (which waits for Write now, MCP-02), then spread by sync. */
async function pullServer(context: ShareContext, dir: string, change: RepoChange, item: SideItem | undefined, only: Only, placed: Placed): Promise<DestinationResult[]> {
  const tools = presentTools(await context.read());
  const view = await mcpView(context, tools);
  const facts = view.servers.find(server => server.key === change.name);
  const writer = view.tools.filter(tool => tool !== 'claude-cli').sort(byPreference).find(tool => !facts?.off.includes(tool) && (item ? true : !!facts?.copies[tool]));
  if (!item && !facts?.managed) return [];
  if (!writer) return [held(change.name, item ? 'Copilot CLI, Codex or Pi is needed to bring an MCP server in: Claude Code’s settings are written only with Write now.' : 'Remove it in Claude Code’s settings, or use Write now on MCP servers.')];
  const server = item && parseServer(change.name, await readFile(join(dir, item.paths[0]), 'utf8'));
  if (item && !server) return [held(change.name, item.problem ?? 'It could not be read.')];
  const here = facts?.copies[writer]?.hash;
  if (here !== (server ? serverHash(server) : undefined)) {
    const problem = await editEntry(context, writer, change.name, here, server);
    if (problem) return [held(change.name, problem)];
  }
  if (!facts && server) placed(writer, serverHash(server));
  const changes: Change[] = server ? [{ key: change.name, managed: true, off: facts?.off ?? [], use: writer, useHash: serverHash(server) }] : [];
  const done = await applyMcp(context, tools, changes, { only: only(change.name), settleMs: 0 });
  if (done.stopped) return [held(change.name, done.stopped)];
  return !server || (await mcpView(context, tools)).servers.some(entry => entry.key === change.name && entry.managed) ? done.results : [...done.results, notManaged(change, writer)];
}

/** Agents: the repo holds Claude Code's format, so Claude Code takes it as written (with its own settings); others get it one-way. */
async function pullAgent(context: ShareContext, dir: string, change: RepoChange, item: SideItem | undefined, only: Only, placed: Placed): Promise<DestinationResult[]> {
  const tools = presentTools(await context.read());
  const view = await agentsView(context, tools);
  const key = change.key.slice('agent:'.length);
  const facts = view.servers.find(agent => agent.key === key);
  if (!item && !facts?.managed) return [];
  const writer = agentTools.filter(tool => view.tools.includes(tool)).sort(byPreference).find(tool => !facts?.off.includes(tool) && (item ? true : !!facts?.copies[tool]));
  if (!writer) return [held(change.name, 'No tool here takes agents.')];
  const existing = (await readAgents(context, writer)).entries.find(entry => entry.key === key);
  const text = item && await readFile(join(dir, item.paths[0]), 'utf8');
  const agent = text === undefined ? undefined : fromMarkdown(change.name, text);
  if (item && !agent) return [held(change.name, item.problem ?? 'It could not be read.')];
  try {
    if (!agent) { if (existing) await removeFileChecked(existing.file, existing.text); }
    else {
      const next = writer === 'claude-cli' ? text! : agentText(writer, agent, existing?.text);
      const file = existing?.file ?? fileFor(context, writer, change.name);
      if (existing?.text !== next) { await mkdir(dirname(file), { recursive: true }); await writeFileChecked(file, next, existing?.text); }
      if (!facts) placed(writer, sha(next));
    }
  } catch (error) {
    return [held(change.name, errorCode(error) === 'CK_CHANGED' ? `${harnesses[writer].name}’s file changed just now, so it was left as it is. Pull again.` : `Could not write ${harnesses[writer].name}’s file: ${plainError(error)}`)];
  }
  const changes: Change[] = agent ? [{ key, managed: true, off: facts?.off ?? [], use: writer, useHash: agentHash(agent) }] : [];
  const done = await applyAgents(context, tools, changes, { only: only(key), settleMs: 0 });
  if (done.stopped) return [held(change.name, done.stopped)];
  return !agent || (await agentsView(context, tools)).servers.some(entry => entry.key === key && entry.managed) ? done.results : [...done.results, notManaged(change, writer)];
}

/**
 * What Pull changed is said as Pull in History, so its Undo reads as undoing a pull. An item Pull brought into a tool that had none
 * has its first copy named in the 'added' event too (one is made when sync added no other copy), so Undo add takes every copy away.
 */
async function tellHistory(context: ShareContext, before: Set<string>, todo: RepoChange[], placedFirst: { change: RepoChange; tool: HarnessId; hash: string }[]) {
  const keys = new Set(todo.map(historyKey));
  const history = (await readHistory(context.home)).map(event => (!before.has(event.id) && keys.has(event.key) ? { ...event, via: 'repo' as const } : event));
  for (const { change, tool, hash } of placedFirst) {
    const key = historyKey(change);
    const added = history.find(event => !before.has(event.id) && event.key === key && event.kind === 'added');
    if (added) added.losers.unshift({ tool, hash });
    else history.push({ id: randomUUID(), at: new Date().toISOString(), key, item: change.name, kind: 'added', losers: [{ tool, hash }], orderProved: true, via: 'repo' });
    // A skill's Undo add removes only copies it made; this one, Pull made.
    if (change.kind === 'skill') {
      const { record } = await readRecord(context.home);
      const copy = record?.items[key]?.copies.find(entry => entry.harness === tool);
      if (record && copy) { copy.created = true; await saveRecord(context.home, record); }
    }
  }
  await replaceHistory(context, history);
}

/** The keys History files each kind under. */
const historyKey = (change: RepoChange) => (change.kind === 'skill' ? change.key.slice('skill:'.length) : change.kind === 'agent' ? change.key : `mcp:${change.name}`);

/**
 * Brings the repo's latest commit into the tools: each item that changed there since the last pull, through sync, so History
 * records it with Undo. An item that can't come in is said, kept out of the next Push, and tried again by the next Pull.
 */
export function pullRepo(context: ShareContext, options: { base?: BaseInstructions; syncOn?: boolean } = {}): Promise<RepoResult> {
  return exclusive(async () => {
    const access = await writeAccess(context);
    if (!access.allowed) return stopped(context, access.reason, options.base);
    const found = await connected(context);
    if (!found) return stopped(context, 'No repo is connected.', options.base);
    const { dir } = found;
    const problem = await check(context);
    const state = (await readState(context.home))!;
    if (problem) return stopped(context, problem, options.base);
    const sides = await readSides(context, dir, state, options.base);
    const { incoming } = classify(sides, state.held);
    const todo = incoming.filter(change => !change.held || state.held?.[change.key]);
    if (!sides.latestId) return { results: [], view: await buildView(context, options.base), pulled: 0 };
    // The repo's latest commit, exactly, is what each item is copied from.
    await must(dir, ['checkout', '--quiet', '--force', '-B', state.branch, sides.latestId]);
    await must(dir, ['clean', '--quiet', '-ffdx']);
    const before = new Set((await readHistory(context.home)).map(event => event.id));
    const results: DestinationResult[] = [];
    const stillHeld: Record<string, string> = {};
    // With Sync off, each pass runs for its one item alone, as Apply all does: nothing else spreads, and a deletion of an MCP server or
    // agent waits for Sync like any other (skills have their own Delete everywhere).
    const only = (key: string) => (options.syncOn === false ? new Set([key]) : undefined);
    const placedFirst: { change: RepoChange; tool: HarnessId; hash: string }[] = [];
    const placer = (change: RepoChange): Placed => (tool, hash) => placedFirst.push({ change, tool, hash });
    for (const change of todo) {
      const item = sides.latest.get(change.key);
      let outcome: DestinationResult[];
      try {
        if (change.kind === 'skill') outcome = await pullSkill(context, dir, change, item, only, placer(change));
        else if (change.kind === 'mcp') outcome = await pullServer(context, dir, change, item, only, placer(change));
        else if (change.kind === 'agent') outcome = await pullAgent(context, dir, change, item, only, placer(change));
        else {
          const failed = await options.base?.apply(item ? await readFile(join(dir, 'instructions', 'base.md'), 'utf8') : undefined);
          outcome = failed ? [held(change.name, failed)] : [{ item: change.name, outcome: 'written', message: 'Base instructions updated.' }];
        }
      } catch (error) { outcome = [held(change.name, `It could not finish. ${plainError(error)}`)]; }
      const stuck = outcome.find(result => result.outcome === 'held' && !result.harness) ?? outcome.find(result => result.outcome === 'failed');
      if (stuck) stillHeld[change.key] = stuck.message;
      results.push(...outcome);
    }
    await tellHistory(context, before, todo, placedFirst);
    await saveState(context.home, { ...state, base: sides.latestId, pulledAt: new Date().toISOString(), held: Object.keys(stillHeld).length ? stillHeld : undefined });
    return { results, view: await buildView(context, options.base), pulled: todo.length - Object.keys(stillHeld).length };
  });
}

// ---------- Push ----------

/** Puts one item back in the working tree exactly as the base commit has it (or takes it out, if the base has none). */
async function keepAsBase(dir: string, item: SideItem | undefined, current: SideItem | undefined, baseId: string | undefined) {
  for (const path of current?.paths ?? []) await rm(join(dir, path), { force: true });
  if (current?.kind === 'skill') await removeTree(join(dir, 'skills', current.folder!));
  if (item?.paths.length && baseId) await must(dir, ['checkout', '--quiet', baseId, '--', ...item.paths]);
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
  return `Central Knot: update ${listed}\n\nFrom ${from}.\n\n${outgoing.map(change => `- ${change.change} ${change.kind === 'mcp' ? 'MCP server' : change.kind === 'base' ? '' : change.kind} ${change.name}`.replace(/  +/g, ' ')).join('\n')}\n`;
}

/**
 * Commits the Managed set here on top of the repo's latest commit and pushes it. Only when this computer has every change the repo
 * has; otherwise Pull first. Items the repo holds that can't be brought here, or that the last Pull couldn't bring in, stay as the
 * repo has them.
 */
export function pushRepo(context: ShareContext, options: { base?: BaseInstructions; from?: string } = {}): Promise<RepoResult> {
  return exclusive(async () => {
    const access = await writeAccess(context);
    if (!access.allowed) return stopped(context, access.reason, options.base);
    const found = await connected(context);
    if (!found) return stopped(context, 'No repo is connected.', options.base);
    const { dir } = found;
    const problem = await check(context);
    const state = (await readState(context.home))!;
    if (problem) return stopped(context, problem, options.base);
    const sides = await readSides(context, dir, state, options.base);
    if (sides.latestId !== state.base) return stopped(context, 'The repo has changes this computer doesn’t have yet. Pull them first, then push.', options.base);
    const { outgoing } = classify(sides, state.held);
    const sending = outgoing.filter(change => !change.held);
    if (!sending.length) return stopped(context, 'Nothing to push: the repo already has the Managed set as it is here.', options.base);
    const keep = new Set([...outgoing.filter(change => change.held).map(change => change.key), ...Object.keys(state.held ?? {}), ...[...sides.latest.values()].filter(item => item.problem).map(item => item.key)]);
    for (const key of keep) await keepAsBase(dir, sides.base.get(key), sides.here.get(key), state.base);
    const tree = await stageTree(dir);
    const commit = (await must(dir, [...await identity(dir), 'commit-tree', tree, ...(state.base ? ['-p', state.base] : []), '-m', message(sending, options.from ?? hostname())])).trim();
    const pushed = await git(dir, ['push', '--quiet', 'origin', `${commit}:refs/heads/${state.branch}`], 120_000);
    if (pushed.code !== 0) {
      const text = pushed.output.toLowerCase();
      const why = /rejected|non-fast-forward|fetch first|stale info/.test(text) ? 'The repo changed just now. Pull, then push again.'
        : /read-only|403|denied|not allowed|protected branch|pre-receive hook declined/.test(text) ? 'The repo did not accept the push: your account may only be able to read it, or the branch is protected. Nothing changed here.'
          : whyGitFailed(pushed.code, pushed.output, 'repo');
      return stopped(context, why, options.base);
    }
    await must(dir, ['update-ref', `refs/heads/${state.branch}`, commit]);
    await must(dir, ['update-ref', `refs/remotes/origin/${state.branch}`, commit]);
    await must(dir, ['reset', '--quiet', '--hard', commit]);
    await saveState(context.home, { ...state, base: commit, pushedAt: new Date().toISOString() });
    return { results: [], view: await buildView(context, options.base), pushed: await describeCommit(dir, commit) };
  });
}
