// Session requests, in main: the tokens each response of a model used, as a tool's own session history recorded them. A
// request (`Request`) is one response: the tool, its session and the session that is its parent, an id that is the same
// however often the history repeats the record, its time, the model's id exactly as saved, its tokens by kind, and what else
// its price will depend on, as saved. It never holds message text. No price is worked out here: that is done elsewhere, and the
// only dollars a request holds are those the tool itself reported. Nothing is stored here: a caller keeps each file's
// `Position` for its next read, and the requests it is given by tool, session and request id. A later read can bring an id
// the caller already holds (Claude Code records a response in part before recording it whole): the later one replaces it.
//
// A file is read by `scanLines`, from where its last read ended: complete lines only, each parsed as it is read; a file that
// shrank, or is another file now, is read from its start, and the read says it started over before its first line. Claude
// Code's files are found by `claudeFiles`, each a session, and their records made into requests by `readClaudeSession`. It
// reads the same files as usage.ts, the Library's usage reading, which keeps its own refresh and its own rules, and takes
// from it what both need (usage.ts's header names them).
//
// Not here: Codex and the other tools (each another reader beside readClaudeSession), prices, a record kept, a page.
import { open } from 'node:fs/promises';
import { basename, join, sep } from 'node:path';
import type { HarnessId } from './types.ts';
import { claudeProjects, recordOf, sessionFiles, timeOf, type JsonRecord, type UsageWhere } from './usage.ts';

/**
 * A response's tokens by kind: `input` without the cached part, and `output` with any reasoning inside it, once. Where the tool
 * saves it, `cacheWrite1h` is the part of `cacheWrite` written to be kept for an hour (priced apart): inside it, never added to it.
 */
export interface Tokens { input: number; cacheRead: number; cacheWrite: number; cacheWrite1h?: number; output: number }

/** One response of a model, as a tool's session history recorded it. */
export interface Request {
  tool: HarnessId;
  /** The tool's own id for the session (Claude Code's: its file's name without `.jsonl`). */
  session: string;
  /** The session this one is a child of, where it is one. */
  parent?: string;
  /** An id that is the same however often the history repeats the record (Claude Code's: the message's id). */
  request: string;
  /** Its time (ms), as its record states it. */
  at: number;
  /** The model's id exactly as saved. */
  model: string;
  /** The model's provider, where the tool saves one (Claude Code saves none). */
  provider?: string;
  tokens: Tokens;
  /** The speed it was served at, as the tool saved it (Claude Code's `usage.speed`), where saved. */
  speed?: string;
  /** The service tier it was served at, as the tool saved it (Claude Code's `usage.service_tier`), where saved. */
  serviceTier?: string;
  /** A cost in dollars the tool saved for this request alone (Claude Code saves one only for the tree: `SessionRead.treeReported`). */
  reported?: number;
}

/** Where a read of a file ended: the file's identity (device and inode) and the byte after its last complete line. */
export interface Position { dev: number; ino: number; offset: number }

const CHUNK = 64 * 1024;

/**
 * Reads the complete lines appended to `file` since `from`, and says where this read ended. `reader` is told first, before any
 * line and for an empty file too, whether this read started over: the file is shorter than `from`, or another file now (its
 * identity changed: replaced), so it is read from its start. A first read (no `from`) has not. `reader` gives back what each
 * line is then handed to, in order. A last line with no newline yet is left for the next read. Held meanwhile: one chunk of
 * the file and the line it ends in.
 */
export async function scanLines(file: string, from: Position | undefined, reader: (startedOver: boolean) => (line: string) => void): Promise<Position> {
  const handle = await open(file, 'r');
  try {
    const { dev, ino, size } = await handle.stat(), chunk = Buffer.alloc(CHUNK);
    const goesOn = from !== undefined && from.dev === dev && from.ino === ino && from.offset <= size;
    const line = reader(from !== undefined && !goesOn);
    let read = goesOn ? from.offset : 0, rest = Buffer.alloc(0);
    while (read < size) {
      const { bytesRead } = await handle.read(chunk, 0, Math.min(CHUNK, size - read), read);
      if (bytesRead === 0) break;
      read += bytesRead;
      const text = Buffer.concat([rest, chunk.subarray(0, bytesRead)]);
      let start = 0;
      let end = text.indexOf('\n');
      while (end !== -1) {
        line(text.toString('utf8', start, end));
        start = end + 1;
        end = text.indexOf('\n', start);
      }
      rest = text.subarray(start);
    }
    return { dev, ino, offset: read - rest.length };
  } finally { await handle.close(); }
}

/** What one read of a session file found in the lines it read. */
export interface SessionRead {
  /** Its requests, one per request id: the last record of each in these lines. */
  requests: Request[];
  /**
   * Whether this read began again at the file's start, because the file shrank or is another file now: what a caller took from
   * its earlier reads of it may no longer be in it. False on a first read (no position given): there was nothing to start over
   * from, and a caller that holds nothing from the file has nothing to set aside.
   */
  startedOver: boolean;
  /** The working folder's name, from the first record in these lines that states one. */
  project?: string;
  /** The tool's own cost in dollars for the session with its children, as recorded (zero too): the last record of it in these lines. */
  treeReported?: number;
  /** Lines passed over that could have held a request: which, each tool's reader says (Claude Code's: readClaudeSession). */
  unread: number;
  /** Where the next read starts. */
  position: Position;
}

/** A Claude Code session file: where it is, the session it is (its file's name), and the session it is a child of. */
export interface ClaudeFile { file: string; session: string; parent?: string }

/**
 * Claude Code's session files in a home: `<project>/<id>.jsonl`, session `<id>`, and a child's `<project>/<id>/subagents/
 * agent-<x>.jsonl`, its own session `agent-<x>` with parent `<id>`. Other files are no session's; no projects folder: undefined.
 */
export async function claudeFiles(at: UsageWhere): Promise<ClaudeFile[] | undefined> {
  const root = claudeProjects(at);
  return (await sessionFiles([root]))?.flatMap(({ name }) => {
    const parts = name.slice(0, -'.jsonl'.length).split(sep), file = join(root, name);
    if (parts.length === 2) return [{ file, session: parts[1] }];
    return parts.length === 4 && parts[2] === 'subagents' ? [{ file, session: parts[3], parent: parts[1] }] : [];
  });
}

/** A count of tokens as saved: a whole number, not below zero. */
const count = (value: unknown) => (Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : undefined);

/**
 * Claude Code's `message.usage` as tokens: input without the cached part, as Anthropic counts it; cache writes as their total
 * (`cache_creation_input_tokens`), with its one-hour part kept as saved (`cache_creation.ephemeral_1h_input_tokens`) and
 * neither part added to it again; output with its thinking inside it (`output_tokens_details.thinking_tokens` not added
 * again). Undefined when one of the four kinds is not a count.
 */
function claudeTokens(usage: JsonRecord | undefined): Tokens | undefined {
  const input = count(usage?.input_tokens), cacheRead = count(usage?.cache_read_input_tokens);
  const cacheWrite = count(usage?.cache_creation_input_tokens), output = count(usage?.output_tokens);
  if (input === undefined || cacheRead === undefined || cacheWrite === undefined || output === undefined) return undefined;
  const cacheWrite1h = count(usage?.cache_creation?.ephemeral_1h_input_tokens);
  return { input, cacheRead, cacheWrite, ...(cacheWrite1h !== undefined ? { cacheWrite1h } : {}), output };
}

/** A Claude Code `assistant` record as a request: its message's id, model and usage, and its time; undefined when one is missing. */
function claudeRequest(record: JsonRecord, of: ClaudeFile): Request | undefined {
  const message = record.message, tokens = claudeTokens(message?.usage), at = timeOf(record);
  if (record.type !== 'assistant' || typeof message?.id !== 'string' || typeof message.model !== 'string' || !tokens || at === undefined) return undefined;
  const request: Request = { tool: 'claude-cli', session: of.session, request: message.id, at, model: message.model, tokens };
  if (of.parent) request.parent = of.parent;
  if (typeof message.usage.speed === 'string') request.speed = message.usage.speed;
  if (typeof message.usage.service_tier === 'string') request.serviceTier = message.usage.service_tier;
  return request;
}

/**
 * One read of a Claude Code session file from `from` (its start when undefined). A response is an `assistant` record, recorded
 * once per content part and sometimes in part first: the last record of each message id stands. The closing `cost-state`
 * record's `totalCostUSD` covers the session with its children; an older version writes none. Counted as unread: a line that
 * is not a JSON record, and an `assistant` record, or any other with `message.usage`, that is not a request (claudeRequest).
 * Every other record holds no request, and is passed over uncounted.
 */
export async function readClaudeSession(of: ClaudeFile, from?: Position): Promise<SessionRead> {
  const requests = new Map<string, Request>();
  let startedOver = false, project: string | undefined, treeReported: number | undefined, unread = 0;
  const onLine = (line: string) => {
    const record = recordOf(line);
    if (!record) {
      unread++;
      return;
    }
    if (typeof record.cwd === 'string') project ??= basename(record.cwd);
    if (record.type === 'cost-state' && Number.isFinite(record.totalCostUSD)) treeReported = record.totalCostUSD;
    if (record.type !== 'assistant' && record.message?.usage === undefined) return;
    const request = claudeRequest(record, of);
    if (request) requests.set(request.request, request);
    else unread++;
  };
  const position = await scanLines(of.file, from, over => {
    startedOver = over;
    return onLine;
  });
  const found = { ...(project ? { project } : {}), ...(treeReported !== undefined ? { treeReported } : {}) };
  return { requests: [...requests.values()], startedOver, ...found, unread, position };
}
