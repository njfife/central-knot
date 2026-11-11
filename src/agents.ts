// Agents across tools (AGT-01, TRN-01, TRN-02, D-26, D-32): Claude Code Markdown, Copilot `.agent.md`, Codex TOML, OpenCode Markdown.
// Name, description and prompt are Representable everywhere. Any other field (tools, model, permission mode, hooks, Codex keys and
// tables) is its own tool's: no equivalent is recorded across tools. The origin is the copy the agent is shared from; a destination
// that lacks the origin's fields gets it With limits, one-way: it receives the origin's changes, and any change there (to the prompt
// or to its own fields) or its deletion stays local, and Central Knot stops updating it.
// Writing a destination changes only its name, description and prompt lines; every other byte of that file stays.
// The safety rules are the skills engine's: unreadable is never absent, every write and removal checks the file first, every
// replaced or removed file is kept whole for Restore, and deletions follow DEL-01 and DEL-02.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseDocument, stringify as stringifyYaml } from 'yaml';
import { configRoot, harnesses, writeRoot } from './harnesses.ts';
import { appendHistory, goneFacts, readConverted, readHistory, recordConverted, replaceHistory } from './manage.ts';
import { FORMAT_VERSION, newRecord, NOTHING_CHANGED, errorCode, readRecord, recoverParked, sha256, remember, removeFileChecked, saveRecord, storeDirectory, syncGate, writeAccess, writeDurably, writeFileChecked, type ShareContext } from './share.ts';
import { readTomlTables, tomlValue } from './textedit.ts';
import type { Change, DestinationResult, HarnessId, HistoryEvent, McpResult, McpView, SkillFacts, SyncNotice, ThroughPlugin, ToolCopy } from './types.ts';
import { agentTools, type AgentTool } from './presence.ts';
import { throughPlugin, toolNames as shown } from './words.ts';
import { throughPlugins } from './plugins.ts';

export const isAgentTool = (tool: HarnessId): tool is AgentTool => agentTools.some(agentTool => agentTool === tool);

/** One agent in a shape every tool can be written from. `fields` are its own tool's extras. */
export interface NeutralAgent { name: string; description: string; prompt: string; fields: Record<string, unknown> }
/** `name` is the file's base name; `key` matches it across tools, ignoring case as macOS does. `bytes` hashes the whole file. */
export interface AgentEntry { name: string; key: string; tool: AgentTool; file: string; text: string; agent: NeutralAgent; hash: ContentHash; bytes: FileHash }
type ContentHash = string; type FileHash = string; type AgentSlot = Partial<Record<HarnessId, AgentEntry>>;

/** The origin's fields a destination would lose: all of them, in any tool but the origin's own (no recorded equivalent, CD §5). */
export const losses = (tool: HarnessId, origin: { tool: HarnessId; agent: NeutralAgent }) => (tool === origin.tool ? [] : Object.keys(origin.agent.fields));

const suffixes: Record<AgentTool, string> = { 'claude-cli': '.md', 'copilot-cli': '.agent.md', 'codex-cli': '.toml', 'opencode-cli': '.md' };
const folder = (context: ShareContext, tool: HarnessId) => join(configRoot(harnesses[tool], context.home, context.overrides?.[tool]), 'agents');
export const fileFor = (context: ShareContext, tool: AgentTool, name: string) => join(folder(context, tool), `${name}${suffixes[tool]}`);
export const keyOf = (name: string) => name.normalize('NFC').toLowerCase();
/** Agent names become file names: no separators, no dot-files. */
export const safeName = (name: string) => /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/.test(name) && !name.includes('..');

/** Identity across tools: what every tool holds. A tool's own fields never make two copies differ. */
export const agentHash = (agent: Pick<NeutralAgent, 'name' | 'description' | 'prompt'>) => sha256(JSON.stringify([agent.name, agent.description, agent.prompt.replace(/\s+$/, '')]));

/** Frontmatter: `---` on its own first line, then up to the next line that is `---` (at a line start, as Claude Code reads it). */
const FRONT = /^(﻿?---\r?\n)((?:[^\n]*\n)*?)(---[ \t]*(?:\r?\n|$))([\s\S]*)$/;

export function fromMarkdown(name: string, text: string): NeutralAgent | undefined {
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
  for (const table of tables.slice(1)) fields[table.array ? `[[${table.path.join('.')}]]` : `[${table.path.join('.')}]`] = true;
  return { name: value('name') || name, description: value('description') ?? '', prompt: value('developer_instructions') ?? '', fields };
}

/** Reads one tool's agents. A file that cannot be read as an agent is reported in `unreadable` and never written or deleted. */
export async function readAgents(context: ShareContext, tool: AgentTool): Promise<{ entries: AgentEntry[]; problems: string[]; unreadable: Map<string, string>; folderExists: boolean }> {
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
  const suffix = suffixes[tool];
  for (const file of names.filter(entry => entry.endsWith(suffix) && !entry.startsWith('.') && !entry.includes('.ck-'))) {
    const name = file.slice(0, -suffix.length);
    const path = join(folder(context, tool), file);
    let text: string;
    try { text = await readFile(path, 'utf8'); } catch { problems.push(`${path} could not be read.`); unreadable.set(keyOf(name), path); continue; }
    let agent: NeutralAgent | undefined;
    try { agent = tool === 'codex-cli' ? fromToml(name, text) : fromMarkdown(name, text); } catch { agent = undefined; }
    if (!agent) { problems.push(`${path} could not be read as an agent, so it is left alone.`); unreadable.set(keyOf(name), path); continue; }
    entries.push({ name, key: keyOf(name), tool, file: path, text, agent, hash: agentHash(agent), bytes: sha256(text) });
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
  // A new OpenCode agent says `mode: all`: with no mode, 1.19.5 offers it both to choose and to hand work to, while 2.2.5
  // makes it one to choose only (measured), and an agent from another tool is one work is handed to there.
  if (!match) return `---\nname: ${yamlScalar(agent.name)}\ndescription: ${yamlScalar(agent.description)}\n${tool === 'opencode-cli' ? 'mode: all\n' : ''}---\n\n${agent.prompt}`;
  const newline = match[1].endsWith('\r\n') ? '\r\n' : '\n';
  const front = setFrontLines(match[2].replace(/\r?\n$/, ''), [['name', agent.name], ['description', agent.description]]);
  const gap = /^\r?\n/.exec(match[4])?.[0] ?? '\n';
  return `${match[1]}${front}${newline}${match[3]}${gap}${agent.prompt}`;
}

// ---------- Record and kept versions ----------

/** `file` is where the copy was; `bytes` the whole file's hash; `removing` a copy a deletion still has to remove. */
interface AgentCopy { tool: AgentTool; file: string; hash: ContentHash; bytes: FileHash; oneWay?: boolean; stopped?: boolean; status?: 'removing'; /** Its tool's agents folder was gone when last looked at. */ away?: boolean }
interface AgentRecordItem { name: string; state: 'shared' | 'dont-share'; off: HarnessId[]; hash: ContentHash; origin?: HarnessId; copies: AgentCopy[]; separate?: boolean; deleted?: { at: string; tool: HarnessId; hash: ContentHash };
  /** Content about to be overwritten, on record before the file changes, so an interrupted pass still names it in History. */
  displaced?: { tool: HarnessId; hash: ContentHash }[] }
/** `roots`: each tool's agents folder identity at the last pass, so a folder made again between passes reads as a reset. */
interface AgentRecord { formatVersion: number; items: Record<string, AgentRecordItem>; roots?: Partial<Record<HarnessId, { ino: number; birth: number }>> }
const recordPath = (home: string) => join(storeDirectory(home), 'agents.json');
const AGENTS_FORMAT_VERSION = 2;
const validAgentItems = (items: unknown) => !!items && typeof items === 'object' && !Array.isArray(items)
  && Object.values(items as Record<string, Partial<AgentRecordItem> | null>).every(item => !!item && typeof item === 'object' && typeof item.state === 'string' && Array.isArray(item.off) && Array.isArray(item.copies));
/** Missing, or version 1 (before agents were rewritten), is a first run. Unreadable, damaged or newer stops every write, as sync.json does; the file is never touched. */
async function inspectAgentRecord(home: string): Promise<{ record?: AgentRecord; problem?: string }> {
  let text: string;
  try { text = await readFile(recordPath(home), 'utf8'); }
  catch (error) { return errorCode(error) === 'ENOENT' ? {} : { problem: `The agents record could not be read. ${NOTHING_CHANGED}` }; }
  const damaged = { problem: `The agents record is damaged. ${NOTHING_CHANGED}` };
  try {
    const record = JSON.parse(text) as AgentRecord | null;
    const version = record?.formatVersion;
    if (!Number.isInteger(version) || version! < 1) return damaged;
    if (version! > AGENTS_FORMAT_VERSION) return { problem: `The agents record was written by a newer Central Knot. ${NOTHING_CHANGED}` };
    if (!validAgentItems(record!.items)) return damaged;
    return version === AGENTS_FORMAT_VERSION ? { record: record! } : {};
  } catch { return damaged; }
}
export async function readAgentRecord(home: string): Promise<AgentRecord> {
  return (await inspectAgentRecord(home)).record ?? { formatVersion: AGENTS_FORMAT_VERSION, items: {} };
}
const saveAgentRecord = (home: string, record: AgentRecord) => writeDurably(recordPath(home), `${JSON.stringify(record, null, 2)}\n`);

/**
 * Forgets the recorded copies in tools no longer managed (toolchoice.ts). An agent whose origin is left out has only one-way
 * copies left, which never sync with each other: they become ordinary copies, and the next pass picks an origin among them.
 * A damaged record is left as it is: it stops agent sync anyway.
 */
export async function forgetAgentCopies(home: string, managed: readonly HarnessId[]) {
  const { record } = await inspectAgentRecord(home);
  if (!record) return;
  for (const item of Object.values(record.items)) {
    item.copies = item.copies.filter(copy => managed.includes(copy.tool));
    if (!item.origin || managed.includes(item.origin)) continue;
    delete item.origin;
    for (const copy of item.copies) delete copy.oneWay;
  }
  await saveAgentRecord(home, record);
}

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
/** Keeps an agent file's content in Central Knot's store (by the agent's identity), so Restore can put that tool's own file back. */
export const keepAgentVersion = (context: ShareContext, entry: AgentEntry) => keep(context, entry);
async function kept(context: ShareContext, key: string, hash: string): Promise<{ tool: HarnessId; name: string; agent: NeutralAgent; texts: Partial<Record<HarnessId, string>> } | undefined> {
  const base = keptFolder(context, key, hash);
  try {
    const meta = JSON.parse(await readFile(join(base, 'agent.json'), 'utf8'));
    const texts: Partial<Record<HarnessId, string>> = {};
    for (const tool of agentTools) { try { texts[tool] = await readFile(join(base, `${tool}.txt`), 'utf8'); } catch { /* not kept for this tool */ } }
    return { ...meta, texts };
  } catch { return undefined; }
}

async function gatherAgents(context: ShareContext, tools: AgentTool[]) {
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

// A write or removal a crash interrupted is finished first, so a file moved aside is never read as deleted.
async function gatherAgentsAfterRecovery(context: ShareContext, tools: HarnessId[]) {
  const present = tools.filter(isAgentTool);
  for (const tool of present) await recoverParked(folder(context, tool));
  return { present, onDisk: await gatherAgents(context, present) };
}
const toolPrecedence: HarnessId[] = ['copilot-cli', 'claude-cli', 'codex-cli'];
/** The copy that holds the most fields among those with this content: the natural origin when none is recorded or chosen. */
function withMostFields(entries: AgentEntry[], hash: string): AgentEntry | undefined {
  return entries.filter(entry => entry.hash === hash).sort((first, second) => Object.keys(second.agent.fields).length - Object.keys(first.agent.fields).length || toolPrecedence.indexOf(first.tool) - toolPrecedence.indexOf(second.tool))[0];
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

/**
 * The agents each tool has through its installed plugins, by key: such a tool gets no file of its own beside the
 * plugin's. Only an agent Central Knot installed elsewhere as that plugin's part counts: a name alone could be another agent.
 */
async function agentsThroughPlugins(context: ShareContext, tools: HarnessId[]): Promise<Map<HarnessId, Map<string, ThroughPlugin>>> {
  const all = await throughPlugins(context, tools, 'agent', keyOf);
  return new Map([...all].map(([tool, given]) => [tool, new Map([...given].flatMap(([key, { asParts, text: _text, ...plugin }]) => (asParts ? [[key, plugin] as const] : [])))]));
}

export async function agentsView(context: ShareContext, tools: HarnessId[], notices: SyncNotice[] = []): Promise<McpView> {
  const present = tools.filter(isAgentTool);
  const { byKey, problems, unreadable, duplicates } = await gatherAgents(context, present);
  const { record = { formatVersion: AGENTS_FORMAT_VERSION, items: {} }, problem } = await inspectAgentRecord(context.home);
  if (problem) problems.unshift(problem);
  const agents: SkillFacts[] = [];
  const through = await agentsThroughPlugins(context, present);
  for (const [key, slot] of [...byKey].sort(([first], [second]) => first.localeCompare(second))) {
    const item = record.items[key];
    const entries = Object.values(slot) as AgentEntry[];
    const managed = item?.state === 'shared';
    const origin = originOnApply(item, slot, present);
    const shownCopy = origin ?? slot['claude-cli'] ?? entries[0];
    const copies: Partial<Record<HarnessId, ToolCopy>> = {};
    for (const entry of entries) {
      let modified = '';
      try { modified = (await stat(entry.file)).mtime.toISOString(); } catch { /* gone since */ }
      copies[entry.tool] = { hash: entry.hash, directory: entry.file, rootLabel: harnesses[entry.tool].name, lines: entry.agent.prompt.split('\n').length, modified, summary: entry.agent.description, writable: true, folder: entry.name };
    }
    const cannot: Partial<Record<HarnessId, string>> = {};
    if (!safeName(shownCopy.name)) for (const tool of present) if (!slot[tool]) cannot[tool] = 'This name can’t be a file name in another tool.';
    // A tool that has the agent through one of its plugins is shown as that, and gets no file of its own.
    const plugin: Partial<Record<HarnessId, ThroughPlugin>> = {};
    for (const tool of present) { const given = slot[tool] ? undefined : through.get(tool)?.get(key); if (given) { plugin[tool] = given; cannot[tool] = throughPlugin(tool, given, 'agent'); } }
    const limits: Partial<Record<HarnessId, string>> = {};
    if (origin) for (const tool of present) {
      const lost = losses(tool, origin);
      if (lost.length) limits[tool] = `One-way from ${shown[origin.tool]}. ${shown[tool]} has no setting for ${shown[origin.tool]}'s ${lost.map(field => `“${field}”`).join(lost.length > 2 ? ', ' : ' or ')}, so it gets only the name, description and prompt. Edit this agent in ${shown[origin.tool]}: an edit made in ${shown[tool]} stays there, and Central Knot then stops updating that copy.`;
    }
    const edited = managed ? item.copies.filter(copy => !copy.oneWay && !copy.status && slot[copy.tool] && slot[copy.tool]!.hash !== copy.hash).map(copy => copy.tool) : [];
    const stopped = item?.copies.filter(copy => copy.stopped).map(copy => copy.tool) ?? [];
    const kept = origin && Object.keys(limits).length ? Object.entries(origin.agent.fields).map(([field, value]) => `${field} (${fieldText(value)})`) : undefined;
    agents.push({ key, name: shownCopy.name, description: shownCopy.agent.description, copies, extra: [], managed, off: item?.off ?? [], cannot, ...(Object.keys(plugin).length ? { plugin } : {}), held: blocked(key, unreadable, duplicates, present), separate: item?.separate, edited, choiceBlocks: {}, limits, oneWay: origin && Object.keys(limits).length ? { from: origin.tool, lost: Object.keys(origin.agent.fields) } : undefined, stopped, kept });
  }
  const gone = goneFacts(await readHistory(context), new Set(byKey.keys()), event => (event.key.startsWith('agent:') ? event.key.slice('agent:'.length) : undefined));
  return { tools: present, servers: agents, gone, claudePending: [], access: await writeAccess(context), gate: problem ? { state: 'stopped', reason: problem } : await syncGate(context), problems, notices };
}

/** The origin the next Apply records for this agent, from its copies as that pass would classify them; none when it would hold. */
function originOnApply(item: AgentRecordItem | undefined, slot: AgentSlot, present: HarnessId[]): AgentEntry | undefined {
  const found = present.filter(tool => !item?.off.includes(tool)).flatMap(tool => {
    const entry = slot[tool], recorded = item?.copies.find(copy => copy.tool === tool && !copy.status);
    return entry && !recorded?.stopped ? [{ entry, recorded }] : [];
  });
  const twoWayFound = found.flatMap(({ entry, recorded }) => (recorded?.oneWay ? [] : [entry]));
  const edited = found.flatMap(({ entry, recorded }) => (recorded && !recorded.oneWay && entry.hash !== recorded.hash ? [entry] : []));
  const unrecorded = found.flatMap(({ entry, recorded }) => (recorded ? [] : [entry]));
  return sourceAndOrigin(twoWayFound, edited, unrecorded, item ?? { hash: '' }, false)?.origin;
}

// ---------- Apply ----------

/** Observed missing times per file, kept while the app runs (DEL-01's settle). A restart forgets them, which only delays a deletion. */
const firstSeenMissingAt = new Map<AgentCopy['file'], AgentPass['now']>();

interface AgentPass { context: ShareContext; present: AgentTool[]; through: Awaited<ReturnType<typeof agentsThroughPlugins>>; record: AgentRecord; onDisk: Awaited<ReturnType<typeof gatherAgents>>; folderIds: NonNullable<AgentRecord['roots']>;
  resetTools: Set<HarnessId>; chosen: Set<string>; newlyManaged: Set<string>; /** Synced agents that sync to tools again, and which. */ rejoined: Map<string, HarnessId[]>; deletedNow: Set<string>; limitedToKeys?: Set<string>; now: number; settleMs: number; decideNow?: Set<string> }
interface PassLog { results: DestinationResult[]; events: HistoryEvent[]; notices: SyncNotice[]; writes: number; /** The events the asked changes made, for their Undo. */ made: string[] } type Loser = { tool: HarnessId; hash: string };
type Situation = 'rootMoved' | 'removalOwed' | 'folderRemade' | 'stopped' | 'away' | 'off' | 'oneWay' | 'oneWayChanged' | 'deleted' | 'unchanged' | 'edited';
type StaysRecorded = Exclude<Situation, 'rootMoved' | 'folderRemade'>; interface CopyNow<Is = Exclude<StaysRecorded, 'oneWayChanged'>> { copy: AgentCopy; entry?: AgentEntry; is: Is }
interface Target { tool: AgentTool; entry?: AgentEntry; recorded?: CopyNow } type AgentOutcome = 'done' | 'settling';
/**
 * Records what each change asks (synced or not, tools left out, a chosen copy) and brings each synced agent into line. `only`: with Sync off, a click writes exactly the agents it
 * shows and nothing else spreads (SYN-03). `decideNow`: agents (by key) whose missing copies count as deleted at once (a
 * deletion the person asked for, as Pull's); the rest keep the settle window.
 */
export async function applyAgents(context: ShareContext, tools: HarnessId[], changes: Change[], options: { settleMs?: number; now?: number; only?: Set<string>; resume?: boolean; decideNow?: Set<string> } = {}): Promise<McpResult> {
  const refused = await prepareSyncRecord(context, changes.length > 0, options.resume);
  if (refused) return refused;
  const { present, onDisk } = await gatherAgentsAfterRecovery(context, tools);
  const record = await readAgentRecord(context.home);
  const log: PassLog = { results: [], events: [], notices: [], writes: 0, made: [] };
  const displacedByEarlierPass = Object.entries(record.items).flatMap(([key, item]) => (item.displaced ?? []).map(entry => ({ key, ...entry })));
  const { folderIds, resetTools } = await readFolderIds(context, present, record.roots);
  const { chosen, newlyManaged, rejoined } = recordChoices(record, onDisk.byKey, changes, log);
  const pass: AgentPass = { context, present, through: await agentsThroughPlugins(context, present), record, onDisk, folderIds, resetTools, chosen, newlyManaged, rejoined, deletedNow: new Set(), limitedToKeys: options.only, now: options.now ?? Date.now(), settleMs: options.settleMs ?? 2000, decideNow: options.decideNow };
  const outcomes: AgentOutcome[] = [];
  for (const [key, item] of Object.entries(record.items)) if (item.state === 'shared' && (!options.only || options.only.has(key))) outcomes.push(await syncAgent(pass, log, key, item));
  await finishPendingRemovals(pass, log);
  await saveRecordAndHistory(pass, log, displacedByEarlierPass);
  return { results: log.results, writes: log.writes, notices: log.notices, settling: outcomes.includes('settling'), made: log.made };
}
async function prepareSyncRecord(context: ShareContext, hasChanges: boolean, resume = false): Promise<McpResult | undefined> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason, results: [], writes: 0 };
  const gate = await syncGate(context);
  if (gate.state === 'stopped' || (gate.state === 'needs-resume' && !resume)) return { stopped: gate.reason, results: [], writes: 0 };
  const recordProblem = (await inspectAgentRecord(context.home)).problem;
  if (recordProblem) return { stopped: recordProblem, results: [], writes: 0 };
  let { record: syncRecord } = await readRecord(context.home);
  if (!syncRecord && !hasChanges) return { results: [], writes: 0 };
  if (!syncRecord) { syncRecord = newRecord(context); await saveRecord(context.home, syncRecord); }
  if (gate.state !== 'ready') await remember(context, syncRecord.generation);
  return undefined;
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
  const chosen = new Set<string>(), newlyManaged = new Set<string>(), rejoined = new Map<string, HarnessId[]>();
  for (const change of changes) {
    const slot = byKey.get(change.key);
    if (!slot) continue;
    // A change made from an older read of the page is refused when the agent changed since (a deletion spread meanwhile).
    const was = record.items[change.key];
    if (change.seenManaged !== undefined && (was?.state === 'shared') !== change.seenManaged) { log.results.push({ item: was?.name ?? change.key, outcome: 'held', message: `${was?.name ?? change.key} changed since the page was read${was?.deleted ? ' (it was deleted)' : ''}. Nothing was changed; read again.` }); continue; }
    const separate = change.use === 'separate', use = change.use === 'separate' ? undefined : change.use;
    if (use && change.useHash && slot[use]?.hash !== change.useHash) { log.results.push({ item: change.key, outcome: 'held', message: 'The copy you chose changed since you chose it. Nothing was changed; choose again.', chooseAgain: true }); continue; }
    const item = record.items[change.key] ??= { name: (Object.values(slot) as AgentEntry[])[0].name, state: 'dont-share', off: [], hash: '', copies: [] };
    const copiesBefore = item.copies;
    const shared = change.managed && !separate;
    if (shared && item.state !== 'shared') newlyManaged.add(change.key);
    else if (shared) rejoined.set(change.key, item.off.filter(tool => !change.off.includes(tool)));
    item.state = shared ? 'shared' : 'dont-share';
    item.off = change.off;
    item.separate = separate ? true : undefined;
    // Sync stops: a stopped one-way copy stays known as stopped (its edit kept), so syncing again finds it as it was.
    if (!shared) item.copies = item.copies.filter(copy => copy.status === 'removing' || copy.stopped);
    else delete item.deleted;
    const used = use && slot[use];
    if (used) { item.origin = used.tool; item.hash = used.hash; item.name = used.name; item.copies = []; chosen.add(change.key); }
    for (const copy of copiesBefore) if (!item.copies.includes(copy)) firstSeenMissingAt.delete(copy.file);
  }
  return { chosen, newlyManaged, rejoined };
}
async function syncAgent(pass: AgentPass, log: PassLog, key: string, item: AgentRecordItem): Promise<AgentOutcome> {
  const syncing = pass.present.filter(tool => !item.off.includes(tool));
  const problem = blocked(key, pass.onDisk.unreadable, pass.onDisk.duplicates, syncing);
  if (problem) { for (const copy of item.copies) firstSeenMissingAt.delete(copy.file); log.results.push({ item: item.name, outcome: 'held', message: problem }); return 'done'; }
  const slot = pass.onDisk.byKey.get(key) ?? {};
  const copies = stopOneWayCopiesChangedInTheirTool(log, item, classifyCopies(pass, item, slot, syncing));
  item.copies = copies.map(({ copy }) => copy);
  const edited = copies.some(({ is }) => is === 'edited'), deletedIn = copies.filter(({ is }) => is === 'deleted').map(({ copy }) => copy.tool);
  if (pass.limitedToKeys && !pass.chosen.has(key) && (edited || deletedIn.length)) { log.results.push({ item: item.name, outcome: 'held', message: `An edit or deletion of ${item.name} is waiting for sync. Turn automatic sync on, or use Sync once.` }); return 'done'; }
  if (deletionStillSettling(pass, copies, pass.decideNow?.has(key) ? 0 : pass.settleMs)) return 'settling';
  item.copies = copies.filter(({ is }) => is !== 'deleted').map(({ copy }) => copy);
  await (deletedIn.length && !edited ? spreadDeletion : spreadContent)(pass, log, key, item, copies, targetsOf(pass, copies, slot, syncing), deletedIn);
  return 'done';
}
function situationOf(pass: AgentPass, recorded: AgentCopy, entry: AgentEntry | undefined, syncing: HarnessId[]): Situation {
  const { tool } = recorded, folderThere = pass.onDisk.folders.has(tool);
  if (pass.present.includes(tool) && dirname(recorded.file) !== folder(pass.context, tool)) return 'rootMoved';
  if (recorded.status === 'removing') return 'removalOwed';
  if (folderThere && !entry && (recorded.away || pass.resetTools.has(tool))) return 'folderRemade';
  if (recorded.stopped) return 'stopped';
  if (!folderThere) return 'away';
  if (!syncing.includes(tool)) return 'off';
  if (recorded.oneWay) return entry?.bytes === recorded.bytes ? 'oneWay' : 'oneWayChanged';
  if (!entry) return 'deleted';
  return entry.hash === recorded.hash ? 'unchanged' : 'edited';
}
function classifyCopies(pass: AgentPass, item: AgentRecordItem, slot: AgentSlot, syncing: HarnessId[]): CopyNow<StaysRecorded>[] {
  return item.copies.flatMap(recorded => {
    const entry = slot[recorded.tool], is = situationOf(pass, recorded, entry, syncing);
    if (is === 'rootMoved' || is === 'folderRemade') return [];
    return [{ copy: is === 'removalOwed' ? recorded : markedAwayOrNot(recorded, pass.onDisk.folders.has(recorded.tool)), entry, is }];
  });
}
const markedAwayOrNot = (recorded: AgentCopy, folderThere: boolean) => { const copy = { ...recorded }; if (folderThere) delete copy.away; else copy.away = true; return copy; };
function stopOneWayCopiesChangedInTheirTool(log: PassLog, item: AgentRecordItem, copies: CopyNow<StaysRecorded>[]): CopyNow[] {
  for (const { copy, entry, is } of copies) if (is === 'oneWayChanged') log.results.push({ item: item.name, harness: copy.tool, outcome: 'held', message: `${entry ? 'Changed' : 'Deleted'} in ${harnesses[copy.tool].name}, which gets this agent one-way. Central Knot stopped updating it there; nothing spread.` });
  return copies.map(({ copy, entry, is }) => (is === 'oneWayChanged' ? { copy: { ...copy, stopped: true }, entry, is: 'stopped' } : { copy, entry, is }));
}
function targetsOf(pass: AgentPass, copies: CopyNow[], slot: AgentSlot, syncing: AgentTool[]): Target[] {
  return syncing.filter(tool => !copies.some(({ copy, is }) => copy.tool === tool && (is === 'stopped' || !pass.onDisk.folders.has(tool)))).map(tool => ({ tool, entry: slot[tool], recorded: copies.find(({ copy, is }) => copy.tool === tool && is !== 'removalOwed') }));
}
function deletionStillSettling(pass: AgentPass, copies: CopyNow[], settleMs: number): boolean {
  for (const { copy, entry, is } of copies) if (is !== 'removalOwed' && (entry || !pass.onDisk.folders.has(copy.tool))) firstSeenMissingAt.delete(copy.file);
  const deleted = copies.filter(({ is }) => is === 'deleted').map(({ copy }) => copy.file);
  for (const file of deleted) if (!firstSeenMissingAt.has(file)) firstSeenMissingAt.set(file, pass.now);
  const settling = deleted.some(file => pass.now - firstSeenMissingAt.get(file)! < settleMs);
  if (!settling) for (const file of deleted) firstSeenMissingAt.delete(file);
  return settling;
}
async function spreadDeletion(pass: AgentPass, log: PassLog, key: string, item: AgentRecordItem, copies: CopyNow[], targets: Target[], [deletedIn]: HarnessId[]) {
  const removedFrom: HarnessId[] = [], remaining: AgentCopy[] = [];
  for (const { copy, entry: here, is } of copies) {
    // A stopped one-way copy is the person's own now: it stays, and stays known as this agent's, so Restore leaves it alone.
    if (is === 'stopped') remaining.push(copy);
    else if (is === 'away' || is === 'removalOwed') remaining.push(removalStillOwed(copy));
    else if (here && is !== 'off') {
      try { await keep(pass.context, here); await removeFileChecked(here.file, here.text); log.writes++; removedFrom.push(copy.tool); log.results.push({ item: item.name, harness: copy.tool, outcome: 'removed', message: `Deleted in ${harnesses[deletedIn].name}, so removed here too.` }); }
      catch (error) {
        if (errorCode(error) === 'CK_CHANGED') { log.results.push({ item: item.name, harness: copy.tool, outcome: 'held', message: `${harnesses[copy.tool].name}'s copy was changed just as the deletion spread, so it was kept as it is.` }); continue; }
        remaining.push(removalStillOwed(copy));
        log.results.push({ item: item.name, harness: copy.tool, outcome: 'failed', message: `Could not remove ${harnesses[copy.tool].name}'s copy yet. Central Knot will try again.` });
      }
    }
  }
  for (const { tool, entry, recorded } of targets) if (entry && !recorded) log.results.push({ item: item.name, harness: tool, outcome: 'held', message: `${harnesses[tool].name} has a different “${item.name}” that was never synced. It stays.` });
  const id = logEvent(log, { key: `agent:${key}`, item: item.name, kind: 'deleted', winner: { tool: deletedIn, hash: item.hash }, losers: [], orderProved: true, previous: item.hash });
  log.notices.push({ key: `agent:${key}`, item: item.name, kind: 'deleted', winner: deletedIn, losers: removedFrom, orderProved: true, history: id });
  pass.deletedNow.add(key);
  Object.assign(item, { state: 'dont-share', deleted: { at: new Date(pass.now).toISOString(), tool: deletedIn, hash: item.hash }, copies: remaining } satisfies Partial<AgentRecordItem>);
}
async function spreadContent(pass: AgentPass, log: PassLog, key: string, item: AgentRecordItem, copies: CopyNow[], targets: Target[], deletedMeanwhile: HarnessId[]) {
  const twoWayFound = targets.flatMap(({ entry, recorded }) => (entry && recorded?.is !== 'oneWay' ? [entry] : []));
  const edited = targets.flatMap(({ entry, recorded }) => (entry && recorded?.is === 'edited' ? [entry] : []));
  const unrecorded = targets.flatMap(({ entry, recorded }) => (entry && !recorded ? [entry] : []));
  const picked = sourceAndOrigin(twoWayFound, edited, unrecorded, item, pass.chosen.has(key));
  if (!picked) { log.results.push({ item: item.name, outcome: 'held', ...(twoWayFound.length ? { differs: true as const } : {}), message: twoWayFound.length ? 'Copies differ. Choose which copy to use.' : 'No copy is left to start from.' }); return; }
  const { source, origin } = picked;
  item.origin = origin.tool;
  // An edit raced the deletion: the edit is kept, and the deleted copy comes back with it (CON-01, D-04's offer).
  const historyWillName = edited.length > 0 || pass.chosen.has(key) || deletedMeanwhile.length > 0;
  const replaced: Loser[] = [], added: Loser[] = [];
  await keep(pass.context, source);
  const nextCopies = copies.filter(({ is }) => is === 'stopped' || is === 'removalOwed' || is === 'away').map(({ copy }) => copy);
  for (const target of targets) {
    const { copy, wrote } = await writeCopy(pass, log, item, target, source, origin, historyWillName);
    if (copy) nextCopies.push(copy);
    if (wrote && target.entry) replaced.push({ tool: target.tool, hash: target.entry.hash });
    else if (wrote && (pass.newlyManaged.has(key) || pass.rejoined.get(key)?.includes(target.tool))) added.push({ tool: target.tool, hash: copy.bytes });
  }
  logSpreadEvents(log, key, item, source, { chosen: pass.chosen.has(key), edited, deletedMeanwhile, rejoined: !pass.newlyManaged.has(key) }, replaced, added);
  Object.assign(item, { name: source.name, hash: source.hash, copies: nextCopies } satisfies Partial<AgentRecordItem>);
}
/** What a pass spreads and the origin it records (the page shows the same), or nothing when it holds for a choice. */
function sourceAndOrigin(twoWayFound: AgentEntry[], edited: AgentEntry[], unrecorded: AgentEntry[], item: Pick<AgentRecordItem, 'origin' | 'hash'>, chosen: boolean): { source: AgentEntry; origin: AgentEntry } | undefined {
  const recordedOrigin = twoWayFound.find(({ tool }) => tool === item.origin);
  const source = pickSource(edited, twoWayFound, recordedOrigin, item.hash);
  // An unrecorded copy that differs, with no baseline to call it behind, is a same-name collision: it needs a choice.
  if (!source || (!chosen && unrecorded.some(entry => entry.hash !== source.hash && entry.hash !== item.hash))) return undefined;
  // The origin stays the same tool unless it is chosen anew or can no longer be one (stable, so one-way never flips by itself).
  return { source, origin: recordedOrigin || withMostFields(twoWayFound, source.hash) || source };
}
// The winner: a one-sided edit at a two-way copy; competing edits by the fixed tool order (D-04); else the last synced content.
function pickSource(edited: AgentEntry[], twoWayFound: AgentEntry[], recordedOrigin: AgentEntry | undefined, lastSyncedHash: ContentHash): AgentEntry | undefined {
  if (edited.length) return [...edited].sort((first, second) => toolPrecedence.indexOf(first.tool) - toolPrecedence.indexOf(second.tool))[0];
  if (recordedOrigin?.hash === lastSyncedHash) return recordedOrigin;
  const allAgree = new Set(twoWayFound.map(entry => entry.hash)).size === 1;
  return withMostFields(twoWayFound, lastSyncedHash) ?? (allAgree ? withMostFields(twoWayFound, twoWayFound[0].hash) : undefined);
}
async function writeCopy(pass: AgentPass, log: PassLog, item: AgentRecordItem, { tool, entry: here, recorded }: Target, source: AgentEntry, origin: AgentEntry, historyWillName: boolean): Promise<{ copy: AgentCopy; wrote: true } | { copy?: AgentCopy; wrote: false }> {
  const lost = losses(tool, origin);
  const oneWay = lost.length > 0 || undefined;
  if (here?.hash === source.hash) return { copy: { tool, file: here.file, hash: here.hash, bytes: here.bytes, oneWay }, wrote: false };
  if (!here && !safeName(source.name)) { log.results.push({ item: item.name, harness: tool, outcome: 'held', message: 'This name can’t be a file name here.' }); return { wrote: false }; }
  const given = here ? undefined : pass.through.get(tool)?.get(source.key);
  if (given) { log.results.push({ item: item.name, harness: tool, outcome: 'held', message: throughPlugin(tool, given, 'agent') }); return { wrote: false }; }
  const path = here?.file ?? fileFor(pass.context, tool, source.name);
  let text: string;
  try { text = agentText(tool, source.agent, here?.text); } catch { log.results.push({ item: item.name, harness: tool, outcome: 'held', message: 'This file could not be updated without changing other parts of it.' }); return { wrote: false }; }
  try { if (here) await keepOverwrittenForHistory(pass, item, here, historyWillName); await writeFileChecked(path, text, here?.text); }
  catch (error) {
    if (here) dropDisplaced(item, entry => entry.tool === tool && entry.hash === here.hash);
    log.results.push({ item: item.name, harness: tool, outcome: 'held', message: error instanceof Error && 'code' in error && String(error.code).startsWith('CK_') ? error.message : `Could not write ${harnesses[tool].name}'s copy.` });
    const failedWriteKeepsRecordedCopy = here && recorded?.copy;
    return { copy: failedWriteKeepsRecordedCopy, wrote: false };
  }
  log.writes++;
  firstSeenMissingAt.delete(path);
  log.results.push({ item: item.name, harness: tool, outcome: 'written', replaced: here ? true : undefined, message: `${here ? `Now has ${harnesses[source.tool].name}'s version` : 'Added'}${oneWay ? `, with limits: ${harnesses[tool].name} has no equivalent for ${lost.join(', ')}` : ''}. Start a new session to use it.` });
  return { copy: { tool, file: path, hash: agentHash(source.agent), bytes: sha256(text), oneWay }, wrote: true };
}
// A copy that is only behind (a write that failed, caught up now) holds an older version that History already has.
async function keepOverwrittenForHistory(pass: AgentPass, item: AgentRecordItem, here: AgentEntry, historyWillName: boolean) {
  await keep(pass.context, here);
  if (historyWillName) { (item.displaced ??= []).push({ tool: here.tool, hash: here.hash }); await saveAgentRecord(pass.context.home, pass.record); }
}
function logSpreadEvents(log: PassLog, key: string, item: AgentRecordItem, source: AgentEntry, why: { chosen: boolean; edited: AgentEntry[]; deletedMeanwhile: HarnessId[]; rejoined: boolean }, replaced: Loser[], added: Loser[]) {
  const historyKey = `agent:${key}`;
  const winner = { tool: source.tool, hash: source.hash };
  if (added.length) log.made.push(logEvent(log, { key: historyKey, item: item.name, kind: 'added', losers: added, orderProved: true, previous: source.hash, ...(why.rejoined ? { rejoined: true } : {}) }));
  if (why.chosen && replaced.length) log.made.push(logEvent(log, { key: historyKey, item: item.name, kind: 'chosen', winner, losers: replaced, orderProved: true, previous: undefined, ...(why.rejoined ? { wasSynced: true } : {}) }));
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
    if ((pass.limitedToKeys && !pass.limitedToKeys.has(key)) || pass.deletedNow.has(key) || !pending.length) continue;
    const slot = pass.onDisk.byKey.get(key) ?? {};
    const inUseAgain = item.state === 'shared' || (Object.values(slot) as AgentEntry[]).some(entry => !item.off.includes(entry.tool) && !item.copies.some(copy => copy.tool === entry.tool));
    const done: AgentCopy[] = [];
    for (const copy of pending) {
      const here = slot[copy.tool];
      if (item.off.includes(copy.tool)) { done.push(copy); continue; }
      if (!here) { if (inUseAgain || pass.onDisk.folders.has(copy.tool)) done.push(copy); continue; }
      // A file elsewhere now (a moved agents folder) is not the one the deletion was owed for.
      if (inUseAgain || here.bytes !== copy.bytes || here.file !== copy.file) { done.push(copy); continue; }
      try { await keep(pass.context, here); await removeFileChecked(here.file, here.text); log.writes++; log.results.push({ item: item.name, harness: copy.tool, outcome: 'removed', message: 'Removed now, finishing an earlier deletion.' }); done.push(copy); }
      catch (error) { if (errorCode(error) === 'CK_CHANGED') done.push(copy); }
    }
    item.copies = item.copies.filter(copy => !done.includes(copy));
  }
}
async function saveRecordAndHistory(pass: AgentPass, log: PassLog, displacedByEarlierPass: (Loser & { key: string })[]) {
  const historyNames = (key: string, hash: string) => log.events.some(made => made.key === `agent:${key}` && (made.previous === hash || made.winner?.hash === hash || made.losers.some(loser => loser.hash === hash)));
  // Displaced content no event of this pass names (left by a pass that stopped part-way) gets its own History entry.
  for (const left of displacedByEarlierPass) {
    const item = pass.record.items[left.key];
    if (item && !historyNames(left.key, left.hash)) logEvent(log, { key: `agent:${left.key}`, item: item.name, kind: 'edit', winner: { tool: left.tool, hash: item.hash }, losers: [{ tool: left.tool, hash: left.hash }], orderProved: false, previous: left.hash });
  }
  // Folder identities are kept only by a full pass: a click with Sync off skips other agents, so a reset must still be seen next time.
  if (!pass.limitedToKeys) pass.record.roots = { ...pass.record.roots, ...pass.folderIds };
  await saveAgentRecord(pass.context.home, pass.record);
  await appendHistory(pass.context, log.events);
  // History names it now: the hold is dropped. A crash between leaves the hold, never content no one can restore.
  const released = Object.entries(pass.record.items).filter(([key, item]) => item.displaced?.some(entry => historyNames(key, entry.hash)));
  for (const [key, item] of released) dropDisplaced(item, entry => historyNames(key, entry.hash));
  if (released.length) await saveAgentRecord(pass.context.home, pass.record);
}
const removalStillOwed = (copy: AgentCopy): AgentCopy => ({ ...copy, status: 'removing' });
const logEvent = (log: PassLog, fields: Omit<HistoryEvent, 'id' | 'at'>) => { const made: HistoryEvent = { id: randomUUID(), at: new Date().toISOString(), ...fields }; log.events.push(made); return made.id; };
const dropDisplaced = (item: AgentRecordItem, drop: (entry: Loser) => boolean) => { if (!item.displaced) return; item.displaced = item.displaced.filter(entry => !drop(entry)); if (!item.displaced.length) delete item.displaced; };

/**
 * Undo of the agent files a change added: each goes again while it is exactly the file written (an edit since keeps it), with its
 * content kept in the store. An agent the change made synced is not synced again, as before; one it synced to more tools
 * (`rejoined`) stays synced and leaves those tools out again. A file that had to stay keeps its tool syncing.
 */
async function undoAddedAgent(context: ShareContext, tools: HarnessId[], history: HistoryEvent[], past: HistoryEvent): Promise<McpResult> {
  if (past.undoneBy) return { stopped: 'That change was already undone.', results: [], writes: 0 };
  const key = past.key.replace(/^agent:/, '');
  const record = await readAgentRecord(context.home);
  const item = record.items[key];
  if (!item || item.state !== 'shared') return { stopped: `${past.item} is not managed any more, so there is nothing to undo here.`, results: [], writes: 0 };
  const present = tools.filter(isAgentTool);
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
    results.push({ item: item.name, harness: loser.tool, outcome: 'removed', message: 'Removed the copy it added.' });
  }
  if (!stayed.length && !past.rejoined) { item.state = 'dont-share'; item.copies = item.copies.filter(copy => copy.stopped); }
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
  const slot = (await gatherAgents(context, tools.filter(isAgentTool))).byKey.get(key);
  // The agent's own tool, where every field lives: Claude Code first, as the fullest format.
  const origin = agentTools.find(tool => slot?.[tool]);
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
  const recordProblem = (await inspectAgentRecord(context.home)).problem;
  if (recordProblem) return { stopped: recordProblem, results: [], writes: 0 };
  const history = await readHistory(context);
  const past = history.find(entry => entry.id === eventId);
  if (past?.kind === 'added') return undoAddedAgent(context, tools, history, past);
  const key = past?.key.replace(/^agent:/, '');
  // A one-way copy that a choice replaced: it gets back only that tool's own edited file, and it stops updating again. The source
  // and the other receiving tools keep what they have; the agent stays one-way from the same source. Any other choice, 'narrow':
  // each replaced copy back in its own tool, the copies it added out.
  if (past && key && past.kind === 'chosen' && !past.undoneBy) {
    const copies = (await readAgentRecord(context.home)).items[key]?.copies ?? [];
    if (past.losers.length && past.losers.every(loser => copies.find(copy => copy.tool === loser.tool)?.oneWay)) return restoreReplacedOneWay(context, tools, history, past, key);
    if (choice === 'narrow') return undoChoiceAgent(context, tools, history, past, key);
  }
  // Undo of a put-back from a deletion is that deletion again.
  const deletion = past?.kind === 'restored' && !past.undoneBy ? history.find(entry => entry.undoneBy === past.id && entry.kind === 'deleted') : undefined;
  if (past && key && deletion) return deleteAgainAgent(context, tools, history, past, deletion, key);
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
  const { present, onDisk: { byKey, unreadable, duplicates } } = await gatherAgentsAfterRecovery(context, tools);
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
  const through = await agentsThroughPlugins(context, present);
  for (const tool of present.filter(candidate => !item.off.includes(candidate) && !stopped.has(candidate))) {
    const here = slot[tool];
    const given = here ? undefined : through.get(tool)?.get(key);
    if (given) { results.push({ item: item.name, harness: tool, outcome: 'held', message: throughPlugin(tool, given, 'agent') }); continue; }
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
    copies.push({ tool, file: path, hash, bytes: sha256(text), oneWay: oneWay || undefined });
    results.push({ item: item.name, harness: tool, outcome: 'written', message: 'Restored.' });
  }
  Object.assign(item, { state: 'shared', hash, origin: version.tool, name: version.name, copies } satisfies Partial<AgentRecordItem>);
  delete item.deleted;
  record.items[key] = item;
  await saveAgentRecord(context.home, record);
  past.undoneBy = randomUUID();
  await replaceHistory(context, [...history, { id: past.undoneBy, at: new Date().toISOString(), key: past.key, item: item.name, kind: 'restored', winner: { tool: replaced[0]?.tool ?? version.tool, hash }, losers: replaced, orderProved: true, previous: before }]);
  return { results, writes, made: [past.undoneBy] };
}

/**
 * Undo of a copy choice for a two-way agent, right after it: each replaced copy goes back in its own tool, whole as it was kept,
 * and the copies the choice added go again; the agent is not synced again, each tool keeping its own copy, as before. All or
 * nothing: a copy changed since stops it, and History's own Undo stays.
 */
async function undoChoiceAgent(context: ShareContext, tools: HarnessId[], history: HistoryEvent[], chosen: HistoryEvent, key: string): Promise<McpResult> {
  const stop = (stopped: string): McpResult => ({ stopped, results: [], writes: 0 });
  const record = await readAgentRecord(context.home);
  const item = record.items[key];
  if (!item || item.state !== 'shared') return stop(`${chosen.item} is not synced any more, so there is nothing to undo here.`);
  // The copies the same pass added: told just before the choice.
  const prior = history[history.indexOf(chosen) - 1];
  const added = prior?.key === chosen.key && prior.kind === 'added' && !prior.undoneBy ? prior : undefined;
  const { present, onDisk: { byKey, unreadable, duplicates } } = await gatherAgentsAfterRecovery(context, tools);
  const problem = blocked(key, unreadable, duplicates, present);
  if (problem) return stop(problem);
  const slot = byKey.get(key) ?? {};
  // Check everything first: each replaced tool still holds what the choice wrote, its own copy is kept, added copies unchanged.
  const putBack: { tool: HarnessId; here: AgentEntry; text: string }[] = [];
  for (const loser of chosen.losers) {
    const here = slot[loser.tool];
    const written = item.copies.find(copy => copy.tool === loser.tool);
    if (!here || !written || here.bytes !== written.bytes) return stop(`${harnesses[loser.tool].name}’s copy of ${item.name} changed since, so nothing was undone here. History can still put an earlier version back.`);
    const text = (await kept(context, key, loser.hash))?.texts[loser.tool];
    if (!text) return stop('The replaced copy is no longer in Central Knot’s store, so it can’t be put back.');
    putBack.push({ tool: loser.tool, here, text });
  }
  for (const loser of added?.losers ?? []) {
    const here = slot[loser.tool];
    if (here && here.bytes !== loser.hash) return stop(`${harnesses[loser.tool].name}’s new copy of ${item.name} was edited since, so nothing was undone here.`);
  }
  const results: DestinationResult[] = [];
  let writes = 0;
  for (const loser of added?.losers ?? []) {
    const here = slot[loser.tool];
    if (!here) continue;
    try { await keep(context, here); await removeFileChecked(here.file, here.text); } catch { results.push({ item: item.name, harness: loser.tool, outcome: 'failed', message: `Could not remove ${harnesses[loser.tool].name}'s copy.` }); continue; }
    writes++;
    results.push({ item: item.name, harness: loser.tool, outcome: 'removed', message: 'Removed the copy it added.' });
  }
  for (const { tool, here, text } of putBack) {
    try { await keep(context, here); await writeFileChecked(here.file, text, here.text); } catch { results.push({ item: item.name, harness: tool, outcome: 'failed', message: `Could not put ${harnesses[tool].name}'s copy back.` }); continue; }
    writes++;
    results.push({ item: item.name, harness: tool, outcome: 'written', message: 'Its own copy is back.' });
  }
  // Not synced again: each tool keeps the copy it has now, and the agent shows Copies differ as before.
  Object.assign(item, { state: 'dont-share', copies: item.copies.filter(copy => copy.stopped) } satisfies Partial<AgentRecordItem>);
  await saveAgentRecord(context.home, record);
  const id = randomUUID();
  chosen.undoneBy = id;
  if (added) added.undoneBy = id;
  await replaceHistory(context, history);
  return { results, writes };
}

/**
 * Undo of putting a deleted agent back: the deletion again. Each tool's copy goes while it is the one put back (or one recorded
 * for it); one changed since stays, and a stopped one-way copy stays its own. A new 'deleted' entry tells it, and puts it back
 * again.
 */
async function deleteAgainAgent(context: ShareContext, tools: HarnessId[], history: HistoryEvent[], restored: HistoryEvent, deletion: HistoryEvent, key: string): Promise<McpResult> {
  const record = await readAgentRecord(context.home);
  const item = record.items[key];
  if (!item || item.state !== 'shared') return { stopped: `${restored.item} is not synced any more, so there is nothing to undo here.`, results: [], writes: 0 };
  const { present, onDisk: { byKey } } = await gatherAgentsAfterRecovery(context, tools);
  const slot = byKey.get(key) ?? {};
  const results: DestinationResult[] = [];
  const remaining: AgentCopy[] = [];
  let writes = 0;
  for (const tool of present) {
    const here = slot[tool];
    const recorded = item.copies.find(copy => copy.tool === tool);
    if (recorded?.stopped) { remaining.push(recorded); continue; }
    if (!here) continue;
    if (here.hash !== restored.winner?.hash && recorded?.bytes !== here.bytes) { results.push({ item: item.name, harness: tool, outcome: 'held', message: `${harnesses[tool].name}'s copy was changed since, so it stays.` }); continue; }
    try { await keep(context, here); await removeFileChecked(here.file, here.text); } catch { results.push({ item: item.name, harness: tool, outcome: 'held', message: `${harnesses[tool].name}'s copy changed just now, so it stays.` }); continue; }
    writes++;
    results.push({ item: item.name, harness: tool, outcome: 'removed', message: 'Removed again.' });
  }
  const id = randomUUID();
  Object.assign(item, { state: 'dont-share', deleted: { at: new Date().toISOString(), tool: deletion.winner?.tool ?? item.origin ?? 'claude-cli', hash: item.hash }, copies: remaining } satisfies Partial<AgentRecordItem>);
  await saveAgentRecord(context.home, record);
  restored.undoneBy = id;
  await replaceHistory(context, [...history, { id, at: new Date().toISOString(), key: restored.key, item: item.name, kind: 'deleted', winner: deletion.winner, losers: [], orderProved: true, previous: item.hash }]);
  return { results, writes, made: [id] };
}

/** Undo of "use the source's copy" for a stopped one-way copy: that tool gets its own edited file back, unchanged since, and stops again. */
async function restoreReplacedOneWay(context: ShareContext, tools: HarnessId[], history: HistoryEvent[], past: HistoryEvent, key: string): Promise<McpResult> {
  const record = await readAgentRecord(context.home);
  const item = record.items[key];
  if (!item || item.state !== 'shared') return { stopped: 'That agent is not managed any more.', results: [], writes: 0 };
  const { present, onDisk: { byKey, unreadable, duplicates } } = await gatherAgentsAfterRecovery(context, tools);
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
    Object.assign(copy, { hash: loser.hash, bytes: sha256(text), stopped: true } satisfies Partial<AgentCopy>);
    results.push({ item: item.name, harness: loser.tool, outcome: 'written', message: `Its edited copy is back; it doesn’t receive updates from ${harnesses[item.origin ?? past.winner?.tool ?? 'claude-cli'].name}.` });
  }
  if (!writes) return { stopped: results[0]?.message ?? 'Nothing was put back.', results, writes };
  await saveAgentRecord(context.home, record);
  past.undoneBy = randomUUID();
  await replaceHistory(context, [...history, { id: past.undoneBy, at: new Date().toISOString(), key: past.key, item: item.name, kind: 'restored', winner: { tool: past.losers[0]!.tool, hash: past.losers[0]!.hash }, losers: replaced, orderProved: true, previous: item.hash }]);
  return { results, writes };
}
