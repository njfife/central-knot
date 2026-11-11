// Agents across tools (AGT-01, TRN-01, TRN-02, D-26, D-32): Claude Code Markdown, Copilot `.agent.md`, Codex TOML, OpenCode Markdown.
// Name, description and prompt are Representable everywhere. Any other field (tools, model, permission mode, hooks, Codex keys and
// tables) is its own tool's: no equivalent is recorded across tools. The origin is the copy the agent is shared from; a destination
// that lacks the origin's fields gets it With limits, one-way: it receives the origin's changes, and any change there (to the prompt
// or to its own fields) or its deletion stays local, and Central Knot stops updating it.
// Writing a destination changes only its name, description and prompt lines; every other byte of that file stays.
// The safety rules are the skills engine's: unreadable is never absent, every write and removal checks the file first, every
// replaced or removed file is kept whole for Restore, and deletions follow DEL-01 and DEL-02.
// This file owns agents' sync (applyAgents), their Off, Delete everywhere and putting copies back, and the Undo or Restore of
// every agent History entry (restoreAgent). Where an agent is off, and whether an entry's action still stands, are decided in
// historyrules.ts; the page's clicks are planned in clickplan.ts.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, readlink, stat, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseDocument, stringify as stringifyYaml } from 'yaml';
import { configRoot, harnesses, writeRoot } from './harnesses.ts';
import { appendHistory, goneFacts, readConverted, readHistory, recordConverted, heldOffFacts, replaceHistory } from './manage.ts';
import { undoChoice } from './choiceundo.ts';
import { endedBy, heldTools, offTools, sinceWords } from './historyrules.ts';
import { FORMAT_VERSION, newRecord, NOTHING_CHANGED, errorCode, fileTime, giveFileTime, readRecord, recoverParked, sha256, remember, removeFileChecked, saveRecord, storeDirectory, syncGate, writeAccess, writeDurably, writeFileChecked, type ShareContext } from './share.ts';
import { readTomlTables, tomlValue } from './textedit.ts';
import { ALREADY_AS_IT_WAS } from './types.ts';
import type { AgentCopyRecord, Change, RecordBefore, RestoreHow, DestinationResult, HarnessId, HistoryEvent, McpResult, McpView, SkillFacts, SyncNotice, ThroughPlugin, ToolCopy } from './types.ts';
import { agentTools, type AgentTool } from './presence.ts';
import { andList, throughPlugin, toolNames as shown } from './words.ts';
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
interface AgentCopy extends AgentCopyRecord { tool: AgentTool; status?: 'removing'; /** Its tool's agents folder was gone when last looked at. */ away?: boolean }
/**
 * A copy's record as it is, noted to be recorded again exactly: by a choice's Undo, and when a copy taken out is put back. What
 * a pass is still doing with it (a removal owed, its folder away) is not noted: the next pass sees that afresh.
 */
const noted = ({ status: _status, away: _away, ...copy }: AgentCopy): AgentCopyRecord => copy;
/** Records a noted copy again, in place of what the record has for its tool now. */
const recordAgain = (item: AgentRecordItem, copy: AgentCopyRecord) => { item.copies = [...item.copies.filter(entry => entry.tool !== copy.tool), { ...copy, tool: copy.tool as AgentTool }]; };
interface AgentRecordItem { name: string; state: 'shared' | 'dont-share'; off: HarnessId[]; hash: ContentHash; origin?: HarnessId; copies: AgentCopy[]; separate?: boolean; /** `tool`: where it was deleted by hand; Delete everywhere names none. */ deleted?: { at: string; tool?: HarnessId; hash: ContentHash };
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

/** An agent's key in a History entry's, or undefined for another kind's. */
const historyKey = (event: HistoryEvent) => (event.key.startsWith('agent:') ? event.key.slice('agent:'.length) : undefined);

export async function agentsView(context: ShareContext, tools: HarnessId[], notices: SyncNotice[] = []): Promise<McpView> {
  const present = tools.filter(isAgentTool);
  const { byKey, problems, unreadable, duplicates } = await gatherAgents(context, present);
  const { record = { formatVersion: AGENTS_FORMAT_VERSION, items: {} }, problem } = await inspectAgentRecord(context.home);
  if (problem) problems.unshift(problem);
  const agents: SkillFacts[] = [];
  const through = await agentsThroughPlugins(context, present);
  const history = await readHistory(context);
  // Turned off in a tool (its copy removed): History's open removal says where, and puts it back.
  const removed = heldOffFacts(history, new Set(byKey.keys()), historyKey);
  for (const [key, slot] of [...byKey].sort(([first], [second]) => first.localeCompare(second))) {
    const item = record.items[key];
    const entries = Object.values(slot) as AgentEntry[];
    const managed = item?.state === 'shared';
    const off = notSyncing(item, heldTools(history, `agent:${key}`));
    const origin = originOnApply(item, off, slot, present);
    const shownCopy = origin ?? slot['claude-cli'] ?? entries[0];
    const copies: Partial<Record<HarnessId, ToolCopy>> = {};
    for (const entry of entries) {
      let modified = '';
      try { modified = (await stat(entry.file)).mtime.toISOString(); } catch { /* gone since */ }
      copies[entry.tool] = { hash: entry.hash, directory: entry.file, rootLabel: harnesses[entry.tool].name, lines: entry.agent.prompt.split('\n').length, modified, summary: entry.agent.description, prompt: entry.agent.prompt, writable: true, folder: entry.name };
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
    const stopped = present.filter(tool => item?.copies.some(copy => copy.tool === tool && copy.stopped));
    const kept = origin && Object.keys(limits).length ? Object.entries(origin.agent.fields).map(([field, value]) => `${field} (${fieldText(value)})`) : undefined;
    agents.push({ key, name: shownCopy.name, description: shownCopy.agent.description, copies, extra: [], managed, off, cannot, ...(Object.keys(plugin).length ? { plugin } : {}), held: blocked(key, unreadable, duplicates, present), separate: item?.separate, edited, choiceBlocks: {}, limits, oneWay: origin && Object.keys(limits).length ? { from: origin.tool, lost: Object.keys(origin.agent.fields) } : undefined, stopped, kept, ...removed.get(key) });
  }
  const gone = goneFacts(history, new Set(byKey.keys()), historyKey);
  // One turned off with no copy of its own left that a tool still has through a plugin is that plugin's item's row too.
  for (const fact of gone) for (const tool of present) {
    const given = through.get(tool)?.get(fact.key);
    if (given) { (fact.plugin ??= {})[tool] = given; fact.cannot[tool] = throughPlugin(tool, given, 'agent'); }
  }
  // An Off row still says what the agent is (the description of the copy History keeps), and where it is off (Rule A).
  for (const fact of gone) {
    fact.off = notSyncing(record.items[fact.key], heldTools(history, `agent:${fact.key}`));
    const loser = history.find(event => event.id === fact.gone!.history)?.losers[0];
    const version = loser && await kept(context, fact.key, loser.hash);
    if (version) fact.description = version.agent.description;
  }
  // A one-way copy turned off waits for its source (waitsForSource): the row offers its switch once the source is back.
  for (const fact of [...agents, ...gone]) if (fact.heldOff) {
    const origin = record.items[fact.key]?.origin;
    fact.heldOff = fact.heldOff.map(entry => {
      const off = history.find(event => event.id === entry.history)!;
      const source = waitsForSource(history, off, off.losers.find(loser => loser.tool === entry.tool), origin, !!fact.copies[origin!]);
      return source ? { ...entry, source } : entry;
    });
  }
  return { tools: present, servers: agents, gone, claudePending: [], access: await writeAccess(context), gate: problem ? { state: 'stopped', reason: problem } : await syncGate(context), problems, notices };
}

/**
 * The tools that take no part in syncing an agent now: those the person left out (the record's `off`), and those a standing Off
 * holds (Rule A, historyrules.ts heldTools). The page reads both as its `off`; a change's `off` never puts a held tool in the record's.
 */
const notSyncing = (item: Pick<AgentRecordItem, 'off'> | undefined, held: HarnessId[]) => [...new Set([...(item?.off ?? []), ...held])];
/**
 * The source a one-way copy taken out by `off` waits for: while that Off, or a later one, holds its source and the source has no
 * copy, it goes back only after the source (the row offers its switch then, and putBackAgent puts the source back first). A
 * receiver turned off after its source was already off goes back as it was; a source gone any other way (deleted) is no reason
 * to wait. `sourceHas`: the source's tool has a copy now.
 */
function waitsForSource(history: HistoryEvent[], off: HistoryEvent, loser: HistoryEvent['losers'][number] | undefined, origin: HarnessId | undefined, sourceHas: boolean): HarnessId | undefined {
  if (!loser?.record?.oneWay || !origin || origin === loser.tool || sourceHas) return undefined;
  const sourceOff = history.findIndex(event => event.key === off.key && offTools(event, history).includes(origin));
  return sourceOff >= 0 && sourceOff >= history.findIndex(event => event.id === off.id) ? origin : undefined;
}

/** The origin the next Apply records for this agent, from its copies as that pass would classify them; none when it would hold. */
function originOnApply(item: AgentRecordItem | undefined, off: HarnessId[], slot: AgentSlot, present: HarnessId[]): AgentEntry | undefined {
  const found = present.filter(tool => !off.includes(tool)).flatMap(tool => {
    const entry = slot[tool], recorded = item?.copies.find(copy => copy.tool === tool && !copy.status);
    return entry && !recorded?.stopped ? [{ entry, recorded }] : [];
  });
  const twoWayFound = found.flatMap(({ entry, recorded }) => (recorded?.oneWay ? [] : [entry]));
  const edited = found.flatMap(({ entry, recorded }) => (recorded && !recorded.oneWay && entry.hash !== recorded.hash ? [entry] : []));
  const unrecorded = found.flatMap(({ entry, recorded }) => (recorded ? [] : [entry]));
  return sourceAndOrigin(twoWayFound, edited, unrecorded, item ?? { hash: '' }, false, item?.state !== 'shared')?.origin;
}

// ---------- Apply ----------

/** Observed missing times per file, kept while the app runs (DEL-01's settle). A restart forgets them, which only delays a deletion. */
const firstSeenMissingAt = new Map<AgentCopy['file'], AgentPass['now']>();

interface AgentPass { context: ShareContext; present: AgentTool[]; through: Awaited<ReturnType<typeof agentsThroughPlugins>>; record: AgentRecord; onDisk: Awaited<ReturnType<typeof gatherAgents>>; folderIds: NonNullable<AgentRecord['roots']>;
  /** The tools a standing Off holds for an agent (by key), this pass's own Offs included: sync gives them nothing (Rule A). */ held: (key: string) => HarnessId[];
  resetTools: Set<HarnessId>; /** Agents whose copy the person chose this pass, with the content each synced before (undefined: not synced then). */ chosen: Map<string, string | undefined>; /** With each choice, what it changed in the record besides the copies it writes. */ before: Map<string, RecordBefore>; newlyManaged: Set<string>; /** Synced agents that sync to tools again, and which. */ rejoined: Map<string, HarnessId[]>; deletedNow: Set<string>; limitedToKeys?: Set<string>; now: number; settleMs: number; decideNow?: Set<string> }
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
  const history = await readHistory(context);
  const held = (key: string) => heldTools([...history, ...log.events], `agent:${key}`);
  const displacedByEarlierPass = Object.entries(record.items).flatMap(([key, item]) => (item.displaced ?? []).map(entry => ({ key, ...entry })));
  const { folderIds, resetTools } = await readFolderIds(context, present, record.roots);
  const { chosen, before, newlyManaged, rejoined, removing } = recordChoices(record, onDisk.byKey, changes, log, held);
  for (const [key, { tools: out, everywhere }] of removing) {
    const slot = onDisk.byKey.get(key) ?? {};
    const taken = everywhere ? await deleteAgentEverywhere(context, record.items[key], key, slot, out, present) : await turnOffAgent(context, record.items[key], key, slot, out, present, held(key));
    log.results.push(...taken.results);
    log.writes += taken.writes;
    if (taken.event) { log.events.push(taken.event); log.made.push(taken.event.id); }
  }
  const pass: AgentPass = { context, present, through: await agentsThroughPlugins(context, present), record, onDisk, folderIds, held, resetTools, chosen, before, newlyManaged, rejoined, deletedNow: new Set(), limitedToKeys: options.only, now: options.now ?? Date.now(), settleMs: options.settleMs ?? 2000, decideNow: options.decideNow };
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
function recordChoices(record: AgentRecord, byKey: Map<string, AgentSlot>, changes: Change[], log: PassLog, heldOf: (key: string) => HarnessId[]) {
  const chosen = new Map<string, string | undefined>(), before = new Map<string, RecordBefore>(), newlyManaged = new Set<string>(), rejoined = new Map<string, HarnessId[]>();
  const removing = new Map<string, { tools: HarnessId[]; everywhere: boolean }>();
  for (const change of changes) {
    const slot = byKey.get(change.key);
    // Delete everywhere also takes an agent that is off with no copy left: its row goes.
    if (!slot && !(change.everywhere && record.items[change.key])) continue;
    // A change made from an older read of the page is refused when the agent changed since (a deletion spread meanwhile).
    const was = record.items[change.key];
    if (change.seenManaged !== undefined && (was?.state === 'shared') !== change.seenManaged) { log.results.push({ item: was?.name ?? change.key, outcome: 'held', unchanged: true, message: `${was?.name ?? change.key} changed since the page was read${was?.deleted ? ' (it was deleted)' : ''}. Nothing was changed; read again.` }); continue; }
    const separate = change.use === 'separate', use = change.use === 'separate' ? undefined : change.use;
    if (use && change.useHash && slot?.[use]?.hash !== change.useHash) { log.results.push({ item: change.key, outcome: 'held', unchanged: true, message: 'The copy you chose changed since you chose it. Nothing was changed; choose again.', chooseAgain: true }); continue; }
    const item = record.items[change.key] ??= { name: (Object.values(slot!) as AgentEntry[])[0].name, state: 'dont-share', off: [], hash: '', copies: [] };
    // A person's own agent leaves a tool only to turn it off there (no tool has a switch for it), or with Delete everywhere.
    // Neither chooses how it syncs: an Off row's change says nothing true about that, so the record keeps what it has.
    if (change.everywhere || (change.remove?.length && change.turnOff)) { removing.set(change.key, { tools: change.remove ?? [], everywhere: !!change.everywhere }); continue; }
    if (change.remove?.length) log.results.push({ item: item.name, outcome: 'held', message: `An agent’s copy leaves a tool only to turn it off there or with Delete everywhere, and this change asked for neither, so no copy of ${item.name} was removed.` });
    const held = heldOf(change.key);
    const syncedBefore = item.state === 'shared' ? item.hash : undefined;
    const copiesBefore = item.copies;
    const shared = change.managed && !separate;
    if (shared && item.state !== 'shared') newlyManaged.add(change.key);
    else if (shared) rejoined.set(change.key, item.off.filter(tool => !change.off.includes(tool)));
    item.state = shared ? 'shared' : 'dont-share';
    // Rule A: the row reads a tool an Off holds as off, but that is the Off's to end, never the record's left-out list.
    item.off = change.off.filter(tool => !held.includes(tool));
    item.separate = separate ? true : undefined;
    // Sync stops: a stopped one-way copy stays known as stopped (its edit kept), so syncing again finds it as it was.
    if (!shared) item.copies = item.copies.filter(copy => copy.status === 'removing' || copy.stopped);
    else delete item.deleted;
    const named = use && slot?.[use];
    if (named && slot) {
      const stopped = copiesBefore.filter(copy => copy.stopped).map(copy => copy.tool);
      const origin = syncedBefore === undefined ? undefined : item.origin;
      const used = sourceOfChoice(named, slot, notSyncing(item, held), stopped, origin);
      // The record as it was, for the choice's Undo to record again.
      before.set(change.key, { ...(origin ? { origin } : {}), copies: copiesBefore.map(noted) });
      Object.assign(item, { origin: used.tool, hash: used.hash, name: used.name } satisfies Partial<AgentRecordItem>);
      // Every copy takes the chosen one; a tool's Stopped switch gives it to that tool only, and every other copy is as it was.
      item.copies = change.resumeIn ? copiesBefore.filter(copy => copy.tool !== change.resumeIn) : [];
      chosen.set(change.key, syncedBefore);
    }
    for (const copy of copiesBefore) if (!item.copies.includes(copy)) firstSeenMissingAt.delete(copy.file);
  }
  return { chosen, before, newlyManaged, rejoined, removing };
}
/**
 * The source a choice records. Copies that are the same are one choice, whichever tool the card named: a synced agent keeps its
 * source when that copy holds the chosen content; otherwise the copy with the most fields is the source (the named one when it has
 * as many), never a copy that stopped updating or one in a tool left out.
 */
function sourceOfChoice(named: AgentEntry, slot: AgentSlot, off: HarnessId[], stopped: HarnessId[], origin: HarnessId | undefined): AgentEntry {
  const kept = origin && !off.includes(origin) ? slot[origin] : undefined;
  if (kept?.hash === named.hash) return kept;
  const candidates = (Object.values(slot) as AgentEntry[]).filter(entry => !off.includes(entry.tool) && !stopped.includes(entry.tool));
  const fullest = withMostFields(candidates, named.hash);
  const fields = (entry: AgentEntry) => Object.keys(entry.agent.fields).length;
  return fullest && fields(fullest) > fields(named) ? fullest : named;
}
async function syncAgent(pass: AgentPass, log: PassLog, key: string, item: AgentRecordItem): Promise<AgentOutcome> {
  const off = notSyncing(item, pass.held(key));
  const syncing = pass.present.filter(tool => !off.includes(tool));
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
  const picked = sourceAndOrigin(twoWayFound, edited, unrecorded, item, pass.chosen.has(key), pass.newlyManaged.has(key));
  if (!picked) { log.results.push({ item: item.name, outcome: 'held', ...(twoWayFound.length ? { differs: true as const } : {}), message: twoWayFound.length ? 'Copies differ. Choose which copy to use.' : 'No copy is left to start from.' }); return; }
  const { source, origin } = picked;
  item.origin = origin.tool;
  // An edit raced the deletion: the edit is kept, and the deleted copy comes back with it (CON-01, D-04's offer).
  const historyWillName = edited.length > 0 || pass.chosen.has(key) || deletedMeanwhile.length > 0;
  const replaced: Loser[] = [], added: Loser[] = [];
  await keep(pass.context, source);
  const nextCopies = copies.filter(({ is }) => is === 'stopped' || is === 'removalOwed' || is === 'away').map(({ copy }) => copy);
  for (const target of targets) {
    // A copy a choice replaces keeps its edit time on the choice, for its Undo.
    const editedAt = target.entry && pass.chosen.has(key) ? await fileTime(target.entry.file) : undefined;
    const { copy, wrote } = await writeCopy(pass, log, item, target, source, origin, historyWillName);
    if (copy) nextCopies.push(copy);
    if (wrote && target.entry) replaced.push({ tool: target.tool, hash: target.entry.hash, ...(editedAt ? { editedAt } : {}) });
    else if (wrote && (pass.newlyManaged.has(key) || pass.rejoined.get(key)?.includes(target.tool))) added.push({ tool: target.tool, hash: copy.bytes });
  }
  logSpreadEvents(log, key, item, source, { chosen: pass.chosen.has(key), syncedBefore: pass.chosen.get(key), before: pass.before.get(key), edited, deletedMeanwhile, rejoined: !pass.newlyManaged.has(key) }, replaced, added);
  Object.assign(item, { name: source.name, hash: source.hash, copies: nextCopies } satisfies Partial<AgentRecordItem>);
}
/** What a pass spreads and the origin it records (the page shows the same), or nothing when it holds for a choice. */
function sourceAndOrigin(twoWayFound: AgentEntry[], edited: AgentEntry[], unrecorded: AgentEntry[], item: Pick<AgentRecordItem, 'origin' | 'hash'>, chosen: boolean, newlyManaged: boolean): { source: AgentEntry; origin: AgentEntry } | undefined {
  const recordedOrigin = twoWayFound.find(({ tool }) => tool === item.origin);
  const source = pickSource(edited, twoWayFound, recordedOrigin, item.hash);
  // An unrecorded copy that differs, with no baseline to call it behind, is a same-name collision: it needs a choice. So, in an
  // agent synced before this pass, is one that would be the source itself while it differs from what was synced (one made by
  // hand in a tool while an Off held it there); an agent turned on just now takes up its copies as they are.
  const collision = (entry: AgentEntry) => entry.hash !== item.hash && (entry.hash !== source!.hash || (!newlyManaged && !!item.hash && !edited.length));
  if (!source || (!chosen && unrecorded.some(collision))) return undefined;
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
function logSpreadEvents(log: PassLog, key: string, item: AgentRecordItem, source: AgentEntry, why: { chosen: boolean; syncedBefore?: string; before?: RecordBefore; edited: AgentEntry[]; deletedMeanwhile: HarnessId[]; rejoined: boolean }, replaced: Loser[], added: Loser[]) {
  const historyKey = `agent:${key}`;
  const winner = { tool: source.tool, hash: source.hash };
  const addedId = added.length ? logEvent(log, { key: historyKey, item: item.name, kind: 'added', losers: added, orderProved: true, previous: source.hash, ...(why.rejoined ? { rejoined: true } : {}) }) : undefined;
  if (addedId) log.made.push(addedId);
  // A choice names the copies its own pass added (its Undo takes out those, never others), and, synced before, what it synced
  // then; and the source it had and the copies that had stopped updating before it.
  if (why.chosen && replaced.length) log.made.push(logEvent(log, { key: historyKey, item: item.name, kind: 'chosen', winner, losers: replaced, orderProved: true, previous: why.syncedBefore || undefined, ...(why.syncedBefore !== undefined ? { wasSynced: true } : {}), ...(why.before && Object.keys(why.before).length ? { before: why.before } : {}), ...(addedId ? { addedId } : {}) }));
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
/** The tools whose copy had stopped updating before a choice. */
const stoppedBefore = (chosen: HistoryEvent) => chosen.before?.copies?.filter(copy => copy.stopped).map(copy => copy.tool) ?? chosen.before?.stopped ?? [];
/** A choice on a synced agent that replaced only copies which had stopped updating: it gave them the source's copy again. */
const isResume = (chosen: HistoryEvent) => !!chosen.wasSynced && chosen.losers.every(loser => stoppedBefore(chosen).includes(loser.tool));
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

// ---------- Off where no tool has a switch, Delete everywhere, and putting copies back ----------
//
// No tool has a switch for a person's own agent, so Off takes each tool's copy out, kept whole in the store and named by the
// Off's History entry. Where an agent is off is decided in one place, historyrules.ts offTools (Rule A): a tool a standing Off holds
// gets no copy from sync (the pass leaves it out, notSyncing) or from any click, but that Off's own copy, put back by
// putBackAgent. Off changes nothing else in the record: the tools the person left out stay as they were, and a synced agent
// stays synced until no copy is left outside its held tools. Whether an entry's action still applies is historyrules.ts endedBy
// (Rule B), checked once in restoreAgent before any of these run.
//
// Each entry made here notes `before`, whether the agent was synced: a put-back reads the Off's or the deletion's to make the
// agent synced again (syncedAgain), and the Undo of a put-back puts its own back (Rule B has made sure no later click changed it).

/** The agent's record as an entry notes it in `before`: synced or not. */
const recordNow = (item: AgentRecordItem): RecordBefore => ({ state: item.state });

/**
 * Takes the copies in `tools` out, each tool's own file (one a plugin brings is never touched), kept whole first and noted with
 * the copy's record, so a put-back records it again exactly. A copy changed meanwhile, or one that can't be removed, stays.
 * `slot` loses each copy taken, so the caller sees the tools as they are now.
 */
async function takeCopiesOut(context: ShareContext, item: AgentRecordItem, slot: AgentSlot, tools: HarnessId[], word: 'Removed' | 'Deleted') {
  const results: DestinationResult[] = [], losers: HistoryEvent['losers'] = [];
  for (const tool of tools) {
    const here = isAgentTool(tool) ? slot[tool] : undefined;
    if (!here) continue;
    const recorded = item.copies.find(copy => copy.tool === tool && !copy.status);
    // A copy that is a link (into a dotfiles folder, say) goes as the link: what it points to stays, and its put-back links again.
    const linkTo = await readlink(here.file).catch(() => undefined);
    try { await keep(context, here); await removeFileChecked(here.file, here.text); }
    catch (error) {
      const changed = errorCode(error) === 'CK_CHANGED';
      results.push({ item: item.name, harness: tool, outcome: changed ? 'held' : 'failed', message: changed ? `${harnesses[tool].name}’s copy changed just now, so it stays.` : `Could not remove ${harnesses[tool].name}’s copy.` });
      continue;
    }
    delete slot[here.tool];
    firstSeenMissingAt.delete(here.file);
    losers.push({ tool, hash: here.hash, folder: here.name, ...(linkTo !== undefined ? { linkTo } : {}), ...(recorded ? { record: noted(recorded) } : {}) });
    item.copies = item.copies.filter(copy => copy.tool !== tool);
    results.push({ item: item.name, harness: tool, outcome: 'removed', message: `${word} here; History keeps it.` });
  }
  return { results, losers };
}

/** An Off's or a deletion's History entry: the copies it took out, and the record as it was before it. */
function takenOutEntry(item: AgentRecordItem, key: string, kind: 'removed' | 'deleted', losers: HistoryEvent['losers'], before: RecordBefore): HistoryEvent {
  return { id: randomUUID(), at: new Date().toISOString(), key: `agent:${key}`, item: item.name, kind, losers, orderProved: true, previous: item.hash || undefined, before,
    ...(kind === 'removed' ? { turnedOff: true as const } : { everywhere: true as const, ...(losers.length ? { winner: { tool: losers[0].tool, hash: item.hash || losers[0].hash } } : {}) }) };
}
interface TakenOut { results: DestinationResult[]; writes: number; event?: HistoryEvent }

/**
 * Off in `tools`: each copy taken out is held by this Off from now on (Rule A). A synced agent left with no copy outside the tools
 * it was left out of or off in (`held`) has nothing to sync: it is not synced until a put-back brings a synced copy back. When
 * nothing could be taken out, nothing changes. The caller saves the record and the entry.
 */
async function turnOffAgent(context: ShareContext, item: AgentRecordItem, key: string, slot: AgentSlot, tools: HarnessId[], present: AgentTool[], held: HarnessId[]): Promise<TakenOut> {
  const before = recordNow(item);
  const { results, losers } = await takeCopiesOut(context, item, slot, tools, 'Removed');
  if (!losers.length) return { results, writes: 0 };
  if (item.state === 'shared' && !present.some(tool => slot[tool] && !notSyncing(item, held).includes(tool))) item.state = 'dont-share';
  return { results, writes: losers.length, event: takenOutEntry(item, key, 'removed', losers, before) };
}

/**
 * Delete everywhere, the only real delete: every copy out and the agent not synced, so its row goes; on an Off row it deletes the
 * row (the deletion ends that Off, historyrules.ts deletedSince). One whose copies all stayed deletes nothing. The caller saves the
 * record and the entry.
 */
async function deleteAgentEverywhere(context: ShareContext, item: AgentRecordItem, key: string, slot: AgentSlot, tools: HarnessId[], present: AgentTool[]): Promise<TakenOut> {
  const before = recordNow(item);
  const { results, losers } = await takeCopiesOut(context, item, slot, tools, 'Deleted');
  if (!losers.length && results.length) return { results, writes: 0 };
  markDeleted(item, present, slot);
  return { results, writes: losers.length, event: takenOutEntry(item, key, 'deleted', losers, before) };
}
/** Not synced, and marked deleted once no tool holds a copy (a copy a deletion couldn't take out is still this agent's). */
const markDeleted = (item: AgentRecordItem, present: AgentTool[], slot: AgentSlot) => {
  item.state = 'dont-share';
  if (!present.some(tool => slot[tool])) item.deleted = { at: new Date().toISOString(), hash: item.hash };
};

/**
 * The one rule for whether putting copies back makes an agent synced again: it was synced before the Off or the deletion that
 * took them out (its `before`), and a copy came back (`back`; a deletion that took nothing out comes back whole). Only finding a
 * copy that turned up changes nothing: that tool has it on as its own, and nothing is asked until another tool is on. A copy back
 * that was never the synced one is held for a choice by the next pass (sourceAndOrigin), never taken up as the synced copy.
 */
const syncedAgain = (past: HistoryEvent, back: HistoryEvent['losers']) => past.before?.state === 'shared' && (back.length > 0 || !past.losers.length);
/** Puts an agent file back: a link as the link it was while what it points to is there, else the kept file itself. */
async function putFileBack(file: string, text: string, linkTo: string | undefined) {
  await mkdir(dirname(file), { recursive: true });
  if (linkTo !== undefined && await stat(resolve(dirname(file), linkTo)).then(() => true, () => false)) { await symlink(linkTo, file); return; }
  await writeFileChecked(file, text, undefined);
}
/** Why a copy couldn't be written back, in plain words. */
const cantWrite = (error: unknown) => (['EACCES', 'EPERM', 'EROFS'].includes(errorCode(error) ?? '') ? 'its agents folder can’t be written.' : 'the file couldn’t be written.');
/** Why History's other actions wait while an Off stands (Rule A): where it is off, and what to do first. */
const offNowSaid = (name: string, held: HarnessId[], tools: HarnessId[]) => (tools.filter(isAgentTool).every(tool => held.includes(tool))
  ? `${name} is off now. Turn it on first.` : `${name} is off in ${andList(held.map(tool => shown[tool]))} now. Turn it on there first.`);
/** Why an entry's action is refused once Rule B ended it (from a page read before that), in History's words. */
const noLongerSaid = (name: string, ending: HistoryEvent) => (ending.kind === 'deleted' ? `${name} was deleted since; use Restore on that deletion in History.`
  : `${name} was ${sinceWords(ending).toLowerCase()}, so that no longer applies. Nothing was changed.`);

/**
 * Turning an agent on again where an Off took it out, or Restore of Delete everywhere: each copy goes back in its own tool, its own
 * file whole as kept, recorded again as it was (one-way and stopped marks too). An Off puts back only the tools it still holds
 * (offTools); `only`, that tool's copy alone. A tool with a copy again (one that turned up since) keeps it: that copy is the tool's
 * own now, and the entry notes it (`turnedUp`). A one-way copy waits for its source (waitsForSource), which goes back first. A
 * deletion's Restore waits while an Off of the agent stands. The 'restored' entry says what it put back from (`putBackFrom`) and
 * the record as it was before it (`before`), so its Undo (undoPutBack) is exactly the Off or the deletion again.
 */
async function putBackAgent(context: ShareContext, tools: HarnessId[], history: HistoryEvent[], past: HistoryEvent, only?: HarnessId): Promise<McpResult> {
  const stop = (stopped: string): McpResult => ({ stopped, results: [], writes: 0 });
  if (past.undoneBy) return stop('That was put back already.');
  const key = historyKey(past)!;
  const record = await readAgentRecord(context.home);
  const item = record.items[key];
  if (!item) return stop('That change can’t be restored.');
  const held = heldTools(history, past.key);
  if (past.kind === 'deleted' && held.length) return stop(offNowSaid(item.name, held, tools));
  const open = past.kind === 'removed' ? offTools(past, history) : past.losers.map(loser => loser.tool).filter(tool => !past.restoredTools?.includes(tool));
  if (only && !open.includes(only)) return stop(`${harnesses[only].name}’s copy isn’t this entry’s to put back any more.`);
  const { present, onDisk: { byKey, unreadable, duplicates } } = await gatherAgentsAfterRecovery(context, tools);
  const problem = blocked(key, unreadable, duplicates, present);
  if (problem) return stop(problem);
  const slot = byKey.get(key) ?? {};
  // A deleted agent whose name another agent now uses: never mixed with that one, as a deletion by hand's Restore isn't.
  if (past.kind === 'deleted' && item.state === 'shared' && item.hash !== past.previous) return stop(`“${item.name}” is managed again with other content. Restoring the old one would replace it; delete or rename the new one first.`);
  const other = past.kind === 'deleted' ? past.losers.find(loser => open.includes(loser.tool) && slot[loser.tool] && slot[loser.tool]!.hash !== loser.hash) : undefined;
  if (other) return stop(`A different “${item.name}” agent is in ${shown[other.tool]} now. Remove or rename it, then restore.`);
  const done = new Set(past.restoredTools ?? []);
  const results: DestinationResult[] = [], back: HistoryEvent['losers'] = [], turnedUp: HistoryEvent['losers'] = [];
  const going = past.losers.filter(gone => open.includes(gone.tool) && (!only || gone.tool === only)).sort((first, second) => Number(second.tool === item.origin) - Number(first.tool === item.origin));
  for (const loser of going) {
    const tool = loser.tool;
    if (!isAgentTool(tool) || !present.includes(tool)) { results.push({ item: item.name, harness: tool, outcome: 'held', message: `${harnesses[tool].name} isn’t one of the tools Central Knot manages here now, so its copy stays in History.` }); continue; }
    const source = waitsForSource(history, past, loser, item.origin, !!slot[item.origin!] || back.some(entry => entry.tool === item.origin));
    if (source) { results.push({ item: item.name, harness: tool, outcome: 'held', message: `Turn on ${shown[source]}’s copy first: it is the source.` }); continue; }
    const here = slot[tool];
    const text = (await kept(context, key, loser.hash))?.texts[tool];
    if (here) { done.add(tool); turnedUp.push(loser); results.push({ item: item.name, harness: tool, outcome: 'stayed', message: here.text === text ? 'It has it already.' : `It has its own “${item.name}” now, which turned up since; that copy stays.` }); continue; }
    if (text === undefined) { results.push({ item: item.name, harness: tool, outcome: 'failed', message: 'The kept copy is no longer in Central Knot’s store.' }); continue; }
    const file = fileFor(context, tool, loser.folder ?? item.name);
    try { await putFileBack(file, text, loser.linkTo); }
    catch (error) { results.push({ item: item.name, harness: tool, outcome: 'failed', message: `Could not put it back in ${harnesses[tool].name}: ${cantWrite(error)}` }); continue; }
    done.add(tool);
    back.push(loser);
    if (loser.record) recordAgain(item, { ...loser.record, file });
    results.push({ item: item.name, harness: tool, outcome: 'written', message: 'Put back. Start a new session to use it.' });
  }
  if (past.losers.length && !back.length && !turnedUp.length) return { stopped: results[0]?.message ?? 'Nothing could be put back.', results, writes: 0 };
  const before = recordNow(item);
  if (syncedAgain(past, back)) item.state = 'shared';
  const whole = open.every(tool => done.has(tool));
  if (past.kind === 'deleted' && whole) delete item.deleted;
  await saveAgentRecord(context.home, record);
  const id = randomUUID();
  if (whole) { past.undoneBy = id; delete past.restoredTools; } else past.restoredTools = [...done];
  const after = [...history, { id, at: new Date().toISOString(), key: past.key, item: item.name, kind: 'restored', losers: back.map(({ tool, hash, folder }) => ({ tool, hash, ...(folder ? { folder } : {}) })), orderProved: true,
    putBackFrom: past.kind === 'deleted' ? 'delete-everywhere' : 'off', reverses: past.id, before, ...(turnedUp.length ? { turnedUp } : {}) } satisfies HistoryEvent];
  await replaceHistory(context, after);
  return { results, writes: back.length, made: [id] };
}


/**
 * Undo of a put-back (putBackAgent): the Off or the deletion again, synced or not as before the put-back (its `before`).
 * The copies it put back go again while each is as it was put back, or as sync caught it up since (its file the one on record);
 * one changed since stays. A copy it found turned up is held by an Off again while its tool still has it and no other Off holds
 * that tool. When it put copies back and none can be taken out, nothing changes and the entry keeps its Undo. Rule B (endedBy,
 * in restoreAgent) has already made sure that no later click changed what it put back.
 */
async function undoPutBack(context: ShareContext, tools: HarnessId[], history: HistoryEvent[], restored: HistoryEvent): Promise<McpResult> {
  const stop = (stopped: string, results: DestinationResult[] = []): McpResult => ({ stopped, results, writes: 0 });
  const key = historyKey(restored)!;
  const record = await readAgentRecord(context.home);
  const item = record.items[key];
  if (!item) return stop('That change can’t be undone.');
  const { present, onDisk: { byKey } } = await gatherAgentsAfterRecovery(context, tools);
  const slot = byKey.get(key) ?? {};
  const results: DestinationResult[] = [];
  const asPutBack = restored.losers.filter(loser => {
    const here = slot[loser.tool as AgentTool];
    if (!here) return false;
    const same = here.hash === loser.hash || item.copies.some(copy => copy.tool === loser.tool && !copy.status && copy.bytes === here.bytes);
    if (!same) results.push({ item: item.name, harness: loser.tool, outcome: 'held', message: `${harnesses[loser.tool].name}’s copy was changed since, so it stays.` });
    return same;
  });
  const deletion = restored.putBackFrom === 'delete-everywhere';
  const before = recordNow(item);
  const taken = await takeCopiesOut(context, item, slot, asPutBack.map(loser => loser.tool), deletion ? 'Deleted' : 'Removed');
  results.push(...taken.results);
  if (restored.losers.length && !taken.losers.length) return stop(results.find(result => result.outcome !== 'removed')?.message ?? `${item.name}’s copies aren’t as it put them back, so they stay.`, results);
  const held = heldTools(history, restored.key);
  const turnedUp = (restored.turnedUp ?? []).filter(loser => slot[loser.tool as AgentTool] && !held.includes(loser.tool));
  if (!taken.losers.length && !turnedUp.length && !deletion) {
    // Only copies that turned up, each gone since or held by an Off again: it is off there already, so nothing needs doing.
    if (!(restored.turnedUp ?? []).every(loser => held.includes(loser.tool))) return stop(`${item.name}’s own copy that turned up is gone since, so there is nothing to turn off again.`, results);
    restored.undoneBy = ALREADY_AS_IT_WAS;
    await replaceHistory(context, history);
    return { results: [{ item: item.name, outcome: 'stayed', message: `${item.name} is off in ${andList((restored.turnedUp ?? []).map(loser => shown[loser.tool]))} already.` }], writes: 0 };
  }
  for (const loser of turnedUp) item.copies = item.copies.filter(copy => copy.tool !== loser.tool);
  if (restored.before?.state) item.state = restored.before.state;
  if (deletion) markDeleted(item, present, slot);
  const event = takenOutEntry(item, key, deletion ? 'deleted' : 'removed', [...taken.losers, ...turnedUp], before);
  await saveAgentRecord(context.home, record);
  restored.undoneBy = event.id;
  await replaceHistory(context, [...history, event]);
  return { results, writes: taken.losers.length, made: [event.id] };
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

/**
 * Undo or Restore of an agent's History entry: History's actions and a click's Undo all come here. Rule B (historyrules.ts endedBy) is
 * checked once, first: an action that a later click or a deletion ended is refused. Then each kind goes to its own Undo:
 * - 'added': undoAddedAgent, the copies that turning it on added go again;
 * - an Off ('removed'), or Delete everywhere: putBackAgent, Turn on or Restore (`how.tool`: that tool's copy alone);
 * - 'restored' by putBackAgent: undoPutBack, Turn off again or Delete again;
 * - 'chosen', `how.narrow` (a click's Undo, Finish undo) or a Stopped switch: undoChoiceAgent;
 * - 'restored' that undid a deletion spread by sync (a deletion by hand): deleteAgainAgent; Delete everywhere's is undoPutBack;
 * - anything else (an edit, a conflict, a deletion by hand, a choice from History): restoreVersion, a kept version everywhere
 *   (`how.use`: which overwritten edit).
 */
export async function restoreAgent(context: ShareContext, tools: HarnessId[], eventId: string, how?: RestoreHow): Promise<McpResult> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason, results: [], writes: 0 };
  const gate = await syncGate(context);
  if (gate.state === 'stopped' || gate.state === 'needs-resume') return { stopped: gate.reason, results: [], writes: 0 };
  const recordProblem = (await inspectAgentRecord(context.home)).problem;
  if (recordProblem) return { stopped: recordProblem, results: [], writes: 0 };
  const history = await readHistory(context);
  const past = history.find(entry => entry.id === eventId);
  // An entry undone already (a page read before that): said so, whatever its kind.
  if (past?.undoneBy && !past.restoredTools) return { stopped: past.kind === 'removed' ? 'That was put back already.' : 'That change was already undone.', results: [], writes: 0 };
  const ended = past && endedBy(past, history);
  if (ended) return { stopped: noLongerSaid(past.item, ended), results: [], writes: 0 };
  if (past?.kind === 'added') return undoAddedAgent(context, tools, history, past);
  // Turned off (or deleted everywhere): each copy back exactly as it was; `choice`, a tool, puts back that tool's alone.
  if (past?.kind === 'removed' || (past?.kind === 'deleted' && past.everywhere)) return putBackAgent(context, tools, history, past, how && 'tool' in how ? how.tool : undefined);
  // Its Undo: the Off or the deletion again, as the entry itself says.
  if (past?.kind === 'restored' && past.putBackFrom && !past.undoneBy) return undoPutBack(context, tools, history, past);
  const key = past?.key.replace(/^agent:/, '');
  // 'narrow': each replaced copy back in its own tool, the copies its pass added out, as for skills and MCP servers. A Stopped
  // switch (a stopped one-way copy given the source's copy again) is always undone so, History's Undo too: that tool gets back
  // its own edited file and stops updating again.
  if (past && key && past.kind === 'chosen' && !past.undoneBy && ((how && 'narrow' in how) || isResume(past))) return undoChoiceAgent(context, tools, history, past, key);
  // Undo of a put-back from a deletion is that deletion again.
  const deletion = past?.kind === 'restored' && !past.undoneBy ? history.find(entry => entry.undoneBy === past.id && entry.kind === 'deleted') : undefined;
  if (past && key && deletion) return deleteAgainAgent(context, tools, history, past, deletion, key);
  return restoreVersion(context, tools, history, past, key, how && 'use' in how ? how.use : undefined);
}

/**
 * A kept version back in every tool the agent syncs to, each tool's own kept file where one was kept (an edit's or a conflict's
 * Undo, a deletion by hand's Restore, a choice undone from History); stopped one-way copies are left alone. `choice`: which
 * overwritten edit, by content id (`use`). It waits while an Off holds a tool (Rule A), and never overwrites another agent of that name.
 */
async function restoreVersion(context: ShareContext, tools: HarnessId[], history: HistoryEvent[], past: HistoryEvent | undefined, key: string | undefined, use?: string): Promise<McpResult> {
  const options = past ? past.losers.filter(loser => loser.hash && loser.hash !== past.previous && loser.hash !== past.winner?.hash) : [];
  const hash = past && (use ? options.find(option => option.hash === use)?.hash
    : past.kind === 'conflict' || past.kind === 'kept-edit' ? options[0]?.hash ?? (past.kind === 'conflict' ? past.previous : undefined)
      : past.kind === 'chosen' ? past.losers[0]?.hash : ['deleted', 'edit', 'restored'].includes(past.kind) ? past.previous : undefined);
  if (!past || !key || !hash) return { stopped: 'That change can’t be restored.', results: [], writes: 0 };
  if (past.undoneBy) return { stopped: 'That change was already undone.', results: [], writes: 0 };
  const version = await kept(context, key, hash);
  if (!version) return { stopped: 'The kept version is no longer in Central Knot’s store, so it can’t be restored.', results: [], writes: 0 };
  const record = await readAgentRecord(context.home);
  const item: AgentRecordItem = record.items[key] ?? { name: version.name, state: 'shared', off: [], hash: '', copies: [] };
  if (past.kind === 'deleted' && item.state === 'shared' && item.hash !== hash) return { stopped: `“${item.name}” is managed again with other content. Restoring the old one would replace it; delete or rename the new one first.`, results: [], writes: 0 };
  const held = heldTools(history, past.key);
  if (held.length) return { stopped: offNowSaid(item.name, held, tools), results: [], writes: 0 };
  // A deletion's Restore brings back the Offs it ended: their tools stay off, as they are once it is restored (Rule A).
  const heldAgain = past.kind === 'deleted' ? heldTools(history.filter(entry => entry.id !== past.id), past.key) : [];
  if (past.kind !== 'deleted' && item.state !== 'shared') return { stopped: `${item.name} isn’t synced now. Turn it on first.`, results: [], writes: 0 };
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
  for (const tool of present.filter(candidate => !notSyncing(item, heldAgain).includes(candidate) && !stopped.has(candidate))) {
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
  // No tool took it (nor had it already): nothing changes, and the entry keeps its Restore.
  if (!copies.some(copy => !copy.stopped)) return { stopped: results.find(result => result.outcome !== 'written')?.message ?? `No tool ${item.name} syncs to could take it back.`, results, writes };
  Object.assign(item, { state: 'shared', hash, origin: version.tool, name: version.name, copies } satisfies Partial<AgentRecordItem>);
  delete item.deleted;
  record.items[key] = item;
  await saveAgentRecord(context.home, record);
  past.undoneBy = randomUUID();
  await replaceHistory(context, [...history, { id: past.undoneBy, at: new Date().toISOString(), key: past.key, item: item.name, kind: 'restored', winner: { tool: replaced[0]?.tool ?? version.tool, hash }, losers: replaced, orderProved: true, previous: before }]);
  return { results, writes, made: [past.undoneBy] };
}

/**
 * Undo of a copy choice, right after it (choiceundo.ts, as for skills and MCP servers), or of a Stopped switch: each replaced copy
 * goes back in its own tool, whole as it was kept, with its edit time; the copies the choice's pass added go again, and the agent
 * is as it was before the choice, with the source it had and its stopped copies stopped again.
 */
async function undoChoiceAgent(context: ShareContext, tools: HarnessId[], history: HistoryEvent[], chosen: HistoryEvent, key: string): Promise<McpResult> {
  const stop = (stopped: string): McpResult => ({ stopped, results: [], writes: 0 });
  const record = await readAgentRecord(context.home);
  const item = record.items[key];
  // Not synced any more, unless it is a choice whose Undo stopped part-way and is being finished.
  if (!item || (item.state !== 'shared' && !chosen.restoredTools)) return stop(`${chosen.item} is not synced any more, so there is nothing to undo here.`);
  const { present, onDisk: { byKey, unreadable, duplicates } } = await gatherAgentsAfterRecovery(context, tools);
  const problem = blocked(key, unreadable, duplicates, present);
  if (problem) return stop(problem);
  const slot = byKey.get(key) ?? {};
  const texts = new Map<HarnessId, string>();
  const replaced = (tool: HarnessId) => chosen.losers.find(loser => loser.tool === tool);
  return undoChoice(history, chosen, {
    name: item.name, noun: 'copy',
    // What the choice wrote in a tool: the bytes on record for it (each tool's own format), else its content.
    wrote: tool => { const here = slot[tool], written = item.copies.find(copy => copy.tool === tool); return !!here && (written ? here.bytes === written.bytes : here.hash === chosen.winner?.hash); },
    cantPutBack: async (tool, hash) => {
      const text = (await kept(context, key, hash))?.texts[tool];
      if (!text) return 'The replaced copy is no longer in Central Knot’s store, so it can’t be put back.';
      texts.set(tool, text);
      return undefined;
    },
    addedAsIs: (tool, hash) => !slot[tool] || slot[tool]!.bytes === hash,
    takeOutAdded: async added => {
      const results: DestinationResult[] = [];
      let writes = 0;
      for (const loser of added.losers) {
        const here = slot[loser.tool];
        if (!here) continue;
        try { await keep(context, here); await removeFileChecked(here.file, here.text); }
        catch (error) { results.push({ item: item.name, harness: loser.tool, outcome: 'failed', message: `Could not remove ${harnesses[loser.tool].name}'s copy: ${error instanceof Error ? error.message : 'it couldn’t be removed.'}` }); continue; }
        writes++;
        item.copies = item.copies.filter(copy => copy.tool !== loser.tool);
        // A tool synced to again by that pass is left out again, as it was.
        if (added.rejoined && !item.off.includes(loser.tool)) item.off = [...item.off, loser.tool];
        results.push({ item: item.name, harness: loser.tool, outcome: 'removed', message: 'Removed the copy it added.' });
      }
      return { results, writes };
    },
    putBack: async tool => {
      const here = slot[tool]!;
      try { await keep(context, here); await writeFileChecked(here.file, texts.get(tool)!, here.text); }
      catch (error) { return error instanceof Error ? error.message : 'it couldn’t be written.'; }
      await giveFileTime(here.file, replaced(tool)?.editedAt);
      return undefined;
    },
    nextStep: () => 'Start a new session to use it.',
    settle: async (synced, back) => {
      // The record as it was before the choice (noted on it), each copy recorded again as it was, its one-way and stopped marks
      // too, and the source it had. A tool whose own copy isn't back yet holds the chosen copy: off the record until Finish undo
      // puts it back, so no pass reads it as an edit. A tool holding a copy the record didn't have before (its own, or one the
      // choice added and couldn't take out) is off the record too, so its next pass holds for a choice, as before the choice.
      // An entry from before the record was noted names only the tools whose copy had stopped: each is recorded as a stopped
      // one-way copy again, as its file is now, and every other copy is off the record (the next pass takes up each that holds the
      // synced content and holds for a choice where one differs, writing nothing).
      const asNoted = chosen.before?.copies ?? (chosen.before?.stopped ?? []).flatMap(tool => (slot[tool]
        ? [{ tool, file: slot[tool]!.file, hash: back.get(tool) ?? slot[tool]!.hash, bytes: texts.has(tool) ? sha256(texts.get(tool)!) : slot[tool]!.bytes, oneWay: true, stopped: true }] : []));
      const was = asNoted.filter(copy => !replaced(copy.tool) || back.has(copy.tool));
      // A copy a pass stopped since the choice holds that tool's own edit: it stays stopped, whatever the record had before.
      const stoppedSince = item.copies.filter(copy => copy.stopped && !copy.status && !replaced(copy.tool));
      // Each exactly as noted, its whole file's hash too: a file changed since reads as the edit it is.
      const recordAll = (copies: AgentCopyRecord[]) => { item.copies = item.copies.filter(copy => copy.status === 'removing'); for (const copy of copies) recordAgain(item, copy); };
      if (!synced) {
        item.state = 'dont-share';
        recordAll([...was.filter(copy => copy.stopped), ...stoppedSince]);
      // Synced before, and still: one turned off since a part-way Undo is left as it is.
      } else if (item.state === 'shared' && item.hash === chosen.winner?.hash) {
        item.hash = synced;
        recordAll([...was.filter(copy => slot[copy.tool] && !item.off.includes(copy.tool)), ...stoppedSince]);
        if (chosen.before?.origin) item.origin = chosen.before.origin;
      } else if (item.state === 'shared') {
        // A Finish undo after the synced content moved on leaves it where the passes since took it: only a copy put back takes
        // its record from before the choice.
        for (const tool of back.keys()) {
          const copy = was.find(entry => entry.tool === tool);
          item.copies = item.copies.filter(entry => entry.tool !== tool || entry.status);
          if (copy && slot[tool] && !item.off.includes(tool)) recordAgain(item, copy);
        }
      }
      await saveAgentRecord(context.home, record);
    },
    saveHistory: () => replaceHistory(context, history),
  });
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
  Object.assign(item, { state: 'dont-share', deleted: { at: new Date().toISOString(), tool: deletion.winner?.tool, hash: item.hash }, copies: remaining } satisfies Partial<AgentRecordItem>);
  await saveAgentRecord(context.home, record);
  restored.undoneBy = id;
  await replaceHistory(context, [...history, { id, at: new Date().toISOString(), key: restored.key, item: item.name, kind: 'deleted', winner: deletion.winner, losers: [], orderProved: true, previous: item.hash }]);
  return { results, writes, made: [id] };
}
