// Agents across tools (AGT-01, TRN-01, TRN-02, D-26, D-32): Claude Code Markdown, Copilot `.agent.md`, Codex TOML.
// Name, description and prompt are Representable everywhere. Any other field (tools, model, permission mode, hooks, Codex keys and
// tables) is its own tool's: no equivalent is recorded across tools. The origin is the copy the agent is shared from; a destination
// that lacks the origin's fields gets it With limits, one-way: it receives the origin's changes, and any change there (to the prompt
// or to its own fields) or its deletion stays local, and Central Knot stops updating it.
// Writing a destination changes only its name, description and prompt lines; every other byte of that file stays.
// The safety rules are the skills engine's: unreadable is never absent, every write and removal checks the file first, every
// replaced or removed file is kept whole for Restore, and deletions follow DEL-01 and DEL-02.
import { randomUUID } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseDocument, stringify as stringifyYaml } from 'yaml';
import { mkdir } from 'node:fs/promises';
import { harnesses, writeRoot } from './harnesses.ts';
import { appendHistory, readConverted, readHistory, recordConverted, replaceHistory } from './manage.ts';
import { FORMAT_VERSION, errorCode, readRecord, sha256, recoverParked, remember, removeFileChecked, saveRecord, storeDirectory, syncGate, writeAccess, writeDurably, writeFileChecked, type ShareContext } from './share.ts';
import { readTomlTables, tomlValue } from './textedit.ts';
import type { Change, DestinationResult, HarnessId, HistoryEvent, McpResult, McpView, SkillFacts, SyncNotice, ToolCopy } from './types.ts';

export const agentTools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
/** The names the page uses for each tool. */
const shown: Record<string, string> = { 'claude-cli': 'Claude Code', 'copilot-cli': 'Copilot CLI', 'codex-cli': 'Codex', 'pi-cli': 'Pi' };

/** One agent in a shape every tool can be written from. `fields` are its own tool's extras. */
export interface NeutralAgent { name: string; description: string; prompt: string; fields: Record<string, unknown> }
/** `name` is the file's base name; `key` matches it across tools, ignoring case as macOS does. `bytes` hashes the whole file. */
export interface AgentEntry { name: string; key: string; tool: HarnessId; file: string; text: string; agent: NeutralAgent; hash: string; bytes: string }

/** The origin's fields a destination would lose: all of them, in any tool but the origin's own (no recorded equivalent, CD §5). */
export const losses = (tool: HarnessId, origin: { tool: HarnessId; agent: NeutralAgent }) => (tool === origin.tool ? [] : Object.keys(origin.agent.fields));

const suffixOf = (tool: HarnessId) => (tool === 'codex-cli' ? '.toml' : tool === 'copilot-cli' ? '.agent.md' : '.md');
const folder = (context: ShareContext, tool: HarnessId) => join(context.overrides?.[tool] ?? join(context.home, harnesses[tool].defaultConfig), 'agents');
export const fileFor = (context: ShareContext, tool: HarnessId, name: string) => join(folder(context, tool), `${name}${suffixOf(tool)}`);
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
  if (!match) return `---\nname: ${yamlScalar(agent.name)}\ndescription: ${yamlScalar(agent.description)}\n---\n\n${agent.prompt}`;
  const newline = match[1].endsWith('\r\n') ? '\r\n' : '\n';
  const front = setFrontLines(match[2].replace(/\r?\n$/, ''), [['name', agent.name], ['description', agent.description]]);
  const gap = /^\r?\n/.exec(match[4])?.[0] ?? '\n';
  return `${match[1]}${front}${newline}${match[3]}${gap}${agent.prompt}`;
}

const writeChecked = writeFileChecked;
const removeChecked = removeFileChecked;

// ---------- Record and kept versions ----------

/** `file` is where the copy was; `bytes` the whole file's hash; `removing` a copy a deletion still has to remove. */
interface AgentCopy { tool: HarnessId; file: string; hash: string; bytes: string; oneWay?: boolean; stopped?: boolean; status?: 'removing'; /** Its tool's agents folder was gone when last looked at. */ away?: boolean }
interface AgentRecordItem { name: string; state: 'shared' | 'dont-share'; off: HarnessId[]; hash: string; origin?: HarnessId; copies: AgentCopy[]; separate?: boolean; deleted?: { at: string; tool: HarnessId; hash: string };
  /** Content about to be overwritten, on record before the file changes, so an interrupted pass still names it in History. */
  displaced?: { tool: HarnessId; hash: string }[] }
/** `roots`: each tool's agents folder identity at the last pass, so a folder made again between passes reads as a reset. */
interface AgentRecord { formatVersion: number; items: Record<string, AgentRecordItem>; roots?: Partial<Record<HarnessId, { ino: number; birth: number }>> }
const recordPath = (home: string) => join(storeDirectory(home), 'agents.json');
export async function readAgentRecord(home: string): Promise<AgentRecord> {
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
  const byKey = new Map<string, Partial<Record<HarnessId, AgentEntry>>>();
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
const missingSince = new Map<string, number>();

/**
 * Records Managed choices and brings each managed agent into line. `only`: with Sync off, Apply all writes exactly the agents it
 * shows and nothing else spreads (SYN-03).
 */
export async function applyAgents(context: ShareContext, tools: HarnessId[], changes: Change[], options: { settleMs?: number; now?: number; only?: Set<string> } = {}): Promise<McpResult> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason, results: [], writes: 0 };
  const gate = await syncGate(context);
  if (gate.state === 'stopped' || gate.state === 'needs-resume') return { stopped: gate.reason, results: [], writes: 0 };
  let { record: owner } = await readRecord(context.home);
  if (!owner && !changes.length) return { results: [], writes: 0 };
  if (!owner) { owner = { formatVersion: FORMAT_VERSION, generation: randomUUID(), owner: context.build, items: Object.create(null) }; await saveRecord(context.home, owner); }
  if (gate.state !== 'ready') await remember(context, owner.generation);

  const present = tools.filter(tool => agentTools.includes(tool));
  // A write or removal a crash interrupted is finished first, so a file moved aside is never read as deleted.
  for (const tool of present) await recoverParked(folder(context, tool));
  const { byKey, folders, unreadable, duplicates } = await gatherAgents(context, present);
  const record = await readAgentRecord(context.home);
  const results: DestinationResult[] = [];
  const events: HistoryEvent[] = [];
  const notices: SyncNotice[] = [];
  const event = (fields: Omit<HistoryEvent, 'id' | 'at'>) => { const made: HistoryEvent = { id: randomUUID(), at: new Date().toISOString(), ...fields }; events.push(made); return made.id; };
  const now = options.now ?? Date.now();
  const settle = options.settleMs ?? 2000;
  let writes = 0;
  let settling = false;
  const chosenNow = new Set<string>();
  // Agents this Apply all makes Managed: the files it adds for them are told in History as 'added', so Undo can take them back.
  const newlyManaged = new Set<string>();
  // Content displaced by an earlier pass that stopped before History named it: named this pass.
  const carried = Object.entries(record.items).flatMap(([key, item]) => (item.displaced ?? []).map(entry => ({ key, ...entry })));
  // A tool's agents folder made again since the last pass (a reset or reinstall, even between two reads): its missing copies are
  // put back, never read as deletions.
  const identities: Partial<Record<HarnessId, { ino: number; birth: number }>> = {};
  for (const tool of present) { try { const info = await stat(folder(context, tool)); identities[tool] = { ino: info.ino, birth: Math.round(info.birthtimeMs) }; } catch { /* away */ } }
  const resetTools = new Set(present.filter(tool => record.roots?.[tool] && identities[tool] && (record.roots[tool]!.ino !== identities[tool]!.ino || record.roots[tool]!.birth !== identities[tool]!.birth)));
  for (const change of changes) {
    const slot = byKey.get(change.key);
    if (!slot) continue;
    // A choice of a copy that changed after the page showed it is refused: what replaces the others is only ever what was seen.
    if (change.use && change.use !== 'separate' && change.useHash && slot[change.use]?.hash !== change.useHash) { results.push({ item: change.key, outcome: 'held', message: 'The copy you chose changed since you chose it. Nothing was changed; choose again.' }); continue; }
    const first = (Object.values(slot) as AgentEntry[])[0];
    const item: AgentRecordItem = record.items[change.key] ?? { name: first.name, state: 'dont-share', off: [], hash: '', copies: [] };
    if (change.managed && change.use !== 'separate' && item.state !== 'shared') newlyManaged.add(change.key);
    item.state = change.managed && change.use !== 'separate' ? 'shared' : 'dont-share';
    item.off = change.off;
    item.separate = change.use === 'separate' ? true : undefined;
    if (item.state !== 'shared') item.copies = item.copies.filter(copy => copy.status === 'removing');
    else delete item.deleted;
    if (change.use && change.use !== 'separate' && slot[change.use]) { item.origin = change.use; item.hash = slot[change.use]!.hash; item.name = slot[change.use]!.name; item.copies = []; chosenNow.add(change.key); }
    record.items[change.key] = item;
  }
  for (const [key, item] of Object.entries(record.items)) {
    if (item.state !== 'shared' || (options.only && !options.only.has(key))) continue;
    const slot = byKey.get(key) ?? {};
    const name = item.name;
    const syncing = present.filter(tool => !item.off.includes(tool));
    const problem = blocked(key, unreadable, duplicates, syncing);
    if (problem) { for (const copy of item.copies) missingSince.delete(copy.file); results.push({ item: name, outcome: 'held', message: problem }); continue; }
    // A copy recorded in a folder its tool no longer uses (a moved config root) is let go, never read as a deletion.
    item.copies = item.copies.filter(copy => dirname(copy.file) === folder(context, copy.tool) || !present.includes(copy.tool));
    // A tool whose agents folder is gone right now (uninstalled, moved away): its copy is neither updated nor read as deleted.
    const away = (tool: HarnessId) => !folders.has(tool) && item.copies.some(copy => copy.tool === tool);
    // Its folder gone, then back (a reinstall or reset): never a deletion. A copy missing from the returned folder is let go of, so
    // it is put back below; one still there carries on as before.
    item.copies = item.copies.filter(copy => copy.status || away(copy.tool) || !(copy.away || resetTools.has(copy.tool)) || !!slot[copy.tool]);
    for (const copy of item.copies) if (!copy.status) { if (away(copy.tool)) copy.away = true; else delete copy.away; }
    const recorded = new Map(item.copies.filter(copy => !copy.status).map(copy => [copy.tool, copy]));

    // One-way copies changed or deleted there are left alone from then on (D-26), including a change to their own fields.
    for (const copy of recorded.values()) {
      if (!copy.oneWay || copy.stopped || away(copy.tool) || !syncing.includes(copy.tool)) continue;
      const here = slot[copy.tool];
      if (here?.bytes === copy.bytes) continue;
      copy.stopped = true;
      results.push({ item: name, harness: copy.tool, outcome: 'held', message: `${here ? 'Changed' : 'Deleted'} in ${harnesses[copy.tool].name}, which gets this agent one-way. Central Knot stopped updating it there; nothing spread.` });
    }
    const live = (tool: HarnessId) => !recorded.get(tool)?.stopped && !away(tool) && syncing.includes(tool);
    const twoWay = (tool: HarnessId) => live(tool) && !recorded.get(tool)?.oneWay;
    const entries = present.filter(live).map(tool => slot[tool]).filter((entry): entry is AgentEntry => !!entry);
    const changed = entries.filter(entry => twoWay(entry.tool) && recorded.has(entry.tool) && recorded.get(entry.tool)!.hash !== entry.hash);

    // Deletion of a two-way copy (DEL-01): its file gone from a folder that is there, settled, spreads (DEL-02); an edit racing it wins.
    const missing = [...recorded.values()].filter(copy => twoWay(copy.tool) && !slot[copy.tool]);
    // With Sync off, Apply all writes only what it shows: this agent's own pending edit or deletion waits for Sync (SYN-03).
    if (options.only && !chosenNow.has(key) && (changed.length || missing.length)) { results.push({ item: name, outcome: 'held', message: `An edit or deletion of ${name} is waiting for sync. Turn automatic sync on, or use Sync once.` }); continue; }
    for (const copy of recorded.values()) if (slot[copy.tool] || away(copy.tool)) missingSince.delete(copy.file);
    let waiting = false;
    for (const copy of missing) { if (!missingSince.has(copy.file)) missingSince.set(copy.file, now); if (now - missingSince.get(copy.file)! < settle) waiting = true; }
    if (waiting) { settling = true; continue; }
    let raced: { deleted: HarnessId[] } | undefined;
    if (missing.length) {
      for (const copy of missing) missingSince.delete(copy.file);
      if (!changed.length) {
        const removed: HarnessId[] = [];
        const leftover: AgentCopy[] = [];
        for (const copy of item.copies) {
          if (missing.includes(copy)) continue;
          // A stopped one-way copy is the person's own now: it stays, and stays known as this agent's, so Restore leaves it alone.
          if (copy.stopped) { leftover.push(copy); continue; }
          const here = slot[copy.tool];
          // Away now: it goes when its folder is back, if it still holds what it held (DEL-02).
          if (away(copy.tool) || copy.status === 'removing') { leftover.push({ ...copy, status: 'removing' }); continue; }
          if (!here) continue;
          try { await keep(context, here); await removeChecked(here.file, here.text); }
          catch (error) {
            if (errorCode(error) === 'CK_CHANGED') { results.push({ item: name, harness: copy.tool, outcome: 'held', message: `${harnesses[copy.tool].name}'s copy was changed just as the deletion spread, so it was kept as it is.` }); continue; }
            leftover.push({ ...copy, status: 'removing' });
            results.push({ item: name, harness: copy.tool, outcome: 'failed', message: `Could not remove ${harnesses[copy.tool].name}'s copy yet. Central Knot will try again.` });
            continue;
          }
          writes++;
          removed.push(copy.tool);
          results.push({ item: name, harness: copy.tool, outcome: 'removed', message: `Deleted in ${harnesses[missing[0].tool].name}, so removed here too.` });
        }
        // A different agent with this name that was never synced is not this agent's: it stays.
        for (const entry of entries) if (!recorded.has(entry.tool)) results.push({ item: name, harness: entry.tool, outcome: 'held', message: `${harnesses[entry.tool].name} has a different “${name}” that was never synced. It stays.` });
        const id = event({ key: `agent:${key}`, item: name, kind: 'deleted', winner: { tool: missing[0].tool, hash: item.hash }, losers: [], orderProved: true, previous: item.hash });
        notices.push({ key: `agent:${key}`, item: name, kind: 'deleted', winner: missing[0].tool, losers: removed, orderProved: true, history: id });
        item.state = 'dont-share';
        item.deleted = { at: new Date(now).toISOString(), tool: missing[0].tool, hash: item.hash };
        item.copies = leftover;
        continue;
      }
      // An edit raced the deletion: the edit is kept, and the deleted copy comes back with it (CON-01, D-04's offer).
      raced = { deleted: missing.map(copy => copy.tool) };
      item.copies = item.copies.filter(copy => !missing.includes(copy));
      for (const copy of missing) recorded.delete(copy.tool);
    }

    // The winner: a one-sided edit at a two-way copy; competing edits by the fixed tool order (D-04); else the baseline.
    const twoWayEntries = entries.filter(entry => twoWay(entry.tool));
    const origin = item.origin && twoWay(item.origin) ? slot[item.origin] : undefined;
    const source: AgentEntry | undefined = [...changed].sort((first, second) => order.indexOf(first.tool) - order.indexOf(second.tool))[0]
      ?? (origin?.hash === item.hash ? origin : undefined)
      ?? richest(twoWayEntries, item.hash)
      ?? (twoWayEntries.length && new Set(twoWayEntries.map(entry => entry.hash)).size === 1 ? richest(twoWayEntries, twoWayEntries[0].hash) : undefined);
    if (!source) { results.push({ item: name, outcome: 'held', message: twoWayEntries.length ? 'Copies differ. Choose which copy to use.' : 'No copy is left to start from.' }); continue; }
    // An unrecorded copy that differs, with no baseline to call it behind, is a same-name collision: it needs a choice.
    if (!chosenNow.has(key) && entries.some(entry => !recorded.has(entry.tool) && entry.hash !== source.hash && entry.hash !== item.hash)) { results.push({ item: name, outcome: 'held', message: 'Copies differ. Choose which copy to use.' }); continue; }
    // The origin stays the same tool unless it is chosen anew or can no longer be one (stable, so one-way never flips by itself).
    const originEntry = (item.origin && twoWay(item.origin) && slot[item.origin]) || richest(twoWayEntries, source.hash) || source;
    item.origin = originEntry.tool;
    const competing = changed.length > 1 && new Set(changed.map(entry => entry.hash)).size > 1;
    const replaced: { tool: HarnessId; hash: string }[] = [];
    const addedHere: { tool: HarnessId; hash: string }[] = [];
    await keep(context, source);
    const copies: AgentCopy[] = item.copies.filter(copy => copy.stopped || copy.status === 'removing' || away(copy.tool));
    for (const tool of syncing) {
      if (!live(tool)) continue;
      const here = slot[tool];
      const lost = losses(tool, originEntry);
      const oneWay = lost.length > 0;
      if (here?.hash === source.hash) { copies.push({ tool, file: here.file, hash: here.hash, bytes: here.bytes, oneWay: oneWay || undefined }); continue; }
      const fileName = here?.name ?? source.name;
      if (!here && !safeName(fileName)) { results.push({ item: name, harness: tool, outcome: 'held', message: 'This name can’t be a file name here.' }); continue; }
      const path = here?.file ?? fileFor(context, tool, fileName);
      let text: string;
      try { text = agentText(tool, source.agent, here?.text); } catch { results.push({ item: name, harness: tool, outcome: 'held', message: 'This file could not be updated without changing other parts of it.' }); continue; }
      try {
        if (here) {
          await keep(context, here);
          // Only content an event of this pass will name is put on record as displaced; a copy that is only behind (a write that
          // failed, caught up now) holds an older version that History already has.
          if (changed.length || chosenNow.has(key) || raced) {
            (item.displaced ??= []).push({ tool, hash: here.hash });
            await saveAgentRecord(context.home, record);
          }
        }
        await writeChecked(path, text, here?.text);
      } catch (error) {
        if (here && item.displaced) { item.displaced = item.displaced.filter(entry => !(entry.tool === tool && entry.hash === here.hash)); if (!item.displaced.length) delete item.displaced; }
        results.push({ item: name, harness: tool, outcome: 'held', message: error instanceof Error && 'code' in error && String(error.code).startsWith('CK_') ? error.message : `Could not write ${harnesses[tool].name}'s copy.` });
        // Not written: it keeps what was recorded, so the next pass still sees it as it is.
        const known = recorded.get(tool);
        if (known) copies.push(known);
        continue;
      }
      writes++;
      if (here) replaced.push({ tool, hash: here.hash });
      else if (newlyManaged.has(key)) addedHere.push({ tool, hash: sha256(text) });
      copies.push({ tool, file: path, hash: agentHash(source.agent), bytes: sha256(text), oneWay: oneWay || undefined });
      results.push({ item: name, harness: tool, outcome: 'written', message: `${here ? `Now has ${harnesses[source.tool].name}'s version` : 'Added'}${oneWay ? `, with limits: ${harnesses[tool].name} has no equivalent for ${lost.join(', ')}` : ''}. Start a new session to use it.` });
    }
    const historyKey = `agent:${key}`;
    if (addedHere.length) event({ key: historyKey, item: name, kind: 'added', losers: addedHere, orderProved: true, previous: source.hash });
    if (chosenNow.has(key) && replaced.length) event({ key: historyKey, item: name, kind: 'chosen', winner: { tool: source.tool, hash: source.hash }, losers: replaced, orderProved: true, previous: undefined });
    else if (raced) {
      const id = event({ key: historyKey, item: name, kind: 'kept-edit', winner: { tool: source.tool, hash: source.hash }, losers: [...raced.deleted.map(tool => ({ tool, hash: item.hash })), ...replaced], orderProved: false, previous: item.hash });
      notices.push({ key: historyKey, item: name, kind: 'kept-edit', winner: source.tool, losers: raced.deleted, orderProved: false, history: id });
    } else if (changed.length && (replaced.length || (item.hash && item.hash !== source.hash))) {
      // An edit that changed the synced content is History even when no copy could be written yet (a failed write caught up
      // later): the version it replaces stays restorable.
      const id = event({ key: historyKey, item: name, kind: competing ? 'conflict' : 'edit', winner: { tool: source.tool, hash: source.hash }, losers: replaced, orderProved: !competing, previous: item.hash || undefined });
      if (replaced.length) notices.push({ key: historyKey, item: name, kind: competing ? 'conflict' : 'edit', winner: source.tool, losers: competing ? changed.filter(entry => entry.hash !== source.hash).map(entry => entry.tool) : replaced.map(entry => entry.tool), orderProved: !competing, history: id });
    }
    item.name = source.name;
    item.hash = source.hash;
    item.copies = copies;
  }
  // A copy a deletion could not remove (its folder away, a locked file) goes once it can, while it still holds what it held. A copy
  // changed since, or an agent put back by hand or managed again, ends that.
  for (const [key, item] of Object.entries(record.items)) {
    if (options.only && !options.only.has(key)) continue;
    const pending = item.copies.filter(copy => copy.status === 'removing');
    if (!pending.length) continue;
    const slot = byKey.get(key) ?? {};
    const readded = item.state === 'shared' || (Object.values(slot) as AgentEntry[]).some(entry => !pending.some(copy => copy.tool === entry.tool));
    for (const copy of pending) {
      const here = slot[copy.tool];
      // A file elsewhere now (a moved agents folder) is not the one the deletion was owed for.
      if (readded || (here && (here.bytes !== copy.bytes || here.file !== copy.file)) || (!here && folders.has(copy.tool))) { item.copies = item.copies.filter(other => other !== copy); continue; }
      if (!here) continue;
      try { await keep(context, here); await removeChecked(here.file, here.text); writes++; results.push({ item: item.name, harness: copy.tool, outcome: 'removed', message: 'Removed now, finishing an earlier deletion.' }); item.copies = item.copies.filter(other => other !== copy); }
      catch (error) { if (errorCode(error) === 'CK_CHANGED') item.copies = item.copies.filter(other => other !== copy); }
    }
  }
  // Displaced content no event of this pass names (left by a pass that stopped part-way) gets its own History entry.
  const named = (key: string, hash: string) => events.some(made => made.key === `agent:${key}` && (made.previous === hash || made.winner?.hash === hash || made.losers.some(loser => loser.hash === hash)));
  for (const left of carried) {
    const item = record.items[left.key];
    if (!item || named(left.key, left.hash)) continue;
    event({ key: `agent:${left.key}`, item: item.name, kind: 'edit', winner: { tool: left.tool, hash: item.hash }, losers: [{ tool: left.tool, hash: left.hash }], orderProved: false, previous: left.hash });
  }
  // Folder identities are kept only by a full pass: Apply all with Sync off skips agents, so a reset must still be seen next time.
  if (!options.only) record.roots = { ...record.roots, ...identities };
  await saveAgentRecord(context.home, record);
  await appendHistory(context, events);
  // History names it now: the hold is dropped. A crash between leaves the hold, never content no one can restore.
  let cleared = false;
  for (const [key, item] of Object.entries(record.items)) {
    if (!item.displaced?.length) continue;
    const left = item.displaced.filter(entry => !named(key, entry.hash));
    if (left.length !== item.displaced.length) { cleared = true; if (left.length) item.displaced = left; else delete item.displaced; }
  }
  if (cleared) await saveAgentRecord(context.home, record);
  return { results, writes, notices, settling };
}

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
    try { await keep(context, here); await removeChecked(here.file, here.text); }
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
      await writeChecked(path, text, here?.text);
    } catch (error) { results.push({ item: item.name, harness: tool, outcome: 'held', message: error instanceof Error ? error.message : 'Could not write it.' }); continue; }
    writes++;
    if (here) replaced.push({ tool, hash: here.hash });
    copies.push({ tool, file: path, hash, bytes: sha256(text), oneWay: oneWay || undefined });
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
      await writeChecked(here.file, text, here.text);
    } catch (error) { results.push({ item: item.name, harness: loser.tool, outcome: 'held', message: error instanceof Error ? error.message : 'Could not write it.' }); continue; }
    writes++;
    replaced.push({ tool: loser.tool, hash: here.hash });
    copy.hash = loser.hash;
    copy.bytes = sha256(text);
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
