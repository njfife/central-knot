// MCP servers across tools (MCP-01): read each tool's entries into one neutral shape, manage them like skills, and write each
// destination by editing only that server's entry (FIL-02). Claude Code's ~/.claude.json waits for an explicit Write now (MCP-02).
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { harnesses } from './harnesses.ts';
import { FORMAT_VERSION, readRecord, remember, saveRecord, storeDirectory, syncGate, writeAccess, writeDurably, type ShareContext } from './share.ts';
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

export interface McpRecordItem { state: 'shared' | 'dont-share'; off: HarnessId[]; hash: string; copies: { tool: HarnessId; hash: string }[]; separate?: boolean; deleted?: { at: string; tool: HarnessId; hash: string } }
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

/** Reads one tool's servers. A file that cannot be read gives a problem, never a guess. */
export async function readTool(context: ShareContext, tool: HarnessId): Promise<{ entries: McpEntry[]; problem?: string; exists: boolean }> {
  const file = mcpFile(context, tool);
  let text: string;
  try { text = await readFile(file, 'utf8'); } catch (error) { return { entries: [], exists: false, problem: (error as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : `${file} could not be read.` }; }
  try {
    if (tool === 'codex-cli') {
      const tables = readTomlTables(text);
      const entries: McpEntry[] = [];
      for (const table of tables.filter(candidate => candidate.path.length === 2 && candidate.path[0] === 'mcp_servers')) {
        const name = table.path[1];
        const value = (key: string) => table.entries.find(entry => entry.key === key)?.value;
        const envTable = tables.find(candidate => candidate.path.length === 3 && candidate.path[0] === 'mcp_servers' && candidate.path[1] === name && candidate.path[2] === 'env');
        const env = envTable ? Object.fromEntries(envTable.entries.map(entry => [entry.key, String(entry.value)])) : strings(value('env'));
        const url = typeof value('url') === 'string' ? value('url') as string : undefined;
        const server: NeutralServer = {
          transport: url ? 'http' : 'stdio', command: typeof value('command') === 'string' ? value('command') as string : undefined, args: list(value('args')),
          env: nonEmpty(env), cwd: typeof value('cwd') === 'string' ? value('cwd') as string : undefined, url, headers: nonEmpty(strings(value('http_headers'))),
        };
        const extras = Object.fromEntries(table.entries.filter(entry => !['command', 'args', 'env', 'cwd', 'url', 'http_headers'].includes(entry.key)).map(entry => [entry.key, entry.raw]));
        entries.push({ name, tool, file, server, extras, hash: serverHash(server), hostBound: hostBound(name, server) });
      }
      return { entries, exists: true };
    }
    const parsed = JSON.parse(text.replace(/^﻿/, '')) as { mcpServers?: Record<string, Record<string, unknown>> };
    const servers = parsed && typeof parsed === 'object' ? parsed.mcpServers ?? {} : {};
    return { entries: Object.entries(servers).filter(([, raw]) => raw && typeof raw === 'object').map(([name, raw]) => fromJson(name, tool, file, raw)), exists: true };
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
    for (const raw of Object.values(extras)) if (typeof raw === 'string') lines.push(raw.replace(/\r?\n$/, ''));
    let body = `${lines.join('\n')}\n`;
    if (server.env) body += `\n${tomlHeader(['mcp_servers', name, 'env'])}\n${Object.entries(server.env).map(([key, value]) => `${/^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key)} = ${tomlValue(value)}`).join('\n')}\n`;
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

/** Writes a whole file atomically, keeping its mode; a missing parent folder is made. */
async function writeFileKeepingMode(path: string, text: string) {
  let mode = 0o600;
  try { mode = (await stat(path)).mode & 0o777; } catch { /* new file */ }
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.ck-${randomUUID()}.tmp`;
  await writeFile(temporary, text, { mode });
  await rename(temporary, path);
}

/** Rereads the file, checks the entry is still what was decided on, then edits only that entry (FIL-02 reread before writing). */
async function editEntry(context: ShareContext, tool: HarnessId, name: string, expected: string | undefined, server: NeutralServer | undefined, extras?: Record<string, unknown>): Promise<string | undefined> {
  const file = mcpFile(context, tool);
  const now = await readTool(context, tool);
  if (now.problem) return now.problem;
  const current = now.entries.find(entry => entry.name === name);
  if ((current?.hash ?? undefined) !== expected) return `${harnesses[tool].name}'s entry for ${name} changed just now. Nothing was written; it is read again next time.`;
  let text = '';
  try { text = await readFile(file, 'utf8'); } catch { /* new file */ }
  await writeFileKeepingMode(file, writeEntry(text, tool, name, server, extras ?? current?.extras ?? {}));
  return undefined;
}

// ---------- Kept versions (CON-02) ----------

/** Every server version Central Knot replaces or removes is kept first, so History can put it back. */
const keptPath = (context: ShareContext, name: string, hash: string) => join(storeDirectory(context.home), 'items', 'mcp', encodeURIComponent(name), `${hash}.json`);
async function keep(context: ShareContext, name: string, server: NeutralServer) {
  const path = keptPath(context, name, serverHash(server));
  try { await stat(path); } catch { await writeDurably(path, `${JSON.stringify(server, null, 2)}\n`); }
}
async function kept(context: ShareContext, name: string, hash: string): Promise<NeutralServer | undefined> {
  try { return JSON.parse(await readFile(keptPath(context, name, hash), 'utf8')); } catch { return undefined; }
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
  for (const tool of tools) {
    const read = await readTool(context, tool);
    if (read.problem) problems.push(read.problem);
    for (const entry of read.entries) { const slot = byName.get(entry.name) ?? {}; slot[tool] = entry; byName.set(entry.name, slot); }
  }
  return { byName, problems };
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
    if (item?.state === 'shared' && !slot['claude-cli'] && !item.off.includes('claude-cli') && present.includes('claude-cli')) claudePending.push(name);
    servers.push({ key: name, name, description: summary(sample), copies, extra: [], managed: item?.state === 'shared', off: item?.off ?? [], cannot, held, separate: item?.separate, choiceBlocks: {} });
  }
  return { tools: present, servers, claudePending, access: await writeAccess(context), gate: await syncGate(context), problems, notices };
}

// ---------- Apply ----------


/**
 * Records Managed choices, then brings each managed server into line: a copy where a tool lacks it, a one-sided edit spread,
 * a deletion spread once it holds. Claude Code is written only when `claudeNow` (Write now, Claude closed) names that server.
 */
export async function applyMcp(context: ShareContext, tools: HarnessId[], changes: Change[], options: { claudeNow?: string[]; settleMs?: number; now?: number } = {}): Promise<McpResult> {
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
  const { byName, problems } = await gatherAll(context, present);
  const record = await readMcpRecord(context.home);
  const results: DestinationResult[] = [];
  const events: HistoryEvent[] = [];
  const notices: SyncNotice[] = [];
  const event = (fields: Omit<HistoryEvent, 'id' | 'at'>) => { const made: HistoryEvent = { id: randomUUID(), at: new Date().toISOString(), ...fields }; events.push(made); return made.id; };
  let writes = 0;
  // Servers whose copy the person chose in this Apply all: the chosen copy replaces the others.
  const chosenNow = new Set<string>();
  const unreadable = new Set(present.filter(tool => problems.some(problem => problem.startsWith(mcpFile(context, tool)))));
  for (const change of changes) {
    const slot = byName.get(change.key);
    if (!slot) continue;
    const item = record.items[change.key] ?? { state: 'dont-share', off: [], hash: '', copies: [] };
    item.state = change.managed && change.use !== 'separate' ? 'shared' : 'dont-share';
    item.off = change.off;
    item.separate = change.use === 'separate' ? true : undefined;
    if (item.state !== 'shared') item.copies = [];
    if (change.use && change.use !== 'separate' && slot[change.use]) { item.hash = slot[change.use]!.hash; item.copies = []; chosenNow.add(change.key); }
    record.items[change.key] = item;
  }
  const now = options.now ?? Date.now();
  for (const [name, item] of Object.entries(record.items)) {
    if (item.state !== 'shared') continue;
    const slot = byName.get(name) ?? {};
    const syncing = present.filter(tool => !item.off.includes(tool) && !unreadable.has(tool));
    const entries = syncing.map(tool => slot[tool]).filter((entry): entry is McpEntry => !!entry);
    if (entries.some(entry => entry.hostBound)) { results.push({ item: name, outcome: 'held', message: entries.find(entry => entry.hostBound)!.hostBound! }); continue; }
    const recorded = new Map(item.copies.map(copy => [copy.tool, copy.hash]));
    // Deletion: a recorded entry gone from a file that can still be read (DEL-01, settled), spread to the others (DEL-02).
    const missing = item.copies.filter(copy => syncing.includes(copy.tool) && !slot[copy.tool]);
    const missingSince = (item as McpRecordItem & { missingSince?: Record<string, number> }).missingSince ??= {};
    for (const copy of missing) missingSince[copy.tool] ??= now;
    for (const tool of Object.keys(missingSince) as HarnessId[]) if (!missing.some(copy => copy.tool === tool)) delete missingSince[tool];
    if (missing.length) {
      if (missing.some(copy => now - missingSince[copy.tool] < (options.settleMs ?? 2000))) continue;
      const edited = entries.filter(entry => recorded.has(entry.tool) && recorded.get(entry.tool) !== entry.hash);
      if (!edited.length) {
        const removed: HarnessId[] = [];
        for (const entry of entries) await keep(context, name, entry.server);
        for (const entry of entries) {
          if (entry.tool === 'claude-cli' && !options.claudeNow?.includes(name)) { results.push({ item: name, harness: entry.tool, outcome: 'held', message: 'Deleted elsewhere. Close Claude, then use Write now to remove it from Claude Code.' }); continue; }
          const problem = await editEntry(context, entry.tool, name, entry.hash, undefined);
          if (problem) { results.push({ item: name, harness: entry.tool, outcome: 'held', message: problem }); continue; }
          writes++;
          removed.push(entry.tool);
          results.push({ item: name, harness: entry.tool, outcome: 'removed', message: `Deleted in ${harnesses[missing[0].tool].name}, so removed here too.` });
        }
        const id = event({ key: `mcp:${name}`, item: name, kind: 'deleted', winner: { tool: missing[0].tool, hash: item.hash }, losers: [], orderProved: true, previous: item.hash });
        notices.push({ key: `mcp:${name}`, item: name, kind: 'deleted', winner: missing[0].tool, losers: removed, orderProved: true, history: id });
        item.state = 'dont-share';
        item.deleted = { at: new Date(now).toISOString(), tool: missing[0].tool, hash: item.hash };
        item.copies = [];
        delete (item as { missingSince?: unknown }).missingSince;
        continue;
      }
      // An edit races the deletion: the edit is kept, and the deleted copy comes back with it.
      item.copies = item.copies.filter(copy => !missing.includes(copy));
    }
    // Which content wins: a one-sided edit; competing edits by the fixed tool order (Copilot, Claude, Codex); else the baseline.
    const edited = entries.filter(entry => recorded.has(entry.tool) && recorded.get(entry.tool) !== entry.hash);
    const order: HarnessId[] = ['copilot-cli', 'claude-cli', 'codex-cli'];
    let source = edited.sort((first, second) => order.indexOf(first.tool) - order.indexOf(second.tool))[0];
    if (!source) source = entries.find(entry => entry.hash === item.hash) ?? (new Set(entries.map(entry => entry.hash)).size === 1 ? entries[0] : undefined)!;
    if (!source) { results.push({ item: name, outcome: 'held', message: 'Copies differ. Choose which copy to use.' }); continue; }
    // An unrecorded copy that differs, with no baseline to call it behind, is a same-name collision: it needs a choice.
    if (!chosenNow.has(name) && entries.some(entry => !recorded.has(entry.tool) && entry.hash !== source.hash && entry.hash !== item.hash)) { results.push({ item: name, outcome: 'held', message: 'Copies differ. Choose which copy to use.' }); continue; }
    const competing = edited.length > 1 && new Set(edited.map(entry => entry.hash)).size > 1;
    const replaced: { tool: HarnessId; hash: string }[] = [];
    await keep(context, name, source.server);
    for (const tool of syncing) {
      const here = slot[tool];
      if (here?.hash === source.hash) continue;
      const reason = cannotHold(tool, source.server);
      if (reason) { results.push({ item: name, harness: tool, outcome: 'held', message: reason }); continue; }
      if (tool === 'claude-cli' && !options.claudeNow?.includes(name)) { results.push({ item: name, harness: tool, outcome: 'held', message: 'Close Claude, then use Write now: Claude Code rewrites this file while it runs (MCP-02).' }); continue; }
      if (here) await keep(context, name, here.server);
      const problem = await editEntry(context, tool, name, here?.hash, source.server, here?.extras);
      if (problem) { results.push({ item: name, harness: tool, outcome: 'held', message: problem }); continue; }
      writes++;
      if (here) replaced.push({ tool, hash: here.hash });
      results.push({ item: name, harness: tool, outcome: 'written', message: `${here ? `Now has ${harnesses[source.tool].name}'s version.` : 'Added.'} ${harnesses[tool].name === 'Codex' ? 'Start a new Codex session to use it.' : 'Start a new session to use it.'}` });
    }
    // An edit that spread is History, with what it replaced kept (CON-02); a first copy into a tool is not.
    if (edited.length && replaced.length) {
      const id = event({ key: `mcp:${name}`, item: name, kind: competing ? 'conflict' : 'edit', winner: { tool: source.tool, hash: source.hash }, losers: replaced, orderProved: !competing, previous: item.hash || undefined });
      notices.push({ key: `mcp:${name}`, item: name, kind: competing ? 'conflict' : 'edit', winner: source.tool, losers: competing ? edited.filter(entry => entry.hash !== source.hash).map(entry => entry.tool) : replaced.map(entry => entry.tool), orderProved: !competing, history: id });
    }
    // Every copy is recorded with what it holds now; one not written (Claude waiting, a refusal) keeps its own content.
    const after = await gatherAll(context, syncing);
    item.hash = source.hash;
    item.copies = syncing.filter(tool => after.byName.get(name)?.[tool]).map(tool => ({ tool, hash: after.byName.get(name)![tool]!.hash }));
  }
  await saveMcpRecord(context.home, record);
  await appendHistory(context, events);
  return { results, writes, notices };
}

/** The version an MCP event's Undo or Restore puts back. */
function restorable(past: HistoryEvent): string | undefined {
  if (past.kind === 'deleted' || past.kind === 'edit' || past.kind === 'restored') return past.previous;
  if (past.kind === 'conflict') return past.losers.find(loser => loser.hash !== past.previous && loser.hash !== past.winner?.hash)?.hash ?? past.previous;
  return undefined;
}

/**
 * Undo or Restore of an MCP event: the kept version becomes the managed baseline and is written to every tool it syncs to.
 * Claude Code gets it through Write now, as always (MCP-02).
 */
export async function restoreMcp(context: ShareContext, tools: HarnessId[], eventId: string): Promise<McpResult> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason, results: [], writes: 0 };
  const history = await readHistory(context.home);
  const past = history.find(entry => entry.id === eventId);
  const name = past?.key.replace(/^mcp:/, '');
  const hash = past && restorable(past);
  if (!past || !name || !hash) return { stopped: 'That change can’t be restored.', results: [], writes: 0 };
  if (past.undoneBy) return { stopped: 'That change was already undone.', results: [], writes: 0 };
  const server = await kept(context, name, hash);
  if (!server) return { stopped: 'The kept version is no longer in Central Knot’s store, so it can’t be restored.', results: [], writes: 0 };
  const record = await readMcpRecord(context.home);
  const item: McpRecordItem = record.items[name] ?? { state: 'shared', off: [], hash: '', copies: [] };
  const present = tools.filter(tool => mcpTools.includes(tool));
  const { byName } = await gatherAll(context, present);
  const slot = byName.get(name) ?? {};
  // A server deleted earlier whose name is in use again with other settings: never overwrite the new one.
  if (item.state !== 'shared' && Object.values(slot).some(entry => entry && entry.hash !== hash)) return { stopped: `A different “${name}” is set up now. Remove or rename it, then restore.`, results: [], writes: 0 };
  if (past.kind !== 'deleted' && item.state !== 'shared') return { stopped: `${name} was deleted since. Restore the deletion instead.`, results: [], writes: 0 };
  const results: DestinationResult[] = [];
  let writes = 0;
  const before = item.state === 'shared' ? item.hash : undefined;
  const replaced: { tool: HarnessId; hash: string }[] = [];
  for (const tool of present.filter(candidate => !item.off.includes(candidate))) {
    const here = slot[tool];
    if (here?.hash === hash) continue;
    const reason = cannotHold(tool, server);
    if (reason) { results.push({ item: name, harness: tool, outcome: 'held', message: reason }); continue; }
    if (tool === 'claude-cli') { results.push({ item: name, harness: tool, outcome: 'held', message: 'Close Claude, then use Write now to restore it there.' }); continue; }
    if (here) await keep(context, name, here.server);
    const problem = await editEntry(context, tool, name, here?.hash, server, here?.extras);
    if (problem) { results.push({ item: name, harness: tool, outcome: 'held', message: problem }); continue; }
    writes++;
    if (here) replaced.push({ tool, hash: here.hash });
    results.push({ item: name, harness: tool, outcome: 'written', message: 'Restored.' });
  }
  const after = await gatherAll(context, present);
  item.state = 'shared';
  item.hash = hash;
  delete item.deleted;
  item.copies = present.filter(tool => after.byName.get(name)?.[tool]).map(tool => ({ tool, hash: after.byName.get(name)![tool]!.hash }));
  record.items[name] = item;
  await saveMcpRecord(context.home, record);
  const id = randomUUID();
  past.undoneBy = id;
  await replaceHistory(context, [...history, { id, at: new Date().toISOString(), key: past.key, item: name, kind: 'restored', winner: { tool: replaced[0]?.tool ?? 'copilot-cli', hash }, losers: replaced, orderProved: true, previous: before }]);
  return { results, writes };
}
