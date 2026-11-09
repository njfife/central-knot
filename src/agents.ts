// Agents across tools (AGT-01, TRN-01, TRN-02, D-26, D-32): Claude Code Markdown, Copilot `.agent.md`, Codex TOML.
// Name, description and prompt are Representable everywhere. Any other field (tools, model, permission mode, hooks, Codex keys and
// tables) is its own tool's: no equivalent is recorded across tools. The origin is the copy the agent is shared from; a destination
// that lacks the origin's fields gets it With limits, one-way: it receives the origin's changes, and any change there (to the prompt
// or to its own fields) or its deletion stays local, and Central Knot stops updating it.
// Writing a destination changes only its name, description and prompt lines; every other byte of that file stays.
// The safety rules are the skills engine's: unreadable is never absent, every write and removal checks the file first, every
// replaced or removed file is kept whole for Restore, and deletions follow DEL-01 and DEL-02.
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseDocument, stringify as stringifyYaml } from 'yaml';
import { mkdir } from 'node:fs/promises';
import { harnesses, writeRoot } from './harnesses.ts';
import { appendHistory, readConverted, readHistory, recordConverted, replaceHistory } from './manage.ts';
import { FORMAT_VERSION, errorCode, readRecord, recoverParked, remember, removeFileChecked, saveRecord, storeDirectory, syncGate, writeAccess, writeDurably, writeFileChecked, type ShareContext } from './share.ts';
import { readTomlTables, tomlValue } from './textedit.ts';
import type { Change, DestinationResult, HarnessId, HistoryEvent, McpResult, McpView, SkillFacts, SyncNotice, ToolCopy } from './types.ts';

export const agentTools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
/** The names the page uses for each tool. */
const shown: Record<string, string> = { 'claude-cli': 'Claude Code', 'copilot-cli': 'Copilot CLI', 'codex-cli': 'Codex', 'pi-cli': 'Pi' };

/** One agent in a shape every tool can be written from. `fields` are its own tool's extras. */
export interface NeutralAgent { name: string; description: string; prompt: string; fields: Record<string, unknown> }
/** `name` is the file's base name; `key` matches it across tools, ignoring case as macOS does. `bytes` hashes the whole file. */
export interface AgentEntry { name: string; key: string; tool: HarnessId; file: string; text: string; agent: NeutralAgent; hash: ContentHash; bytes: FileHash }
type ContentHash = string; type FileHash = string; type AgentSlot = Partial<Record<HarnessId, AgentEntry>>;

/** The origin's fields a destination would lose: all of them, in any tool but the origin's own (no recorded equivalent, CD §5). */
export const losses = (tool: HarnessId, origin: { tool: HarnessId; agent: NeutralAgent }) => (tool === origin.tool ? [] : Object.keys(origin.agent.fields));

const suffixOf = (tool: HarnessId) => (tool === 'codex-cli' ? '.toml' : tool === 'copilot-cli' ? '.agent.md' : '.md');
const folder = (context: ShareContext, tool: HarnessId) => join(context.overrides?.[tool] ?? join(context.home, harnesses[tool].defaultConfig), 'agents');
const fileFor = (context: ShareContext, tool: HarnessId, name: string) => join(folder(context, tool), `${name}${suffixOf(tool)}`);
const keyOf = (name: string) => name.normalize('NFC').toLowerCase();
/** Agent names become file names: no separators, no dot-files. */
const safeName = (name: string) => /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/.test(name) && !name.includes('..');
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/** Identity across tools: what every tool holds. A tool's own fields never make two copies differ. */
export const agentHash = (agent: Pick<NeutralAgent, 'name' | 'description' | 'prompt'>) => sha(JSON.stringify([agent.name, agent.description, agent.prompt.replace(/\s+$/, '')]));

/** Frontmatter: `---` on its own first line, then up to the next line that is `---` (at a line start, as Claude Code reads it). */
const FRONT = /^(﻿?---\r?\n)((?:[^\n]*\n)*?)(---[ \t]*(?:\r?\n|$))([\s\S]*)$/;

function fromMarkdown(name: string, text: string): NeutralAgent | undefined {
  const match = FRONT.exec(text);
  if (!match) return undefined;
  const document = parseDocument(match[2].replace(/\r?\n$/, ''));
  if (document.errors.length) return undefined;
  const front = (document.toJS() ?? {}) as Record<string, unknown>;
  if (typeof front !== 'object' || Array.isArray(front)) return undefined;
  const { name: named, description, ...fields } = front;
  return { name: typeof named === 'string' && named ? named : name, description: typeof description === 'string' ? description : '', prompt: match[4].replace(/^\r?\n/, ''), fields };
}

function fromToml(name: string, text: string): NeutralAgent | undefined {
  const tables = readTomlTables(text);
  const root = tables[0];
  const value = (key: string) => { const found = root.entries.find(entry => entry.key === key)?.value; return typeof found === 'string' ? found : undefined; };
  // No prompt: an empty file, or one cut off mid-save. Not an agent (yet), so it is held, never read as an edit that empties the others.
  if (value('developer_instructions') === undefined) return undefined;
  const fields: Record<string, unknown> = Object.fromEntries(root.entries.filter(entry => !['name', 'description', 'developer_instructions'].includes(entry.key)).map(entry => [entry.key, entry.value]));
  for (const table of tables.slice(1)) fields[`[${table.path.join('.')}]`] = true;
  return { name: value('name') || name, description: value('description') ?? '', prompt: value('developer_instructions') ?? '', fields };
}

/** Reads one tool's agents. A file that cannot be read as an agent is reported in `unreadable` and never written or deleted. */
export async function readAgents(context: ShareContext, tool: HarnessId): Promise<{ entries: AgentEntry[]; problems: string[]; unreadable: Map<string, string>; folderExists: boolean }> {
  const entries: AgentEntry[] = [];
  const problems: string[] = [];
  const unreadable = new Map<string, string>();
  let names: string[];
  try { names = await readdir(folder(context, tool)); }
  catch (error) {
    const gone = errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR';
    // A folder that is there but can't be listed is not absent: its agents are all treated as unreadable (held, never deleted).
    if (!gone) { problems.push(`${folder(context, tool)} could not be read.`); unreadable.set('*', folder(context, tool)); }
    return { entries, problems, unreadable, folderExists: !gone };
  }
  const suffix = suffixOf(tool);
  for (const file of names.filter(entry => entry.endsWith(suffix) && !entry.startsWith('.') && !entry.includes('.ck-'))) {
    const name = file.slice(0, -suffix.length);
    const path = join(folder(context, tool), file);
    let text: string;
    try { text = await readFile(path, 'utf8'); } catch { problems.push(`${path} could not be read.`); unreadable.set(keyOf(name), path); continue; }
    let agent: NeutralAgent | undefined;
    try { agent = tool === 'codex-cli' ? fromToml(name, text) : fromMarkdown(name, text); } catch { agent = undefined; }
    if (!agent) { problems.push(`${path} could not be read as an agent, so it is left alone.`); unreadable.set(keyOf(name), path); continue; }
    entries.push({ name, key: keyOf(name), tool, file: path, text, agent, hash: agentHash(agent), bytes: sha(text) });
  }
  return { entries, problems, unreadable, folderExists: true };
}

const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]|\r(?!\n)/;
/** A TOML string for a prompt: a multi-line basic string when it can be one, else a one-line basic string. */
function tomlPrompt(prompt: string) {
  if (CONTROL.test(prompt)) return tomlValue(prompt);
  const body = prompt.replace(/\\/g, '\\\\').replace(/"(?="")/g, '\\"');
  return `"""\n${body}${body.endsWith('\n') ? '' : '\n'}"""`;
}
const yamlScalar = (value: string) => stringifyYaml(value, { lineWidth: 0 }).replace(/\n$/, '');

/** Replaces top-level `key:` lines (with their indented continuation) in YAML frontmatter, or adds them first. Other lines stay byte for byte. */
function setFrontLines(front: string, values: [string, string][]): string {
  const newline = front.includes('\r\n') ? '\r\n' : '\n';
  let lines = front.length ? front.split(/\r?\n/) : [];
  const missing: string[] = [];
  for (const [key, value] of values) {
    const line = `${key}: ${yamlScalar(value)}`.split('\n');
    const at = lines.findIndex(candidate => new RegExp(`^(["']?)${key}\\1\\s*:`).test(candidate));
    if (at < 0) { missing.push(...line); continue; }
    let end = at + 1;
    while (end < lines.length && (/^\s+\S/.test(lines[end]) || (lines[end].trim() === '' && end + 1 < lines.length && /^\s+\S/.test(lines[end + 1])))) end++;
    lines = [...lines.slice(0, at), ...line, ...lines.slice(end)];
  }
  return [...missing, ...lines].join(newline);
}

/**
 * The file text for an agent at a tool. With `existing` (that tool's current file), only name, description and prompt change, at
 * their own positions; every other field, comment and table stays as written.
 */
export function agentText(tool: HarnessId, agent: Pick<NeutralAgent, 'name' | 'description' | 'prompt'>, existing?: string): string {
  if (tool === 'codex-cli') {
    const lines: Record<string, string> = { name: `name = ${tomlValue(agent.name)}\n`, description: `description = ${tomlValue(agent.description)}\n`, developer_instructions: `developer_instructions = ${tomlPrompt(agent.prompt)}\n` };
    const keys = Object.keys(lines);
    if (!existing) return keys.map(key => lines[key]).join('');
    const root = readTomlTables(existing)[0];
    let text = existing;
    // By position, last first, so earlier offsets stay right; never by searching for text that may also sit inside the prompt.
    for (const entry of root.entries.filter(candidate => keys.includes(candidate.key)).sort((first, second) => second.start - first.start)) {
      text = text.slice(0, entry.start) + lines[entry.key] + text.slice(entry.end);
    }
    const missing = keys.filter(key => !root.entries.some(entry => entry.key === key)).map(key => lines[key]).join('');
    return missing + text;
  }
  const match = existing ? FRONT.exec(existing) : undefined;
  if (!match) return `---\nname: ${yamlScalar(agent.name)}\ndescription: ${yamlScalar(agent.description)}\n---\n\n${agent.prompt}`;
  const newline = match[1].endsWith('\r\n') ? '\r\n' : '\n';
  const front = setFrontLines(match[2].replace(/\r?\n$/, ''), [['name', agent.name], ['description', agent.description]]);
  const gap = /^\r?\n/.exec(match[4])?.[0] ?? '\n';
  return `${match[1]}${front}${newline}${match[3]}${gap}${agent.prompt}`;
}

// ---------- Record and kept versions ----------

/** `file` is where the copy was; `bytes` the whole file's hash; `removing` a copy a deletion still has to remove. */
interface AgentCopy { tool: HarnessId; file: string; hash: ContentHash; bytes: FileHash; oneWay?: boolean; stopped?: boolean; status?: 'removing'; /** Its tool's agents folder was gone when last looked at. */ away?: boolean }
interface AgentRecordItem { name: string; state: 'shared' | 'dont-share'; off: HarnessId[]; hash: ContentHash; origin?: HarnessId; copies: AgentCopy[]; separate?: boolean; deleted?: { at: string; tool: HarnessId; hash: ContentHash };
  /** Content about to be overwritten, on record before the file changes, so an interrupted pass still names it in History. */
  displaced?: { tool: HarnessId; hash: ContentHash }[] }
/** `roots`: each tool's agents folder identity at the last pass, so a folder made again between passes reads as a reset. */
interface AgentRecord { formatVersion: number; items: Record<string, AgentRecordItem>; roots?: Partial<Record<HarnessId, { ino: number; birth: number }>> }
const recordPath = (home: string) => join(storeDirectory(home), 'agents.json');
async function readAgentRecord(home: string): Promise<AgentRecord> {
  try {
    const parsed = JSON.parse(await readFile(recordPath(home), 'utf8'));
    if (parsed && typeof parsed.items === 'object' && parsed.formatVersion === 2) return parsed;
  } catch { /* first time */ }
  return { formatVersion: 2, items: {} };
}
const saveAgentRecord = (home: string, record: AgentRecord) => writeDurably(recordPath(home), `${JSON.stringify(record, null, 2)}\n`);

/**
 * Every file Central Knot replaces or removes is kept whole first, per tool, under the agent's content ID, so Restore puts back
 * each tool's own file with its own fields (CON-02). Kept versions are never pruned.
 */
const keptFolder = (context: ShareContext, key: string, hash: string) => join(storeDirectory(context.home), 'items', 'agents', encodeURIComponent(key), hash);
async function keep(context: ShareContext, entry: AgentEntry) {
  const base = keptFolder(context, entry.key, entry.hash);
  await writeDurably(join(base, `${entry.tool}.txt`), entry.text);
  try { await stat(join(base, 'agent.json')); } catch { await writeDurably(join(base, 'agent.json'), `${JSON.stringify({ tool: entry.tool, name: entry.name, agent: entry.agent }, null, 2)}\n`); }
}
async function kept(context: ShareContext, key: string, hash: string): Promise<{ tool: HarnessId; name: string; agent: NeutralAgent; texts: Partial<Record<HarnessId, string>> } | undefined> {
  const base = keptFolder(context, key, hash);
  try {
    const meta = JSON.parse(await readFile(join(base, 'agent.json'), 'utf8'));
    const texts: Partial<Record<HarnessId, string>> = {};
    for (const tool of agentTools) { try { texts[tool] = await readFile(join(base, `${tool}.txt`), 'utf8'); } catch { /* not kept for this tool */ } }
    return { ...meta, texts };
  } catch { return undefined; }
}

async function gatherAgents(context: ShareContext, tools: HarnessId[]) {
  const byKey = new Map<string, AgentSlot>();
  const problems: string[] = [];
  const folders = new Set<HarnessId>();
  const unreadable = new Map<string, HarnessId[]>();
  const duplicates = new Set<string>();
  for (const tool of tools) {
    const read = await readAgents(context, tool);
    problems.push(...read.problems);
    if (read.folderExists) folders.add(tool);
    for (const key of read.unreadable.keys()) unreadable.set(key, [...(unreadable.get(key) ?? []), tool]);
    for (const entry of read.entries) {
      const slot = byKey.get(entry.key) ?? {};
      // Two files whose names differ only by case, in one tool (a case-sensitive disk): which is which can't be told, so neither syncs.
      if (slot[tool]) duplicates.add(entry.key);
      slot[tool] = entry;
      byKey.set(entry.key, slot);
    }
  }
  return { byKey, problems, folders, unreadable, duplicates };
}

const order: HarnessId[] = ['copilot-cli', 'claude-cli', 'codex-cli'];
/** The copy that holds the most fields among those with this content: the natural origin when none is recorded or chosen. */
function richest(entries: AgentEntry[], hash: string): AgentEntry | undefined {
  return entries.filter(entry => entry.hash === hash).sort((first, second) => Object.keys(second.agent.fields).length - Object.keys(first.agent.fields).length || order.indexOf(first.tool) - order.indexOf(second.tool))[0];
}

/** Why an agent can't be handled right now, if it can't: a file there that can't be read as an agent, or names that differ only by case. */
const blocked = (key: string, unreadable: Map<string, HarnessId[]>, duplicates: Set<string>, syncing: HarnessId[]) => {
  const tool = [...(unreadable.get(key) ?? []), ...(unreadable.get('*') ?? [])].find(candidate => syncing.includes(candidate));
  if (tool) return `${harnesses[tool].name}'s file for this agent, or its agents folder, is there but could not be read. Nothing is changed until it reads again.`;
  if (duplicates.has(key)) return 'Two files whose names differ only by case are in one tool. Rename one so Central Knot can tell them apart.';
  return undefined;
};

// ---------- View ----------

/** A setting's value as one short line: lists joined, anything nested shown as compact JSON, long values cut. */
function fieldText(value: unknown): string {
  const text = Array.isArray(value) ? value.map(entry => (typeof entry === 'string' ? entry : JSON.stringify(entry))).join(', ') : typeof value === 'string' ? value : JSON.stringify(value);
  const line = (text ?? '').replace(/\s+/g, ' ').trim();
  return line.length > 80 ? `${line.slice(0, 79)}…` : line || '(empty)';
}

export async function agentsView(context: ShareContext, tools: HarnessId[], notices: SyncNotice[] = []): Promise<McpView> {
  const present = tools.filter(tool => agentTools.includes(tool));
  const { byKey, problems, unreadable, duplicates } = await gatherAgents(context, present);
  const record = await readAgentRecord(context.home);
  const servers: SkillFacts[] = [];
  for (const [key, slot] of [...byKey].sort(([first], [second]) => first.localeCompare(second))) {
    const item = record.items[key];
    const entries = Object.values(slot) as AgentEntry[];
    const managed = item?.state === 'shared';
    const origin = (managed && item.origin && slot[item.origin]) || richest(entries, (entries.find(entry => entry.tool === 'claude-cli') ?? entries[0]).hash) || entries[0];
    const copies: Partial<Record<HarnessId, ToolCopy>> = {};
    for (const entry of entries) {
      let modified = '';
      try { modified = (await stat(entry.file)).mtime.toISOString(); } catch { /* gone since */ }
      copies[entry.tool] = { hash: entry.hash, directory: entry.file, rootLabel: harnesses[entry.tool].name, lines: entry.agent.prompt.split('\n').length, modified, summary: entry.agent.description, writable: true, folder: entry.name };
    }
    const cannot: Partial<Record<HarnessId, string>> = {};
    if (!safeName(origin.name)) for (const tool of present) if (!slot[tool]) cannot[tool] = 'This name can’t be a file name in another tool.';
    const limits: Partial<Record<HarnessId, string>> = {};
    for (const tool of present) {
      const lost = losses(tool, origin);
      if (lost.length) limits[tool] = `One-way from ${shown[origin.tool]}. ${shown[tool]} has no setting for ${shown[origin.tool]}'s ${lost.map(field => `“${field}”`).join(lost.length > 2 ? ', ' : ' or ')}, so it gets only the name, description and prompt. Edit this agent in ${shown[origin.tool]}: an edit made in ${shown[tool]} stays there, and Central Knot then stops updating that copy.`;
    }
    const edited = managed ? item.copies.filter(copy => !copy.oneWay && !copy.status && slot[copy.tool] && slot[copy.tool]!.hash !== copy.hash).map(copy => copy.tool) : [];
    const stopped = item?.copies.filter(copy => copy.stopped).map(copy => copy.tool) ?? [];
    const kept = Object.keys(limits).length ? Object.entries(origin.agent.fields).map(([field, value]) => `${field} (${fieldText(value)})`) : undefined;
    servers.push({ key, name: origin.name, description: origin.agent.description, copies, extra: [], managed, off: item?.off ?? [], cannot, held: blocked(key, unreadable, duplicates, present), separate: item?.separate, edited, choiceBlocks: {}, limits, stopped, kept });
  }
  return { tools: present, servers, claudePending: [], access: await writeAccess(context), gate: await syncGate(context), problems, notices };
}

// ---------- Apply ----------

/** Observed missing times per file, kept while the app runs (DEL-01's settle). A restart forgets them, which only delays a deletion. */
const missingSinceByFile = new Map<string, number>();

interface AgentPass { context: ShareContext; present: HarnessId[]; record: AgentRecord; onDisk: Awaited<ReturnType<typeof gatherAgents>>; folderIds: NonNullable<AgentRecord['roots']>;
  resetTools: Set<HarnessId>; chosen: Set<string>; newlyManaged: Set<string>; only?: Set<string>; now: number; settleMs: number; missingSince: Map<string, number> }
interface PassLog { results: DestinationResult[]; events: HistoryEvent[]; notices: SyncNotice[]; writes: number }
type AgentCopies = ReturnType<typeof reconcileCopies>; type Loser = { tool: HarnessId; hash: string };
/**
 * Records Managed choices and brings each managed agent into line. `only`: with Sync off, Apply all writes exactly the agents it
 * shows and nothing else spreads (SYN-03).
 */
export async function applyAgents(context: ShareContext, tools: HarnessId[], changes: Change[], options: { settleMs?: number; now?: number; only?: Set<string> } = {}): Promise<McpResult> {
  const refused = await refuseOrClaimOwnership(context, changes.length > 0);
  if (refused) return refused;
  const present = tools.filter(tool => agentTools.includes(tool));
  // A write or removal a crash interrupted is finished first, so a file moved aside is never read as deleted.
  for (const tool of present) await recoverParked(folder(context, tool));
  const onDisk = await gatherAgents(context, present);
  const record = await readAgentRecord(context.home);
  const log: PassLog = { results: [], events: [], notices: [], writes: 0 };
  const carried = Object.entries(record.items).flatMap(([key, item]) => (item.displaced ?? []).map(entry => ({ key, ...entry })));
  const pass: AgentPass = { context, present, record, onDisk, ...await readFolderIds(context, present, record.roots), ...recordChoices(record, onDisk.byKey, changes, log),
    only: options.only, now: options.now ?? Date.now(), settleMs: options.settleMs ?? 2000, missingSince: missingSinceByFile };
  let settling = false;
  for (const [key, item] of Object.entries(record.items)) if (item.state === 'shared' && (!options.only || options.only.has(key)) && await syncAgent(pass, log, key, item)) settling = true;
  await finishPendingRemovals(pass, log);
  await saveRecordAndHistory(pass, log, carried);
  return { results: log.results, writes: log.writes, notices: log.notices, settling };
}
async function refuseOrClaimOwnership(context: ShareContext, hasChanges: boolean): Promise<McpResult | undefined> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason, results: [], writes: 0 };
  const gate = await syncGate(context);
  if (gate.state === 'stopped' || gate.state === 'needs-resume') return { stopped: gate.reason, results: [], writes: 0 };
  let { record: syncRecord } = await readRecord(context.home);
  if (!syncRecord && !hasChanges) return { results: [], writes: 0 };
  if (!syncRecord) { syncRecord = { formatVersion: FORMAT_VERSION, generation: randomUUID(), owner: context.build, items: Object.create(null) }; await saveRecord(context.home, syncRecord); }
  if (gate.state !== 'ready') await remember(context, syncRecord.generation);
}
// A tool's agents folder made again since the last pass (a reset or reinstall, even between two reads): its missing copies are
// put back, never read as deletions.
async function readFolderIds(context: ShareContext, present: HarnessId[], roots: AgentRecord['roots']) {
  const folderIds: NonNullable<AgentRecord['roots']> = {};
  for (const tool of present) { try { const info = await stat(folder(context, tool)); folderIds[tool] = { ino: info.ino, birth: Math.round(info.birthtimeMs) }; } catch { /* away */ } }
  const resetTools = new Set(present.filter(tool => { const was = roots?.[tool], is = folderIds[tool]; return was && is && (was.ino !== is.ino || was.birth !== is.birth); }));
  return { folderIds, resetTools };
}
function recordChoices(record: AgentRecord, byKey: Map<string, AgentSlot>, changes: Change[], log: PassLog) {
  const chosen = new Set<string>(), newlyManaged = new Set<string>();
  for (const change of changes) {
    const slot = byKey.get(change.key);
    if (!slot) continue;
    const separate = change.use === 'separate', use = change.use === 'separate' ? undefined : change.use;
    if (use && change.useHash && slot[use]?.hash !== change.useHash) { log.results.push({ item: change.key, outcome: 'held', message: 'The copy you chose changed since you chose it. Nothing was changed; choose again.' }); continue; }
    const item = record.items[change.key] ??= { name: (Object.values(slot) as AgentEntry[])[0].name, state: 'dont-share', off: [], hash: '', copies: [] };
    const shared = change.managed && !separate;
    if (shared && item.state !== 'shared') newlyManaged.add(change.key);
    item.state = shared ? 'shared' : 'dont-share';
    item.off = change.off;
    item.separate = separate ? true : undefined;
    if (!shared) item.copies = item.copies.filter(copy => copy.status === 'removing');
    else delete item.deleted;
    const used = use && slot[use];
    if (used) { item.origin = used.tool; item.hash = used.hash; item.name = used.name; item.copies = []; chosen.add(change.key); }
  }
  return { chosen, newlyManaged };
}
async function syncAgent(pass: AgentPass, log: PassLog, key: string, item: AgentRecordItem): Promise<boolean> {
  const syncing = pass.present.filter(tool => !item.off.includes(tool));
  const problem = blocked(key, pass.onDisk.unreadable, pass.onDisk.duplicates, syncing);
  if (problem) { for (const copy of item.copies) pass.missingSince.delete(copy.file); log.results.push({ item: item.name, outcome: 'held', message: problem }); return false; }
  const copies = reconcileCopies(pass, log, item, pass.onDisk.byKey.get(key) ?? {}, syncing);
  if (pass.only && !pass.chosen.has(key) && (copies.edited.length || copies.missing.length)) { log.results.push({ item: item.name, outcome: 'held', message: `An edit or deletion of ${item.name} is waiting for sync. Turn automatic sync on, or use Sync once.` }); return false; }
  if (deletionStillSettling(pass, copies)) return true;
  item.copies = item.copies.filter(copy => !copies.missing.includes(copy));
  if (copies.missing.length && !copies.edited.length) await spreadDeletion(pass, log, key, item, copies);
  else await spreadContent(pass, log, key, item, copies);
  return false;
}
function reconcileCopies(pass: AgentPass, log: PassLog, item: AgentRecordItem, slot: AgentSlot, syncing: HarnessId[]) {
  // A copy recorded in a folder its tool no longer uses (a moved config root) is let go, never read as a deletion.
  item.copies = item.copies.filter(copy => dirname(copy.file) === folder(pass.context, copy.tool) || !pass.present.includes(copy.tool));
  // A tool whose agents folder is gone right now (uninstalled, moved away): its copy is neither updated nor read as deleted.
  const away = new Set(item.copies.filter(copy => !pass.onDisk.folders.has(copy.tool)).map(copy => copy.tool));
  // Its folder gone, then back (a reinstall or reset): never a deletion.
  const missingFromReturnedFolder = (copy: AgentCopy) => copy.status !== 'removing' && !away.has(copy.tool) && (copy.away || pass.resetTools.has(copy.tool)) && !slot[copy.tool];
  item.copies = item.copies.filter(copy => !missingFromReturnedFolder(copy));
  for (const copy of item.copies) if (copy.status !== 'removing') { if (away.has(copy.tool)) copy.away = true; else delete copy.away; }
  const lastSynced = new Map(item.copies.filter(copy => copy.status !== 'removing').map(copy => [copy.tool, copy]));
  const changedOneWay = [...lastSynced.values()].filter(copy => copy.oneWay && !copy.stopped && !away.has(copy.tool) && syncing.includes(copy.tool) && slot[copy.tool]?.bytes !== copy.bytes);
  for (const copy of changedOneWay) { copy.stopped = true; log.results.push({ item: item.name, harness: copy.tool, outcome: 'held', message: `${slot[copy.tool] ? 'Changed' : 'Deleted'} in ${harnesses[copy.tool].name}, which gets this agent one-way. Central Knot stopped updating it there; nothing spread.` }); }
  const updating = new Set(syncing.filter(tool => !lastSynced.get(tool)?.stopped && !away.has(tool)));
  const twoWay = new Set([...updating].filter(tool => !lastSynced.get(tool)?.oneWay));
  const found = [...updating].map(tool => slot[tool]).filter((entry): entry is AgentEntry => !!entry);
  const edited = found.filter(entry => twoWay.has(entry.tool) && lastSynced.has(entry.tool) && lastSynced.get(entry.tool)!.hash !== entry.hash);
  // Deletion of a two-way copy (DEL-01): its file gone from a folder that is there, settled, spreads (DEL-02); an edit racing it wins.
  const missing = [...lastSynced.values()].filter(copy => twoWay.has(copy.tool) && !slot[copy.tool]);
  return { slot, away, lastSynced, updating, twoWay, found, edited, missing };
}
function deletionStillSettling(pass: AgentPass, { slot, away, lastSynced, missing }: AgentCopies): boolean {
  for (const copy of lastSynced.values()) if (slot[copy.tool] || away.has(copy.tool)) pass.missingSince.delete(copy.file);
  for (const copy of missing) if (!pass.missingSince.has(copy.file)) pass.missingSince.set(copy.file, pass.now);
  const settling = missing.some(copy => pass.now - pass.missingSince.get(copy.file)! < pass.settleMs);
  if (!settling) for (const copy of missing) pass.missingSince.delete(copy.file);
  return settling;
}
async function spreadDeletion(pass: AgentPass, log: PassLog, key: string, item: AgentRecordItem, { slot, away, lastSynced, found, missing }: AgentCopies) {
  const deletedIn = missing[0].tool;
  const removed: HarnessId[] = [], remaining: AgentCopy[] = [];
  for (const copy of item.copies) {
    const here = slot[copy.tool];
    // A stopped one-way copy is the person's own now: it stays, and stays known as this agent's, so Restore leaves it alone.
    if (copy.stopped) remaining.push(copy);
    else if (away.has(copy.tool) || copy.status === 'removing') remaining.push({ ...copy, status: 'removing' });
    else if (here) {
      try { await keep(pass.context, here); await removeFileChecked(here.file, here.text); log.writes++; removed.push(copy.tool); log.results.push({ item: item.name, harness: copy.tool, outcome: 'removed', message: `Deleted in ${harnesses[deletedIn].name}, so removed here too.` }); }
      catch (error) {
        if (errorCode(error) === 'CK_CHANGED') { log.results.push({ item: item.name, harness: copy.tool, outcome: 'held', message: `${harnesses[copy.tool].name}'s copy was changed just as the deletion spread, so it was kept as it is.` }); continue; }
        remaining.push({ ...copy, status: 'removing' });
        log.results.push({ item: item.name, harness: copy.tool, outcome: 'failed', message: `Could not remove ${harnesses[copy.tool].name}'s copy yet. Central Knot will try again.` });
      }
    }
  }
  for (const entry of found) if (!lastSynced.has(entry.tool)) log.results.push({ item: item.name, harness: entry.tool, outcome: 'held', message: `${harnesses[entry.tool].name} has a different “${item.name}” that was never synced. It stays.` });
  const id = logEvent(log, { key: `agent:${key}`, item: item.name, kind: 'deleted', winner: { tool: deletedIn, hash: item.hash }, losers: [], orderProved: true, previous: item.hash });
  log.notices.push({ key: `agent:${key}`, item: item.name, kind: 'deleted', winner: deletedIn, losers: removed, orderProved: true, history: id });
  Object.assign(item, { state: 'dont-share', deleted: { at: new Date(pass.now).toISOString(), tool: deletedIn, hash: item.hash }, copies: remaining } satisfies Partial<AgentRecordItem>);
}
async function spreadContent(pass: AgentPass, log: PassLog, key: string, item: AgentRecordItem, copies: AgentCopies) {
  // An edit raced the deletion: the edit is kept, and the deleted copy comes back with it (CON-01, D-04's offer).
  const deletedMeanwhile = copies.missing.map(copy => copy.tool);
  for (const tool of deletedMeanwhile) copies.lastSynced.delete(tool);
  const twoWayFound = copies.found.filter(entry => copies.twoWay.has(entry.tool));
  const recordedOrigin = item.origin && copies.twoWay.has(item.origin) ? copies.slot[item.origin] : undefined;
  const source = pickSource(copies.edited, twoWayFound, recordedOrigin, item.hash);
  if (!source) { log.results.push({ item: item.name, outcome: 'held', message: twoWayFound.length ? 'Copies differ. Choose which copy to use.' : 'No copy is left to start from.' }); return; }
  // An unrecorded copy that differs, with no baseline to call it behind, is a same-name collision: it needs a choice.
  if (!pass.chosen.has(key) && copies.found.some(entry => !copies.lastSynced.has(entry.tool) && entry.hash !== source.hash && entry.hash !== item.hash)) { log.results.push({ item: item.name, outcome: 'held', message: 'Copies differ. Choose which copy to use.' }); return; }
  // The origin stays the same tool unless it is chosen anew or can no longer be one (stable, so one-way never flips by itself).
  const origin = recordedOrigin || richest(twoWayFound, source.hash) || source;
  item.origin = origin.tool;
  const historyWillName = copies.edited.length > 0 || pass.chosen.has(key) || deletedMeanwhile.length > 0;
  const replaced: Loser[] = [], added: Loser[] = [];
  await keep(pass.context, source);
  const nextCopies = item.copies.filter(copy => copy.stopped || copy.status === 'removing' || copies.away.has(copy.tool));
  for (const tool of copies.updating) {
    const { copy, wrote } = await writeCopy(pass, log, item, tool, copies, source, origin, historyWillName);
    const here = copies.slot[tool];
    if (copy) nextCopies.push(copy);
    if (wrote && here) replaced.push({ tool, hash: here.hash });
    else if (wrote && pass.newlyManaged.has(key)) added.push({ tool, hash: copy.bytes });
  }
  logSpreadEvents(log, key, item, source, { chosen: pass.chosen.has(key), edited: copies.edited, deletedMeanwhile }, replaced, added);
  Object.assign(item, { name: source.name, hash: source.hash, copies: nextCopies } satisfies Partial<AgentRecordItem>);
}
// The winner: a one-sided edit at a two-way copy; competing edits by the fixed tool order (D-04); else the baseline.
function pickSource(edited: AgentEntry[], twoWayFound: AgentEntry[], recordedOrigin: AgentEntry | undefined, baseline: ContentHash): AgentEntry | undefined {
  if (edited.length) return [...edited].sort((first, second) => order.indexOf(first.tool) - order.indexOf(second.tool))[0];
  if (recordedOrigin?.hash === baseline) return recordedOrigin;
  const allAgree = new Set(twoWayFound.map(entry => entry.hash)).size === 1;
  return richest(twoWayFound, baseline) ?? (allAgree ? richest(twoWayFound, twoWayFound[0].hash) : undefined);
}
async function writeCopy(pass: AgentPass, log: PassLog, item: AgentRecordItem, tool: HarnessId, copies: AgentCopies, source: AgentEntry, origin: AgentEntry, historyWillName: boolean): Promise<{ copy: AgentCopy; wrote: true } | { copy?: AgentCopy; wrote: false }> {
  const here = copies.slot[tool];
  const lost = losses(tool, origin);
  const oneWay = lost.length > 0 || undefined;
  if (here?.hash === source.hash) return { copy: { tool, file: here.file, hash: here.hash, bytes: here.bytes, oneWay }, wrote: false };
  if (!here && !safeName(source.name)) { log.results.push({ item: item.name, harness: tool, outcome: 'held', message: 'This name can’t be a file name here.' }); return { wrote: false }; }
  const path = here?.file ?? fileFor(pass.context, tool, source.name);
  let text: string;
  try { text = agentText(tool, source.agent, here?.text); } catch { log.results.push({ item: item.name, harness: tool, outcome: 'held', message: 'This file could not be updated without changing other parts of it.' }); return { wrote: false }; }
  try {
    if (here) await keep(pass.context, here);
    // Only content an event of this pass will name is put on record as displaced; a copy that is only behind (a write that
    // failed, caught up now) holds an older version that History already has.
    if (here && historyWillName) { (item.displaced ??= []).push({ tool, hash: here.hash }); await saveAgentRecord(pass.context.home, pass.record); }
    await writeFileChecked(path, text, here?.text);
  } catch (error) {
    if (here) dropDisplaced(item, entry => entry.tool === tool && entry.hash === here.hash);
    log.results.push({ item: item.name, harness: tool, outcome: 'held', message: error instanceof Error && 'code' in error && String(error.code).startsWith('CK_') ? error.message : `Could not write ${harnesses[tool].name}'s copy.` });
    // Not written: it keeps what was recorded, so the next pass still sees it as it is.
    return { copy: copies.lastSynced.get(tool), wrote: false };
  }
  log.writes++;
  log.results.push({ item: item.name, harness: tool, outcome: 'written', message: `${here ? `Now has ${harnesses[source.tool].name}'s version` : 'Added'}${oneWay ? `, with limits: ${harnesses[tool].name} has no equivalent for ${lost.join(', ')}` : ''}. Start a new session to use it.` });
  return { copy: { tool, file: path, hash: agentHash(source.agent), bytes: sha(text), oneWay }, wrote: true };
}
function logSpreadEvents(log: PassLog, key: string, item: AgentRecordItem, source: AgentEntry, why: { chosen: boolean; edited: AgentEntry[]; deletedMeanwhile: HarnessId[] }, replaced: Loser[], added: Loser[]) {
  const historyKey = `agent:${key}`;
  const winner = { tool: source.tool, hash: source.hash };
  if (added.length) logEvent(log, { key: historyKey, item: item.name, kind: 'added', losers: added, orderProved: true, previous: source.hash });
  if (why.chosen && replaced.length) logEvent(log, { key: historyKey, item: item.name, kind: 'chosen', winner, losers: replaced, orderProved: true, previous: undefined });
  else if (why.deletedMeanwhile.length) {
    const id = logEvent(log, { key: historyKey, item: item.name, kind: 'kept-edit', winner, losers: [...why.deletedMeanwhile.map(tool => ({ tool, hash: item.hash })), ...replaced], orderProved: false, previous: item.hash });
    log.notices.push({ key: historyKey, item: item.name, kind: 'kept-edit', winner: source.tool, losers: why.deletedMeanwhile, orderProved: false, history: id });
  } else if (why.edited.length && (replaced.length || (item.hash && item.hash !== source.hash))) {
    // An edit that changed the synced content is History even when no copy could be written yet (a failed write caught up
    // later): the version it replaces stays restorable.
    const competing = why.edited.length > 1 && new Set(why.edited.map(entry => entry.hash)).size > 1;
    const kind = competing ? 'conflict' : 'edit';
    const id = logEvent(log, { key: historyKey, item: item.name, kind, winner, losers: replaced, orderProved: !competing, previous: item.hash || undefined });
    if (replaced.length) log.notices.push({ key: historyKey, item: item.name, kind, winner: source.tool, losers: competing ? why.edited.filter(entry => entry.hash !== source.hash).map(entry => entry.tool) : replaced.map(entry => entry.tool), orderProved: !competing, history: id });
  }
}
// A copy a deletion could not remove (its folder away, a locked file) goes once it can, while it still holds what it held. A copy
// changed since, or an agent put back by hand or managed again, ends that.
async function finishPendingRemovals(pass: AgentPass, log: PassLog) {
  for (const [key, item] of Object.entries(pass.record.items)) {
    const pending = item.copies.filter(copy => copy.status === 'removing');
    if ((pass.only && !pass.only.has(key)) || !pending.length) continue;
    const slot = pass.onDisk.byKey.get(key) ?? {};
    const inUseAgain = item.state === 'shared' || (Object.values(slot) as AgentEntry[]).some(entry => !pending.some(copy => copy.tool === entry.tool));
    const done: AgentCopy[] = [];
    for (const copy of pending) {
      const here = slot[copy.tool];
      if (!here) { if (inUseAgain || pass.onDisk.folders.has(copy.tool)) done.push(copy); continue; }
      // A file elsewhere now (a moved agents folder) is not the one the deletion was owed for.
      if (inUseAgain || here.bytes !== copy.bytes || here.file !== copy.file) { done.push(copy); continue; }
      try { await keep(pass.context, here); await removeFileChecked(here.file, here.text); log.writes++; log.results.push({ item: item.name, harness: copy.tool, outcome: 'removed', message: 'Removed now, finishing an earlier deletion.' }); done.push(copy); }
      catch (error) { if (errorCode(error) === 'CK_CHANGED') done.push(copy); }
    }
    item.copies = item.copies.filter(copy => !done.includes(copy));
  }
}
async function saveRecordAndHistory(pass: AgentPass, log: PassLog, carried: (Loser & { key: string })[]) {
  const named = (key: string, hash: string) => log.events.some(made => made.key === `agent:${key}` && (made.previous === hash || made.winner?.hash === hash || made.losers.some(loser => loser.hash === hash)));
  // Displaced content no event of this pass names (left by a pass that stopped part-way) gets its own History entry.
  for (const left of carried) {
    const item = pass.record.items[left.key];
    if (item && !named(left.key, left.hash)) logEvent(log, { key: `agent:${left.key}`, item: item.name, kind: 'edit', winner: { tool: left.tool, hash: item.hash }, losers: [{ tool: left.tool, hash: left.hash }], orderProved: false, previous: left.hash });
  }
  // Folder identities are kept only by a full pass: Apply all with Sync off skips agents, so a reset must still be seen next time.
  if (!pass.only) pass.record.roots = { ...pass.record.roots, ...pass.folderIds };
  await saveAgentRecord(pass.context.home, pass.record);
  await appendHistory(pass.context, log.events);
  // History names it now: the hold is dropped. A crash between leaves the hold, never content no one can restore.
  const released = Object.entries(pass.record.items).filter(([key, item]) => item.displaced?.some(entry => named(key, entry.hash)));
  for (const [key, item] of released) dropDisplaced(item, entry => named(key, entry.hash));
  if (released.length) await saveAgentRecord(pass.context.home, pass.record);
}
const logEvent = (log: PassLog, fields: Omit<HistoryEvent, 'id' | 'at'>) => { const made: HistoryEvent = { id: randomUUID(), at: new Date().toISOString(), ...fields }; log.events.push(made); return made.id; };
const dropDisplaced = (item: AgentRecordItem, drop: (entry: Loser) => boolean) => { if (!item.displaced) return; item.displaced = item.displaced.filter(entry => !drop(entry)); if (!item.displaced.length) delete item.displaced; };

/**
 * Undo of the agent files an Apply all added: each goes again while it is exactly the file written (an edit since keeps it), with
 * its content kept in the store; the agent is unmanaged as before, or, if a file had to stay, that tool keeps syncing.
 */
async function undoAddedAgent(context: ShareContext, tools: HarnessId[], history: HistoryEvent[], past: HistoryEvent): Promise<McpResult> {
  if (past.undoneBy) return { stopped: 'That change was already undone.', results: [], writes: 0 };
  const key = past.key.replace(/^agent:/, '');
  const record = await readAgentRecord(context.home);
  const item = record.items[key];
  if (!item || item.state !== 'shared') return { stopped: `${past.item} is not managed any more, so there is nothing to undo here.`, results: [], writes: 0 };
  const present = tools.filter(tool => agentTools.includes(tool));
  const slot = (await gatherAgents(context, present)).byKey.get(key) ?? {};
  const results: DestinationResult[] = [];
  const stayed: HarnessId[] = [];
  let writes = 0;
  for (const loser of past.losers) {
    const here = slot[loser.tool];
    if (!here) { results.push({ item: item.name, harness: loser.tool, outcome: 'stayed', message: `${harnesses[loser.tool].name}'s copy is already gone.` }); continue; }
    if (here.bytes !== loser.hash) { stayed.push(loser.tool); results.push({ item: item.name, harness: loser.tool, outcome: 'held', message: `${harnesses[loser.tool].name}'s copy was edited since, so it stays.` }); continue; }
    try { await keep(context, here); await removeFileChecked(here.file, here.text); }
    catch (error) {
      stayed.push(loser.tool);
      results.push({ item: item.name, harness: loser.tool, outcome: errorCode(error) === 'CK_CHANGED' ? 'held' : 'failed', message: errorCode(error) === 'CK_CHANGED' ? `${harnesses[loser.tool].name}'s copy changed just now, so it stays.` : `Could not remove ${harnesses[loser.tool].name}'s copy.` });
      continue;
    }
    item.copies = item.copies.filter(copy => copy.tool !== loser.tool);
    writes++;
    results.push({ item: item.name, harness: loser.tool, outcome: 'removed', message: 'Removed the copy Apply all added.' });
  }
  if (!stayed.length) { item.state = 'dont-share'; item.copies = []; }
  else item.off = [...new Set([...item.off, ...past.losers.map(loser => loser.tool).filter(tool => !stayed.includes(tool))])];
  await saveAgentRecord(context.home, record);
  past.undoneBy = randomUUID();
  await replaceHistory(context, history);
  return { results, writes };
}

/** What an agent has that a skill never does (AGT-02): said on the converted skill, never "agent installed". */
export const conversionLosses = ['its own isolated context', 'tool restrictions', 'model selection', 'being picked as an agent (it is invoked as a skill)'];

/**
 * Convert to skill (AGT-02): a one-time snapshot of an agent as an ordinary skill, for Pi, which has no native agents. It is written
 * to Pi's own skills folder (no root the agent's tool reads, AGT-03) and its origin is recorded, so it is never placed back in that
 * tool automatically. Skill edits never write to any agent. The caller then manages it like any skill.
 */
export async function convertAgentToSkill(context: ShareContext, tools: HarnessId[], key: string): Promise<{ stopped?: string; skill?: string; origin?: HarnessId }> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason };
  if (!tools.includes('pi-cli')) return { stopped: 'Pi is not in this home, so there is nowhere to convert to.' };
  const slot = (await gatherAgents(context, tools.filter(tool => agentTools.includes(tool)))).byKey.get(key);
  // The agent's own tool, where every field lives: Claude Code first, as the fullest format.
  const origin = (['claude-cli', 'copilot-cli', 'codex-cli'] as HarnessId[]).find(tool => slot?.[tool]);
  const entry = origin ? slot![origin]! : undefined;
  if (!entry || !origin) return { stopped: 'That agent is not there any more.' };
  if (!entry.agent.description.trim()) return { stopped: `Pi skips a skill with no description, and “${entry.name}” has none. Add one to the agent first.` };
  if (!safeName(entry.name)) return { stopped: 'This agent’s name can’t be a folder name.' };
  const folder = join(writeRoot(harnesses['pi-cli'], context.home, context.overrides?.['pi-cli']), entry.name);
  try { await stat(folder); return { stopped: `Pi already has a skill named “${entry.name}”. Nothing was written.` }; } catch { /* free */ }
  if ((await readConverted(context.home))[entry.name.toLowerCase()]) return { stopped: `“${entry.name}” was converted before.` };
  const text = `---\nname: ${JSON.stringify(entry.name)}\ndescription: ${JSON.stringify(entry.agent.description)}\n---\n\n${entry.agent.prompt.replace(/^\s+/, '')}${entry.agent.prompt.endsWith('\n') ? '' : '\n'}`;
  await mkdir(folder, { recursive: true });
  await writeFileChecked(join(folder, 'SKILL.md'), text, undefined);
  await recordConverted(context.home, entry.name.toLowerCase(), { agent: entry.name, origin, at: new Date().toISOString(), losses: [...conversionLosses, ...Object.keys(entry.agent.fields).map(field => `“${field}”`)] });
  return { skill: entry.name.toLowerCase(), origin };
}

/** Undo or Restore of an agent event: each tool gets back its own kept file where one was kept; stopped one-way copies are left alone. */
export async function restoreAgent(context: ShareContext, tools: HarnessId[], eventId: string, choice?: string): Promise<McpResult> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason, results: [], writes: 0 };
  const gate = await syncGate(context);
  if (gate.state === 'stopped' || gate.state === 'needs-resume') return { stopped: gate.reason, results: [], writes: 0 };
  const history = await readHistory(context.home);
  const past = history.find(entry => entry.id === eventId);
  if (past?.kind === 'added') return undoAddedAgent(context, tools, history, past);
  const key = past?.key.replace(/^agent:/, '');
  // A one-way copy that a choice replaced: 'narrow' puts back only that tool's own edited file, and it stops updating again.
  // The source and the other receiving tools keep what they have; the agent stays one-way from the same source.
  if (past && key && past.kind === 'chosen' && !past.undoneBy) {
    const copies = (await readAgentRecord(context.home)).items[key]?.copies ?? [];
    if (choice === 'narrow' || (past.losers.length && past.losers.every(loser => copies.find(copy => copy.tool === loser.tool)?.oneWay))) return restoreReplacedOneWay(context, tools, history, past, key);
  }
  const options = past ? past.losers.filter(loser => loser.hash && loser.hash !== past.previous && loser.hash !== past.winner?.hash) : [];
  const hash = past && (choice ? options.find(option => option.hash === choice)?.hash
    : past.kind === 'conflict' || past.kind === 'kept-edit' ? options[0]?.hash ?? (past.kind === 'conflict' ? past.previous : undefined)
      : past.kind === 'chosen' ? past.losers[0]?.hash : ['deleted', 'edit', 'restored'].includes(past.kind) ? past.previous : undefined);
  if (!past || !key || !hash) return { stopped: 'That change can’t be restored.', results: [], writes: 0 };
  if (past.undoneBy) return { stopped: 'That change was already undone.', results: [], writes: 0 };
  const version = await kept(context, key, hash);
  if (!version) return { stopped: 'The kept version is no longer in Central Knot’s store, so it can’t be restored.', results: [], writes: 0 };
  const record = await readAgentRecord(context.home);
  const item: AgentRecordItem = record.items[key] ?? { name: version.name, state: 'shared', off: [], hash: '', copies: [] };
  if (past.kind === 'deleted' && item.state === 'shared' && item.hash !== hash) return { stopped: `“${item.name}” is managed again with other content. Restoring the old one would replace it; delete or rename the new one first.`, results: [], writes: 0 };
  if (past.kind !== 'deleted' && item.state !== 'shared') return { stopped: `${item.name} was deleted since. Restore the deletion instead.`, results: [], writes: 0 };
  const present = tools.filter(tool => agentTools.includes(tool));
  for (const tool of present) await recoverParked(folder(context, tool));
  const { byKey, unreadable, duplicates } = await gatherAgents(context, present);
  const slot = byKey.get(key) ?? {};
  const stopped = new Set(item.copies.filter(copy => copy.stopped).map(copy => copy.tool));
  const problem = blocked(key, unreadable, duplicates, present);
  if (problem) return { stopped: problem, results: [], writes: 0 };
  // A deleted agent whose name another agent now uses: never overwrite that one. Its own stopped one-way copy is not another agent.
  if (item.state !== 'shared') {
    const taken = (Object.values(slot) as AgentEntry[]).find(entry => entry.hash !== hash && !stopped.has(entry.tool));
    if (taken) return { stopped: `A different “${item.name}” agent is in ${harnesses[taken.tool].name} now. Remove or rename it, then restore.`, results: [], writes: 0 };
  }
  const results: DestinationResult[] = [];
  let writes = 0;
  const before = item.state === 'shared' ? item.hash : undefined;
  const replaced: { tool: HarnessId; hash: string }[] = [];
  const copies: AgentCopy[] = item.copies.filter(copy => copy.stopped);
  const origin = { tool: version.tool, agent: version.agent };
  for (const tool of present.filter(candidate => !item.off.includes(candidate) && !stopped.has(candidate))) {
    const here = slot[tool];
    const oneWay = losses(tool, origin).length > 0;
    // This tool's own kept file when there is one, whole; otherwise name, description and prompt written into what is there.
    const text = version.texts[tool] ?? agentText(tool, version.agent, here?.text);
    if (here?.text === text) { copies.push({ tool, file: here.file, hash: here.hash, bytes: here.bytes, oneWay: oneWay || undefined }); continue; }
    const path = here?.file ?? fileFor(context, tool, version.name);
    try {
      if (here) await keep(context, here);
      await writeFileChecked(path, text, here?.text);
    } catch (error) { results.push({ item: item.name, harness: tool, outcome: 'held', message: error instanceof Error ? error.message : 'Could not write it.' }); continue; }
    writes++;
    if (here) replaced.push({ tool, hash: here.hash });
    copies.push({ tool, file: path, hash, bytes: sha(text), oneWay: oneWay || undefined });
    results.push({ item: item.name, harness: tool, outcome: 'written', message: 'Restored.' });
  }
  item.state = 'shared';
  item.hash = hash;
  item.origin = version.tool;
  item.name = version.name;
  item.copies = copies;
  delete item.deleted;
  record.items[key] = item;
  await saveAgentRecord(context.home, record);
  const id = randomUUID();
  past.undoneBy = id;
  await replaceHistory(context, [...history, { id, at: new Date().toISOString(), key: past.key, item: item.name, kind: 'restored', winner: { tool: replaced[0]?.tool ?? version.tool, hash }, losers: replaced, orderProved: true, previous: before }]);
  return { results, writes };
}

/** Undo of "use the source's copy" for a stopped one-way copy: that tool gets its own edited file back, unchanged since, and stops again. */
async function restoreReplacedOneWay(context: ShareContext, tools: HarnessId[], history: HistoryEvent[], past: HistoryEvent, key: string): Promise<McpResult> {
  const record = await readAgentRecord(context.home);
  const item = record.items[key];
  if (!item || item.state !== 'shared') return { stopped: 'That agent is not managed any more.', results: [], writes: 0 };
  const present = tools.filter(tool => agentTools.includes(tool));
  for (const tool of present) await recoverParked(folder(context, tool));
  const { byKey, unreadable, duplicates } = await gatherAgents(context, present);
  const problem = blocked(key, unreadable, duplicates, present);
  if (problem) return { stopped: problem, results: [], writes: 0 };
  const slot = byKey.get(key) ?? {};
  const results: DestinationResult[] = [];
  const replaced: { tool: HarnessId; hash: string }[] = [];
  let writes = 0;
  for (const loser of past.losers) {
    const copy = item.copies.find(entry => entry.tool === loser.tool);
    const here = slot[loser.tool];
    const version = await kept(context, key, loser.hash);
    const text = version?.texts[loser.tool];
    if (!copy || !here || !text) { results.push({ item: item.name, harness: loser.tool, outcome: 'held', message: 'Its edited copy can’t be put back here.' }); continue; }
    // Only over the copy the choice wrote: a later change in that tool is never overwritten.
    if (here.bytes !== copy.bytes) { results.push({ item: item.name, harness: loser.tool, outcome: 'held', message: `Changed in ${harnesses[loser.tool].name} since, so nothing was put back.` }); continue; }
    try {
      await keep(context, here);
      await writeFileChecked(here.file, text, here.text);
    } catch (error) { results.push({ item: item.name, harness: loser.tool, outcome: 'held', message: error instanceof Error ? error.message : 'Could not write it.' }); continue; }
    writes++;
    replaced.push({ tool: loser.tool, hash: here.hash });
    copy.hash = loser.hash;
    copy.bytes = sha(text);
    copy.stopped = true;
    results.push({ item: item.name, harness: loser.tool, outcome: 'written', message: `Its edited copy is back; it doesn’t receive updates from ${harnesses[item.origin ?? past.winner?.tool ?? 'claude-cli'].name}.` });
  }
  if (!writes) return { stopped: results[0]?.message ?? 'Nothing was put back.', results, writes };
  record.items[key] = item;
  await saveAgentRecord(context.home, record);
  const id = randomUUID();
  past.undoneBy = id;
  await replaceHistory(context, [...history, { id, at: new Date().toISOString(), key: past.key, item: item.name, kind: 'restored', winner: { tool: past.losers[0]!.tool, hash: past.losers[0]!.hash }, losers: replaced, orderProved: true, previous: item.hash }]);
  return { results, writes };
}
