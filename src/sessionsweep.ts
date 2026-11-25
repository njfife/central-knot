// Sweeping Claude Code's and Codex's session files into the kept session-costs record (sessionrecord.ts), one batch and one
// record turn at a time. Owns: taking the home's exclusive session-store lock (sessionlock.ts withSessionStoreLock) after
// stop and notBefore checks and before reading positions.json (returning `skipped: 'busy'` when another caller holds it, and
// refusing without creating the store when `writeAccess` or the store's own paths refuse), listing both tools' session files,
// matching each to its kept position via bigint stat and changedSince, reading changed files in bounded batches (64 candidates
// or 2,000 requests read, finishing the last file), pricing requests (rates.ts), committing each batch in one turn (holding
// back any file with a held or unread-month request), updating readable files' positions and dropping gone positions only
// after complete listings with no unresolved stat, yielding between batches, honoring a stop signal and notBefore, and
// answering with structured counts (except `refused` and `held[].reason`, which pass through the record's, lock's, and
// `writeAccess`'s own refusal sentences).
//
// Limits: (1) a file rewritten to the same size and whole-ms mtime is not seen as changed; when its stat changes, a matching
// last-4 KiB digest before the kept offset lets the tail read continue without noticing edits before that offset; (2) a
// request whose earlier sighting lives in a held month (including a held neighbour in monthsAround) or in an unread month
// beyond monthsAround is kept again (sessionrecord.ts); (3) a facts-only tail (unread count, or continuing project/parent,
// with no requests) patches matching sessions in read months or scans saved months newest-first (sessionrecord.ts
// listSessionMonths); no file is held back because a fact could not be applied, so its position moves past such a tail, and
// a bad line in such a tail is in that sweep's unreadLines answer and, where the session has no receipt in a month the turn
// reads, is not added to a kept count; (4) a file's unread lines are added to KeptSession.unread only in the turn that moves
// that file's position past them (a held file with unread lines keeps its old saved unread while its position is held back,
// though a clean rewrite beside a held-month request can still reset kept unread to 0; the sweep's unreadLines answer reports
// what that sweep met; a crash mid-commit of an incremental tail with unread lines can overcount unread on replay, never
// undercount); (5) a session's own reported figure is not kept yet (its own step); (6) the store lock promises exclusion on a
// local file system only (sessionlock.ts); a home on a network folder is not covered.
//
// Not here: record shapes, holds, saved-month listing, upsert and writes (sessionrecord.ts); the store lock itself
// (sessionlock.ts); line scanning, identity/hash and record parsing (sessionrequests.ts); pricing rules (rates.ts); sums and
// rows (sessionrow.ts); session-reported figures (their own step); callers, timers, Settings, Clear, and retention. Nothing
// calls this module yet.
import type { BigIntStats } from 'node:fs';
import { stat } from 'node:fs/promises';
import { SESSION_TOOLS, type SessionTool } from './presence.ts';
import { bundledRates, priceRequest, type RatesTable } from './rates.ts';
import type { PricedRequest } from './sessionday.ts';
import { withSessionStoreLock } from './sessionlock.ts';
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
/** Structured outcome of `sweepSessions` for the next step to display (`refused` and `held[].reason` pass through the record's and `writeAccess`'s own sentences). */
export interface SweepResult {
  /** Receipts newly added or updated (a receipt that grew is counted again) and distinct sessions touched, counted only after write succeeds. */
  taken: { requests: number; sessions: number };
  byTool: Record<SessionTool, ToolSweep>;
  notTaken: SweepNotTaken;
  held: HeldEntry[];
  refused?: string;
  skipped?: 'not-before' | 'busy';
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
    const info = await (deps.statFile ? deps.statFile(item.file) : stat(item.file, { bigint: true })).catch(() => undefined);
    if (!info) {
      st.unresolvedFiles[item.tool] = true;
      st.result.byTool[item.tool].unreadableFiles++;
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
      continue;
    }
    st.result.byTool[item.tool].unreadLines += read.unread;
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

const hasSessionFacts = (file: BatchFile): boolean =>
  file.read.unread > 0
  || (file.prev !== undefined && (file.read.project !== undefined || file.parent !== undefined));

function stopOnGlobalHold(result: SweepResult, held: readonly HeldEntry[], currentMonth: string): boolean {
  const global = held.filter(
    h => h.file === 'sessions' || h.file === `${currentMonth}.json` || h.file === 'positions.json',
  );
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
    batch
      .filter(f => f.priced.length === 0 && f.session && hasSessionFacts(f))
      .map(f => `${f.tool}\0${f.session}`)
      .filter(sk => !present.has(sk)),
  );
  if (missing.size === 0) return base;
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
    if (!data || !data.sessions.some(s => missing.has(`${s.tool}\0${s.session}`))) continue;
    for (const s of data.sessions) missing.delete(`${s.tool}\0${s.session}`);
    readMonths.push(m);
    months[m] = data;
  }
  return { readMonths: readMonths.sort(), months, held };
}

function nextUnreadFor(file: BatchFile, sk: string, knownUnread: Map<string, number>): number | undefined {
  if (!file.read.startedOver && file.read.unread === 0) return undefined;
  const prev = knownUnread.get(sk) ?? 0;
  let next = file.read.unread;
  // Continuing reads add newly scanned unread lines; first reads (no saved position, e.g. a copy) take max so copies do not double-count.
  if (!file.read.startedOver) next = file.prev ? prev + next : Math.max(prev, next);
  knownUnread.set(sk, next);
  return next;
}

function buildUpsertInputs(
  batch: readonly BatchFile[],
  months: Record<string, SessionMonth>,
  heldBack: ReadonlySet<BatchFile>,
) {
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
      const unread = heldBack.has(file) ? undefined : nextUnreadFor(file, `${file.tool}\0${session}`, knownUnread);
      updates.push({
        tool: file.tool, session, parent: group.parent, project: file.read.project, unread, requests: group.requests,
      });
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
    const source = batch.length > 0 ? await loadFactsMonths(st, base, batch, read) : base;
    if (!source) return true;
    const runUpsert = (heldSet: ReadonlySet<BatchFile>) => {
      const inputs = buildUpsertInputs(batch, source.months, heldSet);
      const up = inputs.updates.length > 0 ? upsertSessionRecord(source, inputs.updates) : { months: source.months, changed: [], notTaken: [] };
      return { ...inputs, up };
    };
    const heldBack = new Set<BatchFile>();
    let pass = runUpsert(heldBack);
    const batchNotTaken: SweepNotTaken = { held: 0, notRead: 0, never: pass.droppedEmptySession };
    for (const nt of pass.up.notTaken) {
      if (nt.reason === 'held' || nt.reason === 'not-read') {
        batchNotTaken[nt.reason === 'held' ? 'held' : 'notRead']++;
        const f = pass.fileByPriced.get(nt.request);
        if (f) heldBack.add(f);
      } else {
        batchNotTaken.never++;
      }
    }
    // Recompute in memory without held-back files' unread lines so a held file's bad lines are not kept before its position
    // moves; nothing is written between the two runs.
    if ([...heldBack].some(file => file.read.unread > 0)) pass = runUpsert(heldBack);
    const merged = mergePositionsAndSeen(base.positions, batch, heldBack, st.seenFiles, pruneTools, st.sweptAt);
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
    recordHeld(st.result, source.held);
    st.result.notTaken.held += batchNotTaken.held;
    st.result.notTaken.notRead += batchNotTaken.notRead;
    st.result.notTaken.never += batchNotTaken.never;
    return false;
  });
}

// ---------- Positions written and dropped ----------

/** Marks this batch's files in `seenFiles`, advances non-held positions, and drops unseen positions for `pruneTools`. */
function mergePositionsAndSeen(
  current: Positions,
  batch: readonly BatchFile[],
  heldBack: ReadonlySet<BatchFile>,
  seenFiles: Record<SessionTool, Set<string>>,
  pruneTools: ReadonlySet<SessionTool>,
  sweptAt: number,
): { positions: Positions; changed: boolean } {
  const map = new Map(current.files.map(entry => [posKey(entry.tool, entry.dev, entry.ino), entry]));
  const heldKeys = new Set<string>();
  for (const file of heldBack) {
    if (file.prevKey) {
      heldKeys.add(file.prevKey);
      seenFiles[file.tool].add(file.prevKey);
    }
  }
  let changed = false;
  for (const file of batch) {
    if (heldBack.has(file)) continue;
    const nextPos = keptPosition(file.tool, file.read, file.codex);
    const key = posKey(nextPos.tool, nextPos.dev, nextPos.ino);
    if (heldKeys.has(key)) continue;
    seenFiles[file.tool].add(key);
    const existing = map.get(key);
    if (!existing || !samePosition(existing, nextPos)) changed = true;
    map.set(key, nextPos);
  }
  for (const [key, entry] of map) {
    const tool = entry.tool as SessionTool;
    if (pruneTools.has(tool) && !seenFiles[tool].has(key)) {
      map.delete(key);
      changed = true;
    }
  }
  return { positions: { formatVersion: 1, sweptAt, files: [...map.values()] }, changed };
}

const prunableTools = (unreadListing: Record<SessionTool, boolean>, unresolvedFiles: Record<SessionTool, boolean>) =>
  new Set(SESSION_TOOLS.filter(tool => !unreadListing[tool] && !unresolvedFiles[tool]));

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
 * turn at a time, holding the store lock (`sessionlock.ts withSessionStoreLock`) from before reading `positions.json` to the
 * end. Does nothing when stopped, before `options.notBefore`, or while another caller holds the store (`skipped: 'busy'`);
 * refuses without creating the store when `writeAccess` or the store's own paths refuse; an idle sweep (no changed file and
 * no gone position to drop) reads only `positions.json`, lists and stats without opening any month; stops without writing
 * when `sessions`, `positions.json`, or (on a turn that needs it) the current UTC month is held.
 */
export async function sweepSessions(context: ShareContext, options: SweepOptions = {}): Promise<SweepResult> {
  const sweptAt = (context.now ?? Date.now)();
  const result = emptyResult(sweptAt);
  if (options.signal?.aborted) return { ...result, stopped: true };
  if (options.notBefore !== undefined && sweptAt < options.notBefore) return { ...result, skipped: 'not-before' };
  const locked = await withSessionStoreLock(context, () => sweepLocked(context, options, sweptAt, result));
  if (locked.status === 'ok') return locked.value;
  if (locked.status === 'busy') return { ...result, skipped: 'busy' };
  if (locked.held) recordHeld(result, [locked.held]);
  return { ...result, refused: locked.refused };
}

async function sweepLocked(context: ShareContext, options: SweepOptions, sweptAt: number, result: SweepResult): Promise<SweepResult> {
  if (options.signal?.aborted) return { ...result, stopped: true };
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

  if (!result.stopped && !result.refused && !prunedInLastBatch) {
    const pruneTools = prunableTools(listed.unreadListing, st.unresolvedFiles);
    const hasGone = [...positionsByKey.entries()].some(
      ([key, entry]) => pruneTools.has(entry.tool as SessionTool) && !st.seenFiles[entry.tool as SessionTool].has(key),
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
