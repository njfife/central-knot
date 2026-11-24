// A period's session reading, in main: for a home and a half-open period [start, end) (two local midnights passed in; no
// clock read here), lists each present supported tool's session files (SESSION_TOOLS: Claude Code via sessionrequests.ts
// claudeFiles, Codex via codexRollouts), reads session files modified at or after period.start, keeps requests inside
// [start, end), deduplicates across files by (tool, session, request), prices each kept request (rates.ts priceRequest),
// keeps the largest rates.ts reportedCost(treeReported) only on a root session whose whole tree lay inside the period, and
// joins concurrent reads for the same home, period and tools. Nothing is written under the home; DayReading holds no message
// text and no absolute path. Not here: rows and totals (sessionrow.ts), file listing and record parsing (sessionrequests.ts),
// rate matching (rates.ts), tool presence (presence.ts), stored records, IPC, or the Sessions page.
import { stat } from 'node:fs/promises';
import { bundledRates, priceRequest, reportedCost, type PriceResult } from './rates.ts';
import { claudeFiles, codexRollouts, readClaudeSession, readCodexRollout, type Request, type SessionRead } from './sessionrequests.ts';
import type { HarnessId } from './types.ts';
import type { UsageWhere } from './usage.ts';

/** Tools whose session files this reader reads for costs. */
export type SessionTool = 'claude-cli' | 'codex-cli';
export const SESSION_TOOLS: readonly SessionTool[] = ['claude-cli', 'codex-cli'];
/** A half-open period [start, end) in ms (two local midnights passed in by the caller). */
export interface Period { start: number; end: number }
/** One request inside the period paired with its price result (no message text, no file path). */
export interface PricedRequest { request: Request; price: PriceResult }
/**
 * One session's non-empty requests inside the period (sessions with none are omitted), its metadata (`project`: working
 * folder's base name), and `reported`: the tool's own figure (USD) for the session, kept only on a root session whose whole
 * tree lay inside the period (never added to sums).
 */
export interface ReadSession {
  tool: SessionTool; session: string; parent?: string; project?: string;
  requests: PricedRequest[]; reported?: number;
}
/** One present tool's reading for the period (`unread`: true if a folder, a listed file, or a line could not be read). */
export interface ToolReading { tool: SessionTool; sessions: ReadSession[]; unread: boolean }
/** What reading a home for a period returns: no message text, no absolute path, and the table's date (`ratesDate`). */
export interface DayReading { period: Period; ratesDate: string; tools: ToolReading[] }

interface Candidate { file: string; session?: string; parent?: string; read: () => Promise<SessionRead> }
interface SessionMeta { parent?: string; project?: string; reported?: number; requests: Map<string, Request> }

const reqTokens = (r: Request) => r.tokens.input + r.tokens.cacheRead + r.tokens.cacheWrite + r.tokens.output;

async function readTool(tool: SessionTool, at: UsageWhere, period: Period): Promise<ToolReading> {
  let unread = false;
  // Sessions whose tool-reported figure cannot stand for this period, because their tree is not known to lie wholly inside it:
  // 1. Any file of this session (another root copy or a child) was skipped as older than period.start.
  // 2. Any listed file of this session or a child vanished (ENOENT), failed stat/read, or held unread lines.
  // 3. Any deduplicated request of this session or a child fell outside [period.start, period.end).
  // Blocked children propagate to their ancestors before ReadSession.reported is attached.
  const figureBlocked = new Set<string>();
  const blockItem = (item: Candidate) => {
    if (item.session) figureBlocked.add(item.session);
    if (item.parent) figureBlocked.add(item.parent);
  };
  const markUnread = (item: Candidate) => {
    unread = true;
    blockItem(item);
  };
  const candidates: Candidate[] = [];
  if (tool === 'claude-cli') {
    const listed = await claudeFiles(at);
    if (listed.unread) unread = true;
    for (const of of listed.files) candidates.push({ ...of, read: () => readClaudeSession(of) });
  } else {
    const listed = await codexRollouts(at);
    if (listed.unread) unread = true;
    for (const file of listed.files) candidates.push({ file, read: () => readCodexRollout(file) });
  }
  const modified: { item: Candidate; mtimeMs: number }[] = [];
  for (const item of candidates) {
    try {
      const info = await stat(item.file);
      if (info.mtimeMs < period.start) {
        blockItem(item);
        continue;
      }
      modified.push({ item, mtimeMs: info.mtimeMs });
    } catch {
      markUnread(item);
    }
  }
  modified.sort((a, b) => a.mtimeMs - b.mtimeMs || a.item.file.localeCompare(b.item.file));

  const meta = new Map<string, SessionMeta>();
  const getMeta = (id: string) => {
    let entry = meta.get(id);
    if (!entry) {
      entry = { requests: new Map() };
      meta.set(id, entry);
    }
    return entry;
  };
  for (const { item } of modified) {
    let read: SessionRead;
    try {
      read = await item.read();
    } catch {
      markUnread(item);
      continue;
    }
    if (read.unread > 0) markUnread(item);
    if (item.session && !item.parent) {
      // Running total across files of one session never goes down: keep the largest reported figure.
      const figure = reportedCost(read.treeReported);
      if (figure !== undefined) {
        const entry = getMeta(item.session);
        entry.reported = Math.max(entry.reported ?? 0, figure);
      }
    }
    for (const req of read.requests) {
      const entry = getMeta(req.session);
      entry.parent ??= req.parent;
      entry.project ??= read.project;
      const prev = entry.requests.get(req.request);
      // Duplicate reply across files: later time wins; on a tie, more tokens in all (a partial reply is never larger than the whole one); on a tie, either.
      if (!prev || req.at > prev.at || (req.at === prev.at && reqTokens(req) > reqTokens(prev))) {
        entry.requests.set(req.request, req);
      }
    }
  }
  for (const [id, entry] of meta) {
    if ([...entry.requests.values()].some(r => r.at < period.start || r.at >= period.end)) figureBlocked.add(id);
  }
  for (const id of [...figureBlocked]) {
    const seen = new Set([id]);
    for (let cur = meta.get(id)?.parent; cur && !seen.has(cur); cur = meta.get(cur)?.parent) {
      figureBlocked.add(cur);
      seen.add(cur);
    }
  }

  const sessions: ReadSession[] = [];
  for (const [session, entry] of meta) {
    const inPeriod = [...entry.requests.values()].filter(req => req.at >= period.start && req.at < period.end);
    if (!inPeriod.length) continue;
    inPeriod.sort((a, b) => a.at - b.at || a.request.localeCompare(b.request));
    const reported = !entry.parent && !figureBlocked.has(session) ? entry.reported : undefined;
    sessions.push({
      tool, session,
      ...(entry.parent ? { parent: entry.parent } : {}),
      ...(entry.project ? { project: entry.project } : {}),
      requests: inPeriod.map(request => ({ request, price: priceRequest(request) })),
      ...(reported !== undefined ? { reported } : {}),
    });
  }
  return { tool, sessions, unread };
}

const inFlight = new Map<string, Promise<DayReading>>();

/**
 * Reads each present supported tool's sessions in `at` for `[period.start, period.end)`. `present` is the tools the home's
 * view says are present (`presence.ts presentTools`, `HomeView.sync.present`, whether or not managed).
 * A concurrent call for the same home, overrides, period and tools joins the read under way.
 */
export function readSessionPeriod(at: UsageWhere, period: Period, present: readonly HarnessId[]): Promise<DayReading> {
  const tools = SESSION_TOOLS.filter(tool => present.includes(tool));
  const key = [at.home, period.start, period.end, ...tools.map(tool => `${tool}=${at.overrides?.[tool] ?? ''}`)].join('\0');
  const running = inFlight.get(key);
  if (running) return running;
  const run = Promise.all(tools.map(tool => readTool(tool, at, period)))
    .then((read): DayReading => ({ period, ratesDate: bundledRates.date, tools: read }))
    .finally(() => { inFlight.delete(key); });
  inFlight.set(key, run);
  return run;
}
