// The usage reading, in main: which skills, agents and MCP servers each tool's own session history shows were used, and
// when. It runs on a click (main.ts usage:read, DesktopApi.readUsage) and at no other time, outside main's queue: it reads
// nothing a pass writes and writes nothing at all. Nothing is stored either: the page keeps the answer in its own slot
// (app.ts state.usage) until the home changes or the app closes.
//
// `readers` is the one table, a row per tool: where its sessions are (under the same folders, moved by the same variables,
// as its other files: harnesses.ts), which kinds its records can tell (`tells`, the same table for the page: types.ts
// UsageTells), and which records are a use, with the name in the tool's own spelling. Only a call, or a skill the person
// typed, is a use: the lists of what was available that every session holds (Claude Code's listing records, Codex's
// world_state, Pi's system message) are never read. A use is a kind, a name and a time; no message text is kept.
//
// Not here: which item a name is, by each tool's spelling rules (usagerow.ts, the page's, with the 30 days: USAGE_DAYS),
// and what the page shows (matrix.ts). Another tool is another row of `readers`, and of usagerow.ts spelledIn.
import { createReadStream, existsSync } from 'node:fs';
import { copyFile, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { harnessIds, toolConfigRoot } from './harnesses.ts';
import type { ItemKind } from './library.ts';
import type { HarnessId, ToolUsage, UsageReading, UsageTells, UsedName } from './types.ts';
import { DAY_MS } from './model.ts';
import { USAGE_DAYS } from './usagerow.ts';

/** Where a home's tools keep their history: its config folders as harnesses.ts finds them, and OpenCode's data folder (XDG_DATA_HOME). */
export interface UsageWhere { home: string; overrides?: Partial<Record<HarnessId, string>>; dataHome?: string }

/** One use found in a session: what was used, by the tool's own name for it, and when (ms). */
interface Use { kind: ItemKind; name: string; at: number }
/** One session as read: when it started (its first timestamp), and its uses. */
interface Session { start?: number; uses: Use[] }
/** One parsed line of a session file, as JSON: every reader looks only at the fields it names. */
type JsonRecord = Record<string, any>;

interface Reader {
  tells: UsageTells;
  /** Every session this tool keeps in the home; undefined when it has no session folder there. */
  read(at: UsageWhere): Promise<Session[] | undefined>;
  /** When its history starts, where that is not its oldest session's start (`oldest`). */
  reach?(at: UsageWhere, now: number, oldest: number | undefined): Promise<number | undefined>;
}

/** The skill folder a `.../<skill>/SKILL.md` path names, resolved against the folder a command ran in; none for another file. */
export const skillFolder = (path: unknown, cwd?: unknown) =>
  typeof path === 'string' && basename(path) === 'SKILL.md' ? basename(dirname(isAbsolute(path) || typeof cwd !== 'string' ? path : join(cwd, path))) : undefined;

const use = (kind: ItemKind, name: unknown): Omit<Use, 'at'>[] => (typeof name === 'string' && name ? [{ kind, name }] : []);
/** A message's text: a string, or its text parts. */
const textOf = (content: unknown): string =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.map(part => (typeof part?.text === 'string' ? part.text : '')).join('\n') : '';
/** Each match's first group in a text. */
const each = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].map(match => match[1]);
/** The server in an `mcp__<server>__<tool>` tool name, as the tool spelled it. */
const serverIn = (tool: unknown) => (typeof tool === 'string' && tool.startsWith('mcp__') ? tool.slice(5).split('__')[0] : undefined);

// Claude Code: each assistant record's tool_use calls (Skill, Agent or the older Task, mcp__<server>__<tool>), and a skill the
// person typed (`<command-name>/name</command-name>` in a user record). A subagent's file is its session's.
function claudeUses(record: JsonRecord): Omit<Use, 'at'>[] {
  if (record.type === 'user') return each(textOf(record.message?.content), /<command-name>\/([^<\s]+)<\/command-name>/g).flatMap(name => use('skill', name));
  if (record.type !== 'assistant' || !Array.isArray(record.message?.content)) return [];
  return record.message.content.filter((part: JsonRecord) => part?.type === 'tool_use').flatMap((call: JsonRecord) =>
    call.name === 'Skill' ? use('skill', call.input?.skill) : call.name === 'Agent' || call.name === 'Task' ? use('agent', call.input?.subagent_type) : use('mcp', serverIn(call.name)));
}

// Codex: an MCP call done (item_completed's McpToolCall), a skill's SKILL.md read through a command Codex parsed, an agent
// spawned (spawn_agent's agent_type), and a skill the person typed (`<skill>` with its `<name>` in a user message).
function codexUses(record: JsonRecord): Omit<Use, 'at'>[] {
  const payload = record.payload ?? {}, item = payload.item ?? {};
  if (record.type === 'event_msg' && payload.type === 'item_completed') {
    if (item.type === 'McpToolCall') return use('mcp', item.server);
    if (item.type === 'CommandExecution' && Array.isArray(item.parsed_cmd)) return item.parsed_cmd.flatMap((command: JsonRecord) => (command?.type === 'read' ? use('skill', skillFolder(command.path, item.cwd)) : []));
  }
  if (record.type !== 'response_item') return [];
  if (payload.type === 'function_call' && payload.name === 'spawn_agent') { try { return use('agent', JSON.parse(payload.arguments).agent_type); } catch { return []; } }
  if (payload.type === 'message' && payload.role === 'user') return each(textOf(payload.content), /<skill>\s*<name>([^<]+)<\/name>/g).flatMap(name => use('skill', name.trim()));
  return [];
}

// Copilot CLI: its skill.invoked event, and a tool call's start that names its MCP server; each field under the event's data.
function copilotUses(record: JsonRecord): Omit<Use, 'at'>[] {
  const data = record.data ?? record;
  return record.type === 'skill.invoked' ? use('skill', data.name) : record.type === 'tool.execution_start' ? use('mcp', data.mcpServerName) : [];
}

// Pi: an assistant's toolCall that reads a skill's SKILL.md or calls mcp__<server>__<tool>, and a skill the person typed
// (`/skill:name`, which Pi sends as `<skill name="name" …>`).
function piUses(record: JsonRecord): Omit<Use, 'at'>[] {
  const message = record.type === 'message' ? record.message ?? {} : {};
  if (message.role === 'user') return each(textOf(message.content), /<skill name="([^"]+)"/g).flatMap(name => use('skill', name));
  if (message.role !== 'assistant' || !Array.isArray(message.content)) return [];
  return message.content.filter((part: JsonRecord) => part?.type === 'toolCall').flatMap((call: JsonRecord) =>
    call.name === 'read' ? use('skill', skillFolder(call.arguments?.path)) : use('mcp', serverIn(call.name)));
}

/** A record's own time (ms): its `timestamp`, as text or a number; undefined when it has none. */
const timeOf = (record: JsonRecord) => { const at = typeof record.timestamp === 'number' ? record.timestamp : Date.parse(record.timestamp); return Number.isFinite(at) ? at : undefined; };

/**
 * The sessions in a tool's `.jsonl` files under `roots` (none there: undefined), each file streamed line by line. `sessionOf`
 * names a file's session from its path under its root (Claude Code's subagent files join their session). A session starts at
 * its first record with a time. After that, a line is parsed only if it holds one of `marks`, the text every line with a use
 * holds; a use whose record has no time is not counted.
 */
async function jsonlSessions(roots: string[], sessionOf: (path: string) => string, marks: string[], usesIn: (record: JsonRecord) => Omit<Use, 'at'>[]): Promise<Session[] | undefined> {
  const found = await Promise.all(roots.map(root => readdir(root, { recursive: true }).then(names => names.filter(name => name.endsWith('.jsonl')).map(name => ({ root, name })), () => undefined)));
  if (found.every(list => list === undefined)) return undefined;
  const sessions = new Map<string, Session>();
  for (const { root, name } of found.flat().filter(file => file !== undefined)) {
    const key = join(root, sessionOf(name)), session = sessions.get(key) ?? { uses: [] };
    sessions.set(key, session);
    let started: number | undefined;
    for await (const line of createInterface({ input: createReadStream(join(root, name)), crlfDelay: Infinity })) {
      const marked = marks.some(mark => line.includes(mark));
      if (!marked && started !== undefined) continue;
      let record: JsonRecord;
      try { record = JSON.parse(line); } catch { continue; }
      const at = timeOf(record);
      started ??= at;
      if (marked && at !== undefined) for (const each of usesIn(record)) session.uses.push({ ...each, at });
    }
    if (started !== undefined && !(session.start! <= started)) session.start = started;
  }
  return [...sessions.values()];
}

/** The first folder of a path under a root: Claude Code's session id for `<id>.jsonl` and `<id>/subagents/agent-*.jsonl`. */
const firstPart = (path: string) => path.split(sep)[1]?.replace(/\.jsonl$/, '') ?? path;

/**
 * OpenCode keeps its sessions in SQLite: a session's own agent (its `agent` column), and its skill and task calls. The database
 * and its write-ahead log are read from a copy in a temporary folder, since SQLite opening a database in WAL mode, even read
 * only, would leave files of its own beside OpenCode's.
 */
async function openCodeSessions(at: UsageWhere): Promise<Session[] | undefined> {
  const file = join(at.dataHome ?? join(at.home, '.local/share'), 'opencode', 'opencode.db');
  if (!existsSync(file)) return undefined;
  const { DatabaseSync } = await import('node:sqlite');
  const copy = await mkdtemp(join(tmpdir(), 'ck-usage-'));
  await copyFile(file, join(copy, 'opencode.db'));
  await copyFile(`${file}-wal`, join(copy, 'opencode.db-wal')).catch(() => undefined);
  const db = new DatabaseSync(join(copy, 'opencode.db'));
  try {
    const sessions = new Map<string, Session>();
    for (const row of db.prepare('SELECT * FROM session').all() as JsonRecord[]) sessions.set(row.id, { start: row.time_created, uses: use('agent', row.agent).map(found => ({ ...found, at: row.time_created })) });
    for (const row of db.prepare(`SELECT session_id, time_created, data FROM part WHERE data LIKE '%"tool":"skill"%' OR data LIKE '%"tool":"task"%'`).iterate() as Iterable<JsonRecord>) {
      let part: JsonRecord;
      try { part = JSON.parse(row.data); } catch { continue; }
      const found = part.tool === 'skill' ? use('skill', part.state?.input?.name) : part.tool === 'task' ? use('agent', part.state?.input?.subagent_type) : [];
      sessions.get(row.session_id)?.uses.push(...found.map(each => ({ ...each, at: row.time_created })));
    }
    return [...sessions.values()];
  } finally { db.close(); await rm(copy, { recursive: true, force: true }); }
}

/**
 * Claude Code deletes a session `cleanupPeriodDays` (its settings.json; 30 when unset) days after its last activity, so what it
 * keeps is whole for that many days back, and no further back than it began: when its projects folder was made, or its oldest
 * session if that is older (a folder copied from another computer is newer than what it holds).
 */
async function claudeReach(at: UsageWhere, now: number, oldest: number | undefined): Promise<number | undefined> {
  const root = toolConfigRoot(at, 'claude-cli');
  const born = await stat(join(root, 'projects')).then(made => made.birthtimeMs || undefined, () => undefined);
  const set = await readFile(join(root, 'settings.json'), 'utf8').then(text => JSON.parse(text).cleanupPeriodDays, () => undefined);
  const began = Math.min(born ?? Infinity, oldest ?? Infinity);
  return Math.max(Number.isFinite(began) ? began : 0, now - (typeof set === 'number' && set > 0 ? set : 30) * DAY_MS);
}

/**
 * Each tool's reader. `tells`: `sure`, every use leaves its record (none seen means none); `seen`, a record found is a use,
 * but a use may leave none that is known (its form was never seen in a real file); a kind left out has no record at all.
 */
export const readers: Record<HarnessId, Reader> = {
  'claude-cli': { tells: { skill: 'sure', agent: 'sure', mcp: 'sure' }, reach: claudeReach,
    read: at => jsonlSessions([join(toolConfigRoot(at, 'claude-cli'), 'projects')], firstPart, ['"tool_use"', '<command-name>/'], claudeUses) },
  'codex-cli': { tells: { skill: 'sure', agent: 'seen', mcp: 'sure' },
    read: at => jsonlSessions(['sessions', 'archived_sessions'].map(folder => join(toolConfigRoot(at, 'codex-cli'), folder)), path => path, ['McpToolCall', 'SKILL.md', 'spawn_agent', '<skill>'], codexUses) },
  'copilot-cli': { tells: { skill: 'sure', mcp: 'seen' },
    read: at => jsonlSessions([join(toolConfigRoot(at, 'copilot-cli'), 'session-state')], path => path.split(sep)[0], ['skill.invoked', 'mcpServerName'], copilotUses) },
  'pi-cli': { tells: { skill: 'sure', mcp: 'sure' },
    read: at => jsonlSessions([join(toolConfigRoot(at, 'pi-cli'), 'sessions')], path => path, ['"toolCall"', '<skill name='], piUses) },
  'opencode-cli': { tells: { skill: 'sure', agent: 'sure' }, read: openCodeSessions },
};

/** One tool's sessions, read and counted: per name, the sessions since `since` that used it (by number) and its newest use. */
async function readTool(tool: HarnessId, at: UsageWhere, now: number): Promise<ToolUsage> {
  const reader = readers[tool], since = now - USAGE_DAYS * DAY_MS;
  let sessions: Session[] | undefined;
  try { sessions = await reader.read(at); }
  catch { return { tool, tells: reader.tells, sessions: 0, used: [], unread: true }; }
  const used = new Map<string, UsedName & { newest: number }>();
  sessions?.forEach((session, index) => {
    for (const { kind, name, at: when } of session.uses) {
      const entry = used.get(`${kind}:${name}`) ?? { kind, name, sessions: [], last: '', newest: when };
      used.set(`${kind}:${name}`, entry);
      if (when >= since && entry.sessions.at(-1) !== index) entry.sessions.push(index);
      entry.newest = Math.max(entry.newest, when);
    }
  });
  const starts = (sessions ?? []).flatMap(session => (session.start === undefined ? [] : [session.start]));
  const oldest = starts.length ? Math.min(...starts) : undefined;
  const from = sessions?.length ? (reader.reach ? await reader.reach(at, now, oldest) : oldest) : undefined;
  return {
    tool, tells: reader.tells, sessions: sessions?.length ?? 0, ...(from !== undefined ? { from: new Date(from).toISOString() } : {}),
    used: [...used.values()].map(({ newest, ...entry }) => ({ ...entry, last: new Date(newest).toISOString() })),
  };
}

/** Reads every tool's session history in a home: the page's one reading (types.ts UsageReading). */
export async function readUsage(at: UsageWhere, now = Date.now()): Promise<UsageReading> {
  const started = performance.now();
  const tools = await Promise.all(harnessIds.map(tool => readTool(tool, at, now)));
  return { at: new Date(now).toISOString(), tookMs: Math.round(performance.now() - started), tools };
}
