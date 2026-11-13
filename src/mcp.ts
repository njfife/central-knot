// MCP servers in each tool's own format: one tool's entries read into one shape (NeutralServer, the part every tool holds the
// same way; the rest of an entry is that tool's own fields, `extras`), what a tool can't hold (cannotHold), and one entry
// written or removed with every other byte of the settings file kept (editEntry, rereading and checking the file first, so a
// save made meanwhile is never lost). Nothing here decides anything: servers.ts is MCP servers on Central Knot's library (the
// servers' Kind), which reads and writes through this module; mcpswitch.ts is each tool's own switch for a server.
import { record, withoutBom } from './values.ts';
import { lstat, readFile, readlink, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { configRoot, harnesses, openCodeSettings } from './harnesses.ts';
import { errorCode, recoverParked, sha256, writeFileChecked, type ShareContext } from './share.ts';
import { readJsonc, readTomlTables, setJsonMember, setTomlTable, tomlHeader, tomlValue, type TomlValue } from './textedit.ts';
import type { HarnessId } from './types.ts';

// ---------- Shapes ----------

/** The fields every tool can hold the same way (CD §5, Representable). Anything else is a tool's own and stays where it is. */
export interface NeutralServer { transport: 'stdio' | 'http' | 'sse'; command?: string; args?: string[]; env?: Record<string, string>; cwd?: string; url?: string; headers?: Record<string, string> }

export interface McpEntry {
  name: string;
  tool: HarnessId;
  file: string;
  server: NeutralServer;
  /**
   * The tool's own fields for this server, kept when Central Knot rewrites it there. JSON values, or TOML lines: in Codex also
   * each own subtable (keyed `[sub]`) and each comment line among the table's own lines (keyed `#1`, `#2`…), in their order.
   */
  extras: Record<string, unknown>;
  /** Where OpenCode holds it (`mcp.<name>`, or `mcp.servers.<name>`): its own switch differs between the two. */
  place?: string[];
  hash: string;
  /** Why this entry is never shared: it belongs to the app that wrote it, such as ChatGPT desktop. */
  hostBound?: string;
}

/**
 * A tool's own part of one server's entry: its name there as written (it may differ by case from another tool's), where
 * OpenCode had it, and its own fields and lines (`extras`), so Off then On gives the tool back its entry. Kept as text
 * (ownText) by serverstore.ts.
 */
export interface OwnPart { name: string; place?: string[]; extras: Record<string, unknown> }
export const ownText = (own: OwnPart) => JSON.stringify(own);

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
 * OpenCode's servers as its settings hold them: each name with its place there (a path of keys) and its entry as written.
 * `mcp.servers` is the newer line's holder of servers unless it is itself a server someone named "servers" (which has a
 * `type`). Throws when the text isn't a JSON object.
 */
function openCodeServers(text: string): { name: string; place: string[]; raw: unknown }[] {
  const settings = record(text.trim() ? readJsonc(text) : {});
  if (!settings || ('mcp' in settings && !record(settings.mcp))) throw new Error('mcp is not an object');
  const mcp = record(settings.mcp) ?? {};
  const held = record(mcp.servers);
  const holder = held && typeof held.type !== 'string' ? held : undefined;
  return [
    ...Object.entries(mcp).filter(([name]) => !(holder && name === 'servers')).map(([name, raw]) => ({ name, place: ['mcp', name], raw })),
    ...Object.entries(holder ?? {}).map(([name, raw]) => ({ name, place: ['mcp', 'servers', name], raw }))];
}

/** One server's place in OpenCode's settings and its entry as written; nothing when it has none. Throws when the text isn't a JSON object. */
export const openCodeServer = (text: string, name: string) => openCodeServers(text).findLast(server => server.name === name);

function fromOpenCode(name: string, file: string, raw: Record<string, unknown>, place: string[]): McpEntry {
  const remote = raw.type === 'remote' || (raw.type === undefined && typeof raw.url === 'string');
  const command = Array.isArray(raw.command) ? raw.command.map(String) : typeof raw.command === 'string' ? [raw.command] : [];
  const server: NeutralServer = remote
    ? { transport: 'http', url: typeof raw.url === 'string' ? raw.url : undefined, headers: nonEmpty(strings(raw.headers)) }
    : { transport: 'stdio', command: command[0], args: command.length > 1 ? command.slice(1) : undefined, env: nonEmpty(strings(raw.environment)), cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined };
  const extras = Object.fromEntries(Object.entries(raw).filter(([key]) => !['type', 'command', 'environment', 'cwd', 'url', 'headers'].includes(key)));
  return { name, tool: 'opencode-cli', file, server, extras, place, hash: serverHash(server), hostBound: hostBound(name, server) };
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
export async function readTool(context: ShareContext, tool: HarnessId): Promise<{ entries: McpEntry[]; problem?: string; exists: boolean; text?: string; /** Server names whose entry is there but is not a server (say, null), or is written in a form Central Knot does not edit: held, never read as absent or written. */ invalid?: string[] }> {
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
        const extras: Record<string, unknown> = {};
        // Its own lines in their order: each entry beyond the shared part, and each comment line among them (one after its last
        // entry sits above the next header, so it belongs to what follows). A comment at the end of a shared value's line is lost.
        let at = table.start, comments = 0;
        const last = table.entries.at(-1)?.end ?? table.start;
        for (const line of text.slice(table.start, last).split(/(?<=\n)/)) {
          const start = at, entry = table.entries.find(candidate => candidate.start === start);
          at += line.length;
          if (entry && !['command', 'args', 'env', 'cwd', 'url', 'http_headers'].includes(entry.keys[0])) extras[entry.key] = entry.raw;
          else if (/^\s*#/.test(line) && !table.entries.some(candidate => start > candidate.start && start < candidate.end)) extras[`#${++comments}`] = line;
        }
        // Codex's own subtables (env_http_headers, tool settings…) are this tool's: kept whole, as written, under their header.
        for (const sub of subtables.filter(candidate => candidate !== envTable && candidate !== headersTable)) extras[`[${sub.path.slice(2).join('.')}]`] = text.slice(sub.start, sub.end);
        if (!inline.has(name)) entries.push({ name, tool, file, server, extras, hash: serverHash(server), hostBound: hostBound(name, server) });
      }
      return { entries, exists: true, text, invalid: [...inline] };
    }
    const valid = (raw: unknown): raw is Record<string, unknown> => !!raw && typeof raw === 'object' && !Array.isArray(raw);
    if (tool === 'opencode-cli') {
      const servers = openCodeServers(text);
      // A name in both places is held: which one OpenCode uses was not measured.
      const held = (server: { name: string; raw: unknown }) => !valid(server.raw) || servers.filter(other => other.name === server.name).length > 1;
      return { entries: servers.filter(server => !held(server)).map(server => fromOpenCode(server.name, file, server.raw as Record<string, unknown>, server.place)),
        invalid: [...new Set(servers.filter(held).map(server => server.name))], exists: true, text };
    }
    const parsed = JSON.parse(withoutBom(text)) as { mcpServers?: unknown };
    // A servers member that is there but is not an object (null, a list) makes the file unreadable: never read as no servers.
    const servers = parsed && typeof parsed === 'object' && 'mcpServers' in parsed ? parsed.mcpServers : {};
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) throw new Error('mcpServers is not an object');
    const all = Object.entries(servers as Record<string, unknown>);
    return { entries: all.filter(([, raw]) => valid(raw)).map(([name, raw]) => fromJson(name, tool, file, raw as Record<string, unknown>)), invalid: all.filter(([, raw]) => !valid(raw)).map(([name]) => name), exists: true, text };
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

/**
 * The entry text for a destination: the neutral fields, plus that tool's own fields for this server as they were. `place`:
 * where OpenCode had it, for an entry it has no longer.
 */
export function writeEntry(text: string, tool: HarnessId, name: string, server: NeutralServer | undefined, extras: Record<string, unknown> = {}, place?: string[]): string {
  if (tool === 'codex-cli') {
    // A table taken from the file's end takes the blank line put before it, so Off then On leaves the file as it was.
    if (!server) return setTomlTable(text, ['mcp_servers'], name, undefined, { endGap: true });
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
    // An entry stays where it is, and one put back goes where it was; a new one goes under `mcp` itself, the place both lines
    // read and switch the same way.
    return setJsonMember(text, openCodeServer(text, name)?.place ?? place ?? ['mcp', name], server && openCodeEntry(server, extras));
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
 * if the file changed after this read, so a setting saved meanwhile (even an unrelated one) is never lost. Answers why nothing
 * was written, if it wasn't: `changed`, the entry or the file changed since it was read (the next read sees it).
 */
export async function editEntry(context: ShareContext, tool: HarnessId, name: string, expected: string | undefined, server: NeutralServer | undefined, extras?: Record<string, unknown>, place?: string[]): Promise<{ stopped: string; changed?: true } | undefined> {
  const file = mcpFile(context, tool);
  const now = await readTool(context, tool);
  if (now.problem) return { stopped: now.problem };
  const current = now.entries.find(entry => entry.name === name);
  if ((current?.hash ?? undefined) !== expected) return { stopped: `${harnesses[tool].name}'s entry for ${name} changed just now. Nothing was written; it is read again next time.`, changed: true };
  try { await writeFileChecked(file, writeEntry(now.text ?? '', tool, name, server, extras ?? current?.extras ?? {}, place), now.exists ? now.text : undefined); }
  catch (error) {
    if (errorCode(error) === 'CK_CHANGED' || errorCode(error) === 'CK_OCCUPIED') return { stopped: `${harnesses[tool].name}'s settings file changed just now. Nothing was written; it is read again next time.`, changed: true };
    // Any other failure (permissions, a full disk) stops this one write, never the rest of the pass.
    return { stopped: `Could not write ${harnesses[tool].name}'s settings file: ${error instanceof Error ? error.message : String(error)}` };
  }
  return undefined;
}

/** Crash recovery for a tool's settings file: its own folder, and the folder a linked file points into. */
export async function recoverSettings(context: ShareContext, tool: HarnessId) {
  const file = mcpFile(context, tool);
  await recoverParked(dirname(file));
  try { if ((await lstat(file)).isSymbolicLink()) await recoverParked(dirname(await realpath(file))); } catch { /* not there */ }
  // A link whose target was moved aside by a crash points at nothing: what it points at is still the right name to recover.
  try { const target = await readlink(file); await recoverParked(dirname(isAbsolute(target) ? target : join(dirname(file), target))); } catch { /* not a link */ }
}
