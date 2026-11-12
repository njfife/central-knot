// A git repo as the home of the Managed set, on GitHub, GitLab or any git server. Central Knot keeps a clone in its own store and
// runs this computer's git, so the sign-in that already works for git here is the one used; Central Knot never asks for or keeps
// credentials. Pull brings the repo's changes into the tools through the same sync that spreads an edit, so History can undo
// them. Push commits the Managed set as it is on this computer. Nothing moves until one of them is clicked.
//
// The layout (everything else in the repo is left as it is):
//   skills/<folder>/…        a skill, byte for byte
//   mcp/<name>.json          one MCP server, in Claude Code's shape
//   agents/<name>.md         one agent, in Claude Code's format
//   instructions/base.md     the base instructions (~/.central-knot/instructions/base.md)
//
// Three states decide what differs: the commit last pulled or pushed (the base), the repo's latest commit, and the Managed set
// here. A side that changed since the base is the one to bring across. When both changed, the repo's edit wins on Pull (yours is
// kept in History), except that an edit always beats a deletion, on either side.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { agentHash, agentText, fromMarkdown, keyOf, readAgents, safeName, type AgentEntry, type NeutralAgent } from './agentfiles.ts';
import { agentsForRepo, agentsView, applyAgents } from './agents.ts';
import { parseSkill } from './discovery.ts';
import { harnesses } from './harnesses.ts';
import { wantedIn } from './library.ts';
import { appendHistory, applyChanges, deleteEverywhere, displace, manageView, readHistory, replaceCopy, replaceHistory } from './manage.ts';
import { applyMcp, cannotHold, editEntry, fromJson, jsonEntry, keep, mcpView, readMcpRecord, readTool, serverHash, type McpEntry, type NeutralServer } from './mcp.ts';
import { gitEnv, gitFailure, runGit, whyGitFailed, whyPushFailed } from './plugins.ts';
import { PRODUCT } from './values.ts';
import { mcpTools } from './presence.ts';
import { copyTree, errorCode, exists, gateRefusal, itemKey, managedNow, notCopied, sha256 as sha, syncGate, placeCopy, plainError, readRecord, readTree, removeTree, saveRecord, storeDirectory, writeAccess, writeDurably, writeFileChecked, type ShareContext } from './share.ts';
import { undoBase } from './instructions.ts';
import type { BaseUndo, Change, DestinationResult, HarnessId, HistoryEvent, McpResult, RepoChange, RepoCommit, RepoKind, RepoResult, RepoView, SkillFacts, Snapshot } from './types.ts';

/** The base instructions (instructions.ts repoBase): read for Push, applied on Pull. Without it, instructions/ is left alone. */
export interface BaseInstructions { read(): Promise<string | undefined>; apply(text: string | undefined): Promise<{ stopped?: string; undo?: BaseUndo }> }
/** What every repo call may be given: the base-instructions seam, and whether Automatic sync is on (off: MCP and agent deletions wait for it). */
export interface RepoOptions { base?: BaseInstructions; syncOn?: boolean }

type Unfinished = Record<string, {
  reason: string;
  /** The item's id here when the Pull failed, to tell an edit made since. */
  here?: string;
  /** Left because Automatic sync was off (an MCP server's or agent's deletion), so it can go once sync is on. */
  waitedForSync?: true;
  /** Left because it was held (its copy here unreadable, no tool to take it, a fault in the repo's file): while that lasts, the row
   * says so in that cause's own words; once it is gone, `reason` is out of date and not shown. */
  heldFor?: true;
}>;

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
  /** Items the last Pull could not bring in: why, and what this computer had then. Pull tries them again; Push leaves them as the repo has them. */
  unfinished?: Unfinished;
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
  // Only the layout's folders: the rest of the repo (however big) is never read.
  const output = await gitOrThrow(dir, ['ls-tree', '-r', '-z', '--full-tree', treeish, '--', 'skills', 'mcp', 'agents', 'instructions']);
  return output.split('\0').filter(Boolean).map(line => {
    const tab = line.indexOf('\t');
    const [mode, , blob] = line.slice(0, tab).split(' ');
    return { mode, blob, path: line.slice(tab + 1) };
  });
}

/**
 * The bytes of several blobs, read in one `git cat-file --batch`, which is stopped if it hangs. (Not runGit: this needs stdin, and
 * bytes rather than trimmed text.)
 */
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
      // `--batch` answers each name with a header line "<id> blob <size>\n", the bytes, then "\n"; a name it can't find gets
      // "<name> missing\n" alone.
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
/** A file in the clone's working tree: Central Knot's scratch copy for comparing, rewritten on every view, so not fsynced. */
async function writeScratch(path: string, text: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

/** Bytes as written in the clone, whatever this computer's git or the repo's .gitattributes ask (line-ending conversion would change files between tools). */
const keepBytes = (dir: string) => writeFile(join(dir, '.git', 'info', 'attributes'), '* -text\n');

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

/** Commits and trees never change, so what one holds is read once (a few kept, as each view reads three). */
const sidesRead = new Map<string, Promise<Side>>();
/** readSideOnce, remembered per commit or tree. */
function readSide(dir: string, treeish: string | undefined, withBase: boolean): Promise<Side> {
  if (!treeish) return Promise.resolve(new Map());
  const id = `${dir}\0${treeish}\0${withBase}`;
  if (!sidesRead.has(id)) {
    sidesRead.set(id, readSideOnce(dir, treeish, withBase).catch(error => { sidesRead.delete(id); throw error; }));
    while (sidesRead.size > 12) sidesRead.delete(sidesRead.keys().next().value!);
  }
  return sidesRead.get(id)!;
}

/**
 * Reads the Managed set out of a commit or tree, in the layout above. A skill's identity is its files' paths, executable bits and
 * contents, as git holds them; a server's and an agent's is what every tool holds of them (the same ids sync uses).
 */
async function readSideOnce(dir: string, treeish: string, withBase: boolean): Promise<Side> {
  const side: Side = new Map();
  const files = await listTree(dir, treeish);
  const skills = new Map<string, typeof files>();
  for (const file of files) {
    const parts = file.path.split('/');
    // A skill folder that is itself a submodule is listed too (held), so Push keeps it rather than reading it as removed.
    if (parts[0] === 'skills' && (parts.length >= 3 || file.mode === '160000')) skills.set(parts[1], [...(skills.get(parts[1]) ?? []), file]);
  }
  // Each skill's SKILL.md is read too: one no tool could load is said before Pull, never written to sit unread in a tool.
  const skillFiles = await readBlobs(dir, [...skills].flatMap(([folder, entries]) => entries.filter(file => file.path === `skills/${folder}/SKILL.md`).map(file => file.blob)));
  for (const [folder, entries] of skills) {
    const key = itemKey(folder);
    const skillFile = entries.find(file => file.path === `skills/${folder}/SKILL.md`);
    // Files no tool keeps (a .DS_Store, an editor backup) aren't part of what the skill is, as in the tools' own copies.
    const counted = entries.filter(file => !file.path.slice(`skills/${folder}/`.length).split('/').some((part, index, all) => notCopied(part, index === all.length - 1)));
    const lines = counted.map(file => `${file.path.slice(`skills/${folder}/`.length)}\0${file.mode === '100755' ? 'x' : '-'}\0${file.blob}`).sort();
    const link = entries.find(file => file.mode === '120000' || file.mode === '160000');
    const problem = link?.path === `skills/${folder}` ? 'It is a submodule, which Central Knot does not put in your tools.'
      : link ? `It contains a ${link.mode === '120000' ? 'link' : 'submodule'} (${link.path}), which Central Knot does not put in your tools.`
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

// ---------- Why an item can't move, said once ----------

/** Said when copies here differ and sync hasn't settled which is the item yet (Sync off, say): it waits rather than guess. */
const UNSETTLED = 'Its copies here differ and haven’t synced yet. Turn on Automatic sync, or use Sync once on its page, then click Refresh.';
/** Said of a Managed item none of whose copies here can stand for it: each is turned off for it, or unreadable just now. */
const NO_STANDING_COPY = 'No copy here can stand for it just now: each is turned off for it or can’t be read.';
/** Said of an item sync still manages but no tool here shows right now (unreadable, or its folder away). */
const UNSEEN = 'No tool here shows it right now (unreadable, or its folder is away). If it was deleted, Push sends that once sync has recorded it.';
/** Said of an MCP server only Claude Code could take here (its settings are written only with Write to Claude Code). */
const CLAUDE_ONLY = 'A tool besides Claude Code is needed to bring it in: Claude Code’s settings are written only with Write to Claude Code.';
/** Said of an MCP server's deletion only Claude Code's settings could make here. */
const CLAUDE_ONLY_REMOVAL = 'Remove it in Claude Code’s settings, or use Write to Claude Code on MCP servers.';
/**
 * With Sync off, an MCP server's or agent's deletion can't spread past the one tool Pull would remove it from (sync spreads
 * deletions; skills have Delete everywhere), so Pull leaves every copy as it is and tries again once Sync can carry it.
 */
const DELETION_WAITS = 'Its deletion from the repo waits for Automatic sync: turn it on, then Pull again.';
/** Said of a row the last Pull left while it was held, once what held it has gone (it reads again, a tool now takes it, the repo's file is fixed). */
const NOW_FREE = 'What kept it out at the last Pull has gone: Pull brings it in now.';

// ---------- The Managed set here, written into the clone ----------

/** Which tool Pull writes first, and whose copy stands for an item: the tools' own order, Claude Code first (it takes any skill or
 * agent as written). Sync ranks competing edits in an order of its own (mcp.ts, agents.ts); this only picks among equals. */
const byPreference = (first: HarnessId, second: HarnessId) => mcpTools.indexOf(first) - mcpTools.indexOf(second);


/**
 * Which tool's copy stands for a Managed item here, among the tools it syncs to, or why none does: an edit waiting to spread when
 * there is exactly one (that is the newest content here), else the synced content. Preferred: by tool preference, then a tool not
 * in `preferNot` (for an MCP server, Claude Code, whose entry may still be waiting for Write now). Edits waiting to spread that
 * disagree: `UNSETTLED`; no copy left to choose: `NO_STANDING_COPY`.
 */
export function sourceTool(facts: SkillFacts, preferNot: HarnessId[] = []): { tool: HarnessId } | { why: string } {
  const tools = (Object.keys(facts.copies) as HarnessId[]).filter(tool => !facts.off.includes(tool)).sort(byPreference);
  const edited = tools.filter(tool => facts.edited?.includes(tool));
  if (new Set(edited.map(tool => facts.copies[tool]!.hash)).size > 1) return { why: UNSETTLED };
  const tool = edited[0] ?? tools.find(candidate => !preferNot.includes(candidate)) ?? tools[0];
  return tool ? { tool } : { why: NO_STANDING_COPY };
}

/** Managed items that can't go in the repo, with why: Push leaves the repo's copy of each as it is. */
type Unsent = Map<string, { item: SideItem; reason: string }>;
const markUnsendable = (unsent: Unsent, key: string, kind: RepoKind, name: string, reason: string) => unsent.set(key, { item: { key, kind, name, id: '', paths: [] }, reason });

/** Removes what the layout holds in one folder (`keep`: entries left as they are); a README beside them, or any other file, stays. */
async function clearLayout(dir: string, folder: string, isLayout: (entry: Dirent) => boolean, keep: Set<string> = new Set()) {
  for (const entry of await readdir(join(dir, folder), { withFileTypes: true }).catch(() => [] as Dirent[])) {
    if (!isLayout(entry) || keep.has(entry.name)) continue;
    if (entry.isDirectory()) await removeTree(join(dir, folder, entry.name)); else await rm(join(dir, folder, entry.name), { force: true });
  }
}

/**
 * Each skill folder last written into the clone, and its content then: one unchanged since is left as it is, not copied again.
 * Anything else that rewrites the working tree (a checkout, a reset, keeping the base's copy) forgets it.
 */
const writtenPath = (dir: string) => join(dir, '.git', 'ck-written-skills.json');
const forgetWritten = (dir: string) => rm(writtenPath(dir), { force: true });

/** Writes each Managed skill's standing copy under skills/ (unchanged folders left as written); returns the ones that can't go. */
async function writeSkills(dir: string, skills: SkillFacts[]): Promise<Unsent> {
  const unsent: Unsent = new Map();
  // Missing or damaged, it only means every skill is written again.
  const before: Record<string, string> = await readFile(writtenPath(dir), 'utf8').then(JSON.parse).catch(() => ({}));
  const sources = new Map<string, { directory: string; hash: string }>();
  for (const facts of skills.filter(skill => skill.managed)) {
    const source = sourceTool(facts);
    if ('why' in source) { if (source.why === UNSETTLED) markUnsendable(unsent, facts.key, 'skill', facts.name, UNSETTLED); continue; }
    const copy = facts.copies[source.tool];
    if (!copy) continue;
    if (facts.held) { markUnsendable(unsent, facts.key, 'skill', copy.folder, facts.held); continue; }
    sources.set(copy.folder, { directory: copy.directory, hash: copy.hash });
  }
  const unchanged = new Set([...sources].filter(([folder, { hash }]) => before[folder] === hash).map(([folder]) => folder));
  await clearLayout(dir, 'skills', entry => entry.isDirectory(), unchanged);
  const after: Record<string, string> = {};
  for (const [folder, { directory, hash }] of sources) {
    if (unchanged.has(folder) && await exists(join(dir, 'skills', folder))) { after[folder] = hash; continue; }
    const tree = await readTree(directory);
    if (tree.held) { markUnsendable(unsent, itemKey(folder), 'skill', folder, tree.held); continue; }
    await removeTree(join(dir, 'skills', folder));
    await mkdir(join(dir, 'skills'), { recursive: true });
    await copyTree(directory, join(dir, 'skills', folder), tree);
    after[folder] = tree.hash;
  }
  await writeDurably(writtenPath(dir), JSON.stringify(after));
  return unsent;
}

/** What a writer reports: the Managed items here that can't go in the repo, and the keys of items here that aren't Managed. */
interface Written { unsent: Unsent; unmanaged: Set<string> }

/**
 * For MCP servers: the tool entry that stands for each Managed item here (see sourceTool), the items that can't go with why, and
 * the keys of the items that aren't Managed. writeServers then only puts the entries in the repo's format.
 */
function standingEntries<Entry extends { tool: HarnessId }>(kind: 'mcp', all: SkillFacts[], entries: Entry[], entryKey: (entry: Entry) => string,
  rowKey: (name: string) => string, preferNot: HarnessId[] = []): Written & { sources: Entry[] } {
  const byTool = new Map(entries.map(entry => [`${entry.tool}\0${entryKey(entry)}`, entry]));
  const result: Written & { sources: Entry[] } = { unsent: new Map(), unmanaged: new Set(), sources: [] };
  for (const facts of all) {
    if (!facts.managed) { result.unmanaged.add(rowKey(facts.name)); continue; }
    const source = sourceTool(facts, preferNot);
    const entry = 'tool' in source ? byTool.get(`${source.tool}\0${facts.key}`) : undefined;
    if (facts.held || !entry) markUnsendable(result.unsent, rowKey(facts.name), kind, facts.name, facts.held ?? ('why' in source ? source.why : NO_STANDING_COPY));
    else result.sources.push(entry);
  }
  return result;
}

/**
 * Writes each Managed MCP server under mcp/ in Claude Code's shape, over the repo's own file: keys the comparison doesn't count (a
 * hand-written note, a setting only Claude Code has) stay as the repo has them, as an agent's do.
 */
async function writeServers(context: ShareContext, dir: string, tools: HarnessId[], baseId: string | undefined): Promise<Written> {
  await clearLayout(dir, 'mcp', entry => entry.isFile() && entry.name.endsWith('.json'));
  const view = await mcpView(context, tools);
  const entries: McpEntry[] = [];
  for (const tool of view.tools) entries.push(...(await readTool(context, tool)).entries);
  // Not Claude Code's entry when another tool has the server: Claude Code's may still be waiting for Write now.
  const { sources, ...written } = standingEntries('mcp', view.servers, entries, entry => entry.name, serverKey, ['claude-cli']);
  const pathOf = (entry: McpEntry) => `mcp/${toFile(entry.name)}.json`;
  const inRepo = baseId ? await readBlobs(dir, sources.map(entry => `${baseId}:${pathOf(entry)}`)) : new Map<string, Buffer>();
  for (const entry of sources) {
    const repoFile = inRepo.get(`${baseId}:${pathOf(entry)}`)?.toString('utf8');
    let repoExtras: Record<string, unknown> = {};
    try { if (repoFile) repoExtras = fromJson(entry.name, 'claude-cli', '', JSON.parse(repoFile)).extras; } catch { /* not JSON: nothing to keep */ }
    const extras = { ...repoExtras, ...(entry.tool === 'claude-cli' ? entry.extras : {}) };
    await writeScratch(join(dir, pathOf(entry)), `${JSON.stringify(jsonEntry('claude-cli', entry.server, extras), null, 2)}\n`);
  }
  return written;
}

/**
 * Writes every agent in Central Knot's library, On or Off here, under agents/ in Claude Code's format: its current version (or
 * an edit made in a tool and not taken in yet, as a click's own pass would take it in: agents.ts agentsForRepo),
 * with Claude Code's own settings (tools, model) from Claude Code's file for it (agents.ts agentsForRepo), else as the repo's
 * own file has them (all read in one go). Being Off here never takes an agent out of the repo: only Delete from Central Knot
 * does. An agent a tool has that isn't in Central Knot is not sent, and not removed from the repo either.
 */
async function writeAgents(context: ShareContext, dir: string, tools: HarnessId[], baseId: string | undefined): Promise<Written> {
  await clearLayout(dir, 'agents', entry => entry.isFile() && entry.name.endsWith('.md'));
  const written: Written = { unsent: new Map(), unmanaged: new Set() };
  const library = await agentsForRepo(context, tools), view = await agentsView(context, tools);
  const pathOf = (name: string) => `agents/${toFile(name)}.md`;
  const plain = library.filter(entry => entry.agent && entry.claudeFile === undefined);
  const inRepo = baseId ? await readBlobs(dir, plain.map(entry => `${baseId}:${pathOf(entry.item.name)}`)) : new Map<string, Buffer>();
  for (const { item, agent, claudeFile } of library) {
    if (!agent) { markUnsendable(written.unsent, agentKey(item.name), 'agent', item.name, 'Its current version is no longer in Central Knot’s store.'); continue; }
    await writeScratch(join(dir, pathOf(item.name)), claudeFile ?? agentText('claude-cli', agent, inRepo.get(`${baseId}:${pathOf(item.name)}`)?.toString('utf8')));
  }
  const inLibrary = new Set(library.map(entry => entry.item.key));
  for (const found of view.items) if (!inLibrary.has(found.key)) written.unmanaged.add(agentKey(found.name));
  return written;
}


/**
 * Skills and MCP servers sync still records as Managed that weren't written: not found by discovery (a SKILL.md that won't parse,
 * a folder away) or with no copy that could be read. Never offered as removed: absence is only a deletion once sync has recorded
 * one. (Agents are written from Central Knot's library, which holds every one of them: writeAgents.)
 */
async function holdUnseen(context: ShareContext, dir: string, known: Unsent): Promise<Unsent> {
  const unsent: Unsent = new Map();
  const written = (path: string) => exists(join(dir, path));
  // Skill folders by key: the folder's case is the source tool's, which may differ from the record's copies.
  const skillKeys = new Set((await readdir(join(dir, 'skills')).catch(() => [] as string[])).map(itemKey));
  for (const [key, item] of Object.entries((await readRecord(context.home)).record?.items ?? {})) {
    if (item.state === 'shared' && !item.deleted && !known.has(key) && !skillKeys.has(key)) markUnsendable(unsent, key, 'skill', item.name, UNSEEN);
  }
  for (const [name, item] of Object.entries((await readMcpRecord(context.home)).items)) {
    if (item.state === 'shared' && !item.deleted && !known.has(serverKey(name)) && !(await written(`mcp/${toFile(name)}.json`))) markUnsendable(unsent, serverKey(name), 'mcp', name, UNSEEN);
  }
  return unsent;
}

/**
 * Writes the Managed set here into the clone's working tree (Central Knot's own copy; no tool reads it), replacing what the layout
 * holds there, and returns what can't go and what isn't Managed (as each writer does), and the tools here.
 */
async function writeManaged(context: ShareContext, dir: string, baseId: string | undefined, base?: BaseInstructions): Promise<Written & { tools: HarnessId[] }> {
  const view = await manageView(context);
  const servers = await writeServers(context, dir, view.tools, baseId);
  const agents = await writeAgents(context, dir, view.tools, baseId);
  const unsent: Unsent = new Map([...await writeSkills(dir, view.skills), ...servers.unsent, ...agents.unsent]);
  for (const [key, held] of await holdUnseen(context, dir, unsent)) unsent.set(key, held);
  const unmanaged = new Set([...view.skills.filter(skill => !skill.managed).map(skill => skill.key), ...servers.unmanaged, ...agents.unmanaged]);
  if (base) {
    await rm(join(dir, 'instructions', 'base.md'), { force: true });
    const text = await base.read();
    if (text?.trim()) await writeScratch(join(dir, 'instructions', 'base.md'), text);
  }
  return { unsent, unmanaged, tools: view.tools };
}

/** Stages the working tree as it is and returns its tree. Everything is taken, even what the repo's .gitignore names: content moves as-is. */
async function stageTree(dir: string): Promise<string> {
  await gitOrThrow(dir, ['add', '--all', '--force', '--', '.']);
  return (await gitOrThrow(dir, ['write-tree'])).trim();
}

// ---------- What differs ----------

interface Sides {
  base: Side; latest: Side; here: Side; latestId?: string; unsent: Unsent;
  /** The repo no longer has the branch (latest is read as the base). */
  branchGone?: boolean;
  /** Keys of items in a tool here that aren't Managed (so not in `here`): one the repo adds by the same name replaces it. */
  unmanaged?: Set<string>;
  /** No tool here but Claude Code takes MCP servers: Pull can't bring one in (Claude Code's settings wait for Write to Claude Code). */
  noServerTaker?: boolean;
}

/** Writes the Managed set here into the clone, then reads all three sides: the base commit, the repo's latest, and here. */
async function stageSides(context: ShareContext, dir: string, state: RepoState, base?: BaseInstructions): Promise<Sides> {
  await keepBytes(dir).catch(() => undefined);
  const { unsent, unmanaged, tools } = await writeManaged(context, dir, state.base, base);
  // Claude Code's MCP settings are written only with Write to Claude Code, so a server comes in through another tool or not at all.
  const noServerTaker = !tools.some(tool => tool !== 'claude-cli' && mcpTools.includes(tool));
  const tree = await stageTree(dir);
  const latestId = await commitOf(dir, `refs/remotes/origin/${state.branch}`);
  // The branch gone from the repo (deleted there) is not every item deleted: the repo is read as it was at the base, and Push puts
  // the branch back.
  const branchGone = !!state.base && !latestId;
  const [atBase, latest, here] = await Promise.all([readSide(dir, state.base, !!base), readSide(dir, branchGone ? state.base : latestId, !!base), readSide(dir, tree, !!base)]);
  return { base: atBase, latest, here, latestId: branchGone ? state.base : latestId, branchGone, unsent, unmanaged, noServerTaker };
}

const same = (first?: SideItem, second?: SideItem) => first?.id === second?.id;
/** Whether this computer's copy of an unfinished item changed after the Pull that couldn't finish it. */
const editedSince = (left: Unfinished[string], atHere?: SideItem) => left.here !== undefined && left.here !== atHere?.id;
/** Whether the repo has a change to this item that hasn't come in yet: made since the base, or left by the last Pull. */
const repoChangeWaits = (sides: Pick<Sides, 'base' | 'latest'>, unfinished: Unfinished, key: string) => !same(sides.base.get(key), sides.latest.get(key)) || !!unfinished[key];
/** What happened to an item between two sides: gone from the second is a removal (also when neither has it: a deletion kept waiting). */
const changeFrom = (from?: SideItem, to?: SideItem): RepoChange['change'] => (!to ? 'removed' : !from ? 'added' : 'changed');

/**
 * What Pull does with an incoming row, which Pull itself and the page both read: `waits` (a deletion that needs Automatic sync, which
 * is off), `again` (the last Pull left it; Pull tries it again), `stuck` (held: it can't come in), else `moves`.
 */
function pullOf(row: RepoChange): NonNullable<RepoChange['pull']> {
  if (row.sync === 'waits') return 'waits';
  if (row.retry) return 'again';
  return row.held ? 'stuck' : 'moves';
}

/**
 * Sorts what differs into what Pull brings in and what Push sends. `unfinished`: items the last Pull couldn't finish, offered to
 * Pull again while the repo still has what it had then. `syncOn`: whether Automatic sync is on; while it is off, an MCP server's or
 * agent's deletion coming in waits for it (`sync: 'waits'`), since Pull can't spread one without it.
 */
export function classify(sides: Pick<Sides, 'base' | 'latest' | 'here' | 'unsent' | 'unmanaged' | 'noServerTaker'>, unfinished: Unfinished = {}, syncOn = true): { incoming: RepoChange[]; outgoing: RepoChange[] } {
  const incoming: RepoChange[] = [];
  const outgoing: RepoChange[] = [];
  const { base, latest, here, unsent } = sides;
  // Unsent keys too: one whose deletion in the repo waits is in no side once the base has moved past it.
  for (const key of new Set([...base.keys(), ...latest.keys(), ...here.keys(), ...unsent.keys()])) {
    const [atBase, inRepo, atHere] = [base.get(key), latest.get(key), here.get(key)];
    // An item that can't be sent from here goes on exactly one list, held, with why: coming in when the repo has a change to it
    // waiting (Pull won't take it while this computer's copy can't be read, and keeps it for later), else going out (below).
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
    // The last Pull couldn't finish it. Unless it was edited here since, the repo's version (as it is now) is still what comes in; an
    // edit since keeps the usual rules: it beats the repo's deletion, and gives way to the repo's edit with History keeping it.
    else if (unfinished[key]) {
      const editedHere = editedSince(unfinished[key], atHere);
      if (editedHere && atHere && !inRepo) outgoing.push({ ...row, change: 'added', keptHere: true });
      else incoming.push({ ...row, change: changeFrom(atHere, inRepo), held: unfinished[key].heldFor ? NOW_FREE : unfinished[key].reason, retry: true, alsoHere: editedHere ? (atHere ? 'changed' : 'removed') : undefined });
    }
    else if (same(atHere, atBase)) incoming.push({ ...row, change: changeFrom(atBase, inRepo), alsoHere: !atHere && sides.unmanaged?.has(key) ? 'unmanaged' : undefined });
    else if (same(inRepo, atBase)) outgoing.push({ ...row, change: changeFrom(atBase, atHere) });
    // Both changed. An edit beats a deletion: removed in the repo but edited here stays, and goes out with the next Push.
    else if (!inRepo) outgoing.push({ ...row, change: 'added', keptHere: true });
    // Removed here (or no longer Managed) but edited in the repo: the edit comes back. Otherwise the repo's edit wins.
    else incoming.push({ ...row, change: changeFrom(atBase, inRepo), alsoHere: atHere ? 'changed' : 'removed' });
  }
  for (const [key, { item, reason }] of unsent) if (!repoChangeWaits(sides, unfinished, key)) outgoing.push({ key, kind: item.kind, name: item.name, change: latest.has(key) ? 'changed' : 'added', held: reason });
  const order = (first: RepoChange, second: RepoChange) => first.kind.localeCompare(second.kind) || first.name.localeCompare(second.name);
  return { incoming: incoming.map(row => settleIncoming(row, sides, unfinished, syncOn)).sort(order), outgoing: outgoing.sort(order) };
}

/**
 * The finished incoming row, from what classify found and the conditions here: an MCP server no tool here takes can't come in (said
 * before Pull, not found by it); an MCP server's or agent's deletion waits while Automatic sync is off, and one that waited says so
 * once it is on; then what Pull does with it (pullOf).
 */
function settleIncoming(row: RepoChange, sides: Pick<Sides, 'noServerTaker'>, unfinished: Unfinished, syncOn: boolean): RepoChange {
  // Pull could act on it: not held, or held only until the last Pull's reason is tried again.
  const pullCouldAct = !row.held || !!row.retry;
  if (row.kind === 'mcp' && sides.noServerTaker && pullCouldAct) {
    return { ...row, held: row.change === 'removed' ? CLAUDE_ONLY_REMOVAL : CLAUDE_ONLY, retry: undefined, pull: 'stuck' };
  }
  const deletionNeedingSync = pullCouldAct && row.change === 'removed' && (row.kind === 'mcp' || row.kind === 'agent');
  const sync = !deletionNeedingSync ? undefined : !syncOn ? 'waits' as const : unfinished[row.key]?.waitedForSync ? 'ready' as const : undefined;
  const settled: RepoChange = { ...row, sync };
  return { ...settled, pull: pullOf(settled) };
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

async function buildView(context: ShareContext, { base, syncOn }: RepoOptions): Promise<RepoView> {
  const access = await writeAccess(context);
  const found = await openClone(context);
  if (!found) return { connected: false, access };
  const { state, dir } = found;
  const sides = await stageSides(context, dir, state, base);
  // An unfinished item that is now the same here and in the repo (put right by hand, say) is finished.
  const settled = Object.keys(state.unfinished ?? {}).filter(key => !sides.unsent.has(key) && same(sides.latest.get(key), sides.here.get(key)));
  if (settled.length && access.allowed) {
    for (const key of settled) delete state.unfinished![key];
    await saveState(context.home, { ...state, unfinished: Object.keys(state.unfinished!).length ? state.unfinished : undefined });
  }
  const { incoming, outgoing } = classify(sides, state.unfinished, syncOn);
  return {
    connected: true, access, url: state.url, branch: state.branch, base: await describeCommit(dir, state.base), latest: await describeCommit(dir, sides.latestId),
    pulledAt: state.pulledAt, pushedAt: state.pushedAt, checkedAt: state.checkedAt, problem: state.problem, incoming, outgoing,
    pushBlocked: sides.latestId !== state.base ? PULL_FIRST : undefined, branchGone: sides.branchGone,
  };
}

/**
 * The repo as last checked, against the Managed set here now. `check` asks the repo for its latest commit first. It writes only
 * Central Knot's own clone (to compare), never a tool's files.
 */
export function repoView(context: ShareContext, options: RepoOptions & { check?: boolean } = {}): Promise<RepoView> {
  return exclusive(async () => {
    // A page's check gives up sooner than Pull's: a Pull or Push waiting behind it holds every other change in the app.
    if (options.check) await check(context, 20_000);
    return buildView(context, options);
  });
}

/** Asks the repo for its latest commit; a failure is kept to show, and changes nothing else. */
async function check(context: ShareContext, timeoutMs?: number): Promise<string | undefined> {
  const found = await openClone(context);
  if (!found || !(await writeAccess(context)).allowed) return undefined;
  const fetched = await git(found.dir, ['fetch', '--quiet', '--prune', 'origin'], timeoutMs);
  const failure = fetched.code === 0 ? undefined : gitFailure(fetched.code, fetched.output, 'repo');
  // The address is only changed by connecting again, so that step is said where the address may be the cause.
  const problem = failure && (failure.state === 'no-access' || failure.state === 'sign-in') ? `${failure.message} To use another address, Disconnect and connect again.` : failure?.message;
  await saveState(context.home, { ...found.state, checkedAt: new Date().toISOString(), problem });
  return problem;
}

// ---------- Connect and disconnect ----------

/** A result that changed nothing, saying why, with the page's view as it stands. */
const refusal = async (context: ShareContext, reason: string, options: RepoOptions): Promise<RepoResult> => ({ stopped: reason, results: [], view: await buildView(context, options) });

/**
 * Clones the repo into Central Knot's store. Nothing is written to the tools: what the repo holds shows as changes to Pull.
 * `branch` empty means the repo's default branch (for an empty repo, the branch its HEAD names).
 */
export function connectRepo(context: ShareContext, url: string, branch: string, options: RepoOptions = {}): Promise<RepoResult> {
  return exclusive(async () => {
    const access = await writeAccess(context);
    if (!access.allowed) return refusal(context, access.reason, options);
    const address = url.trim();
    const wanted = branch.trim();
    if (!address) return refusal(context, 'Enter the repo’s address: the one you would give `git clone`.', options);
    // An option-looking value would reach git as a flag: refused, like a branch name git itself would refuse.
    if (address.startsWith('-')) return refusal(context, 'That isn’t a repo address.', options);
    if (wanted && (wanted.startsWith('-') || (await runGit(['check-ref-format', '--branch', wanted], 10_000)).code !== 0)) return { ...await refusal(context, `“${wanted}” isn’t a branch name git accepts.`, options), field: 'branch' };
    if (await openClone(context)) return refusal(context, 'A repo is already connected. Disconnect it first.', options);
    const dir = cloneFolder(context.home);
    const stage = `${dir}.${randomUUID()}`;
    await mkdir(storeDirectory(context.home), { recursive: true });
    await removeTree(dir);
    // Nothing checked out yet: the first files are written only once the clone's own settings below are in place.
    const cloned = await runGit(['clone', '--quiet', '--no-checkout', '--no-recurse-submodules', '--', address, stage], 120_000);
    if (cloned.code !== 0) { await removeTree(stage); return refusal(context, whyGitFailed(cloned.code, cloned.output, 'repo'), options); }
    try {
      // Empty means no branches at all; a HEAD naming a branch that was never pushed (made as master, pushed as main) is not empty.
      const empty = !(await git(stage, ['for-each-ref', '--count=1', '--format=%(refname)', 'refs/remotes/origin/'])).output.trim();
      const head = (await git(stage, ['symbolic-ref', '--short', 'HEAD'])).output.trim();
      // An empty repo keeps the default branch git chose for it (its HEAD), so a plain clone of it later finds this branch.
      const chosen = wanted || head || 'main';
      if (!empty && !(await commitOf(stage, `refs/remotes/origin/${chosen}`))) {
        await removeTree(stage);
        return { ...await refusal(context, wanted ? `That repo has no branch named “${chosen}”.` : `That repo’s default branch (${chosen}) has no commits. Enter the branch to use.`, options), field: 'branch' };
      }
      // The clone keeps line endings and file names exactly as written, whatever this computer's git settings say.
      for (const [name, value] of [['core.autocrlf', 'false'], ['core.precomposeunicode', 'true'], ['core.quotepath', 'false']]) await gitOrThrow(stage, ['config', name, value]);
      await keepBytes(stage);
      if (empty) await gitOrThrow(stage, ['symbolic-ref', 'HEAD', `refs/heads/${chosen}`]);
      else await gitOrThrow(stage, ['checkout', '--quiet', '--force', '-B', chosen, `refs/remotes/origin/${chosen}`]);
      await rename(stage, dir);
      await saveState(context.home, { url: address, branch: chosen, checkedAt: new Date().toISOString() });
    } catch (error) {
      await removeTree(stage);
      return refusal(context, error instanceof Error ? error.message : plainError(error), options);
    }
    return { results: [], view: await buildView(context, options) };
  });
}

/** Forgets the repo: its clone goes, and the tools and the repo itself stay exactly as they are. */
export function disconnectRepo(context: ShareContext, options: RepoOptions = {}): Promise<RepoResult> {
  return exclusive(async () => {
    const access = await writeAccess(context);
    if (!access.allowed) return refusal(context, access.reason, options);
    await rm(statePath(context.home), { force: true });
    await removeTree(cloneFolder(context.home));
    return { results: [], view: await buildView(context, options) };
  });
}

// ---------- Pull ----------

/** An item that didn't come in, and why (no tool named: it concerns the item, not one tool's copy). */
const notIn = (item: string, message: string): DestinationResult => ({ item, outcome: 'held', message });
/** A write into the first tool that didn't happen: changed just now (left as it is), or any other failure, in plain words. */
const writeProblem = (change: RepoChange, tool: HarnessId, noun: string, error: unknown) => notIn(change.name, errorCode(error) === 'CK_CHANGED'
  ? `${harnesses[tool].name}’s ${noun} changed just now, so it was left as it is. Pull again.` : `Could not write ${harnesses[tool].name}’s ${noun}: ${plainError(error)}`);
/** Said when sync would not take the repo's version on (the reason is in the results beside it): Pull tries again next time. */
const notManaged = (change: RepoChange, tool: HarnessId) => notIn(change.name, `It is in ${harnesses[tool].name} now, but sync couldn’t make it Managed yet.`);
/**
 * The end of an MCP server's or agent's pull. A pass that writes the repo's version runs for that one item, as Apply all does; a
 * deletion needs an ordinary pass (only sync spreads deletions), decided at once for this item alone. Either way only this item's
 * results are kept (`own`), and a version that went in but that sync didn't take on is said.
 */
async function passOutcome(done: { stopped?: string; results: DestinationResult[] }, change: RepoChange, own: (result: DestinationResult) => boolean,
  writer: HarnessId, isManaged?: () => Promise<boolean>): Promise<DestinationResult[]> {
  if (done.stopped) return [notIn(change.name, done.stopped)];
  const results = done.results.filter(own);
  // Asked only when the repo's version was written (a deletion has nothing to be Managed).
  return !isManaged || await isManaged() ? results : [...results, notManaged(change, writer)];
}
/**
 * What Pull wrote into the first tool before sync carried it on, so History can undo that copy too: what was there (`before`; none for
 * an item no tool here had) and what went in. `pending`: what was there was an edit made here that hadn't spread yet, so it is what
 * Undo puts back. `settingsOnly`: only an agent's Claude Code settings changed, which sync's versions don't tell apart.
 */
interface FirstWrite { change: RepoChange; tool: HarnessId; before?: string; after: string; pending?: boolean; settingsOnly?: HistoryEvent['settingsFile'] }
type Wrote = (write: Omit<FirstWrite, 'change'>) => void;
/** The History event for a copy Pull replaced in one tool, when sync has none to name it: Undo puts `before` back there. */
const pullEdit = (change: RepoChange, tool: HarnessId, before: string, after: string, settingsFile?: HistoryEvent['settingsFile']): HistoryEvent =>
  ({ id: randomUUID(), at: new Date().toISOString(), key: change.key, item: change.name, kind: 'edit', winner: { tool, hash: after }, losers: [], previous: before, orderProved: true, via: 'repo', settingsFile });

/**
 * Puts the repo's version of one skill into one tool, then makes that copy the one every tool uses, as choosing a copy does: History
 * keeps each copy it replaced, and Undo puts them back. Removed in the repo: deleted everywhere it synced, with Restore in History.
 */
async function pullSkill(context: ShareContext, dir: string, change: RepoChange, item: SideItem | undefined, wrote: Wrote): Promise<DestinationResult[]> {
  const view = await manageView(context);
  const facts = view.skills.find(skill => skill.key === change.key);
  if (!item) {
    if (!facts?.managed) return [];
    const done = await deleteEverywhere(context, change.key);
    return done.stopped ? [notIn(change.name, done.stopped)] : done.results;
  }
  const source = join(dir, 'skills', item.folder!);
  const tree = await readTree(source);
  if (tree.held) return [notIn(change.name, tree.held)];
  const writer = [...view.tools].sort(byPreference).find(tool => !facts?.off.includes(tool) && !view.writes[tool]?.blocked && (!facts?.copies[tool] || facts.copies[tool]!.writable));
  if (!writer) return [notIn(change.name, 'No tool here can take it: each is turned off for it or can’t be written.')];
  const copy = facts?.copies[writer];
  try {
    if (copy && copy.hash !== tree.hash) {
      // On sync's record before the copy is replaced, as sync does itself: the next pass names it in History, and nothing prunes it.
      const { record } = await readRecord(context.home);
      const recorded = record?.items[change.key];
      if (record && recorded) { displace(recorded, writer, copy.hash); await saveRecord(context.home, record); }
      await replaceCopy(context, change.key, source, copy.directory, copy.hash);
      // A skill sync never managed has no record to name it, so the pull's own event does, before the pass could prune it.
      if (!recorded) await appendHistory(context, [pullEdit(change, writer, copy.hash, tree.hash)]);
    } else if (!copy) await placeCopy(context, source, { harness: writer, directory: join(view.writes[writer]!.to, item.folder!), limits: [] }, tree);
    // History accounts for this write when sync can't: a skill no tool had (no facts), or this tool's own copy replaced (copy).
    if (!facts || copy) wrote({ tool: writer, before: copy?.hash, after: tree.hash, pending: facts?.edited?.includes(writer) });
  } catch (error) {
    return [writeProblem(change, writer, 'copy', error)];
  }
  const done = await applyChanges(context, [{ key: change.key, managed: true, off: facts?.off ?? [], use: writer, useHash: tree.hash }], false, { only: new Set([change.key]) });
  return passOutcome(done, change, () => true, writer, async () => (await manageView(context)).skills.some(skill => skill.key === change.key && skill.managed));
}

/** MCP servers: written to one tool other than Claude Code (which waits for Write now, MCP-02), then spread by sync. */
async function pullServer(context: ShareContext, dir: string, change: RepoChange, item: SideItem | undefined, wrote: Wrote): Promise<DestinationResult[]> {
  const tools = await managedNow(context, await context.read());
  const view = await mcpView(context, tools);
  const facts = view.servers.find(server => server.key === change.name);
  if (!item && !facts?.managed) return [];
  const server = item && parseServer(change.name, await readFile(join(dir, item.paths[0]), 'utf8'));
  if (item && !server) return [notIn(change.name, item.problem ?? 'It could not be read.')];
  const writer = view.tools.filter(tool => tool !== 'claude-cli').sort(byPreference).find(tool => !facts?.off.includes(tool) && (server ? !cannotHold(tool, server) : !!facts?.copies[tool]));
  if (!writer) return [notIn(change.name, server ? CLAUDE_ONLY : CLAUDE_ONLY_REMOVAL)];
  const here = (await readTool(context, writer)).entries.find(entry => entry.name === change.name);
  if (here?.hash !== (server ? serverHash(server) : undefined)) {
    // What this tool had is kept first, so Undo can put it back.
    if (here) await keep(context, change.name, here.server, here);
    const problem = await editEntry(context, writer, change.name, here?.hash, server);
    if (problem) return [notIn(change.name, problem)];
    // History accounts for this write when sync can't: a server no tool had (no facts), or this tool's own entry replaced (here).
    if (server && (!facts || here)) wrote({ tool: writer, before: here?.hash, after: serverHash(server), pending: facts?.edited?.includes(writer) });
  }
  const changes: Change[] = server ? [{ key: change.name, managed: true, off: facts?.off ?? [], use: writer, useHash: serverHash(server) }] : [];
  const done = await applyMcp(context, tools, changes, { only: server ? new Set([change.name]) : undefined, decideNow: new Set([change.name]) });
  return passOutcome(done, change, result => result.item === change.name, writer,
    server ? async () => (await mcpView(context, tools)).servers.some(entry => entry.key === change.name && entry.managed) : undefined);
}

/**
 * Agents: the repo's content becomes the agent's current version in Central Knot's library, "pulled from the Git repo", and a pass
 * applies it wherever the agent is On here (librarypass.ts pull); being On or Off here doesn't change. Claude Code then takes the repo's
 * file as written, its own settings included, where it has the agent. Removed in the repo: deleted from Central Knot, with
 * Restore in History.
 */
async function pullAgent(context: ShareContext, dir: string, change: RepoChange, item: SideItem | undefined, wrote: Wrote): Promise<DestinationResult[]> {
  const tools = await managedNow(context, await context.read());
  const key = keyOf(change.name);
  const only = new Set([key]);
  const ours = (result: DestinationResult) => keyOf(result.item) === key;
  const outcome = (done: { stopped?: string; results: DestinationResult[] }) => (done.stopped ? [notIn(change.name, done.stopped)] : done.results.filter(ours));
  if (!item) return outcome(await applyAgents(context, tools, [], { only, pulled: new Map([[key, { removed: true }]]) }));
  const text = await readFile(join(dir, item.paths[0]), 'utf8');
  const agent = fromMarkdown(change.name, text);
  if (!agent) return [notIn(change.name, item.problem ?? 'It could not be read.')];
  const done = await applyAgents(context, tools, [], { only, pulled: new Map([[key, { agent, claudeFile: text }]]) });
  const here = (await agentsView(context, tools)).library[key];
  // Only where Claude Code has the agent (it is On and not kept out there): a copy it holds otherwise is not Central Knot's.
  if (done.stopped || !tools.includes('claude-cli') || !here || !wantedIn(here, 'claude-cli')) return outcome(done);
  return [...outcome(done), ...await pullClaudeSettings(context, change, agentHash(agent), text, wrote)];
}

/**
 * Claude Code's own settings for an agent (model, tools) as the repo has them: where Claude Code has the agent at the version
 * pulled and only those settings differ, the repo's file is written as it is (a copy holding another version, an edit made
 * there that won, is left as it is). No version tells such a change apart, so it has its own History entry and Undo
 * (undoSettingsChange).
 */
async function pullClaudeSettings(context: ShareContext, change: RepoChange, hash: string, text: string, wrote: Wrote): Promise<DestinationResult[]> {
  const existing = (await readAgents(context, 'claude-cli')).entries.find(entry => entry.key === keyOf(change.name));
  if (!existing || existing.hash !== hash || existing.text === text) return [];
  try { await writeFileChecked(existing.file, text, existing.text); } catch (error) { return [writeProblem(change, 'claude-cli', 'file', error)]; }
  wrote({ tool: 'claude-cli', before: existing.hash, after: existing.hash, settingsOnly: await keepSettingsFile(context, existing, text) });
  return [];
}

/** Keeps a file whole in Central Knot's store under its own bytes, where nothing writes over it, and returns where. */
async function keepWhole(context: ShareContext, key: string, text: string): Promise<string> {
  const kept = join(storeDirectory(context.home), 'items', 'agent-settings', encodeURIComponent(key), `${sha(text)}.md`);
  await writeDurably(kept, text);
  return kept;
}

/**
 * Only Claude Code's own settings (model, tools) differ: sync's kept versions are keyed by what every tool holds, which these don't
 * change, so the earlier file is kept whole for this pull's Undo.
 */
async function keepSettingsFile(context: ShareContext, existing: AgentEntry, next: string): Promise<HistoryEvent['settingsFile']> {
  return { path: existing.file, kept: await keepWhole(context, existing.key, existing.text), wrote: sha(next) };
}

/**
 * Undo (and Redo) of a change to only an agent's Claude Code settings: the file it replaced goes back, only while the file still
 * holds what that change wrote (an edit since is never lost), and the file it displaces is kept, in a 'restored' event of its own
 * that undoes this. Nothing spreads: no other tool has those settings. The same gates as every restore come first.
 */
export async function undoSettingsChange(context: ShareContext, eventId: string): Promise<{ stopped?: string; results: DestinationResult[]; harnessWrites: number }> {
  const stop = (stopped: string) => ({ stopped, results: [], harnessWrites: 0 });
  const access = await writeAccess(context);
  if (!access.allowed) return stop(access.reason);
  const gate = await syncGate(context);
  const gated = gateRefusal(gate);
  if (gated) return stop(gated);
  const history = await readHistory(context);
  const past = history.find(event => event.id === eventId);
  if (!past?.settingsFile) return stop('That change can’t be restored.');
  if (past.undoneBy) return stop('That change was already undone.');
  const earlier = await readFile(past.settingsFile.kept, 'utf8').catch(() => undefined);
  if (earlier === undefined) return stop('The kept version is no longer in Central Knot’s store, so it can’t be restored.');
  const now = await readFile(past.settingsFile.path, 'utf8').catch(() => undefined);
  if (now === undefined || sha(now) !== past.settingsFile.wrote) return stop(`${past.item} was edited since, so nothing was undone. Its file is as you left it.`);
  try { await writeFileChecked(past.settingsFile.path, earlier, now); }
  catch (error) { return stop(`It couldn’t be put back: ${plainError(error)}`); }
  const id = randomUUID();
  past.undoneBy = id;
  const winner = past.winner ?? { tool: 'claude-cli' as HarnessId, hash: '' };
  await replaceHistory(context, [...history, { id, at: new Date().toISOString(), key: past.key, item: past.item, kind: 'restored', winner, losers: [{ tool: winner.tool, hash: winner.hash }], previous: winner.hash, orderProved: true,
    settingsFile: { path: past.settingsFile.path, kept: await keepWhole(context, past.key, now), wrote: sha(earlier) } }]);
  return { results: [{ item: past.item, harness: winner.tool, outcome: 'written', message: 'Its earlier Claude Code settings are back.' }], harnessWrites: 1 };
}

/**
 * The base instructions: handed to the base-instructions feature to apply (only reached when this build has it, so `base` is set).
 * An edit or a deletion is in History, with the base's own Undo, which puts the earlier base and its tools back.
 */
async function pullBase(context: ShareContext, dir: string, change: RepoChange, item: SideItem | undefined, base: BaseInstructions | undefined): Promise<DestinationResult[]> {
  const done = await base?.apply(item ? await readFile(join(dir, item.paths[0]), 'utf8') : undefined);
  if (done?.stopped) return [notIn(change.name, done.stopped)];
  if (done?.undo) await appendHistory(context, [{ id: randomUUID(), at: new Date().toISOString(), key: change.key, item: change.name, kind: item ? 'edit' : 'deleted', losers: [], orderProved: true, base: done.undo }]);
  if (item) return [{ item: change.name, outcome: 'written', message: 'Base instructions updated. History can undo it.' }];
  return [{ item: change.name, outcome: 'written', message: 'Deleted in the repo, so the base instructions were emptied and taken out of the tools that got them. History can undo it.' }];
}

/** Undo of a Pull that edited or deleted the base instructions: the base's own Undo, said per tool. Only once, and only while the base is still as the Pull left it. */
export async function undoPulledBase(context: ShareContext, snapshots: Snapshot[], eventId: string): Promise<{ stopped?: string; results: DestinationResult[]; harnessWrites: number }> {
  const history = await readHistory(context);
  const past = history.find(event => event.id === eventId);
  if (!past?.base) return { stopped: 'That change can’t be restored.', results: [], harnessWrites: 0 };
  if (past.undoneBy) return { stopped: 'That change was already undone.', results: [], harnessWrites: 0 };
  const done = await undoBase(context, snapshots, past.base);
  if (done.stopped) return { stopped: done.stopped, results: [], harnessWrites: 0 };
  // No event of its own: the base keeps every text it replaces as an earlier version on the Instructions page.
  past.undoneBy = randomUUID();
  await replaceHistory(context, history);
  const results: DestinationResult[] = [
    // What the Pull replaced is what comes back: the base it emptied, the text before its edit, or no base at all.
    { item: past.item, outcome: 'written', message: past.kind === 'deleted' ? 'The base instructions are back.' : past.base.text.trim() ? 'The base instructions are as they were before that Pull.' : 'The base instructions are empty again, as before that Pull.' },
    ...done.written.map(file => ({ item: past.item, harness: file.tool, outcome: 'written' as const, message: `Back in ${harnesses[file.tool].name}.` })),
    ...done.left.map(file => ({ item: past.item, harness: file.tool, outcome: 'held' as const, message: file.why === 'edited' ? `${harnesses[file.tool].name}’s file changed since, so it was left as it is.` : `${harnesses[file.tool].name}’s file could not be written.` })),
    ...(done.problem ? [notIn(past.item, done.problem)] : []),
  ];
  return { results, harnessWrites: done.written.length };
}

/**
 * Says in History that Pull made these events (`made`: each pulled item's new events), so their Undo reads as undoing a pull, and
 * accounts for the copy Pull wrote into the first tool itself, which sync never saw being replaced:
 * - an item no tool here had: that copy joins its 'added' event (one is made if sync added no other copy), so Undo add takes every
 *   copy away, as it does after Apply all;
 * - an item whose first tool's copy Pull replaced: that copy joins the event sync made (first, when it was an edit made here that
 *   hadn't spread, so Undo puts that back), or, when sync had nothing else to replace (the only tool with it, or only an agent's
 *   Claude Code settings changed), an edit event of its own. Its content was kept before the write.
 * (This reaches into the engines' bookkeeping, the 'added' event's losers and a skill copy's `created`; an engine option for "the
 * caller placed this first copy" would let sync record it itself.)
 */
async function tellHistory(context: ShareContext, made: Set<string>, firstWrites: FirstWrite[]) {
  const history = (await readHistory(context)).map(event => (made.has(event.id) ? { ...event, via: 'repo' as const } : event));
  for (const write of firstWrites) {
    const mine = history.filter(event => made.has(event.id) && event.key === write.change.key);
    if (write.before === undefined) await accountForNewItem(context, history, mine, write);
    else if (write.before !== write.after || write.settingsOnly) accountForReplacedCopy(history, mine, write as FirstWrite & { before: string });
  }
  await replaceHistory(context, history);
}

/** An item no tool here had: Pull's first copy joins its 'added' event (made if sync added no other copy), and a skill's record says Central Knot made it. */
async function accountForNewItem(context: ShareContext, history: HistoryEvent[], mine: HistoryEvent[], { change, tool, after }: FirstWrite) {
  const added = mine.find(event => event.kind === 'added');
  if (added) added.losers.unshift({ tool, hash: after });
  else history.push({ id: randomUUID(), at: new Date().toISOString(), key: change.key, item: change.name, kind: 'added', losers: [{ tool, hash: after }], orderProved: true, via: 'repo' });
  // A skill's Undo add removes only copies its record says Central Knot made; this one was.
  if (change.kind !== 'skill') return;
  const { record } = await readRecord(context.home);
  const copy = record?.items[change.key]?.copies.find(entry => entry.harness === tool);
  if (record && copy) { copy.created = true; await saveRecord(context.home, record); }
}

/**
 * A copy Pull replaced in the first tool: it joins the event sync made for the pull (first when it was an edit here that hadn't
 * spread, so Undo puts that back), or, when sync replaced nothing else, is said in an edit event of its own. A change to only an
 * agent's Claude Code settings always has its own event: its Undo puts back that one file, which no sync event could.
 */
function accountForReplacedCopy(history: HistoryEvent[], mine: HistoryEvent[], { change, tool, before, after, pending, settingsOnly }: FirstWrite & { before: string }) {
  if (settingsOnly) { history.push(pullEdit(change, tool, before, after, settingsOnly)); return; }
  // The event sync made for this pull, when it replaced other tools' copies too.
  const syncEvent = mine.find(event => event.kind === 'chosen');
  // An edit event already naming this copy: sync's, or Pull's own (`pullSkill` writes one for a skill sync had no record of).
  const ownEarlierEvent = mine.find(event => event !== syncEvent && event.kind === 'edit' && event.previous === before);
  if (!syncEvent) { if (!ownEarlierEvent) history.push(pullEdit(change, tool, before, after)); return; }
  // One row for the pull: sync's event takes this copy over from the earlier one.
  if (ownEarlierEvent) history.splice(history.indexOf(ownEarlierEvent), 1);
  // Named per tool, even when its old copy matched another's: the row says every tool the pull changed.
  if (syncEvent.losers.some(loser => loser.tool === tool)) return;
  if (pending) syncEvent.losers.unshift({ tool, hash: before }); else syncEvent.losers.push({ tool, hash: before });
}

/**
 * Runs Pull or Push, turning a failure partway (git or the disk refusing, a file moving underneath) into a refusal that says why,
 * with the page's view as it now stands. If even the view can't be read, the error goes on as it was.
 */
async function sayingWhy(context: ShareContext, options: RepoOptions, action: 'Pull' | 'Push', work: () => Promise<RepoResult>): Promise<RepoResult> {
  try { return await work(); }
  catch (error) {
    // Push writes no tool; Pull's writes are in History (it is told what Pull made even when an item fails).
    const reason = `${action} couldn’t finish: ${plainError(error)} ${action === 'Pull' ? 'Anything it changed in your tools is in History.' : 'Nothing in your tools changed.'}`;
    try { return await refusal(context, reason, options); } catch { throw error; }
  }
}

/** What Pull and Push both start from: a writable home, a connected repo checked just now, and the three sides compared. */
async function readyToMove(context: ShareContext, options: RepoOptions): Promise<{ dir: string; state: RepoState; sides: Sides } | { refused: RepoResult }> {
  const access = await writeAccess(context);
  if (!access.allowed) return { refused: await refusal(context, access.reason, options) };
  const found = await openClone(context);
  if (!found) return { refused: await refusal(context, 'No repo is connected.', options) };
  // Pull writes a tool's copy before sync runs, so sync's own gate (another build syncing, a record to resume) is asked first.
  const gate = await syncGate(context);
  const gated = gateRefusal(gate);
  if (gated) return { refused: await refusal(context, gated, options) };
  const problem = await check(context);
  if (problem) return { refused: await refusal(context, problem, options) };
  const state = (await readState(context.home))!;
  return { dir: found.dir, state, sides: await stageSides(context, found.dir, state, options.base) };
}

/**
 * Brings the repo's latest commit into the tools: each item that changed there since the last pull, through sync, so History
 * records it with Undo. An item that can't come in is said, kept out of the next Push, and tried again by the next Pull.
 */
export function pullRepo(context: ShareContext, options: RepoOptions = {}): Promise<RepoResult> {
  return exclusive(() => sayingWhy(context, options, 'Pull', async () => {
    const ready = await readyToMove(context, options);
    if ('refused' in ready) return ready.refused;
    const { dir, state, sides } = ready;
    if (!sides.latestId) return { results: [], view: await buildView(context, options), pulled: 0 };
    const incoming = classify(sides, state.unfinished, options.syncOn !== false).incoming;
    const todo = incoming.filter(change => change.pull !== 'stuck');
    // The repo's latest commit, exactly, is what each item is copied from.
    await forgetWritten(dir);
    await gitOrThrow(dir, ['checkout', '--quiet', '--force', '-B', state.branch, sides.latestId]);
    await gitOrThrow(dir, ['clean', '--quiet', '-ffdx']);
    const results: DestinationResult[] = [];
    const unfinished: Unfinished = {};
    // What this computer had, to tell an edit made since; when nothing here could be read, the last synced state (the base) stands in.
    // What this computer had: its copy now; else what was recorded when it was first left (an unreadable copy's id isn't known); on
    // a first Pull with nothing readable here, nothing is known, and the repo's version comes in with History keeping yours.
    const unfinish = (key: string, reason: string, flags: Pick<Unfinished[string], 'waitedForSync' | 'heldFor'> = {}) => {
      const earlier = state.unfinished?.[key];
      unfinished[key] = { reason, here: sides.here.get(key)?.id ?? (earlier ? earlier.here : sides.base.get(key)?.id), ...flags };
    };
    // A held repo change (this computer can't read its copy, no tool takes it, the repo's file has a fault) isn't taken, and isn't
    // lost: it is kept as unfinished with what this computer had, so once the base moves on it still reads as the repo's change
    // (never as one made here, which the next Push would send), and comes in once the cause goes.
    for (const change of incoming) if (change.pull === 'stuck') unfinish(change.key, change.held!, { heldFor: true });
    const firstWrites: FirstWrite[] = [];
    const waitsForClaude: string[] = [];
    const made = new Set<string>();
    // History is told what Pull made even if an item fails partway, so Undo covers every copy it wrote.
    try {
      for (const change of todo) {
        const item = sides.latest.get(change.key);
        const wrote: Wrote = write => firstWrites.push({ change, ...write });
        const before = new Set((await readHistory(context)).map(event => event.id));
        let outcome: DestinationResult[];
        try {
          // A deletion that waits for Automatic sync (classify says which) leaves every copy, and the row says why.
          outcome = change.pull === 'waits' ? [notIn(change.name, DELETION_WAITS)]
            : change.kind === 'skill' ? await pullSkill(context, dir, change, item, wrote)
            : change.kind === 'mcp' ? await pullServer(context, dir, change, item, wrote)
            : change.kind === 'agent' ? await pullAgent(context, dir, change, item, wrote)
            : await pullBase(context, dir, change, item, options.base);
        } catch (error) {
          // plainError says "It could not finish." itself when it knows no more.
          const why = plainError(error);
          outcome = [notIn(change.name, why === 'It could not finish.' ? why : `It could not finish. ${why}`)];
        }
        // This item's own events: a full sync pass may also record another item's edit, which stays said as sync.
        for (const event of await readHistory(context)) if (!before.has(event.id) && event.key === change.key) made.add(event.id);
        // Claude Code's MCP settings are written only by Write to Claude Code (MCP-02): that wait is said apart, not as a failure.
        if (change.kind === 'mcp' && outcome.some(result => result.harness === 'claude-cli' && result.outcome === 'held')) {
          waitsForClaude.push(change.name);
          outcome = outcome.filter(result => !(result.harness === 'claude-cli' && result.outcome === 'held'));
        }
        const stuck = outcome.find(result => result.outcome === 'held' && !result.harness) ?? outcome.find(result => result.outcome === 'failed');
        if (stuck) unfinish(change.key, stuck.message, { waitedForSync: change.pull === 'waits' || undefined });
        results.push(...outcome);
      }
    } finally { await tellHistory(context, made, firstWrites); }
    await saveState(context.home, { ...state, base: sides.latestId, pulledAt: new Date().toISOString(), unfinished: Object.keys(unfinished).length ? unfinished : undefined });
    return { results, view: await buildView(context, options), pulled: todo.filter(change => !unfinished[change.key]).length, waitsForClaude };
  }));
}

// ---------- Push ----------

/** Puts items back in the working tree exactly as the base commit has them, or takes out those the base doesn't have. */
async function keepAsBase(dir: string, items: { atBase?: SideItem; here?: SideItem }[], baseId: string | undefined) {
  await forgetWritten(dir);
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
  try { await gitOrThrow(dir, ['--literal-pathspecs', 'checkout', '--quiet', baseId, `--pathspec-from-file=${list}`, '--pathspec-file-nul']); }
  finally { await rm(list, { force: true }); }
}

/** Who a commit is from: the git identity set up on this computer, else Central Knot itself. */
async function identity(dir: string): Promise<string[]> {
  const name = (await git(dir, ['config', 'user.name'])).output.trim();
  const email = (await git(dir, ['config', 'user.email'])).output.trim();
  return name && email ? [] : ['-c', `user.name=${name || PRODUCT}`, '-c', `user.email=${email || 'central-knot@localhost'}`];
}

/** A commit message naming what changed, short enough for a log line. */
function message(outgoing: RepoChange[], from: string): string {
  const names = outgoing.map(change => change.name);
  const listed = names.length > 4 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ');
  const noun = { skill: 'skill', mcp: 'MCP server', agent: 'agent', base: '' };
  return `${PRODUCT}: update ${listed}\n\nFrom ${from}.\n\n${outgoing.map(change => `- ${change.change} ${noun[change.kind]} ${change.name}`.replace(/  +/g, ' ')).join('\n')}\n`;
}

/**
 * Commits the Managed set here on top of the repo's latest commit and pushes it. Only when this computer has every change the repo
 * has; otherwise Pull first. Only what changed here goes: every other item stays byte for byte as the repo has it (so a setting the
 * comparison doesn't count, like an agent's model, is never rewritten), and so do items that can't be brought here or weren't.
 */
export function pushRepo(context: ShareContext, options: RepoOptions & { from?: string } = {}): Promise<RepoResult> {
  return exclusive(() => sayingWhy(context, options, 'Push', async () => {
    const ready = await readyToMove(context, options);
    if ('refused' in ready) return ready.refused;
    const { dir, state, sides } = ready;
    if (sides.latestId !== state.base) return refusal(context, PULL_FIRST, options);
    const { outgoing } = classify(sides, state.unfinished);
    const sending = outgoing.filter(change => !change.held);
    // The branch gone from the repo and nothing else to send: the commit this computer has goes back as it was.
    if (!sending.length && sides.branchGone && state.base) {
      const restored = await git(dir, ['push', '--quiet', 'origin', `${state.base}:refs/heads/${state.branch}`], 120_000);
      if (restored.code !== 0) return refusal(context, whyPushFailed(restored.code, restored.output), options);
      await gitOrThrow(dir, ['update-ref', `refs/remotes/origin/${state.branch}`, state.base]);
      await saveState(context.home, { ...state, pushedAt: new Date().toISOString() });
      return { results: [], view: await buildView(context, options), pushed: await describeCommit(dir, state.base) };
    }
    if (!sending.length) return refusal(context, 'Nothing to push: the repo already has the Managed set as it is here.', options);
    const sent = new Set(sending.map(change => change.key));
    await keepAsBase(dir, [...new Set([...sides.base.keys(), ...sides.here.keys()])].filter(key => !sent.has(key)).map(key => ({ atBase: sides.base.get(key), here: sides.here.get(key) })), state.base);
    const tree = await stageTree(dir);
    const commit = (await gitOrThrow(dir, [...await identity(dir), 'commit-tree', tree, ...(state.base ? ['-p', state.base] : []), '-m', message(sending, options.from ?? hostname())])).trim();
    const pushed = await git(dir, ['push', '--quiet', 'origin', `${commit}:refs/heads/${state.branch}`], 120_000);
    if (pushed.code !== 0) return refusal(context, whyPushFailed(pushed.code, pushed.output), options);
    await gitOrThrow(dir, ['update-ref', `refs/heads/${state.branch}`, commit]);
    await gitOrThrow(dir, ['update-ref', `refs/remotes/origin/${state.branch}`, commit]);
    await gitOrThrow(dir, ['reset', '--quiet', '--hard', commit]);
    await saveState(context.home, { ...state, base: commit, pushedAt: new Date().toISOString() });
    return { results: [], view: await buildView(context, options), pushed: await describeCommit(dir, commit) };
  }));
}
