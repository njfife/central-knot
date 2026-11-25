// Sweeping Claude Code's and Codex's session files into the kept session-costs record (sessionrecord.ts), one batch and one
// record turn at a time. Owns: listing both tools' session files, matching each to its kept position via bigint stat and
// changedSince, reading changed files in bounded batches (64 candidates or 2,000 requests read, finishing the last file),
// pricing requests (rates.ts), committing each batch in one turn (holding back files with held/unread-month requests or
// unapplied facts), updating and dropping positions after complete listings, yielding between batches, honoring a stop
// signal and notBefore, and answering with structured counts (no user-facing sentences).
//
// Limits: (1) a file rewritten to the same size and whole-ms mtime, or whose last 4 KiB before the kept offset match after a
// rewrite, is not seen as changed; (2) a request whose earlier sighting lives in a held or unread month beyond monthsAround
// is kept again (sessionrecord.ts); (3) a facts-only tail (reported figure or unread count, no requests) patches matching
// sessions in read months or scans saved months newest-first (sessionrecord.ts listSessionMonths); if no readable kept month
// holds the session yet (before its first request, or its kept month is held), the file's position does not advance past
// that fact until a readable kept month can take it; (4) a file's unread lines are added to KeptSession.unread only in the
// turn that moves that file's position past them (a held file keeps its old saved unread while its position is held back,
// while the sweep's unreadLines answer reports what that sweep met; a crash mid-commit of an incremental tail with unread
// lines can overcount unread on replay, never undercount); (5) one sweep at a time for a home: the caller's to keep (before
// anything calls sweepSessions for real, the next step takes an exclusive crash-released lock on the store).
//
// Not here: record shapes, holds, saved-month listing, upsert and writes (sessionrecord.ts); line scanning, identity/hash
// and record parsing (sessionrequests.ts); pricing rules (rates.ts); reported-figure tree completeness and merging rules
// (sessionday.ts propagateFigureBlocks, mergeReportedFigure); sums and rows (sessionrow.ts); callers, timers, Settings,
// Clear, retention, and cross-process locking. Nothing calls this module yet.
import type { BigIntStats } from 'node:fs';
import { stat } from 'node:fs/promises';
import { SESSION_TOOLS, type SessionTool } from './presence.ts';
import { bundledRates, priceRequest, type RatesTable } from './rates.ts';
import { mergeReportedFigure, propagateFigureBlocks, type PricedRequest } from './sessionday.ts';
import { listSessionMonths, monthOf, monthsAround, readSessionRecord, upsertSessionRecord, withSessionRecordTurn } from './sessionrecord.ts';
import type { HeldEntry, Positions, SessionMonth, SessionRecord } from './sessionrecord.ts';
import { changedSince, claudeFiles, codexRollouts, readClaudeSession, readCodexRollout } from './sessionrequests.ts';
import type { ClaudeFile, CodexState, SessionRead, Tokens } from './sessionrequests.ts';
import type { ShareContext } from './share.ts';
import type { HarnessId } from './types.ts';
import type { UsageWhere } from './usage.ts';

const BATCH_FILES = 64;
const BATCH_REQUESTS = 2_000;

/** Per-tool outcome of one sweep (`requests`: receipts added or updated, counting a receipt that grew again, only after write succeeds). */
export interface ToolSweep { requests: number; sessions: number; unreadListing: boolean; unreadableFiles: number; unreadLines: number }
/** Requests passed to upsert that were not kept, grouped by whether a later sweep can retry them. */
export interface SweepNotTaken { held: number; notRead: number; never: number }
/** Structured outcome of `sweepSessions` for the next step to display (no user-facing sentences). */
export interface SweepResult {
  /** Receipts newly added or updated (a receipt that grew is counted again) and distinct sessions touched, counted only after write succeeds. */
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
    unreadSessions: claude.unreadSessions ?? [],
  };
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
  seenFiles: Record<SessionTool, Set<string>>;
  unresolvedFiles: Record<SessionTool, boolean>;
  blockedClaude: Set<string>;
  blocksDirty: boolean;
  takenSessions: Record<SessionTool, Set<string>>;
  result: SweepResult;
}

function markClaudeBlocked(st: SweepState, of: ClaudeFile): void {
  st.blockedClaude.add(of.session);
  if (of.parent) st.blockedClaude.add(of.parent);
  st.blocksDirty = true;
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
    const info = await (deps.statFile ? deps.statFile(item.file) : stat(item.file, { bigint: true })).catch(() => undefined);
    if (!info) {
      st.unresolvedFiles[item.tool] = true;
      st.result.byTool[item.tool].unreadableFiles++;
      if (item.tool === 'claude-cli') markClaudeBlocked(st, item.of);
      continue;
    }
    const key = posKey(item.tool, String(info.dev), String(info.ino));
    const prev = st.positionsByKey.get(key);
    if (prev && !changedSince(prev, info)) {
      st.seenFiles[item.tool].add(key);
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
      st.seenFiles[item.tool].add(key);
      st.result.byTool[item.tool].unreadableFiles++;
      if (item.tool === 'claude-cli') markClaudeBlocked(st, item.of);
      continue;
    }
    st.result.byTool[item.tool].unreadLines += read.unread;
    const priced = read.requests.map(request => ({ request, price: priceRequest(request, rates) }));
    requestCount += priced.length;
    batch.push({
      tool: item.tool,
      session: item.tool === 'claude-cli' ? item.of.session : codex?.session,
      parent: item.tool === 'claude-cli' ? item.of.parent : codex?.parent,
      prevKey: prev ? key : undefined, prev, read, codex, priced,
    });
  }
  return { batch, nextCursor: cursor };
}

// ---------- The turn and what is kept back ----------

const isGlobalHold = (entry: HeldEntry, currentMonth: string): boolean =>
  entry.file === 'sessions' || entry.file === `${currentMonth}.json` || entry.file === 'positions.json';

const hasSessionFacts = (file: BatchFile): boolean => file.read.reported !== undefined || file.read.unread > 0;

function stopOnGlobalHold(result: SweepResult, held: readonly HeldEntry[], currentMonth: string): boolean {
  const global = held.filter(h => isGlobalHold(h, currentMonth));
  if (global.length === 0) return false;
  recordHeld(result, global);
  result.refused = global.map(h => h.reason).join(' ');
  return true;
}

async function loadFactsMonths(
  st: SweepState, base: SessionRecord, batch: readonly BatchFile[], read: (months: readonly string[]) => Promise<SessionRecord>,
): Promise<{ source: Pick<SessionRecord, 'readMonths' | 'months' | 'held'>; unapplied: Set<string> } | undefined> {
  const present = new Set(Object.values(base.months).flatMap(m => m.sessions.map(s => `${s.tool}\0${s.session}`)));
  const factsPending = new Set(batch.filter(f => !f.priced.length && f.session && hasSessionFacts(f)).map(f => `${f.tool}\0${f.session}`));
  const blockedParents = batch.filter(f => f.tool === 'claude-cli' && f.read.unread > 0 && f.parent).map(f => f.parent!);
  const wanted = [...factsPending, ...[...st.blockedClaude, ...blockedParents].map(id => `claude-cli\0${id}`)];
  const missing = new Set(wanted.filter(sk => !present.has(sk)));
  if (missing.size === 0) return { source: base, unapplied: new Set() };
  const already = new Set(base.readMonths);
  const saved = (await listSessionMonths(st.context.home)).filter(m => !already.has(m));
  const readMonths = [...base.readMonths];
  const months: Record<string, SessionMonth> = { ...base.months };
  const held = [...base.held];
  for (const m of saved) {
    if (missing.size === 0) break;
    const extra = await read([m]);
    if (stopOnGlobalHold(st.result, extra.held, st.currentMonth)) return undefined;
    for (const h of extra.held) held.push(h);
    const data = extra.months[m];
    if (!data || data.sessions.filter(s => missing.delete(`${s.tool}\0${s.session}`)).length === 0) continue;
    readMonths.push(m);
    months[m] = data;
  }
  return {
    source: { readMonths: readMonths.sort(), months, held },
    unapplied: new Set([...factsPending].filter(sk => missing.has(sk))),
  };
}

function nextUnreadFor(file: BatchFile, sk: string, knownUnread: Map<string, number>): number | undefined {
  const prev = knownUnread.get(sk) ?? 0;
  const next = file.read.startedOver ? file.read.unread
    : file.read.unread > 0 ? (file.prev ? prev + file.read.unread : Math.max(prev, file.read.unread)) : undefined;
  if (next !== undefined) knownUnread.set(sk, next);
  return next;
}

function buildUpsertInputs(
  batch: readonly BatchFile[], months: Record<string, SessionMonth>,
  heldBack: ReadonlySet<BatchFile>, blockedClaude: ReadonlySet<string>,
) {
  const knownUnread = new Map<string, number>();
  const parentOf = new Map<string, string>();
  const existingReported = new Map<string, { dollars: number; complete: boolean }>();
  const directBlocked = new Set(blockedClaude);
  for (const s of Object.values(months).flatMap(m => m.sessions)) {
    const sk = `${s.tool}\0${s.session}`;
    knownUnread.set(sk, Math.max(knownUnread.get(sk) ?? 0, s.unread));
    if (s.tool !== 'claude-cli') continue;
    if (s.parent) parentOf.set(s.session, s.parent);
    if (s.unread > 0) directBlocked.add(s.session);
    if (s.reported) existingReported.set(s.session, mergeReportedFigure(existingReported.get(s.session), s.reported, false, !!s.parent)!);
  }
  for (const file of batch) {
    if (file.tool !== 'claude-cli' || !file.session) continue;
    if (file.parent) parentOf.set(file.session, file.parent);
    if (file.read.unread > 0) directBlocked.add(file.session);
    else if (file.read.startedOver && !blockedClaude.has(file.session)) directBlocked.delete(file.session);
  }
  const blocked = propagateFigureBlocks(directBlocked, id => parentOf.get(id));
  const updates: Parameters<typeof upsertSessionRecord>[1][number][] = [];
  const fileByPriced = new Map<PricedRequest, BatchFile>();
  const updatedClaude = new Set<string>();
  let droppedEmptySession = 0;
  for (const file of batch) {
    const grouped = new Map<string, { parent?: string; requests: PricedRequest[] }>();
    if (!file.priced.length && file.session && hasSessionFacts(file) && !heldBack.has(file)) {
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
      const unread = heldBack.has(file) ? undefined : nextUnreadFor(file, `${file.tool}\0${session}`, knownUnread);
      let reported = file.read.reported;
      if (file.tool === 'claude-cli') {
        updatedClaude.add(session);
        const prevFig = file.read.startedOver ? undefined : existingReported.get(session);
        reported = mergeReportedFigure(prevFig, file.read.reported, blocked.has(session), !!group.parent);
        if (reported) existingReported.set(session, reported);
      }
      updates.push({
        tool: file.tool, session, parent: group.parent, project: file.read.project, unread, reported, requests: group.requests,
      });
    }
  }
  for (const id of blocked) {
    const prevFig = updatedClaude.has(id) ? undefined : existingReported.get(id);
    if (prevFig?.complete) {
      updates.push({ tool: 'claude-cli', session: id, reported: mergeReportedFigure(prevFig, undefined, true, parentOf.has(id)), requests: [] });
    }
  }
  return { updates, fileByPriced, droppedEmptySession };
}

async function commitTurn(st: SweepState, batch: readonly BatchFile[], pruneTools: ReadonlySet<SessionTool>): Promise<boolean> {
  const monthsWanted = new Set<string>([st.currentMonth]);
  for (const item of batch.flatMap(file => file.priced)) {
    for (const m of monthsAround(item.request.at)) monthsWanted.add(m);
  }
  return withSessionRecordTurn(st.context.home, async ({ read, write }) => {
    const base = await read([...monthsWanted]);
    if (stopOnGlobalHold(st.result, base.held, st.currentMonth)) return true;
    const loaded = await loadFactsMonths(st, base, batch, read);
    if (!loaded) return true;
    const { source, unapplied } = loaded;
    const initialHeld = new Set(batch.filter(f => !f.priced.length && f.session && unapplied.has(`${f.tool}\0${f.session}`)));
    const runUpsert = (heldSet: ReadonlySet<BatchFile>) => {
      const inputs = buildUpsertInputs(batch, source.months, heldSet, st.blockedClaude);
      const up = inputs.updates.length > 0 ? upsertSessionRecord(source, inputs.updates) : { months: source.months, changed: [], notTaken: [] };
      return { ...inputs, up };
    };
    let pass = runUpsert(initialHeld);
    const heldBack = new Set(initialHeld);
    const batchNotTaken: SweepNotTaken = { held: 0, notRead: 0, never: pass.droppedEmptySession };
    for (const nt of pass.up.notTaken) {
      const field = nt.reason === 'held' ? 'held' : nt.reason === 'not-read' ? 'notRead' : 'never';
      batchNotTaken[field]++;
      if (field !== 'never') {
        const f = pass.fileByPriced.get(nt.request);
        if (f) heldBack.add(f);
      }
    }
    if ([...heldBack].some(f => !initialHeld.has(f) && f.read.unread > 0)) pass = runUpsert(heldBack);
    const merged = mergePositions(st, base.positions, batch, heldBack, pruneTools);
    if (pass.up.changed.length > 0 || merged.changed) {
      const diff = diffTakenReceipts(source.months, pass.up.months, pass.up.changed);
      const written = await write(st.context, {
        months: pass.up.months, changed: pass.up.changed, positions: merged.positions, currentMonth: st.currentMonth,
      });
      if (!written.written) {
        recordHeld(st.result, [...source.held, ...written.held]);
        st.result.refused = written.refused;
        return true;
      }
      st.result.wrote = true;
      for (const tool of SESSION_TOOLS) st.result.byTool[tool].requests += diff.byTool[tool];
      for (const { tool, session } of diff.sessions) st.takenSessions[tool].add(session);
      replacePositionsCache(st.positionsByKey, merged.positions);
    }
    st.blocksDirty = false;
    recordHeld(st.result, source.held);
    addNotTaken(st.result.notTaken, batchNotTaken);
    return false;
  });
}

// ---------- Positions written and dropped ----------

function mergePositions(
  st: SweepState, current: Positions, batch: readonly BatchFile[], heldBack: ReadonlySet<BatchFile>, pruneTools: ReadonlySet<SessionTool>,
): { positions: Positions; changed: boolean } {
  const map = new Map(current.files.map(entry => [posKey(entry.tool, entry.dev, entry.ino), entry]));
  const heldKeys = new Set<string>();
  for (const file of heldBack) {
    if (file.prevKey) {
      heldKeys.add(file.prevKey);
      st.seenFiles[file.tool].add(file.prevKey);
    }
  }
  let changed = false;
  for (const file of batch) {
    if (heldBack.has(file)) continue;
    const nextPos = keptPosition(file.tool, file.read, file.codex);
    const key = posKey(nextPos.tool, nextPos.dev, nextPos.ino);
    if (heldKeys.has(key)) continue;
    st.seenFiles[file.tool].add(key);
    const existing = map.get(key);
    if (!existing || !samePosition(existing, nextPos)) changed = true;
    map.set(key, nextPos);
  }
  for (const [key, entry] of map) {
    const tool = entry.tool as SessionTool;
    if (pruneTools.has(tool) && !st.seenFiles[tool].has(key)) {
      map.delete(key);
      changed = true;
    }
  }
  return { positions: { formatVersion: 1, sweptAt: st.sweptAt, files: [...map.values()] }, changed };
}

const prunableTools = (unreadListing: Record<SessionTool, boolean>, unresolvedFiles: Record<SessionTool, boolean>) =>
  new Set(SESSION_TOOLS.filter(tool => !unreadListing[tool] && !unresolvedFiles[tool]));

// ---------- The answer ----------

const emptyToolSweep = (): ToolSweep => ({ requests: 0, sessions: 0, unreadListing: false, unreadableFiles: 0, unreadLines: 0 });

const emptyResult = (sweptAt: number): SweepResult => ({
  taken: { requests: 0, sessions: 0 },
  byTool: { 'claude-cli': emptyToolSweep(), 'codex-cli': emptyToolSweep() },
  notTaken: { held: 0, notRead: 0, never: 0 },
  held: [], stopped: false, wrote: false, sweptAt,
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
      const added = Object.entries(s.requests).filter(([key, rec]) => {
        const prev = oldReqs && Object.hasOwn(oldReqs, key) ? oldReqs[key] : undefined;
        return !prev || prev.model !== rec.model || !sameTokens(prev.tokens, rec.tokens);
      }).length;
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
 * turn at a time. Does nothing when stopped or before `options.notBefore`; an idle sweep reads only `positions.json`, lists
 * and stats without opening any month; stops without writing when `sessions`, `positions.json`, or (on a turn that needs it)
 * the current UTC month is held.
 */
export async function sweepSessions(context: ShareContext, options: SweepOptions = {}): Promise<SweepResult> {
  const sweptAt = (context.now ?? Date.now)();
  const result = emptyResult(sweptAt);
  if (options.signal?.aborted) return { ...result, stopped: true };
  if (options.notBefore !== undefined && sweptAt < options.notBefore) return { ...result, skipped: 'not-before' };
  const currentMonth = monthOf(sweptAt);
  const initial = await readSessionRecord(context.home, []);
  if (stopOnGlobalHold(result, initial.held, currentMonth)) return result;

  const at: UsageWhere = { home: context.home, overrides: context.overrides ? { ...context.overrides } : undefined };
  const listed = await listCandidates(at, options.deps ?? {});
  for (const tool of SESSION_TOOLS) result.byTool[tool].unreadListing = listed.unreadListing[tool];
  if (options.signal?.aborted) return { ...result, stopped: true };

  const positionsByKey = new Map<string, KeptPosition>();
  replacePositionsCache(positionsByKey, initial.positions);
  const st: SweepState = {
    context, currentMonth, sweptAt, options, positionsByKey, result,
    seenFiles: { 'claude-cli': new Set(), 'codex-cli': new Set() },
    unresolvedFiles: { 'claude-cli': false, 'codex-cli': false },
    blockedClaude: new Set(listed.unreadSessions), blocksDirty: listed.unreadSessions.length > 0,
    takenSessions: { 'claude-cli': new Set(), 'codex-cli': new Set() },
  };
  let cursor = 0;
  let prunedInLastBatch = false;

  while (cursor < listed.candidates.length) {
    const { batch, nextCursor } = await readBatch(listed.candidates, cursor, st);
    cursor = nextCursor;
    const isFinalBatch = cursor >= listed.candidates.length;
    if (batch.length > 0) {
      const pruneNow = isFinalBatch ? prunableTools(listed.unreadListing, st.unresolvedFiles) : new Set<SessionTool>();
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

  if (!result.stopped && !result.refused) {
    const pruneTools = prunedInLastBatch ? new Set<SessionTool>() : prunableTools(listed.unreadListing, st.unresolvedFiles);
    const hasGone = [...positionsByKey.entries()].some(
      ([key, entry]) => pruneTools.has(entry.tool as SessionTool) && !st.seenFiles[entry.tool as SessionTool].has(key),
    );
    if (hasGone || st.blocksDirty) {
      if (options.signal?.aborted) result.stopped = true;
      else await commitTurn(st, [], hasGone ? pruneTools : new Set());
    }
  }

  for (const tool of SESSION_TOOLS) {
    result.byTool[tool].sessions = st.takenSessions[tool].size;
    result.taken.requests += result.byTool[tool].requests;
    result.taken.sessions += st.takenSessions[tool].size;
  }
  return result;
}
