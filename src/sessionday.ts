// A period's session reading, in main: for a home and a half-open period [start, end) (two local midnights passed in; no
// clock read here), reads the session files of each supported tool present for the home (SESSION_TOOLS: Claude Code and Codex)
// modified at or after period.start, keeps requests whose own time is inside [start, end), deduplicates across files by
// (tool, session, request), prices each kept request (rates.ts priceRequest), keeps rates.ts reportedCost(treeReported) only
// on a root session whose whole tree lay inside the period, and joins concurrent reads for the same home, period and tools.
// Nothing is written under the home; DayReading holds no message text and no absolute path.
// Not here: rows and totals (sessionrow.ts), record parsing (sessionrequests.ts), rate matching (rates.ts), presence
// (presence.ts), stored records, IPC, or the Sessions page.
import { stat } from 'node:fs/promises';
import { bundledRates, priceRequest, reportedCost, type PriceResult, type RatesTable } from './rates.ts';
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
 * One session's requests inside the period, its metadata (`project`: working folder's base name), and `reported`: the tool's
 * own figure (USD) for the session, kept only on a root session whose whole tree lay inside the period (never added to sums).
 */
export interface ReadSession {
  tool: SessionTool; session: string; parent?: string; project?: string;
  requests: PricedRequest[]; reported?: number;
}
/** One present tool's reading for the period (`unread`: true if its folder, a modified file, or a line could not be read). */
export interface ToolReading { tool: SessionTool; sessions: ReadSession[]; unread: boolean }
/** What reading a home for a period returns: no message text, no absolute path, and the table's date (`ratesDate`). */
export interface DayReading { period: Period; ratesDate: string; tools: ToolReading[] }

interface SessionMeta { parent?: string; project?: string; treeReported?: number; requests: Map<string, Request> }
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

async function readTool(tool: SessionTool, at: UsageWhere, period: Period, rates: RatesTable): Promise<ToolReading> {
  let candidates: { file: string; session?: string; parent?: string; read: () => Promise<SessionRead> }[] | undefined;
  try {
    candidates = tool === 'claude-cli'
      ? (await claudeFiles(at))?.map(of => ({ file: of.file, session: of.session, parent: of.parent, read: () => readClaudeSession(of) }))
      : (await codexRollouts(at))?.map(file => ({ file, read: () => readCodexRollout(file) }));
  } catch (error) { return { tool, sessions: [], unread: !isMissing(error) }; }
  if (!candidates) return { tool, sessions: [], unread: false };

  let unread = false;
  const outside = new Set<string>();
  const modified: { item: (typeof candidates)[number]; mtimeMs: number }[] = [];
  const markUnread = (item: (typeof candidates)[number]) => {
    unread = true;
    if (item.session) outside.add(item.session);
    if (item.parent) outside.add(item.parent);
  };
  for (const item of candidates) {
    try {
      const info = await stat(item.file);
      if (info.mtimeMs < period.start) { if (item.parent) outside.add(item.parent); continue; }
      modified.push({ item, mtimeMs: info.mtimeMs });
    } catch (error) { if (!isMissing(error)) markUnread(item); }
  }
  modified.sort((a, b) => a.mtimeMs - b.mtimeMs || a.item.file.localeCompare(b.item.file));

  const meta = new Map<string, SessionMeta>();
  const getMeta = (id: string) => meta.get(id) ?? (meta.set(id, { requests: new Map() }), meta.get(id)!);
  for (const { item } of modified) {
    let read: SessionRead;
    try { read = await item.read(); }
    catch (error) { if (!isMissing(error)) markUnread(item); continue; }
    if (read.unread > 0) markUnread(item);
    if (item.session && !item.parent) getMeta(item.session).treeReported = read.treeReported;
    for (const req of read.requests) {
      const entry = getMeta(req.session);
      entry.parent ??= req.parent;
      entry.project ??= read.project;
      if (read.unread > 0) outside.add(req.session);
      const prev = entry.requests.get(req.request);
      if (!prev || prev.at <= req.at) entry.requests.set(req.request, req);
    }
  }
  for (const [id, entry] of meta) {
    if ([...entry.requests.values()].some(r => r.at < period.start || r.at >= period.end)) outside.add(id);
  }
  for (const id of [...outside]) {
    const seen = new Set([id]);
    for (let cur = meta.get(id)?.parent; cur && !seen.has(cur); cur = meta.get(cur)?.parent) { outside.add(cur); seen.add(cur); }
  }

  const sessions: ReadSession[] = [];
  for (const [session, entry] of meta) {
    const inPeriod = [...entry.requests.values()].filter(req => req.at >= period.start && req.at < period.end);
    if (!inPeriod.length) continue;
    inPeriod.sort((a, b) => a.at - b.at || a.request.localeCompare(b.request));
    const reported = !entry.parent && !outside.has(session) ? reportedCost(entry.treeReported) : undefined;
    sessions.push({
      tool, session,
      ...(entry.parent ? { parent: entry.parent } : {}), ...(entry.project ? { project: entry.project } : {}),
      requests: inPeriod.map(request => ({ request, price: priceRequest(request, rates) })),
      ...(reported !== undefined ? { reported } : {}),
    });
  }
  return { tool, sessions, unread };
}

const inFlight = new Map<string, Promise<DayReading>>();

/**
 * Reads each present supported tool's sessions in `at` for `[period.start, period.end)`.
 * For the bundled rates table, a concurrent call for the same home, overrides, period and tools joins the read under way.
 */
export function readSessionPeriod(
  at: UsageWhere, period: Period, present: readonly HarnessId[], rates: RatesTable = bundledRates,
): Promise<DayReading> {
  const tools = SESSION_TOOLS.filter(tool => present.includes(tool));
  const readAll = () => Promise.all(tools.map(tool => readTool(tool, at, period, rates)))
    .then((read): DayReading => ({ period, ratesDate: rates.date, tools: read }));
  if (rates !== bundledRates) return readAll();
  const key = [at.home, period.start, period.end, ...tools.map(tool => `${tool}=${at.overrides?.[tool] ?? ''}`)].join('\0');
  const run = inFlight.get(key) ?? readAll().finally(() => { inFlight.delete(key); });
  inFlight.set(key, run);
  return run;
}
