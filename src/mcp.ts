// MCP servers across tools (MCP-01): read each tool's entries into one neutral shape, manage them like skills, and write each
// destination by editing only that server's entry (FIL-02). Claude Code's ~/.claude.json waits for an explicit Write now (MCP-02).
// The safety rules are the skills engine's: a file that is missing or unreadable is never read as deletions, every write rereads
// and checks the file and never overwrites a save made meanwhile, only this server's own recorded copies are ever removed, and every
// entry replaced or removed is kept whole per tool (its own settings too) so Restore puts it back as it was.
import { createHash, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { harnesses } from './harnesses.ts';
import { FORMAT_VERSION, errorCode, readRecord, recoverParked, remember, saveRecord, storeDirectory, syncGate, writeAccess, writeDurably, writeFileChecked, type ShareContext } from './share.ts';
import { readTomlTables, setJsonMember, setTomlTable, tomlHeader, tomlValue, type TomlValue } from './textedit.ts';
import { appendHistory, readHistory, replaceHistory } from './manage.ts';
import type { Change, DestinationResult, HarnessId, HistoryEvent, McpResult, McpView, SkillFacts, SyncNotice, ToolCopy } from './types.ts';
export type { McpResult, McpView } from './types.ts';

// ---------- Shapes ----------

/** The fields every tool can hold the same way (CD §5, Representable). Anything else is a tool's own and stays where it is. */
export interface NeutralServer { transport: 'stdio' | 'http' | 'sse'; command?: string; args?: string[]; env?: Record<string, string>; cwd?: string; url?: string; headers?: Record<string, string> }

export interface McpEntry {
  name: string;
  tool: HarnessId;
  file: string;
  server: NeutralServer;
  /** The tool's own fields for this server, kept when Central Knot rewrites it there. JSON values, or TOML lines. */
  extras: Record<string, unknown>;
  hash: string;
  /** Why this entry is never shared: it belongs to the app that wrote it, such as ChatGPT desktop. */
  hostBound?: string;
}

/** `file`: where the copy was recorded; `removing`: a deletion still has to remove it (Claude Code waits for Write now); `away`: its file was missing when last looked at. */
interface McpCopy { tool: HarnessId; hash: string; file?: string; status?: 'removing'; away?: boolean }
export interface McpRecordItem { state: 'shared' | 'dont-share'; off: HarnessId[]; hash: string; copies: McpCopy[]; separate?: boolean; deleted?: { at: string; tool: HarnessId; hash: string };
  /** Entries about to be overwritten or removed, on record before the file changes, so an interrupted pass still names them in History. */
  displaced?: { tool: HarnessId; hash: string }[] }
export interface McpRecord { formatVersion: number; items: Record<string, McpRecordItem> }

export const mcpTools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];

// ---------- Files ----------

const configRoot = (context: ShareContext, tool: HarnessId) => context.overrides?.[tool] ?? join(context.home, harnesses[tool].defaultConfig);

/** Where each tool keeps user-wide MCP servers. Claude Code's moves with CLAUDE_CONFIG_DIR. */
export function mcpFile(context: ShareContext, tool: HarnessId): string {
  if (tool === 'claude-cli') return context.overrides?.[tool] ? join(context.overrides[tool]!, '.claude.json') : join(context.home, '.claude.json');
  if (tool === 'copilot-cli') return join(configRoot(context, tool), 'mcp-config.json');
  return join(configRoot(context, tool), 'config.toml');
}

const canonical = (value: unknown): unknown => (Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([first], [second]) => first.localeCompare(second)).map(([key, item]) => [key, canonical(item)])) : value);
export const serverHash = (server: NeutralServer) => createHash('sha256').update(JSON.stringify(canonical(server))).digest('hex');

const strings = (value: unknown): Record<string, string> | undefined => (value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, String(item)])) : undefined);
const list = (value: unknown): string[] | undefined => (Array.isArray(value) ? value.map(String) : undefined);
const nonEmpty = <T extends object>(value: T | undefined) => (value && Object.keys(value).length ? value : undefined);

/** Belongs to the app that wrote it: ChatGPT desktop's own servers, or a command inside an app bundle. */
function hostBound(name: string, server: NeutralServer): string | undefined {
  if (name === 'node_repl') return 'ChatGPT desktop keeps this server for itself.';
  if ([server.command, server.cwd].some(path => path && /\/[^/]+\.app\//.test(path))) return 'It runs from inside an app, so it belongs to that app.';
  return undefined;
}

function fromJson(name: string, tool: HarnessId, file: string, raw: Record<string, unknown>): McpEntry {
  const type = String(raw.type ?? (raw.url ? 'http' : 'stdio'));
  const server: NeutralServer = {
    transport: type === 'sse' ? 'sse' : type === 'http' || type === 'streamable-http' ? 'http' : 'stdio',
    command: typeof raw.command === 'string' ? raw.command : undefined, args: list(raw.args), env: nonEmpty(strings(raw.env)),
    cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined, url: typeof raw.url === 'string' ? raw.url : undefined, headers: nonEmpty(strings(raw.headers)),
  };
  const extras = Object.fromEntries(Object.entries(raw).filter(([key]) => !['type', 'command', 'args', 'env', 'cwd', 'url', 'headers'].includes(key)));
  return { name, tool, file, server, extras, hash: serverHash(server), hostBound: hostBound(name, server) };
}

/**
 * Reads one tool's servers. A file that cannot be read gives a problem, never a guess. `text` is the file as read, so a write can
 * check nothing changed since.
 */
export async function readTool(context: ShareContext, tool: HarnessId): Promise<{ entries: McpEntry[]; problem?: string; exists: boolean; text?: string; /** Server names whose entry is there but is not a server (say, null): held, never read as absent. */ invalid?: string[] }> {
  const file = mcpFile(context, tool);
  let text: string;
  try { text = await readFile(file, 'utf8'); } catch (error) { return { entries: [], exists: false, problem: errorCode(error) === 'ENOENT' ? undefined : `${file} could not be read.` }; }
  try {
    if (tool === 'codex-cli') {
      const tables = readTomlTables(text);
      const entries: McpEntry[] = [];
      for (const table of tables.filter(candidate => candidate.path.length === 2 && candidate.path[0] === 'mcp_servers')) {
        const name = table.path[1];
        const value = (key: string) => table.entries.find(entry => entry.key === key)?.value;
        const subtables = tables.filter(candidate => candidate.path.length >= 3 && candidate.path[0] === 'mcp_servers' && candidate.path[1] === name);
        const envTable = subtables.find(candidate => candidate.path.length === 3 && candidate.path[2] === 'env');
        const headersTable = subtables.find(candidate => candidate.path.length === 3 && candidate.path[2] === 'http_headers');
        const env = envTable ? Object.fromEntries(envTable.entries.map(entry => [entry.key, String(entry.value)])) : strings(value('env'));
        const headers = headersTable ? Object.fromEntries(headersTable.entries.map(entry => [entry.key, String(entry.value)])) : strings(value('http_headers'));
        const url = typeof value('url') === 'string' ? value('url') as string : undefined;
        const server: NeutralServer = {
          transport: url ? 'http' : 'stdio', command: typeof value('command') === 'string' ? value('command') as string : undefined, args: list(value('args')),
          env: nonEmpty(env), cwd: typeof value('cwd') === 'string' ? value('cwd') as string : undefined, url, headers: nonEmpty(headers),
        };
        const extras: Record<string, unknown> = Object.fromEntries(table.entries.filter(entry => !['command', 'args', 'env', 'cwd', 'url', 'http_headers'].includes(entry.key)).map(entry => [entry.key, entry.raw]));
        // Codex's own subtables (env_http_headers, tool settings…) are this tool's: kept whole, as written, under their header.
        for (const sub of subtables.filter(candidate => candidate !== envTable && candidate !== headersTable)) extras[`[${sub.path.slice(2).join('.')}]`] = text.slice(sub.start, sub.end);
        entries.push({ name, tool, file, server, extras, hash: serverHash(server), hostBound: hostBound(name, server) });
      }
      return { entries, exists: true, text };
    }
    const parsed = JSON.parse(text.replace(/^﻿/, '')) as { mcpServers?: unknown };
    const servers = parsed && typeof parsed === 'object' ? parsed.mcpServers ?? {} : {};
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) throw new Error('mcpServers is not an object');
    const all = Object.entries(servers as Record<string, unknown>);
    const valid = (raw: unknown): raw is Record<string, unknown> => !!raw && typeof raw === 'object' && !Array.isArray(raw);
    return { entries: all.filter(([, raw]) => valid(raw)).map(([name, raw]) => fromJson(name, tool, file, raw as Record<string, unknown>)), invalid: all.filter(([, raw]) => !valid(raw)).map(([name]) => name), exists: true, text };
  } catch {
    return { entries: [], exists: true, problem: `${file} could not be read as ${tool === 'codex-cli' ? 'TOML' : 'JSON'}, so its servers are not offered and it is never written.` };
  }
}

/** Why a tool cannot hold this server, if it cannot (CD §5, Unsupported). */
export function cannotHold(tool: HarnessId, server: NeutralServer): string | undefined {
  if (tool === 'codex-cli' && server.transport === 'sse') return 'Codex has no documented SSE transport.';
  if (server.transport === 'stdio' && !server.command) return 'It has no command to run.';
  if (server.transport !== 'stdio' && !server.url) return 'It has no URL.';
  return undefined;
}

/** The entry text for a destination: the neutral fields, plus that tool's own fields for this server as they were. */
export function writeEntry(text: string, tool: HarnessId, name: string, server: NeutralServer | undefined, extras: Record<string, unknown> = {}): string {
  if (tool === 'codex-cli') {
    if (!server) return setTomlTable(text, ['mcp_servers'], name, undefined);
    const lines = [tomlHeader(['mcp_servers', name])];
    const put = (key: string, value: TomlValue | undefined) => { if (value !== undefined) lines.push(`${key} = ${tomlValue(value)}`); };
    put('command', server.command); put('args', server.args); put('cwd', server.cwd); put('url', server.url); put('http_headers', server.headers);
    for (const [key, raw] of Object.entries(extras)) if (typeof raw === 'string' && !key.startsWith('[')) lines.push(raw.replace(/\r?\n$/, ''));
    let body = `${lines.join('\n')}\n`;
    if (server.env) body += `\n${tomlHeader(['mcp_servers', name, 'env'])}\n${Object.entries(server.env).map(([key, value]) => `${/^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key)} = ${tomlValue(value)}`).join('\n')}\n`;
    for (const [key, raw] of Object.entries(extras)) if (typeof raw === 'string' && key.startsWith('[')) body += `\n${raw.replace(/\s*$/, '')}\n`;
    return setTomlTable(text, ['mcp_servers'], name, body);
  }
  if (!server) return setJsonMember(text, ['mcpServers', name], undefined);
  const entry: Record<string, unknown> = {
    type: tool === 'copilot-cli' && server.transport === 'stdio' ? 'local' : server.transport,
    command: server.command, args: server.args, env: server.env, cwd: server.cwd, url: server.url, headers: server.headers, ...extras,
  };
  // Copilot offers every tool of a server only when told to (CD §5): a new entry gets its documented default.
  if (tool === 'copilot-cli' && entry.tools === undefined) entry.tools = ['*'];
  return setJsonMember(text, ['mcpServers', name], Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined)));
}

/**
 * Rereads the file, checks the entry is still what was decided on, then edits only that entry (FIL-02). The write itself refuses
 * if the file changed after this read, so a setting saved meanwhile (even an unrelated one) is never lost.
 */
async function editEntry(context: ShareContext, tool: HarnessId, name: string, expected: string | undefined, server: NeutralServer | undefined, extras?: Record<string, unknown>): Promise<string | undefined> {
  const file = mcpFile(context, tool);
  const now = await readTool(context, tool);
  if (now.problem) return now.problem;
  const current = now.entries.find(entry => entry.name === name);
  if ((current?.hash ?? undefined) !== expected) return `${harnesses[tool].name}'s entry for ${name} changed just now. Nothing was written; it is read again next time.`;
  try { await writeFileChecked(file, writeEntry(now.text ?? '', tool, name, server, extras ?? current?.extras ?? {}), now.exists ? now.text : undefined); }
  catch (error) {
    if (errorCode(error) === 'CK_CHANGED' || errorCode(error) === 'CK_OCCUPIED') return `${harnesses[tool].name}'s settings file changed just now. Nothing was written; it is read again next time.`;
    throw error;
  }
  return undefined;
}

// ---------- Kept versions (CON-02) ----------

/**
 * Every server version Central Knot replaces or removes is kept first: the neutral server, and each tool's own entry with its own
 * settings (a Codex `enabled = false`, a timeout), so Restore puts each tool's entry back as it was. Never pruned.
 */
const keptBase = (context: ShareContext, name: string) => join(storeDirectory(context.home), 'items', 'mcp', encodeURIComponent(name));
async function keep(context: ShareContext, name: string, server: NeutralServer, entry?: McpEntry) {
  const hash = serverHash(server);
  const path = join(keptBase(context, name), `${hash}.json`);
  try { await stat(path); } catch { await writeDurably(path, `${JSON.stringify(server, null, 2)}\n`); }
  if (entry) await writeDurably(join(keptBase(context, name), hash, `${entry.tool}.json`), `${JSON.stringify({ extras: entry.extras }, null, 2)}\n`);
}
async function kept(context: ShareContext, name: string, hash: string): Promise<{ server: NeutralServer; extras: Partial<Record<HarnessId, Record<string, unknown>>> } | undefined> {
  try {
    const server = JSON.parse(await readFile(join(keptBase(context, name), `${hash}.json`), 'utf8'));
    const extras: Partial<Record<HarnessId, Record<string, unknown>>> = {};
    for (const tool of mcpTools) { try { extras[tool] = JSON.parse(await readFile(join(keptBase(context, name), hash, `${tool}.json`), 'utf8')).extras; } catch { /* not kept for this tool */ } }
    return { server, extras };
  } catch { return undefined; }
}

// ---------- Record ----------

const recordPath = (home: string) => join(storeDirectory(home), 'mcp.json');
async function readMcpRecord(home: string): Promise<McpRecord> {
  try { const parsed = JSON.parse(await readFile(recordPath(home), 'utf8')); if (parsed && typeof parsed.items === 'object') return parsed; } catch { /* first time */ }
  return { formatVersion: 1, items: {} };
}
const saveMcpRecord = (home: string, record: McpRecord) => writeDurably(recordPath(home), `${JSON.stringify(record, null, 2)}\n`);

// ---------- View ----------

const summary = (server: NeutralServer) => (server.transport === 'stdio' ? [server.command, ...(server.args ?? [])].filter(Boolean).join(' ') : `${server.transport.toUpperCase()} ${server.url ?? ''}`);

async function gatherAll(context: ShareContext, tools: HarnessId[]) {
  const byName = new Map<string, Partial<Record<HarnessId, McpEntry>>>();
  const problems: string[] = [];
  const unreadable = new Set<HarnessId>();
  const missingFiles = new Set<HarnessId>();
  const invalid = new Map<string, HarnessId[]>();
  for (const tool of tools) {
    const read = await readTool(context, tool);
    if (read.problem) { problems.push(read.problem); unreadable.add(tool); }
    for (const name of read.invalid ?? []) { invalid.set(name, [...(invalid.get(name) ?? []), tool]); problems.push(`${mcpFile(context, tool)}: “${name}” is not a server entry, so it is left alone.`); }
    if (!read.exists) missingFiles.add(tool);
    for (const entry of read.entries) { const slot = byName.get(entry.name) ?? {}; slot[tool] = entry; byName.set(entry.name, slot); }
  }
  return { byName, problems, unreadable, missingFiles, invalid };
}

/** Claude Code entries waiting for Write now (MCP-02): a copy to add or bring up to date, or one a deletion still has to remove. */
function claudeWaits(item: McpRecordItem | undefined, slot: Partial<Record<HarnessId, McpEntry>>, present: HarnessId[]) {
  if (!item || !present.includes('claude-cli') || item.off.includes('claude-cli')) return false;
  const copy = item.copies.find(entry => entry.tool === 'claude-cli');
  if (copy?.status === 'removing') return !!slot['claude-cli'] && slot['claude-cli']!.hash === copy.hash;
  if (item.state !== 'shared') return false;
  const here = slot['claude-cli'];
  if (!here) return true;
  // Behind (not edited there): it holds what was recorded, but not the synced content.
  return here.hash !== item.hash && copy?.hash === here.hash;
}

export async function mcpView(context: ShareContext, tools: HarnessId[], notices: SyncNotice[] = []): Promise<McpView> {
  const present = tools.filter(tool => mcpTools.includes(tool));
  const { byName, problems } = await gatherAll(context, present);
  const record = await readMcpRecord(context.home);
  const servers: SkillFacts[] = [];
  const claudePending: string[] = [];
  for (const [name, slot] of [...byName].sort(([first], [second]) => first.localeCompare(second))) {
    const item = record.items[name];
    const entries = Object.values(slot) as McpEntry[];
    const held = entries.find(entry => entry.hostBound)?.hostBound;
    const copies: Partial<Record<HarnessId, ToolCopy>> = {};
    for (const entry of entries) copies[entry.tool] = { hash: entry.hash, directory: entry.file, rootLabel: harnesses[entry.tool].name, lines: 0, modified: new Date().toISOString(), summary: summary(entry.server), writable: !entry.hostBound, folder: name };
    const cannot: Partial<Record<HarnessId, string>> = {};
    const sample = entries[0].server;
    for (const tool of present) { if (!slot[tool]) { const reason = cannotHold(tool, sample); if (reason) cannot[tool] = reason; } }
    if (claudeWaits(item, slot, present)) claudePending.push(name);
    servers.push({ key: name, name, description: summary(sample), copies, extra: [], managed: item?.state === 'shared', off: item?.off ?? [], cannot, held, separate: item?.separate, choiceBlocks: {} });
  }
  return { tools: present, servers, claudePending, access: await writeAccess(context), gate: await syncGate(context), problems, notices };
}

// ---------- Apply ----------

/**
 * Records Managed choices, then brings each managed server into line: a copy where a tool lacks it, a one-sided edit spread,
 * a deletion spread once it holds. Claude Code is written only when `claudeNow` (Write now, Claude closed) names that server.
 */
export async function applyMcp(context: ShareContext, tools: HarnessId[], changes: Change[], options: { claudeNow?: string[]; settleMs?: number; now?: number; only?: Set<string> } = {}): Promise<McpResult> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason, results: [], writes: 0 };
  const gate = await syncGate(context);
  if (gate.state === 'stopped' || gate.state === 'needs-resume') return { stopped: gate.reason, results: [], writes: 0 };
  // The sync record is the one place ownership lives: make it now if this is the first thing Central Knot manages.
  let { record: owner } = await readRecord(context.home);
  if (!owner && !changes.length) return { results: [], writes: 0 };
  if (!owner) { owner = { formatVersion: FORMAT_VERSION, generation: randomUUID(), owner: context.build, items: Object.create(null) }; await saveRecord(context.home, owner); }
  if (gate.state !== 'ready') await remember(context, owner.generation);

  const present = tools.filter(tool => mcpTools.includes(tool));
  // A write a crash interrupted is finished first, so a settings file moved aside is never read as missing.
  for (const tool of present) await recoverParked(dirname(mcpFile(context, tool)));
  const { byName, unreadable, missingFiles, invalid } = await gatherAll(context, present);
  const record = await readMcpRecord(context.home);
  const results: DestinationResult[] = [];
  const events: HistoryEvent[] = [];
  const notices: SyncNotice[] = [];
  const event = (fields: Omit<HistoryEvent, 'id' | 'at'>) => { const made: HistoryEvent = { id: randomUUID(), at: new Date().toISOString(), ...fields }; events.push(made); return made.id; };
  let writes = 0;
  let settling = false;
  const claudeNow = (name: string) => !!options.claudeNow?.includes(name);
  // Entries displaced by an earlier pass that stopped before History named them: named this pass.
  const carried = Object.entries(record.items).flatMap(([name, item]) => (item.displaced ?? []).map(entry => ({ name, ...entry })));
  const displace = async (item: McpRecordItem, tool: HarnessId, hash: string) => { (item.displaced ??= []).push({ tool, hash }); await saveMcpRecord(context.home, record); };
  const undisplace = (item: McpRecordItem, tool: HarnessId, hash: string) => { if (!item.displaced) return; item.displaced = item.displaced.filter(entry => !(entry.tool === tool && entry.hash === hash)); if (!item.displaced.length) delete item.displaced; };
  // Servers whose copy the person chose in this Apply all: the chosen copy replaces the others.
  const chosenNow = new Set<string>();
  for (const change of changes) {
    const slot = byName.get(change.key);
    if (!slot) continue;
    const item: McpRecordItem = record.items[change.key] ?? { state: 'dont-share', off: [], hash: '', copies: [] };
    item.state = change.managed && change.use !== 'separate' ? 'shared' : 'dont-share';
    item.off = change.off;
    item.separate = change.use === 'separate' ? true : undefined;
    if (item.state !== 'shared') item.copies = item.copies.filter(copy => copy.status === 'removing');
    else delete item.deleted;
    if (change.use && change.use !== 'separate' && slot[change.use]) { item.hash = slot[change.use]!.hash; item.copies = item.copies.filter(copy => copy.status === 'removing'); chosenNow.add(change.key); }
    record.items[change.key] = item;
  }
  const now = options.now ?? Date.now();
  for (const [name, item] of Object.entries(record.items)) {
    // With Sync off, Apply all writes exactly the servers it shows (SYN-03).
    if (item.state !== 'shared' || (options.only && !options.only.has(name))) continue;
    const slot = byName.get(name) ?? {};
    // An entry that is there but is not a server (say, null, half-edited): nothing about this server is decided until it reads again.
    const broken = invalid.get(name)?.find(tool => !item.off.includes(tool));
    if (broken) { delete (item as { missingSince?: unknown }).missingSince; results.push({ item: name, harness: broken, outcome: 'held', message: `${harnesses[broken].name}'s entry for ${name} is not a server entry right now. Nothing is changed until it reads again.` }); continue; }
    // A tool whose settings file can't be read is left out entirely: nothing about it is inferred or written.
    const syncing = present.filter(tool => !item.off.includes(tool) && !unreadable.has(tool));
    // A copy recorded in a file its tool no longer uses (a moved config root) is let go, never read as a deletion.
    item.copies = item.copies.filter(copy => !copy.file || copy.file === mcpFile(context, copy.tool) || !present.includes(copy.tool));
    // A tool whose settings file is missing right now is away: its copy is neither updated nor read as deleted. When the file is
    // back without the entry (a reset or reinstall), the entry is put back.
    const away = (tool: HarnessId) => missingFiles.has(tool) && item.copies.some(copy => copy.tool === tool && !copy.status);
    item.copies = item.copies.filter(copy => copy.status || away(copy.tool) || !copy.away || !!slot[copy.tool]);
    for (const copy of item.copies) if (!copy.status) { if (away(copy.tool)) copy.away = true; else delete copy.away; }
    const live = syncing.filter(tool => !away(tool));
    const entries = live.map(tool => slot[tool]).filter((entry): entry is McpEntry => !!entry);
    if (entries.some(entry => entry.hostBound)) { results.push({ item: name, outcome: 'held', message: entries.find(entry => entry.hostBound)!.hostBound! }); continue; }
    const recordedCopies = item.copies.filter(copy => !copy.status);
    const recorded = new Map(recordedCopies.map(copy => [copy.tool, copy.hash]));
    const edited = entries.filter(entry => recorded.has(entry.tool) && recorded.get(entry.tool) !== entry.hash);
    // Deletion: a recorded entry gone from a file that is there and can be read (DEL-01, settled), spread to the others (DEL-02).
    const missing = recordedCopies.filter(copy => live.includes(copy.tool) && !slot[copy.tool]);
    const missingSince = (item as McpRecordItem & { missingSince?: Record<string, number> }).missingSince ??= {};
    for (const copy of missing) missingSince[copy.tool] ??= now;
    for (const tool of Object.keys(missingSince) as HarnessId[]) if (!missing.some(copy => copy.tool === tool)) delete missingSince[tool];
    // With Sync off, Apply all writes only what it shows: this server's own pending edit or deletion waits for Sync (SYN-03).
    if (options.only && !chosenNow.has(name) && (edited.length || missing.length)) { results.push({ item: name, outcome: 'held', message: `An edit or deletion of ${name} is waiting for Sync. Turn Sync on or use Sync now.` }); continue; }
    let raced: HarnessId[] | undefined;
    if (missing.length) {
      if (missing.some(copy => now - missingSince[copy.tool] < (options.settleMs ?? 2000))) { settling = true; continue; }
      if (!edited.length) {
        const removed: HarnessId[] = [];
        const leftover: McpCopy[] = [];
        // Only this server's own recorded copies go; a different entry with this name that was never synced stays.
        for (const copy of recordedCopies) {
          if (missing.includes(copy)) continue;
          const entry = slot[copy.tool];
          if (away(copy.tool) || !live.includes(copy.tool)) { if (!item.off.includes(copy.tool)) leftover.push({ ...copy, status: 'removing' }); continue; }
          if (!entry) continue;
          await keep(context, name, entry.server, entry);
          if (copy.tool === 'claude-cli' && !claudeNow(name)) {
            leftover.push({ ...copy, status: 'removing' });
            results.push({ item: name, harness: copy.tool, outcome: 'held', message: 'Deleted elsewhere. Close Claude, then use Write now to remove it from Claude Code.' });
            continue;
          }
          await displace(item, copy.tool, entry.hash);
          const problem = await editEntry(context, copy.tool, name, entry.hash, undefined);
          if (problem) { undisplace(item, copy.tool, entry.hash); results.push({ item: name, harness: copy.tool, outcome: 'held', message: problem }); continue; }
          writes++;
          removed.push(copy.tool);
          results.push({ item: name, harness: copy.tool, outcome: 'removed', message: `Deleted in ${harnesses[missing[0].tool].name}, so removed here too.` });
        }
        for (const entry of entries) if (!recorded.has(entry.tool)) results.push({ item: name, harness: entry.tool, outcome: 'held', message: `${harnesses[entry.tool].name} has a different “${name}” that was never synced. It stays.` });
        const id = event({ key: `mcp:${name}`, item: name, kind: 'deleted', winner: { tool: missing[0].tool, hash: item.hash }, losers: [], orderProved: true, previous: item.hash });
        notices.push({ key: `mcp:${name}`, item: name, kind: 'deleted', winner: missing[0].tool, losers: removed, orderProved: true, history: id });
        item.state = 'dont-share';
        item.deleted = { at: new Date(now).toISOString(), tool: missing[0].tool, hash: item.hash };
        item.copies = leftover;
        delete (item as { missingSince?: unknown }).missingSince;
        continue;
      }
      // An edit races the deletion: the edit is kept, and the deleted copy comes back with it.
      raced = missing.map(copy => copy.tool);
      item.copies = item.copies.filter(copy => !missing.includes(copy));
      for (const copy of missing) recorded.delete(copy.tool);
    }
    // Which content wins: a one-sided edit; competing edits by the fixed tool order (Copilot, Claude, Codex); else the baseline.
    const order: HarnessId[] = ['copilot-cli', 'claude-cli', 'codex-cli'];
    const source = [...edited].sort((first, second) => order.indexOf(first.tool) - order.indexOf(second.tool))[0]
      ?? entries.find(entry => entry.hash === item.hash) ?? (entries.length && new Set(entries.map(entry => entry.hash)).size === 1 ? entries[0] : undefined);
    if (!source) { results.push({ item: name, outcome: 'held', message: 'Copies differ. Choose which copy to use.' }); continue; }
    // An unrecorded copy that differs, with no baseline to call it behind, is a same-name collision: it needs a choice.
    if (!chosenNow.has(name) && entries.some(entry => !recorded.has(entry.tool) && entry.hash !== source.hash && entry.hash !== item.hash)) { results.push({ item: name, outcome: 'held', message: 'Copies differ. Choose which copy to use.' }); continue; }
    const competing = edited.length > 1 && new Set(edited.map(entry => entry.hash)).size > 1;
    const replaced: { tool: HarnessId; hash: string }[] = [];
    // What each tool holds after this pass, as decided: never a later read, so an edit saved meanwhile is still an edit next time.
    const holds = new Map<HarnessId, string>();
    await keep(context, name, source.server, source);
    for (const tool of live) {
      const here = slot[tool];
      if (here?.hash === source.hash) { holds.set(tool, source.hash); continue; }
      const reason = cannotHold(tool, source.server);
      if (reason) { results.push({ item: name, harness: tool, outcome: 'held', message: reason }); continue; }
      if (tool === 'claude-cli' && !claudeNow(name)) { results.push({ item: name, harness: tool, outcome: 'held', message: 'Close Claude, then use Write now: Claude Code rewrites this file while it runs (MCP-02).' }); continue; }
      if (here) { await keep(context, name, here.server, here); await displace(item, tool, here.hash); }
      // The destination's own settings come from the file as reread just before writing, never from an older read.
      const problem = await editEntry(context, tool, name, here?.hash, source.server);
      if (problem) { if (here) undisplace(item, tool, here.hash); results.push({ item: name, harness: tool, outcome: 'held', message: problem }); continue; }
      writes++;
      holds.set(tool, source.hash);
      if (here) replaced.push({ tool, hash: here.hash });
      results.push({ item: name, harness: tool, outcome: 'written', message: `${here ? `Now has ${harnesses[source.tool].name}'s version.` : 'Added.'} ${harnesses[tool].name === 'Codex' ? 'Start a new Codex session to use it.' : 'Start a new session to use it.'}` });
    }
    const key = `mcp:${name}`;
    // A chosen copy that replaced others, an edit kept over a deletion, and an edit that spread are History, with what each replaced kept (CON-02).
    if (chosenNow.has(name) && replaced.length) event({ key, item: name, kind: 'chosen', winner: { tool: source.tool, hash: source.hash }, losers: replaced, orderProved: true, previous: undefined });
    else if (raced) {
      const id = event({ key, item: name, kind: 'kept-edit', winner: { tool: source.tool, hash: source.hash }, losers: [...raced.map(tool => ({ tool, hash: item.hash })), ...replaced], orderProved: false, previous: item.hash });
      notices.push({ key, item: name, kind: 'kept-edit', winner: source.tool, losers: raced, orderProved: false, history: id });
    } else if (edited.length && replaced.length) {
      const id = event({ key, item: name, kind: competing ? 'conflict' : 'edit', winner: { tool: source.tool, hash: source.hash }, losers: replaced, orderProved: !competing, previous: item.hash || undefined });
      notices.push({ key, item: name, kind: competing ? 'conflict' : 'edit', winner: source.tool, losers: competing ? edited.filter(entry => entry.hash !== source.hash).map(entry => entry.tool) : replaced.map(entry => entry.tool), orderProved: !competing, history: id });
    }
    // A copy not written (Claude waiting, a refusal) keeps what was recorded for it, so a change there is still seen as one. A copy
    // replaced by this choice that could not be written yet is recorded as it is, so it reads as behind.
    for (const tool of live) {
      if (holds.has(tool) || !slot[tool]) continue;
      const before = recorded.get(tool) ?? (chosenNow.has(name) ? slot[tool]!.hash : undefined);
      if (before) holds.set(tool, before);
    }
    item.hash = source.hash;
    item.copies = [
      ...item.copies.filter(copy => copy.status || away(copy.tool)),
      ...[...holds].map(([tool, hash]) => ({ tool, hash, file: mcpFile(context, tool) })),
    ];
  }
  // Removals a deletion still owes: Claude Code's once Write now names it, others once their file is back. Only while the entry
  // still holds what it held; changed, or the server set up again, ends that.
  for (const [name, item] of Object.entries(record.items)) {
    if (options.only && !options.only.has(name)) continue;
    const pending = item.copies.filter(copy => copy.status === 'removing');
    if (!pending.length) continue;
    const slot = byName.get(name) ?? {};
    for (const copy of pending) {
      const entry = slot[copy.tool];
      if (item.state === 'shared' || unreadable.has(copy.tool)) { if (item.state === 'shared') item.copies = item.copies.filter(other => other !== copy); continue; }
      if (missingFiles.has(copy.tool)) continue;
      if (!entry || entry.hash !== copy.hash) { item.copies = item.copies.filter(other => other !== copy); continue; }
      if (copy.tool === 'claude-cli' && !claudeNow(name)) continue;
      await keep(context, name, entry.server, entry);
      const problem = await editEntry(context, copy.tool, name, entry.hash, undefined);
      if (problem) { results.push({ item: name, harness: copy.tool, outcome: 'held', message: problem }); continue; }
      writes++;
      item.copies = item.copies.filter(other => other !== copy);
      results.push({ item: name, harness: copy.tool, outcome: 'removed', message: 'Removed now, finishing an earlier deletion.' });
    }
  }
  // Displaced entries no event of this pass names (left by a pass that stopped part-way) get their own History entry.
  const named = (name: string, hash: string) => events.some(made => made.key === `mcp:${name}` && (made.previous === hash || made.winner?.hash === hash || made.losers.some(loser => loser.hash === hash)));
  for (const left of carried) {
    const item = record.items[left.name];
    if (!item || named(left.name, left.hash)) continue;
    event(item.state !== 'shared' && item.deleted
      ? { key: `mcp:${left.name}`, item: left.name, kind: 'deleted', winner: { tool: item.deleted.tool, hash: item.deleted.hash }, losers: [{ tool: left.tool, hash: left.hash }], orderProved: false, previous: item.deleted.hash }
      : { key: `mcp:${left.name}`, item: left.name, kind: 'edit', winner: { tool: left.tool, hash: item.hash }, losers: [{ tool: left.tool, hash: left.hash }], orderProved: false, previous: left.hash });
  }
  await saveMcpRecord(context.home, record);
  await appendHistory(context, events);
  // History names them now: the holds are dropped. A crash between leaves the hold, never an entry no one can restore.
  let cleared = false;
  for (const [name, item] of Object.entries(record.items)) {
    if (!item.displaced?.length) continue;
    const left = item.displaced.filter(entry => !named(name, entry.hash));
    if (left.length !== item.displaced.length) { cleared = true; if (left.length) item.displaced = left; else delete item.displaced; }
  }
  if (cleared) await saveMcpRecord(context.home, record);
  return { results, writes, notices, settling };
}

/** The version an MCP event's Undo or Restore puts back. */
function restorable(past: HistoryEvent): string | undefined {
  if (past.kind === 'deleted') return past.losers.find(loser => loser.hash !== past.previous)?.hash ?? past.previous;
  if (past.kind === 'edit' || past.kind === 'restored') return past.previous;
  if (past.kind === 'chosen') return past.losers[0]?.hash;
  if (past.kind === 'conflict' || past.kind === 'kept-edit') return past.losers.find(loser => loser.hash !== past.previous && loser.hash !== past.winner?.hash)?.hash ?? (past.kind === 'conflict' ? past.previous : undefined);
  return undefined;
}

/**
 * Undo or Restore of an MCP event: the kept version becomes the managed baseline and is written to every tool it syncs to, each with
 * its own kept settings. Claude Code gets it through Write now, as always (MCP-02).
 */
export async function restoreMcp(context: ShareContext, tools: HarnessId[], eventId: string): Promise<McpResult> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason, results: [], writes: 0 };
  // Restore is a write like any other: never while another build owns syncing or the record needs a resume.
  const gate = await syncGate(context);
  if (gate.state === 'stopped' || gate.state === 'needs-resume') return { stopped: gate.reason, results: [], writes: 0 };
  const history = await readHistory(context.home);
  const past = history.find(entry => entry.id === eventId);
  const name = past?.key.replace(/^mcp:/, '');
  const hash = past && restorable(past);
  if (!past || !name || !hash) return { stopped: 'That change can’t be restored.', results: [], writes: 0 };
  if (past.undoneBy) return { stopped: 'That change was already undone.', results: [], writes: 0 };
  const version = await kept(context, name, hash);
  if (!version) return { stopped: 'The kept version is no longer in Central Knot’s store, so it can’t be restored.', results: [], writes: 0 };
  const record = await readMcpRecord(context.home);
  const item: McpRecordItem = record.items[name] ?? { state: 'shared', off: [], hash: '', copies: [] };
  const present = tools.filter(tool => mcpTools.includes(tool));
  for (const tool of present) await recoverParked(dirname(mcpFile(context, tool)));
  const { byName, unreadable, invalid } = await gatherAll(context, present);
  const slot = byName.get(name) ?? {};
  if (invalid.has(name)) return { stopped: `An entry for “${name}” is not a server entry right now. Fix it, then restore.`, results: [], writes: 0 };
  // A server deleted earlier whose name is in use again (set up by hand, or managed again) with other settings: never overwrite it.
  if (past.kind === 'deleted' && item.state === 'shared' && item.hash !== hash) return { stopped: `“${name}” is managed again with other settings. Restoring the old one would replace it; remove or rename the new one first.`, results: [], writes: 0 };
  if (item.state !== 'shared' && Object.values(slot).some(entry => entry && entry.hash !== hash)) return { stopped: `A different “${name}” is set up now. Remove or rename it, then restore.`, results: [], writes: 0 };
  if (past.kind !== 'deleted' && item.state !== 'shared') return { stopped: `${name} was deleted since. Restore the deletion instead.`, results: [], writes: 0 };
  const results: DestinationResult[] = [];
  let writes = 0;
  const before = item.state === 'shared' ? item.hash : undefined;
  const replaced: { tool: HarnessId; hash: string }[] = [];
  // What each tool holds after Restore, as written: never a later read, so an edit saved right after is still an edit.
  const holds = new Map<HarnessId, string>();
  for (const tool of present.filter(candidate => !item.off.includes(candidate) && !unreadable.has(candidate))) {
    const here = slot[tool];
    const extras = version.extras[tool];
    if (here?.hash === hash && (!version.extras[tool] || JSON.stringify(here.extras) === JSON.stringify(version.extras[tool]))) { holds.set(tool, hash); continue; }
    if (here) holds.set(tool, here.hash);
    const reason = cannotHold(tool, version.server);
    if (reason) { results.push({ item: name, harness: tool, outcome: 'held', message: reason }); continue; }
    if (tool === 'claude-cli') { results.push({ item: name, harness: tool, outcome: 'held', message: 'Close Claude, then use Write now to restore it there.' }); continue; }
    if (here) await keep(context, name, here.server, here);
    const problem = await editEntry(context, tool, name, here?.hash, version.server, extras);
    if (problem) { results.push({ item: name, harness: tool, outcome: 'held', message: problem }); continue; }
    writes++;
    holds.set(tool, hash);
    if (here) replaced.push({ tool, hash: here.hash });
    results.push({ item: name, harness: tool, outcome: 'written', message: 'Restored.' });
  }
  item.state = 'shared';
  item.hash = hash;
  delete item.deleted;
  item.copies = [...holds].map(([tool, held]) => ({ tool, hash: held, file: mcpFile(context, tool) }));
  record.items[name] = item;
  await saveMcpRecord(context.home, record);
  const id = randomUUID();
  past.undoneBy = id;
  await replaceHistory(context, [...history, { id, at: new Date().toISOString(), key: past.key, item: name, kind: 'restored', winner: { tool: replaced[0]?.tool ?? 'copilot-cli', hash }, losers: replaced, orderProved: true, previous: before }]);
  return { results, writes };
}
