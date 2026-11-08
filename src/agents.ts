// Agents across tools (AGT-01, TRN-01, TRN-02, D-26, D-32): Claude Code Markdown, Copilot `.agent.md`, Codex TOML.
// Name, description and prompt are Representable everywhere. Any other field (tools, model, permission mode, hooks…) is the
// origin tool's own: no equivalent is recorded across tools, so a destination that lacks it gets the agent With limits,
// one-way. It receives the origin's changes; an edit or deletion there stays local and Central Knot stops updating it.
// A destination's own extra fields are kept when its copy is updated: only name, description and prompt are written.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Document, parseDocument } from 'yaml';
import { harnesses } from './harnesses.ts';
import { appendHistory, readHistory, replaceHistory } from './manage.ts';
import { FORMAT_VERSION, readRecord, remember, saveRecord, storeDirectory, syncGate, writeAccess, writeDurably, type ShareContext } from './share.ts';
import { readTomlTables, tomlValue } from './textedit.ts';
import type { Change, DestinationResult, HarnessId, HistoryEvent, McpResult, McpView, SkillFacts, SyncNotice, ToolCopy } from './types.ts';

export const agentTools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];

/** One agent in a shape every tool can be written from. `fields` are the origin tool's own extras. */
export interface NeutralAgent { name: string; description: string; prompt: string; fields: Record<string, unknown> }
export interface AgentEntry { name: string; tool: HarnessId; file: string; text: string; agent: NeutralAgent; hash: string }

/** The origin's fields a destination would lose: all of them, in any tool but the origin's own (no recorded equivalent, CD §5). */
export const losses = (tool: HarnessId, source: { tool: HarnessId; agent: NeutralAgent }) => (tool === source.tool ? [] : Object.keys(source.agent.fields));

const suffixOf = (tool: HarnessId) => (tool === 'codex-cli' ? '.toml' : tool === 'copilot-cli' ? '.agent.md' : '.md');
const folder = (context: ShareContext, tool: HarnessId) => join(context.overrides?.[tool] ?? join(context.home, harnesses[tool].defaultConfig), 'agents');
const fileFor = (context: ShareContext, tool: HarnessId, name: string) => join(folder(context, tool), `${name}${suffixOf(tool)}`);
/** Agent names become file names: no separators, no dot-files. */
const safeName = (name: string) => /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/.test(name) && !name.includes('..');

/** Identity across tools: what every tool holds. Extras never make two agents differ. */
export const agentHash = (agent: Pick<NeutralAgent, 'name' | 'description' | 'prompt'>) => createHash('sha256').update(JSON.stringify([agent.name, agent.description, agent.prompt.replace(/\s+$/, '')])).digest('hex');

const FRONT = /^﻿?---\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)([\s\S]*)$/;

function fromMarkdown(name: string, text: string): NeutralAgent | undefined {
  const match = FRONT.exec(text);
  if (!match) return undefined;
  const document = parseDocument(match[1]);
  if (document.errors.length) return undefined;
  const front = (document.toJS() ?? {}) as Record<string, unknown>;
  if (typeof front !== 'object' || Array.isArray(front)) return undefined;
  const { name: named, description, ...fields } = front;
  return { name: typeof named === 'string' && named ? named : name, description: typeof description === 'string' ? description : '', prompt: match[2].replace(/^\r?\n/, ''), fields };
}

function fromToml(name: string, text: string): NeutralAgent {
  const tables = readTomlTables(text);
  const root = tables[0];
  const value = (key: string) => { const found = root.entries.find(entry => entry.key === key)?.value; return typeof found === 'string' ? found : undefined; };
  const fields: Record<string, unknown> = Object.fromEntries(root.entries.filter(entry => !['name', 'description', 'developer_instructions'].includes(entry.key)).map(entry => [entry.key, entry.value]));
  for (const table of tables.slice(1)) fields[`[${table.path.join('.')}]`] = true;
  return { name: value('name') || name, description: value('description') ?? '', prompt: value('developer_instructions') ?? '', fields };
}

/** Reads one tool's agents. A file that cannot be read is reported and never written. */
export async function readAgents(context: ShareContext, tool: HarnessId): Promise<{ entries: AgentEntry[]; problems: string[]; folderExists: boolean }> {
  const entries: AgentEntry[] = [];
  const problems: string[] = [];
  let names: string[];
  try { names = await readdir(folder(context, tool)); } catch { return { entries, problems, folderExists: false }; }
  const suffix = suffixOf(tool);
  for (const file of names.filter(entry => entry.endsWith(suffix) && !entry.startsWith('.') && !entry.includes('.ck-'))) {
    const name = file.slice(0, -suffix.length);
    const path = join(folder(context, tool), file);
    try {
      const text = await readFile(path, 'utf8');
      let agent: NeutralAgent | undefined;
      try { agent = tool === 'codex-cli' ? fromToml(name, text) : fromMarkdown(name, text); } catch { agent = undefined; }
      if (!agent) { problems.push(`${path} could not be read as an agent, so it is not offered.`); continue; }
      entries.push({ name, tool, file: path, text, agent, hash: agentHash(agent) });
    } catch { problems.push(`${path} could not be read.`); }
  }
  return { entries, problems, folderExists: true };
}

const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]|\r(?!\n)/;
/** A TOML string for a prompt: a multi-line basic string when it can be one, else a one-line basic string. */
function tomlPrompt(prompt: string) {
  if (CONTROL.test(prompt)) return tomlValue(prompt);
  const body = prompt.replace(/\\/g, '\\\\').replace(/"(?="")/g, '\\"');
  return `"""\n${body}${body.endsWith('\n') ? '' : '\n'}"""`;
}

/**
 * The file text for an agent at a tool. With `existing` (that tool's current file), only name, description and prompt
 * change; every other field, comment and table there stays.
 */
export function agentText(tool: HarnessId, agent: Pick<NeutralAgent, 'name' | 'description' | 'prompt'>, existing?: string): string {
  if (tool === 'codex-cli') {
    const lines = { name: `name = ${tomlValue(agent.name)}\n`, description: `description = ${tomlValue(agent.description)}\n`, developer_instructions: `developer_instructions = ${tomlPrompt(agent.prompt)}\n` };
    const keys = Object.keys(lines) as (keyof typeof lines)[];
    if (!existing) return keys.map(key => lines[key]).join('');
    const root = readTomlTables(existing)[0];
    let head = existing.slice(0, root.end);
    const tail = existing.slice(root.end);
    for (const key of keys) {
      const entry = root.entries.find(candidate => candidate.key === key);
      if (entry) head = head.replace(entry.raw, () => lines[key]);
    }
    const missing = keys.filter(key => !root.entries.some(entry => entry.key === key)).map(key => lines[key]).join('');
    return missing + head + (tail && head && !head.endsWith('\n') ? '\n' : '') + tail;
  }
  const match = existing ? FRONT.exec(existing) : undefined;
  const parsed = match && match[1].trim() ? parseDocument(match[1]) : undefined;
  const document = parsed && !parsed.errors.length && parsed.contents ? parsed : new Document({});
  document.set('name', agent.name);
  document.set('description', agent.description);
  return `---\n${document.toString().trimEnd()}\n---\n\n${agent.prompt}`;
}

async function writeAtomically(path: string, text: string) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.ck-${randomUUID()}.tmp`;
  await writeFile(temporary, text);
  await rename(temporary, path);
}

// ---------- Record and kept versions ----------

interface AgentCopy { tool: HarnessId; hash: string; oneWay?: boolean; stopped?: boolean }
interface AgentRecordItem { state: 'shared' | 'dont-share'; off: HarnessId[]; hash: string; origin?: HarnessId; copies: AgentCopy[]; separate?: boolean; deleted?: { at: string; tool: HarnessId; hash: string }; missingSince?: Partial<Record<HarnessId, number>> }
interface AgentRecord { formatVersion: number; items: Record<string, AgentRecordItem> }
const recordPath = (home: string) => join(storeDirectory(home), 'agents.json');
async function readAgentRecord(home: string): Promise<AgentRecord> {
  try { const parsed = JSON.parse(await readFile(recordPath(home), 'utf8')); if (parsed && typeof parsed.items === 'object') return parsed; } catch { /* first time */ }
  return { formatVersion: 1, items: {} };
}
const saveAgentRecord = (home: string, record: AgentRecord) => writeDurably(recordPath(home), `${JSON.stringify(record, null, 2)}\n`);

/** Every version Central Knot replaced or removed is kept, so History can put it back (CON-02). */
const keptPath = (context: ShareContext, name: string, hash: string) => join(storeDirectory(context.home), 'items', 'agents', encodeURIComponent(name), `${hash}.json`);
async function keep(context: ShareContext, entry: AgentEntry) {
  const path = keptPath(context, entry.name, entry.hash);
  try { await stat(path); } catch { await writeDurably(path, `${JSON.stringify({ tool: entry.tool, text: entry.text, agent: entry.agent }, null, 2)}\n`); }
}
async function kept(context: ShareContext, name: string, hash: string): Promise<{ tool: HarnessId; text: string; agent: NeutralAgent } | undefined> {
  try { return JSON.parse(await readFile(keptPath(context, name, hash), 'utf8')); } catch { return undefined; }
}

async function gatherAgents(context: ShareContext, tools: HarnessId[]) {
  const byName = new Map<string, Partial<Record<HarnessId, AgentEntry>>>();
  const problems: string[] = [];
  const folders = new Set<HarnessId>();
  for (const tool of tools) {
    const read = await readAgents(context, tool);
    problems.push(...read.problems);
    if (read.folderExists) folders.add(tool);
    for (const entry of read.entries) { const slot = byName.get(entry.name) ?? {}; slot[tool] = entry; byName.set(entry.name, slot); }
  }
  return { byName, problems, folders };
}

const order: HarnessId[] = ['copilot-cli', 'claude-cli', 'codex-cli'];
/** The copy others are written from when nothing was edited: the recorded origin, else the one with the most fields. */
function richest(entries: AgentEntry[], hash: string, origin?: HarnessId): AgentEntry | undefined {
  const same = entries.filter(entry => entry.hash === hash);
  return same.find(entry => entry.tool === origin) ?? [...same].sort((first, second) => Object.keys(second.agent.fields).length - Object.keys(first.agent.fields).length || order.indexOf(first.tool) - order.indexOf(second.tool))[0];
}

// ---------- View ----------

export async function agentsView(context: ShareContext, tools: HarnessId[], notices: SyncNotice[] = []): Promise<McpView> {
  const present = tools.filter(tool => agentTools.includes(tool));
  const { byName, problems } = await gatherAgents(context, present);
  const record = await readAgentRecord(context.home);
  const servers: SkillFacts[] = [];
  for (const [name, slot] of [...byName].sort(([first], [second]) => first.localeCompare(second))) {
    const item = record.items[name];
    const entries = Object.values(slot) as AgentEntry[];
    const managed = item?.state === 'shared';
    const origin = (managed && item.origin && slot[item.origin]) || richest(entries, (entries.find(entry => entry.tool === 'claude-cli') ?? entries[0]).hash) || entries[0];
    const copies: Partial<Record<HarnessId, ToolCopy>> = {};
    for (const entry of entries) {
      let modified = '';
      try { modified = (await stat(entry.file)).mtime.toISOString(); } catch { /* gone since */ }
      copies[entry.tool] = { hash: entry.hash, directory: entry.file, rootLabel: harnesses[entry.tool].name, lines: entry.agent.prompt.split('\n').length, modified, summary: entry.agent.description, writable: true, folder: name };
    }
    const cannot: Partial<Record<HarnessId, string>> = {};
    if (!safeName(name)) for (const tool of present) if (!slot[tool]) cannot[tool] = 'This name can’t be a file name in another tool.';
    // Limits (TRN-01): what each tool would lose from the origin's agent; such a destination gets it one-way.
    const limits: Partial<Record<HarnessId, string>> = {};
    for (const tool of present) {
      const lost = losses(tool, origin);
      if (lost.length) limits[tool] = `With limits: no equivalent here for ${lost.join(', ')} from ${harnesses[origin.tool].name}, so this tool gets the agent one-way. An edit or deletion here stays here.`;
    }
    const edited = managed ? item.copies.filter(copy => !copy.oneWay && slot[copy.tool] && slot[copy.tool]!.hash !== copy.hash).map(copy => copy.tool) : [];
    const stopped = item?.copies.filter(copy => copy.stopped).map(copy => copy.tool) ?? [];
    servers.push({ key: name, name, description: origin.agent.description, copies, extra: [], managed, off: item?.off ?? [], cannot, separate: item?.separate, edited, choiceBlocks: {}, limits, stopped });
  }
  return { tools: present, servers, claudePending: [], access: await writeAccess(context), gate: await syncGate(context), problems, notices };
}

// ---------- Apply ----------

/**
 * Records Managed choices and brings each managed agent into line. Two-way among copies that hold every field of the
 * origin; one-way to a copy that loses one. Deletion of a two-way copy spreads after it settles (DEL-01, DEL-02).
 */
export async function applyAgents(context: ShareContext, tools: HarnessId[], changes: Change[], options: { settleMs?: number; now?: number } = {}): Promise<McpResult> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason, results: [], writes: 0 };
  const gate = await syncGate(context);
  if (gate.state === 'stopped' || gate.state === 'needs-resume') return { stopped: gate.reason, results: [], writes: 0 };
  let { record: owner } = await readRecord(context.home);
  if (!owner && !changes.length) return { results: [], writes: 0 };
  if (!owner) { owner = { formatVersion: FORMAT_VERSION, generation: randomUUID(), owner: context.build, items: Object.create(null) }; await saveRecord(context.home, owner); }
  if (gate.state !== 'ready') await remember(context, owner.generation);

  const present = tools.filter(tool => agentTools.includes(tool));
  const { byName, folders } = await gatherAgents(context, present);
  const record = await readAgentRecord(context.home);
  const results: DestinationResult[] = [];
  const events: HistoryEvent[] = [];
  const notices: SyncNotice[] = [];
  const event = (fields: Omit<HistoryEvent, 'id' | 'at'>) => { const made: HistoryEvent = { id: randomUUID(), at: new Date().toISOString(), ...fields }; events.push(made); return made.id; };
  const now = options.now ?? Date.now();
  let writes = 0;
  const chosenNow = new Set<string>();
  for (const change of changes) {
    const slot = byName.get(change.key);
    if (!slot) continue;
    const item: AgentRecordItem = record.items[change.key] ?? { state: 'dont-share', off: [], hash: '', copies: [] };
    item.state = change.managed && change.use !== 'separate' ? 'shared' : 'dont-share';
    item.off = change.off;
    item.separate = change.use === 'separate' ? true : undefined;
    if (item.state !== 'shared') { item.copies = []; delete item.missingSince; }
    else delete item.deleted;
    if (change.use && change.use !== 'separate' && slot[change.use]) { item.origin = change.use; item.hash = slot[change.use]!.hash; item.copies = []; chosenNow.add(change.key); }
    record.items[change.key] = item;
  }
  for (const [name, item] of Object.entries(record.items)) {
    if (item.state !== 'shared') continue;
    const key = `agent:${name}`;
    const slot = byName.get(name) ?? {};
    // A tool whose agents folder is gone is not a deletion: its copy is forgotten and put back, as a skills folder reset is.
    const syncing = present.filter(tool => !item.off.includes(tool));
    item.copies = item.copies.filter(copy => folders.has(copy.tool) || !present.includes(copy.tool));
    const recorded = new Map(item.copies.map(copy => [copy.tool, copy]));

    // One-way copies edited or deleted there are left alone from then on (D-26): nothing spreads from them.
    for (const copy of item.copies) {
      if (!copy.oneWay || copy.stopped || !syncing.includes(copy.tool)) continue;
      const here = slot[copy.tool];
      if (here?.hash === copy.hash) continue;
      copy.stopped = true;
      results.push({ item: name, harness: copy.tool, outcome: 'held', message: `${here ? 'Edited' : 'Deleted'} in ${harnesses[copy.tool].name}, which gets this agent one-way. Central Knot stopped updating it there; nothing spread.` });
    }
    const live = (tool: HarnessId) => !recorded.get(tool)?.stopped;
    const twoWay = (tool: HarnessId) => live(tool) && !recorded.get(tool)?.oneWay;
    const entries = syncing.filter(live).map(tool => slot[tool]).filter((entry): entry is AgentEntry => !!entry);

    // Deletion of a two-way copy (DEL-01), settled, spreads to every copy not edited since (DEL-02). An edit racing it wins.
    const missing = item.copies.filter(copy => syncing.includes(copy.tool) && twoWay(copy.tool) && !slot[copy.tool]);
    const since = item.missingSince ??= {};
    for (const copy of missing) since[copy.tool] ??= now;
    for (const tool of Object.keys(since) as HarnessId[]) if (!missing.some(copy => copy.tool === tool)) delete since[tool];
    if (missing.length) {
      if (missing.some(copy => now - since[copy.tool]! < (options.settleMs ?? 2000))) continue;
      const editedNow = entries.filter(entry => twoWay(entry.tool) && recorded.has(entry.tool) && recorded.get(entry.tool)!.hash !== entry.hash);
      if (!editedNow.length) {
        const removed: HarnessId[] = [];
        for (const entry of entries) {
          await keep(context, entry);
          await rm(entry.file, { force: true });
          writes++;
          removed.push(entry.tool);
          results.push({ item: name, harness: entry.tool, outcome: 'removed', message: `Deleted in ${harnesses[missing[0].tool].name}, so removed here too.` });
        }
        const id = event({ key, item: name, kind: 'deleted', winner: { tool: missing[0].tool, hash: item.hash }, losers: [], orderProved: true, previous: item.hash });
        notices.push({ key, item: name, kind: 'deleted', winner: missing[0].tool, losers: removed, orderProved: true, history: id });
        item.state = 'dont-share';
        item.deleted = { at: new Date(now).toISOString(), tool: missing[0].tool, hash: item.hash };
        item.copies = [];
        delete item.missingSince;
        continue;
      }
      // The deleted copy comes back with the edit.
      item.copies = item.copies.filter(copy => !missing.includes(copy));
      for (const copy of missing) recorded.delete(copy.tool);
    }
    delete item.missingSince;

    // The winner: a one-sided edit at a two-way copy; competing edits by the fixed tool order (D-04); else the baseline.
    const edited = entries.filter(entry => twoWay(entry.tool) && recorded.has(entry.tool) && recorded.get(entry.tool)!.hash !== entry.hash);
    const twoWayEntries = entries.filter(entry => twoWay(entry.tool));
    let source: AgentEntry | undefined = [...edited].sort((first, second) => order.indexOf(first.tool) - order.indexOf(second.tool))[0]
      ?? richest(twoWayEntries, item.hash, item.origin)
      ?? (twoWayEntries.length && new Set(twoWayEntries.map(entry => entry.hash)).size === 1 ? richest(twoWayEntries, twoWayEntries[0].hash, item.origin) : undefined);
    if (!source) { results.push({ item: name, outcome: 'held', message: twoWayEntries.length ? 'Copies differ. Choose which copy to use.' : 'No copy is left to start from.' }); continue; }
    // An unrecorded copy that differs, with no baseline to call it behind, is a same-name collision: it needs a choice.
    if (!chosenNow.has(name) && entries.some(entry => !recorded.has(entry.tool) && entry.hash !== source!.hash && entry.hash !== item.hash)) { results.push({ item: name, outcome: 'held', message: 'Copies differ. Choose which copy to use.' }); continue; }
    // With the same content in several copies, the one holding the most fields is the origin, so the others are labelled honestly.
    if (!edited.length) source = richest(twoWayEntries, source.hash, item.origin) ?? source;
    const competing = edited.length > 1 && new Set(edited.map(entry => entry.hash)).size > 1;
    const replaced: { tool: HarnessId; hash: string }[] = [];
    await keep(context, source);
    const copies: AgentCopy[] = item.copies.filter(copy => copy.stopped);
    for (const tool of syncing) {
      if (!live(tool)) continue;
      const here = slot[tool];
      const lost = losses(tool, source);
      const oneWay = lost.length > 0;
      if (here?.hash === source.hash) { copies.push({ tool, hash: here.hash, oneWay: oneWay || undefined }); continue; }
      if (!here && !safeName(name)) { results.push({ item: name, harness: tool, outcome: 'held', message: 'This name can’t be a file name here.' }); continue; }
      if (here) await keep(context, here);
      const path = here?.file ?? fileFor(context, tool, name);
      let text: string;
      try { text = agentText(tool, source.agent, here?.text); } catch { results.push({ item: name, harness: tool, outcome: 'held', message: 'This file could not be updated without changing other parts of it.' }); continue; }
      // The file changed since it was read: leave it for the next pass rather than overwrite what was just written.
      if (here) {
        let current: string | undefined;
        try { current = await readFile(path, 'utf8'); } catch { /* gone */ }
        if (current !== here.text) { results.push({ item: name, harness: tool, outcome: 'held', message: 'Changed while syncing. It will be looked at again.' }); continue; }
      }
      await writeAtomically(path, text);
      writes++;
      if (here) replaced.push({ tool, hash: here.hash });
      copies.push({ tool, hash: agentHash(source.agent), oneWay: oneWay || undefined });
      results.push({ item: name, harness: tool, outcome: 'written', message: `${here ? `Now has ${harnesses[source.tool].name}'s version` : 'Added'}${oneWay ? `, with limits: ${harnesses[tool].name} has no equivalent for ${lost.join(', ')}` : ''}. Start a new session to use it.` });
    }
    // Copies not written (held) keep what was recorded, so the next pass still sees them as they are.
    for (const tool of syncing) if (live(tool) && slot[tool] && !copies.some(copy => copy.tool === tool)) copies.push({ tool, hash: recorded.get(tool)?.hash ?? slot[tool]!.hash, oneWay: recorded.get(tool)?.oneWay });
    if (edited.length && replaced.length) {
      const id = event({ key, item: name, kind: competing ? 'conflict' : 'edit', winner: { tool: source.tool, hash: source.hash }, losers: replaced, orderProved: !competing, previous: item.hash || undefined });
      notices.push({ key, item: name, kind: competing ? 'conflict' : 'edit', winner: source.tool, losers: competing ? edited.filter(entry => entry.hash !== source!.hash).map(entry => entry.tool) : replaced.map(entry => entry.tool), orderProved: !competing, history: id });
    }
    item.origin = source.tool;
    item.hash = source.hash;
    item.copies = copies;
  }
  await saveAgentRecord(context.home, record);
  await appendHistory(context, events);
  return { results, writes, notices };
}

/** Undo or Restore of an agent event: the kept version becomes the baseline and is written to every tool it syncs to. */
export async function restoreAgent(context: ShareContext, tools: HarnessId[], eventId: string): Promise<McpResult> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason, results: [], writes: 0 };
  const history = await readHistory(context.home);
  const past = history.find(entry => entry.id === eventId);
  const name = past?.key.replace(/^agent:/, '');
  const hash = past && (past.kind === 'conflict' ? past.losers.find(loser => loser.hash !== past.previous && loser.hash !== past.winner?.hash)?.hash ?? past.previous : ['deleted', 'edit', 'restored'].includes(past.kind) ? past.previous : undefined);
  if (!past || !name || !hash) return { stopped: 'That change can’t be restored.', results: [], writes: 0 };
  if (past.undoneBy) return { stopped: 'That change was already undone.', results: [], writes: 0 };
  const version = await kept(context, name, hash);
  if (!version) return { stopped: 'The kept version is no longer in Central Knot’s store, so it can’t be restored.', results: [], writes: 0 };
  const record = await readAgentRecord(context.home);
  const item: AgentRecordItem = record.items[name] ?? { state: 'shared', off: [], hash: '', copies: [] };
  const present = tools.filter(tool => agentTools.includes(tool));
  const { byName } = await gatherAgents(context, present);
  const slot = byName.get(name) ?? {};
  if (item.state !== 'shared' && Object.values(slot).some(entry => entry && entry.hash !== hash)) return { stopped: `A different “${name}” agent is there now. Remove or rename it, then restore.`, results: [], writes: 0 };
  if (past.kind !== 'deleted' && item.state !== 'shared') return { stopped: `${name} was deleted since. Restore the deletion instead.`, results: [], writes: 0 };
  const results: DestinationResult[] = [];
  let writes = 0;
  const before = item.state === 'shared' ? item.hash : undefined;
  const replaced: { tool: HarnessId; hash: string }[] = [];
  const copies: AgentCopy[] = [];
  const origin = { tool: version.tool, agent: version.agent };
  for (const tool of present.filter(candidate => !item.off.includes(candidate) || candidate === version.tool)) {
    const here = slot[tool];
    const oneWay = losses(tool, origin).length > 0;
    if (here?.hash === hash) { copies.push({ tool, hash, oneWay: oneWay || undefined }); continue; }
    if (here) await keep(context, here);
    // The origin's own tool gets the kept file back whole; others get name, description and prompt.
    const text = tool === version.tool && !here ? version.text : agentText(tool, version.agent, here?.text);
    await writeAtomically(here?.file ?? fileFor(context, tool, name), text);
    writes++;
    if (here) replaced.push({ tool, hash: here.hash });
    copies.push({ tool, hash, oneWay: oneWay || undefined });
    results.push({ item: name, harness: tool, outcome: 'written', message: 'Restored.' });
  }
  item.state = 'shared';
  item.hash = hash;
  item.origin = version.tool;
  item.copies = copies;
  delete item.deleted;
  delete item.missingSince;
  record.items[name] = item;
  await saveAgentRecord(context.home, record);
  const id = randomUUID();
  past.undoneBy = id;
  await replaceHistory(context, [...history, { id, at: new Date().toISOString(), key: past.key, item: name, kind: 'restored', winner: { tool: replaced[0]?.tool ?? version.tool, hash }, losers: replaced, orderProved: true, previous: before }]);
  return { results, writes };
}
