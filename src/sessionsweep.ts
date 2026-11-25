// Sweeping Claude Code's and Codex's session files into the kept session-costs record (sessionrecord.ts), one batch and one
// record turn at a time. Owns: listing both tools' session files, matching each to its kept position via bigint stat and
// changedSince, reading changed files in bounded batches (64 candidates or 2,000 requests read, finishing the last file),
// pricing requests (rates.ts), committing each batch in one turn (holding back any file with a held or unread-month request),
// updating and dropping positions after complete listings, yielding between batches, honoring a stop signal and notBefore,
// and answering with structured counts (no user-facing sentences).
//
// Limits: (1) a file rewritten to the same size and whole-ms mtime, or whose last 4 KiB before the kept offset match after a
// rewrite, is not seen as changed; (2) a request whose earlier sighting lives in a held or unread month beyond monthsAround
// is kept again (sessionrecord.ts); (3) a facts-only tail (reported figure or unread count, no requests) patches matching
// sessions in read months or scans saved months newest-first for the latest kept month; if none is kept yet (or it is held),
// those facts wait for the session's next request; (4) incremental reads with new unread lines add to the session's kept
// unread count (a crash mid-commit of such a tail can overcount unread on replay, never undercount).
//
// Not here: record shapes, holds, upsert and writes (sessionrecord.ts); line scanning, identity/hash and record parsing
// (sessionrequests.ts); pricing rules (rates.ts); sums and rows (sessionrow.ts); callers, timers, Settings, Clear, retention,
// and cross-process locking. Two copies of the app sweeping one home are not coordinated here: before anything calls
// sweepSessions for real, the next step takes an exclusive crash-released lock on the store. Nothing calls this module yet.
import type { BigIntStats } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { SESSION_TOOLS, type SessionTool } from './presence.ts';
import { bundledRates, priceRequest, type RatesTable } from './rates.ts';
import type { PricedRequest } from './sessionday.ts';
import { monthOf, monthsAround, readSessionRecord, sessionsDirectory, upsertSessionRecord, withSessionRecordTurn } from './sessionrecord.ts';
import type { HeldEntry, Positions, Receipt, SessionMonth, SessionRecord } from './sessionrecord.ts';
import { changedSince, claudeFiles, codexRollouts, readClaudeSession, readCodexRollout } from './sessionrequests.ts';
import type { ClaudeFile, CodexState, SessionRead, Tokens } from './sessionrequests.ts';
import type { ShareContext } from './share.ts';
import type { HarnessId } from './types.ts';
import type { UsageWhere } from './usage.ts';

const BATCH_FILES = 64;
const BATCH_REQUESTS = 2_000;
const MONTH_RE = /^\d{4}-(?:0[1-9]|1[0-2])$/;
const MONTH_FILE_RE = /^(\d{4}-(?:0[1-9]|1[0-2]))\.json$/;

/** Per-tool outcome of one sweep. */
export interface ToolSweep { requests: number; sessions: number; unreadListing: boolean; unreadableFiles: number; unreadLines: number }
/** Requests passed to upsert that were not kept, grouped by whether a later sweep can retry them. */
export interface SweepNotTaken { held: number; notRead: number; never: number }
/** Structured outcome of `sweepSessions` for the next step to display (no user-facing sentences). */
export interface SweepResult {
  taken: { requests: number; sessions: number };
  byTool: Record<SessionTool, ToolSweep>;
  notTaken: SweepNotTaken;
  held: HeldEntry[];
  refused?: string;
  skipped?: 'not-before';
  stopped: boolean;
  wrote: boolean;
  sweptAt: number;
}
/** Injectable listing, stat and reader overrides for tests; defaults call `sessionrequests.ts` and `node:fs/promises`. */
export interface SweepDeps {
  listClaude?: typeof claudeFiles;
  listCodex?: typeof codexRollouts;
  readClaude?: typeof readClaudeSession;
  readCodex?: typeof readCodexRollout;
  statFile?: (path: string) => Promise<BigIntStats>;
}
/** Optional controls for one sweep: stop signal, rate-limit cutoff, rates table, batch bounds, and test seams. */
export interface SweepOptions {
  signal?: AbortSignal;
  notBefore?: number;
  rates?: RatesTable;
  batchFiles?: number;
  batchRequests?: number;
  deps?: SweepDeps;
}

// ---------- Listing and stat ----------

type Candidate = { tool: 'claude-cli'; file: string; of: ClaudeFile } | { tool: 'codex-cli'; file: string };

const byFilePath = (a: Candidate, b: Candidate): number => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0);

async function listCandidates(at: UsageWhere, deps: SweepDeps) {
  const [claude, codex] = await Promise.all([(deps.listClaude ?? claudeFiles)(at), (deps.listCodex ?? codexRollouts)(at)]);
  const claudeList = claude.files.map((of): Candidate => ({ tool: 'claude-cli', file: of.file, of })).sort(byFilePath);
  const codexList = codex.files.map((file): Candidate => ({ tool: 'codex-cli', file })).sort(byFilePath);
  return {
    candidates: [...claudeList, ...codexList],
    unreadListing: { 'claude-cli': claude.unread, 'codex-cli': codex.unread } as Record<SessionTool, boolean>,
  };
}

async function statCandidate(path: string, deps: SweepDeps): Promise<BigIntStats | undefined> {
  try {
    return await (deps.statFile ? deps.statFile(path) : stat(path, { bigint: true }));
  } catch {
    return undefined;
  }
}

// ---------- Positions used and kept ----------

type KeptPosition = Positions['files'][number];

const posKey = (tool: HarnessId, dev: string, ino: string): string => `${tool}\0${dev}\0${ino}`;

const keptPosition = (tool: SessionTool, read: SessionRead, codex?: CodexState): KeptPosition =>
  ({ ...read.position, tool, ...(codex ? { codex } : {}) });

const samePosition = (a: KeptPosition, b: KeptPosition): boolean =>
  a.offset === b.offset && a.before === b.before && a.size === b.size && a.mtimeMs === b.mtimeMs
  && JSON.stringify(a.codex) === JSON.stringify(b.codex);

function replacePositionsCache(cache: Map<string, KeptPosition>, positions: Positions): void {
  cache.clear();
  for (const entry of positions.files) cache.set(posKey(entry.tool, entry.dev, entry.ino), entry);
}

// ---------- Reading and pricing a batch ----------

interface BatchFile {
  tool: SessionTool;
  session?: string;
  parent?: string;
  prevKey?: string;
  prev?: KeptPosition;
  read: SessionRead;
  codex?: CodexState;
  priced: PricedRequest[];
}

interface SweepState {
  context: ShareContext;
  currentMonth: string;
  sweptAt: number;
  options: SweepOptions;
  positionsByKey: Map<string, KeptPosition>;
  seenIds: Record<SessionTool, Set<string>>;
  unresolvedIds: Record<SessionTool, boolean>;
  takenSessions: Record<SessionTool, Set<string>>;
  result: SweepResult;
}

async function readBatch(candidates: readonly Candidate[], start: number, st: SweepState): Promise<{ batch: BatchFile[]; nextCursor: number }> {
  const deps = st.options.deps ?? {};
  const rates = st.options.rates ?? bundledRates;
  const maxFiles = Math.max(1, st.options.batchFiles ?? BATCH_FILES);
  const maxRequests = Math.max(1, st.options.batchRequests ?? BATCH_REQUESTS);
  const readClaude = deps.readClaude ?? readClaudeSession;
  const readCodex = deps.readCodex ?? readCodexRollout;
  const batch: BatchFile[] = [];
  let cursor = start;
  let examined = 0;
  let requestCount = 0;
  while (cursor < candidates.length && examined < maxFiles && requestCount < maxRequests) {
    const item = candidates[cursor++]!;
    examined++;
    const info = await statCandidate(item.file, deps);
    if (!info) {
      st.unresolvedIds[item.tool] = true;
      st.result.byTool[item.tool].unreadableFiles++;
      continue;
    }
    const key = posKey(item.tool, String(info.dev), String(info.ino));
    const prev = st.positionsByKey.get(key);
    if (prev && !changedSince(prev, info)) {
      st.seenIds[item.tool].add(key);
      continue;
    }
    let read: SessionRead;
    let codex: CodexState | undefined;
    try {
      if (item.tool === 'claude-cli') {
        read = await readClaude(item.of, prev);
      } else {
        const codexRead = await readCodex(item.file, prev ? { position: prev, state: prev.codex ?? {} } : undefined);
        read = codexRead;
        codex = codexRead.state;
      }
    } catch {
      st.seenIds[item.tool].add(key);
      st.result.byTool[item.tool].unreadableFiles++;
      continue;
    }
    const priced = read.requests.map(request => ({ request, price: priceRequest(request, rates) }));
    requestCount += priced.length;
    batch.push({
      tool: item.tool,
      session: item.tool === 'claude-cli' ? item.of.session : codex?.session,
      parent: item.tool === 'claude-cli' ? item.of.parent : codex?.parent,
      prevKey: prev ? key : undefined,
      prev,
      read,
      codex,
      priced,
    });
  }
  return { batch, nextCursor: cursor };
}

// ---------- The turn and what is kept back ----------

const isGlobalHold = (entry: HeldEntry, currentMonth: string): boolean =>
  entry.file === 'sessions' || entry.file === `${currentMonth}.json` || entry.file === 'positions.json';

const hasSessionFacts = (file: BatchFile): boolean =>
  file.read.reported !== undefined || file.read.unread > 0
  || (file.prev !== undefined && (file.read.project !== undefined || file.parent !== undefined));

function stopOnGlobalHold(result: SweepResult, held: readonly HeldEntry[], currentMonth: string): boolean {
  const global = held.filter(h => isGlobalHold(h, currentMonth));
  if (global.length === 0) return false;
  recordHeld(result, global);
  result.refused = global.map(h => h.reason).join(' ');
  return true;
}

async function loadFactsMonths(
  st: SweepState,
  base: SessionRecord,
  batch: readonly BatchFile[],
  read: (months: readonly string[]) => Promise<SessionRecord>,
): Promise<Pick<SessionRecord, 'readMonths' | 'months' | 'held'> | undefined> {
  const present = new Set(Object.values(base.months).flatMap(m => m.sessions.map(s => `${s.tool}\0${s.session}`)));
  const missing = new Set(
    batch.filter(f => f.priced.length === 0 && f.session && hasSessionFacts(f))
      .map(f => `${f.tool}\0${f.session}`)
      .filter(sk => !present.has(sk)),
  );
  if (missing.size === 0) return base;
  const names = await readdir(sessionsDirectory(st.context.home)).catch(() => [] as string[]);
  const already = new Set(base.readMonths);
  const saved = names
    .map(name => MONTH_FILE_RE.exec(name)?.[1])
    .filter((m): m is string => !!m && !already.has(m))
    .sort((a, b) => b.localeCompare(a));
  const readMonths = [...base.readMonths];
  const months: Record<string, SessionMonth> = { ...base.months };
  for (const m of saved) {
    if (missing.size === 0) break;
    const extra = await read([m]);
    if (stopOnGlobalHold(st.result, extra.held, st.currentMonth)) return undefined;
    const data = extra.months[m];
    if (!data || data.sessions.filter(s => missing.delete(`${s.tool}\0${s.session}`)).length === 0) continue;
    readMonths.push(m);
    months[m] = data;
  }
  return { readMonths: readMonths.sort(), months, held: base.held };
}

function buildUpsertInputs(batch: readonly BatchFile[], months: Record<string, SessionMonth>) {
  const knownUnread = new Map<string, number>();
  for (const s of Object.values(months).flatMap(m => m.sessions)) {
    const sk = `${s.tool}\0${s.session}`;
    knownUnread.set(sk, Math.max(knownUnread.get(sk) ?? 0, s.unread));
  }
  const updates: Parameters<typeof upsertSessionRecord>[1][number][] = [];
  const fileByPriced = new Map<PricedRequest, BatchFile>();
  let droppedEmptySession = 0;
  for (const file of batch) {
    const grouped = new Map<string, { parent?: string; requests: PricedRequest[] }>();
    if (file.priced.length === 0 && file.session && hasSessionFacts(file)) {
      grouped.set(file.session, { parent: file.parent, requests: [] });
    }
    for (const item of file.priced) {
      fileByPriced.set(item, file);
      const sid = item.request.session || file.session;
      if (!sid) {
        droppedEmptySession++;
        continue;
      }
      const entry = grouped.get(sid) ?? { parent: item.request.parent ?? file.parent, requests: [] };
      entry.requests.push(item);
      grouped.set(sid, entry);
    }
    for (const [session, group] of grouped) {
      const unread = nextUnreadFor(file, `${file.tool}\0${session}`, knownUnread);
      updates.push({
        tool: file.tool, session, parent: group.parent, project: file.read.project, unread,
        reported: file.read.reported, requests: group.requests,
      });
    }
  }
  return { updates, fileByPriced, droppedEmptySession };
}

function nextUnreadFor(file: BatchFile, sk: string, knownUnread: Map<string, number>): number | undefined {
  const prevCount = knownUnread.get(sk) ?? 0;
  const unread = file.read.startedOver
    ? file.read.unread
    : file.prev
      ? (file.read.unread > 0 ? prevCount + file.read.unread : undefined)
      : (file.read.unread > 0 ? Math.max(prevCount, file.read.unread) : undefined);
  if (unread !== undefined) knownUnread.set(sk, unread);
  return unread;
}

async function commitTurn(st: SweepState, batch: readonly BatchFile[], pruneTools: ReadonlySet<SessionTool>): Promise<boolean> {
  const monthsWanted = new Set<string>([st.currentMonth]);
  for (const item of batch.flatMap(file => file.priced)) {
    for (const m of monthsAround(item.request.at)) {
      if (MONTH_RE.test(m)) monthsWanted.add(m);
    }
  }
  return withSessionRecordTurn(st.context.home, async ({ read, write }) => {
    const base = await read([...monthsWanted]);
    if (stopOnGlobalHold(st.result, base.held, st.currentMonth)) return true;
    const source = batch.length > 0 ? await loadFactsMonths(st, base, batch, read) : base;
    if (!source) return true;
    const { updates, fileByPriced, droppedEmptySession } = buildUpsertInputs(batch, source.months);
    const up = updates.length > 0 ? upsertSessionRecord(source, updates) : { months: source.months, changed: [], notTaken: [] };
    const heldBack = new Set<BatchFile>();
    const batchNotTaken: SweepNotTaken = { held: 0, notRead: 0, never: droppedEmptySession };
    for (const nt of up.notTaken) {
      if (nt.reason === 'held' || nt.reason === 'not-read') {
        batchNotTaken[nt.reason === 'held' ? 'held' : 'notRead']++;
        const f = fileByPriced.get(nt.request);
        if (f) heldBack.add(f);
      } else {
        batchNotTaken.never++;
      }
    }
    const merged = mergePositions(base.positions, batch, heldBack, st.seenIds, pruneTools, st.sweptAt);
    if (up.changed.length === 0 && !merged.changed) {
      recordHeld(st.result, source.held);
      addNotTaken(st.result.notTaken, batchNotTaken);
      return false;
    }
    const diff = diffTakenReceipts(source.months, up.months, up.changed);
    const written = await write(st.context, { months: up.months, changed: up.changed, positions: merged.positions, currentMonth: st.currentMonth });
    if (!written.written) {
      recordHeld(st.result, [...source.held, ...written.held]);
      st.result.refused = written.refused;
      return true;
    }
    st.result.wrote = true;
    recordHeld(st.result, source.held);
    addNotTaken(st.result.notTaken, batchNotTaken);
    for (const tool of SESSION_TOOLS) st.result.byTool[tool].requests += diff.byTool[tool];
    for (const { tool, session } of diff.sessions) st.takenSessions[tool].add(session);
    for (const file of batch) {
      if (!heldBack.has(file)) st.result.byTool[file.tool].unreadLines += file.read.unread;
    }
    replacePositionsCache(st.positionsByKey, merged.positions);
    return false;
  });
}

// ---------- Positions written and dropped ----------

function mergePositions(
  current: Positions,
  batch: readonly BatchFile[],
  heldBack: ReadonlySet<BatchFile>,
  seenIds: Record<SessionTool, Set<string>>,
  pruneTools: ReadonlySet<SessionTool>,
  sweptAt: number,
): { positions: Positions; changed: boolean } {
  const map = new Map(current.files.map(entry => [posKey(entry.tool, entry.dev, entry.ino), entry]));
  const heldKeys = new Set<string>();
  for (const file of heldBack) {
    if (file.prevKey) {
      heldKeys.add(file.prevKey);
      seenIds[file.tool].add(file.prevKey);
    }
  }
  let changed = false;
  for (const file of batch) {
    if (heldBack.has(file)) continue;
    const nextPos = keptPosition(file.tool, file.read, file.codex);
    const key = posKey(nextPos.tool, nextPos.dev, nextPos.ino);
    if (heldKeys.has(key)) continue;
    seenIds[file.tool].add(key);
    const existing = map.get(key);
    if (!existing || !samePosition(existing, nextPos)) changed = true;
    map.set(key, nextPos);
  }
  for (const [key, entry] of map) {
    const tool = entry.tool as SessionTool;
    if (pruneTools.has(tool) && !seenIds[tool].has(key)) {
      map.delete(key);
      changed = true;
    }
  }
  return { positions: { formatVersion: 1, sweptAt, files: [...map.values()] }, changed };
}

const prunableTools = (unreadListing: Record<SessionTool, boolean>, unresolvedIds: Record<SessionTool, boolean>) =>
  new Set(SESSION_TOOLS.filter(tool => !unreadListing[tool] && !unresolvedIds[tool]));

// ---------- The answer ----------

const emptyToolSweep = (): ToolSweep => ({ requests: 0, sessions: 0, unreadListing: false, unreadableFiles: 0, unreadLines: 0 });

const emptyResult = (sweptAt: number): SweepResult => ({
  taken: { requests: 0, sessions: 0 },
  byTool: { 'claude-cli': emptyToolSweep(), 'codex-cli': emptyToolSweep() },
  notTaken: { held: 0, notRead: 0, never: 0 },
  held: [],
  stopped: false,
  wrote: false,
  sweptAt,
});

function recordHeld(result: SweepResult, entries: readonly HeldEntry[]): void {
  for (const entry of entries) {
    if (!result.held.some(existing => existing.file === entry.file)) result.held.push(entry);
  }
}

function addNotTaken(target: SweepNotTaken, delta: SweepNotTaken): void {
  target.held += delta.held;
  target.notRead += delta.notRead;
  target.never += delta.never;
}

const sameTokens = (a: Tokens, b: Tokens): boolean =>
  a.input === b.input && a.cacheRead === b.cacheRead && a.cacheWrite === b.cacheWrite && a.cacheWrite1h === b.cacheWrite1h && a.output === b.output;

function diffTakenReceipts(before: Record<string, SessionMonth>, after: Record<string, SessionMonth>, changed: readonly string[]) {
  const byTool: Record<SessionTool, number> = { 'claude-cli': 0, 'codex-cli': 0 };
  const sessions: { tool: SessionTool; session: string }[] = [];
  for (const m of changed) {
    const nextMonth = after[m];
    if (!nextMonth) continue;
    const prevBySession = new Map((before[m]?.sessions ?? []).map(s => [`${s.tool}\0${s.session}`, s.requests]));
    for (const s of nextMonth.sessions) {
      if (s.tool !== 'claude-cli' && s.tool !== 'codex-cli') continue;
      const oldReqs = prevBySession.get(`${s.tool}\0${s.session}`);
      let added = 0;
      for (const [key, rec] of Object.entries(s.requests)) {
        const prev = oldReqs && Object.hasOwn(oldReqs, key) ? oldReqs[key] : undefined;
        if (!prev || prev.model !== rec.model || !sameTokens(prev.tokens, rec.tokens)) added++;
      }
      if (added > 0) {
        byTool[s.tool] += added;
        sessions.push({ tool: s.tool, session: s.session });
      }
    }
  }
  return { byTool, sessions };
}

// ---------- Yielding, stopping and the sweep ----------

const yieldTurn = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

/**
 * Sweeps Claude Code's and Codex's session files in `context.home` into `.central-knot/sessions/`, one batch and one record
 * turn at a time. Does nothing when stopped or before `options.notBefore`; writes nothing when no file changed and no gone
 * position is dropped; stops without writing when `sessions`, the current UTC month or `positions.json` is held.
 */
export async function sweepSessions(context: ShareContext, options: SweepOptions = {}): Promise<SweepResult> {
  const sweptAt = (context.now ?? Date.now)();
  const result = emptyResult(sweptAt);
  if (options.signal?.aborted) {
    result.stopped = true;
    return result;
  }
  if (options.notBefore !== undefined && sweptAt < options.notBefore) {
    result.skipped = 'not-before';
    return result;
  }
  const currentMonth = monthOf(sweptAt);
  const initial = await readSessionRecord(context.home, [currentMonth]);
  if (stopOnGlobalHold(result, initial.held, currentMonth)) return result;

  const at: UsageWhere = { home: context.home, overrides: context.overrides ? { ...context.overrides } : undefined };
  const listed = await listCandidates(at, options.deps ?? {});
  for (const tool of SESSION_TOOLS) result.byTool[tool].unreadListing = listed.unreadListing[tool];
  if (options.signal?.aborted) {
    result.stopped = true;
    return result;
  }

  const positionsByKey = new Map<string, KeptPosition>();
  replacePositionsCache(positionsByKey, initial.positions);
  const st: SweepState = {
    context, currentMonth, sweptAt, options, positionsByKey, result,
    seenIds: { 'claude-cli': new Set(), 'codex-cli': new Set() },
    unresolvedIds: { 'claude-cli': false, 'codex-cli': false },
    takenSessions: { 'claude-cli': new Set(), 'codex-cli': new Set() },
  };
  let cursor = 0;
  let prunedInLastBatch = false;

  while (cursor < listed.candidates.length) {
    const { batch, nextCursor } = await readBatch(listed.candidates, cursor, st);
    cursor = nextCursor;
    const isFinalBatch = cursor >= listed.candidates.length;
    if (batch.length > 0) {
      const pruneNow = isFinalBatch ? prunableTools(listed.unreadListing, st.unresolvedIds) : new Set<SessionTool>();
      if (await commitTurn(st, batch, pruneNow)) break;
      if (isFinalBatch) prunedInLastBatch = true;
    }
    if (!isFinalBatch) {
      await yieldTurn();
      if (options.signal?.aborted) {
        result.stopped = true;
        break;
      }
    }
  }

  if (!result.stopped && !result.refused && !prunedInLastBatch) {
    const pruneTools = prunableTools(listed.unreadListing, st.unresolvedIds);
    const hasGone = [...positionsByKey.entries()].some(
      ([key, entry]) => pruneTools.has(entry.tool as SessionTool) && !st.seenIds[entry.tool as SessionTool].has(key),
    );
    if (hasGone) {
      if (options.signal?.aborted) result.stopped = true;
      else await commitTurn(st, [], pruneTools);
    }
  }

  for (const tool of SESSION_TOOLS) {
    result.byTool[tool].sessions = st.takenSessions[tool].size;
    result.taken.requests += result.byTool[tool].requests;
    result.taken.sessions += st.takenSessions[tool].size;
  }
  return result;
}
