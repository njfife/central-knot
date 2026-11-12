// MCP servers across tools (MCP-01): read each tool's entries into one neutral shape, manage them like skills, and write each
// destination by editing only that server's entry (FIL-02). Claude Code's ~/.claude.json waits for an explicit Write now (MCP-02).
// The safety rules are the skills engine's: a file that is missing or unreadable is never read as deletions, every write rereads
// and checks the file and never overwrites a save made meanwhile, only this server's own recorded copies are ever removed, and every
// entry replaced or removed is kept whole per tool (its own settings too) so Restore puts it back as it was.
import { record, withoutBom } from './values.ts';
import { randomUUID } from 'node:crypto';
import { lstat, readFile, readlink, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { configRoot, harnesses, openCodeSettings } from './harnesses.ts';
import { mcpTools } from './presence.ts';
import { FORMAT_VERSION, newRecord, NOTHING_CHANGED, errorCode, readRecord, recoverParked, sha256, remember, saveRecord, storeDirectory, syncGate, writeAccess, writeDurably, writeFileChecked, type ShareContext } from './share.ts';
import { readJsonc, readTomlTables, setJsonMember, setTomlTable, tomlHeader, tomlValue, type TomlValue } from './textedit.ts';
import { appendHistory, readHistory, replaceHistory } from './history.ts';
import { undoChoice } from './choiceundo.ts';
import { mcpSwitchFacts, readMcpSwitches, setMcpDisabled } from './mcpswitch.ts';
import { throughPlugins } from './plugins.ts';
import { switchFailure } from './skillswitch.ts';
import { throughPlugin, toolName } from './words.ts';
import { ALREADY_AS_IT_WAS } from './types.ts';
import type { Change, DestinationResult, HarnessId, HistoryEvent, McpResult, McpView, SkillFacts, SwitchRecord, SyncNotice, ThroughPlugin, ToolCopy, ClaudeWrite } from './types.ts';
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

// ---------- Files ----------

const rootOf = (context: ShareContext, tool: HarnessId) => configRoot(harnesses[tool], context.home, context.overrides?.[tool]);

/** Where each tool keeps user-wide MCP servers. Claude Code's moves with CLAUDE_CONFIG_DIR. */
export function mcpFile(context: ShareContext, tool: HarnessId): string {
  switch (tool) {
    case 'claude-cli': return context.overrides?.[tool] ? join(context.overrides[tool]!, '.claude.json') : join(context.home, '.claude.json');
    case 'copilot-cli': return join(rootOf(context, tool), 'mcp-config.json');
    // Pi 1.5.0 reads ~/.pi/agent/mcp.json, in the same mcpServers shape as Claude's (CD §5, Appendix A).
    case 'pi-cli': return join(rootOf(context, tool), 'mcp.json');
    case 'codex-cli': return join(rootOf(context, tool), 'config.toml');
    case 'opencode-cli': return openCodeSettings(rootOf(context, tool));
  }
}

/** A value with object keys sorted (and undefined left out), so the same settings hash the same however they were written. */
export const canonical = (value: unknown): unknown => (Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([first], [second]) => first.localeCompare(second)).map(([key, item]) => [key, canonical(item)])) : value);
export const serverHash = (server: NeutralServer) => sha256(JSON.stringify(canonical(server)));

const strings = (value: unknown): Record<string, string> | undefined => (value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, String(item)])) : undefined);
const list = (value: unknown): string[] | undefined => (Array.isArray(value) ? value.map(String) : undefined);
const nonEmpty = <T extends object>(value: T | undefined) => (value && Object.keys(value).length ? value : undefined);

/** Belongs to the app that wrote it: ChatGPT desktop's own servers, or a command inside an app bundle. */
function hostBound(name: string, server: NeutralServer): string | undefined {
  if (name === 'node_repl') return 'ChatGPT desktop keeps this server for itself.';
  if ([server.command, server.cwd].some(path => path && /\/[^/]+\.app\//.test(path))) return 'It runs from inside an app, so it belongs to that app.';
  return undefined;
}

export function fromJson(name: string, tool: HarnessId, file: string, raw: Record<string, unknown>): McpEntry {
  const type = String(raw.type ?? (raw.url ? 'http' : 'stdio'));
  const server: NeutralServer = {
    transport: type === 'sse' ? 'sse' : type === 'http' || type === 'streamable-http' ? 'http' : 'stdio',
    command: typeof raw.command === 'string' ? raw.command : undefined, args: list(raw.args), env: nonEmpty(strings(raw.env)),
    cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined, url: typeof raw.url === 'string' ? raw.url : undefined, headers: nonEmpty(strings(raw.headers)),
  };
  const extras = Object.fromEntries(Object.entries(raw).filter(([key]) => !['type', 'command', 'args', 'env', 'cwd', 'url', 'headers'].includes(key)));
  return { name, tool, file, server, extras, hash: serverHash(server), hostBound: hostBound(name, server) };
}

// OpenCode keeps its servers under `mcp` in its settings file, in two places both of its lines read (measured on 1.19.5 and
// 2.2.5): `mcp.<name>`, and `mcp.servers.<name>`, which the newer line's own command writes. An entry is
// `{ type: "local", command: [program, ...arguments], environment, cwd }` or `{ type: "remote", url, headers }`.

/**
 * OpenCode's servers as its settings hold them: each name with its place there (a path of keys) and its entry as written,
 * and whether the settings have an `mcp` member at all. `mcp.servers` is the newer line's holder of servers unless it is
 * itself a server someone named "servers" (which has a `type`). Throws when the text isn't a JSON object.
 */
function openCodeServers(text: string): { section: boolean; servers: { name: string; place: string[]; raw: unknown }[] } {
  const settings = record(text.trim() ? readJsonc(text) : {});
  if (!settings || ('mcp' in settings && !record(settings.mcp))) throw new Error('mcp is not an object');
  const mcp = record(settings.mcp) ?? {};
  const held = record(mcp.servers);
  const holder = held && typeof held.type !== 'string' ? held : undefined;
  return { section: 'mcp' in settings, servers: [
    ...Object.entries(mcp).filter(([name]) => !(holder && name === 'servers')).map(([name, raw]) => ({ name, place: ['mcp', name], raw })),
    ...Object.entries(holder ?? {}).map(([name, raw]) => ({ name, place: ['mcp', 'servers', name], raw }))] };
}

/** One server's place in OpenCode's settings and its entry as written; nothing when it has none. Throws when the text isn't a JSON object. */
export const openCodeServer = (text: string, name: string) => openCodeServers(text).servers.findLast(server => server.name === name);

function fromOpenCode(name: string, file: string, raw: Record<string, unknown>): McpEntry {
  const remote = raw.type === 'remote' || (raw.type === undefined && typeof raw.url === 'string');
  const command = Array.isArray(raw.command) ? raw.command.map(String) : typeof raw.command === 'string' ? [raw.command] : [];
  const server: NeutralServer = remote
    ? { transport: 'http', url: typeof raw.url === 'string' ? raw.url : undefined, headers: nonEmpty(strings(raw.headers)) }
    : { transport: 'stdio', command: command[0], args: command.length > 1 ? command.slice(1) : undefined, env: nonEmpty(strings(raw.environment)), cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined };
  const extras = Object.fromEntries(Object.entries(raw).filter(([key]) => !['type', 'command', 'environment', 'cwd', 'url', 'headers'].includes(key)));
  return { name, tool: 'opencode-cli', file, server, extras, hash: serverHash(server), hostBound: hostBound(name, server) };
}

/** A server as OpenCode's settings hold it, with its own fields there kept. */
function openCodeEntry(server: NeutralServer, extras: Record<string, unknown>): Record<string, unknown> {
  const entry: Record<string, unknown> = server.transport === 'stdio'
    ? { type: 'local', command: [server.command, ...(server.args ?? [])], environment: server.env, cwd: server.cwd, ...extras }
    : { type: 'remote', url: server.url, headers: server.headers, ...extras };
  return Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined));
}

/**
 * Reads one tool's servers. A file that cannot be read gives a problem, never a guess. `text` is the file as read, so a write can
 * check nothing changed since.
 */
export async function readTool(context: ShareContext, tool: HarnessId): Promise<{ entries: McpEntry[]; problem?: string; exists: boolean; text?: string; /** Server names whose entry is there but is not a server (say, null), or is written in a form Central Knot does not edit: held, never read as absent or written. */ invalid?: string[]; /** Whether the file has a servers section at all: a file rewritten without one is a reset, not deletions. */ section?: boolean }> {
  const file = mcpFile(context, tool);
  let text: string;
  try { text = await readFile(file, 'utf8'); } catch (error) { return { entries: [], exists: false, problem: errorCode(error) === 'ENOENT' ? undefined : `${file} could not be read.` }; }
  try {
    if (tool === 'codex-cli') {
      // `[[…]]` blocks (Codex's `[[skills.config]]`) are never servers.
      const tables = readTomlTables(text).filter(table => !table.array);
      const entries: McpEntry[] = [];
      // Servers written inline (`[mcp_servers]` then `docs = { … }`) or as dotted keys (`mcp_servers.docs.command = …`): Central Knot
      // only edits `[mcp_servers.<name>]` tables, so these are held, and never get a second definition that Codex would refuse.
      const inline = new Set<string>();
      for (const table of tables) {
        for (const entry of table.entries) {
          const path = [...table.path, ...entry.keys];
          if (path[0] !== 'mcp_servers' || table.path.length >= 2) continue;
          // `mcp_servers = { docs = { … } }`: every server in it is inline.
          if (path.length === 1) { if (entry.value && typeof entry.value === 'object' && !Array.isArray(entry.value)) for (const name of Object.keys(entry.value)) inline.add(name); continue; }
          inline.add(path[1]);
        }
        // Other dotted keys inside a server's own table (beyond `env.X` and `http_headers.X`, which are read) are a form Central
        // Knot does not edit: the server is held.
        if (table.path.length === 2 && table.path[0] === 'mcp_servers' && table.entries.some(entry => entry.keys.length > 1 && !(entry.keys.length === 2 && ['env', 'http_headers'].includes(entry.keys[0])))) inline.add(table.path[1]);
      }
      for (const table of tables.filter(candidate => candidate.path.length === 2 && candidate.path[0] === 'mcp_servers')) {
        const name = table.path[1];
        const value = (key: string) => table.entries.find(entry => entry.key === key)?.value;
        const subtables = tables.filter(candidate => candidate.path.length >= 3 && candidate.path[0] === 'mcp_servers' && candidate.path[1] === name);
        const envTable = subtables.find(candidate => candidate.path.length === 3 && candidate.path[2] === 'env');
        const headersTable = subtables.find(candidate => candidate.path.length === 3 && candidate.path[2] === 'http_headers');
        // A map written as a table, inline, or as dotted keys in the server's own table (`env.REGION = "west"`) reads the same.
        const dotted = (key: string) => { const pairs = table.entries.filter(entry => entry.keys.length === 2 && entry.keys[0] === key).map(entry => [entry.keys[1], String(entry.value)]); return pairs.length ? Object.fromEntries(pairs) : undefined; };
        const env = envTable ? Object.fromEntries(envTable.entries.map(entry => [entry.key, String(entry.value)])) : strings(value('env')) ?? dotted('env');
        const headers = headersTable ? Object.fromEntries(headersTable.entries.map(entry => [entry.key, String(entry.value)])) : strings(value('http_headers')) ?? dotted('http_headers');
        const url = typeof value('url') === 'string' ? value('url') as string : undefined;
        const server: NeutralServer = {
          transport: url ? 'http' : 'stdio', command: typeof value('command') === 'string' ? value('command') as string : undefined, args: list(value('args')),
          env: nonEmpty(env), cwd: typeof value('cwd') === 'string' ? value('cwd') as string : undefined, url, headers: nonEmpty(headers),
        };
        const extras: Record<string, unknown> = Object.fromEntries(table.entries.filter(entry => !['command', 'args', 'env', 'cwd', 'url', 'http_headers'].includes(entry.keys[0])).map(entry => [entry.key, entry.raw]));
        // Codex's own subtables (env_http_headers, tool settings…) are this tool's: kept whole, as written, under their header.
        for (const sub of subtables.filter(candidate => candidate !== envTable && candidate !== headersTable)) extras[`[${sub.path.slice(2).join('.')}]`] = text.slice(sub.start, sub.end);
        if (!inline.has(name)) entries.push({ name, tool, file, server, extras, hash: serverHash(server), hostBound: hostBound(name, server) });
      }
      return { entries, exists: true, text, invalid: [...inline], section: tables.some(table => table.path[0] === 'mcp_servers') || inline.size > 0 };
    }
    const valid = (raw: unknown): raw is Record<string, unknown> => !!raw && typeof raw === 'object' && !Array.isArray(raw);
    if (tool === 'opencode-cli') {
      const { section, servers } = openCodeServers(text);
      // A name in both places is held: which one OpenCode uses was not measured.
      const held = (server: { name: string; raw: unknown }) => !valid(server.raw) || servers.filter(other => other.name === server.name).length > 1;
      return { entries: servers.filter(server => !held(server)).map(server => fromOpenCode(server.name, file, server.raw as Record<string, unknown>)),
        invalid: [...new Set(servers.filter(held).map(server => server.name))], exists: true, text, section };
    }
    const parsed = JSON.parse(withoutBom(text)) as { mcpServers?: unknown };
    const section = !!parsed && typeof parsed === 'object' && 'mcpServers' in parsed;
    // A servers member that is there but is not an object (null, a list) makes the file unreadable: never read as no servers.
    const servers = section ? parsed.mcpServers : {};
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) throw new Error('mcpServers is not an object');
    const all = Object.entries(servers as Record<string, unknown>);
    return { entries: all.filter(([, raw]) => valid(raw)).map(([name, raw]) => fromJson(name, tool, file, raw as Record<string, unknown>)), invalid: all.filter(([, raw]) => !valid(raw)).map(([name]) => name), exists: true, text, section };
  } catch {
    return { entries: [], exists: true, problem: `${file} could not be read as ${tool === 'codex-cli' ? 'TOML' : 'JSON'}, so its servers are not offered and it is never written.` };
  }
}

/** Why a tool cannot hold this server, if it cannot (CD §5, Unsupported). */
export function cannotHold(tool: HarnessId, server: NeutralServer): string | undefined {
  if ((tool === 'codex-cli' || tool === 'pi-cli' || tool === 'opencode-cli') && server.transport === 'sse') return `${harnesses[tool].name} has no SSE transport.`;
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
  if (tool === 'opencode-cli') {
    // An entry stays where it is; a new one goes under `mcp` itself, the place both lines read and switch the same way.
    const place = openCodeServer(text, name)?.place ?? ['mcp', name];
    return setJsonMember(text, place, server && openCodeEntry(server, extras));
  }
  if (!server) return setJsonMember(text, ['mcpServers', name], undefined);
  return setJsonMember(text, ['mcpServers', name], jsonEntry(tool, server, extras));
}

/** A server as a JSON tool writes it (Claude Code, Copilot CLI, Pi), with that tool's own fields kept. */
export function jsonEntry(tool: HarnessId, server: NeutralServer, extras: Record<string, unknown> = {}): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    type: tool === 'copilot-cli' && server.transport === 'stdio' ? 'local' : server.transport,
    command: server.command, args: server.args, env: server.env, cwd: server.cwd, url: server.url, headers: server.headers, ...extras,
  };
  // Copilot offers every tool of a server only when told to (CD §5): a new entry gets its documented default.
  if (tool === 'copilot-cli' && entry.tools === undefined) entry.tools = ['*'];
  return Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined));
}

/**
 * Rereads the file, checks the entry is still what was decided on, then edits only that entry (FIL-02). The write itself refuses
 * if the file changed after this read, so a setting saved meanwhile (even an unrelated one) is never lost.
 */
export async function editEntry(context: ShareContext, tool: HarnessId, name: string, expected: string | undefined, server: NeutralServer | undefined, extras?: Record<string, unknown>): Promise<string | undefined> {
  const file = mcpFile(context, tool);
  const now = await readTool(context, tool);
  if (now.problem) return now.problem;
  const current = now.entries.find(entry => entry.name === name);
  if ((current?.hash ?? undefined) !== expected) return `${harnesses[tool].name}'s entry for ${name} changed just now. Nothing was written; it is read again next time.`;
  try { await writeFileChecked(file, writeEntry(now.text ?? '', tool, name, server, extras ?? current?.extras ?? {}), now.exists ? now.text : undefined); }
  catch (error) {
    if (errorCode(error) === 'CK_CHANGED' || errorCode(error) === 'CK_OCCUPIED') return `${harnesses[tool].name}'s settings file changed just now. Nothing was written; it is read again next time.`;
    // Any other failure (permissions, a full disk) stops this one write, never the rest of the pass.
    return `Could not write ${harnesses[tool].name}'s settings file: ${error instanceof Error ? error.message : String(error)}`;
  }
  return undefined;
}

/** Crash recovery for a tool's settings file: its own folder, and the folder a linked file points into. */
async function recoverSettings(context: ShareContext, tool: HarnessId) {
  const file = mcpFile(context, tool);
  await recoverParked(dirname(file));
  try { if ((await lstat(file)).isSymbolicLink()) await recoverParked(dirname(await realpath(file))); } catch { /* not there */ }
  // A link whose target was moved aside by a crash points at nothing: what it points at is still the right name to recover.
  try { const target = await readlink(file); await recoverParked(dirname(isAbsolute(target) ? target : join(dirname(file), target))); } catch { /* not a link */ }
}

// ---------- Kept versions (CON-02) ----------

/**
 * Every server version Central Knot replaces or removes is kept first: the neutral server, and each tool's own entry with its own
 * settings (a Codex `enabled = false`, a timeout), so Restore puts each tool's entry back as it was. Never pruned.
 */
const keptBase = (context: ShareContext, name: string) => join(storeDirectory(context.home), 'items', 'mcp', encodeURIComponent(name));
export async function keep(context: ShareContext, name: string, server: NeutralServer, entry?: McpEntry): Promise<string | undefined> {
  const hash = serverHash(server);
  const path = join(keptBase(context, name), `${hash}.json`);
  try { await stat(path); } catch { await writeDurably(path, `${JSON.stringify(server, null, 2)}\n`); }
  if (!entry) return undefined;
  const text = `${JSON.stringify({ extras: entry.extras }, null, 2)}\n`;
  // The latest settings for this version, and an unchanging copy History can name, so a later version never overwrites an older one.
  const ref = `${entry.tool}-${sha256(text).slice(0, 16)}`;
  const latest = join(keptBase(context, name), hash, `${entry.tool}.json`);
  if ((await readFile(latest, 'utf8').catch(() => undefined)) !== text) await writeDurably(latest, text);
  try { await stat(join(keptBase(context, name), hash, `${ref}.json`)); } catch { await writeDurably(join(keptBase(context, name), hash, `${ref}.json`), text); }
  return ref;
}
async function keptExtras(context: ShareContext, name: string, hash: string, ref: string): Promise<Record<string, unknown> | undefined> {
  try { return JSON.parse(await readFile(join(keptBase(context, name), hash, `${ref}.json`), 'utf8')).extras; } catch { return undefined; }
}
export async function kept(context: ShareContext, name: string, hash: string): Promise<{ server: NeutralServer; extras: Partial<Record<HarnessId, Record<string, unknown>>> } | undefined> {
  try {
    const server = JSON.parse(await readFile(join(keptBase(context, name), `${hash}.json`), 'utf8'));
    const extras: Partial<Record<HarnessId, Record<string, unknown>>> = {};
    for (const tool of mcpTools) { try { extras[tool] = JSON.parse(await readFile(join(keptBase(context, name), hash, `${tool}.json`), 'utf8')).extras; } catch { /* not kept for this tool */ } }
    return { server, extras };
  } catch { return undefined; }
}

// ---------- Record ----------

const recordPath = (home: string) => join(storeDirectory(home), 'mcp.json');
const MCP_FORMAT_VERSION = 1;
const validMcpItems = (items: unknown) => !!items && typeof items === 'object' && !Array.isArray(items)
  && Object.values(items as Record<string, Partial<McpRecordItem> | null>).every(item => !!item && typeof item === 'object' && typeof item.state === 'string' && Array.isArray(item.off) && Array.isArray(item.copies));
/** Missing is a first run. Unreadable, damaged or newer stops every write, as sync.json does; the file is never touched. */
async function inspectMcpRecord(home: string): Promise<{ record?: McpRecord; problem?: string }> {
  let text: string;
  try { text = await readFile(recordPath(home), 'utf8'); }
  catch (error) { return errorCode(error) === 'ENOENT' ? {} : { problem: `The MCP record could not be read. ${NOTHING_CHANGED}` }; }
  const damaged = { problem: `The MCP record is damaged. ${NOTHING_CHANGED}` };
  try {
    const record = JSON.parse(text) as McpRecord | null;
    const version = record?.formatVersion;
    if (!Number.isInteger(version) || version! < 1) return damaged;
    if (version! > MCP_FORMAT_VERSION) return { problem: `The MCP record was written by a newer Central Knot. ${NOTHING_CHANGED}` };
    return validMcpItems(record?.items) ? { record: record! } : damaged;
  } catch { return damaged; }
}
export async function readMcpRecord(home: string): Promise<McpRecord> {
  return (await inspectMcpRecord(home)).record ?? { formatVersion: MCP_FORMAT_VERSION, items: {} };
}
const saveMcpRecord = (home: string, record: McpRecord) => writeDurably(recordPath(home), `${JSON.stringify(record, null, 2)}\n`);

/** Forgets the recorded copies in tools no longer managed (toolchoice.ts). A damaged record is left as it is: it stops MCP sync anyway. */
export async function forgetMcpCopies(home: string, managed: readonly HarnessId[]) {
  const { record } = await inspectMcpRecord(home);
  if (!record) return;
  for (const item of Object.values(record.items)) item.copies = item.copies.filter(copy => managed.includes(copy.tool));
  await saveMcpRecord(home, record);
}

// ---------- View ----------

const summary = (server: NeutralServer) => (server.transport === 'stdio' ? `Command · ${[server.command, ...(server.args ?? [])].filter(Boolean).join(' ')}` : `${server.transport.toUpperCase()} · ${server.url ?? ''}`);

async function gatherAll(context: ShareContext, tools: HarnessId[]) {
  const byName = new Map<string, Partial<Record<HarnessId, McpEntry>>>();
  const problems: string[] = [];
  const unreadable = new Set<HarnessId>();
  const missingFiles = new Set<HarnessId>();
  const invalid = new Map<string, HarnessId[]>();
  const noSection = new Set<HarnessId>();
  for (const tool of tools) {
    const read = await readTool(context, tool);
    if (read.problem) { problems.push(read.problem); unreadable.add(tool); }
    for (const name of read.invalid ?? []) { invalid.set(name, [...(invalid.get(name) ?? []), tool]); problems.push(`${mcpFile(context, tool)}: “${name}” is not written as a server table Central Knot can edit, so it is left alone.`); }
    if (read.exists && !read.problem && !read.section) noSection.add(tool);
    if (!read.exists) missingFiles.add(tool);
    for (const entry of read.entries) { const slot = byName.get(entry.name) ?? {}; slot[tool] = entry; byName.set(entry.name, slot); }
  }
  return { byName, problems, unreadable, missingFiles, invalid, noSection };
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

/**
 * MCP servers no tool has a copy of any more that History can still put back: for each, its latest deletion or removal, while
 * that is not undone. They show switched Off until History lets them go. `keyOf` reads an event's server name (undefined:
 * another kind's event); `here` are the names some tool has now.
 */
function goneFacts(events: HistoryEvent[], here: Set<string>, keyOf: (event: HistoryEvent) => string | undefined): SkillFacts[] {
  const removals = new Map<string, HistoryEvent[]>();
  for (const event of events) {
    const key = keyOf(event);
    if (key !== undefined && !here.has(key) && (event.kind === 'deleted' || event.kind === 'removed')) removals.set(key, [...(removals.get(key) ?? []), event]);
  }
  return [...removals].filter(([, list]) => !list.at(-1)!.undoneBy).map(([key, list]) => {
    const latest = list.at(-1)!;
    // A deletion puts it back in every tool it synced to. A removal puts it back where it took it from; each other tool's own
    // latest removal, still open, puts that tool's copy back too.
    const covered = new Set(latest.losers.map(loser => loser.tool));
    const also: string[] = [];
    if (latest.kind === 'removed') for (const older of list.slice(0, -1).reverse()) {
      if (older.kind !== 'removed') break;
      const more = older.losers.some(loser => !covered.has(loser.tool));
      for (const loser of older.losers) covered.add(loser.tool);
      if (more && !older.undoneBy) also.push(older.id);
    }
    return { key, name: latest.item, description: '', copies: {}, managed: false, off: [], cannot: {}, choiceBlocks: {},
      gone: { history: latest.id, at: latest.at, kind: latest.kind as 'deleted' | 'removed', ...(also.length ? { also } : {}) } };
  });
}

/**
 * The servers each tool has through its installed plugins, by name: such a tool gets no entry of its own beside the
 * plugin's. Only a server Central Knot installed elsewhere as that plugin's part counts: a name alone could be another server.
 */
async function serversThroughPlugins(context: ShareContext, tools: HarnessId[]): Promise<Map<HarnessId, Map<string, ThroughPlugin>>> {
  const all = await throughPlugins(context, tools, 'mcp', name => name);
  return new Map([...all].map(([tool, given]) => [tool, new Map([...given].flatMap(([name, { asParts, text: _text, ...plugin }]) => (asParts ? [[name, plugin] as const] : [])))]));
}

export async function mcpView(context: ShareContext, tools: HarnessId[], notices: SyncNotice[] = []): Promise<McpView> {
  const present = tools.filter(tool => mcpTools.includes(tool));
  const { byName, problems } = await gatherAll(context, present);
  const { record = { formatVersion: MCP_FORMAT_VERSION, items: {} }, problem } = await inspectMcpRecord(context.home);
  if (problem) problems.unshift(problem);
  const servers: SkillFacts[] = [];
  const claudePending: string[] = [];
  // Each tool's own switch (profiles turn servers off with it): read once, then asked about every server there.
  const switches = await readMcpSwitches(context, present);
  const through = await serversThroughPlugins(context, present);
  for (const [name, slot] of [...byName].sort(([first], [second]) => first.localeCompare(second))) {
    const item = record.items[name];
    const entries = Object.values(slot) as McpEntry[];
    const held = entries.find(entry => entry.hostBound)?.hostBound;
    const copies: Partial<Record<HarnessId, ToolCopy>> = {};
    for (const entry of entries) copies[entry.tool] = { hash: entry.hash, directory: entry.file, rootLabel: harnesses[entry.tool].name, lines: 0, modified: new Date().toISOString(), summary: summary(entry.server), writable: !entry.hostBound, folder: name };
    const cannot: Partial<Record<HarnessId, string>> = {};
    // The definition shown is the synced one: a copy still waiting (Claude Code's older entry) is not what the server now is.
    const sample = (entries.find(entry => item?.state === 'shared' && entry.hash === item.hash) ?? entries[0]).server;
    for (const tool of present) { if (!slot[tool]) { const reason = cannotHold(tool, sample); if (reason) cannot[tool] = reason; } }
    // A tool that has the server through one of its plugins is shown as that, and gets no entry of its own.
    const plugin: Partial<Record<HarnessId, ThroughPlugin>> = {};
    for (const tool of present) { const given = slot[tool] ? undefined : through.get(tool)?.get(name); if (given) { plugin[tool] = given; cannot[tool] = throughPlugin(tool, given, 'MCP server'); } }
    if (claudeWaits(item, slot, present)) claudePending.push(name);
    // Edits waiting to spread, as skills and agents mark them: a recorded copy now holding other content.
    const edited = item?.state === 'shared' ? item.copies.filter(copy => !copy.status && slot[copy.tool] && slot[copy.tool]!.hash !== copy.hash).map(copy => copy.tool) : [];
    servers.push({ key: name, name, description: summary(sample), copies, managed: item?.state === 'shared', off: item?.off ?? [], cannot, ...(Object.keys(plugin).length ? { plugin } : {}), held, separate: item?.separate, choiceBlocks: {},
      edited: edited.length ? edited : undefined, ...mcpSwitchFacts(name, entries.map(entry => entry.tool), switches) });
  }
  const gone = goneFacts(await readHistory(context), new Set(byName.keys()), event => (event.key.startsWith('mcp:') ? event.key.slice('mcp:'.length) : undefined));
  return { tools: present, servers, gone, claudePending, access: await writeAccess(context), gate: problem ? { state: 'stopped', reason: problem } : await syncGate(context), problems, notices };
}

// ---------- Apply ----------

/**
 * Records Managed choices, then brings each managed server into line: a copy where a tool lacks it, a one-sided edit spread,
 * a deletion spread once it holds. Claude Code is written only when `claudeNow` (Write now, Claude closed) names that server.
 * `decideNow`: servers whose missing copies count as deleted at once (a deletion the person asked for, as Pull's), never as a
 * reset; the rest keep the settle window.
 */
export async function applyMcp(context: ShareContext, tools: HarnessId[], changes: Change[], options: { claudeNow?: string[]; settleMs?: number; now?: number; only?: Set<string>; resume?: boolean; decideNow?: Set<string> } = {}): Promise<McpResult> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason, results: [], writes: 0 };
  const gate = await syncGate(context);
  if (gate.state === 'stopped' || (gate.state === 'needs-resume' && !options.resume)) return { stopped: gate.reason, results: [], writes: 0 };
  const recordProblem = (await inspectMcpRecord(context.home)).problem;
  if (recordProblem) return { stopped: recordProblem, results: [], writes: 0 };
  // The sync record is the one place ownership lives: make it now if this is the first thing Central Knot manages.
  let { record: owner } = await readRecord(context.home);
  if (!owner && !changes.length) return { results: [], writes: 0 };
  if (!owner) { owner = newRecord(context); await saveRecord(context.home, owner); }
  if (gate.state !== 'ready') await remember(context, owner.generation);

  const present = tools.filter(tool => mcpTools.includes(tool));
  const through = await serversThroughPlugins(context, present);
  // A write a crash interrupted is finished first, so a settings file moved aside is never read as missing (where a linked file points, too).
  for (const tool of present) await recoverSettings(context, tool);
  const { byName, unreadable, missingFiles, invalid, noSection } = await gatherAll(context, present);
  const record = await readMcpRecord(context.home);
  // A settings file that lost every server at once (rewritten without a servers section, or two or more managed servers all gone
  // together, as when a tool resets its file) is a reset: its servers are put back, never deleted everywhere.
  const resetTools = new Set<HarnessId>();
  for (const tool of present) {
    if (missingFiles.has(tool) || unreadable.has(tool)) continue;
    const held = Object.entries(record.items).filter(([, item]) => item.state === 'shared' && !item.off.includes(tool) && item.copies.some(copy => copy.tool === tool && !copy.status && !copy.away));
    // A server the person just removed (decideNow) is a deletion, even when it was the file's last one.
    const gone = held.filter(([name]) => !byName.get(name)?.[tool] && !options.decideNow?.has(name));
    if (gone.length && (noSection.has(tool) || (held.length >= 2 && gone.length === held.length))) resetTools.add(tool);
  }
  const results: DestinationResult[] = [];
  const events: HistoryEvent[] = [];
  const notices: SyncNotice[] = [];
  const event = (fields: Omit<HistoryEvent, 'id' | 'at'>) => { const made: HistoryEvent = { id: randomUUID(), at: new Date().toISOString(), ...fields }; events.push(made); return made.id; };
  // The events the asked changes made, for their Undo: never what sync did alongside.
  const made: string[] = [];
  for (const tool of resetTools) notices.push({ key: '', item: '', kind: 'reset', winner: tool, losers: [], orderProved: true, history: '' });
  let writes = 0;
  let settling = false;
  const claudeNow = (name: string) => !!options.claudeNow?.includes(name);
  // Entries displaced by an earlier pass that stopped before History named them: named this pass.
  const carried = Object.entries(record.items).flatMap(([name, item]) => (item.displaced ?? []).map(entry => ({ name, ...entry })));
  const displace = async (item: McpRecordItem, tool: HarnessId, hash: string) => { (item.displaced ??= []).push({ tool, hash }); await saveMcpRecord(context.home, record); };
  const undisplace = (item: McpRecordItem, tool: HarnessId, hash: string) => { if (!item.displaced) return; item.displaced = item.displaced.filter(entry => !(entry.tool === tool && entry.hash === hash)); if (!item.displaced.length) delete item.displaced; };
  // Servers whose copy the person chose in this pass: the chosen copy replaces the others. With each, the content it synced
  // before (undefined: it wasn't synced then) and its copies on record before.
  const chosenNow = new Map<string, { synced?: string; copies: McpCopy[] }>();
  // Servers this pass makes synced: the entries it adds for them are told in History as 'added', so Undo can take them back.
  const newlyManaged = new Set<string>();
  // Synced servers that sync to tools again (left out before): the entries written there are 'added' too, marked rejoined.
  const rejoined = new Map<string, HarnessId[]>();
  const claudeWritten: ClaudeWrite[] = [];
  // Changes taken (not refused): the only ones whose Disable and Enable are carried out, after the sync below.
  const taken: Change[] = [];
  for (const change of changes) {
    const slot = byName.get(change.key);
    if (!slot) continue;
    // A choice of a copy that changed after the page showed it is refused: what replaces the others is only ever what was seen.
    if (change.use && change.use !== 'separate' && change.useHash && slot[change.use]?.hash !== change.useHash) { results.push({ item: change.key, outcome: 'held', unchanged: true, message: `The copy you chose changed since you chose it. Nothing was changed; choose again.`, chooseAgain: true }); continue; }
    // A change made from an older read of the page is refused when the server changed since (a deletion spread meanwhile).
    if (change.seenManaged !== undefined && (record.items[change.key]?.state === 'shared') !== change.seenManaged) { results.push({ item: change.key, outcome: 'held', unchanged: true, message: `${change.key} changed since the page was read${record.items[change.key]?.deleted ? ' (it was deleted)' : ''}. Nothing was changed; read again.` }); continue; }
    const item: McpRecordItem = record.items[change.key] ?? { state: 'dont-share', off: [], hash: '', copies: [] };
    const syncedBefore = item.state === 'shared' ? item.hash : undefined;
    if (change.managed && change.use !== 'separate' && item.state !== 'shared') newlyManaged.add(change.key);
    else if (change.managed && change.use !== 'separate') rejoined.set(change.key, item.off.filter(tool => !change.off.includes(tool)));
    item.state = change.managed && change.use !== 'separate' ? 'shared' : 'dont-share';
    item.off = change.off;
    item.separate = change.use === 'separate' ? true : undefined;
    if (item.state !== 'shared') item.copies = item.copies.filter(copy => copy.status === 'removing');
    else delete item.deleted;
    if (change.use && change.use !== 'separate' && slot[change.use]) { chosenNow.set(change.key, { synced: syncedBefore, copies: item.copies }); item.hash = slot[change.use]!.hash; item.copies = item.copies.filter(copy => copy.status === 'removing'); }
    record.items[change.key] = item;
    taken.push(change);
  }
  const now = options.now ?? Date.now();
  for (const [name, item] of Object.entries(record.items)) {
    // With Sync off, a click writes exactly the servers it is about (SYN-03).
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
    item.copies = item.copies.filter(copy => copy.status || away(copy.tool) || !(copy.away || resetTools.has(copy.tool)) || !!slot[copy.tool]);
    for (const copy of item.copies) if (!copy.status) { if (away(copy.tool)) copy.away = true; else delete copy.away; }
    const live = syncing.filter(tool => !away(tool));
    const entries = live.map(tool => slot[tool]).filter((entry): entry is McpEntry => !!entry);
    if (entries.some(entry => entry.hostBound)) { results.push({ item: name, outcome: 'held', message: entries.find(entry => entry.hostBound)!.hostBound! }); continue; }
    const recordedCopies = item.copies.filter(copy => !copy.status);
    const recorded = new Map(recordedCopies.map(copy => [copy.tool, copy.hash]));
    // Each synced copy's own settings are kept as they are now (written only when they changed), so if that copy is deleted
    // there, Restore puts it back with its settings: a server that was off comes back off (DEL-03).
    for (const entry of entries) if (recorded.get(entry.tool) === entry.hash) await keep(context, name, entry.server, entry);
    const edited = entries.filter(entry => recorded.has(entry.tool) && recorded.get(entry.tool) !== entry.hash);
    // Deletion: a recorded entry gone from a file that is there and can be read (DEL-01, settled), spread to the others (DEL-02).
    const missing = recordedCopies.filter(copy => live.includes(copy.tool) && !slot[copy.tool]);
    const missingSince = (item as McpRecordItem & { missingSince?: Record<string, number> }).missingSince ??= {};
    for (const copy of missing) missingSince[copy.tool] ??= now;
    for (const tool of Object.keys(missingSince) as HarnessId[]) if (!missing.some(copy => copy.tool === tool)) delete missingSince[tool];
    // With Sync off, a click writes only what it is about: this server's own pending edit or deletion waits for Sync (SYN-03).
    if (options.only && !chosenNow.has(name) && (edited.length || missing.length)) { results.push({ item: name, outcome: 'held', message: `An edit or deletion of ${name} is waiting for sync. Turn automatic sync on, or use Sync once.` }); continue; }
    let raced: HarnessId[] | undefined;
    if (missing.length) {
      if (missing.some(copy => now - missingSince[copy.tool] < (options.decideNow?.has(name) ? 0 : options.settleMs ?? 2000))) { settling = true; continue; }
      if (!edited.length) {
        const removed: HarnessId[] = [];
        const gone: { tool: HarnessId; hash: string; kept?: string }[] = [];
        const leftover: McpCopy[] = [];
        // Only this server's own recorded copies go; a different entry with this name that was never synced stays.
        for (const copy of recordedCopies) {
          if (missing.includes(copy)) continue;
          const entry = slot[copy.tool];
          if (away(copy.tool) || !live.includes(copy.tool)) { if (!item.off.includes(copy.tool)) leftover.push({ ...copy, status: 'removing' }); continue; }
          if (!entry) continue;
          const ref = await keep(context, name, entry.server, entry);
          gone.push({ tool: copy.tool, hash: entry.hash, kept: ref });
          if (copy.tool === 'claude-cli' && !claudeNow(name)) {
            leftover.push({ ...copy, status: 'removing' });
            results.push({ item: name, harness: copy.tool, outcome: 'held', waits: true, message: 'Deleted elsewhere. Close Claude, then click Write to Claude Code to remove it there.' });
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
        const id = event({ key: `mcp:${name}`, item: name, kind: 'deleted', winner: { tool: missing[0].tool, hash: item.hash }, losers: gone, orderProved: true, previous: item.hash });
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
    const order: HarnessId[] = ['copilot-cli', 'claude-cli', 'codex-cli', 'pi-cli', 'opencode-cli'];
    const source = [...edited].sort((first, second) => order.indexOf(first.tool) - order.indexOf(second.tool))[0]
      ?? entries.find(entry => entry.hash === item.hash) ?? (entries.length && new Set(entries.map(entry => entry.hash)).size === 1 ? entries[0] : undefined);
    if (!source) { results.push({ item: name, outcome: 'held', differs: true, message: 'Copies differ. Choose which copy to use.' }); continue; }
    // An unrecorded copy that differs, with no baseline to call it behind, is a same-name collision: it needs a choice.
    if (!chosenNow.has(name) && entries.some(entry => !recorded.has(entry.tool) && entry.hash !== source.hash && entry.hash !== item.hash)) { results.push({ item: name, outcome: 'held', differs: true, message: 'Copies differ. Choose which copy to use.' }); continue; }
    // An edit made to a copy that was behind (Claude Code waiting for Write now) competes with the newer content it never saw.
    const fromBehind = edited.some(entry => recorded.get(entry.tool) !== item.hash);
    const competing = (edited.length > 1 && new Set(edited.map(entry => entry.hash)).size > 1) || fromBehind;
    const replaced: { tool: HarnessId; hash: string; kept?: string }[] = [];
    // What each tool holds after this pass, as decided: never a later read, so an edit saved meanwhile is still an edit next time.
    const holds = new Map<HarnessId, string>();
    const written = new Set<HarnessId>();
    const addedHere: { tool: HarnessId; hash: string }[] = [];
    await keep(context, name, source.server, source);
    const claudeBefore = slot['claude-cli']?.hash ?? null;
    for (const tool of live) {
      const here = slot[tool];
      if (here?.hash === source.hash) { holds.set(tool, source.hash); continue; }
      const given = here ? undefined : through.get(tool)?.get(name);
      const reason = given ? throughPlugin(tool, given, 'MCP server') : cannotHold(tool, source.server);
      if (reason) { results.push({ item: name, harness: tool, outcome: 'held', message: reason }); continue; }
      if (tool === 'claude-cli' && !claudeNow(name)) { results.push({ item: name, harness: tool, outcome: 'held', waits: true, message: 'Close Claude, then click Write to Claude Code: Claude Code rewrites this file while it runs (MCP-02).' }); continue; }
      const ref = here ? await keep(context, name, here.server, here) : undefined;
      // Only content an event of this pass will name is put on record as displaced; a copy that is only behind (Claude Code
      // catching up through Write now) holds an older version that History already has.
      const named = edited.length > 0 || chosenNow.has(name) || !!raced;
      if (here && named) await displace(item, tool, here.hash);
      // The destination's own settings come from the file as reread just before writing, never from an older read.
      const problem = await editEntry(context, tool, name, here?.hash, source.server);
      if (problem) { if (here) undisplace(item, tool, here.hash); results.push({ item: name, harness: tool, outcome: 'held', message: problem }); continue; }
      writes++;
      written.add(tool);
      holds.set(tool, source.hash);
      if (here) replaced.push({ tool, hash: here.hash, kept: ref });
      else if (newlyManaged.has(name) || rejoined.get(name)?.includes(tool)) addedHere.push({ tool, hash: source.hash });
      if (tool === 'claude-cli') claudeWritten.push({ name, before: claudeBefore, after: source.hash });
      results.push({ item: name, harness: tool, outcome: 'written', replaced: here ? true : undefined, message: `${here ? `Now has ${harnesses[source.tool].name}'s version.` : 'Added.'} ${harnesses[tool].name === 'Codex' ? 'Start a new Codex session to use it.' : 'Start a new session to use it.'}` });
    }
    // A copy not written (Claude waiting, a refusal) keeps what was recorded for it, so a change there is still seen as one. A copy
    // replaced by this choice that could not be written yet is recorded as it is, so it reads as behind.
    for (const tool of live) {
      if (holds.has(tool) || !slot[tool]) continue;
      const before = recorded.get(tool) ?? (chosenNow.has(name) ? slot[tool]!.hash : undefined);
      if (before) holds.set(tool, before);
    }
    const key = `mcp:${name}`;
    const addedId = addedHere.length ? event({ key, item: name, kind: 'added', losers: addedHere, orderProved: true, previous: source.hash, ...(newlyManaged.has(name) ? {} : { rejoined: true }) }) : undefined;
    if (addedId) made.push(addedId);
    // A chosen copy that replaced others, an edit kept over a deletion, and an edit that spread are History, with what each replaced kept (CON-02).
    // A choice names the entries its own pass added (its Undo takes out those, never others), what it synced before, if it was
    // synced then, and the record before it of each tool it wrote or put on record as it is (Claude Code waiting for Write), which
    // its Undo puts back.
    const choice = chosenNow.get(name);
    if (choice && replaced.length) {
      const was = new Map(choice.copies.filter(copy => !copy.status).map(copy => [copy.tool, copy.hash]));
      const recordBefore = live.filter(tool => written.has(tool) || holds.get(tool) !== was.get(tool)).map(tool => (was.has(tool) ? { tool, hash: was.get(tool) } : { tool }));
      made.push(event({ key, item: name, kind: 'chosen', winner: { tool: source.tool, hash: source.hash }, losers: replaced, orderProved: true, previous: choice.synced || undefined,
        ...(choice.synced !== undefined ? { wasSynced: true } : {}), ...(addedId ? { addedId } : {}), ...(recordBefore.length ? { before: { record: recordBefore } } : {}) }));
    } else if (raced) {
      const id = event({ key, item: name, kind: 'kept-edit', winner: { tool: source.tool, hash: source.hash }, losers: [...raced.map(tool => ({ tool, hash: item.hash })), ...replaced], orderProved: false, previous: item.hash });
      notices.push({ key, item: name, kind: 'kept-edit', winner: source.tool, losers: raced, orderProved: false, history: id });
    } else if (edited.length && (replaced.length || (item.hash && item.hash !== source.hash))) {
      // An edit that changed the synced content is History even when no copy could be written yet (Claude Code waiting for Write
      // now): the version it replaces stays restorable after the catch-up overwrites it.
      const id = event({ key, item: name, kind: competing ? 'conflict' : 'edit', winner: { tool: source.tool, hash: source.hash }, losers: replaced, orderProved: !competing, previous: item.hash || undefined });
      if (replaced.length) notices.push({ key, item: name, kind: competing ? 'conflict' : 'edit', winner: source.tool, losers: competing ? edited.filter(entry => entry.hash !== source.hash).map(entry => entry.tool) : replaced.map(entry => entry.tool), orderProved: !competing, history: id });
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
      // The tool now uses another settings file (a moved config root): an entry there is not the one the deletion was owed for.
      if (copy.file && copy.file !== mcpFile(context, copy.tool)) { item.copies = item.copies.filter(other => other !== copy); continue; }
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
  // Disable and Enable, explicit only, after the sync above: an entry written just now can be turned off too. Each tool's own
  // switch, and only the tools the change names; one 'switched' event per server, for Undo.
  for (const change of taken) {
    const switched = await flipMcpSwitches(context, change.key, present, [...(change.disable ?? []).map(tool => [tool, true] as const), ...(change.enable ?? []).map(tool => [tool, false] as const)], results);
    if (switched.length) made.push(event({ key: `mcp:${change.key}`, item: change.key, kind: 'switched', switched, losers: [], orderProved: true }));
  }
  // Whether a History event holds this content of the server: as what it replaced, wrote or put back.
  const names = (past: HistoryEvent, name: string, hash: string) => past.key === `mcp:${name}` && (past.previous === hash || past.winner?.hash === hash || past.losers.some(loser => loser.hash === hash));
  const named = (name: string, hash: string) => events.some(made => names(made, name, hash));
  // Displaced entries no event of this pass names (left by a pass that stopped part-way) get their own History entry.
  for (const left of carried) {
    const item = record.items[left.name];
    if (!item || named(left.name, left.hash)) continue;
    event(item.state !== 'shared' && item.deleted
      ? { key: `mcp:${left.name}`, item: left.name, kind: 'deleted', winner: { tool: item.deleted.tool, hash: item.deleted.hash }, losers: [{ tool: left.tool, hash: left.hash }], orderProved: false, previous: item.deleted.hash }
      : { key: `mcp:${left.name}`, item: left.name, kind: 'edit', winner: { tool: left.tool, hash: item.hash }, losers: [{ tool: left.tool, hash: left.hash }], orderProved: false, previous: left.hash });
  }
  // Write to Claude Code that replaced an entry History doesn't hold (Claude Code's own, say) gets its own entry, that one kept.
  // Its Undo is Undo write's (undoClaudeWrite): the band's and History's are one.
  if (claudeWritten.some(write => write.before)) {
    const held = [...(await readHistory(context)), ...events].filter(past => !past.undoneBy);
    for (const write of claudeWritten) {
      if (!write.before || held.some(past => names(past, write.name, write.before!))) continue;
      write.event = event({ key: `mcp:${write.name}`, item: write.name, kind: 'written', winner: { tool: 'claude-cli', hash: write.after }, losers: [{ tool: 'claude-cli', hash: write.before }], orderProved: true, previous: write.before });
    }
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
  return { results, writes, notices, settling, made, claudeWritten: claudeWritten.length ? claudeWritten : undefined };
}

/**
 * Turns one server off or on in the tools named, each with its own switch (mcpswitch.ts). Says what happened in `results` and
 * returns the switches that changed: a tool that already had it that way is left out, so Undo flips back only what this did.
 */
async function flipMcpSwitches(context: ShareContext, name: string, present: HarnessId[], flips: (readonly [HarnessId, boolean])[], results: DestinationResult[]): Promise<SwitchRecord[]> {
  const switched: SwitchRecord[] = [];
  for (const [tool, disabled] of flips) {
    if (!present.includes(tool)) continue;
    try { if (!(await setMcpDisabled(context, tool, name, disabled))) continue; }
    catch (error) {
      results.push({ item: name, harness: tool, outcome: 'failed', message: `Could not ${disabled ? 'disable' : 'enable'} it in ${toolName(tool)}: ${switchFailure(error)}` });
      continue;
    }
    switched.push({ tool, disabled });
    results.push({ item: name, harness: tool, outcome: 'switched', disabled, message: disabled ? `Disabled in ${toolName(tool)}: its entry stays, and ${toolName(tool)} doesn’t start it from its next session.` : `Enabled again in ${toolName(tool)} from its next session.` });
  }
  return switched;
}

/**
 * Undo of a server's Disable or Enable: each switch the event changed goes back. A tool already back as it was needs nothing. A
 * new 'switched' event records what was flipped, and its own Undo flips it again.
 */
async function undoSwitchedMcp(context: ShareContext, history: HistoryEvent[], past: HistoryEvent): Promise<McpResult> {
  if (past.undoneBy) return { stopped: 'That change was already undone.', results: [], writes: 0 };
  const name = past.key.replace(/^mcp:/, '');
  const results: DestinationResult[] = [];
  const asked = past.switched ?? [];
  const back = await flipMcpSwitches(context, name, asked.map(entry => entry.tool), asked.map(entry => [entry.tool, !entry.disabled] as const), results);
  const failed = results.filter(result => result.outcome === 'failed');
  if (failed.length && !back.length) return { stopped: failed[0].message, results, writes: 0 };
  for (const entry of asked) {
    if (!results.some(result => result.harness === entry.tool)) results.push({ item: name, harness: entry.tool, outcome: 'stayed', message: `${toolName(entry.tool)} has it ${entry.disabled ? 'enabled' : 'disabled'} already.` });
  }
  // Done once nothing is left to retry. The new event exists only when something flipped, so "Undo again" always has one to use.
  const id = back.length ? randomUUID() : undefined;
  if (!failed.length) past.undoneBy = id ?? ALREADY_AS_IT_WAS;
  await replaceHistory(context, [...history, ...(id ? [{ id, at: new Date().toISOString(), key: past.key, item: name, kind: 'switched' as const, switched: back, losers: [], orderProved: true }] : [])]);
  return { results, writes: 0 };
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
 * Undo of Write to Claude Code, from its band or its History entry ('written'): each entry goes back to what Claude Code held before
 * (removed when it was new), and the server waits for Write again. All or nothing: an entry changed since, or undone already, stops
 * it. Claude Code must be closed, as for Write.
 */
export async function undoClaudeWrite(context: ShareContext, written: ClaudeWrite[]): Promise<McpResult> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason, results: [], writes: 0 };
  const { record = { formatVersion: MCP_FORMAT_VERSION, items: {} }, problem } = await inspectMcpRecord(context.home);
  if (problem) return { stopped: problem, results: [], writes: 0 };
  const entries = (await readTool(context, 'claude-cli')).entries;
  const history = await readHistory(context);
  for (const write of written) {
    if (write.event && history.find(past => past.id === write.event)?.undoneBy) return { stopped: 'That change was already undone.', results: [], writes: 0 };
    const entry = entries.find(candidate => candidate.name === write.name);
    if (!entry || entry.hash !== write.after) return { stopped: `Claude Code’s ${write.name} changed since it was written, so nothing was undone.`, results: [], writes: 0 };
    if (write.before && !(await kept(context, write.name, write.before))) return { stopped: `The earlier ${write.name} is no longer in Central Knot’s store, so it can’t be put back.`, results: [], writes: 0 };
  }
  const results: DestinationResult[] = [];
  const undone: ClaudeWrite[] = [];
  let writes = 0;
  for (const write of written) {
    const entry = entries.find(candidate => candidate.name === write.name)!;
    const earlier = write.before ? await kept(context, write.name, write.before) : undefined;
    const problem = await editEntry(context, 'claude-cli', write.name, entry.hash, earlier?.server);
    if (problem) { results.push({ item: write.name, harness: 'claude-cli', outcome: 'held', message: problem }); continue; }
    writes++;
    undone.push(write);
    const item = record.items[write.name];
    if (item) {
      const others = item.copies.filter(copy => copy.tool !== 'claude-cli');
      item.copies = write.before ? [...others, { tool: 'claude-cli', hash: write.before, file: mcpFile(context, 'claude-cli') }] : others;
    }
    results.push({ item: write.name, harness: 'claude-cli', outcome: write.before ? 'written' : 'removed', message: write.before ? 'Claude Code has its earlier entry again.' : 'Removed from Claude Code again.' });
  }
  await saveMcpRecord(context.home, record);
  const told = history.filter(past => undone.some(write => write.event === past.id));
  for (const past of told) past.undoneBy = randomUUID();
  if (told.length) await replaceHistory(context, history);
  return { results, writes };
}

/**
 * Undo of the entries a change added: each is removed again while it is exactly the entry written (an edit since keeps it). A server
 * the change made synced is not synced again, as before; one it synced to more tools (`rejoined`) stays synced, and leaves those
 * tools out again. An entry that had to stay keeps its tool syncing.
 */
async function undoAddedMcp(context: ShareContext, history: HistoryEvent[], past: HistoryEvent): Promise<McpResult> {
  if (past.undoneBy) return { stopped: 'That change was already undone.', results: [], writes: 0 };
  const name = past.key.replace(/^mcp:/, '');
  const record = await readMcpRecord(context.home);
  const item = record.items[name];
  if (!item || item.state !== 'shared') return { stopped: `${name} is not managed any more, so there is nothing to undo here.`, results: [], writes: 0 };
  const results: DestinationResult[] = [];
  const stayed: HarnessId[] = [];
  let writes = 0;
  for (const loser of past.losers) {
    const entry = (await readTool(context, loser.tool)).entries.find(candidate => candidate.name === name);
    if (!entry) { results.push({ item: name, harness: loser.tool, outcome: 'stayed', message: `${harnesses[loser.tool].name}'s entry is already gone.` }); continue; }
    if (entry.hash !== loser.hash) { stayed.push(loser.tool); results.push({ item: name, harness: loser.tool, outcome: 'held', message: `${harnesses[loser.tool].name}'s entry was edited since, so it stays.` }); continue; }
    await keep(context, name, entry.server, entry);
    const problem = await editEntry(context, loser.tool, name, entry.hash, undefined);
    if (problem) { stayed.push(loser.tool); results.push({ item: name, harness: loser.tool, outcome: 'held', message: problem }); continue; }
    item.copies = item.copies.filter(copy => copy.tool !== loser.tool);
    writes++;
    results.push({ item: name, harness: loser.tool, outcome: 'removed', message: 'Removed the entry it added.' });
  }
  if (!stayed.length && !past.rejoined) { item.state = 'dont-share'; item.copies = []; }
  else item.off = [...new Set([...item.off, ...past.losers.map(loser => loser.tool).filter(tool => !stayed.includes(tool))])];
  await saveMcpRecord(context.home, record);
  past.undoneBy = randomUUID();
  await replaceHistory(context, history);
  return { results, writes };
}

/**
 * Undo or Restore of an MCP event: the kept version becomes the managed baseline and is written to every tool it syncs to, each with
 * its own kept settings. Claude Code gets it through Write now, as always (MCP-02).
 */
export async function restoreMcp(context: ShareContext, tools: HarnessId[], eventId: string, choice?: string): Promise<McpResult> {
  const access = await writeAccess(context);
  if (!access.allowed) return { stopped: access.reason, results: [], writes: 0 };
  // Restore is a write like any other: never while another build owns syncing or the record needs a resume.
  const gate = await syncGate(context);
  if (gate.state === 'stopped' || gate.state === 'needs-resume') return { stopped: gate.reason, results: [], writes: 0 };
  const recordProblem = (await inspectMcpRecord(context.home)).problem;
  if (recordProblem) return { stopped: recordProblem, results: [], writes: 0 };
  const history = await readHistory(context);
  const past = history.find(entry => entry.id === eventId);
  if (past?.kind === 'added') return undoAddedMcp(context, history, past);
  if (past?.kind === 'switched') return undoSwitchedMcp(context, history, past);
  if (past?.kind === 'chosen' && choice === 'narrow') return undoChoiceMcp(context, tools, history, past);
  // Undo of a put-back from a deletion is that deletion again.
  const deletion = past?.kind === 'restored' && !past.undoneBy ? history.find(entry => entry.undoneBy === past.id && entry.kind === 'deleted') : undefined;
  if (past && deletion) return deleteAgainMcp(context, tools, history, past, deletion);
  const name = past?.key.replace(/^mcp:/, '');
  const hash = past && restorable(past);
  if (!past || !name || !hash) return { stopped: 'That change can’t be restored.', results: [], writes: 0 };
  if (past.undoneBy) return { stopped: 'That change was already undone.', results: [], writes: 0 };
  const version = await kept(context, name, hash);
  if (!version) return { stopped: 'The kept version is no longer in Central Knot’s store, so it can’t be restored.', results: [], writes: 0 };
  const record = await readMcpRecord(context.home);
  const item: McpRecordItem = record.items[name] ?? { state: 'shared', off: [], hash: '', copies: [] };
  const present = tools.filter(tool => mcpTools.includes(tool));
  const through = await serversThroughPlugins(context, present);
  for (const tool of present) await recoverSettings(context, tool);
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
    // This tool's own settings as the event replaced them, when it names them; a tool without an entry gets the latest kept ones;
    // otherwise its current settings stay.
    const ref = past.losers.find(loser => loser.tool === tool && loser.kept && loser.hash === hash)?.kept;
    const extras = ref ? await keptExtras(context, name, hash, ref) : here ? undefined : version.extras[tool];
    if (here?.hash === hash && (!extras || JSON.stringify(here.extras) === JSON.stringify(extras))) { holds.set(tool, hash); continue; }
    if (here) holds.set(tool, here.hash);
    const given = here ? undefined : through.get(tool)?.get(name);
    const reason = given ? throughPlugin(tool, given, 'MCP server') : cannotHold(tool, version.server);
    if (reason) { results.push({ item: name, harness: tool, outcome: 'held', message: reason }); continue; }
    if (tool === 'claude-cli') { results.push({ item: name, harness: tool, outcome: 'held', waits: true, message: 'Claude Code gets it when you click Write to Claude Code.' }); continue; }
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
  return { results, writes, made: [id] };
}

/** Each tool's entry for a server now, by tool. */
async function entriesNow(context: ShareContext, tools: HarnessId[], name: string): Promise<Map<HarnessId, McpEntry>> {
  const found = new Map<HarnessId, McpEntry>();
  for (const tool of tools) { const entry = (await readTool(context, tool)).entries.find(candidate => candidate.name === name); if (entry) found.set(tool, entry); }
  return found;
}

/**
 * Undo of a copy choice, right after it (choiceundo.ts, as for skills and agents): each replaced entry goes back in its own tool,
 * with its own settings as kept, the entries the choice's pass added go again, and the server is as it was before the choice.
 * A choice never writes Claude Code (only Write to Claude Code does), so its entry there is never one to put back; its record
 * there goes back to what it was before the choice.
 */
async function undoChoiceMcp(context: ShareContext, tools: HarnessId[], history: HistoryEvent[], chosen: HistoryEvent): Promise<McpResult> {
  const name = chosen.key.replace(/^mcp:/, '');
  const record = await readMcpRecord(context.home);
  const item = record.items[name];
  // Not synced any more, unless it is a choice whose Undo stopped part-way and is being finished.
  if (!item || (item.state !== 'shared' && !chosen.restoredTools)) return { stopped: `${name} is not synced any more, so there is nothing to undo here.`, results: [], writes: 0 };
  const present = tools.filter(tool => mcpTools.includes(tool));
  const now = await entriesNow(context, present, name);
  const own = (tool: HarnessId) => chosen.losers.find(loser => loser.tool === tool);
  return undoChoice(history, chosen, {
    name, noun: 'entry',
    wrote: tool => now.get(tool)?.hash === chosen.winner?.hash,
    cantPutBack: async (_tool, hash) => ((await kept(context, name, hash)) ? undefined : 'The replaced entry is no longer in Central Knot’s store, so it can’t be put back.'),
    addedAsIs: (tool, hash) => !now.get(tool) || now.get(tool)!.hash === hash,
    takeOutAdded: async added => {
      const results: DestinationResult[] = [];
      let writes = 0;
      for (const loser of added.losers) {
        const here = now.get(loser.tool);
        if (!here) continue;
        await keep(context, name, here.server, here);
        const problem = await editEntry(context, loser.tool, name, here.hash, undefined);
        if (problem) { results.push({ item: name, harness: loser.tool, outcome: 'failed', message: problem }); continue; }
        writes++;
        item.copies = item.copies.filter(copy => copy.tool !== loser.tool);
        // A tool synced to again by that pass is left out again, as it was.
        if (added.rejoined && !item.off.includes(loser.tool)) item.off = [...item.off, loser.tool];
        results.push({ item: name, harness: loser.tool, outcome: 'removed', message: 'Removed the entry it added.' });
      }
      return { results, writes };
    },
    putBack: async (tool, hash) => {
      const version = (await kept(context, name, hash))!;
      const ref = own(tool)?.kept;
      return editEntry(context, tool, name, chosen.winner!.hash, version.server, ref ? await keptExtras(context, name, hash, ref) : undefined);
    },
    nextStep: tool => (tool === 'codex-cli' ? 'Start a new Codex session to use it.' : 'Start a new session to use it.'),
    settle: async (synced, back) => {
      if (!synced) {
        item.state = 'dont-share';
        item.copies = item.copies.filter(copy => copy.status === 'removing');
      // Synced before, and still: one turned off since a part-way Undo is left as it is.
      } else if (item.state === 'shared') {
        // A Finish undo after the synced content moved on leaves it where the passes since took it.
        if (item.hash === chosen.winner?.hash) item.hash = synced;
        // Each tool the choice wrote or put on record as it is: its record as before the choice (none: off the record, so the next
        // pass holds for a choice). One whose own entry isn't back yet holds the chosen one: off the record until Finish undo puts
        // it back, so no pass reads it as an edit and spreads it over the entries put back. Every other tool's record the choice
        // left as it was.
        for (const { tool, hash } of chosen.before?.record ?? []) {
          item.copies = item.copies.filter(copy => copy.tool !== tool || copy.status);
          if (hash && (!own(tool) || back.has(tool))) item.copies.push({ tool, hash, file: mcpFile(context, tool) });
        }
      }
      await saveMcpRecord(context.home, record);
    },
    saveHistory: () => replaceHistory(context, history),
  });
}

/**
 * Undo of putting a deleted server back: the deletion again. Each tool's entry goes while it is the one put back (or one recorded
 * for it); one changed since stays. Claude Code's goes with Write to Claude Code, as any deletion's. A new 'deleted' entry tells
 * it, and puts it back again.
 */
async function deleteAgainMcp(context: ShareContext, tools: HarnessId[], history: HistoryEvent[], restored: HistoryEvent, deletion: HistoryEvent): Promise<McpResult> {
  const name = restored.key.replace(/^mcp:/, '');
  const record = await readMcpRecord(context.home);
  const item = record.items[name];
  if (!item || item.state !== 'shared') return { stopped: `${name} is not synced any more, so there is nothing to undo here.`, results: [], writes: 0 };
  const present = tools.filter(tool => mcpTools.includes(tool));
  const now = await entriesNow(context, present, name);
  const results: DestinationResult[] = [];
  const gone: { tool: HarnessId; hash: string; kept?: string }[] = [];
  const leftover: McpCopy[] = [];
  let writes = 0;
  for (const [tool, entry] of now) {
    if (entry.hash !== restored.winner?.hash && !item.copies.some(copy => copy.tool === tool && copy.hash === entry.hash)) { results.push({ item: name, harness: tool, outcome: 'held', message: `${toolName(tool)}’s ${name} was changed since, so it stays.` }); continue; }
    const ref = await keep(context, name, entry.server, entry);
    if (tool === 'claude-cli') {
      leftover.push({ tool, hash: entry.hash, file: mcpFile(context, tool), status: 'removing' });
      results.push({ item: name, harness: tool, outcome: 'held', waits: true, message: 'Claude Code’s entry goes when you click Write to Claude Code.' });
      continue;
    }
    const problem = await editEntry(context, tool, name, entry.hash, undefined);
    if (problem) { results.push({ item: name, harness: tool, outcome: 'held', message: problem }); continue; }
    writes++;
    gone.push({ tool, hash: entry.hash, kept: ref });
    results.push({ item: name, harness: tool, outcome: 'removed', message: 'Removed again.' });
  }
  const id = randomUUID();
  item.state = 'dont-share';
  item.deleted = { at: new Date().toISOString(), tool: deletion.winner?.tool ?? 'copilot-cli', hash: item.hash };
  item.copies = leftover;
  await saveMcpRecord(context.home, record);
  restored.undoneBy = id;
  await replaceHistory(context, [...history, { id, at: new Date().toISOString(), key: restored.key, item: name, kind: 'deleted', winner: deletion.winner, losers: gone, orderProved: true, previous: item.hash }]);
  return { results, writes, made: [id] };
}
