// A period's session reading, in main: for a home and a half-open period [start, end) (two local midnights passed in; no
// clock read here), lists each present supported tool's session files (presence.ts SESSION_TOOLS: Claude Code via sessionrequests.ts
// claudeFiles, Codex via codexRollouts), reads session files modified at or after period.start, keeps requests inside
// [start, end), deduplicates across files by (tool, session, request), prices each kept request (rates.ts priceRequest),
// keeps the largest rates.ts reportedCost of a complete SessionRead.reported only on a root session whose whole tree lay
// inside the period, and joins concurrent reads for the same home, period and tools. Nothing is written under the home;
// DayReading holds no message text and no absolute path.
// The same reading made from the kept record instead (readKeptPeriod, keptReading, priceFromKept: the Sessions page's 7 days,
// through main.ts sessions:read-kept): the months the period touches, read only; each request at the price it was kept with.
// Where it can differ from the files' reading of the same day: a request repeated in a resumed session counts once in the
// record, and the record keeps a request's first time where the files' reading takes its last.
// Not here: rows and totals (sessionrow.ts), file listing and record parsing (sessionrequests.ts), rate matching (rates.ts),
// tool presence and which tools are read (presence.ts), the record's shapes, reads and writes (sessionrecord.ts), IPC
// (main.ts sessions:read, sessions:read-kept), or the Sessions page (sessionspage.ts).
import { stat } from 'node:fs/promises';
import { priceRequest, reportedCost, type PriceResult } from './rates.ts';
import { claudeFiles, codexRollouts, readClaudeSession, readCodexRollout, type Request, type SessionRead } from './sessionrequests.ts';
import { SESSION_TOOLS, type SessionTool } from './presence.ts';
import { monthOf, readSessionMonths, type KeptSession, type PricingEntry, type Receipt, type SessionMonths } from './sessionrecord.ts';
import type { HarnessId } from './types.ts';
import type { UsageWhere } from './usage.ts';

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
/** What reading a home for a period returns: no message text and no absolute path. */
export interface DayReading { period: Period; tools: ToolReading[] }

interface Candidate { file: string; session?: string; parent?: string; read: () => Promise<SessionRead> }
interface SessionMeta { parent?: string; project?: string; reported?: number; requests: Map<string, Request> }

const reqTokens = (r: Request) => r.tokens.input + r.tokens.cacheRead + r.tokens.cacheWrite + r.tokens.output;

async function readTool(tool: SessionTool, at: UsageWhere, period: Period): Promise<ToolReading> {
  let unread = false;
  // Sessions whose tool-reported figure cannot stand for this period, because their tree is not known to lie wholly inside it:
  // 1. Any file of this session (another root copy or a child) was skipped as older than period.start.
  // 2. Any subfolder (e.g. subagents) or listed file of this session or a child could not be listed, vanished (ENOENT), failed stat/read, or held unread lines.
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
    for (const id of listed.unreadSessions ?? []) figureBlocked.add(id);
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
      // Keep the largest reported figure across copies of one session (rests on the figure never going down within a file as
      // seen; a file cut back after a copy was made would show the copy's larger figure).
      const figure = read.reported?.complete ? reportedCost(read.reported.dollars) : undefined;
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
      // Duplicate reply across files: later time wins; on a tie, more tokens in all (rests on what the tools were seen to
      // write — a reply recorded in part, then whole, its counts only growing; a later record with fewer tokens at the same
      // time would lose); on a tie, either.
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
    .then((read): DayReading => ({ period, tools: read }))
    .finally(() => { inFlight.delete(key); });
  inFlight.set(key, run);
  return run;
}

/** The price a kept receipt was given, as rates.ts priceRequest gave it: its kept pricing entry with the receipt's dollars. */
export function priceFromKept(entry: PricingEntry, receipt: Receipt): PriceResult {
  return entry.priced ? { ...entry, dollars: receipt.dollars! } : entry;
}

/** A kept receipt as the request it records, at the price it was kept with. */
function keptRequest(session: KeptSession, request: string, receipt: Receipt, pricings: readonly PricingEntry[]): PricedRequest {
  const { at, model, tokens, speed, serviceTier } = receipt;
  const kept: Request = {
    tool: session.tool, session: session.session, ...(session.parent ? { parent: session.parent } : {}), request, at, model, tokens,
    ...(speed !== undefined ? { speed } : {}), ...(serviceTier !== undefined ? { serviceTier } : {}),
  };
  return { request: kept, price: priceFromKept(pricings[receipt.pricing]!, receipt) };
}

/**
 * One tool's requests found, by request id: the earliest kept time of each seen before the period's end (`first`), and those
 * whose earliest is inside the period, priced, with the kept session they were found in (`inside`).
 */
interface Found { first: Map<string, number>; inside: Map<string, { session: KeptSession; priced: PricedRequest }> }

/** A tool's requests found inside the period as sessions: a session's parts, from any month read, one; its requests in time order. */
function sessionsOf(tool: SessionTool, found: Found): ReadSession[] {
  const sessions = new Map<string, ReadSession>();
  for (const { session, priced } of found.inside.values()) {
    const parts = sessions.get(session.session) ?? { tool, session: session.session, requests: [] };
    parts.parent ??= session.parent;
    parts.project ??= session.project;
    parts.requests.push(priced);
    sessions.set(session.session, parts);
  }
  for (const parts of sessions.values()) {
    parts.requests.sort((a, b) => a.request.at - b.request.at || a.request.request.localeCompare(b.request.request));
  }
  return [...sessions.values()];
}

/**
 * The kept record's requests inside `period`, as readSessionPeriod's reading, for the present supported tools: a request kept in
 * two months taken once, by tool and request id, its earliest kept time deciding whether it is inside; a session's parts in the
 * months read made one; each priced as kept (priceFromKept); no tool's own figure (none is kept). A tool is unread where a month
 * read holds one of its sessions with unread lines, and every tool is where a month read or the folder is held.
 */
export function keptReading(record: SessionMonths, period: Period, present: readonly HarnessId[]): DayReading {
  const tools = SESSION_TOOLS.filter(tool => present.includes(tool));
  const found = new Map<HarnessId, Found>(tools.map(tool => [tool, { first: new Map(), inside: new Map() }]));
  const heldRead = record.held.some(held => held.file === 'sessions' || record.readMonths.some(month => held.file === `${month}.json`));
  const unread = new Set<HarnessId>();
  for (const kept of record.readMonths.flatMap(month => record.months[month] ?? [])) {
    for (const session of kept.sessions) {
      const ofTool = found.get(session.tool);
      if (!ofTool) continue;
      if (session.unread > 0) unread.add(session.tool);
      for (const request in session.requests) {
        const receipt = session.requests[request]!;
        // Its earliest kept time decides: a request first kept before the period is not in it, though kept again inside.
        if (receipt.at >= period.end || (ofTool.first.get(request) ?? Infinity) <= receipt.at) continue;
        ofTool.first.set(request, receipt.at);
        if (receipt.at < period.start) ofTool.inside.delete(request);
        else ofTool.inside.set(request, { session, priced: keptRequest(session, request, receipt, kept.pricings) });
      }
    }
  }
  return { period, tools: tools.map(tool => ({ tool, sessions: sessionsOf(tool, found.get(tool)!), unread: heldRead || unread.has(tool) })) };
}

/** The kept record's reading of `period` (keptReading), from the UTC months of its start and of its last moment; read only. */
export async function readKeptPeriod(home: string, period: Period, present: readonly HarnessId[]): Promise<DayReading> {
  const months = new Set([monthOf(period.start), monthOf(period.end - 1)]);
  const record = await readSessionMonths(home, [...months]);
  // A whole turn of the event loop (a timer: an immediate would run before what waits) between the last month's parse and the
  // reading, so that main is not held for both at once.
  await new Promise(resolve => setTimeout(resolve, 0));
  return keptReading(record, period, present);
}
