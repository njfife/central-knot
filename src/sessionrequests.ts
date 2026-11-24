// Session requests, in main: the tokens each response of a model used, as a tool's own session history recorded them. A
// request (`Request`) is one response: the tool, its session and the session that is its parent, an id that is the same
// however often the history repeats the record, its time, the model's id exactly as saved, and its tokens by kind. It never
// holds message text, and never money: a price is worked out from it elsewhere. Nothing is stored here: a caller keeps each
// file's `Position` for its next read, and the requests it is given by tool, session and request id. A later read can bring
// an id the caller already holds (Claude Code records a response in part before recording it whole): the later one replaces it.
//
// A file is read by `scanLines`, from where its last read ended: complete lines only, each parsed as it is read; a file that
// shrank, or is another file now, is read from its start. Claude Code's files are found by `claudeFiles`, each a session,
// and their records made into requests by `readClaudeSession`. Shared with usage.ts, the Library's usage reading, which keeps
// its own refresh and its own rules: where a tool's session files are (`usage.ts sessionFiles`, `usage.ts claudeProjects`)
// and a line read as a record (`usage.ts recordOf`, `usage.ts timeOf`).
//
// Not here: Codex and the other tools (each another reader beside readClaudeSession), prices, a record kept, a page.
import { open } from 'node:fs/promises';
import { basename, join, sep } from 'node:path';
import type { HarnessId } from './types.ts';
import { claudeProjects, recordOf, sessionFiles, timeOf, type JsonRecord, type UsageWhere } from './usage.ts';

/** A response's tokens by kind: `input` without the cached part, and `output` with any reasoning inside it, once. */
export interface Tokens { input: number; cacheRead: number; cacheWrite: number; output: number }

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
  /** A cost in dollars the tool saved for this request alone (Claude Code saves one only for the tree: `SessionRead.treeReported`). */
  reported?: number;
}

/** Where a read of a file ended: the file's identity (device and inode) and the byte after its last complete line. */
export interface Position { dev: number; ino: number; offset: number }

/** How many bytes are read from a file at once. */
const CHUNK = 64 * 1024;

/**
 * Hands each complete line appended to `file` since `from` to `line`, as it is read, and says where this read ended. A last line
 * with no newline yet is left for the next read. A file shorter than `from`, or another file now (its identity changed: replaced),
 * is read from its start. Held meanwhile: one chunk of the file (`CHUNK`) and the line it ends in.
 */
export async function scanLines(file: string, from: Position | undefined, line: (text: string) => void): Promise<Position> {
  const handle = await open(file, 'r');
  try {
    const { dev, ino, size } = await handle.stat(), chunk = Buffer.alloc(CHUNK);
    let read = from && from.dev === dev && from.ino === ino && from.offset <= size ? from.offset : 0, rest = Buffer.alloc(0);
    while (read < size) {
      const { bytesRead } = await handle.read(chunk, 0, Math.min(CHUNK, size - read), read);
      if (bytesRead === 0) break;
      read += bytesRead;
      const text = Buffer.concat([rest, chunk.subarray(0, bytesRead)]);
      let start = 0, end: number;
      while ((end = text.indexOf(10, start)) !== -1) { line(text.toString('utf8', start, end)); start = end + 1; }
      rest = text.subarray(start);
    }
    return { dev, ino, offset: read - rest.length };
  } finally { await handle.close(); }
}

/** What one read of a session file found in the lines it read. */
export interface SessionRead {
  /** Its requests, one per request id: the last record of each in these lines. */
  requests: Request[];
  /** The working folder's name, from the first record in these lines that states one. */
  project?: string;
  /** The tool's own cost in dollars for the session with its children: the last record of it in these lines, where above zero. */
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
 * (`cache_creation_input_tokens`), not with their 5-minute and 1-hour parts added again; output with its thinking inside it
 * (`output_tokens_details.thinking_tokens` not added again). Undefined when one of the four is not a count.
 */
function claudeTokens(usage: JsonRecord | undefined): Tokens | undefined {
  const input = count(usage?.input_tokens), cacheRead = count(usage?.cache_read_input_tokens);
  const cacheWrite = count(usage?.cache_creation_input_tokens), output = count(usage?.output_tokens);
  return input === undefined || cacheRead === undefined || cacheWrite === undefined || output === undefined ? undefined : { input, cacheRead, cacheWrite, output };
}

/** A Claude Code `assistant` record as a request: its message's id, model and usage, and its time; undefined when one is missing. */
function claudeRequest(record: JsonRecord, of: ClaudeFile): Request | undefined {
  const message = record.message, tokens = claudeTokens(message?.usage), at = timeOf(record);
  if (record.type !== 'assistant' || typeof message?.id !== 'string' || typeof message.model !== 'string' || !tokens || at === undefined) return undefined;
  return { tool: 'claude-cli', session: of.session, ...(of.parent ? { parent: of.parent } : {}), request: message.id, at, model: message.model, tokens };
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
  let project: string | undefined, closingCost: unknown, unread = 0;
  const position = await scanLines(of.file, from, line => {
    const record = recordOf(line);
    if (!record) { unread++; return; }
    if (typeof record.cwd === 'string') project ??= basename(record.cwd);
    if (record.type === 'cost-state') closingCost = record.totalCostUSD;
    if (record.type !== 'assistant' && record.message?.usage === undefined) return;
    const request = claudeRequest(record, of);
    if (request) requests.set(request.request, request);
    else unread++;
  });
  const treeReported = typeof closingCost === 'number' && closingCost > 0 ? closingCost : undefined;
  return { requests: [...requests.values()], ...(project ? { project } : {}), ...(treeReported !== undefined ? { treeReported } : {}), unread, position };
}
